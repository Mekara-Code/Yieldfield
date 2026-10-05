import { prisma } from '../db';
import { activeWolfEvent } from '../events';
import { nowSeconds, publicFarm } from '../game/engine';
import type { Farm } from '../game/state';
import { json, problem } from '../http';
import { hub } from '../hub';
import { MapError } from './world';

/**
 * A map route's answer: the result, and the player's farm as the game takes it (state, wallet: as
 * POST /api/farm/act answers) when the map changed it (an attack's wounds, loot, a farm's price).
 */
export async function mapAnswer(userId: string, run: () => Promise<Record<string, unknown> & { farmState?: Farm | null }>) {
  try {
    const { farmState, ...result } = await run();
    if (!farmState) {
      return json(result);
    }
    const now = nowSeconds();
    const [event, user, row] = await Promise.all([
      activeWolfEvent(),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bloom: true, gems: true } }),
      prisma.farm.findUnique({ where: { userId }, select: { revision: true } }),
    ]);
    const state = publicFarm(farmState, now, event);
    const wallet = { coins: farmState.coins, bloom: user.bloom, gems: user.gems };
    hub.toUser(userId, { type: 'farm:update', revision: row?.revision ?? 0, state, wallet, now }, 'web');
    return json({ ...result, state, wallet, revision: row?.revision ?? 0, now });
  } catch (error) {
    if (error instanceof MapError) {
      return problem(error.status, error.message);
    }
    throw error;
  }
}
