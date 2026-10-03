import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticate } from '../../../lib/auth';
import { performAction } from '../../../lib/game/engine';
import { json, problem, readBody } from '../../../lib/http';
import { standingOf } from '../../../lib/reputation';

export const runtime = 'nodejs';

/** The player's standing: reputation, tier, VIP, and the VIP plans. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  return json(await standingOf(claims.userId));
}

const Body = z.object({ plan: z.string().regex(/^[a-z0-9_-]{1,24}$/) });

/** Buys a VIP plan with the player's BLOOM (the game does it as an action: POST /api/farm/act buy_vip). */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const result = await performAction(claims.userId, randomUUID(), { type: 'buy_vip', plan: body.data.plan });
  return json(result.body, result.status);
}
