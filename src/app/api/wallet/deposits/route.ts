import { authenticate } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { json, problem } from '../../../../lib/http';
import { scanDeposits } from '../../../../lib/wallets';

export const runtime = 'nodejs';

/** Looks for payments from the player's linked wallets to the shop's wallets and credits them (each once). */
export async function POST(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const credited = await scanDeposits(claims.userId);
  const user = await prisma.user.findUnique({ where: { id: claims.userId }, select: { bloom: true } });
  return json({ credited, balance: user?.bloom ?? 0 });
}
