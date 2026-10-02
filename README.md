# Yieldfield server

Accounts, saves and live updates for **Yieldfield**, the Unreal farming game (play as Diana or Arash),
and a small website where players watch their farm. It runs either as one Node process on one port
(your computer, a VPS) or on **Vercel** (see below). As its own process it serves:

- **Next.js** (App Router): the site (`/`, `/dashboard`, `/leaderboard`) and the REST API (`/api/...`)
- **WebSocket** at `/ws` (the `ws` package): the game saves and reports events over it; dashboards hear them live
- **PostgreSQL** through **Prisma 7** (`prisma/schema.prisma`, migrations in `prisma/migrations`)
- **JWT** access tokens (15 min, `jose`) + rotating refresh tokens (30 days, stored hashed); passwords with bcrypt

## On this computer

```bash
npm install        # once
npm run setup      # once: writes .env with fresh secrets, creates the database and its tables
npm run dev        # the server on http://localhost:3000
```

With `EMBEDDED_POSTGRES=true` (the default in `.env`) the server starts its own PostgreSQL from
`node_modules` (the `embedded-postgres` package: real PostgreSQL binaries, no install or root),
keeping its data in `.pgdata/`. Stop with Ctrl+C.

The game finds the server through `Config/DefaultGame.ini`:

```ini
[/Script/MyProject.FarmOnlineSubsystem]
ServerUrl="http://127.0.0.1:3000"
```

(keep the quotes: unquoted, Unreal cuts the value at `//`), or `-FarmServer=http://host:3000` on the
game's command line.

Other commands: `npm run db:migrate -- --name <what>` after changing the schema, `npm run db:studio`
to browse the tables, `npx tsx scripts/smoke-test.ts` to check every endpoint and the WebSocket
against a running server (it uses a throwaway player and deletes it).

## On Vercel

Vercel runs the site and the API as serverless functions. Serverless functions can't keep WebSockets
open, so there the server says so (`GET /api/health` → `"realtime": false`): the game saves and
reports events over plain HTTP instead, the website checks back every few seconds, and "playing now"
means "saved in the last two minutes". Everything else is the same.

1. **Import the repository** in Vercel (Add New → Project → this GitHub repo). Framework: Next.js (found
   by itself). Build command: leave the default; `npm run vercel-build` runs by itself and applies the
   database migrations (`prisma migrate deploy`) before `next build`.
2. **Add a database**: the project's Storage tab → Create Database → **Neon** (Postgres). Connect it to
   the project; it sets `DATABASE_URL` (pooled, used by the app) and `DATABASE_URL_UNPOOLED` (direct,
   used for migrations).
3. **Environment variables** (Settings → Environment Variables):
   - `JWT_SECRET`: a long random string (`openssl rand -base64 36`). Changing it signs everyone out.
   - optional: `ACCESS_TTL_SECONDS` (900), `REFRESH_TTL_DAYS` (30).
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the build sees the database and the secret.
5. Open `https://<your-project>.vercel.app/api/health`: it should answer `"ok": true, "realtime": false`.
6. Point the game at it in `Config/DefaultGame.ini`:
   ```ini
   [/Script/MyProject.FarmOnlineSubsystem]
   ServerUrl="https://<your-project>.vercel.app"
   ```

Accounts and farms made on your computer's database don't move to Vercel's by themselves: they are
different databases.

## On a VPS

```bash
cp .env.production.example .env      # fill in DB_PASSWORD and JWT_SECRET
docker compose up -d --build         # PostgreSQL 17 + this server on port 3000
```

For real players put HTTPS in front: point a domain at the VPS, put it in `Caddyfile`, uncomment
the `caddy` service in `docker-compose.yml`, and set the game's `ServerUrl` to `https://your-domain`
(the game then uses `wss://` for the WebSocket by itself).

## API

| | |
|---|---|
| `POST /api/auth/register` | `{ username, email, password, client: "game" \| "web" }` → tokens (201) |
| `POST /api/auth/login` | `{ login (name or email), password, client }` → tokens |
| `POST /api/auth/refresh` | `{ refreshToken }` (the site: its cookie) → new tokens; the old refresh token stops working |
| `POST /api/auth/logout` | `{ refreshToken }` |
| `GET /api/me` | the player (Bearer access token) |
| `GET /api/farm` / `PUT /api/farm` | `{ revision, updatedAt, state }` / `{ state }` |
| `GET /api/farm/events` / `POST` | the activity feed / `{ kind, day, data }` |
| `GET /api/leaderboard` | the richest farms |
| `GET /api/health` | `{ ok, database, realtime, online }`: `realtime` false means no WebSocket (Vercel) |

The game gets its refresh token in the body; the site gets it as an http-only cookie. A refresh token
used twice signs all of that player's devices out (it was copied). Sign-in is rate limited per address.

## WebSocket `/ws` (not on Vercel)

JSON messages with a `type`. First `{ type: "auth", token, client: "game" | "web" }` → `auth:ok`.
The game sends `farm:save { rid, state }` (→ `farm:saved { rid, revision }`), `farm:event { event }`
and `ping`. Dashboards receive `farm:update` and `farm:event` for their farm, and `status`. Everyone
receives `presence { online }`. Signing into the game on a second computer sends `session:replaced`
to the first.

The saved state is the game's `FFarmState` (`Source/MyProject/FarmTypes.h`); `src/lib/farm.ts` checks it
before storing it (a doctored save with negative coins is refused).
