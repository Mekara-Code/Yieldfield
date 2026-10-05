import { prisma } from './db';
import { animalLevel, levelForXp } from './game/defs';
import { isPlaying } from './presence';

/**
 * The leaderboards (the home page and /leaderboard): the best farmers (experience), the biggest herds of
 * cows, sheep and hens (how many, then how far they've grown), and the most coins and BLOOM.
 * Everything comes from the farms as the server keeps them (Farm.state); farms never played and the
 * admins' accounts (they can grant themselves anything) aren't ranked.
 */

export type BoardId = 'farmers' | 'cows' | 'sheep' | 'hens' | 'coins' | 'bloom';

export interface BoardInfo {
  id: BoardId;
  title: string;
  /** What's counted, after the number: "XP", "cows". */
  unit: string;
  blurb: string;
}

export const BOARDS: BoardInfo[] = [
  { id: 'farmers', title: 'Top farmers', unit: 'XP', blurb: 'Every bed tilled, crop sold and task done adds up.' },
  { id: 'cows', title: 'Top cattle ranchers', unit: 'cows', blurb: 'The biggest herds of cows, and how far they have grown.' },
  { id: 'sheep', title: 'Top shepherds', unit: 'sheep', blurb: 'The most sheep: milk and wool, every day.' },
  { id: 'hens', title: 'Top poultry keepers', unit: 'hens', blurb: 'The busiest coops in the valley.' },
  { id: 'coins', title: 'Richest farms', unit: 'coins', blurb: 'Coins earned from the fields, the barn and the traders.' },
  { id: 'bloom', title: 'Most BLOOM', unit: 'BLOOM', blurb: 'The flower money: VIP, partners, gems and trading.' },
];

export function isBoard(id: string | null | undefined): id is BoardId {
  return BOARDS.some((b) => b.id === id);
}

export interface BoardEntry {
  rank: number;
  username: string;
  /** "Diana", "Arellah", "Arash" (or null on old accounts). */
  character: string | null;
  vip: boolean;
  level: number;
  /** The number ranked on. */
  value: number;
  /** A second line: "Lv 12 herd", "320 XP". */
  detail: string;
  playing: boolean;
}

const KIND: Record<'cows' | 'sheep' | 'hens', string> = { cows: 'Cow', sheep: 'Sheep', hens: 'Chicken' };

interface Row {
  username: string;
  character: string | null;
  vipUntil: Date | null;
  userId: string;
  updatedAt: Date;
  xp: number | string | null;
  value: number | string | bigint | null;
  extra: number | string | bigint | null;
}

