import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { json, problem, readBody } from '../../../../lib/http';
import { isAdmin } from '../../../../lib/players';
import { DEFAULT_REFERRALS, referralSettings, saveReferralSettings } from '../../../../lib/referrals';
import { DEFAULT_X, saveXSettings, xConfig, xSettings } from '../../../../lib/xtasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function overview() {
  const [referrals, x, invited, rewards, claims] = await Promise.all([
    referralSettings(),
    xSettings(),
    prisma.user.count({ where: { referredById: { not: null } } }),
    prisma.referralReward.groupBy({ by: ['kind'], _sum: { amount: true }, _count: true }),
    prisma.xTaskClaim.groupBy({ by: ['task'], _sum: { coins: true }, _count: true }),
  ]);
  return {
    referrals,
    referralDefaults: DEFAULT_REFERRALS,
    x,
    xDefaults: DEFAULT_X,
    xSetup: { link: xConfig.configured, check: !!xConfig.bearer },
    stats: {
      invited,
      rewards: rewards.map((r) => ({ kind: r.kind, total: r._sum.amount ?? 0, count: r._count })),
      claims: claims.map((c) => ({ task: c.task, coins: c._sum.coins ?? 0, count: c._count })),
    },
  };
}

/** Referral and X settings, and how much they have paid out. */
export async function GET(request: Request) {
  if (!(await isAdmin(await authenticate(request)))) {
    return problem(403, 'Admins only');
  }
  return json(await overview());
}

const Coins = z.number().int().min(0).max(1_000_000);
const Settings = z.object({
  referrals: z.object({
    coinsPerInvite: Coins,
    maxRewarded: z.number().int().min(0).max(100_000),
    groupSize: z.number().int().min(1).max(1000),
    bloomPerGroup: Coins,
    activeLevel: z.number().int().min(1).max(100),
  }),
  x: z.object({
    enabled: z.boolean(),
    handle: z.string().trim().max(80),
    pageId: z.string().trim().max(30),
    postUrl: z.string().trim().max(300),
    coins: z.object({ connect: Coins, follow: Coins, like: Coins, share: Coins }),
  }),
});

export async function PUT(request: Request) {
  if (!(await isAdmin(await authenticate(request)))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Settings);
  if ('response' in body) {
    return body.response;
  }
  await saveReferralSettings(body.data.referrals);
  await saveXSettings(body.data.x);
  return json(await overview());
}
