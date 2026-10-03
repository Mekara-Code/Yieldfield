import {
  ANIMAL_XP,
  animalExtra,
  animalLevel,
  BUILDINGS,
  COMPANION_LEVEL,
  COMPANION_PRICE,
  CROPS,
  ENERGY,
  FED_SECONDS,
  findAnimal,
  findBuilding,
  findCrop,
  GEMS_PER_MINUTE,
  type GemPack,
  harvestXp,
  item,
  levelForXp,
  MAX_ENERGY,
  MAX_FED_AHEAD,
  maxPlotsAt,
  SLEEP_SECONDS,
  nextPlotPrice,
  TRADERS,
  XP,
  type AnimalKind,
} from './defs';
import { feed, growth, isDry, isRipe, newAnimal, productReady, remaining, woolReady, type Animal, type Farm, type Plot } from './state';
import type { Task } from '../tasks';
import type { VipPlan } from '../reputation';

/**
 * What each action does to a farm: the only place anything of value changes. apply() checks the action
 * against the farm and the server's clock, changes the farm (a copy: nothing is kept unless it all
 * goes through), and says what it cost in BLOOM and gems, what to tell the player, what happened (the
 * activity feed) and what counts toward the daily tasks.
 */

export type Action =
  | { type: 'clock'; hour: number; selected?: string }
  | { type: 'till' | 'water' | 'harvest' | 'buy_plot'; plot: number }
  | { type: 'plant'; plot: number; crop: string }
  | { type: 'build'; building: string }
  | { type: 'buy_seeds'; crop: string; count: number }
  | { type: 'buy_animal'; kind: AnimalKind }
  | { type: 'milk' | 'shear' | 'feed' | 'leather'; animal: string }
  | { type: 'collect_eggs' | 'sell_all' | 'eat' | 'marry' }
  | { type: 'trade'; trader: string }
  | { type: 'sleep'; passedOut?: boolean }
  | { type: 'buy_vip'; plan: string }
  | { type: 'buy_gems'; pack: string }
  | { type: 'speedup'; target: 'plot' | 'product' | 'wool'; id: string };

export interface Ctx {
  now: number;
  character: string | null;
  bloom: number;
  gems: number;
  traderBonus: number;
  traderCap: number;
  /** Today's tasks (and which are claimed), for the traders' orders. */
  tasks: Task[];
  claimed: Set<string>;
  vipPlans: VipPlan[];
  gemPacks: GemPack[];
}

export interface Signal {
  kind: string;
  count: number;
  item?: string;
  trader?: string;
}

export interface Outcome {
  error?: string;
  notices: string[];
  bloom: number;
  gems: number;
  events: { kind: string; data: Record<string, string | number | boolean> }[];
  signals: Signal[];
  result: Record<string, unknown>;
  vipDays?: number;
}

const HEN_NAMES = ['Pip', 'Hazel', 'Nugget', 'Pepper', 'Clover', 'Maple', 'Biscuit', 'Poppy', 'Ginger', 'Olive'];
const SHEEP_NAMES = ['Woolly', 'Misty', 'Pebble', 'Cotton', 'Juniper', 'Willow', 'Fern'];
const COW_NAMES = ['Bella', 'Daisy', 'Buttercup', 'Luna', 'Honey', 'Marigold', 'Clementine'];

class Refused extends Error {}

const plural = (n: number, one: string, many: string) => (n === 1 ? `${n} ${one}` : `${n} ${many}`);

export function apply(farm: Farm, action: Action, ctx: Ctx): Outcome {
  const out: Outcome = { notices: [], bloom: 0, gems: 0, events: [], signals: [], result: {} };
  try {
    run(farm, action, ctx, out);
  } catch (error) {
    if (error instanceof Refused) {
      return { ...out, error: error.message };
    }
    throw error;
  }
  return out;
}

function refuse(message: string): never {
  throw new Refused(message);
}

function bonus(farm: Farm) {
  return farm.companion ? 2 : 1;
}

