import { describe, expect, it } from 'vitest';
import { beliefs } from '../shared/belief';
import { ROLE_COUNTS } from '../shared/rules';
import { newMemory, type Memory } from '../shared/tracker';
import type { Phase, Policy, Role } from '../shared/types';
import type { GameView } from '../shared/view';

function view(n: number, me: number, yourRole: Role | null, roles: (Role | null)[] = [], phase: Phase = 'nominate'): GameView {
  return {
    you: me, yourRole, phase,
    players: Array.from({ length: n }, (_, seat) => ({ seat, name: `P${seat}`, alive: true, role: roles[seat] ?? null, hasVoted: false, acked: true })),
    liberal: 0, fascist: 0, tracker: 0, deckCount: 10, discardCount: 0, president: 0, nominee: null, chancellor: null,
    lastPresident: null, lastChancellor: null, eligible: [], pending: [], hand: null, peek: null, vetoUnlocked: false,
    vetoRefused: false, lastVotes: null, investigated: [], yourInvestigations: [], powers: [], currentPower: null,
    winner: null, winReason: null, round: 1,
  };
}

/** Pushes a passed election and (optionally) its government. */
function gov(m: Memory, round: number, president: number, chancellor: number, result: Policy | null, ja: number[] = []): void {
  const votes = Array.from({ length: m.n }, (_, s) => ja.includes(s));
  m.elections.push({ round, president, nominee: chancellor, votes, passed: true });
  if (result) m.governments.push({ round, president, chancellor, result });
}

function sum(a: number[]): number {
  return a.reduce((x, y) => x + y, 0);
}

