import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Conn } from '../server/room';
import { config } from '../server/config';
import { THINK_SECONDS, SETTLE_SECONDS, botTempo, botThinkMs, settleMs } from '../server/pacing';
import { legalActions, pendingActors } from '../shared/engine';
import { PHASES, type GameEvent } from '../shared/types';
import type { ServerMsg } from '../shared/protocol';
import { scheduleBatch } from '../client/beats';

const TEMPO_MIN = 0.75;
const TEMPO_MAX = 1.35;

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs };
// Fixed wall clock for tests that install fake timers, so Date.now() bounds are exact.
const FROZEN_NOW = 1_700_000_000_000;
// Upper bound on fake-timer steps in the busy-wait loops; the phases under test finish well before this.
const MAX_STEPS = 10_000;

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
    vi.useRealTimers();
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
  });

  it('draws every pending bot a plan at once when the night opens', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    config.timerScale = 1e4; // keep the deadline cap out of the way
    const { room } = startGame();
    const u = config.botDelayMs / 1400;
    const plans = plansOf(room);
    expect([...plans.keys()].sort()).toEqual([1, 2, 3, 4]);
    for (const p of plans.values()) {
      expect(p.readyAt).toBeGreaterThanOrEqual(FROZEN_NOW + (SETTLE_SECONDS.other + THINK_SECONDS.night[0] * TEMPO_MIN) * 1000 * u);
      expect(p.readyAt).toBeLessThanOrEqual(FROZEN_NOW + (SETTLE_SECONDS.other + THINK_SECONDS.night[1] * TEMPO_MAX) * 1000 * u);
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
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    config.botDelayMs = 20; // 1 unit = 20 ms: vote think time 43-129 ms
    config.timerScale = 1;
    const { room, human } = startGame();
    try {
      let voteOpened = 0;
      let readyAts: number[] = [];
      for (let step = 0; step < MAX_STEPS; step++) {
        const g = room.game!;
        if (g.phase === 'vote') {
          voteOpened = Date.now();
          const plans = [...plansOf(room).values()];
          readyAts = plans.map((p) => p.readyAt);
          expect(plansOf(room).size).toBe(pendingActors(g).filter((s) => s !== 0).length);
          break;
        }
        // Our own move may open the phase now: re-check before letting time pass.
        if (pendingActors(g).includes(0)) room.act(human, legalActions(g, 0)[0]);
        else await vi.advanceTimersToNextTimerAsync();
      }
      expect(voteOpened).toBeGreaterThan(0);
      const u = config.botDelayMs / 1400;
      for (const r of readyAts) {
        expect(r).toBeGreaterThanOrEqual(voteOpened + THINK_SECONDS.vote[0] * TEMPO_MIN * 1000 * u);
        // The vote opens on a nomination, so the plan also waits out its settle.
        expect(r).toBeLessThanOrEqual(voteOpened + (SETTLE_SECONDS.nominated + THINK_SECONDS.vote[1] * TEMPO_MAX) * 1000 * u);
      }
      expect(new Set(readyAts).size).toBeGreaterThan(1);
      // The human votes now; the phase then ends when the slowest bot's own timer fires (not after the sum of all delays).
      room.act(human, legalActions(room.game!, 0)[0]);
      for (let step = 0; step < MAX_STEPS && room.game!.phase === 'vote'; step++) await vi.advanceTimersToNextTimerAsync();
      expect(room.game!.phase).not.toBe('vote');
      const last = Math.max(...readyAts);
      expect(Date.now()).toBeGreaterThanOrEqual(Math.floor(last)); // timers fire on whole ms; readyAt is fractional
      // Serialized voters would finish at least 3 × 43 ms after the slowest one's own readyAt.
      expect(Date.now()).toBeLessThan(last + 3 * 43);
    } finally {
      room.close();
    }
  });

  it('a bot president does not discard before reveal settle + min think', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    config.botDelayMs = 20;
    config.timerScale = 1;
    const { room, human } = startGame();
    try {
      const u = config.botDelayMs / 1400;
      let opened = 0;
      let president = -1;
      let readyAt = 0;
      for (let step = 0; step < MAX_STEPS; step++) {
        const g = room.game!;
        if (g.phase === 'legPresident' && g.president !== 0) {
          opened = Date.now();
          president = g.president;
          readyAt = plansOf(room).get(president)!.readyAt;
          break;
        }
        // Our own move may open the phase now: re-check before letting time pass.
        if (pendingActors(g).includes(0)) room.act(human, legalActions(g, 0)[0]);
        else await vi.advanceTimersToNextTimerAsync();
      }
      expect(opened).toBeGreaterThan(0);
      const minWait = (SETTLE_SECONDS.votes + THINK_SECONDS.legPresident[0] * TEMPO_MIN) * 1000 * u;
      expect(readyAt).toBeGreaterThanOrEqual(opened + minWait);
      for (let step = 0; step < MAX_STEPS && room.game!.phase === 'legPresident'; step++) await vi.advanceTimersToNextTimerAsync();
      expect(room.game!.phase).not.toBe('legPresident');
      expect(Date.now() - opened).toBeGreaterThanOrEqual(minWait);
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
    expect(settleMs([enacted], 1400)).toBe(4000);
    expect(settleMs([{ k: 'nightStart' }], 1400)).toBe(1000);
    expect(settleMs([enacted, votes], 1400)).toBe(4500);
    expect(settleMs([enacted, { k: 'nightStart' }], 1400)).toBe(4000);
    expect(settleMs([], 1400)).toBe(0);
    expect(settleMs([votes], 700)).toBe(2250);
  });

  it('settles a chaos enactment for the longer chaos beat', () => {
    const chaos: GameEvent = { k: 'enacted', policy: 'F', chaos: true };
    expect(settleMs([chaos], 1400)).toBe(SETTLE_SECONDS.chaos * 1000);
    expect(settleMs([chaos], 700)).toBe(SETTLE_SECONDS.chaos * 500);
  });

  it('covers the whole client chaos beat plus a second of air', () => {
    const batch: GameEvent[] = [
      { k: 'votes', votes: [false, false, false, false, false], passed: false },
      { k: 'tracker', value: 3 },
      { k: 'tracker', value: 0 },
      { k: 'enacted', policy: 'F', chaos: true },
      { k: 'newPresident', seat: 1, special: false },
    ];
    expect(SETTLE_SECONDS.chaos * 1000).toBeGreaterThanOrEqual(scheduleBatch(batch, { chancellor: null, fascistBefore: 0 }).endsAt + 1000);
  });
});

