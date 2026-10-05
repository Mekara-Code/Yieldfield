import { prisma } from './db';
import { addCurrency } from './currency';
import { levelForXp } from './game/defs';
import { isServerFarm, withDefaults, type Farm } from './game/state';

/**
 * Inviting players. Each player's link is <site>/ref=<their name> (the page there signs the newcomer up with
 * them as the inviter; the game's sign-up has an "invited by" field that does the same).
 *
 * For each of their first `maxRewarded` invitees (250) the inviter gets `coinsPerInvite` coins (2000) once
 * the invitee has played a little (reached `activeLevel`, so made-up accounts earn nothing), and for each
 * `groupSize` (5) of those who have bought VIP at least once, `bloomPerGroup` BLOOM (250). Invitees past
 * the 250 still show in the inviter's profile, with no reward. Admins change the numbers (/admin/social).
 *
 * Rewards are settled when an invitee levels up past activeLevel or buys VIP, and whenever the inviter
 * looks at their referrals; each is written down (ReferralReward) for the profile.
 */

export interface ReferralSettings {
  coinsPerInvite: number;
  maxRewarded: number;
  groupSize: number;
  bloomPerGroup: number;
  activeLevel: number;
}

export const DEFAULT_REFERRALS: ReferralSettings = { coinsPerInvite: 2000, maxRewarded: 250, groupSize: 5, bloomPerGroup: 250, activeLevel: 3 };

export async function referralSettings(): Promise<ReferralSettings> {
  const row = await prisma.setting.findUnique({ where: { key: 'referrals' } });
  return { ...DEFAULT_REFERRALS, ...((row?.value ?? {}) as Partial<ReferralSettings>) };
}

export async function saveReferralSettings(settings: ReferralSettings) {
  await prisma.setting.upsert({ where: { key: 'referrals' }, update: { value: { ...settings } }, create: { key: 'referrals', value: { ...settings } } });
}

/** The player's link: <origin>/ref=<name>. */
export function referralLink(origin: string, username: string) {
  return `${origin}/ref=${encodeURIComponent(username)}`;
}

/** At sign-up: whose invitation it was (a farmer's name, any case; nothing if there's no such farmer). */
export async function inviterFor(name: string | null | undefined) {
  const clean = (name ?? '').trim().replace(/^@/, '');
  if (!clean || clean.length > 40) {
    return null;
  }
  return prisma.user.findFirst({ where: { username: { equals: clean, mode: 'insensitive' } }, select: { id: true, username: true } });
}

/**
 * Coins onto a farm the server keeps (the state's coins and the column), alongside whatever the game is doing:
 * written only if the farm didn't change meanwhile, else read again. False if the farm isn't there.
 */
export async function creditFarmCoins(userId: string, amount: number) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await prisma.farm.findUnique({ where: { userId } });
    if (!row || !isServerFarm(row.state)) {
      return false;
    }
    const farm = withDefaults(structuredClone(row.state) as unknown as Farm);
    farm.coins += amount;
    const updated = await prisma.farm.updateMany({
      where: { id: row.id, revision: row.revision },
      data: { state: farm as unknown as object, revision: { increment: 1 }, coins: farm.coins },
    });
    if (updated.count === 1) {
      return true;
    }
  }
  return false;
}

function levelOf(state: unknown) {
  const xp = Number((state as { xp?: number } | null)?.xp ?? 0);
  return levelForXp(Number.isFinite(xp) ? xp : 0);
}

