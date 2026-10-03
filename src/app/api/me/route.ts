import { authenticate } from '../../../lib/auth';
import { prisma } from '../../../lib/db';
import { json, problem } from '../../../lib/http';
import { isAdmin } from '../../../lib/players';
import { isPlaying } from '../../../lib/presence';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const user = await prisma.user.findUnique({ where: { id: claims.userId }, include: { farm: { select: { day: true, coins: true, revision: true, updatedAt: true, credits: true } } } });
  if (!user) {
    return problem(401, 'No such player');
  }
  return json({
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    character: user.character,
    admin: await isAdmin(claims),
    farm: user.farm && { day: user.farm.day, coins: user.farm.coins, revision: user.farm.revision, credits: user.farm.credits },
    playing: isPlaying(user.id, user.farm?.updatedAt),
  });
}
