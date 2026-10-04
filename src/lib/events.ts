import { prisma } from './db';
import { DEFAULT_WOLF, type WolfSettings } from './game/defs';
import type { WolfEventCtx } from './game/rules';

/**
 * The admins' events (the GameEvent table, /admin/events): for now "wolf", a wolf loose on every farm
 * from startsAt to endsAt. Each event keeps its wolf's power and health (set from the admins' wolf settings
 * when it's made, changeable after); each farm's wolf (the damage it has taken, whether it's dead) is in
 * the farm (Farm.state.wolf). The event on now is read with every action, kept a few seconds.
 */

export const WOLF_KIND = 'wolf';

export async function wolfSettings(): Promise<WolfSettings> {
  const row = await prisma.setting.findUnique({ where: { key: 'wolf' } });
  const saved = (row?.value ?? {}) as Partial<WolfSettings>;
  return { ...DEFAULT_WOLF, ...saved };
}

export async function saveWolfSettings(settings: WolfSettings) {
  await prisma.setting.upsert({ where: { key: 'wolf' }, update: { value: { ...settings } }, create: { key: 'wolf', value: { ...settings } } });
  forget();
}

type EventRow = { id: string; kind: string; startsAt: Date; endsAt: Date; power: number; health: number; note: string | null; createdBy: string; createdAt: Date; cancelledAt: Date | null };

export function eventCtx(row: EventRow): WolfEventCtx {
  return { id: row.id, power: row.power, health: row.health, startsAt: Math.floor(row.startsAt.getTime() / 1000), endsAt: Math.floor(row.endsAt.getTime() / 1000) };
}

let cache: { at: number; event: WolfEventCtx | null } | null = null;
const CACHE_MS = 5000;

/** Forgets the event on now (after an admin changed one), so the next action reads it again. */
export function forget() {
  cache = null;
}

/** The wolf event on now (the latest started, if two overlap), or null. */
export async function activeWolfEvent(): Promise<WolfEventCtx | null> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.at < CACHE_MS && (!cache.event || cache.event.endsAt * 1000 > nowMs)) {
    return cache.event;
  }
  const now = new Date(nowMs);
  const row = await prisma.gameEvent.findFirst({
    where: { kind: WOLF_KIND, cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: 'desc' },
  });
  const event = row ? eventCtx(row) : null;
  cache = { at: nowMs, event };
  return event;
}

/** The next wolf event to come, for the site and the game's notice board. */
export async function nextWolfEvent() {
  const now = new Date();
  const row = await prisma.gameEvent.findFirst({ where: { kind: WOLF_KIND, cancelledAt: null, startsAt: { gt: now } }, orderBy: { startsAt: 'asc' } });
  return row ? eventCtx(row) : null;
}

export type EventStatus = 'upcoming' | 'live' | 'over' | 'cancelled';

export function statusOf(row: EventRow, now = new Date()): EventStatus {
  if (row.cancelledAt) {
    return 'cancelled';
  }
  if (row.startsAt > now) {
    return 'upcoming';
  }
  return row.endsAt > now ? 'live' : 'over';
}

/** Events for the admin page (newest first), each with what happened on the farms: wolves killed, farmers killed. */
export async function listEvents(take = 60) {
  const rows = await prisma.gameEvent.findMany({ orderBy: { startsAt: 'desc' }, take });
  const counts = rows.length
    ? await prisma.$queryRaw<{ event: string; kind: string; n: bigint; players: bigint }[]>`
        SELECT "data"->>'event' AS event, kind, COUNT(*) AS n, COUNT(DISTINCT "userId") AS players
        FROM "FarmEvent"
        WHERE kind IN ('wolf_killed', 'killed') AND "data"->>'event' = ANY(${rows.map((r) => r.id)})
        GROUP BY 1, 2`
    : [];
  const stat = (id: string, kind: string) => counts.find((c) => c.event === id && c.kind === kind);
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    power: r.power,
    health: r.health,
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    status: statusOf(r, now),
    wolvesKilled: Number(stat(r.id, 'wolf_killed')?.n ?? 0),
    farmersKilled: Number(stat(r.id, 'killed')?.n ?? 0),
    farmersKilledPlayers: Number(stat(r.id, 'killed')?.players ?? 0),
  }));
}

export async function createEvent(input: { startsAt: Date; endsAt: Date; power: number; health: number; note?: string; createdBy: string }) {
  const row = await prisma.gameEvent.create({ data: { kind: WOLF_KIND, ...input, note: input.note || null } });
  forget();
  return row;
}

export async function updateEvent(id: string, change: { power?: number; health?: number; startsAt?: Date; endsAt?: Date; note?: string | null; cancel?: boolean; endNow?: boolean }) {
  const row = await prisma.gameEvent.findUnique({ where: { id } });
  if (!row) {
    return null;
  }
  const now = new Date();
  const data: Record<string, unknown> = {};
  if (change.power !== undefined) data.power = change.power;
  if (change.health !== undefined) data.health = change.health;
  if (change.startsAt) data.startsAt = change.startsAt;
  if (change.endsAt) data.endsAt = change.endsAt;
  if (change.note !== undefined) data.note = change.note || null;
  if (change.cancel) data.cancelledAt = now;
  if (change.endNow) data.endsAt = row.startsAt > now ? row.startsAt : now;
  const updated = await prisma.gameEvent.update({ where: { id }, data });
  forget();
  return updated;
}
