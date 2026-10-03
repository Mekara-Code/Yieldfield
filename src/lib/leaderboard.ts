import { prisma } from './db';
import { levelForXp } from './game/defs';
import { isPlaying } from './presence';

/** The richest farms (in coins), with their level and how many animals each keeps. */
export async function topFarms(take = 20) {
  const farms = await prisma.farm.findMany({
    where: { revision: { gt: 0 } },
    orderBy: [{ coins: 'desc' }, { day: 'asc' }],
    take,
    select: { coins: true, day: true, state: true, userId: true, updatedAt: true, user: { select: { username: true } } },
  });
  return farms.map((f, i) => {
    const state = (f.state ?? {}) as { xp?: number; animals?: unknown[] };
    return {
      rank: i + 1,
      username: f.user.username,
      coins: f.coins,
      day: f.day,
      level: levelForXp(Number(state.xp ?? 0)),
      animals: Array.isArray(state.animals) ? state.animals.length : 0,
      playing: isPlaying(f.userId, f.updatedAt),
    };
  });
}
