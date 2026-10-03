import { authenticate } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { json, problem } from '../../../../lib/http';

export const runtime = 'nodejs';

/** Unlinks a wallet (an account made with that wallet alone keeps at least one). */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const { id } = await context.params;
  const user = await prisma.user.findUnique({ where: { id: claims.userId }, include: { wallets: true } });
  const wallet = user?.wallets.find((w) => w.id === id);
  if (!user || !wallet) {
    return problem(404, 'No such wallet');
  }
  if (!user.passwordHash && user.wallets.length <= 1) {
    return problem(409, 'This is the only way into your farm: link another wallet first');
  }
  await prisma.wallet.delete({ where: { id } });
  return json({ ok: true });
}
