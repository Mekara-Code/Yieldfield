import { prisma } from './db';
import type { Prisma } from '../generated/prisma/client';
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
 * Takes BLOOM from a farm for something bought on the server: through the farm's credits (the game
 * takes it off its coins the next time it loads or saves, exactly once). What it can spend: the coins
 * in its last save, plus credits it hasn't seen yet.
 */
export async function spendBloom(tx: Prisma.TransactionClient, userId: string, amount: number, kind: string, data: Record<string, string | number>): Promise<{ error: string } | { credits: number }> {
  const farm = await tx.farm.findUnique({ where: { userId } });
  const state = (farm?.state ?? null) as { coins?: number; creditsSeen?: number } | null;
  const credits = farm?.credits ?? 0;
  const available = (state?.coins ?? 0) + credits - (state?.creditsSeen ?? 0);
  if (available < amount) {
    return { error: `You need ${amount} BLOOM (you have ${available})` };
  }
  const updated = await tx.farm.upsert({ where: { userId }, update: { credits: { decrement: amount } }, create: { userId, credits: -amount } });
  await tx.farmEvent.create({ data: { userId, kind, day: 0, data: { ...data, cost: amount } } });
  return { credits: updated.credits };
}

/**
 * Becomes the other character: free the first time (accounts from before there was a choice), then
 * CHARACTER_CHANGE_PRICE BLOOM (spendBloom).
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
    const spent = await spendBloom(tx, userId, CHARACTER_CHANGE_PRICE, 'character', { from: user.character, to: character });
    if ('error' in spent) {
      return { error: spent.error.replace(' BLOOM', ' BLOOM to change') };
    }
    await tx.user.update({ where: { id: userId }, data: { character } });
    return { character, charged: CHARACTER_CHANGE_PRICE, credits: spent.credits };
  });
}
