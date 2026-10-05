import type { MapFarm } from '../../generated/prisma/client';
import { prisma } from '../db';
import { EMBASSY, item, levelForXp } from '../game/defs';
import { combatPower, healthNow, maxHealth } from '../game/rules';
import { isServerFarm, withDefaults, type Farm } from '../game/state';
import { isVip } from '../reputation';
import { biomeAt, buildable, CENTRE, CHUNK, CHUNKS, distance, hash, inside, MAP_SIZE, type Biome } from './terrain';

/**
 * The world map. Every player's home farm stands on a square of its own under a name of its own; with VIP
 * and level 25 they see the map, and their embassy (EMBASSY in defs.ts) lets them hold farms out there,
 * one for each of its levels: built on open land, or taken from bandits or other players by beating them.
 *
 * Home farms are safe. Farms out on the map gather coins and produce by the hour (by their land and how far
 * out they are) up to MAP.storageHours, and their owner brings it home from the map. The winner of a battle
 * there either plunders (takes a share of what the farm holds, as much as their embassy carries) or captures
 * it (with a free place at their embassy: the farm and all it holds become theirs). A farm just raided,
 * taken or built has a shield for a while.
 *
 * Battles are worked out here, round by round, from both sides' strength (combat power, health, embassy):
 * the game plays them back. Nothing a client says decides a battle. BLOOM and gems are never at stake.
 */

export const MAP = {
  /** Who may see the map and act on it: VIP, and this level. */
  needLevel: 25,
  storageHours: 12,
  /** What a raid takes of what a farm holds. */
  plunderShare: 0.5,
  shieldSeconds: { plunder: 2 * 3600, capture: 6 * 3600, built: 3600 },
  /** Seconds between two attacks of the same player. */
  cooldown: 60,
  /** Health (share of the most) needed to attack. */
  minHealth: 0.25,
  /** Energy an attack takes, by squares away. */
  energy: (squares: number) => Math.min(30, 10 + Math.floor(squares / 10)),
  /** Minutes the winner has to plunder or capture. */
  victoryMinutes: 5,
  /** Rounds before the attackers give up (the defenders hold). */
  maxRounds: 20,
  /** A strike takes this share of the striker's power off the other's health. */
  strike: 0.2,
  crit: { chance: 0.1, times: 1.5 },
  /** A farm built out on the map, for the n-th one (1..). */
  buildCost: (n: number) => 5000 + 2500 * n,
  /** Squares kept free around a home farm, and around any other farm. */
  homeSpacing: 2,
  spacing: 1,
  /** Chunks a request may ask for at once. */
  maxChunks: 144,
};

/** What a farm out on the map gathers each hour, by its land (times tierScale). Each about 265 coins' worth. */
export const PRODUCTION: Record<Exclude<Biome, 'water' | 'mountain'>, { coins: number; produce: Record<string, number> }> = {
  plains: { coins: 60, produce: { Wheat: 8 } },
  meadow: { coins: 50, produce: { Hay: 6, Carrot: 3 } },
  hills: { coins: 90, produce: { Wool: 1.25 } },
  forest: { coins: 70, produce: { Pumpkin: 0.75 } },
};

/** Farther out, richer land: a farm's yield is its land's times this (tier 1: as it is). */
export const tierScale = (tier: number) => 0.8 + 0.2 * Math.max(1, tier);

/** The bandits holding a wild farm, by tier. */
export function bandits(tier: number) {
  return { power: Math.round(150 + 250 * Math.pow(Math.max(0, tier - 1), 1.3)), health: 1000 + 600 * (tier - 1) };
}

export type MapKind = 'home' | 'outpost' | 'wild';

export class MapError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

// ----------------------------------------------------------------------------- names

const NAME_START = ['Amber', 'Ash', 'Birch', 'Briar', 'Cedar', 'Clover', 'Dawn', 'Elder', 'Fern', 'Golden', 'Hazel', 'Heather', 'Ivy', 'Juniper', 'Kestrel', 'Linden', 'Maple', 'Moss', 'Nettle', 'Oak', 'Pine', 'Robin', 'Rose', 'Sage', 'Thistle', 'Willow', 'Wren', 'Yarrow', 'Bramble', 'Copper', 'Silver', 'Thorn', 'Raven', 'Falcon', 'Stone', 'Frost', 'Ember', 'Mist', 'Wolf', 'Hart'];
const NAME_END = ['brook', 'croft', 'dale', 'field', 'ford', 'gate', 'glen', 'haven', 'hollow', 'holt', 'hurst', 'leigh', 'mere', 'moor', 'ridge', 'stead', 'vale', 'wick', 'wood', 'ton', 'barrow', 'combe', 'fell', 'marsh'];
const NUMERALS = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

function placeName(x: number, y: number) {
  const seed = hash(x, y, 0x85ebca6b);
  return NAME_START[seed % NAME_START.length] + NAME_END[(seed >>> 8) % NAME_END.length];
}

