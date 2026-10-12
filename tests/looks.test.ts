import { describe, expect, it } from 'vitest';
import { CAST, HAIR, lookFor, seedOf, type Look } from '../client/scene/looks';
import { COATS, SKINS } from '../client/scene/palette';

const SEEDS = [...Array.from({ length: 220 }, (_, i) => seedOf('ROOM' + i)), 0, 1, 42, 0xffffffff, 0x9e3779b9];
const table = (seed: number): Look[] => Array.from({ length: 10 }, (_, s) => lookFor(s, seed));
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

describe('looks', () => {
  it('cast is 4 suit, 2 shirt, 2 dress, 2 blouse with heights near 1', () => {
    const n = (b: string) => CAST.filter((c) => c.body === b).length;
    expect([n('suit'), n('shirt'), n('dress'), n('blouse')]).toEqual([4, 2, 2, 2]);
    for (const c of CAST) {
      expect(c.height).toBeGreaterThanOrEqual(0.95);
      expect(c.height).toBeLessThanOrEqual(1.05);
      expect(Object.values(HAIR)).toContain(c.hair);
    }
  });

  it('every table has ten distinct patrons using each skin and coat once', () => {
    for (const seed of SEEDS) {
      const t = table(seed);
      expect(new Set(t.map((l) => JSON.stringify(l))).size).toBe(10);
      expect(sorted(t.map((l) => l.skin))).toEqual(sorted(SKINS));
      expect(sorted(t.map((l) => l.coat))).toEqual(sorted(COATS));
    }
  });

  it('the three darkest skins are on three different bodies', () => {
    for (const seed of SEEDS) {
      const dark = table(seed).filter((l) => [0x8a5a3a, 0x7a4e36, 0x6b4430].includes(l.skin));
      expect(dark.length).toBe(3);
      expect(new Set(dark.map((l) => l.body)).size).toBe(3);
    }
  });

  it('is deterministic and differs between rooms', () => {
    for (const seed of SEEDS) expect(table(seed)).toEqual(table(seed));
    expect(table(seedOf('ABCD'))).not.toEqual(table(seedOf('WXYZ')));
    expect(new Set(SEEDS.map((s) => lookFor(0, s).skin)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(SEEDS.map((s) => JSON.stringify(table(s)))).size).toBeGreaterThan(200);
  });

  it('wraps seats modulo 10', () => {
    expect(lookFor(13, 7)).toEqual(lookFor(3, 7));
    expect(lookFor(-1, 7)).toEqual(lookFor(9, 7));
  });

  it('seedOf is a stable unsigned 32-bit hash', () => {
    expect(seedOf('')).toBe(0x811c9dc5);
    expect(seedOf('a')).toBe(0xe40c292c);
    expect(seedOf('ABCD')).toBe(0xd31646fd);
    for (const s of SEEDS) expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
  });

  it('wraps seats past the table and is stable per seat and seed (own arms use the same look)', () => {
    expect(lookFor(12, 7)).toEqual(lookFor(2, 7));
    expect(lookFor(-1, 7)).toEqual(lookFor(9, 7));
    expect(lookFor(3, 7)).toEqual(lookFor(3, 7));
  });

  it('hitler override', () => {
    expect(lookFor(4, 123, true)).toEqual({ body: 'suit', skin: 0xe8c4a4, hair: HAIR.black, coat: 0x7a6844, tie: 0x14100c, height: 1 });
  });
});
