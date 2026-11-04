import bcrypt from 'bcryptjs';
import { route, send, body, sql, startSession, claimInvites, normEmail, validEmail } from '../_lib.js';

export default route(['POST'], async (req, res) => {
  const b = body(req);
  const email = normEmail(b.email), password = String(b.password || '');
  if (process.env.SIGNUP_CODE && String(b.code || '').trim() !== process.env.SIGNUP_CODE)
    return send(res, 403, { error: 'That team code isn’t right. Ask the head coach for it.' });
  if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
  if (password.length < 8) return send(res, 400, { error: 'Use a password with at least 8 characters.' });
  if (password.length > 200) return send(res, 400, { error: 'That password is too long.' });
  const hash = await bcrypt.hash(password, 10);
  const rows = await sql()`insert into users (email, password_hash) values (${email}, ${hash})
                           on conflict (email) do nothing returning id, email`;
  if (!rows.length) return send(res, 409, { error: 'An account with that email already exists. Sign in instead.' });
  await claimInvites(rows[0].id, rows[0].email);
  await startSession(res, rows[0].id);
  send(res, 201, { user: { email: rows[0].email } });
});
