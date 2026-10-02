import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

/*
 * Checks the server end to end against a running `npm run dev`: sign-up, sign-in, refresh
 * (and that a used refresh token is refused), the farm by HTTP and by WebSocket as the game
 * does it, the live updates a dashboard hears, and the leaderboard. Makes a throwaway player
 * (smoke_...) and deletes it at the end.  npx tsx scripts/smoke-test.ts [base url]
 */
const BASE = process.argv[2] ?? 'http://localhost:3000';
const name = `smoke_${randomBytes(4).toString('hex')}`;
const password = randomBytes(12).toString('base64url');
let failures = 0;

function check(label: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) failures++;
}

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const response = await fetch(BASE + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  let body: any = null;
  try {
    body = await response.json();
  } catch {}
  return { status: response.status, body, headers: response.headers };
}

function socket(token: string, client: 'game' | 'web') {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  const inbox: any[] = [];
  const waiters: Array<(m: any) => void> = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    waiters.splice(0).forEach((w) => w(m));
  });
  const next = (type: string, ms = 5000) =>
    new Promise<any>((resolve, reject) => {
      const found = inbox.findIndex((m) => m.type === type);
      if (found >= 0) return resolve(inbox.splice(found, 1)[0]);
      const timer = setTimeout(() => reject(new Error(`no ${type} in ${ms} ms`)), ms);
      const wait = () => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) {
          clearTimeout(timer);
          resolve(inbox.splice(i, 1)[0]);
        } else waiters.push(wait);
      };
      waiters.push(wait);
    });
  const open = new Promise<void>((resolve) => ws.on('open', () => (ws.send(JSON.stringify({ type: 'auth', token, client })), resolve())));
  return { ws, next, open, send: (m: object) => ws.send(JSON.stringify(m)) };
}

const state = {
  version: 1,
  day: 3,
  hour: 9.5,
  coins: 410,
  energy: 88,
  selected: 'Carrot',
  seeds: { Carrot: 4, Wheat: 2 },
  produce: { Carrot: 3, Egg: 2 },
  plots: [
    { index: 0, state: 2, crop: 'Carrot', days: 2, bWatered: true },
    { index: 1, state: 1, crop: 'None', days: 0, bWatered: false },
  ],
  animals: [
    { id: 'a1', kind: 'Chicken', name: 'Pip', boughtDay: 2, lastMilkedDay: 0, lastShornDay: 0 },
    { id: 'a2', kind: 'Cow', name: 'Daisy', boughtDay: 3, lastMilkedDay: 3, lastShornDay: 0 },
  ],
  eggsInCoop: 1,
};

const health = await call('/api/health');
check('health', health.status === 200 && health.body?.database === true);

const reg = await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: name, email: `${name}@example.test`, password, client: 'game' }) });
check('register (game)', reg.status === 201 && !!reg.body?.accessToken && !!reg.body?.refreshToken, `status ${reg.status}`);
const dup = await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: name, email: `x${name}@example.test`, password, client: 'game' }) });
check('duplicate name refused', dup.status === 409);
const weak = await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: `${name}x`, email: `y${name}@example.test`, password: 'short', client: 'game' }) });
check('short password refused', weak.status === 400);

const bad = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: name, password: 'wrong-password', client: 'game' }) });
check('wrong password refused', bad.status === 401);
const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: name.toUpperCase(), password, client: 'game' }) });
check('login (any case)', login.status === 200 && !!login.body?.refreshToken);

const refreshed = await call('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: login.body.refreshToken }) });
check('refresh', refreshed.status === 200 && refreshed.body.refreshToken !== login.body.refreshToken);
const replay = await call('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: login.body.refreshToken }) });
check('used refresh token refused', replay.status === 401);
const afterReplay = await call('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: refreshed.body.refreshToken }) });
check('replay signs every session out', afterReplay.status === 401);

const again = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: `${name}@example.test`, password, client: 'game' }) });
const token = again.body.accessToken as string;
check('login by email', again.status === 200);

const web = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: name, password, client: 'web' }) });
check('web login sets the refresh cookie (not in the body)', web.status === 200 && !web.body.refreshToken && (web.headers.get('set-cookie') ?? '').includes('HttpOnly'));
const cookie = (web.headers.get('set-cookie') ?? '').split(';')[0];
const cookieRefresh = await call('/api/auth/refresh', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'text/plain' } });
check('refresh by cookie', cookieRefresh.status === 200 && !!cookieRefresh.body.accessToken);

check('no token -> 401', (await call('/api/farm')).status === 401);
check('forged token -> 401', (await call('/api/farm', { token: token.slice(0, -4) + 'AAAA' })).status === 401);
const empty = await call('/api/farm', { token });
check('new farm is empty', empty.status === 200 && empty.body.state === null && empty.body.revision === 0);

// A dashboard listening, then the game saving over the WebSocket.
const dash = socket(web.body.accessToken, 'web');
await dash.open;
await dash.next('auth:ok');
const game = socket(token, 'game');
await game.open;
const ok = await game.next('auth:ok');
check('game socket signs in', ok.user?.username === name);
check('dashboard hears the game come online', (await dash.next('status')).playing === true);

game.send({ type: 'farm:save', rid: 7, state });
const saved = await game.next('farm:saved');
check('save over the socket', saved.rid === 7 && saved.revision === 1);
const update = await dash.next('farm:update');
check('dashboard gets the saved farm live', update.state?.coins === 410 && update.revision === 1);

game.send({ type: 'farm:save', rid: 8, state: { ...state, coins: -5 } });
const refused = await game.next('error');
check('a doctored save is refused', refused.rid === 8 && /coins/.test(refused.message), refused.message);

game.send({ type: 'farm:event', event: { kind: 'sell', day: 3, data: { pieces: 4, coins: 160 } } });
const heard = await dash.next('farm:event');
check('dashboard hears events', heard.event?.kind === 'sell');

game.send({ type: 'ping' });
check('ping', !!(await game.next('pong')));

const loaded = await call('/api/farm', { token });
check('farm loads back', loaded.body.revision === 1 && loaded.body.state?.animals?.length === 2 && loaded.body.state?.produce?.Egg === 2);

const put = await call('/api/farm', { method: 'PUT', token, body: JSON.stringify({ state: { ...state, animals: [state.animals[1]], coins: 520 } }) });
check('save over HTTP', put.status === 200 && put.body.revision === 2);
const events = await call('/api/farm/events', { token });
check('events listed', events.body.events?.[0]?.kind === 'sell');

const board = await call('/api/leaderboard');
const row = board.body.farms?.find((f: any) => f.username === name);
check('leaderboard lists the farm, animals kept in step', row?.coins === 520 && row?.animals === 1 && row?.playing === true);

// Signing the game in again elsewhere replaces the first.
const second = socket(token, 'game');
await second.open;
await second.next('auth:ok');
check('second game sign-in replaces the first', (await game.next('session:replaced')).type === 'session:replaced');

for (const s of [dash, game, second]) s.ws.close();

// Clean up: the throwaway player goes (and with it its farm, animals, events and sessions).
const { prisma } = await import('../src/lib/db');
await prisma.user.deleteMany({ where: { username: { startsWith: 'smoke_' } } });
await prisma.$disconnect();

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
