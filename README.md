# Yieldfield server

Accounts, saves and live updates for **Yieldfield**, the Unreal farming game (play as Diana or Arash),
and a small website where players watch their farm. It runs either as one Node process on one port
(your computer, a VPS) or on **Vercel** (see below). As its own process it serves:

- **Next.js** (App Router): the site (`/`, `/dashboard`, `/leaderboard`) and the REST API (`/api/...`)
- **The game's rules** (`src/lib/game/`): the server keeps every farm and does every action the game asks (see below)
- **WebSocket** at `/ws` (the `ws` package): presence and live updates; dashboards see the farm change as it's played
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
| `GET /api/farm` | `{ state, revision, wallet: { coins, gems, bloom }, now, defs }` (`state` null: no farm yet) |
| `POST /api/farm/start` | `{ plots, starter }` (the level's bed indices): a new farm, only if there's none |
| `POST /api/farm/act` | `{ id, action }`: one action, done by the server (see below) |
| `PUT /api/farm` | 410: games from before 1.5 can't save any more |
| `GET /api/farm/events` / `POST` | the activity feed / `{ kind, day, data }` |
| `GET /api/leaderboard` | the richest farms |
| `GET /api/health` | `{ ok, database, realtime, online }`: `realtime` false means no WebSocket (Vercel) |

The game gets its refresh token in the body; the site gets it as an http-only cookie. A refresh token
used twice signs all of that player's devices out (it was copied). Sign-in is rate limited per address.

## WebSocket `/ws` (not on Vercel)

JSON messages with a `type`. First `{ type: "auth", token, client: "game" | "web" }` → `auth:ok`.
The game sends `farm:event { event }` and `ping` (an old game's `farm:save` is answered with an error:
the farm is the server's now). Dashboards receive `farm:update { state, revision, wallet, now }` after
every action, `farm:event` and `status`. Everyone receives `presence { online }`. Signing into the game
on a second computer sends `session:replaced` to the first.

## The farm is the server's: actions, timers and three currencies

Since game 1.5 the server keeps the whole farm (`Farm.state`, `src/lib/game/state.ts`, version 5) and
the player's gems and BLOOM (`User.gems`, `User.bloom`), and the game can only **ask**: every click
is an action (`POST /api/farm/act { id, action }`) that `src/lib/game/rules.ts` checks and does with the
server's clock, in one transaction with the farm's revision (two at once: the second is done again on
the new farm). The answer is the farm as stored, which the game then shows: nothing is added or taken
(coins, seeds, gems, BLOOM, a building, a spouse, VIP) until it's in the database. An action sent twice
(the answer lost on the way) is done once: the last 40 ids are kept. 422 `{ error, state }`: it can't
be done now (the game shows why); 409 `busy`: try again. Every gem and BLOOM change is written in
`CurrencyLog` (what, how many, the balance after, why).

Actions: `till`, `plant`, `water`, `harvest`, `buy_plot`, `build`, `buy_seeds`, `buy_animal`, `milk`,
`shear`, `collect_eggs`, `feed`, `leather`, `sell_all`, `trade`, `eat`, `sleep`, `marry`, `buy_vip`,
`buy_gems`, `speedup`, and `clock` (the time of day the game shows, each minute).

**Timers** are real time, in Unix seconds of the server's clock (the game sets its own clock from each
answer's `now`, so the phone's clock doesn't matter):

- Crops grow only while watered: each watering lasts a while, then the bed waits for water. Wheat
  10 min (water every 5 min), hay 15 min (15), carrot 30 min (15), corn 1 h (30 min), tomato 2 h (1 h),
  sunflower 4 h (2 h), pumpkin 8 h (4 h). `growth = min(grow, grown + max(0, min(now, wetUntil) - grownAt))`.
- Hens lay an egg every 4 h and eat 1 corn a day; sheep give milk every 6 h and wool every 12 h and eat
  1 hay; cows give 2 milk every 12 h and eat 2 hay. A feeding keeps an animal fed for 24 h (it can be
  fed ahead up to 48 h). A hungry animal's timers stop until it's fed, then go on where they were.
  Every 10 levels an animal gives one more.
- Sleeping (a new day, full energy) once in 24 hours (`lastSleptAt`).

**Currencies**: **coins** are the farm's money (seeds, animals, beds and buildings bought from the
game; crops and products sold to the bin and the traders; task rewards). **Gems** speed timers up:
3 gems a minute left (a crop, an animal's milk or eggs, a sheep's wool); bought with BLOOM in packs set
in /admin (`gemPacks`), and given for doing all of a day's tasks. **BLOOM** (bought with crypto, see
below) is for what's between players and the premium things: the spouse, VIP, gem packs, and later the
market. Farms from before 1.5 were taken over at their first load: the game's BLOOM became coins, and
`User.bloom` starts at what the player had bought.

