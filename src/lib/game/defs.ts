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
  /** Seconds it takes to put up (less with the building skill). */
  seconds: number;
  gives: string;
}

export const BUILDINGS: BuildingDef[] = [
  { id: 'Coop', name: 'Hen house', level: 3, price: 400, seconds: 30 * 60, gives: 'Keep hens: an egg each every 4 hours' },
  { id: 'Market', name: 'Market stall', level: 4, price: 1000, seconds: 3 * 3600, gives: 'Sell crops, products and animals to other farmers, and buy theirs, for BLOOM (needs 600 reputation)' },
  { id: 'Barn', name: 'Barn and paddock', level: 5, price: 1200, seconds: 2 * 3600, gives: 'Keep sheep (milk, wool), and cows from level 8' },
];

// ----------------------------------------------------------------------------- skills

export type SkillId = 'combat' | 'farming' | 'building' | 'cows' | 'sheep' | 'hens';

/**
 * A skill's track: combat (each level gives COMBAT_POWER), or a farm skill's time (every level takes
 * step percent off its timers) or yield (every level gives step percent more, the fractions kept till
 * they make a whole one). A point a player level to put in them; all taken back once every
 * SKILL_RESET_SECONDS, to be put in again.
 */
export interface SkillTrack {
  id: string;
  skill: SkillId;
  part: 'power' | 'health' | 'time' | 'yield';
  max: number;
  /** Percent a level (power: combat power a level; health: health a level). */
  step: number;
}

export interface SkillDef {
  id: SkillId;
  name: string;
  about: string;
}

export const SKILLS: SkillDef[] = [
  { id: 'combat', name: 'Combat', about: 'Each level: +100 combat power, or +50 health' },
  { id: 'farming', name: 'Farming', about: 'Crops: they grow faster, and give more' },
  { id: 'building', name: 'Building', about: 'Buildings go up faster' },
  { id: 'cows', name: 'Cattle', about: 'Cows: milk sooner, and more of it' },
  { id: 'sheep', name: 'Sheep', about: 'Sheep: milk and wool sooner, and more of them' },
  { id: 'hens', name: 'Poultry', about: 'Hens: eggs sooner, and more of them' },
];

export const COMBAT_POWER = 100;
/** Health a level of combat's health track adds. */
export const HEALTH_STEP = 50;
export const SKILL_TRACKS: SkillTrack[] = [
  { id: 'combat', skill: 'combat', part: 'power', max: 99, step: COMBAT_POWER },
  { id: 'combat.health', skill: 'combat', part: 'health', max: 99, step: HEALTH_STEP },
  { id: 'farming.time', skill: 'farming', part: 'time', max: 6, step: 5 },
  { id: 'farming.yield', skill: 'farming', part: 'yield', max: 6, step: 5 },
  { id: 'building.time', skill: 'building', part: 'time', max: 6, step: 10 },
  { id: 'cows.time', skill: 'cows', part: 'time', max: 6, step: 5 },
  { id: 'cows.yield', skill: 'cows', part: 'yield', max: 6, step: 5 },
  { id: 'sheep.time', skill: 'sheep', part: 'time', max: 6, step: 5 },
  { id: 'sheep.yield', skill: 'sheep', part: 'yield', max: 6, step: 5 },
  { id: 'hens.time', skill: 'hens', part: 'time', max: 6, step: 5 },
  { id: 'hens.yield', skill: 'hens', part: 'yield', max: 6, step: 5 },
];
/** Skills can be taken back (and put in again) once in this long: three months. */
export const SKILL_RESET_SECONDS = 90 * 86400;

/** Skill points a player level gives: one a level. */
export function skillPoints(level: number) {
  return Math.max(1, level);
}

export const findTrack = (id: string) => SKILL_TRACKS.find((t) => t.id === id);
export const ANIMAL_SKILL: Record<AnimalKind, SkillId> = { Chicken: 'hens', Sheep: 'sheep', Cow: 'cows' };

