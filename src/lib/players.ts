import { spendCurrency } from './currency';
import { CHARACTER_CHANGE_GEMS, CHARACTERS, GENDER_CHANGE_GEMS } from './game/defs';
import { prisma } from './db';
import type { Prisma } from '../generated/prisma/client';
import type { AccessClaims } from './auth';

// Who one can play, and what changing costs (src/lib/game/defs.ts).
export { CHARACTERS, CHARACTER_CHANGE_GEMS, GENDER_CHANGE_GEMS };
export type CharacterName = (typeof CHARACTERS)[number]['name'];
export const CHARACTER_NAMES = CHARACTERS.map((c) => c.name) as [CharacterName, ...CharacterName[]];

export function isCharacter(name: unknown): name is CharacterName {
  return typeof name === 'string' && (CHARACTER_NAMES as readonly string[]).includes(name);
}

export function genderOf(name: string | null | undefined) {
  return CHARACTERS.find((c) => c.name === name)?.gender ?? null;
}

/** Gems it costs to go from one character to another (0: the first choice, or no change). */
export function changePrice(from: string | null, to: string) {
  if (!from || from === to) {
    return 0;
  }
  return genderOf(from) === genderOf(to) ? CHARACTER_CHANGE_GEMS : GENDER_CHANGE_GEMS;
}

/** The characters with what each would cost this player, for the game and the site. */
export function characterChoices(current: string | null) {
  return {
    current,
    characterChangeGems: CHARACTER_CHANGE_GEMS,
    genderChangeGems: GENDER_CHANGE_GEMS,
    characters: CHARACTERS.map((c) => ({ name: c.name, gender: c.gender, price: changePrice(current, c.name) })),
  };
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

/** Takes BLOOM from the player for something bought on the server (written in the books); an error if they haven't that much. */
export async function spendBloom(tx: Prisma.TransactionClient, userId: string, amount: number, kind: string, data: Record<string, string | number>): Promise<{ error: string } | { bloom: number }> {
  const user = await spendCurrency(tx, userId, 'bloom', amount, kind, data);
  if (!user) {
    const have = await tx.user.findUnique({ where: { id: userId }, select: { bloom: true } });
    return { error: `You need ${amount} BLOOM (you have ${have?.bloom ?? 0})` };
  }
  await tx.farmEvent.create({ data: { userId, kind, day: 0, data: { ...data, cost: amount } } });
  return { bloom: user.bloom };
}

/**
 * Becomes another character: free the first time (accounts from before there was a choice), then gems
 * (changePrice: more for the other gender), in one transaction. A husband or wife becomes one of the
 * other gender again if the player changed gender.
 */
export async function changeCharacter(userId: string, character: CharacterName) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.character === character) {
      return { character, charged: 0, gems: user.gems };
    }
    const price = changePrice(user.character, character);
    let gems = user.gems;
    if (price > 0) {
      const spent = await spendCurrency(tx, userId, 'gems', price, 'character', { from: user.character ?? '', to: character });
      if (!spent) {
        return { error: `${genderOf(user.character) === genderOf(character) ? 'Another character' : 'The other gender'} takes ${price} gems (you have ${user.gems})`, price };
      }
      gems = spent.gems;
      await tx.farmEvent.create({ data: { userId, kind: 'character', day: 0, data: { from: user.character ?? '', to: character, gems: price } } });
    }
    await tx.user.update({ where: { id: userId }, data: { character } });
    if (user.character && genderOf(user.character) !== genderOf(character)) {
      const farm = await tx.farm.findUnique({ where: { userId } });
      const state = farm?.state as { companion?: string } | null;
      if (farm && state?.companion) {
        state.companion = genderOf(character) === 'female' ? 'Arash' : 'Diana';
        await tx.farm.update({ where: { id: farm.id }, data: { state: state as object, revision: { increment: 1 } } });
      }
    }
    return { character, charged: price, gems };
  });
}
