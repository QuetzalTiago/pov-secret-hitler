import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Conn } from '../server/room';
import { config } from '../server/config';
import type { ServerMsg } from '../shared/protocol';

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs };

// 2 humans + 3 bots, game started.
function startGame() {
  const onEmpty = vi.fn();
  const room = new Room('ABCD', onEmpty);
  const mk = (id: number): Conn => ({ id, room: null, seat: -1, send: (_m: ServerMsg) => {} });
  const a = mk(1);
  const b = mk(2);
  room.join(a, 'A');
  room.join(b, 'B');
  for (let i = 0; i < 3; i++) expect(room.addBot(a)).toBeNull();
  expect(room.start(a)).toBeNull();
  return { room, onEmpty, a, b };
}

describe('game room emptiness', () => {
  beforeEach(() => {
    config.timerScale = 1;
    config.botDelayMs = 1_000_000;
  });

  afterEach(() => {
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
  });

  it('closes once every human has left', () => {
    const { room, onEmpty, a, b } = startGame();
    room.leave(a);
    expect(onEmpty).not.toHaveBeenCalled();
    room.leave(b);
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it('does not close when the last human merely disconnects', () => {
    const { room, onEmpty, a, b } = startGame();
    room.leave(a);
    room.disconnected(b);
    expect(onEmpty).not.toHaveBeenCalled();
    room.close();
  });

  it('does not close when a human who left has resumed', () => {
    const { room, onEmpty, a, b } = startGame();
    const token = room.seats[0].token;
    room.leave(a);
    const a2: Conn = { id: 3, room: null, seat: -1, send: () => {} };
    expect(room.resume(a2, token)).toBeNull();
    room.leave(b);
    expect(onEmpty).not.toHaveBeenCalled();
    room.close();
  });
});