// ----------------------------------------------------------------------------- health and the wolf

/**
 * Every farmer has health: BASE_HEALTH, and HEALTH_STEP more for each level of combat's health track. It
 * comes back by itself (HEALTH_REGEN). On days an admin sets (the Event table, /admin/events) a wolf is
 * loose on every farm: it goes for the farmer as soon as they're in the game. Its bites take its power off
 * their health; their strikes take their combat power (BASE_POWER and the combat track) off its health,
 * which the server keeps for each farm through the event. A farmer it kills is down for RESPAWN_SECONDS
 * (or back at once for the admins' revive price in gems).
 */
export const BASE_HEALTH = 1000;
export const BASE_POWER = 100;
/** Health back a second (a part of the most), from this many seconds after the last wound. */
export const HEALTH_REGEN = { perSecond: 0.01, after: 10 };
export const RESPAWN_SECONDS = 24 * 3600;
/** The quickest the wolf bites again, and a farmer strikes again (seconds): a game sending more is cheating. */
export const WOLF_BITE_SECONDS = 1.0;
export const WOLF_HIT_SECONDS = 0.3;
/** The admins' wolf (Setting "wolf"): what a new event's wolf has, the revive price, the reward for killing it. */
export interface WolfSettings {
  power: number;
  health: number;
  reviveGems: number;
  rewardXp: number;
  rewardCoins: number;
}
export const DEFAULT_WOLF: WolfSettings = { power: 500, health: 5000, reviveGems: 300, rewardXp: 300, rewardCoins: 300 };

// ----------------------------------------------------------------------------- the market

/**
 * Selling to other players for BLOOM (src/lib/market.ts). A price may be at most PRICE_BAND above, or
 * below, the going price of the same thing: its cheapest listing now, else what it last sold for, else
 * its base here (a tenth of what the game pays for it, in BLOOM; an animal's from its price, more for
 * every ten levels).
 */
export const MARKET = {
  listingHours: 72,
  priceBand: 0.1,
  maxCount: 99,
  /** A sale this recent sets the going price when nothing's listed. */
  lastSaleDays: 14,
};

/** What the price rule compares: an item by its id, an animal by kind and its ten-level band. */
export function marketKey(id: string, animalXp?: number) {
  return animalXp === undefined ? id : `${id}@${Math.floor(animalLevel(animalXp) / 10)}`;
}

/** The going price of one when nothing tells it better. */
export function marketBase(key: string) {
  const [id, band] = key.split('@');
  const animal = findAnimal(id);
  if (animal) {
    return (animal.price / 10) * (1 + Number(band ?? 0));
  }
  const info = item(id);
  return info ? info.sell / 10 : 0;
}

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

/**
 * Who one can play (the game's PlayerCharacters, Config/DefaultGame.ini), each a woman or a man. Chosen
 * once at sign-up; after that becoming another costs gems: CHARACTER_CHANGE_GEMS for one of the same
 * gender, GENDER_CHANGE_GEMS for the other gender (src/lib/players.ts).
 */
export const CHARACTERS = [
  { name: 'Diana', gender: 'female' },
  { name: 'Arash', gender: 'male' },
  { name: 'Arellah', gender: 'female' },
] as const;
export const CHARACTER_CHANGE_GEMS = 600;
export const GENDER_CHANGE_GEMS = 1500;

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
    skills: SKILLS,
    skillTracks: SKILL_TRACKS,
    skillResetSeconds: SKILL_RESET_SECONDS,
    combatPower: COMBAT_POWER,
    basePower: BASE_POWER,
    baseHealth: BASE_HEALTH,
    healthStep: HEALTH_STEP,
    respawnSeconds: RESPAWN_SECONDS,
    healthRegen: HEALTH_REGEN,
    market: MARKET,
    characters: { list: CHARACTERS, characterChangeGems: CHARACTER_CHANGE_GEMS, genderChangeGems: GENDER_CHANGE_GEMS },
  };
}
