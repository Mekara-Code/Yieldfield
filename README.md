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

## The BLOOM shop (crypto payments) and the admin page

Players buy BLOOM packs in the game (B, or + on the HUD): they pick a pack (priced in dollars) and a
coin, and get an order: the exact amount of that coin to send to the admin's wallet, valid for 10
minutes. The amount is the price in the coin at that moment plus a tiny offset no other open order
has, so a transfer of that amount, sent while the order was open, is that order's payment. The game
asks every few seconds; the server then looks on the chain (src/lib/networks.ts) and, once it's
there, adds the pack to the farm's `credits` (the game adds new credits to its coins, exactly once).
After the 10 minutes a new order (and a new amount, at the new price) is needed; a payment sent in
time but seen late still counts.

Coins: USDT (TRC20), TRX, TON, USDT (BEP20), Bitcoin and Litecoin, read through TronGrid,
toncenter, a public BNB Chain node, mempool.space and litecoinspace.org (no API keys). Prices come
from CoinGecko, or Kraken if it's busy. Bitcoin and Litecoin payments are credited after one block.

**/admin** (on the website) is for admins: the users flagged `isAdmin` and the names in the
`ADMIN_USERNAMES` environment variable (comma-separated). There: the wallet address for each coin (a
coin is offered only while it has one), the packs and their prices, the minutes an order lasts, every
order (look again on the chain, credit by hand, cancel), and giving a player BLOOM.

Who a player plays (Diana or Arash) is chosen at sign-up and kept on the account; changing it at the
title screen costs 500 BLOOM (taken through the farm's credits). Accounts from before the choice
choose once, free.

## Players' wallets (pay without an order, sign in with a wallet)

A player can link their own wallets to their farm: in the game, the shop's MY WALLETS → CONNECT A
WALLET (or SIGN IN WITH A WALLET on the sign-in form) makes a request and shows its link and short
code; the player opens the link (`/wallet?code=…`) and signs a message with the wallet, and the game,
which asks every few seconds, carries on. EVM wallets (MetaMask, Trust Wallet, OKX…) sign with
`personal_sign`, TronLink with `signMessageV2`, TON wallets with a TON Connect `ton_proof`. On a phone
MetaMask, Trust Wallet, OKX and TronLink sign only inside their own app's browser: the page has links
that open it there. A TON wallet must have been used on-chain once (its public key is read from the
chain).

Linked wallets do two things:

- **Deposits:** anything a linked wallet sends to the shop's wallet for a coin of its chain (BNB Chain:
  USDT-BEP20; Tron: USDT-TRC20 and TRX; TON: TON) is that player's, without an order: any amount, at
  the rate of the biggest pack it pays for. The server looks when the game loads or saves the farm,
  while the shop's wallets page is open, and on CHECK FOR MY PAYMENT. Each transaction counts once.
  Payments from an exchange can't be told apart (the sender is the exchange): those need an order.
- **Sign-in:** a linked wallet signs the player in; a wallet that isn't linked can start a new farm
  (a name and a character on the page; no password: such an account keeps at least one wallet).

| | |
|---|---|
| `POST /api/wallet/requests` | `{ mode: "link" \| "login" }` (link: Bearer token) → `{ code, short, url, qr, expiresAt }` (15 minutes) |
| `GET /api/wallet/requests/:code` | `{ status: pending \| done \| expired \| used, shortAddress }`; a done login request carries tokens, once |
| `GET /api/wallet/challenge?code=` / `POST /api/wallet/verify` | for the /wallet page: the message to sign / the signature or proof |
| `GET /api/wallet` | the player's wallets, the shop's addresses they can pay to, BLOOM per dollar |
| `DELETE /api/wallet/:id` | unlinks one |
| `POST /api/wallet/deposits` | looks for payments from the player's wallets now → `{ credited, credits }` |

`TRONGRID_API_KEY` (optional) raises TronGrid's rate limit.
