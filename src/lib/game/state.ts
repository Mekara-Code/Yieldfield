import { randomBytes } from 'node:crypto';
import { ANIMALS, CROPS, FED_SECONDS, findAnimal, findCrop, MAX_ENERGY, START, type AnimalKind } from './defs';

/**
 * A farm as the server keeps it (Farm.state, version 5): everything with a value lives here or in the
 * player's BLOOM and gems, and only the server changes it (src/lib/game/rules.ts). Times are Unix
 * seconds, server time; timers run in real time.
 */

export interface Plot {
  index: number;
  /** 0 wild, 1 tilled, 2 planted */
  state: number;
  crop: string;
  plantedAt: number;
  /** Seconds grown up to grownAt; it grows on while watered (until wetUntil). */
  grown: number;
  grownAt: number;
  wetUntil: number;
  /** Seconds of growing it needs (the crop's, less with the farming skill when it was planted). */
  need?: number;
}

export interface Animal {
  id: string;
  kind: AnimalKind;
  name: string;
  xp: number;
  boughtAt: number;
  /** What it gives: the cycle began then, and is done at readyAt (if it was fed all along). */
  cycleStart: number;
  readyAt: number;
  /** A sheep's wool, likewise. */
  woolStart: number;
  woolReadyAt: number;
  /** Fed until then: after, it's hungry and what it makes waits. */
  fedUntil: number;
}

export interface Farm {
  version: 5;
  day: number;
  hour: number;
  energy: number;
  coins: number;
  xp: number;
  selected: string;
  seeds: Record<string, number>;
  produce: Record<string, number>;
  plots: Plot[];
  ownedPlots: number[];
  animals: Animal[];
  buildings: string[];
  companion: string;
  taskDay: string;
  taskProgress: Record<string, number>;
  traderSales: Record<string, number>;
  /** When the player last slept (Unix seconds): once in SLEEP_SECONDS. */
  lastSleptAt: number;
  /** Buildings going up: when each is done (Unix seconds). */
  construction: Record<string, number>;
  /** Levels in each skill track (defs.ts SKILL_TRACKS), when they were last taken back (0: never), and the
   *  fractions of extra yield not given yet. */
  skills: Record<string, number>;
  skillResetAt: number;
  skillCarry: Record<string, number>;
  /** Sales on the market up to then (milliseconds) were told already. */
  marketSeenAt: number;
  /** Health as it was at hurtAt (null: all of it); it comes back by itself (rules.ts healthNow). */
  health: number | null;
  hurtAt: number;
  /** Killed: back on their feet at deadUntil (0: alive), and what killed them ("wolf"). */
  deadUntil: number;
  deathCause: string;
  deaths: number;
  /** This farm's wolf in the wolf event on now (or the last one): the damage it took, when it died (0: alive),
   *  and the last strike at it and bite from it (milliseconds, for the rate checks). */
  wolf: FarmWolf | null;
  /** The latest actions' ids: one sent again (its answer lost) isn't done twice. */
  recent: string[];
}

export interface FarmWolf {
  event: string;
  damage: number;
  killedAt: number;
  hitMs: number;
  biteMs: number;
}

/** What farms made before a field existed lack: added (a farm read from the database goes through it). */
export function withDefaults(farm: Farm): Farm {
  farm.construction ??= {};
  farm.skills ??= {};
  farm.skillResetAt ??= 0;
  farm.skillCarry ??= {};
  farm.marketSeenAt ??= 0;
  farm.health ??= null;
  farm.hurtAt ??= 0;
  farm.deadUntil ??= 0;
  farm.deathCause ??= '';
  farm.deaths ??= 0;
  farm.wolf ??= null;
  farm.recent ??= [];
  return farm;
}

export function emptyPlot(index: number, state = 0): Plot {
  return { index, state, crop: '', plantedAt: 0, grown: 0, grownAt: 0, wetUntil: 0 };
}

