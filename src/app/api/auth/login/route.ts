import { checkPassword, hashPassword, issueTokens } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { clientAddress, LoginBody, problem, rateLimited, readBody, tokensResponse } from '../../../../lib/http';

export const runtime = 'nodejs';

// Compared against when there is no such player, so a wrong name takes as long as a wrong password.
let nobody: Promise<string> | undefined;

export async function POST(request: Request) {
  if (rateLimited(`auth:${clientAddress(request)}`)) {
    return problem(429, 'Too many attempts, try again in a few minutes');
  }
  const body = await readBody(request, LoginBody);
  if ('response' in body) {
    return body.response;
  }
  const { login, password, client } = body.data;
  const user = await prisma.user.findFirst({
    where: login.includes('@') ? { email: login.toLowerCase() } : { username: { equals: login, mode: 'insensitive' } },
  });
  const ok = await checkPassword(password, user?.passwordHash ?? (await (nobody ??= hashPassword('nobody at all'))));
  if (!user || !ok) {
    return problem(401, 'Wrong name or password');
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return tokensResponse(await issueTokens(user, client), client);
}