function adminNames() {
  return (process.env.ADMIN_USERNAMES ?? '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
}

async function query(board: BoardId, take: number): Promise<Row[]> {
  const admins = adminNames();
  // Who's ranked: played at least once, not an admin.
  if (board === 'cows' || board === 'sheep' || board === 'hens') {
    return prisma.$queryRaw<Row[]>`
      SELECT u.username, u.character, u."vipUntil", f."userId", f."updatedAt",
             COALESCE((f.state->>'xp')::numeric, 0) AS xp,
             count(*) AS value,
             COALESCE(max((a->>'xp')::numeric), 0) AS extra
      FROM "Farm" f
      JOIN "User" u ON u.id = f."userId"
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.state->'animals') = 'array' THEN f.state->'animals' ELSE '[]'::jsonb END) a
      WHERE f.revision > 0 AND NOT u."isAdmin" AND NOT (lower(u.username) = ANY(${admins}::text[])) AND a->>'kind' = ${KIND[board]}
      GROUP BY u.id, f.id
      ORDER BY value DESC, COALESCE(sum((a->>'xp')::numeric), 0) DESC, f."updatedAt" ASC
      LIMIT ${take}`;
  }
  if (board === 'bloom') {
    return prisma.$queryRaw<Row[]>`
      SELECT u.username, u.character, u."vipUntil", f."userId", f."updatedAt",
             COALESCE((f.state->>'xp')::numeric, 0) AS xp, u.bloom AS value, 0 AS extra
      FROM "Farm" f
      JOIN "User" u ON u.id = f."userId"
      WHERE f.revision > 0 AND NOT u."isAdmin" AND NOT (lower(u.username) = ANY(${admins}::text[])) AND u.bloom > 0
      ORDER BY u.bloom DESC, f."updatedAt" ASC
      LIMIT ${take}`;
  }
  if (board === 'coins') {
    return prisma.$queryRaw<Row[]>`
      SELECT u.username, u.character, u."vipUntil", f."userId", f."updatedAt",
             COALESCE((f.state->>'xp')::numeric, 0) AS xp, f.coins AS value, f.day AS extra
      FROM "Farm" f
      JOIN "User" u ON u.id = f."userId"
      WHERE f.revision > 0 AND NOT u."isAdmin" AND NOT (lower(u.username) = ANY(${admins}::text[]))
      ORDER BY f.coins DESC, f."updatedAt" ASC
      LIMIT ${take}`;
  }
  return prisma.$queryRaw<Row[]>`
    SELECT u.username, u.character, u."vipUntil", f."userId", f."updatedAt",
           COALESCE((f.state->>'xp')::numeric, 0) AS xp,
           COALESCE((f.state->>'xp')::numeric, 0) AS value,
           CASE WHEN jsonb_typeof(f.state->'animals') = 'array' THEN jsonb_array_length(f.state->'animals') ELSE 0 END AS extra
    FROM "Farm" f
    JOIN "User" u ON u.id = f."userId"
    WHERE f.revision > 0 AND NOT u."isAdmin" AND NOT (lower(u.username) = ANY(${admins}::text[]))
    ORDER BY value DESC, f."updatedAt" ASC
    LIMIT ${take}`;
}

function detailOf(board: BoardId, level: number, extra: number) {
  switch (board) {
    case 'farmers':
      return `${extra} ${extra === 1 ? 'animal' : 'animals'}`;
    case 'cows':
    case 'sheep':
    case 'hens':
      return `best one Lv ${animalLevel(extra)}`;
    case 'coins':
      return `Level ${level}`;
    case 'bloom':
      return `Level ${level}`;
  }
}

/** One board, best first. */
export async function board(id: BoardId, take = 50): Promise<BoardEntry[]> {
  const rows = await query(id, Math.max(1, Math.min(take, 100)));
  const now = Date.now();
  return rows.map((r, i) => {
    const xp = Number(r.xp ?? 0);
    const level = levelForXp(xp);
    const extra = Number(r.extra ?? 0);
    return {
      rank: i + 1,
      username: r.username,
      character: r.character,
      vip: !!r.vipUntil && r.vipUntil.getTime() > now,
      level,
      value: Math.floor(Number(r.value ?? 0)),
      detail: detailOf(id, level, extra),
      playing: isPlaying(r.userId, r.updatedAt),
    };
  });
}

/** Every board's best few (the home page). */
export async function allBoards(take = 5) {
  const lists = await Promise.all(BOARDS.map((b) => board(b.id, take)));
  return BOARDS.map((b, i) => ({ ...b, entries: lists[i] }));
}

/** The valley in numbers, for the home page. */
export async function valleyStats() {
  const [farmers, animals, online] = await Promise.all([
    prisma.farm.count({ where: { revision: { gt: 0 } } }),
    prisma.animal.count(),
    prisma.farm.findMany({ where: { updatedAt: { gt: new Date(Date.now() - 15 * 60_000) } }, select: { userId: true, updatedAt: true } }),
  ]);
  return { farmers, animals, playing: online.filter((f) => isPlaying(f.userId, f.updatedAt)).length };
}

/** The old list (the richest farms, with level and animals), as /api/leaderboard gave it before the boards. */
export async function topFarms(take = 20) {
  const entries = await board('coins', take);
  return entries.map((e) => ({ rank: e.rank, username: e.username, coins: e.value, level: e.level, playing: e.playing }));
}
