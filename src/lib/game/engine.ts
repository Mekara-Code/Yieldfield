import { prisma } from '../db';
import { changeCurrency } from '../currency';
import { isVip, standing, vipPlans, VIP_PERKS } from '../reputation';
import { allBonus, ensureTasks, taskCoins, today, type Task } from '../tasks';
import { DEFAULT_GEM_PACKS, publicDefs, type GemPack } from './defs';
import { addXp, apply, type Action, type Outcome, type Signal } from './rules';
import { isServerFarm, migrate, newFarm, type Farm } from './state';

/**
 * Doing an action for a player: the farm (and their BLOOM, gems and reputation) as the server has
 * them are read, the action is applied to a copy, the daily tasks it moves are counted (and claimed
 * when done), and everything is written in one transaction, only if nothing else changed the farm in
 * between (the revision; otherwise it's done again on the new farm). An action carries an id: sent
 * again (its answer lost on the way), it isn't done twice. Nothing reaches the game until it's stored.
 */

export const nowSeconds = () => Math.floor(Date.now() / 1000);

class Conflict extends Error {}
class Short extends Error {}

export async function gemPacks(): Promise<GemPack[]> {
  const row = await prisma.setting.findUnique({ where: { key: 'gemPacks' } });
  const packs = row?.value as GemPack[] | undefined;
  return Array.isArray(packs) && packs.length ? packs : DEFAULT_GEM_PACKS;
}

/** The farm as the game is sent it (all of it but the action ids). */
export function publicFarm(farm: Farm) {
  const { recent: _recent, ...rest } = farm;
  return rest;
}

/** Starts a new day's counts when the (UTC) day has turned. */
function rollDay(farm: Farm, day: string) {
  if (farm.taskDay !== day) {
    farm.taskDay = day;
    farm.taskProgress = {};
    farm.traderSales = {};
    return true;
  }
  return false;
}

/** Counts signals toward today's tasks; claims those done (and the all-done bonus): their experience and coins go on the farm. */
function countTasks(farm: Farm, tasks: Task[], claimed: Set<string>, signals: Signal[], reputationMultiplier: number, out: Outcome) {
  for (const s of signals) {
    for (const t of tasks) {
      if (claimed.has(t.id) || t.kind !== s.kind || (s.kind === 'deliver' && (t.item !== s.item || t.trader !== s.trader))) {
        continue;
      }
      farm.taskProgress[t.id] = Math.min((farm.taskProgress[t.id] ?? 0) + s.count, t.count);
    }
  }
  const claims: { taskId: string; xp: number; reputation: number }[] = [];
  let gems = 0;
  for (const t of tasks) {
    if (!claimed.has(t.id) && (farm.taskProgress[t.id] ?? 0) >= t.count) {
      const reputation = Math.round(t.reputation * reputationMultiplier);
      const coins = taskCoins(t);
      addXp(farm, t.xp, out);
      farm.coins += coins;
      claims.push({ taskId: t.id, xp: t.xp, reputation });
      claimed.add(t.id);
      out.notices.push(`Task done: ${t.title}  ·  +${t.xp} XP  ·  +${coins} coins  ·  +${reputation} reputation`);
      out.events.push({ kind: 'task', data: { task: t.title, xp: t.xp, coins, reputation } });
    }
  }
  if (claims.length && tasks.every((t) => claimed.has(t.id)) && !claimed.has('all')) {
    const bonus = allBonus(farm);
    const reputation = Math.round(bonus.reputation * reputationMultiplier);
    addXp(farm, bonus.xp, out);
    gems += bonus.gems;
    claims.push({ taskId: 'all', xp: bonus.xp, reputation });
    claimed.add('all');
    out.notices.push(`All of today's tasks done!  +${bonus.xp} XP  ·  +${bonus.gems} gems  ·  +${reputation} reputation`);
    out.events.push({ kind: 'task', data: { task: 'all', xp: bonus.xp, gems: bonus.gems, reputation } });
  }
  return { claims, gems, reputation: claims.reduce((n, c) => n + c.reputation, 0) };
}

function taskView(farm: Farm, claimed: Set<string>) {
  return { day: farm.taskDay, progress: farm.taskProgress, claimed: [...claimed] };
}

/** The farm for the game at sign-in: a save from before the server kept the farm is taken over now. */
export async function loadGame(userId: string) {
  const now = nowSeconds();
  const [row, user, packs] = await Promise.all([
    prisma.farm.findUnique({ where: { userId } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bloom: true, gems: true } }),
    gemPacks(),
  ]);
  let state = row?.state ?? null;
  let revision = row?.revision ?? 0;
  if (row && state && !isServerFarm(state)) {
    const farm = migrate(state as Record<string, unknown>, now);
    rollDay(farm, today());
    const saved = await prisma.farm.update({ where: { id: row.id }, data: { state: farm as unknown as object, revision: { increment: 1 }, coins: farm.coins, day: farm.day } });
    state = farm as unknown as typeof state;
    revision = saved.revision;
  }
  return {
    state: state && isServerFarm(state) ? publicFarm(state) : null,
    revision,
    wallet: { coins: state && isServerFarm(state) ? state.coins : 0, bloom: user.bloom, gems: user.gems },
    now,
    defs: publicDefs(packs),
  };
}

/** A new farm (the beds of the level the game has): only when there's none yet. */
export async function startGame(userId: string, plots: number[], starter: number) {
  const row = await prisma.farm.findUnique({ where: { userId } });
  if (!row || !row.state) {
    const farm = newFarm(plots, starter);
    farm.taskDay = today();
    await prisma.farm.upsert({
      where: { userId },
      update: { state: farm as unknown as object, revision: { increment: 1 }, coins: farm.coins, day: farm.day },
      create: { userId, state: farm as unknown as object, coins: farm.coins, day: farm.day },
    });
    await prisma.farmEvent.create({ data: { userId, kind: 'start', day: 1, data: {} } });
  }
  return loadGame(userId);
}

