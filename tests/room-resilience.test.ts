import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Conn } from '../server/room';
import { config } from '../server/config';
import type { ServerMsg } from '../shared/protocol';

// Bots' immediate choice is never legal[0] here, so botMove has to fall back.
vi.mock('../server/brain', async (orig) => ({
  ...(await orig<typeof import('../server/brain')>()),
  decideNow: vi.fn(() => ({ type: 'peekDone' })),
}));

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs };

// Starts a 5-player game (1 human + 4 bots). Bot scheduling is effectively off so only the phase timer acts.
function startGame() {
  const msgs: ServerMsg[] = [];
  const conn: Conn = { id: 1, room: null, seat: -1, send: (m) => msgs.push(m) };
  const room = new Room('ABCD', () => {});
  room.join(conn, 'Human');
  for (let i = 0; i < 4; i++) expect(room.addBot(conn)).toBeNull();
  expect(room.start(conn)).toBeNull();
  // Bot plans are capped just before the phase deadline, which would let bots beat the 20ms timer; drop them.
  (room as any).clearBotPlans();
  return { room, msgs };
}

const phaseKey = (room: Room) => `${room.game!.phase}:${room.game!.round}`;

describe('room resilience', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    config.timerScale = 0.001;
    config.botDelayMs = 1_000_000;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
    errorSpy.mockRestore();
  });

  it('survives apply throwing during a phase timeout and keeps progressing', async () => {
    const { room } = startGame();
    const realApply = (room as any).apply.bind(room);
    (room as any).apply = () => {
      throw new Error('boom');
    };
    const before = phaseKey(room);
    await vi.advanceTimersByTimeAsync(80); // night timer is ~20ms
    expect(errorSpy).toHaveBeenCalled();
    expect(phaseKey(room)).toBe(before);

    (room as any).apply = realApply;
    await vi.advanceTimersByTimeAsync(120);
    expect(phaseKey(room)).not.toBe(before);
    room.close();
  });

  it('logs and survives a failure inside the timer callback itself', async () => {
    const { room } = startGame();
    const realTimeout = (room as any).onTimeout.bind(room);
    (room as any).onTimeout = () => {
      throw new Error('timeout boom');
    };
    await vi.advanceTimersByTimeAsync(80);
    expect(errorSpy).toHaveBeenCalledWith('[room] onTimeout failed', expect.any(Error));
    (room as any).onTimeout = realTimeout;
    room.close();
  });

  it('falls back to legal[0] when the first choice is rejected', async () => {
    const { room } = startGame();
    const realApply = (room as any).apply.bind(room);
    const tried: string[] = [];
    (room as any).apply = (seat: number, body: { type: string }) => {
      tried.push(body.type);
      return body.type === 'ack' ? realApply(seat, body) : 'nope';
    };
    const before = phaseKey(room);
    await vi.advanceTimersByTimeAsync(80);
    expect(errorSpy).toHaveBeenCalledWith('[bot] illegal move', expect.anything(), { type: 'peekDone' }, 'nope');
    expect(tried.slice(0, 2)).toEqual(['peekDone', 'ack']);
    expect(phaseKey(room)).not.toBe(before);
    room.close();
  });

  it('tells the human, and only the human, they timed out', async () => {
    const { room, msgs } = startGame();
    await vi.advanceTimersByTimeAsync(80); // night timer is ~20ms
    const events = msgs.flatMap((m) => (m.t === 'room' ? m.room.events : []));
    const timedOut = events.filter((e) => e.k === 'timedOut');
    expect(timedOut).toContainEqual({ k: 'timedOut', seat: 0 });
    expect(timedOut.every((e) => e.seat === 0)).toBe(true);
    room.close();
  });
});
