import { z } from 'zod';
import { authenticate } from '../../../lib/auth';
import { json, problem, readBody } from '../../../lib/http';
import { CHARACTER_CHANGE_PRICE, changeCharacter } from '../../../lib/players';

export const runtime = 'nodejs';

const Body = z.object({ character: z.enum(['Diana', 'Arash']) });

/** Becomes the other character: free the first time, then CHARACTER_CHANGE_PRICE BLOOM (taken from the farm's credits). */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const result = await changeCharacter(claims.userId, body.data.character);
  if ('error' in result) {
    return problem(402, result.error!, { price: CHARACTER_CHANGE_PRICE });
  }
  return json({ ...result, price: CHARACTER_CHANGE_PRICE });
}
