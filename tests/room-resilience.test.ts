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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Starts a 5-player game (1 human + 4 bots). Bot scheduling is effectively off so only the phase timer acts.
function startGame() {
  const msgs: ServerMsg[] = [];
  const conn: Conn = { id: 1, room: null, seat: -1, send: (m) => msgs.push(m) };
  const room = new Room('ABCD', () => {});
  room.join(conn, 'Human');
  for (let i = 0; i < 4; i++) expect(room.addBot(conn)).toBeNull();
  expect(room.start(conn)).toBeNull();
  return room;
}

const phaseKey = (room: Room) => `${room.game!.phase}:${room.game!.round}`;

describe('room resilience', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    config.timerScale = 0.001;
    config.botDelayMs = 1_000_000;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
    errorSpy.mockRestore();
  });

  it('survives apply throwing during a phase timeout and keeps progressing', async () => {
    const room = startGame();
    const realApply = (room as any).apply.bind(room);
    (room as any).apply = () => {
      throw new Error('boom');
    };
    const before = phaseKey(room);
    await sleep(80); // night timer is ~20ms
    expect(errorSpy).toHaveBeenCalled();
    expect(phaseKey(room)).toBe(before);

    (room as any).apply = realApply;
    await sleep(120);
    expect(phaseKey(room)).not.toBe(before);
    room.close();
  });

  it('logs and survives a failure inside the timer callback itself', async () => {
    const room = startGame();
    const realTimeout = (room as any).onTimeout.bind(room);
    (room as any).onTimeout = () => {
      throw new Error('timeout boom');
    };
    await sleep(80);
    expect(errorSpy).toHaveBeenCalledWith('[room] onTimeout failed', expect.any(Error));
    (room as any).onTimeout = realTimeout;
    room.close();
  });

  it('falls back to legal[0] when the first choice is rejected', async () => {
    const room = startGame();
    const realApply = (room as any).apply.bind(room);
    const tried: string[] = [];
    (room as any).apply = (seat: number, body: { type: string }) => {
      tried.push(body.type);
      return body.type === 'ack' ? realApply(seat, body) : 'nope';
    };
    const before = phaseKey(room);
    await sleep(80);
    expect(errorSpy).toHaveBeenCalledWith('[bot] illegal move', expect.anything(), { type: 'peekDone' }, 'nope');
    expect(tried.slice(0, 2)).toEqual(['peekDone', 'ack']);
    expect(phaseKey(room)).not.toBe(before);
    room.close();
  });
});