function useEnergy(farm: Farm, kind: string) {
  const cost = ENERGY[kind] ?? 0;
  if (farm.energy < cost) {
    refuse('Too tired: eat something in the kitchen, or sleep');
  }
  farm.energy = Math.max(0, farm.energy - cost);
}

function unlocks(level: number) {
  const opens: string[] = [];
  if (maxPlotsAt(level) > maxPlotsAt(level - 1)) {
    opens.push(`up to ${maxPlotsAt(level)} beds`);
  }
  for (const b of BUILDINGS) {
    if (b.level === level) {
      opens.push(`the ${b.name} can be built`);
    }
  }
  if (level === findAnimal('Cow')!.level) {
    opens.push('cows');
  }
  if (level === COMPANION_LEVEL) {
    opens.push('the matchmaker');
  }
  return opens.join(', ');
}

/** Experience (doubled with a husband or wife); each new level brings coins. */
export function addXp(farm: Farm, amount: number, out: Outcome) {
  if (amount <= 0) {
    return;
  }
  const before = levelForXp(farm.xp);
  farm.xp += amount * bonus(farm);
  const after = levelForXp(farm.xp);
  for (let level = before + 1; level <= after; level++) {
    const gift = 25 * level;
    farm.coins += gift;
    const opens = unlocks(level);
    out.notices.push(`Level ${level}! +${gift} coins${opens ? `  ·  ${opens}` : ''}`);
    out.events.push({ kind: 'level', data: { level } });
  }
}

function animalXp(a: Animal, amount: number, out: Outcome) {
  const before = animalLevel(a.xp);
  a.xp += amount;
  const after = animalLevel(a.xp);
  if (after > before) {
    const more = Math.floor(after / 10) > Math.floor(before / 10);
    const what = a.kind === 'Chicken' ? 'one more egg each time' : a.kind === 'Cow' ? 'one more milk each milking' : 'one more milk and wool';
    out.notices.push(more ? `${a.name} reached level ${after}! From now on: ${what}` : `${a.name} reached level ${after}`);
  }
}

function plotAt(farm: Farm, index: number): Plot {
  const plot = farm.plots.find((p) => p.index === index);
  if (!plot) {
    refuse('No such bed');
  }
  return plot;
}

function ownedPlot(farm: Farm, index: number) {
  const plot = plotAt(farm, index);
  if (!farm.ownedPlots.includes(index)) {
    refuse('That bed is for sale');
  }
  return plot;
}

function animalById(farm: Farm, id: string) {
  const animal = farm.animals.find((a) => a.id === id);
  if (!animal) {
    refuse('That animal isn\'t on your farm');
  }
  return animal;
}

function take(map: Record<string, number>, id: string, count: number) {
  const left = (map[id] ?? 0) - count;
  if (left < 0) {
    refuse('Not enough');
  }
  if (left === 0) {
    delete map[id];
  } else {
    map[id] = left;
  }
}

function give(map: Record<string, number>, id: string, count: number) {
  map[id] = (map[id] ?? 0) + count;
}

function spendCoins(farm: Farm, amount: number, what: string) {
  if (farm.coins < amount) {
    refuse(`${what} costs ${amount} coins (you have ${farm.coins})`);
  }
  farm.coins -= amount;
}

function spendBloom(ctx: Ctx, out: Outcome, amount: number, what: string) {
  if (ctx.bloom + out.bloom < amount) {
    refuse(`${what} costs ${amount} BLOOM (you have ${ctx.bloom + out.bloom})`);
  }
  out.bloom -= amount;
}

function spendGems(ctx: Ctx, out: Outcome, amount: number, what: string) {
  if (ctx.gems + out.gems < amount) {
    refuse(`${what} takes ${amount} gems (you have ${ctx.gems + out.gems})`);
  }
  out.gems -= amount;
}

