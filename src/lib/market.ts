import { prisma } from './db';
import { animalLevel, findAnimal, item, MARKET, marketBase, marketKey } from './game/defs';
import type { MarketCtx, MarketListing } from './game/rules';
import { priceRange } from './game/rules';
import type { Animal, Farm } from './game/state';
import { MARKET_REPUTATION, perksOf, reputationOf, type StandingSource } from './reputation';
import type { Listing } from '../generated/prisma/client';

/**
 * The market: players sell crops, products and animals to each other for BLOOM. A listing's goods leave
 * the seller's farm (the server holds them) until someone buys it (the BLOOM goes to the seller at once),
 * the seller takes it back, or it runs out (MARKET.listingHours: given back at the seller's next action).
 * It takes MARKET_REPUTATION reputation (VIP gives that much) to sell or buy, and the market stall
 * built on the farm. Anti-cheat: a price must be within MARKET.priceBand of the going price of the same
 * thing (its cheapest listing, else its last sale, else its base), nobody buys their own listing, and all
 * of it happens in the server's transactions (src/lib/game/engine.ts).
 */

const ANIMAL_PLURALS: Record<string, string> = { Chicken: 'Hens', Sheep: 'Sheep', Cow: 'Cows' };

export function toMarketListing(l: Listing & { seller?: { username: string } | null }): MarketListing {
  return {
    id: l.id,
    sellerId: l.sellerId,
    sellerName: l.seller?.username ?? 'a farmer',
    kind: l.kind === 'animal' ? 'animal' : 'item',
    item: l.item,
    key: l.key,
    count: l.count,
    price: l.price,
    unit: l.unit,
    animal: (l.animal as unknown as Animal | null) ?? null,
    expiresAt: Math.floor(l.expiresAt.getTime() / 1000),
    status: l.status,
  };
}

/** The going price of one of each key: the cheapest listing now, else the last sale (recent), else the base. */
export async function goingPrices(keys: string[]) {
  const unique = [...new Set(keys)];
  if (!unique.length) {
    return {} as Record<string, { unit: number; source: 'listing' | 'sale' | 'base' }>;
  }
  const now = new Date();
  const [cheapest, sales] = await Promise.all([
    prisma.listing.groupBy({ by: ['key'], where: { key: { in: unique }, status: 'active', expiresAt: { gt: now } }, _min: { unit: true } }),
    prisma.listing.findMany({
      where: { key: { in: unique }, status: 'sold', soldAt: { gt: new Date(now.getTime() - MARKET.lastSaleDays * 86_400_000) } },
      orderBy: { soldAt: 'desc' },
      distinct: ['key'],
      select: { key: true, unit: true },
    }),
  ]);
  const out: Record<string, { unit: number; source: 'listing' | 'sale' | 'base' }> = {};
  for (const key of unique) {
    const listed = cheapest.find((c) => c.key === key)?._min.unit;
    const sold = sales.find((s) => s.key === key)?.unit;
    out[key] = listed != null ? { unit: listed, source: 'listing' } : sold != null ? { unit: sold, source: 'sale' } : { unit: marketBase(key), source: 'base' };
  }
  return out;
}

/** What a market action needs beyond the farm (see rules.ts MarketCtx). */
export async function marketContext(userId: string, user: StandingSource, farm: Farm, action: { type: string; item?: string; animal?: string; listing?: string }): Promise<MarketCtx> {
  const rep = reputationOf(user).total;
  const ctx: MarketCtx = {
    userId,
    open: rep >= MARKET_REPUTATION,
    reputation: rep,
    needs: MARKET_REPUTATION,
    allowed: perksOf(user).listings,
    active: await prisma.listing.count({ where: { sellerId: userId, status: 'active' } }),
  };
  if (action.type === 'market_list') {
    const animal = action.animal ? farm.animals.find((a) => a.id === action.animal) : undefined;
    const key = animal ? marketKey(animal.kind, animal.xp) : (action.item ?? '');
    if (key) {
      ctx.going = { key, ...(await goingPrices([key]))[key] };
    }
  } else if (action.listing) {
    const row = await prisma.listing.findUnique({ where: { id: action.listing }, include: { seller: { select: { username: true } } } });
    if (row) {
      ctx.listing = toMarketListing(row);
    }
  }
  return ctx;
}

/** The player's listings that have run out (given back at this action). */
export async function expiredListings(userId: string) {
  const rows = await prisma.listing.findMany({ where: { sellerId: userId, status: 'active', expiresAt: { lte: new Date() } }, take: 20 });
  return rows.map((r) => toMarketListing(r));
}

