import bcrypt from 'bcryptjs';
import { route, send, body, sql, startSession, claimInvites, normEmail } from '../_lib.js';

// Compared against when the email is unknown, so both paths take the same time.
const DUMMY = bcrypt.hashSync('fieldwise-placeholder', 10);

export default route(['POST'], async (req, res) => {
  const b = body(req);
  const email = normEmail(b.email), password = String(b.password || '');
  const rows = await sql()`select id, email, password_hash from users where email = ${email}`;
  const ok = await bcrypt.compare(password, rows[0]?.password_hash || DUMMY);
  if (!rows.length || !ok) return send(res, 401, { error: 'Email or password is incorrect.' });
  await claimInvites(rows[0].id, rows[0].email);
  await startSession(res, rows[0].id);
  send(res, 200, { user: { email: rows[0].email } });
});