/** A new farm: the beds the level has (their indices), the one nearest the start owned and dug. */
export function newFarm(plotIndices: number[], starter: number): Farm {
  const indices = [...new Set(plotIndices)].filter((i) => Number.isInteger(i) && i >= 0 && i < 256).sort((a, b) => a - b);
  const first = indices.includes(starter) ? starter : indices[0] ?? 0;
  return {
    version: 5,
    day: 1,
    hour: 7,
    energy: MAX_ENERGY,
    coins: START.coins,
    xp: 0,
    selected: 'Wheat',
    seeds: { ...START.seeds },
    produce: {},
    plots: indices.map((i) => emptyPlot(i, i === first ? 1 : 0)),
    ownedPlots: [first],
    animals: [],
    buildings: [],
    companion: '',
    taskDay: '',
    taskProgress: {},
    traderSales: {},
    lastSleptAt: 0,
    construction: {},
    skills: {},
    skillResetAt: 0,
    skillCarry: {},
    marketSeenAt: 0,
    health: null,
    hurtAt: 0,
    deadUntil: 0,
    deathCause: '',
    deaths: 0,
    wolf: null,
    recent: [],
  };
}

export function newAnimalId() {
  return 'a' + randomBytes(8).toString('hex');
}

export function newAnimal(kind: AnimalKind, name: string, now: number): Animal {
  const def = findAnimal(kind)!;
  return {
    id: newAnimalId(),
    kind,
    name,
    xp: 0,
    boughtAt: now,
    cycleStart: now,
    readyAt: now + def.cycle,
    woolStart: def.wool ? now : 0,
    woolReadyAt: def.wool ? now + def.wool.cycle : 0,
    fedUntil: now + FED_SECONDS, // comes fed for a day
  };
}

// ----------------------------------------------------------------------------- timers

/** Seconds a crop has grown by time t (it grows only while watered). */
export function growth(p: Plot, t: number) {
  const crop = findCrop(p.crop);
  if (!crop || p.state !== 2) {
    return 0;
  }
  return Math.min(growNeed(p), p.grown + Math.max(0, Math.min(t, p.wetUntil) - p.grownAt));
}

/** Seconds of growing the bed's crop needs. */
export function growNeed(p: Plot) {
  return p.need ?? findCrop(p.crop)?.grow ?? 0;
}

export function isRipe(p: Plot, t: number) {
  const crop = findCrop(p.crop);
  return !!crop && p.state === 2 && growth(p, t) >= growNeed(p);
}

/** Planted, not ripe, and the water has run out: it waits for a watering. */
export function isDry(p: Plot, t: number) {
  return p.state === 2 && !isRipe(p, t) && t >= p.wetUntil;
}

export function isHungry(a: Animal, t: number) {
  return t >= a.fedUntil;
}

export function productReady(a: Animal, t: number) {
  return a.readyAt <= t && a.readyAt <= a.fedUntil;
}

export function woolReady(a: Animal, t: number) {
  return a.woolReadyAt > 0 && a.woolReadyAt <= t && a.woolReadyAt <= a.fedUntil;
}

/** Seconds left on a cycle as of t (held while hungry). */
export function remaining(start: number, ready: number, fedUntil: number, t: number) {
  if (ready <= t && ready <= fedUntil) {
    return 0;
  }
  if (t >= fedUntil && ready > fedUntil) {
    return ready - Math.max(fedUntil, start);
  }
  return Math.max(0, ready - t);
}

/**
 * Feeds an animal at t: if it was hungry, its cycles move on by how long they were held; it's then fed
 * for FED_SECONDS more (up to MAX ahead). Returns false if it's too full to eat.
 */
export function feed(a: Animal, t: number, fedSeconds: number, maxAhead: number) {
  if (a.fedUntil - t >= fedSeconds) {
    return false;
  }
  if (t >= a.fedUntil) {
    const held = (start: number, ready: number) => {
      const from = Math.max(a.fedUntil, start);
      return ready > from ? t - from : 0;
    };
    a.readyAt += held(a.cycleStart, a.readyAt);
    if (a.woolReadyAt > 0) {
      a.woolReadyAt += held(a.woolStart, a.woolReadyAt);
    }
    a.fedUntil = t + fedSeconds;
  } else {
    a.fedUntil = Math.min(a.fedUntil + fedSeconds, t + maxAhead);
  }
  return true;
}

