import { route, send, body, sql, currentUser, membership, tooBig } from '../_lib.js';

// PUT { teamId, value, version } — any coach on the team can update the roster.
export default route(['PUT'], async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Sign in first.' });
  const b = body(req);
  const m = await membership(user.id, b.teamId);
  if (!m) return send(res, 403, { error: 'You are not on that team.' });
  if (!Array.isArray(b.value) || tooBig(b.value)) return send(res, 400, { error: 'The roster could not be saved.' });
  const q = sql();
  const rows = await q`update team_roster set value = ${JSON.stringify(b.value)}::jsonb, version = version + 1,
                       updated_by = ${user.id}, updated_at = now()
                       where team_id = ${m.team_id} and version = ${+b.version || 0} returning version`;
  if (rows.length) return send(res, 200, { version: rows[0].version });
  const cur = (await q`select value, version from team_roster where team_id = ${m.team_id}`)[0];
  send(res, 409, { error: 'Another coach changed the roster.', current: cur });
});
