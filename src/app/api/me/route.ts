import { authenticate } from '../../../lib/auth';
import { prisma } from '../../../lib/db';
import { json, problem } from '../../../lib/http';
import { isAdmin } from '../../../lib/players';
import { isPlaying } from '../../../lib/presence';
import { shortAddress } from '../../../lib/wallets';
import { sourceOf, standing, STANDING_SELECT } from '../../../lib/reputation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!claims) {
    return problem(401, 'Not signed in');
  }
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    include: {
      farm: { select: { day: true, coins: true, revision: true, updatedAt: true } },
      wallets: { select: { id: true, chain: true, address: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      _count: { select: { wallets: true } },
    },
  });
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
    farm: user.farm && { day: user.farm.day, coins: user.farm.coins, revision: user.farm.revision },
    wallet: { coins: user.farm?.coins ?? 0, bloom: user.bloom, gems: user.gems },
    playing: isPlaying(user.id, user.farm?.updatedAt),
    standing: await standing(sourceOf(user)),
    // What ties the farm to its player (each gives reputation).
    wallets: user.wallets.map((w) => ({ id: w.id, chain: w.chain, address: w.address, short: shortAddress(w.address), linkedAt: w.createdAt.toISOString() })),
    discord: user.discordId ? { id: user.discordId, name: user.discordName, avatar: user.discordAvatar, linkedAt: user.discordLinkedAt?.toISOString() ?? null } : null,
  });
}
