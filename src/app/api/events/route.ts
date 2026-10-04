import { activeWolfEvent, nextWolfEvent } from '../../../lib/events';
import { json } from '../../../lib/http';

export const runtime = 'nodejs';

/** The wolf event on now and the next one (times in Unix seconds), for the site and the game. */
export async function GET() {
  const [live, next] = await Promise.all([activeWolfEvent(), nextWolfEvent()]);
  return json({ wolf: live, next, now: Math.floor(Date.now() / 1000) });
}
