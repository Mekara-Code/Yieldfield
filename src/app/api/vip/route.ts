import { z } from 'zod';
import { authenticate } from '../../../lib/auth';
import { json, problem, readBody } from '../../../lib/http';
import { buyVip, standingOf } from '../../../lib/reputation';

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

/** Buys a VIP plan with BLOOM (from the farm's credits); its days add to any VIP still running. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const result = await buyVip(claims.userId, body.data.plan);
  if ('error' in result) {
    return problem(result.status, result.error);
  }
  return json(result);
}
