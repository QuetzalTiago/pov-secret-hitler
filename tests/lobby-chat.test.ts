import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Conn } from '../server/room';
import type { ServerMsg } from '../shared/protocol';

type ChatMsg = Extract<ServerMsg, { t: 'chat' }>;
const chats = (msgs: ServerMsg[]) => msgs.filter((m): m is ChatMsg => m.t === 'chat');

function twoSeats() {
  const a: ServerMsg[] = [];
  const b: ServerMsg[] = [];
  const ca: Conn = { id: 1, room: null, seat: -1, send: (m) => a.push(m) };
  const cb: Conn = { id: 2, room: null, seat: -1, send: (m) => b.push(m) };
  const room = new Room('ABCD', () => {});
  room.join(ca, 'Ana');
  room.join(cb, 'Ben');
  return { room, ca, b };
}

describe('lobby chat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reaches the other seat before the game starts', () => {
    const { room, ca, b } = twoSeats();
    expect(room.stage).toBe('lobby');
    expect(room.chat(ca, 'hola')).toBeNull();
    expect(chats(b)).toEqual([{ t: 'chat', seat: 0, name: 'Ana', text: 'hola' }]);
    room.close();
  });

  it('rejects an unseated connection', () => {
    const room = new Room('ABCD', () => {});
    const stranger: Conn = { id: 9, room: null, seat: -1, send: () => {} };
    expect(room.chat(stranger, 'hi')).toBe('You are not seated.');
    room.close();
  });

  it('gets no bot reply in the lobby', () => {
    const { room, ca, b } = twoSeats();
    expect(room.addBot(ca)).toBeNull();
    expect(room.chat(ca, 'hola')).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(chats(b).map((m) => m.text)).toEqual(['hola']);
    room.close();
  });
});
