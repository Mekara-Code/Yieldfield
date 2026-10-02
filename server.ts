import 'dotenv/config';
import { createServer } from 'node:http';
import next from 'next';
import { migrate, ROOT, startDatabase } from './scripts/database';
import { env } from './src/lib/env';
import { attachSockets } from './src/ws';

/*
 * The Yieldfield server: the site and the /api routes (Next.js) and the /ws WebSocket on one port.
 * (On Vercel this file isn't used: Next.js runs the site and the API there, without the WebSocket.)
 *   npm run dev     on your computer (starts its own PostgreSQL when EMBEDDED_POSTGRES=true)
 *   npm start       in production, after npm run build
 */
const dev = !env.production;
const database = await startDatabase();
migrate();

const app = next({ dev, dir: ROOT, hostname: env.host, port: env.port });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(error);
    response.statusCode = 500;
    response.end('Server error');
  });
});
attachSockets(server, dev ? app.getUpgradeHandler() : undefined);
server.listen(env.port, env.host, () => {
  console.log(`[farm] http://localhost:${env.port}  (game WebSocket: ws://localhost:${env.port}/ws)`);
});

let closing = false;
async function shutdown() {
  if (closing) {
    return;
  }
  closing = true;
  console.log('[farm] stopping');
  server.close();
  await database?.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
