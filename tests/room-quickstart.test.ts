import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Room, type Conn } from '../server/room';
import { config } from '../server/config';
import type { ServerMsg } from '../shared/protocol';

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs };

function setup() {
  const msgs: ServerMsg[] = [];
  const conn: Conn = { id: 1, room: null, seat: -1, send: (m) => msgs.push(m) };
  const room = new Room('ABCD', () => {});
  expect(room.join(conn, 'Human')).toBeNull();
  return { room, conn, msgs };
}

describe('room quickStart', () => {
  beforeEach(() => {
    config.timerScale = 0.001;
    config.botDelayMs = 1_000_000;
  });

  afterEach(() => {
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
  });

  it('fills the table to 7 with bots and deals', () => {
    const { room, conn, msgs } = setup();
    expect(room.quickStart(conn)).toBeNull();
    expect(room.stage).toBe('game');
    expect(room.game!.players.length).toBe(7);
    const last = [...msgs].reverse().find((m) => m.t === 'room');
    const seats = (last as Extract<ServerMsg, { t: 'room' }>).room.seats;
    expect(seats.length).toBe(7);
    expect(seats.filter((s) => !s.bot).map((s) => s.name)).toEqual(['Human']);
    expect(seats.filter((s) => s.bot).length).toBe(6);
    room.close();
  });

  it('refuses a guest who is not the host', () => {
    const { room } = setup();
    const guest: Conn = { id: 2, room: null, seat: -1, send: () => {} };
    expect(room.join(guest, 'Guest')).toBeNull();
    expect(room.quickStart(guest)).not.toBeNull();
    expect(room.stage).toBe('lobby');
    room.close();
  });

  it('refuses once the game has started', () => {
    const { room, conn } = setup();
    expect(room.quickStart(conn)).toBeNull();
    expect(room.quickStart(conn)).not.toBeNull();
    room.close();
  });
});
