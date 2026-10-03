import { z } from 'zod';
import { prisma } from './db';

/**
 * A player's standing in the valley. Reputation comes from what ties the farm to a real person: each
 * linked wallet, a linked Discord account, VIP while it lasts, and what the admins give (User.reputation,
 * which also keeps what was earned before tasks stopped giving it). It's worked out each time from those,
 * so unlinking takes it away again. It puts the player in a tier, and each tier allows more: better prices
 * and bigger orders at the traders, listings on the market (which needs MARKET_REPUTATION), and later
 * BLOOM withdrawals. VIP also gilds their name.
 */

/** Reputation each source gives. */
export const REPUTATION_SOURCES = { wallet: 25, discord: 50, vip: 600 };
/** Reputation it takes to sell or buy on the market. */
export const MARKET_REPUTATION = 600;

export interface Tier {
  id: string;
  name: string;
  /** Reputation it takes. */
  min: number;
  /** Percent the traders pay over the shipping bin. */
  traderBonus: number;
  /** Pieces each trader buys from them a day. */
  traderCap: number;
  /** BLOOM they may withdraw a day (when withdrawals open). */
  withdrawPerDay: number;
  /** Things they may list at once on the market (when it opens). */
  listings: number;
}

export const TIERS: Tier[] = [
  { id: 'newcomer', name: 'Newcomer', min: 0, traderBonus: 0, traderCap: 30, withdrawPerDay: 0, listings: 0 },
  { id: 'neighbor', name: 'Good Neighbor', min: 100, traderBonus: 2, traderCap: 45, withdrawPerDay: 0, listings: 2 },
  { id: 'trusted', name: 'Trusted Farmer', min: 300, traderBonus: 4, traderCap: 65, withdrawPerDay: 500, listings: 4 },
  { id: 'respected', name: 'Respected', min: 700, traderBonus: 6, traderCap: 90, withdrawPerDay: 2000, listings: 6 },
  { id: 'renowned', name: 'Renowned', min: 1500, traderBonus: 8, traderCap: 120, withdrawPerDay: 5000, listings: 10 },
  { id: 'legend', name: 'Valley Legend', min: 3000, traderBonus: 10, traderCap: 160, withdrawPerDay: 15000, listings: 20 },
];

/** What VIP adds on top of the tier (and its REPUTATION_SOURCES.vip). */
export const VIP_PERKS = {
  extraTasks: 1,
  traderBonus: 5,
  traderCapMultiplier: 1.5,
  withdrawMultiplier: 2,
  extraListings: 5,
};

export const VipPlanSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  days: z.number().int().min(1).max(3650),
  bloom: z.number().int().min(1).max(10_000_000),
  tag: z.string().max(24).optional(),
});
export type VipPlan = z.infer<typeof VipPlanSchema>;

export const DEFAULT_VIP_PLANS: VipPlan[] = [
  { id: 'vip7', days: 7, bloom: 600 },
  { id: 'vip30', days: 30, bloom: 1900, tag: 'Popular' },
  { id: 'vip90', days: 90, bloom: 4900, tag: 'Best value' },
];

export async function vipPlans(): Promise<VipPlan[]> {
  const row = await prisma.setting.findUnique({ where: { key: 'vipPlans' } });
  const plans = VipPlanSchema.array().safeParse(row?.value);
  return plans.success && plans.data.length ? plans.data : DEFAULT_VIP_PLANS;
}

export function tierFor(reputation: number) {
  let index = 0;
  while (index + 1 < TIERS.length && reputation >= TIERS[index + 1].min) {
    index++;
  }
  return index;
}

export function isVip(vipUntil: Date | null | undefined, now = new Date()) {
  return !!vipUntil && vipUntil > now;
}

/** What reputation is worked out from. */
export interface StandingSource {
  reputation: number;
  vipUntil: Date | null;
  discordId?: string | null;
  /** Wallets linked to the farm. */
  wallets?: number;
}

