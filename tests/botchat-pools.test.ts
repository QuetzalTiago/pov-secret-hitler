import { afterEach, describe, expect, it } from 'vitest';
import { fill, LinePicker, POOLS } from '../server/botlines';
import { planTalk } from '../server/botchat';
import { config } from '../server/config';
import { newMemory } from '../shared/tracker';
import { viewFor } from '../shared/view';
import { roles, setup } from './helpers';

const name = (s: number) => `P${s}`;
const holes = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('bot line pools', () => {
  const entries = Object.entries(POOLS) as [string, { es: string[]; en: string[] }][];

  it('every pool has 4 to 6 distinct lines per language', () => {
    for (const [key, pool] of entries) {
      for (const lang of ['es', 'en'] as const) {
        const xs = pool[lang];
        expect(xs.length, `${key}.${lang}`).toBeGreaterThanOrEqual(4);
        expect(xs.length, `${key}.${lang}`).toBeLessThanOrEqual(6);
        expect(new Set(xs).size, `${key}.${lang} duplicates`).toBe(xs.length);
      }
    }
  });

  // Card claims and pools that name a person must always state them; the rest may drop a name in some lines.
  const strict = ['presDrew', 'presPassed', 'chanGot', 'presBlame', 'chanBlame', 'invLiberal', 'invFascist', 'warnSelf', 'warnOther', 'accuseChancellor', 'accusePresident'];

  it('every line only uses its pool placeholders, strict pools use all of them, and fill leaves none behind', () => {
    for (const [key, pool] of entries) {
      const all = [...new Set([...pool.es, ...pool.en].flatMap(holes))].sort();
      for (const t of [...pool.es, ...pool.en]) {
        const got = [...new Set(holes(t))].sort();
        if (strict.includes(key)) expect(got, `${key}: ${t}`).toEqual(all);
        else expect(all, `${key}: ${t}`).toEqual(expect.arrayContaining(got));
        expect(fill(t, Object.fromEntries(all.map((k) => [k, 'X'])))).not.toMatch(/[{}]/);
      }
    }
  });
});

describe('LinePicker', () => {
  it('size consecutive picks cover every index exactly once', () => {
    for (let size = 1; size <= 6; size++) {
      for (const seed of [1, 7, 42, 999]) {
        const p = new LinePicker();
        const rand = lcg(seed);
        for (let round = 0; round < 3; round++) {
          const got = Array.from({ length: size }, () => p.next('k', size, rand));
          expect([...got].sort()).toEqual(Array.from({ length: size }, (_, i) => i));
        }
      }
    }
  });

  it('never repeats back to back across refills', () => {
    for (let size = 2; size <= 6; size++) {
      for (const seed of [3, 11, 123]) {
        const p = new LinePicker();
        const rand = lcg(seed);
        let last = -1;
        for (let i = 0; i < size * 10; i++) {
          const x = p.next('k', size, rand);
          expect(x).not.toBe(last);
          last = x;
        }
      }
    }
  });

  it('keeps keys independent', () => {
    const p = new LinePicker();
    const rand = lcg(5);
    const a = [p.next('a', 3, rand), p.next('a', 3, rand)];
    const b = Array.from({ length: 3 }, () => p.next('b', 3, rand));
    expect([...b].sort()).toEqual([0, 1, 2]);
    expect(p.next('a', 3, rand)).not.toBe(a[0]);
    expect(p.next('a', 3, rand)).toBeDefined();
  });
});

describe('planTalk with pools', () => {
  const saved = config.llm.lang;
  afterEach(() => {
    config.llm.lang = saved;
  });

  const nominated = (seat: number, bots: number[], lang: 'en' | 'es-AR', calls: number) => {
    config.llm.lang = lang;
    const s = setup(5, { president: 0, roles: roles(5, 4, bots) });
    const v = viewFor(s, seat);
    const seen = new Set<string>();
    for (let i = 0; i < calls; i++) {
      // The first rand() is the 35% check; every later one picks the line.
      let first = true;
      const rand = () => (first ? ((first = false), 0) : Math.random());
      const plan = planTalk({ k: 'nominated', president: 0, target: seat }, v, newMemory(seat, 5), name, rand);
      if (plan?.kind === 'line') seen.add(plan.line);
    }
    return seen;
  };

  it('Fascist and Liberal nominees draw from the same full pool', () => {
    for (const [lang, key] of [['en', 'en'], ['es-AR', 'es']] as const) {
      const full = [...POOLS.nominated[key]].sort();
      const fas = nominated(3, [3], lang, 500);
      const lib = nominated(1, [3], lang, 500);
      expect([...fas].sort()).toEqual(full);
      expect([...lib].sort()).toEqual(full);
    }
  });

  it('a shared picker uses every line of a pool before repeating', () => {
    config.llm.lang = 'en';
    const s = setup(5, { president: 0, roles: roles(5, 4, [3]) });
    const v = viewFor(s, 2);
    const picker = new LinePicker();
    const n = POOLS.executed.en.length;
    const lines = Array.from({ length: n }, () => {
      const plan = planTalk({ k: 'executed', by: 2, target: 1 }, v, newMemory(2, 5), name, Math.random, 'en', picker);
      return (plan as { line: string }).line;
    });
    expect(new Set(lines).size).toBe(n);

    const vetoes = Array.from({ length: POOLS.veto.en.length }, () => {
      const plan = planTalk({ k: 'vetoProposed', seat: 2 }, v, newMemory(2, 5), name, Math.random, 'en', picker);
      return (plan as { line: string }).line;
    });
    expect(new Set(vetoes).size).toBe(POOLS.veto.en.length);
  });
});
