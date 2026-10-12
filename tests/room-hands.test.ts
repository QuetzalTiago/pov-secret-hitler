import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Room, type Conn } from '../server/room';
import { config } from '../server/config';
import type { Memory } from '../shared/tracker';
import type { GameState } from '../shared/types';
import { elect, roles, setup } from './helpers';

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs };

type Internals = { game: GameState | null; memories: Memory[]; apply(seat: number, body: object): string | null };

// Quick-starts a table (bots stay idle with the huge delay), then swaps in a game at the legislative session.
function legislative() {
  const room = new Room('ABCD', () => {});
  const conn: Conn = { id: 1, room: null, seat: -1, send: () => {} };
  expect(room.join(conn, 'Human')).toBeNull();
  expect(room.quickStart(conn)).toBeNull();
  const inner = room as unknown as Internals;
  const n = inner.game!.players.length;
  const s = setup(n, { president: 0, roles: roles(n, n - 1, []), deck: ['F', 'L', 'F', ...Array(14).fill('L')] });
  inner.game = elect(s, 1);
  return { room, inner };
}

describe('room records bot hands when the action is applied', () => {
  beforeEach(() => {
    config.timerScale = 1;
    config.botDelayMs = 1_000_000;
  });
  afterEach(() => {
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
  });

  it('records the president hand once, only on a successful discard', () => {
    const { room, inner } = legislative();
    const round = inner.game!.round;
    expect(inner.apply(0, { type: 'presDiscard', index: 9 })).not.toBeNull();
    expect(inner.apply(1, { type: 'presDiscard', index: 0 })).not.toBeNull();
    expect(inner.memories[0].passed).toHaveLength(0);
    expect(inner.apply(0, { type: 'presDiscard', index: 1 })).toBeNull();
    expect(inner.apply(0, { type: 'presDiscard', index: 0 })).not.toBeNull();
    expect(inner.memories[0].passed).toEqual([{ round, to: 1, gave: ['F', 'F'], drew: ['F', 'L', 'F'] }]);
    room.close();
  });

  it('records the chancellor hand once the enact is applied', () => {
    const { room, inner } = legislative();
    const round = inner.game!.round;
    inner.apply(0, { type: 'presDiscard', index: 1 });
    expect(inner.apply(1, { type: 'chancEnact', index: 5 })).not.toBeNull();
    expect(inner.memories[1].received).toHaveLength(0);
    expect(inner.apply(1, { type: 'chancEnact', index: 0 })).toBeNull();
    expect(inner.memories[1].received).toEqual([{ round, from: 0, got: ['F', 'F'] }]);
    room.close();
  });
});
