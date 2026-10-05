import { hashPassword, issueTokens } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { clientAddress, problem, rateLimited, readBody, RegisterBody, tokensResponse } from '../../../../lib/http';
import { inviterFor } from '../../../../lib/referrals';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (rateLimited(`auth:${clientAddress(request)}`)) {
    return problem(429, 'Too many attempts, try again in a few minutes');
  }
  const body = await readBody(request, RegisterBody);
  if ('response' in body) {
    return body.response;
  }
  const { username, email, password, client, character, ref } = body.data;
  const taken = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: username, mode: 'insensitive' } }, { email }] },
    select: { email: true },
  });
  if (taken) {
    return problem(409, taken.email === email ? 'That email already has an account' : 'That name is taken');
  }
  // Invited by someone (not themselves): it counts for that farmer's rewards (src/lib/referrals.ts).
  const inviter = await inviterFor(ref);
  const invited = inviter && inviter.username.toLowerCase() !== username.toLowerCase() ? { referredById: inviter.id, referredAt: new Date() } : {};
  try {
    const user = await prisma.user.create({
      data: { username, email, passwordHash: await hashPassword(password), lastLoginAt: new Date(), character: character ?? null, farm: { create: {} }, ...invited },
    });
    return tokensResponse(await issueTokens(user, client), client, 201);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return problem(409, 'That name or email is taken');
    }
    throw error;
  }
}
