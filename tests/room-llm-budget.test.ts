import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../server/config';
import { resetLlmState, write } from '../server/llm';
import { Room, type Conn } from '../server/room';

const mk = (id: number): Conn => ({ id, room: null, seat: -1, send: () => {} });
const okBody = { candidates: [{ content: { parts: [{ text: 'fine, whatever you say' }] } }] };
const okFetch = () => vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));

const saved = { ...config.llm };
const savedPacing = config.chatPacing;

beforeEach(() => {
  resetLlmState();
});

afterEach(() => {
  Object.assign(config.llm, saved);
  config.chatPacing = savedPacing;
  resetLlmState();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('write() onSent', () => {
  it('is called only when a request goes out', async () => {
    const onSent = vi.fn();
    const f = okFetch();
    const req = { system: 's', user: 'u' };

    config.llm.key = '';
    expect(await write(req, f as unknown as typeof fetch, onSent)).toBeNull();
    expect(onSent).not.toHaveBeenCalled();

    config.llm.key = 'test';
    config.llm.maxInflight = 0;
    expect(await write(req, f as unknown as typeof fetch, onSent)).toBeNull();
    expect(onSent).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();

    config.llm.maxInflight = 4;
    expect(await write(req, f as unknown as typeof fetch, onSent)).toBe('fine, whatever you say');
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('room LLM budget', () => {
  it('is cumulative across deals', async () => {
    vi.useFakeTimers();
    config.llm.key = 'test';
    config.llm.maxCallsPerGame = 1000;
    config.llm.maxCallsPerRoom = 3;
    config.chatPacing = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const f = okFetch();
    vi.stubGlobal('fetch', f);

    const room = new Room('ABCD', () => {});
    const conns = ['A', 'B'].map((n, i) => {
      const c = mk(i);
      room.join(c, n);
      return c;
    });
    for (let i = 0; i < 3; i++) expect(room.addBot(conns[0])).toBeNull();
    expect(room.start(conns[0])).toBeNull();
    const r = room as any;

    // Insulting a named bot is answered almost surely; spread over bots and time past the 10 s per-bot throttle.
    const chatUntil = async (limit: number) => {
      const bots = room.seats.filter((s) => s.bot);
      for (let n = 0; n < limit; n++) {
        room.chat(conns[0], `${bots[n % bots.length].name} you liar`);
        await vi.advanceTimersByTimeAsync(11_000);
      }
    };

    await chatUntil(12);
    expect(f.mock.calls.length).toBeLessThanOrEqual(3);
    expect(r.writtenTotal).toBe(f.mock.calls.length);
    expect(r.writtenTotal).toBe(3);
    expect(r.canWrite()).toBe(false);

    // A new deal resets the per-game count but not the room's total.
    room.game = { ...room.game!, phase: 'gameOver', winner: 'liberal', winReason: 'liberalPolicies' };
    r.after([{ k: 'gameOver', winner: 'liberal', reason: 'liberalPolicies' }]);
    expect(room.playAgain(conns[0])).toBeNull();
    expect(room.playAgain(conns[1])).toBeNull();
    expect(room.game!.phase).not.toBe('gameOver');
    expect(r.written).toBe(0);
    expect(r.writtenTotal).toBe(3);
    expect(r.canWrite()).toBe(false);

    await chatUntil(6);
    expect(f.mock.calls.length).toBe(3);
    room.close();
  });

  it('a new deal does not reset the room total', () => {
    config.llm.key = 'test';
    const room = new Room('ABCD', () => {});
    const r = room as any;
    r.noteSent();
    r.resetTalk();
    expect(r.written).toBe(0);
    expect(r.writtenTotal).toBe(1);
    expect(room.botStats.written).toBe(1);
    room.close();
  });

  it('llmCalls survives a snapshot round trip', () => {
    const room = new Room('ABCD', () => {});
    room.join(mk(0), 'A');
    (room as any).writtenTotal = 42;
    const snap = room.snapshot();
    expect(snap.llmCalls).toBe(42);

    const back = Room.restore(JSON.parse(JSON.stringify(snap)), () => {});
    expect((back as any).writtenTotal).toBe(42);

    const { llmCalls: _drop, ...old } = snap;
    const legacy = Room.restore(old, () => {});
    expect((legacy as any).writtenTotal).toBe(0);
    for (const x of [room, back, legacy]) x.close();
  });
});
