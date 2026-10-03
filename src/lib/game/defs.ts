/**
 * The farm's rules, kept here (the server decides everything that has a value; the game is sent these
 * at load and shows them): crops with their real-time growing and watering, the animals with how long
 * each takes to give and what it eats, prices in coins, experience, energy, levels, beds, buildings, the
 * traders, and what gems and BLOOM buy.
 */

export interface CropDef {
  id: string;
  name: string;
  /** Coins a seed costs, and a piece sells for at the bin. */
  seed: number;
  sell: number;
  /** Seconds of growing (while watered) until ripe, and how long a watering lasts. */
  grow: number;
  water: number;
  yield: number;
  /** Energy a piece gives eaten (0: not food). */
  energy: number;
}

export const CROPS: CropDef[] = [
  { id: 'Wheat', name: 'Wheat', seed: 10, sell: 26, grow: 10 * 60, water: 5 * 60, yield: 5, energy: 15 },
  { id: 'Hay', name: 'Hay', seed: 8, sell: 18, grow: 15 * 60, water: 15 * 60, yield: 6, energy: 0 },
  { id: 'Carrot', name: 'Carrot', seed: 15, sell: 40, grow: 30 * 60, water: 15 * 60, yield: 4, energy: 20 },
  { id: 'Corn', name: 'Corn', seed: 30, sell: 75, grow: 60 * 60, water: 30 * 60, yield: 4, energy: 30 },
  { id: 'Tomato', name: 'Tomato', seed: 25, sell: 55, grow: 2 * 3600, water: 3600, yield: 5, energy: 25 },
  { id: 'Sunflower', name: 'Sunflower', seed: 20, sell: 80, grow: 4 * 3600, water: 2 * 3600, yield: 4, energy: 15 },
  { id: 'Pumpkin', name: 'Pumpkin', seed: 45, sell: 260, grow: 8 * 3600, water: 4 * 3600, yield: 2, energy: 45 },
];

export interface ProductDef {
  id: string;
  name: string;
  sell: number;
  energy: number;
}

export const PRODUCTS: ProductDef[] = [
  { id: 'Egg', name: 'Egg', sell: 30, energy: 10 },
  { id: 'Milk', name: 'Milk', sell: 55, energy: 15 },
  { id: 'SheepMilk', name: "Sheep's milk", sell: 70, energy: 15 },
  { id: 'Wool', name: 'Wool', sell: 140, energy: 0 },
  { id: 'Leather', name: 'Leather', sell: 280, energy: 0 },
];

export type AnimalKind = 'Chicken' | 'Sheep' | 'Cow';

export interface AnimalDef {
  kind: AnimalKind;
  name: string;
  price: number;
  capacity: number;
  /** Where it lives (built first). */
  home: string;
  level: number;
  /** What it gives, how many each time, and the seconds it takes (while fed). */
  product: string;
  count: number;
  cycle: number;
  /** A sheep's wool too. */
  wool?: { cycle: number; count: number };
  /** What it eats each day (feeding keeps it fed for FED_SECONDS). */
  feed: string;
  feedCount: number;
}

export const ANIMALS: AnimalDef[] = [
  { kind: 'Chicken', name: 'Hen', price: 150, capacity: 8, home: 'Coop', level: 1, product: 'Egg', count: 1, cycle: 4 * 3600, feed: 'Corn', feedCount: 1 },
  { kind: 'Sheep', name: 'Sheep', price: 450, capacity: 5, home: 'Barn', level: 1, product: 'SheepMilk', count: 1, cycle: 6 * 3600, wool: { cycle: 12 * 3600, count: 1 }, feed: 'Hay', feedCount: 1 },
  { kind: 'Cow', name: 'Cow', price: 800, capacity: 4, home: 'Barn', level: 8, product: 'Milk', count: 2, cycle: 12 * 3600, feed: 'Hay', feedCount: 2 },
];

/** A feeding keeps an animal fed this long; it can be fed ahead up to MAX_FED_AHEAD. */
export const FED_SECONDS = 24 * 3600;
export const MAX_FED_AHEAD = 48 * 3600;

export interface BuildingDef {
  id: string;
  name: string;
  level: number;
  price: number;
  gives: string;
}

export const BUILDINGS: BuildingDef[] = [
  { id: 'Coop', name: 'Hen house', level: 3, price: 400, gives: 'Keep hens: an egg each every 4 hours' },
  { id: 'Barn', name: 'Barn and paddock', level: 5, price: 1200, gives: 'Keep sheep (milk, wool), and cows from level 8' },
];

