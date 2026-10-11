import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Conn } from '../server/room';
import { config } from '../server/config';
import { THINK_SECONDS, botThinkMs, settleMs } from '../server/pacing';
import { legalActions, pendingActors } from '../shared/engine';
import { PHASES, type GameEvent } from '../shared/types';
import type { ServerMsg } from '../shared/protocol';

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs };

type Plan = { key: string; readyAt: number; timer: unknown };
const plansOf = (room: Room) => (room as unknown as { botPlans: Map<number, Plan> }).botPlans;

// 1 human (seat 0) + 4 bots, game started.
function startGame() {
  const room = new Room('ABCD', vi.fn());
  const human: Conn = { id: 1, room: null, seat: -1, send: (_m: ServerMsg) => {} };
  room.join(human, 'H');
  for (let i = 0; i < 4; i++) expect(room.addBot(human)).toBeNull();
  expect(room.start(human)).toBeNull();
  return { room, human };
}

describe('botThinkMs', () => {
  it('spans each phase range at the default unit and scales with unitMs', () => {
    for (const phase of PHASES) {
      if (phase === 'gameOver') continue;
      const [min, max] = THINK_SECONDS[phase];
      expect(botThinkMs(phase, () => 0, 1400)).toBeCloseTo(min * 1000);
      expect(botThinkMs(phase, () => 0.999999, 1400)).toBeCloseTo(max * 1000, -1);
      expect(botThinkMs(phase, () => 0, 700)).toBeCloseTo(min * 500);
    }
    expect([botThinkMs('night', () => 0, 1400), botThinkMs('night', () => 1, 1400)]).toEqual([4000, 10000]);
    expect([botThinkMs('nominate', () => 0, 1400), botThinkMs('nominate', () => 1, 1400)]).toEqual([5000, 12000]);
    expect([botThinkMs('vote', () => 0, 1400), botThinkMs('vote', () => 1, 1400)]).toEqual([3000, 9000]);
    expect([botThinkMs('investigate', () => 0, 1400), botThinkMs('investigate', () => 1, 1400)]).toEqual([6000, 14000]);
  });
});

describe('per-seat bot plans', () => {
  beforeEach(() => {
    config.timerScale = 1;
    config.botDelayMs = 1_000_000;
  });

  afterEach(() => {
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
  });

  it('draws every pending bot a plan at once when the night opens', () => {
    config.timerScale = 1e4; // keep the deadline cap out of the way
    const before = Date.now();
    const { room } = startGame();
    const u = config.botDelayMs / 1400;
    const plans = plansOf(room);
    expect([...plans.keys()].sort()).toEqual([1, 2, 3, 4]);
    for (const p of plans.values()) {
      expect(p.readyAt).toBeGreaterThanOrEqual(before + 5000 * u - 5);
      expect(p.readyAt).toBeLessThanOrEqual(Date.now() + 11000 * u);
      expect(p.timer).not.toBeNull();
    }
    room.close();
    expect(plans.size).toBe(0);
  });

  it('caps readyAt 5 s (scaled) before the phase deadline', () => {
    const { room } = startGame();
    const deadline = (room as unknown as { deadline: number }).deadline;
    for (const p of plansOf(room).values()) expect(p.readyAt).toBeLessThanOrEqual(deadline - 5000 * config.timerScale);
    room.close();
  });

  it('lets voters act independently, each at its own readyAt', async () => {
    config.botDelayMs = 20; // 1 unit = 20 ms: vote think time 43-129 ms
    config.timerScale = 1;
    const { room, human } = startGame();
    try {
      let voteOpened = 0;
      let readyAts: number[] = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 20_000) {
        const g = room.game!;
        if (g.phase === 'vote') {
          voteOpened = Date.now();
          const plans = [...plansOf(room).values()];
          readyAts = plans.map((p) => p.readyAt);
          expect(plansOf(room).size).toBe(pendingActors(g).filter((s) => s !== 0).length);
          break;
        }
        if (pendingActors(g).includes(0)) room.act(human, legalActions(g, 0)[0]);
        await new Promise((r) => setTimeout(r, 1));
      }
      expect(voteOpened).toBeGreaterThan(0);
      const u = config.botDelayMs / 1400;
      for (const r of readyAts) {
        expect(r).toBeGreaterThanOrEqual(voteOpened - 50 + 3000 * u);
        expect(r).toBeLessThanOrEqual(voteOpened + 50 + 9000 * u);
      }
      expect(new Set(readyAts).size).toBeGreaterThan(1);
      // The human votes now; the phase then ends when the slowest bot's own timer fires (not after the sum of all delays).
      room.act(human, legalActions(room.game!, 0)[0]);
      const t1 = Date.now();
      while (room.game!.phase === 'vote' && Date.now() - t1 < 5000) await new Promise((r) => setTimeout(r, 1));
      expect(room.game!.phase).not.toBe('vote');
      const last = Math.max(...readyAts);
      expect(Date.now()).toBeGreaterThanOrEqual(last - 5);
      // Serialized voters would finish at least 3 × 43 ms after the slowest one's own readyAt.
      expect(Date.now()).toBeLessThan(last + 100);
    } finally {
      room.close();
    }
  });

  it('a bot president does not discard before reveal settle + min think', async () => {
    config.botDelayMs = 20;
    config.timerScale = 1;
    const { room, human } = startGame();
    try {
      const u = config.botDelayMs / 1400;
      let opened = 0;
      let president = -1;
      let readyAt = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 20_000) {
        const g = room.game!;
        if (g.phase === 'legPresident' && g.president !== 0) {
          opened = Date.now();
          president = g.president;
          readyAt = plansOf(room).get(president)!.readyAt;
          break;
        }
        if (pendingActors(g).includes(0)) room.act(human, legalActions(g, 0)[0]);
        await new Promise((r) => setTimeout(r, 1));
      }
      expect(opened).toBeGreaterThan(0);
      expect(readyAt).toBeGreaterThanOrEqual(opened - 10 + (4500 + THINK_SECONDS.legPresident[0] * 1000) * u);
      const t1 = Date.now();
      while (room.game!.phase === 'legPresident' && Date.now() - t1 < 5000) await new Promise((r) => setTimeout(r, 1));
      expect(room.game!.phase).not.toBe('legPresident');
      expect(Date.now() - opened).toBeGreaterThanOrEqual((4500 + THINK_SECONDS.legPresident[0] * 1000) * u - 15);
    } finally {
      room.close();
    }
  });
});

describe('settleMs', () => {
  it('takes the longest settle among the events, scaled by unitMs/1400', () => {
    const votes: GameEvent = { k: 'votes', votes: [true], passed: true };
    const enacted: GameEvent = { k: 'enacted', policy: 'L', chaos: false };
    expect(settleMs([votes], 1400)).toBe(4500);
    expect(settleMs([{ k: 'nominated', president: 0, target: 1 }], 1400)).toBe(2500);
    expect(settleMs([{ k: 'executed', by: 0, target: 1 }], 1400)).toBe(3000);
    expect(settleMs([enacted], 1400)).toBe(1500);
    expect(settleMs([{ k: 'nightStart' }], 1400)).toBe(1000);
    expect(settleMs([enacted, votes], 1400)).toBe(4500);
    expect(settleMs([], 1400)).toBe(0);
    expect(settleMs([votes], 700)).toBe(2250);
  });
});
