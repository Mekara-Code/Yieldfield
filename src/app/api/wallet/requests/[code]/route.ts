import { issueTokens } from '../../../../../lib/auth';
import { prisma } from '../../../../../lib/db';
import { json, problem } from '../../../../../lib/http';
import { shortAddress } from '../../../../../lib/wallets';

export const runtime = 'nodejs';

/** How the request stands: pending, done (signed: the wallet), expired. A done login request signs the game in, once. */
export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const request = await prisma.walletRequest.findUnique({ where: { code } });
  if (!request) {
    return problem(404, 'No such request');
  }
  const expired = request.status === 'pending' && request.expiresAt < new Date();
  const out = {
    status: expired ? 'expired' : request.status,
    mode: request.mode,
    short: request.short,
    chain: request.chain,
    address: request.address,
    shortAddress: request.address ? shortAddress(request.address) : null,
    expiresAt: request.expiresAt.toISOString(),
  };
  if (request.status !== 'done' || request.mode !== 'login' || !request.userId) {
    return json(out);
  }
  // Collected once: the code alone can't sign in again.
  const taken = await prisma.walletRequest.updateMany({ where: { code, usedAt: null }, data: { usedAt: new Date() } });
  if (taken.count === 0) {
    return json({ ...out, status: 'used' });
  }
  const user = await prisma.user.update({ where: { id: request.userId }, data: { lastLoginAt: new Date() } });
  return json({ ...out, ...(await issueTokens(user, 'game')) });
}
