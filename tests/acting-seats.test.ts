import { describe, expect, it } from 'vitest';
import { actingSeats, type GameView } from '../shared/view';

function view(phase: string, pending: number[], dead: number[] = []): GameView {
  const players = [0, 1, 2, 3, 4].map((seat) => ({ seat, alive: !dead.includes(seat) }));
  return { phase, pending, players } as unknown as GameView;
}

describe('actingSeats', () => {
  it('returns the pending seats in a normal phase', () => {
    expect(actingSeats(view('nominate', [2]))).toEqual([2]);
    expect(actingSeats(view('vote', [0, 1, 3]))).toEqual([0, 1, 3]);
  });

  it('drops dead seats', () => {
    expect(actingSeats(view('vote', [0, 1, 3], [1]))).toEqual([0, 3]);
  });

  it('is empty at night and at game over', () => {
    expect(actingSeats(view('night', [0, 1, 2, 3, 4]))).toEqual([]);
    expect(actingSeats(view('gameOver', [0, 1]))).toEqual([]);
  });
});