/** A farm's name: letters (any script), digits, spaces, ' - and ., 3 to 24 long. */
export function cleanName(name: string) {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 3 || clean.length > 24 || !/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u.test(clean)) {
    throw new MapError('A farm\'s name is 3 to 24 letters or digits (with spaces, \' - or . between)');
  }
  return clean;
}

/** The first of wanted, "wanted II", ... nobody has (taken: names known to be taken already). */
async function freeName(wanted: string, taken = new Set<string>()) {
  const options = NUMERALS.map((n) => (wanted.slice(0, 24 - n.length) + n).trim());
  const used = new Set((await prisma.mapFarm.findMany({ where: { nameKey: { in: options.map((o) => o.toLowerCase()) } }, select: { nameKey: true } })).map((r) => r.nameKey));
  const free = options.find((o) => !used.has(o.toLowerCase()) && !taken.has(o.toLowerCase()));
  return free ?? `${wanted.slice(0, 17)} ${Date.now() % 1000000}`;
}

// ----------------------------------------------------------------------------- the bandits' farms

/** Where a chunk's bandits stand (the same for everyone, worked out from the chunk alone). */
function banditSpots(cx: number, cy: number) {
  const roll = hash(cx, cy, 0x6c8e9cf5) % 100;
  const count = roll < 14 ? 2 : roll < 62 ? 1 : 0;
  const spots: { x: number; y: number; biome: Biome; tier: number }[] = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const h = hash(cx * 31 + i, cy * 17 + attempt, 0x1b873593);
      const x = cx * CHUNK + (h % CHUNK);
      const y = cy * CHUNK + ((h >>> 8) % CHUNK);
      if (!inside(x, y)) {
        continue;
      }
      const biome = biomeAt(x, y);
      if (!buildable(biome) || spots.some((s) => distance(s.x, s.y, x, y) <= 2)) {
        continue;
      }
      // Farther from the middle of the valley, stronger bandits (and more to take).
      const tier = Math.min(8, 1 + ((h >>> 16) % 2) + Math.floor(distance(x, y, CENTRE, CENTRE) / 80));
      spots.push({ x, y, biome, tier });
      break;
    }
  }
  return spots;
}

/** Puts down the bandits of the chunks in a box that nobody has looked at yet. */
async function ensureChunks(ax: number, ay: number, bx: number, by: number) {
  const made = await prisma.mapChunk.findMany({ where: { cx: { gte: ax, lte: bx }, cy: { gte: ay, lte: by } }, select: { cx: true, cy: true } });
  const have = new Set(made.map((c) => `${c.cx},${c.cy}`));
  const missing: { cx: number; cy: number }[] = [];
  for (let cy = ay; cy <= by; cy++) {
    for (let cx = ax; cx <= bx; cx++) {
      if (!have.has(`${cx},${cy}`)) {
        missing.push({ cx, cy });
      }
    }
  }
  if (!missing.length) {
    return;
  }
  // Not on top of (or right beside) a farm that's there already.
  const standing = await prisma.mapFarm.findMany({
    where: { x: { gte: ax * CHUNK - 1, lt: (bx + 1) * CHUNK + 1 }, y: { gte: ay * CHUNK - 1, lt: (by + 1) * CHUNK + 1 } },
    select: { x: true, y: true },
  });
  const spots = missing.flatMap((c) => banditSpots(c.cx, c.cy)).filter((s) => !standing.some((f) => distance(f.x, f.y, s.x, s.y) <= MAP.spacing));
  const taken = new Set<string>();
  const rows = [];
  for (const s of spots) {
    const name = await freeName(placeName(s.x, s.y), taken);
    taken.add(name.toLowerCase());
    // A full store from the start (they've been at it a while).
    rows.push({ kind: 'wild', name, nameKey: name.toLowerCase(), x: s.x, y: s.y, biome: s.biome, tier: s.tier, storedAt: new Date(Date.now() - MAP.storageHours * 3600_000) });
  }
  // Two players looking at once put down the same farms: the second's are skipped (the squares are taken).
  if (rows.length) {
    await prisma.mapFarm.createMany({ data: rows, skipDuplicates: true });
  }
  await prisma.mapChunk.createMany({ data: missing, skipDuplicates: true });
}

// ----------------------------------------------------------------------------- production

export function productionOf(row: Pick<MapFarm, 'kind' | 'biome' | 'tier'>) {
  if (row.kind === 'home') {
    return { coins: 0, produce: {} as Record<string, number> };
  }
  const base = PRODUCTION[row.biome as keyof typeof PRODUCTION] ?? PRODUCTION.meadow;
  const scale = tierScale(row.tier);
  return { coins: Math.round(base.coins * scale), produce: Object.fromEntries(Object.entries(base.produce).map(([k, v]) => [k, Math.round(v * scale * 100) / 100])) };
}

type Store = { coins: number; produce: Record<string, number> };

