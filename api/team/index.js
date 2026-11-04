import { route, send, body, sql, currentUser, membership, newJoinCode, normCode, tooBig, claimInvites, normEmail, validEmail } from '../_lib.js';

const gameRow = (r, me) => ({
  id: r.id, shared: r.shared, data: r.data, version: r.version, updatedAt: r.updated_at,
  ownerEmail: r.owner_email, mine: String(r.owner_id) === String(me), updatedByEmail: r.updated_by_email
});

async function teamState(user, teamId) {
  const q = sql();
  const teams = await q`select t.id, t.name, m.role from team_members m join teams t on t.id = m.team_id
                        where m.user_id = ${user.id} order by m.joined_at`;
  if (!teams.length) return { teams: [], team: null };
  const m = await membership(user.id, teamId || teams[0].id) || await membership(user.id, teams[0].id);
  const id = m.team_id;
  const members = await q`select u.email, m.role, u.id = ${user.id} as me from team_members m join users u on u.id = m.user_id
                          where m.team_id = ${id} order by (m.role = 'owner') desc, m.joined_at`;
  const roster = (await q`select value, version from team_roster where team_id = ${id}`)[0] || { value: [], version: 0 };
  const invites = m.role === 'owner'
    ? (await q`select email from team_invites where team_id = ${id} order by created_at`).map(r => r.email) : [];
  const games = await q`select g.*, o.email as owner_email, ub.email as updated_by_email from team_games g
                        left join users o on o.id = g.owner_id left join users ub on ub.id = g.updated_by
                        where g.team_id = ${id} and (g.shared or g.owner_id = ${user.id})
                        order by g.updated_at desc`;
  return {
    teams: teams.map(t => ({ id: String(t.id), name: t.name, role: t.role })),
    team: { id: String(id), name: m.name, role: m.role, joinCode: m.role === 'owner' ? m.join_code : null },
    members, invites, roster, games: games.map(r => gameRow(r, user.id))
  };
}

export default route(['GET', 'POST'], async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Sign in first.' });
  const q = sql();
  await claimInvites(user.id, user.email);
  if (req.method === 'GET') return send(res, 200, await teamState(user, req.query?.teamId || new URL(req.url, 'http://x').searchParams.get('teamId')));

  const b = body(req);
  switch (b.action) {
    case 'create': {
      const name = String(b.name || '').trim().slice(0, 80);
      if (!name) return send(res, 400, { error: 'Give your team a name.' });
      if (!Array.isArray(b.roster) || tooBig(b.roster)) return send(res, 400, { error: 'The roster could not be saved.' });
      let team = null;
      for (let i = 0; i < 5 && !team; i++)
        team = (await q`insert into teams (name, join_code) values (${name}, ${newJoinCode()})
                        on conflict (join_code) do nothing returning id`)[0];
      await q`insert into team_members (team_id, user_id, role) values (${team.id}, ${user.id}, 'owner')`;
      await q`insert into team_roster (team_id, value, updated_by) values (${team.id}, ${JSON.stringify(b.roster)}::jsonb, ${user.id})`;
      for (const g of (Array.isArray(b.games) ? b.games : []).slice(0, 200)) {
        if (!g || typeof g.id !== 'string' || !g.data || tooBig(g.data)) continue;
        await q`insert into team_games (team_id, id, owner_id, shared, data, updated_by)
                values (${team.id}, ${g.id.slice(0, 60)}, ${user.id}, ${!!g.shared}, ${JSON.stringify(g.data)}::jsonb, ${user.id})
                on conflict do nothing`;
      }
      return send(res, 201, await teamState(user, team.id));
    }
    case 'join': {
      const code = normCode(b.code);
      const t = (await q`select id, name from teams where join_code = ${code}`)[0];
      if (!t) return send(res, 404, { error: 'No team has that code. Check it with your head coach.' });
      await q`insert into team_members (team_id, user_id, role) values (${t.id}, ${user.id}, 'coach') on conflict do nothing`;
      return send(res, 200, await teamState(user, t.id));
    }
    case 'leave': {
      const m = await membership(user.id, b.teamId);
      if (!m) return send(res, 404, { error: 'You are not on that team.' });
      if (m.role === 'owner') {
        const others = await q`select 1 from team_members where team_id = ${m.team_id} and user_id <> ${user.id} limit 1`;
        if (others.length) return send(res, 400, { error: 'Head coaches can’t leave while other coaches are on the team. Remove them first.' });
        await q`delete from teams where id = ${m.team_id}`;
      } else {
        await q`delete from team_members where team_id = ${m.team_id} and user_id = ${user.id}`;
        await q`update team_games set shared = false where team_id = ${m.team_id} and owner_id = ${user.id}`;
      }
      return send(res, 200, await teamState(user));
    }
    case 'remove': {
      const m = await membership(user.id, b.teamId);
      if (!m || m.role !== 'owner') return send(res, 403, { error: 'Only the head coach can remove coaches.' });
      const email = String(b.email || '').trim().toLowerCase();
      await q`delete from team_members where team_id = ${m.team_id} and role <> 'owner'
              and user_id = (select id from users where email = ${email})`;
      return send(res, 200, await teamState(user, m.team_id));
    }
    case 'invite': {
      const m = await membership(user.id, b.teamId);
      if (!m || m.role !== 'owner') return send(res, 403, { error: 'Only the head coach can add coaches.' });
      const email = normEmail(b.email);
      if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
      const existing = (await q`select id from users where email = ${email}`)[0];
      if (existing) await q`insert into team_members (team_id, user_id, role) values (${m.team_id}, ${existing.id}, 'coach') on conflict do nothing`;
      else await q`insert into team_invites (team_id, email, invited_by) values (${m.team_id}, ${email}, ${user.id}) on conflict do nothing`;
      const st = await teamState(user, m.team_id);
      return send(res, 200, { ...st, added: existing ? 'member' : 'invited' });
    }
    case 'uninvite': {
      const m = await membership(user.id, b.teamId);
      if (!m || m.role !== 'owner') return send(res, 403, { error: 'Only the head coach can change invites.' });
      await q`delete from team_invites where team_id = ${m.team_id} and email = ${normEmail(b.email)}`;
      return send(res, 200, await teamState(user, m.team_id));
    }
    case 'newcode': {
      const m = await membership(user.id, b.teamId);
      if (!m || m.role !== 'owner') return send(res, 403, { error: 'Only the head coach can change the join code.' });
      await q`update teams set join_code = ${newJoinCode()} where id = ${m.team_id}`;
      return send(res, 200, await teamState(user, m.team_id));
    }
    case 'rename': {
      const m = await membership(user.id, b.teamId);
      if (!m || m.role !== 'owner') return send(res, 403, { error: 'Only the head coach can rename the team.' });
      const name = String(b.name || '').trim().slice(0, 80);
      if (!name) return send(res, 400, { error: 'Give your team a name.' });
      await q`update teams set name = ${name} where id = ${m.team_id}`;
      return send(res, 200, await teamState(user, m.team_id));
    }
    default: return send(res, 400, { error: 'Unknown action.' });
  }
});