/** Pays the inviter what their invitees have earned them since last time. Returns what was paid now. */
export async function settleReferrals(inviterId: string) {
  const settings = await referralSettings();
  const invitees = await prisma.user.findMany({
    where: { referredById: inviterId },
    orderBy: [{ referredAt: 'asc' }, { createdAt: 'asc' }],
    take: settings.maxRewarded,
    select: { id: true, username: true, referralCoinsAt: true, vipBoughtAt: true, farm: { select: { state: true } } },
  });
  const nowActive = invitees.filter((i) => !i.referralCoinsAt && levelOf(i.farm?.state) >= settings.activeLevel);
  const vipCount = invitees.filter((i) => i.vipBoughtAt).length;
  const groups = Math.floor(vipCount / Math.max(1, settings.groupSize));
  let coins = 0;
  let bloom = 0;
  // Coins, one invitee at a time (marked first, so two settlements at once can't pay one twice).
  for (const invitee of nowActive) {
    const marked = await prisma.user.updateMany({ where: { id: invitee.id, referralCoinsAt: null }, data: { referralCoinsAt: new Date() } });
    if (marked.count !== 1) {
      continue;
    }
    if (await creditFarmCoins(inviterId, settings.coinsPerInvite)) {
      coins += settings.coinsPerInvite;
      await prisma.referralReward.create({ data: { userId: inviterId, kind: 'coins', amount: settings.coinsPerInvite, inviteeId: invitee.id, note: `${invitee.username} played` } });
    } else {
      await prisma.user.update({ where: { id: invitee.id }, data: { referralCoinsAt: null } });
    }
  }
  // BLOOM for every new group of VIP buyers.
  await prisma.$transaction(async (tx) => {
    const inviter = await tx.user.findUnique({ where: { id: inviterId }, select: { referralBloomGroups: true } });
    if (!inviter || groups <= inviter.referralBloomGroups) {
      return;
    }
    const owed = groups - inviter.referralBloomGroups;
    const moved = await tx.user.updateMany({ where: { id: inviterId, referralBloomGroups: inviter.referralBloomGroups }, data: { referralBloomGroups: groups } });
    if (moved.count !== 1) {
      return;
    }
    bloom = owed * settings.bloomPerGroup;
    await addCurrency(tx, inviterId, 'bloom', bloom, 'referrals', { vipInvitees: groups * settings.groupSize });
    await tx.referralReward.create({ data: { userId: inviterId, kind: 'bloom', amount: bloom, note: `${groups * settings.groupSize} invitees bought VIP` } });
  });
  if (coins || bloom) {
    await prisma.farmEvent.create({ data: { userId: inviterId, kind: 'referral_reward', day: 0, data: { coins, bloom } } });
  }
  return { coins, bloom };
}

/** After an invitee's action: settles their inviter if it might have earned something (fire and forget). */
export function afterInviteeAction(inviterId: string | null | undefined, levelBefore: number, levelAfter: number, boughtVip: boolean) {
  if (!inviterId) {
    return;
  }
  void referralSettings()
    .then((s) => (boughtVip || (levelBefore < s.activeLevel && levelAfter >= s.activeLevel) ? settleReferrals(inviterId) : null))
    .catch((error) => console.error('[referrals] settling failed', error));
}

/** The profile's referrals: the link, who was invited (the rewarded ones first), who bought VIP, what it paid. */
export async function referralView(userId: string, origin: string) {
  await settleReferrals(userId);
  const [settings, me, invitees, rewards] = await Promise.all([
    referralSettings(),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true, referralBloomGroups: true } }),
    prisma.user.findMany({
      where: { referredById: userId },
      orderBy: [{ referredAt: 'asc' }, { createdAt: 'asc' }],
      take: 2000,
      select: { username: true, character: true, referredAt: true, createdAt: true, referralCoinsAt: true, vipBoughtAt: true, farm: { select: { state: true } } },
    }),
    prisma.referralReward.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const totals = await prisma.referralReward.groupBy({ by: ['kind'], where: { userId }, _sum: { amount: true } });
  const sum = (kind: string) => totals.find((t) => t.kind === kind)?._sum.amount ?? 0;
  const rewarded = invitees.slice(0, settings.maxRewarded);
  const vipRewarded = rewarded.filter((i) => i.vipBoughtAt).length;
  return {
    link: referralLink(origin, me.username),
    settings,
    invited: invitees.length,
    active: invitees.filter((i) => i.referralCoinsAt).length,
    vip: invitees.filter((i) => i.vipBoughtAt).length,
    // Toward the next BLOOM: VIP buyers among the rewarded ones past the last full group.
    vipTowardNext: vipRewarded % settings.groupSize,
    rewardsLeft: Math.max(0, settings.maxRewarded - invitees.length),
    earned: { coins: sum('coins'), bloom: sum('bloom') },
    invitees: invitees.map((i, n) => ({
      username: i.username,
      character: i.character,
      joinedAt: (i.referredAt ?? i.createdAt).toISOString(),
      level: levelOf(i.farm?.state),
      vip: !!i.vipBoughtAt,
      rewarded: n < settings.maxRewarded,
      coinsPaid: !!i.referralCoinsAt,
    })),
    rewards: rewards.map((r) => ({ kind: r.kind, amount: r.amount, note: r.note, at: r.createdAt.toISOString() })),
  };
}