describe('botTempo', () => {
  it('stays within range, is deterministic and differs across names', () => {
    const names = Array.from({ length: 500 }, (_, i) => `Bot ${i}`);
    for (const n of names) {
      const t = botTempo(n);
      expect(t).toBeGreaterThanOrEqual(TEMPO_MIN);
      expect(t).toBeLessThanOrEqual(TEMPO_MAX);
      expect(botTempo(n)).toBe(t);
    }
    expect(new Set(['Ada', 'Bruno', 'Chen', 'Dara', 'Eli'].map(botTempo)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(names.map(botTempo)).size).toBeGreaterThan(100);
  });
});

describe('bot think time ignores the hand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
  });

  it('LLL and LLF hands get the same ready time', () => {
    config.timerScale = 1e4; // keep the deadline cap out of the way
    config.botDelayMs = 1_000_000;
    const { room } = startGame();
    try {
      const r = room as unknown as { schedule(settle?: number): void; game: { phase: string; president: number; hand: string[] } };
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      r.game.phase = 'legPresident';
      r.game.president = 1;
      const readyFor = (hand: string[]) => {
        r.game.hand = hand;
        plansOf(room).clear();
        r.schedule();
        return plansOf(room).get(1)!.readyAt;
      };
      const spread: number[] = [];
      for (const rnd of [0.1, 0.5, 0.9]) {
        vi.spyOn(Math, 'random').mockReturnValue(rnd);
        const lll = readyFor(['L', 'L', 'L']);
        expect(readyFor(['L', 'L', 'F'])).toBe(lll);
        expect(readyFor(['F', 'F', 'F'])).toBe(lll);
        spread.push(lll);
      }
      expect(spread[0]).toBeLessThan(spread[1]);
      expect(spread[1]).toBeLessThan(spread[2]);
    } finally {
      room.close();
    }
  });
});

describe('bot plans after an enactment', () => {
  afterEach(() => {
    vi.useRealTimers();
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
  });

  it('wait out the enacted ceremony before thinking', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    config.timerScale = 1e4; // keep the deadline cap out of the way
    config.botDelayMs = 1_000_000;
    const { room } = startGame();
    try {
      const u = config.botDelayMs / 1400;
      const r = room as unknown as { schedule(settle?: number): void; game: { phase: keyof typeof THINK_SECONDS } };
      plansOf(room).clear();
      const now = FROZEN_NOW;
      r.schedule(settleMs([{ k: 'enacted', policy: 'L', chaos: false }]));
      expect(plansOf(room).size).toBeGreaterThan(0);
      const floor = now + SETTLE_SECONDS.enacted * 1000 * u + THINK_SECONDS[r.game.phase][0] * 1000 * u * TEMPO_MIN;
      for (const p of plansOf(room).values()) expect(p.readyAt).toBeGreaterThanOrEqual(floor);
    } finally {
      room.close();
    }
  });
});
