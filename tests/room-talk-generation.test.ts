import { afterEach, describe, expect, it, vi } from 'vitest';
import { Room, type Conn } from '../server/room';

const mk = (id: number, got: any[] = []): Conn => ({ id, room: null, seat: -1, send: (m: any) => { if (m.t === 'chat') got.push(m); } });

/** Humans A (host, seat 0) and B (seat 1) plus four bots, forced to game over. */
function finished() {
  const got: any[] = [];
  const room = new Room('ABCD', () => {});
  const a = mk(0, got);
  const b = mk(1);
  room.join(a, 'A');
  room.join(b, 'B');
  for (let i = 0; i < 4; i++) expect(room.addBot(a)).toBeNull();
  expect(room.start(a)).toBeNull();
  room.game = { ...room.game!, phase: 'gameOver', winner: 'liberal', winReason: 'liberalPolicies' };
  (room as any).after([{ k: 'gameOver', winner: 'liberal', reason: 'liberalPolicies' }]);
  return { room, a, b, got };
}

const texts = (got: any[]) => got.map((m) => m.text);

describe('table talk generations', () => {
  afterEach(() => vi.useRealTimers());

  it('queued and scheduled bot lines from before a redeal are never posted', async () => {
    vi.useFakeTimers();
    const { room, a, b, got } = finished();
    room.leave(b); // B is dropped on the redeal, so the bots below shift down a seat
    void (room as any).say(4, 'OLD-QUEUED');
    void (room as any).say(4, 'OLD-QUEUED');
    (room as any).sayLater(3, 'OLD-LATER', 1000);
    expect(room.forceRedeal(a)).toBeNull();
    expect(room.seats).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(texts(got)).not.toContain('OLD-QUEUED');
    expect(texts(got)).not.toContain('OLD-LATER');
    void (room as any).say(3, 'NEW');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(texts(got)).toContain('NEW');
    room.close();
  });

  it('a speak that is still pending when the redeal happens posts nothing', async () => {
    vi.useFakeTimers();
    const { room, a, b, got } = finished();
    room.leave(b);
    const spoken = (room as any).speak(4, { kind: 'line', line: 'OLD-SPEAK' }) as Promise<boolean>;
    expect(room.forceRedeal(a)).toBeNull();
    await spoken;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(texts(got)).not.toContain('OLD-SPEAK');
    room.close();
  });
});
