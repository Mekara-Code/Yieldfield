import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { verifyAccessToken } from './lib/auth';
import { FarmEventSchema, recordEvent } from './lib/farm';
import { type Connection, hub, send } from './lib/hub';

/*
 * The live line to the game and the dashboards, at /ws. Messages are JSON objects with a "type".
 *
 * First the client signs in:   { type: "auth", token: <access token>, client: "game" | "web" }
 *                        ->    { type: "auth:ok", user: { id, username }, online }   (or auth:error, and closed)
 * The game then sends:
 *   { type: "farm:save" } is refused: the server keeps the farm (POST /api/farm/act)
 *   { type: "farm:event", event: { kind, day, data } }
 *   { type: "ping" }                    ->  { type: "pong" }
 * and the player's dashboards hear farm:update (with the state) and farm:event as it happens.
 * Everyone hears { type: "presence", online } when a player comes or goes, and a game signed in
 * a second time gets { type: "session:replaced" } on the first.
 */

const AuthMessage = z.object({ type: z.literal('auth'), token: z.string().min(10).max(2000), client: z.enum(['game', 'web']).default('game') });
const EventMessage = z.object({ type: z.literal('farm:event'), event: FarmEventSchema });

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;

type Upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export function attachSockets(server: Server, fallback?: Upgrade) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    } else if (fallback) {
      fallback(request, socket, head); // Next's own (hot reload in development)
    } else {
      socket.destroy();
    }
  });

  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws) => {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    let connection: Connection | null = null;
    const authTimer = setTimeout(() => {
      if (!connection) {
        send(ws, { type: 'auth:error', message: 'Sign in first' });
        ws.close(4000, 'no auth');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', async (data: RawData) => {
      let message: { type?: unknown; rid?: unknown };
      try {
        message = JSON.parse(data.toString());
      } catch {
        send(ws, { type: 'error', message: 'Messages must be JSON' });
        return;
      }
      try {
        if (!connection) {
          const auth = AuthMessage.safeParse(message);
          const claims = auth.success ? await verifyAccessToken(auth.data.token) : null;
          if (!auth.success || !claims) {
            send(ws, { type: 'auth:error', message: 'Your sign-in has expired' });
            ws.close(4003, 'bad token');
            return;
          }
          clearTimeout(authTimer);
          connection = { socket: ws, userId: claims.userId, username: claims.username, client: auth.data.client };
          hub.add(connection);
          send(ws, { type: 'auth:ok', user: { id: claims.userId, username: claims.username }, online: hub.playersOnline() });
          return;
        }
        switch (message.type) {
          case 'ping':
            send(ws, { type: 'pong' });
            return;
          case 'farm:save':
            // The server keeps the farm now (POST /api/farm/act): a game that still saves it is out of date.
            send(ws, { type: 'error', rid: message.rid, message: 'The farm is kept by the server now: update the game' });
            return;
          case 'farm:event': {
            const parsed = EventMessage.safeParse(message);
            if (!parsed.success) {
              send(ws, { type: 'error', message: 'Bad event' });
              return;
            }
            const event = await recordEvent(connection.userId, parsed.data.event);
            hub.toUser(connection.userId, { type: 'farm:event', event }, 'web');
            return;
          }
          default:
            send(ws, { type: 'error', message: `Unknown message ${String(message.type)}` });
        }
      } catch (error) {
        console.error('[ws]', error);
        send(ws, { type: 'error', rid: message.rid, message: 'Server error' });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (connection) {
        hub.remove(connection);
      }
    });
    ws.on('error', () => ws.terminate());
  });
  return wss;
}
