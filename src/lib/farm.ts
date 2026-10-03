import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from './db';

/*
 * The game's save, as the game writes it (FFarmState in Source/MyProject/FarmTypes.h, turned to
 * JSON by Unreal: first letters lower-cased). Checked here so a broken or doctored save can't be
 * stored; fields the game adds later are kept.
 */
const ItemId = z.string().regex(/^[A-Za-z0-9_]{1,32}$/);
const Count = z.number().int().min(0).max(1_000_000);

export const PlotSchema = z.looseObject({
  index: z.number().int().min(0).max(255),
  state: z.number().int().min(0).max(8),
  crop: z.string().max(32),
  days: z.number().int().min(0).max(1000),
  bWatered: z.boolean(),
});

export const AnimalSchema = z.looseObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  kind: z.enum(['Chicken', 'Sheep', 'Cow']),
  name: z.string().min(1).max(40),
  boughtDay: z.number().int().min(0).max(1_000_000),
  lastMilkedDay: z.number().int().min(0).max(1_000_000),
  lastShornDay: z.number().int().min(0).max(1_000_000),
  // Since version 3.
  xp: z.number().int().min(0).max(100_000_000).optional(),
  lastFedDay: z.number().int().min(0).max(1_000_000).optional(),
});

export const FarmStateSchema = z.looseObject({
  version: z.number().int().min(1).max(1000),
  day: z.number().int().min(1).max(1_000_000),
  hour: z.number().min(0).max(30),
  coins: z.number().int().min(0).max(1_000_000_000),
  energy: z.number().min(0).max(1000),
  selected: z.string().max(32),
  seeds: z.record(ItemId, Count),
  produce: z.record(ItemId, Count),
  plots: z.array(PlotSchema).max(256),
  animals: z.array(AnimalSchema).max(100),
  eggsInCoop: Count,
  // Since version 2 (older games leave them out).
  companion: z.string().max(40).optional(),
  xp: z.number().int().min(0).max(100_000_000).optional(),
  ownedPlots: z.array(z.number().int().min(0).max(255)).max(256).optional(),
  buildings: z.array(z.string().regex(/^[A-Za-z0-9_]{1,24}$/)).max(32).optional(),
  creditsSeen: z.number().int().min(-100_000_000).max(1_000_000_000).optional(),
  // Since version 3: the daily tasks' progress (by task id) and what each trader bought, that (UTC) day.
  taskDay: z.string().max(10).optional(),
  taskProgress: z.record(z.string().max(8), Count).optional(),
  traderSales: z.record(z.string().max(16), Count).optional(),
});

export type FarmState = z.infer<typeof FarmStateSchema>;

export const FarmEventSchema = z.object({
  kind: z.string().regex(/^[a-z_]{1,32}$/),
  day: z.number().int().min(0).max(1_000_000),
  data: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
});

export type FarmEventInput = z.infer<typeof FarmEventSchema>;

export async function ensureFarm(userId: string) {
  return prisma.farm.upsert({ where: { userId }, update: {}, create: { userId } });
}

/** The farm; credits: BLOOM bought or granted all told (the game adds what's beyond state.creditsSeen). */
export async function loadFarm(userId: string) {
  const farm = await ensureFarm(userId);
  return { revision: farm.revision, updatedAt: farm.updatedAt.toISOString(), credits: farm.credits, state: (farm.state as FarmState | null) ?? null };
}

/** Stores a save: the whole state, the numbers the site lists, and the animals, in one go. */
export async function saveFarm(userId: string, state: FarmState) {
  const farm = await ensureFarm(userId);
  return prisma.$transaction(async (tx) => {
    const saved = await tx.farm.update({
      where: { id: farm.id },
      data: { revision: { increment: 1 }, day: state.day, coins: state.coins, state: state as unknown as Prisma.InputJsonValue },
    });
    const ids = state.animals.map((a) => a.id);
    await tx.animal.deleteMany({ where: { farmId: farm.id, id: { notIn: ids } } });
    for (const a of state.animals) {
      const fields = { kind: a.kind, name: a.name, boughtDay: a.boughtDay, lastMilkedDay: a.lastMilkedDay, lastShornDay: a.lastShornDay, xp: a.xp ?? 0 };
      await tx.animal.upsert({ where: { id: a.id }, update: fields, create: { id: a.id, farmId: farm.id, ...fields } });
    }
    return { revision: saved.revision, updatedAt: saved.updatedAt.toISOString(), credits: saved.credits };
  });
}

export async function recordEvent(userId: string, event: FarmEventInput) {
  const row = await prisma.farmEvent.create({ data: { userId, kind: event.kind, day: event.day, data: event.data } });
  return publicEvent(row);
}

export function publicEvent(row: { id: bigint; kind: string; day: number; data: unknown; createdAt: Date }) {
  return { id: row.id.toString(), kind: row.kind, day: row.day, data: row.data, at: row.createdAt.toISOString() };
}

export async function recentEvents(userId: string, take = 40) {
  const rows = await prisma.farmEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
  return rows.map(publicEvent);
}
