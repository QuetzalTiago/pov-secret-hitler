import { describe, expect, it } from 'vitest';
import type { GameView } from '../shared/view';
import { TurnCue, myTurnKey } from '../client/turncue';

function view(
  phase: string,
  pending: number[],
  o: { you?: number | null; round?: number; vetoRefused?: boolean; dead?: number[] } = {},
): GameView {
  const dead = o.dead ?? [];
  const players = [0, 1, 2, 3, 4].map((seat) => ({ seat, alive: !dead.includes(seat) }));
  return {
    you: o.you === undefined ? 2 : o.you,
    phase,
    round: o.round ?? 1,
    vetoRefused: o.vetoRefused ?? false,
    pending,
    players,
  } as unknown as GameView;
}

describe('myTurnKey', () => {
  it('is null when it is not my turn', () => {
    expect(myTurnKey(null)).toBeNull();
    expect(myTurnKey(view('nominate', [1]))).toBeNull();
    expect(myTurnKey(view('nominate', [2], { you: null }))).toBeNull();
    expect(myTurnKey(view('nominate', [2], { dead: [2] }))).toBeNull();
    expect(myTurnKey(view('gameOver', [2]))).toBeNull();
  });

  it('combines phase, round and vetoRefused', () => {
    expect(myTurnKey(view('nominate', [2], { round: 3 }))).toBe('nominate:3:false');
  });
});

describe('TurnCue', () => {
  it('fires once when I become pending', () => {
    const cue = new TurnCue();
    expect(cue.update(view('nominate', [1]))).toBe(false);
    expect(cue.update(view('nominate', [2]))).toBe(true);
    expect(cue.update(view('nominate', [2]))).toBe(false);
  });

  it('fires again for a new phase, round or veto state', () => {
    const cue = new TurnCue();
    expect(cue.update(view('nominate', [2]))).toBe(true);
    expect(cue.update(view('vote', [2]))).toBe(true);
    expect(cue.update(view('vote', [2], { round: 2 }))).toBe(true);
    expect(cue.update(view('legChancellor', [2], { round: 2 }))).toBe(true);
    expect(cue.update(view('legChancellor', [2], { round: 2, vetoRefused: true }))).toBe(true);
  });

  it('does not fire when not my turn', () => {
    const cue = new TurnCue();
    expect(cue.update(null)).toBe(false);
    expect(cue.update(view('nominate', [2], { you: null }))).toBe(false);
    expect(cue.update(view('nominate', [2], { dead: [2] }))).toBe(false);
    expect(cue.update(view('gameOver', [2]))).toBe(false);
  });

  it('fires the same key again after reset', () => {
    const cue = new TurnCue();
    expect(cue.update(view('nominate', [2]))).toBe(true);
    cue.reset();
    expect(cue.update(view('nominate', [2]))).toBe(true);
  });
});
