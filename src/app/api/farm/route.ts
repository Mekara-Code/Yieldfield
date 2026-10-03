import { z } from 'zod';
import { authenticate } from '../../../lib/auth';
import { FarmStateSchema, loadFarm, saveFarm } from '../../../lib/farm';
import { json, problem, readBody } from '../../../lib/http';
import { hub } from '../../../lib/hub';
import { checkOpenOrders } from '../../../lib/shop';

export const runtime = 'nodejs';

/** The player's farm: { revision, updatedAt, state } (state null on a farm never saved). */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  // A pack paid for while the game was closed is credited now (bounded, so the farm still loads if a chain is slow).
  await Promise.race([checkOpenOrders(claims.userId), new Promise((resolve) => setTimeout(resolve, 4000))]);
  return json(await loadFarm(claims.userId));
}

/** Saves the farm (the game saves over its WebSocket; this is the same by plain HTTP). */
export async function PUT(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, z.object({ state: FarmStateSchema }));
  if ('response' in body) {
    return body.response;
  }
  const saved = await saveFarm(claims.userId, body.data.state);
  hub.toUser(claims.userId, { type: 'farm:update', ...saved, state: body.data.state }, 'web');
  return json(saved);
}