export type ActResult = { status: number; body: Record<string, unknown> };

export async function performAction(userId: string, actionId: string, action: Action): Promise<ActResult> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const now = nowSeconds();
    const [row, user] = await Promise.all([
      prisma.farm.findUnique({ where: { userId } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bloom: true, gems: true, reputation: true, vipUntil: true, character: true } }),
    ]);
    if (!row || !isServerFarm(row.state)) {
      return { status: 409, body: { error: 'Your farm isn\'t loaded yet', code: 'no_farm' } };
    }
    const before = row.state;
    const vip = isVip(user.vipUntil);
    const { tasks, claimed } = await ensureTasks(userId, before, vip);
    const view = (farm: Farm, bloom = user.bloom, gems = user.gems, extra: Record<string, unknown> = {}, claims = claimed) => ({
      state: publicFarm(farm),
      revision: row.revision,
      wallet: { coins: farm.coins, bloom, gems },
      tasks: taskView(farm, claims),
      now,
      ...extra,
    });
    if (before.recent?.includes(actionId)) {
      return { status: 200, body: { ok: true, replay: true, notices: [], result: {}, ...view(before) } };
    }
    const farm = structuredClone(before) as Farm;
    farm.recent ??= [];
    rollDay(farm, today());
    const st = await standing(user);
    const [plans, packs] = await Promise.all([vipPlans(), gemPacks()]);
    const out = apply(farm, action, {
      now,
      character: user.character,
      bloom: user.bloom,
      gems: user.gems,
      traderBonus: st.perks.traderBonus,
      traderCap: st.perks.traderCap,
      tasks,
      claimed,
      vipPlans: plans,
      gemPacks: packs,
    });
    if (out.error) {
      return { status: 422, body: { error: out.error, code: 'refused', ...view(before) } };
    }
    const claimedNow = new Set(claimed);
    const done = countTasks(farm, tasks, claimedNow, out.signals, vip ? VIP_PERKS.reputationMultiplier : 1, out);
    farm.recent = [...farm.recent, actionId].slice(-40);
    const gemsChange = out.gems + done.gems;
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const updated = await tx.farm.updateMany({
          where: { id: row.id, revision: row.revision },
          data: { state: farm as unknown as object, revision: { increment: 1 }, coins: farm.coins, day: farm.day },
        });
        if (updated.count === 0) {
          throw new Conflict();
        }
        let bloom = user.bloom;
        let gems = user.gems;
        const why = { action: action.type };
        if (out.bloom) {
          const changed = await changeCurrency(tx, userId, 'bloom', out.bloom, action.type, why);
          if (!changed) {
            throw new Short('Not enough BLOOM');
          }
          bloom = changed.bloom;
          gems = changed.gems;
        }
        if (gemsChange) {
          const changed = await changeCurrency(tx, userId, 'gems', gemsChange, out.gems ? action.type : 'tasks', why);
          if (!changed) {
            throw new Short('Not enough gems');
          }
          bloom = changed.bloom;
          gems = changed.gems;
        }
        let vipUntil = user.vipUntil;
        if (done.reputation || out.vipDays) {
          const from = isVip(user.vipUntil) ? user.vipUntil!.getTime() : Date.now();
          const next = await tx.user.update({
            where: { id: userId },
            data: {
              ...(done.reputation ? { reputation: { increment: done.reputation } } : {}),
              ...(out.vipDays ? { vipUntil: new Date(from + out.vipDays * 86_400_000) } : {}),
            },
            select: { vipUntil: true },
          });
          vipUntil = next.vipUntil;
        }
        if (done.claims.length) {
          await tx.taskClaim.createMany({ data: done.claims.map((c) => ({ userId, day: farm.taskDay, ...c })) });
        }
        if (out.events.length) {
          await tx.farmEvent.createMany({ data: out.events.map((e) => ({ userId, kind: e.kind, day: farm.day, data: e.data })) });
        }
        // The site's list of animals, when one came or went.
        if (action.type === 'buy_animal' || action.type === 'leather') {
          const ids = farm.animals.map((a) => a.id);
          await tx.animal.deleteMany({ where: { farmId: row.id, id: { notIn: ids } } });
          for (const a of farm.animals) {
            const fields = { kind: a.kind, name: a.name, boughtDay: farm.day, lastMilkedDay: 0, lastShornDay: 0, xp: a.xp };
            await tx.animal.upsert({ where: { id: a.id }, update: { name: a.name, xp: a.xp }, create: { id: a.id, farmId: row.id, ...fields } });
          }
        }
        return { bloom, gems, vipUntil, revision: row.revision + 1 };
      });
      const changedStanding = done.reputation || out.vipDays
        ? await standing({ reputation: user.reputation + done.reputation, vipUntil: saved.vipUntil })
        : undefined;
      return {
        status: 200,
        body: {
          ok: true,
          notices: out.notices,
          result: out.result,
          ...view(farm, saved.bloom, saved.gems, { revision: saved.revision }, claimedNow),
          ...(changedStanding ? { standing: changedStanding } : {}),
        },
      };
    } catch (error) {
      if (error instanceof Conflict) {
        continue; // the farm changed meanwhile: again, on the new farm
      }
      if (error instanceof Short) {
        return { status: 422, body: { error: error.message, code: 'refused', ...view(before) } };
      }
      throw error;
    }
  }
  return { status: 409, body: { error: 'The farm is busy: try again', code: 'busy' } };
}
