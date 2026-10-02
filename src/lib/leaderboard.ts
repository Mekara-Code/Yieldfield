import { prisma } from './db';
import { isPlaying } from './presence';

/** The richest farms, with how many animals each keeps. */
export async function topFarms(take = 20) {
  const farms = await prisma.farm.findMany({
    where: { revision: { gt: 0 } },
    orderBy: [{ coins: 'desc' }, { day: 'asc' }],
    take,
    select: { coins: true, day: true, userId: true, updatedAt: true, user: { select: { username: true } }, _count: { select: { animals: true } } },
  });
  return farms.map((f, i) => ({
    rank: i + 1,
    username: f.user.username,
    coins: f.coins,
    day: f.day,
    animals: f._count.animals,
    playing: isPlaying(f.userId, f.updatedAt),
  }));
}
