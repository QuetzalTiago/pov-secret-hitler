import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../client/i18n';
import type { GameView } from '../shared/view';
import {
  emptyRecord,
  loadRecord,
  parseRecord,
  recordGame,
  recordLine,
  saveRecord,
  type PlayerRecord,
} from '../client/record';

const view = (o: Partial<GameView>) => ({ phase: 'gameOver', winner: 'liberal', yourRole: 'liberal', ...o }) as GameView;
const rec = (o: Partial<PlayerRecord>): PlayerRecord => ({ ...emptyRecord(), ...o });

afterEach(() => vi.unstubAllGlobals());

describe('recordGame', () => {
  it('counts a liberal win', () => {
    const r = recordGame(emptyRecord(), view({}), 'A:1');
    expect(r.played).toBe(1);
    expect(r.wins.liberal).toBe(1);
    expect(r.streak).toBe(1);
    expect(r.best).toBe(1);
    expect(r.seen).toEqual(['A:1']);
  });

  it('counts hitler on a fascist win as a hitler win', () => {
    const r = recordGame(emptyRecord(), view({ winner: 'fascist', yourRole: 'hitler' }), 'A:1');
    expect(r.wins).toEqual({ liberal: 0, fascist: 0, hitler: 1 });
  });

  it('a loss resets the streak but keeps best', () => {
    const r1 = recordGame(emptyRecord(), view({}), 'A:1');
    const r2 = recordGame(r1, view({ winner: 'liberal', yourRole: 'fascist' }), 'A:2');
    expect(r2.played).toBe(2);
    expect(r2.streak).toBe(0);
    expect(r2.best).toBe(1);
    expect(r2.wins.fascist).toBe(0);
  });

  it('counts the same key once', () => {
    const r1 = recordGame(emptyRecord(), view({}), 'A:1');
    expect(recordGame(r1, view({}), 'A:1')).toBe(r1);
  });

  it('ignores unfinished games, null winner and spectators', () => {
    const r = emptyRecord();
    expect(recordGame(r, view({ phase: 'vote' }), 'k')).toBe(r);
    expect(recordGame(r, view({ winner: null }), 'k')).toBe(r);
    expect(recordGame(r, view({ yourRole: null }), 'k')).toBe(r);
  });

  it('keeps only the last 20 keys', () => {
    let r = emptyRecord();
    for (let i = 0; i < 25; i++) r = recordGame(r, view({}), `A:${i}`);
    expect(r.seen).toHaveLength(20);
    expect(r.seen[0]).toBe('A:5');
    expect(r.played).toBe(25);
  });
});

describe('recordLine', () => {
  it('is empty before the first game', () => {
    expect(recordLine(emptyRecord())).toBe('');
  });

  it('shows wins, games and streak', () => {
    const r = rec({ played: 12, wins: { liberal: 4, fascist: 2, hitler: 1 }, streak: 3, best: 3 });
    expect(recordLine(r)).toBe('Your record: 7 wins in 12 · streak 3');
  });

  it('uses the singular for one win', () => {
    expect(recordLine(rec({ played: 1, wins: { liberal: 1, fascist: 0, hitler: 0 }, streak: 1, best: 1 }))).toBe(
      'Your record: 1 win in 1 · streak 1',
    );
  });

  it('omits a zero streak and shows best only when above the streak', () => {
    expect(recordLine(rec({ played: 2, streak: 0, best: 0 }))).toBe('Your record: 0 wins in 2');
    expect(recordLine(rec({ played: 9, streak: 0, best: 5 }))).toBe('Your record: 0 wins in 9 · best 5');
    expect(recordLine(rec({ played: 9, streak: 2, best: 5 }))).toBe('Your record: 0 wins in 9 · streak 2 · best 5');
  });
});

describe('parseRecord', () => {
  it('falls back to defaults for garbage', () => {
    for (const bad of [null, undefined, 'x', 5, [], { played: -1, streak: 'a', best: 1.5, wins: 'no', seen: 3 }]) {
      expect(parseRecord(bad)).toEqual(emptyRecord());
    }
  });

  it('keeps valid fields and caps seen', () => {
    const seen = Array.from({ length: 30 }, (_, i) => `k${i}`);
    const r = parseRecord({ played: 3, wins: { liberal: 2, fascist: -1, hitler: 'x' }, streak: 1, best: 2, seen: [...seen, 7] });
    expect(r.played).toBe(3);
    expect(r.wins).toEqual({ liberal: 2, fascist: 0, hitler: 0 });
    expect(r.seen).toEqual(seen.slice(-20));
  });
});

describe('loadRecord / saveRecord', () => {
  it('round-trips through localStorage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(loadRecord()).toEqual(emptyRecord());
    const r = recordGame(emptyRecord(), view({}), 'A:1');
    saveRecord(r);
    expect(loadRecord()).toEqual(r);
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadRecord()).toEqual(emptyRecord());
    expect(() => saveRecord(emptyRecord())).not.toThrow();
  });
});

describe('recordLine in Spanish', () => {
  beforeEach(() => setLang('es'));
  afterEach(() => setLang('en'));

  it('plural and singular', () => {
    const r = rec({ played: 12, wins: { liberal: 4, fascist: 2, hitler: 1 }, streak: 3, best: 5 });
    expect(recordLine(r)).toBe('Tu récord: 7 victorias en 12 · racha 3 · mejor 5');
    expect(recordLine(rec({ played: 1, wins: { liberal: 1, fascist: 0, hitler: 0 }, streak: 1, best: 1 }))).toBe(
      'Tu récord: 1 victoria en 1 · racha 1',
    );
  });

  it('switching back to English returns English', () => {
    setLang('en');
    expect(recordLine(rec({ played: 2, streak: 0, best: 0 }))).toBe('Your record: 0 wins in 2');
  });
});
