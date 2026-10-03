import { authenticate } from '../../../lib/auth';
import { prisma } from '../../../lib/db';
import { isServerFarm, withDefaults } from '../../../lib/game/state';
import { json, problem } from '../../../lib/http';
import { browse } from '../../../lib/market';
import { sourceOf, STANDING_SELECT } from '../../../lib/reputation';

export const runtime = 'nodejs';

/** The market: what's on sale (by thing), the player's own listings, the going prices of what they could sell. */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const [user, farm] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: claims.userId }, select: { ...STANDING_SELECT, bloom: true } }),
    prisma.farm.findUnique({ where: { userId: claims.userId }, select: { state: true } }),
  ]);
  const state = farm && isServerFarm(farm.state) ? withDefaults(farm.state) : null;
  return json({ ...(await browse(claims.userId, sourceOf(user), state)), bloom: user.bloom });
}