/** What a farm holds now: what it had, and what it has gathered since, up to its store. */
export function storedNow(row: MapFarm, now = Date.now()): Store {
  const rate = productionOf(row);
  const hours = Math.max(0, (now - row.storedAt.getTime()) / 3600_000);
  const cap = MAP.storageHours;
  const had = (row.produce ?? {}) as Record<string, number>;
  const produce: Record<string, number> = {};
  for (const id of new Set([...Object.keys(had), ...Object.keys(rate.produce)])) {
    const r = rate.produce[id] ?? 0;
    const n = Math.floor(Math.min(Math.max(had[id] ?? 0, r * cap), (had[id] ?? 0) + r * hours));
    if (n > 0) {
      produce[id] = n;
    }
  }
  const coins = Math.floor(Math.min(Math.max(row.coins, rate.coins * cap), row.coins + rate.coins * hours));
  return { coins, produce };
}

/** Coins' worth of some produce (what a raid can carry is counted so). */
function worth(produce: Record<string, number>) {
  return Object.entries(produce).reduce((sum, [id, n]) => sum + n * (item(id)?.sell ?? 10), 0);
}

// ----------------------------------------------------------------------------- the player's home farm

async function homeFarmState(userId: string) {
  const row = await prisma.farm.findUnique({ where: { userId } });
  return row && isServerFarm(row.state) ? { row, farm: withDefaults(structuredClone(row.state) as unknown as Farm) } : null;
}

/** Changes the player's home farm (its state, as the engine keeps it) if nothing changed it meanwhile; the farm after. */
export async function changeHomeFarm(userId: string, change: (farm: Farm) => void) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const home = await homeFarmState(userId);
    if (!home) {
      throw new MapError('Your farm isn\'t loaded yet: open the game first', 409);
    }
    change(home.farm);
    const updated = await prisma.farm.updateMany({
      where: { id: home.row.id, revision: home.row.revision },
      data: { state: home.farm as unknown as object, revision: { increment: 1 }, coins: home.farm.coins },
    });
    if (updated.count === 1) {
      return home.farm;
    }
  }
  throw new MapError('Your farm is busy: try again', 409);
}

/** Where a player's home farm stands (put down the first time: a free square of land within the valley around the middle). */
export async function ensureHome(userId: string) {
  const had = await prisma.mapFarm.findFirst({ where: { ownerId: userId, kind: 'home' } });
  if (had) {
    return had;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } });
  for (let attempt = 0; attempt < 6; attempt++) {
    const seed = hash(Date.now() % 1000003, attempt * 7919 + user.username.length, 0x27d4eb2f);
    const angle = ((seed % 3600) / 3600) * Math.PI * 2;
    const radius = 30 + ((seed >>> 12) % 250);
    const ox = Math.round(CENTRE + Math.cos(angle) * radius);
    const oy = Math.round(CENTRE + Math.sin(angle) * radius);
    const reach = 24;
    const near = await prisma.mapFarm.findMany({
      where: { x: { gte: ox - reach - MAP.homeSpacing, lte: ox + reach + MAP.homeSpacing }, y: { gte: oy - reach - MAP.homeSpacing, lte: oy + reach + MAP.homeSpacing } },
      select: { x: true, y: true },
    });
    // Outward from there, ring by ring: the first square of land with room around it.
    let placed: MapFarm | null = null;
    let raced = false;
    for (let ring = 0; ring <= reach && !placed && !raced; ring++) {
      for (let dy = -ring; dy <= ring && !placed && !raced; dy++) {
        for (let dx = -ring; dx <= ring && !placed && !raced; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
            continue;
          }
          const x = ox + dx;
          const y = oy + dy;
          if (!inside(x, y) || !buildable(biomeAt(x, y)) || near.some((f) => distance(f.x, f.y, x, y) <= MAP.homeSpacing)) {
            continue;
          }
          const name = await freeName(`${user.username}'s Farm`);
          try {
            placed = await prisma.mapFarm.create({ data: { kind: 'home', ownerId: userId, name, nameKey: name.toLowerCase(), x, y, biome: biomeAt(x, y) } });
          } catch {
            raced = true; // taken meanwhile: look somewhere else
          }
        }
      }
    }
    if (placed) {
      return placed;
    }
    const meanwhile = await prisma.mapFarm.findFirst({ where: { ownerId: userId, kind: 'home' } });
    if (meanwhile) {
      return meanwhile;
    }
  }
  throw new MapError('No room on the map right now', 503);
}

// ----------------------------------------------------------------------------- the player on the map

/** Who the player is on the map: their strength, embassy, reach, whether they may use the map. */
async function player(userId: string) {
  const [user, home] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, username: true, vipUntil: true, character: true } }),
    homeFarmState(userId),
  ]);
  const farm = home?.farm ?? null;
  const level = farm ? levelForXp(farm.xp) : 1;
  const embassy = farm?.embassy ?? 0;
  const vip = isVip(user.vipUntil);
  const now = Math.floor(Date.now() / 1000);
  return {
    user,
    farm,
    level,
    vip,
    embassy,
    allowed: vip && level >= MAP.needLevel,
    slots: EMBASSY.slots(embassy),
    range: EMBASSY.range(embassy),
    carry: EMBASSY.carry(embassy),
    power: farm ? Math.round(combatPower(farm) * (1 + EMBASSY.powerBonus(embassy))) : 0,
    health: farm ? healthNow(farm, now) : 0,
    maxHealth: farm ? maxHealth(farm) : 0,
    energy: farm ? Math.floor(farm.energy) : 0,
  };
}

