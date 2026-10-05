import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { startGame } from '../../../../lib/game/engine';
import { json, problem, readBody } from '../../../../lib/http';
import { ensureHome } from '../../../../lib/map/world';

export const runtime = 'nodejs';

const Body = z.object({ plots: z.array(z.number().int().min(0).max(255)).min(1).max(64), starter: z.number().int().min(0).max(255) });

/** A new farm on the level's beds (the one nearest the start owned and dug); the farm already there, if there is one. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const game = await startGame(claims.userId, body.data.plots, body.data.starter);
  const home = await ensureHome(claims.userId).catch(() => null);
  return json({ ...game, mapHome: home && { name: home.name, x: home.x, y: home.y } });
}
