import { route, send, body, sql, currentUser, membership, tooBig } from '../_lib.js';

// PUT    { teamId, id, data, shared, version }  save a game lineup (creates it if new)
// DELETE { teamId, id }                          delete a game lineup
// The coach who made a game and the head coach can change it; shared games are visible to the team.
export default route(['PUT', 'DELETE'], async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Sign in first.' });
  const b = body(req);
  const m = await membership(user.id, b.teamId);
  if (!m) return send(res, 403, { error: 'You are not on that team.' });
  const id = String(b.id || '').slice(0, 60);
  if (!id) return send(res, 400, { error: 'Missing game.' });
  const q = sql();
  const row = (await q`select owner_id, shared, version from team_games where team_id = ${m.team_id} and id = ${id}`)[0];
  const canEdit = row && (String(row.owner_id) === String(user.id) || m.role === 'owner');

  if (req.method === 'DELETE') {
    if (!row) return send(res, 200, { ok: true });
    if (!canEdit) return send(res, 403, { error: 'Only the coach who made this lineup or the head coach can delete it.' });
    await q`delete from team_games where team_id = ${m.team_id} and id = ${id}`;
    return send(res, 200, { ok: true });
  }

  if (!b.data || typeof b.data !== 'object' || tooBig(b.data)) return send(res, 400, { error: 'The lineup could not be saved.' });
  const json = JSON.stringify(b.data), shared = !!b.shared;
  if (!row) {
    const ins = await q`insert into team_games (team_id, id, owner_id, shared, data, updated_by)
                        values (${m.team_id}, ${id}, ${user.id}, ${shared}, ${json}::jsonb, ${user.id})
                        on conflict do nothing returning version`;
    if (ins.length) return send(res, 201, { version: ins[0].version });
    return send(res, 409, { error: 'That lineup was just created somewhere else.' });
  }
  if (!canEdit) return send(res, 403, { error: 'This lineup is view only. Duplicate it to make your own version.' });
  const up = await q`update team_games set data = ${json}::jsonb, shared = ${shared}, version = version + 1,
                     updated_by = ${user.id}, updated_at = now()
                     where team_id = ${m.team_id} and id = ${id} and version = ${+b.version || 0} returning version`;
  if (up.length) return send(res, 200, { version: up[0].version });
  const cur = (await q`select g.data, g.shared, g.version, u.email as updated_by_email from team_games g
                       left join users u on u.id = g.updated_by where g.team_id = ${m.team_id} and g.id = ${id}`)[0];
  send(res, 409, { error: 'Another coach changed this lineup.', current: cur });
});