type Player = Awaited<ReturnType<typeof player>>;

function accessProblem(p: Player) {
  if (!p.vip && p.level < MAP.needLevel) {
    return `The world map opens to VIP players of level ${MAP.needLevel} and up (you're level ${p.level}, without VIP)`;
  }
  if (!p.vip) {
    return 'The world map opens to VIP players: become VIP to open it';
  }
  if (p.level < MAP.needLevel) {
    return `The world map opens at level ${MAP.needLevel} (you're level ${p.level})`;
  }
  return null;
}

function mustBeAllowed(p: Player) {
  const why = accessProblem(p);
  if (why) {
    throw new MapError(why, 403);
  }
}

type Owner = { username: string; vipUntil: Date | null; character: string | null } | null;

function publicFarm(row: MapFarm & { owner?: Owner }, viewerId: string, now = Date.now()) {
  return {
    id: row.id,
    // A home whose player left the game is anyone's for the taking.
    kind: (row.kind === 'home' && !row.ownerId ? 'wild' : row.kind) as MapKind,
    name: row.name,
    x: row.x,
    y: row.y,
    biome: row.biome,
    tier: row.tier,
    owner: row.owner?.username ?? null,
    ownerVip: !!row.owner && isVip(row.owner.vipUntil),
    mine: row.ownerId === viewerId,
    shieldUntil: row.shieldUntil && row.shieldUntil.getTime() > now ? Math.floor(row.shieldUntil.getTime() / 1000) : 0,
  };
}

const OWNER = { select: { username: true, vipUntil: true, character: true } } as const;

/** The player's battles lately (theirs and against their farms), for the reports. */
async function reports(userId: string) {
  const battles = await prisma.battle.findMany({
    where: { OR: [{ attackerId: userId }, { defenderId: userId }] },
    orderBy: { createdAt: 'desc' },
    take: 12,
    include: { attacker: { select: { username: true } } },
  });
  const farms = await prisma.mapFarm.findMany({ where: { id: { in: [...new Set(battles.map((b) => b.farmId))] } }, select: { id: true, name: true, x: true, y: true } });
  return battles.map((b) => {
    const farm = farms.find((f) => f.id === b.farmId);
    const sides = (b.log as { defender?: { name: string } }) ?? {};
    return {
      id: b.id,
      at: Math.floor(b.createdAt.getTime() / 1000),
      attacking: b.attackerId === userId,
      attacker: b.attacker.username,
      defender: sides.defender?.name ?? '',
      farm: farm ? { name: farm.name, x: farm.x, y: farm.y } : null,
      // Seen from the player's side.
      won: b.attackerId === userId ? b.win : !b.win,
      choice: b.choice,
      loot: (b.loot as Store | null) ?? null,
      pending: b.attackerId === userId && b.win && !b.resolvedAt && b.expiresAt.getTime() > Date.now(),
    };
  });
}

/** The player's standing on the map, their farms, their reports and the rules the game shows. */
export async function mapMe(userId: string) {
  const p = await player(userId);
  const home = await ensureHome(userId);
  const outposts = await prisma.mapFarm.findMany({ where: { ownerId: userId, kind: { not: 'home' } }, orderBy: [{ createdAt: 'asc' }] });
  const now = Date.now();
  const lastAt = await lastAttackAt(userId);
  return {
    allowed: p.allowed,
    why: accessProblem(p),
    level: p.level,
    vip: p.vip,
    embassy: p.embassy,
    embassyMax: EMBASSY.maxLevel,
    slots: p.slots,
    outposts: outposts.length,
    range: p.range,
    carry: p.carry,
    power: p.power,
    health: p.health,
    maxHealth: p.maxHealth,
    energy: p.energy,
    nextAttackAt: lastAt ? Math.floor(lastAt / 1000) + MAP.cooldown : 0,
    buildCost: MAP.buildCost(outposts.length + 1),
    home: { id: home.id, name: home.name, x: home.x, y: home.y },
    farms: [home, ...outposts].map((f) => ({ ...publicFarm(f, userId, now), stored: f.kind === 'home' ? { coins: 0, produce: {} } : storedNow(f, now), production: productionOf(f) })),
    reports: p.allowed ? await reports(userId) : [],
    rules: {
      needLevel: MAP.needLevel,
      storageHours: MAP.storageHours,
      plunderShare: MAP.plunderShare,
      shield: MAP.shieldSeconds,
      cooldown: MAP.cooldown,
      minHealth: MAP.minHealth,
      victoryMinutes: MAP.victoryMinutes,
      maxRounds: MAP.maxRounds,
      size: MAP_SIZE,
      chunk: CHUNK,
    },
    now: Math.floor(now / 1000),
  };
}

