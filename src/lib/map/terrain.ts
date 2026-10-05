/**
 * The world map's land: 1000 x 1000 squares, each of one kind (biome) worked out from its coordinates alone,
 * so the game draws the land itself (FarmMap.cpp has the same arithmetic, square for square) and the server
 * only sends what stands on it. Integer arithmetic only: both sides must agree to the last square.
 */

export const MAP_SIZE = 1000;
export const CHUNK = 16;
export const CHUNKS = Math.ceil(MAP_SIZE / CHUNK);
export const CENTRE = MAP_SIZE / 2;

export type Biome = 'water' | 'mountain' | 'hills' | 'forest' | 'meadow' | 'plains';

const SEED_HEIGHT = 0x5f3759df;
const SEED_WET = 0x2545f491;

/** A square's pseudo-random 32 bits. */
export function hash(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smoothstep on 0..256. */
function fade(t: number) {
  return Math.floor((t * t * (768 - 2 * t)) / 65536);
}

/** Smooth noise 0..255 over squares scale wide (x, y >= 0). */
function noise(x: number, y: number, scale: number, seed: number) {
  const gx = Math.floor(x / scale);
  const gy = Math.floor(y / scale);
  const fx = fade(Math.floor(((x - gx * scale) * 256) / scale));
  const fy = fade(Math.floor(((y - gy * scale) * 256) / scale));
  const v00 = hash(gx, gy, seed) & 255;
  const v10 = hash(gx + 1, gy, seed) & 255;
  const v01 = hash(gx, gy + 1, seed) & 255;
  const v11 = hash(gx + 1, gy + 1, seed) & 255;
  const top = v00 * 256 + (v10 - v00) * fx;
  const bottom = v01 * 256 + (v11 - v01) * fx;
  return Math.floor((top * 256 + (bottom - top) * fy) / 65536);
}

function layered(x: number, y: number, seed: number) {
  return Math.floor((noise(x, y, 64, seed) * 4 + noise(x, y, 24, seed + 1) * 2 + noise(x, y, 9, seed + 2)) / 7);
}

export function inside(x: number, y: number) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;
}

export function biomeAt(x: number, y: number): Biome {
  const height = layered(x, y, SEED_HEIGHT);
  const wet = layered(x, y, SEED_WET);
  if (height < 90) {
    return 'water';
  }
  if (height > 172) {
    return 'mountain';
  }
  if (height > 155) {
    return 'hills';
  }
  if (wet > 146) {
    return 'forest';
  }
  if (wet < 110) {
    return 'plains';
  }
  return 'meadow';
}

/** Farms can stand there (not on water or mountains). */
export function buildable(biome: Biome) {
  return biome !== 'water' && biome !== 'mountain';
}

/** Squares between two (the longer of the two runs: a farm reaches as far diagonally as straight). */
export function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
