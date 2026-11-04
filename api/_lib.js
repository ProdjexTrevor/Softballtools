// Shared helpers for the API: database, schema, sessions and responses.
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const DATA_KEYS = ['plays', 'team', 'drills', 'practice', 'prefs'];
const MAX_VALUE_BYTES = 2_000_000;
const SESSION_DAYS = 60;
const COOKIE = 'fw_session';

// Vercel's Neon integration may add a custom prefix (e.g. STORAGE_DATABASE_URL), so look for any of them.
function databaseUrl() {
  const env = process.env;
  const direct = env.DATABASE_URL || env.POSTGRES_URL;
  if (direct) return direct;
  const key = Object.keys(env).find(k => /(^|_)DATABASE_URL$/.test(k) && env[k])
           || Object.keys(env).find(k => /(^|_)POSTGRES_URL$/.test(k) && env[k]);
  return key ? env[key] : null;
}

let _sql = null;
export function sql() {
  if (globalThis.__FW_TEST_SQL) return globalThis.__FW_TEST_SQL;
  if (!_sql) {
    const url = databaseUrl();
    if (!url) throw Object.assign(new Error('DATABASE_URL is not set'), { code: 'NO_DB' });
    _sql = neon(url);
  }
  return _sql;
}

// Creates the tables the first time the API runs (safe to repeat).
let _schema = null;
export function ensureSchema() {
  if (!_schema) {
    const q = sql();
    _schema = (async () => {
      await q`create table if not exists users (
        id bigserial primary key,
        email text not null unique,
        password_hash text not null,
        created_at timestamptz not null default now())`;
      await q`create table if not exists sessions (
        token_hash text primary key,
        user_id bigint not null references users(id) on delete cascade,
        expires_at timestamptz not null)`;
      await q`create table if not exists user_data (
        user_id bigint not null references users(id) on delete cascade,
        key text not null,
        value jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (user_id, key))`;
      // Teams: built for many, the app uses one per coach for now.
      await q`create table if not exists teams (
        id bigserial primary key,
        name text not null,
        join_code text not null unique,
        created_at timestamptz not null default now())`;
      await q`create table if not exists team_members (
        team_id bigint not null references teams(id) on delete cascade,
        user_id bigint not null references users(id) on delete cascade,
        role text not null default 'coach' check (role in ('owner','coach')),
        joined_at timestamptz not null default now(),
        primary key (team_id, user_id))`;
      await q`create table if not exists team_roster (
        team_id bigint primary key references teams(id) on delete cascade,
        value jsonb not null,
        version integer not null default 1,
        updated_by bigint references users(id) on delete set null,
        updated_at timestamptz not null default now())`;
      await q`create table if not exists team_games (
        team_id bigint not null references teams(id) on delete cascade,
        id text not null,
        owner_id bigint references users(id) on delete set null,
        shared boolean not null default false,
        data jsonb not null,
        version integer not null default 1,
        updated_by bigint references users(id) on delete set null,
        updated_at timestamptz not null default now(),
        primary key (team_id, id))`;
      await q`create table if not exists team_invites (
        team_id bigint not null references teams(id) on delete cascade,
        email text not null,
        invited_by bigint references users(id) on delete set null,
        created_at timestamptz not null default now(),
        primary key (team_id, email))`;
    })().catch(e => { _schema = null; throw e; });
  }
  return _schema;
}

export const isDataKey = k => DATA_KEYS.includes(k);
export { DATA_KEYS, MAX_VALUE_BYTES };

const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

function readCookie(req, name) {
  if (req.cookies && req.cookies[name]) return req.cookies[name];
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setCookie(res, value, maxAge) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

export async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const q = sql();
  await q`insert into sessions (token_hash, user_id, expires_at)
          values (${hashToken(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  await q`delete from sessions where user_id = ${userId} and expires_at < now()`;
  setCookie(res, token, SESSION_DAYS * 86400);
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await sql()`delete from sessions where token_hash = ${hashToken(token)}`;
  setCookie(res, '', 0);
}

export async function currentUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const rows = await sql()`select u.id, u.email from sessions s join users u on u.id = s.user_id
                           where s.token_hash = ${hashToken(token)} and s.expires_at > now()`;
  return rows[0] || null;
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

// Wraps a handler: method check, schema, and readable errors.
export function route(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return send(res, 405, { error: 'Method not allowed' });
    }
    try {
      await ensureSchema();
      return await fn(req, res);
    } catch (e) {
      if (e.code === 'NO_DB') return send(res, 503, { error: 'The database is not connected yet. Add a Neon database to this Vercel project.' });
      console.error(e);
      return send(res, 500, { error: 'Something went wrong on the server. Try again in a moment.' });
    }
  };
}

export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
export const signupCodeRequired = () => !!process.env.SIGNUP_CODE;

// Team membership for the signed-in coach. Returns { team_id, role, name } or null.
export async function membership(userId, teamId) {
  const q = sql();
  const rows = teamId
    ? await q`select m.team_id, m.role, t.name, t.join_code from team_members m join teams t on t.id = m.team_id
              where m.user_id = ${userId} and m.team_id = ${teamId}`
    : await q`select m.team_id, m.role, t.name, t.join_code from team_members m join teams t on t.id = m.team_id
              where m.user_id = ${userId} order by m.joined_at limit 1`;
  return rows[0] || null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newJoinCode() {
  const b = crypto.randomBytes(6);
  return Array.from(b, x => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
export const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const tooBig = v => Buffer.byteLength(JSON.stringify(v)) > MAX_VALUE_BYTES;

// Adds the coach to any team that invited their email, then clears those invites.
export async function claimInvites(userId, email) {
  const q = sql();
  await q`insert into team_members (team_id, user_id, role)
          select team_id, ${userId}, 'coach' from team_invites where email = ${email}
          on conflict do nothing`;
  await q`delete from team_invites where email = ${email}`;
}