export const STANDING_SELECT = { reputation: true, vipUntil: true, discordId: true, _count: { select: { wallets: true } } } as const;

/** A user row read with STANDING_SELECT, as a StandingSource. */
export function sourceOf(user: { reputation: number; vipUntil: Date | null; discordId: string | null; _count: { wallets: number } }): StandingSource {
  return { reputation: user.reputation, vipUntil: user.vipUntil, discordId: user.discordId, wallets: user._count.wallets };
}

/** The player's reputation now, and where it comes from. */
export function reputationOf(user: StandingSource, now = new Date()) {
  const wallets = user.wallets ?? 0;
  const parts = {
    base: Math.max(0, user.reputation),
    wallets: wallets * REPUTATION_SOURCES.wallet,
    discord: user.discordId ? REPUTATION_SOURCES.discord : 0,
    vip: isVip(user.vipUntil, now) ? REPUTATION_SOURCES.vip : 0,
  };
  return { total: parts.base + parts.wallets + parts.discord + parts.vip, parts, walletCount: wallets, discord: !!user.discordId };
}

/** The tier's perks, with VIP's on top. */
export function perksOf(user: StandingSource) {
  const tier = TIERS[tierFor(reputationOf(user).total)];
  const vip = isVip(user.vipUntil);
  return {
    traderBonus: tier.traderBonus + (vip ? VIP_PERKS.traderBonus : 0),
    traderCap: Math.round(tier.traderCap * (vip ? VIP_PERKS.traderCapMultiplier : 1)),
    withdrawPerDay: tier.withdrawPerDay * (vip ? VIP_PERKS.withdrawMultiplier : 1),
    listings: tier.listings + (vip ? VIP_PERKS.extraListings : 0),
  };
}

/** Everything the game shows about it: the reputation and its sources, the tier, the next one, what they're allowed, VIP and its plans. */
export async function standing(user: StandingSource) {
  const rep = reputationOf(user);
  const index = tierFor(rep.total);
  const tier = TIERS[index];
  const next = TIERS[index + 1] ?? null;
  const vip = isVip(user.vipUntil);
  return {
    reputation: rep.total,
    sources: { ...rep.parts, walletCount: rep.walletCount, discordLinked: rep.discord, perWallet: REPUTATION_SOURCES.wallet, forDiscord: REPUTATION_SOURCES.discord, forVip: REPUTATION_SOURCES.vip },
    tier,
    next,
    progress: next ? (rep.total - tier.min) / (next.min - tier.min) : 1,
    vip,
    vipUntil: vip ? user.vipUntil!.toISOString() : null,
    perks: perksOf(user),
    market: { needs: MARKET_REPUTATION, open: rep.total >= MARKET_REPUTATION },
    tiers: TIERS,
    vipPerks: VIP_PERKS,
    vipPlans: await vipPlans(),
  };
}

export async function standingOf(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: STANDING_SELECT });
  return standing(sourceOf(user));
}

/** An admin's change: VIP days (negative takes them away) and reputation (added). */
export async function adjustPlayer(username: string, change: { vipDays?: number; reputation?: number }, by: string) {
  const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } });
  if (!user) {
    return null;
  }
  const data: { reputation?: number; vipUntil?: Date | null } = {};
  if (change.reputation) {
    data.reputation = Math.max(0, user.reputation + change.reputation);
  }
  if (change.vipDays) {
    const from = isVip(user.vipUntil) ? user.vipUntil!.getTime() : Date.now();
    const until = from + change.vipDays * 86_400_000;
    data.vipUntil = until > Date.now() ? new Date(until) : null;
  }
  const updated = await prisma.user.update({ where: { id: user.id }, data, select: { username: true, ...STANDING_SELECT } });
  await prisma.farmEvent.create({ data: { userId: user.id, kind: 'admin_adjust', day: 0, data: { by, vipDays: change.vipDays ?? 0, reputation: change.reputation ?? 0 } } });
  return { username: updated.username, standing: await standing(sourceOf(updated)) };
}
