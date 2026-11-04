import { route, send, body, sql, currentUser, isDataKey, MAX_VALUE_BYTES } from './_lib.js';

// GET  /api/data            -> { data: { plays, team, drills, practice }, updated: {...} }
// PUT  /api/data  {key, value} -> saves one of those for the signed-in coach
export default route(['GET', 'PUT'], async (req, res) => {
  const user = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Sign in to sync.' });
  const q = sql();

  if (req.method === 'GET') {
    const rows = await q`select key, value, updated_at from user_data where user_id = ${user.id}`;
    const data = {}, updated = {};
    for (const r of rows) { data[r.key] = r.value; updated[r.key] = r.updated_at; }
    return send(res, 200, { data, updated });
  }

  const b = body(req);
  if (!isDataKey(b.key)) return send(res, 400, { error: 'Unknown data type.' });
  if (b.value === undefined) return send(res, 400, { error: 'Nothing to save.' });
  const json = JSON.stringify(b.value);
  if (Buffer.byteLength(json) > MAX_VALUE_BYTES) return send(res, 413, { error: 'That is too much data to save at once.' });
  const rows = await q`insert into user_data (user_id, key, value, updated_at)
                       values (${user.id}, ${b.key}, ${json}::jsonb, now())
                       on conflict (user_id, key) do update set value = excluded.value, updated_at = now()
                       returning updated_at`;
  send(res, 200, { ok: true, updated: rows[0].updated_at });
});
