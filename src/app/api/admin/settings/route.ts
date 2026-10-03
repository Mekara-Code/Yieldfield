import { z } from 'zod';
import { authenticate } from '../../../../lib/auth';
import { prisma } from '../../../../lib/db';
import { json, problem, readBody } from '../../../../lib/http';
import { isNetwork, NETWORKS } from '../../../../lib/networks';
import { isAdmin } from '../../../../lib/players';
import { gemPacks } from '../../../../lib/game/engine';
import { DEFAULT_GEM_PACKS } from '../../../../lib/game/defs';
import { DEFAULT_VIP_PLANS, VipPlanSchema, vipPlans } from '../../../../lib/reputation';
import { PackSchema, shopSettings } from '../../../../lib/shop';

export const runtime = 'nodejs';

/** The shop's settings and the coins it can take (with what an address for each looks like). */
export async function GET(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  return json({
    ...(await shopSettings()),
    vipPlans: await vipPlans(),
    defaultVipPlans: DEFAULT_VIP_PLANS,
    gemPacks: await gemPacks(),
    defaultGemPacks: DEFAULT_GEM_PACKS,
    networks: Object.values(NETWORKS).map((n) => ({ id: n.id, label: n.label, asset: n.asset, example: n.address.source })),
  });
}

const Body = z.object({
  wallets: z.record(z.string(), z.string().trim().max(120)).optional(),
  packs: z.array(PackSchema).min(1).max(12).optional(),
  orderMinutes: z.number().int().min(3).max(60).optional(),
  vipPlans: z.array(VipPlanSchema).min(1).max(8).optional(),
  gemPacks: z.array(z.object({ id: z.string().regex(/^[a-z0-9_-]{1,24}$/), gems: z.number().int().min(1).max(10_000_000), bloom: z.number().int().min(1).max(10_000_000), tag: z.string().max(24).optional() })).min(1).max(8).optional(),
});

export async function PUT(request: Request) {
  const claims = await authenticate(request);
  if (!(await isAdmin(claims))) {
    return problem(403, 'Admins only');
  }
  const body = await readBody(request, Body);
  if ('response' in body) {
    return body.response;
  }
  const { wallets, packs, orderMinutes, vipPlans: plans, gemPacks: gems } = body.data;
  if (wallets) {
    for (const [id, address] of Object.entries(wallets)) {
      if (!isNetwork(id)) {
        return problem(400, `Unknown coin ${id}`);
      }
      if (address && !NETWORKS[id].address.test(address)) {
        return problem(400, `That doesn't look like a ${NETWORKS[id].label} address`);
      }
    }
    const clean = Object.fromEntries(Object.entries(wallets).filter(([, a]) => a));
    await prisma.setting.upsert({ where: { key: 'wallets' }, update: { value: clean }, create: { key: 'wallets', value: clean } });
  }
  if (packs) {
    if (new Set(packs.map((p) => p.id)).size !== packs.length) {
      return problem(400, 'Two packs have the same id');
    }
    await prisma.setting.upsert({ where: { key: 'packs' }, update: { value: packs }, create: { key: 'packs', value: packs } });
  }
  if (orderMinutes) {
    await prisma.setting.upsert({ where: { key: 'orderMinutes' }, update: { value: orderMinutes }, create: { key: 'orderMinutes', value: orderMinutes } });
  }
  if (plans) {
    if (new Set(plans.map((p) => p.id)).size !== plans.length) {
      return problem(400, 'Two VIP plans have the same id');
    }
    await prisma.setting.upsert({ where: { key: 'vipPlans' }, update: { value: plans }, create: { key: 'vipPlans', value: plans } });
  }
  if (gems) {
    if (new Set(gems.map((p) => p.id)).size !== gems.length) {
      return problem(400, 'Two gem packs have the same id');
    }
    await prisma.setting.upsert({ where: { key: 'gemPacks' }, update: { value: gems }, create: { key: 'gemPacks', value: gems } });
  }
  return json({ ...(await shopSettings()), vipPlans: await vipPlans(), gemPacks: await gemPacks() });
}
