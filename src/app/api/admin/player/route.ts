import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { json, problem, readBody } from '../../../../lib/http';
import { isAdmin } from '../../../../lib/players';
import { adjustPlayer } from '../../../../lib/reputation';

export const runtime = 'nodejs';

const Body = z.object({
  username: z.string().trim().min(1).max(40),
  vipDays: z.number().int().min(-3650).max(3650).optional(),
  reputation: z.number().int().min(-1_000_000).max(1_000_000).optional(),
});

/** Gives a player VIP days or reputation (negative takes them away). */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims || !(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const result = await adjustPlayer(body.data.username, body.data, claims.username);
  return result ? json(result) : problem(404, 'No such player');
}
