import { describe, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import { Room, type Conn } from '../server/room';

const mk = (id: number): Conn => ({ id, room: null, seat: -1, send: () => {} });

function lobby(names: string[]) {
  const room = new Room('ABCD', () => {});
  const conns = names.map((n, i) => {
    const c = mk(i);
    room.join(c, n);
    return c;
  });
  return { room, conns };
}

describe('Room host after a lobby seat is removed', () => {
  it('keeps the same host when a seat below the host leaves', () => {
    const { room, conns } = lobby(['A', 'B', 'C']);
    room.host = 2;
    room.leave(conns[0]);
    expect(room.seats[room.host].name).toBe('C');
    expect(conns[2].seat).toBe(room.host);
    room.close();
  });

  it('hands host to the first remaining human when the host leaves', () => {
    const { room, conns } = lobby(['A', 'B', 'C']);
    room.leave(conns[0]);
    expect(room.seats[room.host].name).toBe('B');
    room.close();
  });

  it('keeps the host when a seat after the host leaves', () => {
    const { room, conns } = lobby(['A', 'B']);
    expect(room.addBot(conns[0])).toBeNull();
    room.leave(conns[1]);
    expect(room.seats[room.host].name).toBe('A');
    room.close();
  });

  it('keeps the same host across rematch when a disconnected seat below the host has run out of grace', () => {
    vi.useFakeTimers();
    try {
      const { room, conns } = lobby(['A', 'B', 'C']);
      room.host = 2;
      expect(room.addBot(conns[2])).toBeNull();
      expect(room.addBot(conns[2])).toBeNull();
      expect(room.start(conns[2])).toBeNull();
      room.game = { ...room.game!, phase: 'gameOver' };
      room.disconnected(conns[0]);
      vi.advanceTimersByTime(config.reconnectGraceMs + 1);
      expect(room.rematch(conns[2])).toBeNull();
      expect(room.seats.filter((s) => !s.bot).map((s) => s.name)).toEqual(['B', 'C']);
      expect(room.seats[room.host].name).toBe('C');
      expect(conns[2].seat).toBe(room.host);
      room.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Room host when the host leaves a game', () => {
  it('hands host to the next connected human when the host leaves at game over, who can then deal', () => {
    const { room, conns } = lobby(['A', 'B', 'C']);
    expect(room.addBot(conns[0])).toBeNull();
    expect(room.addBot(conns[0])).toBeNull();
    expect(room.start(conns[0])).toBeNull();
    room.game = { ...room.game!, phase: 'gameOver' };
    room.leave(conns[0]);
    expect(room.seats[room.host].name).toBe('B');
    expect(room.forceRedeal(conns[1])).toBeNull();
    expect(room.seats.filter((s) => !s.bot).map((s) => s.name)).toEqual(['B', 'C']);
    expect(room.seats[room.host].name).toBe('B');
    expect(conns[1].seat).toBe(room.host);
    room.close();
  });

  it('skips a disconnected human when handing host over', () => {
    vi.useFakeTimers();
    try {
      const { room, conns } = lobby(['A', 'B', 'C']);
      expect(room.addBot(conns[0])).toBeNull();
      expect(room.addBot(conns[0])).toBeNull();
      expect(room.start(conns[0])).toBeNull();
      room.game = { ...room.game!, phase: 'gameOver' };
      room.disconnected(conns[1]);
      room.leave(conns[0]);
      expect(room.seats[room.host].name).toBe('C');
      expect(room.rematch(conns[2])).toBeNull();
      room.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps host when no other connected human remains', () => {
    const { room, conns } = lobby(['A']);
    for (let i = 0; i < 4; i++) expect(room.addBot(conns[0])).toBeNull();
    expect(room.start(conns[0])).toBeNull();
    room.leave(conns[0]);
    expect(room.host).toBe(0);
    room.close();
  });
});
