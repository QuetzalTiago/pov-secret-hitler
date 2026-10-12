import { COATS } from './palette';

export type Body = 'suit' | 'shirt' | 'dress' | 'blouse';

/** How one seated patron looks. Colours are 0xRRGGBB; height is a multiplier around 1. */
export interface Look { body: Body; skin: number; hair: number; coat: number; tie: number; height: number }

/** Hair colours, dark enough for a dim night bar. */
export const HAIR = { black: 0x1a1410, darkBrown: 0x2e1e14, brown: 0x4a3020, auburn: 0x5a2616, darkBlond: 0x7a5e34, grey: 0x77736c };

export const TIES = [0x8a1a1a, 0x1a2a4a, 0x2a3a22, 0x4a2a3a, 0x14100c];

/**
 * Ten fixed people, one per seat, so no two patrons look alike (no three dark-skinned men in
 * identical suits). Each SKINS value appears once; the darkest three are on different bodies.
 */
export const CAST: readonly { body: Body; skin: number; hair: number; height: number }[] = [
  { body: 'suit', skin: 0xf0c8a8, hair: HAIR.grey, height: 1.03 },
  { body: 'suit', skin: 0xd9a07a, hair: HAIR.black, height: 0.98 },
  { body: 'suit', skin: 0x9a6a48, hair: HAIR.darkBrown, height: 1.01 },
  { body: 'suit', skin: 0x6b4430, hair: HAIR.black, height: 1.04 },
  { body: 'shirt', skin: 0xe0b090, hair: HAIR.darkBlond, height: 0.97 },
  { body: 'shirt', skin: 0x8a5a3a, hair: HAIR.black, height: 1.02 },
  { body: 'dress', skin: 0xe6b898, hair: HAIR.auburn, height: 1.0 },
  { body: 'dress', skin: 0x7a4e36, hair: HAIR.black, height: 0.97 },
  { body: 'blouse', skin: 0xc08860, hair: HAIR.brown, height: 1.02 },
  { body: 'blouse', skin: 0xb07a55, hair: HAIR.darkBrown, height: 0.96 },
];

/** 32-bit FNV-1a hash of a room code (unsigned). */
export function seedOf(code: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher-Yates shuffle of 0..n-1. */
export function permutation(n: number, seed: number): number[] {
  const rnd = mulberry32(seed);
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/**
 * The look of the patron in `seat` (0..9). The cast is dealt to seats by `seed` (use seedOf of the
 * room code) so every client sees the same table while each room gets a different line-up.
 */
export function lookFor(seat: number, seed: number, hitler = false): Look {
  if (hitler) return { body: 'suit', skin: 0xe8c4a4, hair: HAIR.black, coat: 0x7a6844, tie: 0x14100c, height: 1 };
  const s = ((seat % 10) + 10) % 10;
  const c = CAST[permutation(10, seed)[s]];
  return {
    ...c,
    coat: COATS[permutation(10, seed ^ 0x9e3779b9)[s]],
    tie: TIES[permutation(10, seed ^ 0x85ebca6b)[s] % TIES.length],
  };
}
