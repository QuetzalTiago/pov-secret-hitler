import { describe, expect, it } from 'vitest';
import { BeatQueue, scheduleBatch, type Timed } from '../client/beats';
import type { GameEvent } from '../shared/types';

const ctx = { chancellor: 2, fascistBefore: 0 };
const votes = (passed: boolean): GameEvent => ({ k: 'votes', votes: [true, false, true, false, true], passed });
const pres: GameEvent = { k: 'newPresident', seat: 1, special: false };
const chaos: GameEvent = { k: 'enacted', policy: 'F', chaos: true };
const at = (beats: Timed[], k: string, i = 0) => beats.filter((b) => b.beat.k === k)[i]?.at;
const sorted = (beats: Timed[]) => beats.every((b, i) => i === 0 || beats[i - 1].at <= b.at);

describe('scheduleBatch', () => {
  it('empty batch', () => {
    expect(scheduleBatch([], ctx)).toEqual({ beats: [], victoryAt: null, endsAt: 0 });
  });

  it('failed vote: the coin steps up mid-reveal', () => {
    const s = scheduleBatch([votes(false), { k: 'tracker', value: 1 }, pres], ctx);
    expect(at(s.beats, 'votes')).toBe(0);
    expect(at(s.beats, 'tracker')).toBe(1200);
    expect(at(s.beats, 'newPresident')).toBeGreaterThanOrEqual(1200);
    expect(s.victoryAt).toBeNull();
  });

  it('a passed vote keeps its tracker 0 at 0', () => {
    const s = scheduleBatch([votes(true), { k: 'tracker', value: 0 }], ctx);
    expect(at(s.beats, 'tracker')).toBe(0);
  });

  it('chaos after a vote waits for the reveal, then the banner', () => {
    const s = scheduleBatch([votes(false), { k: 'tracker', value: 3 }, { k: 'tracker', value: 0 }, chaos, pres], ctx);
    expect(at(s.beats, 'tracker', 0)).toBe(1200);
    expect(at(s.beats, 'chaos')).toBe(4500);
    expect(at(s.beats, 'tracker', 1)).toBe(5900);
    expect(at(s.beats, 'enacted')).toBe(5900);
    expect(at(s.beats, 'newPresident')).toBe(5900 + 3150);
    expect(sorted(s.beats)).toBe(true);
    expect(s.endsAt).toBe(9050);
  });

  it('chaos after an accepted veto', () => {
    const s = scheduleBatch([
      { k: 'vetoAnswer', accepted: true }, { k: 'tracker', value: 3 }, { k: 'tracker', value: 0 }, chaos, pres,
    ], ctx);
    expect(s.beats.find((b) => b.beat.k === 'vetoTracker')).toEqual({ at: 900, beat: { k: 'vetoTracker', value: 3 } });
    expect(at(s.beats, 'chaos')).toBe(2100);
    expect(at(s.beats, 'enacted')).toBe(3500);
    expect(at(s.beats, 'tracker')).toBe(3500);
  });

  it('accepted veto without chaos gives a vetoTracker, not a tracker', () => {
    const s = scheduleBatch([{ k: 'vetoAnswer', accepted: true }, { k: 'tracker', value: 1 }, pres], ctx);
    expect(at(s.beats, 'vetoTracker')).toBe(900);
    expect(at(s.beats, 'tracker')).toBeUndefined();
    expect(at(s.beats, 'chaos')).toBeUndefined();
  });

  it('chaos that wins excludes gameOver and times the victory from the enactment', () => {
    const s = scheduleBatch([
      votes(false), { k: 'tracker', value: 3 }, { k: 'tracker', value: 0 }, chaos,
      { k: 'gameOver', winner: 'fascist', reason: 'fascistPolicies' },
    ], ctx);
    expect(s.beats.some((b) => b.beat.k === 'gameOver')).toBe(false);
    expect(s.victoryAt).toBe(5900 + 2900);
    expect(s.endsAt).toBe(8800);
  });

  it('Hitler elected reveals the Chancellor mid-reveal', () => {
    const s = scheduleBatch([votes(true), { k: 'gameOver', winner: 'fascist', reason: 'hitlerElected' }], ctx);
    expect(s.beats.find((b) => b.beat.k === 'hitlerRevealed')).toEqual({ at: 2000, beat: { k: 'hitlerRevealed', seat: 2 } });
    expect(s.victoryAt).toBe(4800);
    expect(s.beats.some((b) => b.beat.k === 'gameOver')).toBe(false);
  });

  it('veto unlock on the 5th Fascist policy lands after the banner, sorted after later beats', () => {
    const power: GameEvent = { k: 'power', power: 'execute', president: 0 };
    const s = scheduleBatch([{ k: 'chancDiscarded', seat: 2 }, { k: 'enacted', policy: 'F', chaos: false }, power, pres], { chancellor: 2, fascistBefore: 4 });
    expect(at(s.beats, 'vetoUnlocked')).toBe(650 + 2500 + 1200);
    expect(at(s.beats, 'power')).toBe(0);
    expect(s.beats[s.beats.length - 1].beat.k).toBe('vetoUnlocked');
    expect(sorted(s.beats)).toBe(true);
    expect(s.endsAt).toBe(4350);
  });

  it('no vetoUnlocked past 5 Fascist policies or with a gameOver', () => {
    const enact: GameEvent = { k: 'enacted', policy: 'F', chaos: false };
    expect(at(scheduleBatch([enact, pres], { chancellor: 2, fascistBefore: 5 }).beats, 'vetoUnlocked')).toBeUndefined();
    const over: GameEvent = { k: 'gameOver', winner: 'fascist', reason: 'fascistPolicies' };
    expect(at(scheduleBatch([enact, over], { chancellor: 2, fascistBefore: 4 }).beats, 'vetoUnlocked')).toBeUndefined();
  });
});

describe('BeatQueue', () => {
  const sched = (n: number) => ({ beats: [{ at: 0, beat: { k: 'chaos' } as const }, { at: n, beat: { k: 'vetoUnlocked' } as const }], victoryAt: null, endsAt: n });

  it('releases beats in time order', () => {
    const q = new BeatQueue();
    expect(q.push(sched(500), 1000)).toBe(1000);
    expect(q.pending).toBe(true);
    expect(q.due(999)).toEqual([]);
    expect(q.due(1000)).toEqual([{ k: 'chaos' }]);
    expect(q.due(1600)).toEqual([{ k: 'vetoUnlocked' }]);
    expect(q.pending).toBe(false);
  });

  it('a second batch waits for the tail', () => {
    const q = new BeatQueue();
    q.push(sched(500), 1000);
    expect(q.push(sched(100), 1200)).toBe(1500);
    expect(q.due(1500)).toEqual([{ k: 'chaos' }, { k: 'vetoUnlocked' }, { k: 'chaos' }]);
  });

  it('victoryAt does not hold the queue', () => {
    const q = new BeatQueue();
    q.push({ beats: [], victoryAt: 9000, endsAt: 9000 }, 0);
    expect(q.push(sched(0), 100)).toBe(100);
  });

  it('clear drops everything', () => {
    const q = new BeatQueue();
    q.push(sched(500), 1000);
    q.clear();
    expect(q.pending).toBe(false);
    expect(q.push(sched(0), 0)).toBe(0);
  });
});