/** The farms standing in a box of chunks (cx0..cx1, cy0..cy1, both ends in), putting bandits down first where nobody has looked. */
export async function chunks(userId: string, cx0: number, cy0: number, cx1: number, cy1: number) {
  const clamp = (v: number) => Math.max(0, Math.min(CHUNKS - 1, Math.floor(v)));
  const [ax, ay, bx, by] = [clamp(Math.min(cx0, cx1)), clamp(Math.min(cy0, cy1)), clamp(Math.max(cx0, cx1)), clamp(Math.max(cy0, cy1))];
  if ((bx - ax + 1) * (by - ay + 1) > MAP.maxChunks) {
    throw new MapError('Too much of the map at once', 400);
  }
  mustBeAllowed(await player(userId));
  await ensureChunks(ax, ay, bx, by);
  const rows = await prisma.mapFarm.findMany({
    where: { x: { gte: ax * CHUNK, lt: (bx + 1) * CHUNK }, y: { gte: ay * CHUNK, lt: (by + 1) * CHUNK } },
    include: { owner: OWNER },
  });
  const now = Date.now();
  return { cx0: ax, cy0: ay, cx1: bx, cy1: by, farms: rows.map((r) => publicFarm(r, userId, now)), now: Math.floor(now / 1000) };
}

/** Squares from the nearest of the player's farms. */
async function reachFrom(userId: string, x: number, y: number) {
  const own = await prisma.mapFarm.findMany({ where: { ownerId: userId }, select: { x: true, y: true } });
  return own.reduce((best, f) => Math.min(best, distance(f.x, f.y, x, y)), Number.POSITIVE_INFINITY);
}

/** Who holds a farm against an attack: the owner's farmer (a little weaker away from home) or the bandits. */
async function defenders(row: MapFarm) {
  if (row.kind === 'wild' || !row.ownerId) {
    const tier = row.kind === 'wild' ? row.tier : 1;
    return { name: row.kind === 'wild' ? 'Bandits' : 'Squatters', ...bandits(tier), character: null as string | null };
  }
  const owner = await prisma.user.findUnique({ where: { id: row.ownerId }, select: { username: true, character: true, farm: { select: { state: true } } } });
  const state = owner?.farm?.state;
  const farm = state && isServerFarm(state) ? withDefaults(structuredClone(state) as unknown as Farm) : null;
  const power = farm ? combatPower(farm) * (1 + EMBASSY.powerBonus(farm.embassy)) : 150;
  return { name: owner?.username ?? 'Defenders', power: Math.round(power * 0.9), health: farm ? maxHealth(farm) : 1000, character: owner?.character ?? null };
}

