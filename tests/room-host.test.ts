import { describe, expect, it } from 'vitest';
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
});
