# Fieldwise — softball coaching board

A coaching tool for softball (60 ft bases, 200 ft fence), hosted on Vercel with a Neon Postgres database.

- **Play board**: drag fielders, runners and the ball; record steps and play them back; practice mode
- **Lineups**: field view with player names, lineups per inning, who's-out matrix, rotation chart
- **Drill library**: drills with a media link, description and tags
- **Accounts + sync**: sign in to save everything to the database and use it on any device

## How it's built

| Part | Where |
|---|---|
| App (one page, no build step) | `index.html` |
| API (Vercel serverless functions) | `api/` |
| Database | Neon Postgres, via `@neondatabase/serverless` |

The API creates its tables automatically on first use:

- `users` — coach accounts (email + bcrypt password hash)
- `sessions` — sign-in sessions (hashed tokens, 60-day cookie)
- `user_data` — one JSON row per coach for each of `plays`, `team`, `drills`, `practice`

The app keeps a copy in the browser too, so it still works offline. Changes sync to the database when the coach is signed in.

## Connect the Neon database (one time)

1. In Vercel, open the project → **Storage** → **Create Database** → **Neon** (Serverless Postgres).
2. Choose a region close to you (for example US East) and the free plan.
3. Connect it to this project for **Production** and **Preview**. Vercel adds the `DATABASE_URL` environment variable.
4. **Redeploy** the latest deployment so the new variable takes effect.
5. Open the site, tap **Sign in → Create an account**. Data already on that device uploads to the account.

### Optional: limit who can create accounts

Add an environment variable `SIGNUP_CODE` (for example `tigers2026`) in Vercel → Settings → Environment Variables, then redeploy. New accounts will need that team code; existing accounts are unaffected.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/me` | Current coach (or `null`) |
| POST | `/api/auth/signup` | `{ email, password, code? }` |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | Ends the session |
| GET | `/api/data` | All saved data for the coach |
| PUT | `/api/data` | `{ key, value }` where key is `plays`, `team`, `drills` or `practice` |

## Run locally

    npm install
    npx vercel dev

`vercel dev` needs `DATABASE_URL` in a local `.env` file (`npx vercel env pull` downloads it).
