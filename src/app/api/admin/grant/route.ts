import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { json, problem, readBody } from '../../../../lib/http';
import { isAdmin } from '../../../../lib/players';
import { grant, ShopError } from '../../../../lib/shop';

export const runtime = 'nodejs';

const Body = z.object({
  username: z.string().trim().min(1).max(40),
  amount: z.number().int().min(-1_000_000).max(1_000_000),
  currency: z.enum(['bloom', 'gems']).default('bloom'),
});

/** Gives a player BLOOM or gems (or takes them, negative), written in the books. */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims || !(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  try {
    const user = await grant(body.data.username, body.data.amount, claims.username, body.data.currency);
    return json({ ok: true, username: user.username, bloom: user.bloom, gems: user.gems });
  } catch (error) {
    return problem(error instanceof ShopError ? error.status : 500, (error as Error).message);
  }
}
