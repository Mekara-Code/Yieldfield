import { createHash } from 'node:crypto';
import { prisma } from './db';
import type { FarmState } from './farm';
import { isVip, standing, VIP_PERKS } from './reputation';

/**
 * Each player's daily tasks: a few things to do that (UTC) day, made at their first look from what
 * their farm can do then (its level, beds and animals), the same all day. Deliveries go to the
 * farm's traders (the game's AFarmTrader: Gus the grocer, Hattie the egg lady, Molly the dairy
 * maid, Bruno the butcher); the rest is farm work. The game counts the progress and claims each
 * one done: the experience goes to the farm (the game adds it), the reputation to the player (here,
 * once per task: a doctored game can't take more than the day's tasks give).
 */

export type TaskKind = 'deliver' | 'water' | 'plant' | 'harvest' | 'milk' | 'shear' | 'eggs' | 'sell' | 'feed';
export type Trader = 'Gus' | 'Hattie' | 'Molly' | 'Bruno';

export interface Task {
  id: string;
  kind: TaskKind;
  count: number;
  /** For a delivery: what, and to whom. */
  item?: string;
  trader?: Trader;
  title: string;
  xp: number;
  reputation: number;
}

export const BASE_TASKS = 3;

const CROPS: { id: string; level: number; yield: number; plural: string }[] = [
  { id: 'Carrot', level: 1, yield: 4, plural: 'carrots' },
  { id: 'Wheat', level: 1, yield: 5, plural: 'wheat' },
  { id: 'Sunflower', level: 3, yield: 4, plural: 'sunflowers' },
  { id: 'Tomato', level: 5, yield: 5, plural: 'tomatoes' },
  { id: 'Corn', level: 7, yield: 4, plural: 'corn cobs' },
  { id: 'Pumpkin', level: 9, yield: 2, plural: 'pumpkins' },
];

// Experience: a base and so much a piece (then scaled by the level); reputation per task.
const REWARD: Record<TaskKind, { base: number; per: number; reputation: number }> = {
  deliver: { base: 20, per: 4, reputation: 10 },
  water: { base: 10, per: 3, reputation: 6 },
  plant: { base: 10, per: 3, reputation: 6 },
  harvest: { base: 10, per: 6, reputation: 6 },
  milk: { base: 10, per: 6, reputation: 7 },
  shear: { base: 10, per: 10, reputation: 7 },
  eggs: { base: 10, per: 2, reputation: 6 },
  sell: { base: 10, per: 0.1, reputation: 6 },
  feed: { base: 10, per: 15, reputation: 12 },
};

export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** Seconds to the next UTC midnight, when new tasks come. */
export function resetsIn(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.round((next - now.getTime()) / 1000));
}

function levelForXp(xp: number) {
  let level = 1;
  while (level < 50 && xp >= 30 * level * (level + 1)) {
    level++;
  }
  return level;
}

