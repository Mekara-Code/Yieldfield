import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { prisma } from './db';
import type { Payment } from '../generated/prisma/client';
import { formatUnits, incoming, isNetwork, NETWORKS, type NetworkId, usdPrice } from './networks';

/**
 * The BLOOM shop: packs priced in dollars, paid in crypto to the wallets the admin sets (/admin).
 * An order fixes the exact amount (the coin's price then, plus a tiny offset no other open order
 * has) for ORDER_MINUTES; a transfer of that amount sent in that time credits the pack to the farm
 * (Farm.credits, which the game adds to its coins). After that a new order, at a new price, is needed.
 */

export const PackSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  bloom: z.number().int().min(1).max(10_000_000),
  usdCents: z.number().int().min(50).max(1_000_000),
  tag: z.string().max(24).optional(),
});
export type Pack = z.infer<typeof PackSchema>;

export const DEFAULT_PACKS: Pack[] = [
  { id: 'p100', bloom: 100, usdCents: 99 },
  { id: 'p250', bloom: 250, usdCents: 199 },
  { id: 'p500', bloom: 500, usdCents: 399 },
  { id: 'p1000', bloom: 1000, usdCents: 699, tag: 'Popular' },
  { id: 'p2500', bloom: 2500, usdCents: 1499 },
  { id: 'p10000', bloom: 10000, usdCents: 4999, tag: 'Best value' },
];

export const ORDER_MINUTES_DEFAULT = 10;

export const SettingsSchema = z.object({
  wallets: z.record(z.string(), z.string().trim().max(120)),
  packs: z.array(PackSchema).min(1).max(12),
  orderMinutes: z.number().int().min(3).max(60),
});
export type ShopSettings = z.infer<typeof SettingsSchema>;

export async function shopSettings(): Promise<ShopSettings> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ['wallets', 'packs', 'orderMinutes'] } } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const wallets = (get('wallets') as Record<string, string> | undefined) ?? {};
  const packs = PackSchema.array().safeParse(get('packs'));
  const minutes = Number(get('orderMinutes'));
  return {
    wallets: Object.fromEntries(Object.entries(wallets).filter(([id, address]) => isNetwork(id) && address)),
    packs: packs.success && packs.data.length ? packs.data : DEFAULT_PACKS,
    orderMinutes: Number.isInteger(minutes) && minutes >= 3 && minutes <= 60 ? minutes : ORDER_MINUTES_DEFAULT,
  };
}

/** What the shop offers: the packs, and the coins whose wallet the admin has set. */
export async function catalog() {
  const settings = await shopSettings();
  // Bigger packs give more BLOOM a dollar: how much more than the smallest one.
  const smallest = [...settings.packs].sort((a, b) => a.usdCents - b.usdCents)[0];
  const rate = smallest.bloom / smallest.usdCents;
  return {
    packs: settings.packs.map((p) => ({ ...p, usd: (p.usdCents / 100).toFixed(2), bonusPercent: Math.max(0, Math.round(((p.bloom / p.usdCents) / rate - 1) * 100)) })),
    networks: Object.keys(settings.wallets).filter(isNetwork).map((id) => ({ id, label: NETWORKS[id].label, asset: NETWORKS[id].asset })),
    orderMinutes: settings.orderMinutes,
  };
}

export class ShopError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const OPEN = ['pending', 'confirming'];

export async function createOrder(userId: string, packId: string, networkId: string) {
  const settings = await shopSettings();
  const pack = settings.packs.find((p) => p.id === packId);
  if (!pack) {
    throw new ShopError(404, 'No such pack');
  }
  if (!isNetwork(networkId) || !settings.wallets[networkId]) {
    throw new ShopError(400, 'That coin isn\'t accepted right now');
  }
  const network = NETWORKS[networkId];
  const address = settings.wallets[networkId];
  // An older order of the player's stays open till it runs out: a payment to it still counts (checkOrder).
  const price = await usdPrice(networkId);
  const scale = 10n ** BigInt(network.decimals);
  // The pack's price in the coin, rounded up to a step...
  const exact = BigInt(Math.ceil((pack.usdCents / 100 / price) * Number(scale) / Number(network.step))) * network.step;
  // ...plus an offset no other open order on this coin has.
  const taken = new Set(
    (await prisma.payment.findMany({ where: { network: networkId, status: { in: OPEN } }, select: { units: true } })).map((p) => p.units),
  );
  let units = 0n;
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate = exact + BigInt(randomInt(1, network.spread + 1)) * network.step;
    if (!taken.has(candidate.toString())) {
      units = candidate;
      break;
    }
  }
  if (units === 0n) {
    throw new ShopError(503, 'The shop is busy: try again in a minute');
  }
  const now = Date.now();
  const payment = await prisma.payment.create({
    data: {
      userId,
      pack: pack.id,
      bloom: pack.bloom,
      usdCents: pack.usdCents,
      network: networkId,
      amount: formatUnits(units, network.decimals),
      units: units.toString(),
      address,
      usdPrice: price,
      expiresAt: new Date(now + settings.orderMinutes * 60_000),
    },
  });
  return payment;
}

/** What the game and the site see of an order. */
export function publicOrder(p: Payment, credits?: number) {
  const network = isNetwork(p.network) ? NETWORKS[p.network] : null;
  const now = Date.now();
  // The window to pay has closed: the order shows as expired, though a payment sent in time can still turn up.
  const shown = p.status === 'pending' && p.expiresAt.getTime() < now ? 'expired' : p.status;
  return {
    id: p.id,
    pack: p.pack,
    bloom: p.bloom,
    usd: (p.usdCents / 100).toFixed(2),
    network: p.network,
    networkLabel: network?.label ?? p.network,
    asset: network?.asset ?? '',
    amount: p.amount,
    address: p.address,
    status: shown,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    secondsLeft: Math.max(0, Math.round((p.expiresAt.getTime() - now) / 1000)),
    txHash: p.txHash,
    explorer: p.txHash && network ? network.explorer + p.txHash : null,
    credits,
  };
}

