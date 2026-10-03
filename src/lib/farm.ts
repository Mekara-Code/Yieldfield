import { z } from 'zod';
import { prisma } from './db';

/*
 * The farm itself is kept and changed by the server (src/lib/game); this is its activity feed.
 */
export const FarmEventSchema = z.object({
  kind: z.string().regex(/^[a-z_]{1,32}$/),
  day: z.number().int().min(0).max(1_000_000),
  data: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
});

export type FarmEventInput = z.infer<typeof FarmEventSchema>;

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