async function lastAttackAt(userId: string) {
  const last = await prisma.battle.findFirst({ where: { attackerId: userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  return last?.createdAt.getTime() ?? 0;
}

function attackProblem(p: Player, row: MapFarm, away: number, now: number, lastAt: number): string | null {
  const access = accessProblem(p);
  if (access) {
    return access;
  }
  if (row.ownerId === p.user.id) {
    return 'It\'s your own farm';
  }
  if (row.kind === 'home' && row.ownerId) {
    return 'Home farms are under the valley\'s protection: only farms out on the map can be attacked';
  }
  if (p.embassy < 1) {
    return 'Build an Embassy on your farm to send your farmer out on the map';
  }
  if (!Number.isFinite(away) || away > p.range) {
    return `Out of reach: your Embassy reaches ${p.range} squares from your farms (this is ${Number.isFinite(away) ? away : '?'} away)`;
  }
  if (row.shieldUntil && row.shieldUntil.getTime() > now) {
    return `A shield guards it for ${Math.ceil((row.shieldUntil.getTime() - now) / 60000)} more minutes`;
  }
  if (p.farm && p.farm.deadUntil * 1000 > now) {
    return 'You\'re down: rest until you\'re back on your feet';
  }
  if (p.health < p.maxHealth * MAP.minHealth) {
    return `Too hurt to fight: rest a little (health ${Math.floor(p.health)} of ${p.maxHealth})`;
  }
  if (p.energy < MAP.energy(away)) {
    return `Too tired: the march takes ${MAP.energy(away)} energy (you have ${p.energy})`;
  }
  if (lastAt && now - lastAt < MAP.cooldown * 1000) {
    return `Your farmer is catching their breath: ${Math.ceil((MAP.cooldown * 1000 - (now - lastAt)) / 1000)} seconds`;
  }
  return null;
}

/** One farm's details for the map's panel: what it is, who holds it, how strong, what it holds (as the viewer may know it). */
export async function farmDetail(userId: string, id: string) {
  const p = await player(userId);
  mustBeAllowed(p);
  const row = await prisma.mapFarm.findUnique({ where: { id }, include: { owner: OWNER } });
  if (!row) {
    throw new MapError('That farm isn\'t there any more', 404);
  }
  const now = Date.now();
  const away = await reachFrom(userId, row.x, row.y);
  const stored = row.kind === 'home' ? { coins: 0, produce: {} } : storedNow(row, now);
  const defence = row.kind === 'home' && row.ownerId ? null : await defenders(row);
  const why = row.ownerId === userId ? null : attackProblem(p, row, away, now, await lastAttackAt(userId));
  // Scouts can only guess at another's store.
  const shown = row.ownerId === userId ? stored : { coins: Math.round(stored.coins / 50) * 50, produce: Object.fromEntries(Object.entries(stored.produce).map(([k, v]) => [k, Math.round(v / 5) * 5])) };
  return {
    farm: publicFarm(row, userId, now),
    ownerCharacter: row.owner?.character ?? null,
    distance: Number.isFinite(away) ? away : null,
    production: productionOf(row),
    stored: shown,
    loot: row.ownerId === userId ? null : lootOf(stored, p.carry),
    defence,
    you: { power: p.power, health: p.health, maxHealth: p.maxHealth, energy: p.energy, carry: p.carry, embassy: p.embassy, slots: p.slots },
    energyCost: Number.isFinite(away) ? MAP.energy(away) : null,
    canAttack: row.ownerId !== userId && !why,
    why,
  };
}

// ----------------------------------------------------------------------------- battle

export interface Round {
  /** The attacker's damage and whether it was a critical, the defender's, and both sides' health after. */
  a: number;
  ac: boolean;
  d: number;
  dc: boolean;
  ha: number;
  hd: number;
}

/**
 * The fight: each round both strike at once (a strike takes MAP.strike of the striker's power, give or take
 * a fifth, sometimes a critical), until one falls; falling together, or still standing after MAP.maxRounds,
 * the defenders hold.
 */
export function simulate(seed: number, attacker: { power: number; health: number }, defender: { power: number; health: number }) {
  let state = seed >>> 0;
  const rand = () => {
    state = hash(state, 0x9e3779b9, 0x7f4a7c15);
    return state / 0x100000000;
  };
  const strike = (power: number) => {
    const crit = rand() < MAP.crit.chance;
    return { damage: Math.max(1, Math.round(power * MAP.strike * (0.8 + rand() * 0.4) * (crit ? MAP.crit.times : 1))), crit };
  };
  let ha = attacker.health;
  let hd = defender.health;
  const rounds: Round[] = [];
  while (rounds.length < MAP.maxRounds && ha > 0 && hd > 0) {
    const a = strike(attacker.power);
    const d = strike(defender.power);
    hd = Math.max(0, hd - a.damage);
    ha = Math.max(0, ha - d.damage);
    rounds.push({ a: a.damage, ac: a.crit, d: d.damage, dc: d.crit, ha: Math.round(ha), hd: Math.round(hd) });
  }
  return { win: hd <= 0 && ha > 0, rounds, attackerLeft: ha };
}

/** What a raid takes: a share of each, scaled down to what the embassy carries. */
function lootOf(stored: Store, carry: number): Store {
  const coins = Math.floor(stored.coins * MAP.plunderShare);
  const produce = Object.fromEntries(Object.entries(stored.produce).map(([k, v]) => [k, Math.floor(v * MAP.plunderShare)]));
  const total = coins + worth(produce);
  const scale = total > carry && total > 0 ? carry / total : 1;
  return {
    coins: Math.floor(coins * scale),
    produce: Object.fromEntries(Object.entries(produce).map(([k, v]): [string, number] => [k, Math.floor(v * scale)]).filter(([, v]) => v > 0)),
  };
}

function bring(farm: Farm, store: Store) {
  farm.coins += store.coins;
  for (const [id, n] of Object.entries(store.produce)) {
    if (n > 0) {
      farm.produce[id] = (farm.produce[id] ?? 0) + n;
    }
  }
}

/** Attacks a farm on the map: the battle is fought now (the march's energy and the wounds are the attacker's); a win waits for capture or plunder. */
export async function attack(userId: string, farmId: string) {
  const p = await player(userId);
  const row = await prisma.mapFarm.findUnique({ where: { id: farmId } });
  if (!row) {
    throw new MapError('That farm isn\'t there any more', 404);
  }
  const now = Date.now();
  const away = await reachFrom(userId, row.x, row.y);
  const problem = attackProblem(p, row, away, now, await lastAttackAt(userId));
  if (problem) {
    throw new MapError(problem);
  }
  const defence = await defenders(row);
  const attacker = { name: p.user.username, power: p.power, health: Math.round(p.health), maxHealth: p.maxHealth, character: p.user.character };
  const fight = simulate(hash(now % 1000000007, row.x * 1000 + row.y, 0x3c6ef372), attacker, defence);
  const cost = MAP.energy(away);
  // The farmer comes back tired and hurt (never felled by a battle of their own choosing).
  const farm = await changeHomeFarm(userId, (f) => {
    f.energy = Math.max(0, f.energy - cost);
    f.health = Math.max(1, Math.round(fight.attackerLeft));
    f.hurtAt = Math.floor(now / 1000);
  });
  const sides = { attacker, defender: { ...defence, kind: row.kind, tier: row.tier } };
  const battle = await prisma.battle.create({
    data: { attackerId: userId, farmId, defenderId: row.ownerId, win: fight.win, log: { ...sides, rounds: fight.rounds } as object, expiresAt: new Date(now + MAP.victoryMinutes * 60_000) },
  });
  if (row.ownerId) {
    await prisma.farmEvent.create({ data: { userId: row.ownerId, kind: fight.win ? 'map_attack_lost' : 'map_attack_held', day: 0, data: { farm: row.name, by: p.user.username } } });
  }
  const outposts = await prisma.mapFarm.count({ where: { ownerId: userId, kind: 'outpost' } });
  return {
    farmState: farm,
    battle: battle.id,
    win: fight.win,
    rounds: fight.rounds,
    ...sides,
    farm: { id: row.id, name: row.name, x: row.x, y: row.y, kind: row.kind },
    energySpent: cost,
    // What winning offers: the loot a raid brings now, and whether there's a place at the embassy to keep the farm.
    loot: fight.win ? lootOf(storedNow(row, now), p.carry) : null,
    holds: fight.win ? storedNow(row, now) : null,
    canCapture: fight.win && outposts < p.slots,
    captureWhy: fight.win && outposts >= p.slots ? `Your Embassy holds ${p.slots} farm${p.slots === 1 ? '' : 's'}, all taken: raise it to hold more` : null,
    expiresAt: Math.floor(battle.expiresAt.getTime() / 1000),
  };
}

/** The winner's choice: plunder (take a share now, as much as the embassy carries) or capture (the farm and all it holds). */
export async function resolve(userId: string, battleId: string, choice: 'plunder' | 'capture') {
  const battle = await prisma.battle.findUnique({ where: { id: battleId } });
  if (!battle || battle.attackerId !== userId) {
    throw new MapError('No such battle', 404);
  }
  if (!battle.win) {
    throw new MapError('That battle was lost');
  }
  if (battle.resolvedAt) {
    throw new MapError('Already done');
  }
  if (battle.expiresAt.getTime() < Date.now()) {
    throw new MapError('Too late: the defenders have gathered again');
  }
  const p = await player(userId);
  const row = await prisma.mapFarm.findUnique({ where: { id: battle.farmId } });
  if (!row || row.ownerId !== battle.defenderId) {
    throw new MapError('Someone else got there first');
  }
  const now = Date.now();
  const stored = storedNow(row, now);
  let loot: Store = { coins: 0, produce: {} };
  let data;
  if (choice === 'capture') {
    const outposts = await prisma.mapFarm.count({ where: { ownerId: userId, kind: 'outpost' } });
    if (outposts >= p.slots) {
      throw new MapError(`Your Embassy holds ${p.slots} farm${p.slots === 1 ? '' : 's'}, all taken: raise it to hold more`);
    }
    // It keeps what it holds, for its new owner to bring home.
    data = { ownerId: userId, kind: 'outpost', coins: stored.coins, produce: stored.produce, storedAt: new Date(now), takenAt: new Date(now), shieldUntil: new Date(now + MAP.shieldSeconds.capture * 1000) };
  } else {
    loot = lootOf(stored, p.carry);
    const left = { ...stored.produce };
    for (const [k, v] of Object.entries(loot.produce)) {
      left[k] = Math.max(0, (left[k] ?? 0) - v);
    }
    data = { coins: Math.max(0, stored.coins - loot.coins), produce: left, storedAt: new Date(now), shieldUntil: new Date(now + MAP.shieldSeconds.plunder * 1000) };
  }
  // Marked done first (so it's done once), then the farm changes only if it's as the battle left it.
  const done = await prisma.battle.updateMany({ where: { id: battle.id, resolvedAt: null }, data: { resolvedAt: new Date(now), choice, loot: choice === 'capture' ? stored : loot } });
  if (done.count !== 1) {
    throw new MapError('Already done');
  }
  const changed = await prisma.mapFarm.updateMany({ where: { id: row.id, ownerId: battle.defenderId, storedAt: row.storedAt }, data });
  if (changed.count !== 1) {
    await prisma.battle.update({ where: { id: battle.id }, data: { resolvedAt: null, choice: null } });
    throw new MapError('The farm changed meanwhile: try again', 409);
  }
  const farm = choice === 'plunder' ? await changeHomeFarm(userId, (f) => bring(f, loot)) : null;
  await prisma.farmEvent.create({ data: { userId, kind: choice === 'capture' ? 'map_captured' : 'map_plundered', day: 0, data: { farm: row.name, coins: loot.coins } } });
  if (battle.defenderId) {
    await prisma.farmEvent.create({
      data: { userId: battle.defenderId, kind: choice === 'capture' ? 'map_lost' : 'map_raided', day: 0, data: { farm: row.name, by: p.user.username, coins: loot.coins } },
    });
  }
  return { farmState: farm, choice, loot, holds: choice === 'capture' ? stored : null, farm: { id: row.id, name: row.name, x: row.x, y: row.y } };
}

// ----------------------------------------------------------------------------- the player's own farms

/** Builds a farm out on the map: on open land within reach, with a free place at the embassy, for coins. */
export async function build(userId: string, x: number, y: number, wanted?: string) {
  const p = await player(userId);
  mustBeAllowed(p);
  if (p.embassy < 1) {
    throw new MapError('Build an Embassy on your farm first');
  }
  if (!inside(x, y) || !buildable(biomeAt(x, y))) {
    throw new MapError('Nothing can be built there (water or mountains)');
  }
  const outposts = await prisma.mapFarm.count({ where: { ownerId: userId, kind: 'outpost' } });
  if (outposts >= p.slots) {
    throw new MapError(`Your Embassy holds ${p.slots} farm${p.slots === 1 ? '' : 's'}, all taken: raise it to hold more`);
  }
  const away = await reachFrom(userId, x, y);
  if (away > p.range) {
    throw new MapError(`Out of reach: your Embassy reaches ${p.range} squares from your farms`);
  }
  const near = await prisma.mapFarm.count({ where: { x: { gte: x - MAP.spacing, lte: x + MAP.spacing }, y: { gte: y - MAP.spacing, lte: y + MAP.spacing } } });
  if (near) {
    throw new MapError('Too close to another farm');
  }
  const name = wanted ? cleanName(wanted) : await freeName(placeName(x, y));
  if (await prisma.mapFarm.findUnique({ where: { nameKey: name.toLowerCase() }, select: { id: true } })) {
    throw new MapError('That name is taken');
  }
  const cost = MAP.buildCost(outposts + 1);
  const farm = await changeHomeFarm(userId, (f) => {
    if (f.coins < cost) {
      throw new MapError(`It costs ${cost.toLocaleString('en')} coins (you have ${f.coins.toLocaleString('en')})`);
    }
    f.coins -= cost;
  });
  try {
    const row = await prisma.mapFarm.create({
      data: { kind: 'outpost', ownerId: userId, name, nameKey: name.toLowerCase(), x, y, biome: biomeAt(x, y), storedAt: new Date(), shieldUntil: new Date(Date.now() + MAP.shieldSeconds.built * 1000) },
    });
    await prisma.farmEvent.create({ data: { userId, kind: 'map_built', day: 0, data: { farm: name, x, y, coins: cost } } });
    return { farmState: farm, farm: publicFarm({ ...row, owner: p.user }, userId), cost };
  } catch {
    await changeHomeFarm(userId, (f) => {
      f.coins += cost;
    });
    throw new MapError('Someone built there first');
  }
}

/** Brings home what the player's farms out there have gathered. */
export async function collect(userId: string) {
  mustBeAllowed(await player(userId));
  const farms = await prisma.mapFarm.findMany({ where: { ownerId: userId, kind: 'outpost' } });
  const now = Date.now();
  const total: Store = { coins: 0, produce: {} };
  for (const row of farms) {
    const stored = storedNow(row, now);
    const taken = await prisma.mapFarm.updateMany({ where: { id: row.id, ownerId: userId, storedAt: row.storedAt }, data: { coins: 0, produce: {}, storedAt: new Date(now) } });
    if (taken.count !== 1) {
      continue;
    }
    total.coins += stored.coins;
    for (const [k, v] of Object.entries(stored.produce)) {
      total.produce[k] = (total.produce[k] ?? 0) + v;
    }
  }
  let farm: Farm | null = null;
  if (total.coins || Object.keys(total.produce).length) {
    farm = await changeHomeFarm(userId, (f) => bring(f, total));
    await prisma.farmEvent.create({ data: { userId, kind: 'map_collected', day: 0, data: { coins: total.coins, farms: farms.length } } });
  }
  return { farmState: farm, collected: total };
}

/** Renames one of the player's farms (names are one of a kind). */
export async function rename(userId: string, farmId: string, wanted: string) {
  const name = cleanName(wanted);
  const row = await prisma.mapFarm.findUnique({ where: { id: farmId } });
  if (!row || row.ownerId !== userId) {
    throw new MapError('That isn\'t your farm', 404);
  }
  try {
    const updated = await prisma.mapFarm.update({ where: { id: farmId }, data: { name, nameKey: name.toLowerCase() } });
    return { id: updated.id, name: updated.name };
  } catch {
    throw new MapError('That name is taken');
  }
}

/** A player's farms for their profile on the site (names and squares are public). */
export async function farmsOf(userId: string) {
  return prisma.mapFarm.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' }, select: { name: true, x: true, y: true, kind: true, biome: true } });
}