All the numbers are in `src/lib/game/defs.ts`; the game is sent them at load (`defs`), so a change
there needs no new game.

## The BLOOM shop (crypto payments) and the admin page

Players buy BLOOM packs in the game (B, or + on the HUD): they pick a pack (priced in dollars) and a
coin, and get an order: the exact amount of that coin to send to the admin's wallet, valid for 10
minutes. The amount is the price in the coin at that moment plus a tiny offset no other open order
has, so a transfer of that amount, sent while the order was open, is that order's payment. The game
asks every few seconds; the server then looks on the chain (src/lib/networks.ts) and, once it's
there, adds the pack to the player's BLOOM (`User.bloom`, written in `CurrencyLog`), exactly once.
After the 10 minutes a new order (and a new amount, at the new price) is needed; a payment sent in
time but seen late still counts.

Coins: USDT (TRC20), TRX, TON, USDT (BEP20), Bitcoin and Litecoin, read through TronGrid,
toncenter, a public BNB Chain node, mempool.space and litecoinspace.org (no API keys). Prices come
from CoinGecko, or Kraken if it's busy. Bitcoin and Litecoin payments are credited after one block.

**/admin** (on the website) is for admins: the users flagged `isAdmin` and the names in the
`ADMIN_USERNAMES` environment variable (comma-separated). There: the wallet address for each coin (a
coin is offered only while it has one), the packs and their prices, the minutes an order lasts, every
order (look again on the chain, credit by hand, cancel), giving a player BLOOM or gems, VIP plans,
gem packs, and a player's VIP days and reputation.

Who a player plays (Diana, Arellah or Arash) is chosen once, at sign-up, and kept on the account
(`User.character`; src/lib/game/defs.ts `CHARACTERS`, each a woman or a man). Changing it at the title
screen costs gems: 600 for another character of the same gender, 1500 for the other gender (a husband
or wife becomes one of the other gender with it). Accounts from before the choice choose once, free.
`GET /api/character` lists the characters with what each would cost the player.

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
| `POST /api/wallet/deposits` | looks for payments from the player's wallets now → `{ credited, balance }` |

`TRONGRID_API_KEY` (optional) raises TronGrid's rate limit.

## Daily tasks, reputation and VIP

**Daily tasks** (src/lib/tasks.ts): each player gets three a (UTC) day, made at their first look that
day from what their farm can do then (its level, beds and animals) and the same all day; a VIP gets
one more. Up to two are deliveries to the farm's traders (Gus the grocer: crops, Hattie: eggs, Molly:
milk, Bruno the butcher: wool and leather), the rest farm work (water, plant, harvest, milk, shear,
collect eggs, feed animals, earn coins selling). The server counts them as the actions come (in the
farm: `taskDay`, `taskProgress`) and pays each one as soon as it's done, in the same transaction:
experience and coins on the farm (once per task: `TaskClaim`). Doing them all gives a bonus of
experience and gems. Tasks give no reputation.

**Reputation** (src/lib/reputation.ts) is worked out each time from what ties the farm to a real
person: 25 for each linked wallet, 50 for a linked Discord account, 600 while VIP lasts, plus what the
admins give (`User.reputation`, which also keeps what tasks gave before 1.6, minus what the 1.6
migration took back). Unlinking takes its part away. It puts the player in a tier: Newcomer, Good
Neighbor (100), Trusted Farmer (300), Respected (700), Renowned (1500), Valley Legend (3000). The tier
sets how much more than the shipping bin the traders pay, how many pieces each buys a day, how many
market listings at once, and (for later) how much BLOOM can be withdrawn a day. The market itself takes
600 reputation, so VIP opens it.

