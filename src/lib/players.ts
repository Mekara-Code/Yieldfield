import { prisma } from './db';
import type { AccessClaims } from './auth';

/** Who one can play: the woman and the man (the game's PlayerCharacters, Config/DefaultGame.ini). */
export const CHARACTERS = ['Diana', 'Arash'] as const;
export type CharacterName = (typeof CHARACTERS)[number];
/** BLOOM it costs to become the other one once chosen. */
export const CHARACTER_CHANGE_PRICE = 500;

export function isCharacter(name: unknown): name is CharacterName {
  return typeof name === 'string' && (CHARACTERS as readonly string[]).includes(name);
}

/** The names in ADMIN_USERNAMES (comma-separated) are admins as well as those flagged in the database. */
export async function isAdmin(claims: AccessClaims | null) {
  if (!claims) {
    return false;
  }
  const names = (process.env.ADMIN_USERNAMES ?? '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (names.includes(claims.username.toLowerCase())) {
    return true;
  }
  const user = await prisma.user.findUnique({ where: { id: claims.userId }, select: { isAdmin: true } });
  return !!user?.isAdmin;
}

/**
 * Becomes the other character: free the first time (accounts from before there was a choice), then
 * CHARACTER_CHANGE_PRICE BLOOM, taken through the farm's credits (the game takes it off its coins
 * the next time it loads or saves, exactly once).
 */
export async function changeCharacter(userId: string, character: CharacterName) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { farm: true } });
    if (user.character === character) {
      return { character, charged: 0, credits: user.farm?.credits ?? 0 };
    }
    if (!user.character) {
      await tx.user.update({ where: { id: userId }, data: { character } });
      return { character, charged: 0, credits: user.farm?.credits ?? 0 };
    }
    const state = (user.farm?.state ?? null) as { coins?: number; creditsSeen?: number } | null;
    const credits = user.farm?.credits ?? 0;
    const available = (state?.coins ?? 0) + credits - (state?.creditsSeen ?? 0);
    if (available < CHARACTER_CHANGE_PRICE) {
      return { error: `You need ${CHARACTER_CHANGE_PRICE} BLOOM to change (you have ${available})` as const };
    }
    const farm = await tx.farm.upsert({ where: { userId }, update: { credits: { decrement: CHARACTER_CHANGE_PRICE } }, create: { userId, credits: -CHARACTER_CHANGE_PRICE } });
    await tx.user.update({ where: { id: userId }, data: { character } });
    await tx.farmEvent.create({ data: { userId, kind: 'character', day: 0, data: { from: user.character, to: character, cost: CHARACTER_CHANGE_PRICE } } });
    return { character, charged: CHARACTER_CHANGE_PRICE, credits: farm.credits };
  });
}
