import { z } from 'zod';
import { authenticate } from '../../../lib/auth';
import { prisma } from '../../../lib/db';
import { json, problem, readBody } from '../../../lib/http';
import { CHARACTER_NAMES, changeCharacter, characterChoices } from '../../../lib/players';

export const runtime = 'nodejs';

const Body = z.object({ character: z.enum(CHARACTER_NAMES) });

/** The characters, and what becoming each would cost the player in gems. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: claims.userId }, select: { character: true, gems: true } });
  return json({ ...characterChoices(user.character), gems: user.gems });
}

/** Becomes another character: free the first time, then gems (more for the other gender). */
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
    return problem(402, result.error!, { price: result.price });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: claims.userId }, select: { bloom: true, gems: true } });
  return json({ ...result, wallet: { bloom: user.bloom, gems: user.gems } });
}