/** As the game writes it: "5h 12m", "12m 30s", "30s". */
function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Gems it takes to finish something seconds early. */
export function speedupCost(seconds: number) {
  return Math.max(1, Math.ceil(seconds / 60)) * GEMS_PER_MINUTE;
}

function sellValue(id: string, count: number, bonusPercent = 0) {
  const info = item(id);
  return info ? Math.round((info.sell * count * (100 + bonusPercent)) / 100) : 0;
}

function run(farm: Farm, action: Action, ctx: Ctx, out: Outcome) {
  const now = ctx.now;
  switch (action.type) {
    case 'clock': {
      farm.hour = Math.min(Math.max(action.hour, 0), 30);
      if (action.selected && findCrop(action.selected)) {
        farm.selected = action.selected;
      }
      return;
    }
    case 'till': {
      const plot = ownedPlot(farm, action.plot);
      if (plot.state !== 0) {
        refuse('That bed is dug already');
      }
      useEnergy(farm, 'till');
      plot.state = 1;
      addXp(farm, XP.till, out);
      return;
    }
    case 'plant': {
      const plot = ownedPlot(farm, action.plot);
      const crop = findCrop(action.crop);
      if (!crop) {
        refuse('No such seeds');
      }
      if (plot.state !== 1) {
        refuse(plot.state === 0 ? 'Dig the bed first' : 'Something grows there already');
      }
      if ((farm.seeds[crop.id] ?? 0) < 1) {
        refuse(`No ${crop.name} seeds: buy some at the seed shop`);
      }
      useEnergy(farm, 'plant');
      take(farm.seeds, crop.id, 1);
      Object.assign(plot, { state: 2, crop: crop.id, plantedAt: now, grown: 0, grownAt: now, wetUntil: 0 });
      farm.selected = crop.id;
      addXp(farm, XP.plant, out);
      out.signals.push({ kind: 'plant', count: 1 });
      out.events.push({ kind: 'plant', data: { crop: crop.id } });
      return;
    }
    case 'water': {
      const plot = ownedPlot(farm, action.plot);
      const crop = findCrop(plot.crop);
      if (plot.state !== 2 || !crop) {
        refuse('Nothing to water');
      }
      if (isRipe(plot, now)) {
        refuse('It\'s ripe: harvest it');
      }
      if (!isDry(plot, now)) {
        refuse(`Still wet: water again in ${duration(plot.wetUntil - now)}`);
      }
      useEnergy(farm, 'water');
      plot.grown = growth(plot, now);
      plot.grownAt = now;
      plot.wetUntil = now + crop.water;
      addXp(farm, XP.water, out);
      out.signals.push({ kind: 'water', count: 1 });
      return;
    }
    case 'harvest': {
      const plot = ownedPlot(farm, action.plot);
      const crop = findCrop(plot.crop);
      if (!crop || !isRipe(plot, now)) {
        refuse('Not ripe yet');
      }
      useEnergy(farm, 'harvest');
      const count = crop.yield * bonus(farm);
      give(farm.produce, crop.id, count);
      Object.assign(plot, { state: 1, crop: '', plantedAt: 0, grown: 0, grownAt: 0, wetUntil: 0 });
      addXp(farm, harvestXp(crop), out);
      out.notices.push(bonus(farm) > 1 ? `+${count} ${crop.name} (together: twice the harvest)` : `+${count} ${crop.name}`);
      out.signals.push({ kind: 'harvest', count: 1 });
      out.events.push({ kind: 'harvest', data: { crop: crop.id, count } });
      return;
    }
    case 'buy_plot': {
      plotAt(farm, action.plot);
      if (farm.ownedPlots.includes(action.plot)) {
        refuse('That bed is yours already');
      }
      const level = levelForXp(farm.xp);
      if (farm.ownedPlots.length >= maxPlotsAt(level)) {
        let need = level;
        while (need < 50 && maxPlotsAt(need) <= farm.ownedPlots.length) {
          need++;
        }
        refuse(`Reach level ${need} for another bed`);
      }
      const price = nextPlotPrice(farm.ownedPlots.length);
      spendCoins(farm, price, 'A new bed');
      farm.ownedPlots.push(action.plot);
      addXp(farm, XP.bed, out);
      out.notices.push(`A new bed! You have ${farm.ownedPlots.length} now`);
      out.events.push({ kind: 'buy_bed', data: { bed: farm.ownedPlots.length, cost: price } });
      return;
    }
    case 'build': {
      const b = findBuilding(action.building);
      if (!b) {
        refuse('Nothing to build here');
      }
      if (farm.buildings.includes(b.id)) {
        refuse(`The ${b.name} is up`);
      }
      if (levelForXp(farm.xp) < b.level) {
        refuse(`Reach level ${b.level} to build it`);
      }
      spendCoins(farm, b.price, `The ${b.name}`);
      farm.buildings.push(b.id);
      addXp(farm, XP.building, out);
      out.notices.push(`The ${b.name} is built! ${b.gives}`);
      out.events.push({ kind: 'build', data: { building: b.id, cost: b.price } });
      return;
    }
    case 'buy_seeds': {
      const crop = findCrop(action.crop);
      if (!crop) {
        refuse('No such seeds');
      }
      const count = Math.min(Math.max(Math.floor(action.count), 1), 99);
      spendCoins(farm, crop.seed * count, `${count} ${crop.name} seeds`);
      give(farm.seeds, crop.id, count);
      farm.selected = crop.id;
      out.notices.push(`Bought ${count} ${crop.name} seeds`);
      out.events.push({ kind: 'buy_seeds', data: { crop: crop.id, count, cost: crop.seed * count } });
      return;
    }
    case 'buy_animal': {
      const def = findAnimal(action.kind);
      if (!def) {
        refuse('No such animal');
      }
      if (!farm.buildings.includes(def.home)) {
        const home = findBuilding(def.home)!;
        refuse(`Build the ${home.name} first (level ${home.level})`);
      }
      if (levelForXp(farm.xp) < def.level) {
        refuse(`${def.name}s from level ${def.level}`);
      }
      if (farm.animals.filter((a) => a.kind === def.kind).length >= def.capacity) {
        refuse(def.kind === 'Chicken' ? 'The hen house is full' : 'No more room in the paddock');
      }
      spendCoins(farm, def.price, `A ${def.name.toLowerCase()}`);
      const names = def.kind === 'Chicken' ? HEN_NAMES : def.kind === 'Sheep' ? SHEEP_NAMES : COW_NAMES;
      const free = names.filter((n) => !farm.animals.some((a) => a.name === n));
      const name = free.length ? free[Math.floor(Math.random() * free.length)] : `${names[0]} ${farm.animals.length + 1}`;
      const animal = newAnimal(def.kind, name, now);
      farm.animals.push(animal);
      addXp(farm, XP.buyAnimal, out);
      out.result.animal = animal.id;
      out.notices.push(`${name} joins the farm: fed for today, then she eats ${def.feedCount} ${item(def.feed)!.name.toLowerCase()} a day`);
      out.events.push({ kind: 'buy_animal', data: { kind: def.kind === 'Chicken' ? 'Hen' : def.kind, name, cost: def.price } });
      return;
    }
    case 'milk': {
      const a = animalById(farm, action.animal);
      const def = findAnimal(a.kind)!;
      if (a.kind === 'Chicken') {
        refuse('Hens lay in the hen house');
      }
      if (!productReady(a, now)) {
        refuse(now >= a.fedUntil ? `${a.name} is hungry: feed her first` : `Milk in ${duration(remaining(a.cycleStart, a.readyAt, a.fedUntil, now))}`);
      }
      useEnergy(farm, 'milk');
      const count = (def.count + animalExtra(a.xp)) * bonus(farm);
      give(farm.produce, def.product, count);
      a.cycleStart = now;
      a.readyAt = now + def.cycle;
      addXp(farm, XP.milk, out);
      animalXp(a, ANIMAL_XP.milk, out);
      out.notices.push(`${a.name}: +${count} ${item(def.product)!.name.toLowerCase()}`);
      out.signals.push({ kind: 'milk', count: 1 });
      out.events.push({ kind: 'collect', data: { item: def.product, count, from: a.name } });
      return;
    }
    case 'shear': {
      const a = animalById(farm, action.animal);
      const def = findAnimal(a.kind)!;
      if (!def.wool) {
        refuse('Only sheep have wool');
      }
      if (!woolReady(a, now)) {
        refuse(now >= a.fedUntil ? `${a.name} is hungry: feed her first` : `Wool in ${duration(remaining(a.woolStart, a.woolReadyAt, a.fedUntil, now))}`);
      }
      useEnergy(farm, 'shear');
      const count = (def.wool.count + animalExtra(a.xp)) * bonus(farm);
      give(farm.produce, 'Wool', count);
      a.woolStart = now;
      a.woolReadyAt = now + def.wool.cycle;
      addXp(farm, XP.shear, out);
      animalXp(a, ANIMAL_XP.shear, out);
      out.notices.push(`${a.name}: +${count} wool`);
      out.signals.push({ kind: 'shear', count: 1 });
      out.events.push({ kind: 'collect', data: { item: 'Wool', count, from: a.name } });
      return;
    }
    case 'collect_eggs': {
      const hens = farm.animals.filter((a) => a.kind === 'Chicken' && productReady(a, now));
      if (!hens.length) {
        refuse('No eggs yet');
      }
      useEnergy(farm, 'collect_eggs');
      const def = findAnimal('Chicken')!;
      let laid = 0;
      for (const hen of hens) {
        laid += def.count + animalExtra(hen.xp);
        hen.cycleStart = now;
        hen.readyAt = now + def.cycle;
        animalXp(hen, ANIMAL_XP.eggs, out);
      }
      const count = laid * bonus(farm);
      give(farm.produce, 'Egg', count);
      addXp(farm, XP.eggPer * laid, out);
      out.notices.push(`+${plural(count, 'egg', 'eggs')}`);
      out.signals.push({ kind: 'eggs', count });
      out.events.push({ kind: 'collect', data: { item: 'Egg', count, from: 'the hen house' } });
      return;
    }
    case 'feed': {
      const a = animalById(farm, action.animal);
      const def = findAnimal(a.kind)!;
      const food = item(def.feed)!.name.toLowerCase();
      if ((farm.produce[def.feed] ?? 0) < def.feedCount) {
        refuse(`${a.name} eats ${def.feedCount} ${food}: grow some (you have ${farm.produce[def.feed] ?? 0})`);
      }
      const wasHungry = now >= a.fedUntil;
      if (!feed(a, now, FED_SECONDS, MAX_FED_AHEAD)) {
        refuse(`${a.name} is full: feed her again in ${duration(a.fedUntil - now - FED_SECONDS + 60)}`);
      }
      useEnergy(farm, 'feed');
      take(farm.produce, def.feed, def.feedCount);
      addXp(farm, XP.feed, out);
      animalXp(a, ANIMAL_XP.feed, out);
      out.notices.push(wasHungry ? `${a.name} ate ${def.feedCount} ${food}: no longer hungry` : `${a.name} ate ${def.feedCount} ${food}: fed for longer`);
      out.signals.push({ kind: 'feed', count: 1 });
      out.events.push({ kind: 'feed', data: { name: a.name, item: def.feed, count: def.feedCount } });
      return;
    }
    case 'leather': {
      const a = animalById(farm, action.animal);
      if (a.kind !== 'Cow') {
        refuse('Only cows go to the tannery');
      }
      const count = (2 + animalExtra(a.xp)) * bonus(farm);
      give(farm.produce, 'Leather', count);
      farm.animals = farm.animals.filter((x) => x.id !== a.id);
      addXp(farm, XP.leather, out);
      out.notices.push(`${a.name} went to the tannery: +${count} leather`);
      out.events.push({ kind: 'leather', data: { name: a.name, count } });
      return;
    }
    case 'sell_all': {
      let value = 0;
      let pieces = 0;
      for (const [id, count] of Object.entries(farm.produce)) {
        value += sellValue(id, count);
        pieces += count;
      }
      if (!pieces) {
        refuse('Your basket is empty');
      }
      farm.produce = {};
      farm.coins += value;
      addXp(farm, Math.floor(value / 10), out);
      out.notices.push(`Sold ${pieces} pieces for ${value} coins`);
      out.signals.push({ kind: 'sell', count: value });
      out.events.push({ kind: 'sell', data: { pieces, coins: value } });
      return;
    }
    case 'trade': {
      const trader = TRADERS[action.trader];
      if (!trader) {
        refuse('No such trader');
      }
      const goods = trader.buys === 'crops' ? CROPS.map((c) => c.id) : trader.buys;
      let coins = 0;
      let pieces = 0;
      // Their order of the day first (it doesn't count against the day's limit)...
      const order = ctx.tasks.find((t) => t.kind === 'deliver' && t.trader === action.trader && !ctx.claimed.has(t.id));
      if (order && order.item) {
        const left = Math.max(order.count - (farm.taskProgress[order.id] ?? 0), 0);
        const n = Math.min(left, farm.produce[order.item] ?? 0);
        if (n > 0) {
          take(farm.produce, order.item, n);
          coins += sellValue(order.item, n, ctx.traderBonus);
          pieces += n;
          out.signals.push({ kind: 'deliver', count: n, item: order.item, trader: action.trader });
        }
      }
      // ...then what else they buy, as far as the day's limit goes.
      let room = Math.max(ctx.traderCap - (farm.traderSales[action.trader] ?? 0), 0);
      let leftOver = false;
      for (const id of goods) {
        const have = farm.produce[id] ?? 0;
        const n = Math.min(have, room);
        if (n > 0) {
          take(farm.produce, id, n);
          coins += sellValue(id, n, ctx.traderBonus);
          room -= n;
          pieces += n;
          farm.traderSales[action.trader] = (farm.traderSales[action.trader] ?? 0) + n;
        }
        leftOver ||= have > n;
      }
      if (!pieces) {
        refuse(leftOver ? `${trader.name} can't take more today: a better reputation (or VIP) lets you sell more` : `Nothing ${trader.name} buys in your basket`);
      }
      farm.coins += coins;
      addXp(farm, Math.floor(coins / 10), out);
      out.notices.push(`${trader.name} paid ${coins} coins for ${plural(pieces, 'piece', 'pieces')}${ctx.traderBonus > 0 ? `  (+${ctx.traderBonus}%)` : ''}${leftOver ? `  ·  that's all ${trader.name} takes today` : ''}`);
      out.signals.push({ kind: 'sell', count: coins });
      out.result.coins = coins;
      out.result.pieces = pieces;
      out.events.push({ kind: 'trade', data: { trader: action.trader, pieces, coins } });
      return;
    }
    case 'eat': {
      if (farm.energy >= MAX_ENERGY) {
        refuse('You\'re full of energy');
      }
      let best: string | null = null;
      for (const [id, count] of Object.entries(farm.produce)) {
        const info = item(id);
        if (count > 0 && info && info.energy > 0 && (!best || info.sell < item(best)!.sell)) {
          best = id;
        }
      }
      if (!best) {
        refuse('Nothing to eat in your basket');
      }
      const info = item(best)!;
      take(farm.produce, best, 1);
      const gained = Math.min(info.energy, MAX_ENERGY - farm.energy);
      farm.energy += gained;
      out.notices.push(`Ate a ${info.name.toLowerCase()} meal  +${Math.round(gained)} energy`);
      out.events.push({ kind: 'eat', data: { item: best, energy: Math.round(gained) } });
      return;
    }
    case 'sleep': {
      if (farm.lastSleptAt && now - farm.lastSleptAt < SLEEP_SECONDS) {
        refuse(`You can sleep again in ${duration(farm.lastSleptAt + SLEEP_SECONDS - now)}`);
      }
      farm.lastSleptAt = now;
      farm.day += 1;
      farm.hour = 6;
      farm.energy = action.passedOut ? MAX_ENERGY * 0.6 : MAX_ENERGY;
      addXp(farm, XP.sleep, out);
      out.events.push({ kind: 'sleep', data: { passedOut: !!action.passedOut } });
      return;
    }
    case 'marry': {
      if (farm.companion) {
        refuse('You\'re already married');
      }
      if (levelForXp(farm.xp) < COMPANION_LEVEL) {
        refuse(`The matchmaker helps from level ${COMPANION_LEVEL}`);
      }
      spendBloom(ctx, out, COMPANION_PRICE, 'The matchmaker');
      farm.companion = ctx.character === 'Arash' ? 'Diana' : 'Arash';
      addXp(farm, XP.marry, out);
      out.notices.push(`You married ${farm.companion}! ${farm.companion === 'Arash' ? 'He' : 'She'} walks the farm with you now`);
      out.events.push({ kind: 'marry', data: { name: farm.companion, bloom: COMPANION_PRICE } });
      return;
    }
    case 'buy_vip': {
      const plan = ctx.vipPlans.find((p) => p.id === action.plan);
      if (!plan) {
        refuse('No such plan');
      }
      spendBloom(ctx, out, plan.bloom, `${plan.days} days of VIP`);
      out.vipDays = plan.days;
      out.notices.push(`Welcome to VIP! ${plan.days} days: your name shines gold now`);
      out.events.push({ kind: 'vip', data: { plan: plan.id, days: plan.days, bloom: plan.bloom } });
      return;
    }
    case 'buy_gems': {
      const pack = ctx.gemPacks.find((p) => p.id === action.pack);
      if (!pack) {
        refuse('No such pack');
      }
      spendBloom(ctx, out, pack.bloom, `${pack.gems} gems`);
      out.gems += pack.gems;
      out.notices.push(`+${pack.gems} gems`);
      out.events.push({ kind: 'gems', data: { gems: pack.gems, bloom: pack.bloom } });
      return;
    }
    case 'speedup': {
      if (action.target === 'plot') {
        const plot = ownedPlot(farm, Number(action.id));
        const crop = findCrop(plot.crop);
        if (!crop || plot.state !== 2) {
          refuse('Nothing growing there');
        }
        const left = crop.grow - growth(plot, now);
        if (left <= 0) {
          refuse('It\'s ripe already');
        }
        const cost = speedupCost(left);
        spendGems(ctx, out, cost, 'Finishing it');
        plot.grown = crop.grow;
        plot.grownAt = now;
        plot.wetUntil = Math.max(plot.wetUntil, now);
        out.notices.push(`${crop.name} is ripe!  -${cost} gems`);
        out.result.cost = cost;
        return;
      }
      const a = animalById(farm, action.id);
      const wool = action.target === 'wool';
      if (wool && !a.woolReadyAt) {
        refuse('Only sheep have wool');
      }
      const left = wool ? remaining(a.woolStart, a.woolReadyAt, a.fedUntil, now) : remaining(a.cycleStart, a.readyAt, a.fedUntil, now);
      if (left <= 0) {
        refuse('It\'s ready already');
      }
      const cost = speedupCost(left);
      spendGems(ctx, out, cost, 'Finishing it');
      if (wool) {
        a.woolReadyAt = Math.min(now, a.fedUntil);
      } else {
        a.readyAt = Math.min(now, a.fedUntil);
      }
      out.notices.push(`${a.name}'s ${wool ? 'wool' : a.kind === 'Chicken' ? 'egg' : 'milk'} is ready!  -${cost} gems`);
      out.result.cost = cost;
      return;
    }
  }
}