describe('beliefs', () => {
  it('sums to team size and one Hitler for both observers', () => {
    for (const n of [5, 7, 10]) {
      const m = newMemory(0, n);
      gov(m, 1, 1, 2, 'F', [0, 3]);
      gov(m, 2, 2, 3, 'L', [0, 1, 4]);
      m.elections.push({ round: 3, president: 3, nominee: 4, votes: Array(n).fill(false), passed: false });
      gov(m, 4, 4, 1, 'F', [0, 2]);
      const v = view(n, 0, 'liberal');
      for (const observer of ['self', 'liberal'] as const) {
        const b = beliefs(m, v, { observer });
        expect(b.pFascist).toHaveLength(n);
        expect(sum(b.pFascist)).toBeCloseTo(ROLE_COUNTS[n][1] + 1, 6);
        expect(sum(b.pHitler)).toBeCloseTo(1, 6);
      }
    }
  });

  it('uses own role and investigations', () => {
    const m = newMemory(2, 7);
    expect(beliefs(m, view(7, 2, 'liberal')).pFascist[2]).toBe(0);

    const roles: (Role | null)[] = [null, 'fascist', 'fascist', null, 'hitler', null, null];
    const b = beliefs(m, view(7, 1, 'fascist', roles));
    expect(b.pFascist.map((x) => Math.round(x * 1e9) / 1e9)).toEqual([0, 1, 1, 0, 1, 0, 0]);
    expect(b.pHitler[4]).toBeCloseTo(1, 9);

    m.known.set(5, 'fascist');
    m.known.set(6, 'liberal');
    const c = beliefs(m, view(7, 2, 'liberal'));
    expect(c.pFascist[5]).toBeCloseTo(1, 9);
    expect(c.pFascist[6]).toBe(0);
  });

  it('trusts my own hand: passed a Liberal, they enacted Fascist', () => {
    const m = newMemory(0, 7);
    gov(m, 1, 0, 3, 'F', [0, 1, 2]);
    m.passed.push({ round: 1, to: 3, gave: ['F', 'L'] });
    const v = view(7, 0, 'liberal');
    expect(beliefs(m, v).pFascist[3]).toBeGreaterThan(0.95);
    expect(beliefs(m, v, { observer: 'liberal' }).pFascist[3]).toBeLessThan(0.9);
  });

  it('uses what I received as Chancellor', () => {
    const m = newMemory(0, 7);
    gov(m, 1, 3, 0, 'F');
    m.received.push({ round: 1, from: 3, got: ['F', 'F'] });
    const v = view(7, 0, 'liberal');
    expect(beliefs(m, v).pFascist[3]).toBeGreaterThan(beliefs(m, v, { observer: 'liberal' }).pFascist[3]);
  });

  it('rules Hitler out after the zone election, not before', () => {
    const build = (fBefore: number): Memory => {
      const m = newMemory(0, 7);
      for (let i = 0; i < fBefore; i++) gov(m, i + 1, 1 + (i % 2), 3 + (i % 2), 'F');
      gov(m, fBefore + 1, 5, 6, null);
      return m;
    };
    const v = view(7, 0, 'liberal');
    for (const observer of ['self', 'liberal'] as const) {
      const zone = beliefs(build(3), v, { observer });
      expect(zone.pHitler[6]).toBe(0);
      expect(sum(zone.pFascist)).toBeCloseTo(3, 6);
      expect(sum(zone.pHitler)).toBeCloseTo(1, 6);
      expect(beliefs(build(2), v, { observer }).pHitler[6]).toBeGreaterThan(0);
    }
  });

  it('rules Hitler out for executed players', () => {
    const m = newMemory(0, 7);
    m.executions.push({ by: 1, target: 4 });
    expect(beliefs(m, view(7, 0, 'liberal'), { observer: 'liberal' }).pHitler[4]).toBe(0);
  });

  it('game over: result equals the revealed roles even against the zone rule', () => {
    const m = newMemory(0, 7);
    for (let i = 0; i < 3; i++) gov(m, i + 1, 1, 2, 'F');
    gov(m, 4, 5, 6, 'F');
    const roles: Role[] = ['liberal', 'liberal', 'fascist', 'liberal', 'liberal', 'fascist', 'hitler'];
    const v = view(7, 0, 'liberal', roles, 'gameOver');
    for (const observer of ['self', 'liberal'] as const) {
      const b = beliefs(m, v, { observer });
      roles.forEach((r, s) => {
        expect(b.pFascist[s]).toBeCloseTo(r === 'liberal' ? 0 : 1, 9);
        expect(b.pHitler[s]).toBeCloseTo(r === 'hitler' ? 1 : 0, 9);
      });
    }
  });

  it('is deck-aware: one Fascist policy raises suspicion, but not to certainty for the President', () => {
    const m = newMemory(0, 7);
    gov(m, 1, 2, 3, 'F');
    const b = beliefs(m, view(7, 0, 'liberal'), { observer: 'liberal' });
    const prior = 3 / 7;
    expect(b.pFascist[2]).toBeGreaterThan(prior);
    expect(b.pFascist[3]).toBeGreaterThan(prior);
    expect(b.pFascist[2]).toBeLessThan(0.9);
    expect(b.pFascist[3]).toBeGreaterThan(b.pFascist[2]);
  });

  it('observer liberal ignores a Fascist bot\'s own knowledge', () => {
    const m = newMemory(1, 7);
    const roles: (Role | null)[] = [null, 'fascist', 'fascist', null, 'hitler', null, null];
    const b = beliefs(m, view(7, 1, 'fascist', roles), { observer: 'liberal' });
    for (const s of [1, 2, 4]) {
      expect(b.pFascist[s]).toBeGreaterThan(0.01);
      expect(b.pFascist[s]).toBeLessThan(0.99);
    }
  });

  it('never returns NaN on contradictory memory', () => {
    const m = newMemory(0, 5);
    m.executions.push({ by: 1, target: 2 });
    const roles: (Role | null)[] = [null, null, 'hitler', null, null];
    const b = beliefs(m, view(5, 0, 'liberal', roles));
    expect([...b.pFascist, ...b.pHitler].every(Number.isFinite)).toBe(true);
    expect(sum(b.pHitler)).toBeCloseTo(1, 6);
  });

  it('is fast at 10 players', () => {
    const m = newMemory(0, 10);
    for (let i = 0; i < 10; i++) {
      gov(m, i + 1, i, (i + 3) % 10, i % 3 === 0 ? 'L' : 'F', [0, 1, 2, 3, 4, 5].map((x) => (x + i) % 10));
      m.elections.push({ round: i + 1, president: (i + 1) % 10, nominee: (i + 5) % 10, votes: Array(10).fill(false), passed: false });
    }
    const v = view(10, 0, 'liberal');
    for (let i = 0; i < 20; i++) beliefs(m, v, { observer: 'liberal' });
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) beliefs(m, v, { observer: 'liberal' });
    const avg = (performance.now() - t0) / 200;
    expect(avg).toBeLessThan(2);
  });
});
