import { prisma } from '../../../../lib/db';
import { json, problem } from '../../../../lib/http';
import { messageFor } from '../../../../lib/wallets';

export const runtime = 'nodejs';

/** For the website's wallet page: what to sign for a request (and whose farm a link is for). */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code') ?? '';
  const found = await prisma.walletRequest.findUnique({ where: { code } });
  if (!found) {
    return problem(404, 'This link isn\'t valid: start again from the game');
  }
  const owner = found.userId ? await prisma.user.findUnique({ where: { id: found.userId }, select: { username: true } }) : null;
  return json({
    mode: found.mode,
    short: found.short,
    status: found.status === 'pending' && found.expiresAt < new Date() ? 'expired' : found.status,
    message: messageFor(found),
    nonce: found.nonce,
    expiresAt: found.expiresAt.toISOString(),
    username: owner?.username ?? null,
  });
}