// ----------------------------------------------------------------------------- the game's older saves

const OLD_DAYS: Record<string, number> = { Carrot: 3, Wheat: 3, Sunflower: 4, Tomato: 5, Corn: 6, Pumpkin: 8 };

/** A save the game made itself (versions 1 to 4) as a server farm: crops keep how far they'd grown, animals are ready and fed. */
export function migrate(old: Record<string, unknown>, now: number): Farm {
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, number>) : {});
  const produce = { ...rec(old.produce) };
  const eggs = num(old.eggsInCoop);
  if (eggs > 0) {
    produce.Egg = (produce.Egg ?? 0) + eggs;
  }
  const plots: Plot[] = (Array.isArray(old.plots) ? old.plots : []).map((p: Record<string, unknown>) => {
    const index = num(p.index);
    const state = Math.min(Math.max(num(p.state), 0), 2);
    const crop = typeof p.crop === 'string' && p.crop !== 'None' ? p.crop : '';
    const def = findCrop(crop);
    if (state !== 2 || !def) {
      return emptyPlot(index, state === 2 ? 1 : state);
    }
    const grown = Math.min(def.grow, (num(p.days) / (OLD_DAYS[crop] ?? 3)) * def.grow);
    return { index, state: 2, crop, plantedAt: now - Math.round(grown), grown, grownAt: now, wetUntil: p.bWatered ? now + def.water : 0 };
  });
  const animals: Animal[] = (Array.isArray(old.animals) ? old.animals : []).map((a: Record<string, unknown>) => {
    const kind = (ANIMALS.find((d) => d.kind === a.kind)?.kind ?? 'Chicken') as AnimalKind;
    const def = findAnimal(kind)!;
    return {
      id: typeof a.id === 'string' ? a.id : newAnimalId(),
      kind,
      name: typeof a.name === 'string' ? a.name : def.name,
      xp: num(a.xp),
      boughtAt: now,
      cycleStart: now - def.cycle,
      readyAt: now,
      woolStart: def.wool ? now - def.wool.cycle : 0,
      woolReadyAt: def.wool ? now : 0,
      fedUntil: now + FED_SECONDS,
    };
  });
  const owned = Array.isArray(old.ownedPlots) ? (old.ownedPlots as number[]).filter((i) => Number.isInteger(i)) : [];
  return {
    version: 5,
    day: Math.max(1, num(old.day, 1)),
    hour: num(old.hour, 7),
    energy: Math.min(MAX_ENERGY, num(old.energy, MAX_ENERGY)),
    coins: Math.max(0, Math.round(num(old.coins))),
    xp: Math.max(0, num(old.xp)),
    selected: typeof old.selected === 'string' && findCrop(old.selected) ? old.selected : 'Wheat',
    seeds: rec(old.seeds),
    produce,
    plots,
    ownedPlots: owned.length ? owned : plots.filter((p) => p.state > 0).map((p) => p.index),
    animals,
    buildings: Array.isArray(old.buildings) ? (old.buildings as string[]) : [],
    companion: typeof old.companion === 'string' ? old.companion : '',
    taskDay: typeof old.taskDay === 'string' ? old.taskDay : '',
    taskProgress: {},
    traderSales: rec(old.traderSales),
    lastSleptAt: 0,
    construction: {},
    skills: {},
    skillResetAt: 0,
    skillCarry: {},
    marketSeenAt: 0,
    health: null,
    hurtAt: 0,
    deadUntil: 0,
    deathCause: '',
    deaths: 0,
    wolf: null,
    recent: [],
  };
}

export function isServerFarm(state: unknown): state is Farm {
  return !!state && typeof state === 'object' && (state as { version?: number }).version === 5;
}

export const CROP_IDS = CROPS.map((c) => c.id);
