import { prisma } from '../../../lib/db';
import { json } from '../../../lib/http';
import { playersOnline, realtime } from '../../../lib/presence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The game asks this before showing its sign-in screen, and to know whether to open a WebSocket (realtime). */
export async function GET() {
  let database = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = false;
  }
  const online = database ? await playersOnline() : 0;
  return json({ ok: database, service: 'yieldfield', database, realtime, online }, database ? 200 : 503);
}