/** Credits a paid order to the farm, once (the tx can only be used by one order). */
async function credit(p: Payment, txHash: string, note?: string) {
  return prisma.$transaction(async (tx) => {
    const done = await tx.payment.updateMany({
      where: { id: p.id, status: { in: ['pending', 'confirming', 'expired'] } },
      data: { status: 'paid', txHash, paidAt: new Date(), note },
    });
    if (done.count === 0) {
      return tx.payment.findUniqueOrThrow({ where: { id: p.id } });
    }
    await tx.farm.upsert({ where: { userId: p.userId }, update: { credits: { increment: p.bloom } }, create: { userId: p.userId, credits: p.bloom } });
    await tx.farmEvent.create({ data: { userId: p.userId, kind: 'purchase', day: 0, data: { bloom: p.bloom, usd: (p.usdCents / 100).toFixed(2), coin: p.network } } });
    return tx.payment.findUniqueOrThrow({ where: { id: p.id } });
  });
}

/**
 * Looks on the chain for the order's payment (at most every few seconds): a transfer to the wallet of at
 * least the amount (up to 3 % more), sent while the order was open, that no other order claims better.
 */
export async function checkOrder(p: Payment): Promise<Payment> {
  if (p.status === 'paid' || p.status === 'cancelled' || !isNetwork(p.network)) {
    return p;
  }
  const network = NETWORKS[p.network];
  const now = Date.now();
  const opened = p.createdAt.getTime() - 120_000;
  const closed = p.expiresAt.getTime() + 60_000;
  const lateEnd = p.expiresAt.getTime() + network.lateMinutes * 60_000;
  if (p.status === 'pending' && now > lateEnd) {
    return prisma.payment.update({ where: { id: p.id }, data: { status: 'expired' } });
  }
  if (p.checkedAt && now - p.checkedAt.getTime() < 5000) {
    return p;
  }
  await prisma.payment.update({ where: { id: p.id }, data: { checkedAt: new Date() } });

  const want = BigInt(p.units);
  const transfers = await incoming(p.network, p.address, opened);
  // A confirming order waits only for its own transaction's block.
  if (p.status === 'confirming' && p.txHash) {
    const mine = transfers.find((t) => t.hash === p.txHash);
    return mine?.confirmed ? credit(p, p.txHash, 'confirmed') : p;
  }
  const open = await prisma.payment.findMany({
    where: { network: p.network, address: p.address, status: { in: ['pending', 'confirming'] }, createdAt: { gte: new Date(now - 48 * 3600_000) } },
    select: { id: true, units: true, createdAt: true, expiresAt: true },
  });
  for (const t of transfers.sort((a, b) => (a.time ?? now) - (b.time ?? now))) {
    if (t.units < want || t.units * 100n > want * 103n) {
      continue;
    }
    if (t.time !== undefined ? t.time < opened || t.time > closed : now > closed) {
      continue; // sent outside the window (or, unconfirmed, first seen after it)
    }
    if (await prisma.payment.findUnique({ where: { txHash: t.hash }, select: { id: true } })) {
      continue; // already some order's payment
    }
    // The order it fits best: the largest amount at or under it, open when it was sent.
    const sent = t.time ?? now;
    const best = open
      .filter((o) => BigInt(o.units) <= t.units && t.units * 100n <= BigInt(o.units) * 103n && sent >= o.createdAt.getTime() - 120_000 && sent <= o.expiresAt.getTime() + 60_000)
      .sort((a, b) => (BigInt(b.units) > BigInt(a.units) ? 1 : -1))[0];
    if (best?.id !== p.id) {
      continue;
    }
    if (network.needsBlock && !t.confirmed) {
      // Seen in time; credited once it's in a block.
      return prisma.payment.update({ where: { id: p.id }, data: { status: 'confirming', txHash: t.hash } });
    }
    return credit(p, t.hash);
  }
  return p;
}

/** The player's open orders, looked at again (a payment may have arrived since the game closed). */
export async function checkOpenOrders(userId: string) {
  const open = await prisma.payment.findMany({ where: { userId, status: { in: OPEN } }, orderBy: { createdAt: 'desc' }, take: 5 });
  for (const p of open) {
    try {
      await checkOrder(p);
    } catch {
      // a chain API is slow: next time
    }
  }
}

/** Admin: credit an order by hand (a payment the chains didn't show, a goodwill gift...). */
export async function adminCredit(id: string, txHash: string | undefined, admin: string) {
  const p = await prisma.payment.findUnique({ where: { id } });
  if (!p) {
    throw new ShopError(404, 'No such order');
  }
  if (p.status === 'paid') {
    return p;
  }
  return credit(p, txHash?.trim() || `manual:${p.id}`, `credited by ${admin}`);
}

export async function grant(username: string, bloom: number, admin: string) {
  const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } }, select: { id: true, username: true } });
  if (!user) {
    throw new ShopError(404, 'No such player');
  }
  await prisma.$transaction([
    prisma.farm.upsert({ where: { userId: user.id }, update: { credits: { increment: bloom } }, create: { userId: user.id, credits: bloom } }),
    prisma.farmEvent.create({ data: { userId: user.id, kind: 'gift', day: 0, data: { bloom, by: admin } } }),
  ]);
  return user;
}

export type { NetworkId };