/** Sales of the player's since they were last told (since: milliseconds), for the notices. */
export async function salesSince(userId: string, since: number) {
  const rows = await prisma.listing.findMany({
    where: { sellerId: userId, status: 'sold', soldAt: { gt: new Date(since) } },
    include: { buyer: { select: { username: true } } },
    orderBy: { soldAt: 'asc' },
    take: 20,
  });
  return rows;
}

export function listingName(l: { kind: string; item: string; count: number; animal?: unknown }) {
  const a = l.animal as Animal | null | undefined;
  if (l.kind === 'animal' && a) {
    return `${a.name} the ${findAnimal(a.kind)?.name.toLowerCase() ?? 'animal'} (level ${animalLevel(a.xp)})`;
  }
  return `${l.count} ${item(l.item)?.name ?? l.item}`;
}

function publicListing(l: Listing & { seller?: { username: string } | null; buyer?: { username: string } | null }, me: string) {
  const a = l.animal as unknown as Animal | null;
  return {
    id: l.id,
    kind: l.kind,
    item: l.item,
    key: l.key,
    name: listingName(l),
    count: l.count,
    price: l.price,
    unit: Math.round(l.unit * 100) / 100,
    seller: l.seller?.username ?? null,
    mine: l.sellerId === me,
    animal: a ? { name: a.name, kind: a.kind, level: animalLevel(a.xp) } : null,
    status: l.status === 'active' && l.expiresAt <= new Date() ? 'expired' : l.status,
    buyer: l.buyer?.username ?? null,
    createdAt: l.createdAt.toISOString(),
    expiresAt: l.expiresAt.toISOString(),
    secondsLeft: Math.max(0, Math.round((l.expiresAt.getTime() - Date.now()) / 1000)),
    soldAt: l.soldAt?.toISOString() ?? null,
  };
}

/** The market as the game and the site show it: what's on sale (by thing), the player's own listings, and the going prices for what they could sell. */
export async function browse(userId: string, user: StandingSource, farm: Farm | null) {
  const now = new Date();
  const [groups, mine] = await Promise.all([
    prisma.listing.groupBy({ by: ['key', 'kind', 'item'], where: { status: 'active', expiresAt: { gt: now } }, _min: { unit: true }, _sum: { count: true }, _count: { _all: true } }),
    prisma.listing.findMany({
      where: { sellerId: userId, OR: [{ status: 'active' }, { closedAt: { gt: new Date(now.getTime() - 7 * 86_400_000) } }, { soldAt: { gt: new Date(now.getTime() - 7 * 86_400_000) } }] },
      include: { buyer: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
  ]);
  const sellable = farm
    ? [...Object.entries(farm.produce).filter(([id, n]) => n > 0 && item(id)).map(([id]) => id), ...farm.animals.map((a) => marketKey(a.kind, a.xp))]
    : [];
  const going = await goingPrices([...sellable, ...groups.map((g) => g.key)]);
  const rep = reputationOf(user).total;
  return {
    open: rep >= MARKET_REPUTATION,
    reputation: rep,
    needs: MARKET_REPUTATION,
    allowed: perksOf(user).listings,
    active: mine.filter((l) => l.status === 'active').length,
    priceBand: MARKET.priceBand,
    listingHours: MARKET.listingHours,
    maxCount: MARKET.maxCount,
    built: !!farm?.buildings.includes('Market'),
    onSale: groups
      .map((g) => {
        const [id, band] = g.key.split('@');
        return {
          key: g.key,
          kind: g.kind,
          item: g.item,
          name: item(id)?.name ?? `${ANIMAL_PLURALS[id] ?? id}, levels ${Number(band) * 10 || 1}-${Number(band) * 10 + 9}`,
          listings: g._count._all,
          pieces: g._sum.count ?? 0,
          cheapest: Math.round((g._min.unit ?? 0) * 100) / 100,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    mine: mine.map((l) => publicListing(l, userId)),
    going: Object.fromEntries(
      Object.entries(going).map(([key, g]) => [key, { unit: Math.round(g.unit * 100) / 100, source: g.source, range1: priceRange(g.unit, 1), exact: g.unit }]),
    ),
  };
}

/** The listings of one thing, cheapest first. */
export async function listingsOf(key: string, userId: string) {
  const rows = await prisma.listing.findMany({
    where: { key, status: 'active', expiresAt: { gt: new Date() } },
    include: { seller: { select: { username: true } } },
    orderBy: [{ unit: 'asc' }, { createdAt: 'asc' }],
    take: 60,
  });
  return rows.map((l) => publicListing(l, userId));
}