**VIP** (`User.vipUntil`) is bought in the game's journal with BLOOM (the `buy_vip` action) or given
by an admin: a golden name over the player's head, +600 reputation while it lasts, one more task a
day, +5% and 1.5x bigger orders at the traders, 5 more market listings, and (for later) double
withdrawals. Plans (days, BLOOM) are set in /admin.

| | |
|---|---|
| `GET /api/tasks` | today's tasks (progress, claimed or not), the all-done bonus, the player's standing |
| `GET /api/me` | also the player's linked wallets and Discord (each gives reputation) |
| `GET /api/me/history` | `{ purchases, ledger }`: crypto purchases (orders and wallet deposits) and every BLOOM and gem change |
| `GET /api/vip` / `POST /api/vip` | the standing and VIP plans / `{ plan }` → buys it with BLOOM |
| `POST /api/admin/player` | `{ username, vipDays?, reputation? }` (admins) |

## Skills

Every player level gives a skill point (src/lib/game/defs.ts `SKILL_TRACKS`, the `skill` action):

- **Combat**: +100 combat power a level (shown on the player's name and in the game's skills, K).
- **Farming**, **Cattle** (cows), **Sheep**, **Poultry** (hens): a *time* track (5% off their timers a
  level: a crop's growing, an animal's milk, wool or eggs) and a *yield* track (5% more a level, the
  fractions kept till they make a whole one), six levels each.
- **Building**: time only, 10% a level off how long a building takes to go up (buildings now take
  real time: the hen house 30 min, the market stall 3 h, the barn 2 h; gems finish them).

`skill_reset` takes all the points back to put in again, once every three months (the first time
whenever). A crop keeps the growing time it was planted with (`plot.need`); an animal's timer the one
it started with.

## The market

Players sell crops, products and animals to each other for BLOOM at the market stall they build on
their farm (src/lib/market.ts; the `market_list`, `market_buy` and `market_cancel` actions; the
`Listing` table). It takes 600 reputation to sell or buy; the listings at once come from the tier
(+5 for VIP). A listing's goods leave the seller's farm (the server holds them) until it's bought (the
BLOOM goes to the seller at once, in the buyer's transaction, written in both their books), taken
back, or it runs out after 72 hours (given back at the seller's next action). The anti-cheat rules:

- a price must be within 10% (up or down) of the **going price** of the same thing: its cheapest
  listing now, else what it last sold for (14 days), else its base (a tenth of what the game pays for
  it, in BLOOM; an animal's from its price, more for every ten levels: animals are compared by kind
  and ten-level band, "Cow@1");
- nobody buys their own listing; a listing is bought once (the row is taken in the transaction);
- an animal goes only to a farm with its home built, the level for it and room.

| | |
|---|---|
| `GET /api/market` | what's on sale (by thing), the player's listings, the going prices of what they could sell, their reputation and listings |
| `GET /api/market/listings?key=` | one thing's listings, cheapest first |

## Discord

Linking a Discord account gives 50 reputation (one farm per Discord account). The game's journal (or
the market, or the site's dashboard) starts it: `POST /api/discord/requests` → open its url
(`/api/discord/start`, then Discord's consent page, scope `identify`) → `/api/discord/callback` links
it → the game asks `GET /api/wallet/requests/{code}` till it's done. `DELETE /api/discord` unlinks.

To turn it on: make an application at https://discord.com/developers/applications, add the redirect
`https://<your site>/api/discord/callback` under OAuth2, and set `DISCORD_CLIENT_ID` and
`DISCORD_CLIENT_SECRET` (on Vercel: Settings → Environment Variables, then redeploy).
`DISCORD_REDIRECT_URI` overrides the redirect.

## Packs of gems for crypto, and deposits

A shop pack (in /admin) gives BLOOM or gems. An order's payment credits its pack; a payment from a
player's linked wallet credits the pack of their open order even if the amount is a little off
(97–110% of it), and otherwise becomes BLOOM at the packs' rate. Each is a `Payment` (the admin's
Transactions list, marked "linked wallet") and a line in the player's history (the game's shop:
HISTORY, and the site's dashboard).