export const START = { coins: 250, seeds: { Wheat: 6, Carrot: 4, Hay: 4 } as Record<string, number> };
export const MAX_ENERGY = 100;
export const MAX_LEVEL = 50;
export const MAX_ANIMAL_LEVEL = 50;
export const COMPANION_LEVEL = 4;
/** BLOOM the matchmaker asks. */
export const COMPANION_PRICE = 500;
export const GEMS_PER_MINUTE = 3;
/** Sleeping (a new day, full energy) once in this long, real time. */
export const SLEEP_SECONDS = 24 * 3600;

export const ENERGY: Record<string, number> = { till: 4, plant: 1, water: 2, harvest: 2, milk: 2, shear: 3, collect_eggs: 1, feed: 1 };

export const XP = { till: 3, plant: 2, water: 2, milk: 6, shear: 10, leather: 15, eggPer: 2, feed: 2, buyAnimal: 15, bed: 25, building: 60, marry: 100, sleep: 5 };
export const ANIMAL_XP = { milk: 15, shear: 20, eggs: 8, feed: 10 };

export function harvestXp(crop: CropDef) {
  return 2 + Math.round(crop.grow / 1200);
}

/** Experience it takes to reach a level, all told (level 1: 0). */
export function xpForLevel(level: number) {
  const l = Math.min(Math.max(level, 1), MAX_LEVEL);
  return 30 * (l - 1) * l;
}

export function levelForXp(xp: number) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) {
    level++;
  }
  return level;
}

export function animalXpForLevel(level: number) {
  const l = Math.min(Math.max(level, 1), MAX_ANIMAL_LEVEL);
  return 4 * (l - 1) * l;
}

export function animalLevel(xp: number) {
  let level = 1;
  while (level < MAX_ANIMAL_LEVEL && xp >= animalXpForLevel(level + 1)) {
    level++;
  }
  return level;
}

/** One more of what an animal gives every 10 levels. */
export function animalExtra(xp: number) {
  return Math.floor(animalLevel(xp) / 10);
}

/** Beds a level allows: one a level to six, then two a level up to twenty. */
export function maxPlotsAt(level: number) {
  return level <= 6 ? Math.max(level, 1) : Math.min(6 + 2 * (level - 6), 20);
}

/** What the next bed costs, with owned beds already. */
export function nextPlotPrice(owned: number) {
  return Math.round((50 * Math.pow(owned, 1.6)) / 10) * 10;
}

export const TRADERS: Record<string, { name: string; buys: string[] | 'crops' }> = {
  Gus: { name: 'Gus', buys: 'crops' },
  Hattie: { name: 'Hattie', buys: ['Egg'] },
  Molly: { name: 'Molly', buys: ['Milk', 'SheepMilk'] },
  Bruno: { name: 'Bruno', buys: ['Wool', 'Leather'] },
};

export interface GemPack {
  id: string;
  gems: number;
  bloom: number;
  tag?: string;
}

export const DEFAULT_GEM_PACKS: GemPack[] = [
  { id: 'g100', gems: 100, bloom: 20 },
  { id: 'g550', gems: 550, bloom: 100, tag: '+10%' },
  { id: 'g1200', gems: 1200, bloom: 200, tag: '+20%' },
  { id: 'g3200', gems: 3200, bloom: 500, tag: 'Best value' },
];

export const findCrop = (id: string) => CROPS.find((c) => c.id === id);
export const findProduct = (id: string) => PRODUCTS.find((p) => p.id === id);
export const findAnimal = (kind: string) => ANIMALS.find((a) => a.kind === kind);
export const findBuilding = (id: string) => BUILDINGS.find((b) => b.id === id);

export function item(id: string) {
  const crop = findCrop(id);
  if (crop) {
    return { name: crop.name, sell: crop.sell, energy: crop.energy };
  }
  const product = findProduct(id);
  return product ? { name: product.name, sell: product.sell, energy: product.energy } : null;
}

/** What the game is sent at load: the rules it shows. */
export function publicDefs(gemPacks: GemPack[]) {
  return {
    crops: CROPS,
    products: PRODUCTS,
    animals: ANIMALS,
    buildings: BUILDINGS,
    fedSeconds: FED_SECONDS,
    maxFedAhead: MAX_FED_AHEAD,
    maxEnergy: MAX_ENERGY,
    companionLevel: COMPANION_LEVEL,
    companionPrice: COMPANION_PRICE,
    gemsPerMinute: GEMS_PER_MINUTE,
    sleepSeconds: SLEEP_SECONDS,
    energy: ENERGY,
    gemPacks,
  };
}