function random(seed: string) {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rnd: () => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

type Draft = Omit<Task, 'id' | 'xp' | 'reputation'>;

/** What a farm like this one could be asked today: deliveries (one per trader it can supply) and work. */
function candidates(state: FarmState | null, rnd: () => number) {
  const level = levelForXp(state?.xp ?? 0);
  const animals = state?.animals ?? [];
  const hens = animals.filter((a) => a.kind === 'Chicken').length;
  const sheep = animals.filter((a) => a.kind === 'Sheep').length;
  const cows = animals.filter((a) => a.kind === 'Cow').length;
  const beds = Math.max(state?.ownedPlots?.length ?? 1, 1);
  const deliveries: Draft[] = [];
  const crops = CROPS.filter((c) => c.level <= level);
  const crop = crops[Math.floor(rnd() * crops.length)];
  const pieces = clamp(crop.yield * Math.min(beds, 1 + level / 3), crop.yield, crop.yield * 4);
  deliveries.push({ kind: 'deliver', trader: 'Gus', item: crop.id, count: pieces, title: `Bring Gus ${pieces} ${crop.plural}` });
  if (hens > 0) {
    const n = clamp(hens * 2, 2, 16);
    deliveries.push({ kind: 'deliver', trader: 'Hattie', item: 'Egg', count: n, title: `Bring Hattie ${n} eggs` });
  }
  if (cows > 0) {
    const n = clamp(cows * 3, 2, 16);
    deliveries.push({ kind: 'deliver', trader: 'Molly', item: 'Milk', count: n, title: `Bring Molly ${n} milk` });
  } else if (sheep > 0) {
    const n = clamp(sheep * 2, 2, 10);
    deliveries.push({ kind: 'deliver', trader: 'Molly', item: 'SheepMilk', count: n, title: `Bring Molly ${n} sheep's milk` });
  }
  if (sheep > 0) {
    const n = clamp(sheep, 1, 5);
    deliveries.push({ kind: 'deliver', trader: 'Bruno', item: 'Wool', count: n, title: `Bring Bruno ${n} wool` });
  }
  const work: Draft[] = [];
  const water = clamp(2 + level / 2, 2, 12);
  work.push({ kind: 'water', count: water, title: `Water ${water} beds` });
  const plant = clamp(2 + level / 2, 2, 12);
  work.push({ kind: 'plant', count: plant, title: `Plant ${plant} seeds` });
  const harvest = clamp(1 + level / 4, 1, 8);
  work.push({ kind: 'harvest', count: harvest, title: `Harvest ${harvest} ${harvest === 1 ? 'bed' : 'beds'}` });
  const sell = clamp((100 + level * 40) / 10, 10, 400) * 10;
  work.push({ kind: 'sell', count: sell, title: `Earn ${sell} BLOOM selling` });
  if (cows + sheep > 0) {
    const n = clamp((cows + sheep) * 1.5, 1, 10);
    work.push({ kind: 'milk', count: n, title: `Milk your animals ${n} ${n === 1 ? 'time' : 'times'}` });
  }
  if (sheep > 0) {
    const n = clamp(sheep, 1, 5);
    work.push({ kind: 'shear', count: n, title: `Shear ${n} ${n === 1 ? 'sheep' : 'sheep'}` });
  }
  if (hens > 0) {
    const n = clamp(hens * 1.5, 1, 20);
    work.push({ kind: 'eggs', count: n, title: `Collect ${n} eggs` });
  }
  if (animals.length > 0) {
    const n = clamp(animals.length / 2, 1, 4);
    work.push({ kind: 'feed', count: n, title: `Give premium feed ${n} ${n === 1 ? 'time' : 'times'}` });
  }
  // Gus first (every farm grows crops), then whoever else it can supply.
  return { level, deliveries: [deliveries[0], ...shuffle(deliveries.slice(1), rnd)], work: shuffle(work, rnd) };
}

function finish(draft: Draft, id: string, level: number): Task {
  const r = REWARD[draft.kind];
  const scale = 1 + 0.08 * (level - 1);
  return { ...draft, id, xp: Math.round((r.base + r.per * draft.count) * scale), reputation: r.reputation };
}

/** count tasks for a farm: up to two deliveries, the rest farm work. */
export function makeTasks(userId: string, day: string, state: FarmState | null, count: number) {
  const rnd = random(`${userId}:${day}`);
  const { level, deliveries, work } = candidates(state, rnd);
  const picked = [...deliveries.slice(0, Math.min(2, count - 1)), ...work].slice(0, count);
  return picked.map((draft, i) => finish(draft, `t${i}`, level));
}

/** The bonus for finishing them all. */
export function allBonus(state: FarmState | null) {
  const level = levelForXp(state?.xp ?? 0);
  return { xp: 40 + 10 * level, reputation: 20 };
}

async function loadState(userId: string) {
  const farm = await prisma.farm.findUnique({ where: { userId }, select: { state: true } });
  return (farm?.state ?? null) as FarmState | null;
}

/** Today's tasks (made now if this is the first look today; a VIP gets one more). */
export async function dailyTasks(userId: string) {
  const day = today();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { reputation: true, vipUntil: true } });
  const want = BASE_TASKS + (isVip(user.vipUntil) ? VIP_PERKS.extraTasks : 0);
  let row = await prisma.dailyTasks.findUnique({ where: { userId_day: { userId, day } } });
  let state: FarmState | null = null;
  if (!row || (row.tasks as unknown as Task[]).length < want) {
    state = await loadState(userId);
    const kept = row ? (row.tasks as unknown as Task[]) : [];
    // A VIP bought later in the day adds a task to those already given (the same ones stay).
    const fresh = makeTasks(userId, day, state, want);
    const tasks = [...kept, ...fresh.filter((t) => !kept.some((k) => k.kind === t.kind && k.item === t.item))].slice(0, want).map((t, i) => ({ ...t, id: `t${i}` }));
    row = await prisma.dailyTasks.upsert({
      where: { userId_day: { userId, day } },
      update: { tasks: tasks as unknown as object[] },
      create: { userId, day, tasks: tasks as unknown as object[] },
    });
  }
  const claims = await prisma.taskClaim.findMany({ where: { userId, day }, select: { taskId: true } });
  const claimed = new Set(claims.map((c) => c.taskId));
  const tasks = row.tasks as unknown as Task[];
  const bonus = allBonus(state ?? (await loadState(userId)));
  return {
    day,
    resetsIn: resetsIn(),
    tasks: tasks.map((t) => ({ ...t, claimed: claimed.has(t.id) })),
    allBonus: { ...bonus, claimed: claimed.has('all'), ready: tasks.every((t) => claimed.has(t.id)) },
    standing: await standing(user),
  };
}

export class TaskError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Takes a task's reward (once): the reputation (more for a VIP) is added here, and the experience is
 * returned for the game to add. "all" is the bonus for having claimed every task today.
 */
export async function claimTask(userId: string, day: string, taskId: string) {
  if (day !== today()) {
    throw new TaskError(409, 'Those tasks are over: new ones are out');
  }
  const row = await prisma.dailyTasks.findUnique({ where: { userId_day: { userId, day } } });
  if (!row) {
    throw new TaskError(404, 'No tasks today yet');
  }
  const tasks = row.tasks as unknown as Task[];
  let reward: { xp: number; reputation: number };
  if (taskId === 'all') {
    const claimed = await prisma.taskClaim.findMany({ where: { userId, day }, select: { taskId: true } });
    if (!tasks.every((t) => claimed.some((c) => c.taskId === t.id))) {
      throw new TaskError(409, 'Finish all of today\'s tasks first');
    }
    reward = allBonus(await loadState(userId));
  } else {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new TaskError(404, 'No such task');
    }
    reward = task;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { vipUntil: true } });
  const reputation = Math.round(reward.reputation * (isVip(user.vipUntil) ? VIP_PERKS.reputationMultiplier : 1));
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.taskClaim.create({ data: { userId, day, taskId, xp: reward.xp, reputation } });
      return tx.user.update({ where: { id: userId }, data: { reputation: { increment: reputation } }, select: { reputation: true, vipUntil: true } });
    });
    return { xp: reward.xp, reputation, standing: await standing(updated) };
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new TaskError(409, 'Already claimed');
    }
    throw error;
  }
}
