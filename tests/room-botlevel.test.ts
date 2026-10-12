import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Conn, type RoomSnapshot } from '../server/room';
import { RoomStore } from '../server/store';
import { config } from '../server/config';
import { legalActions } from '../shared/engine';
import { BOT_LEVELS, parseClientMsg, type ServerMsg } from '../shared/protocol';
import * as brain from '../server/brain';

vi.mock('../server/brain', async (orig) => {
  const real = await orig<typeof import('../server/brain')>();
  return { ...real, decide: vi.fn(real.decide), decideNow: vi.fn(real.decideNow) };
});

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs };

function lobby() {
  const msgs: ServerMsg[] = [];
  const host: Conn = { id: 1, room: null, seat: -1, send: (m) => msgs.push(m) };
  const guest: Conn = { id: 2, room: null, seat: -1, send: () => {} };
  const room = new Room('ABCD', () => {});
  expect(room.join(host, 'Host')).toBeNull();
  expect(room.join(guest, 'Guest')).toBeNull();
  return { room, host, guest, msgs };
}

beforeEach(() => {
  config.timerScale = 1;
  config.botDelayMs = 1_000_000;
});

afterEach(() => {
  config.timerScale = original.timerScale;
  config.botDelayMs = original.botDelayMs;
  vi.clearAllMocks();
});

describe('room bot level', () => {
  it('a non-host cannot change the bot level', () => {
    const { room, host, guest, msgs } = lobby();
    expect(room.options.botLevel).toBe('normal');
    expect(room.setOptions(guest, { botLevel: 'sharp' })).toBe('Only the host can change table options.');
    expect(room.options.botLevel).toBe('normal');
    expect(room.setOptions(host, { botLevel: 'sharp' })).toBeNull();
    expect(room.options.botLevel).toBe('sharp');
    expect(room.options.pace).toBe('normal');
    const last = [...msgs].reverse().find((m) => m.t === 'room') as Extract<ServerMsg, { t: 'room' }>;
    expect(last.room.options.botLevel).toBe('sharp');
    room.close();
  });

  it('the level persists', () => {
    const { room, host } = lobby();
    room.setOptions(host, { botLevel: 'sharp' });
    const snap = room.snapshot();
    const back = Room.restore(snap, () => {});
    expect(back.options.botLevel).toBe('sharp');
    back.close();

    const store = new RoomStore(':memory:');
    store.save('ABCD', snap);
    store.flush();
    const [row] = store.load(60_000);
    store.close();
    const viaStore = Room.restore(row.data as RoomSnapshot, () => {});
    expect(viaStore.options.botLevel).toBe('sharp');
    viaStore.close();

    const old = Room.restore({ ...snap, options: { pace: 'fast' } as never }, () => {});
    expect(old.options).toEqual({ pace: 'fast', botLevel: 'normal' });
    old.close();
    const bogus = Room.restore({ ...snap, options: { pace: 'fast', botLevel: 'insane' } as never }, () => {});
    expect(bogus.options).toEqual({ pace: 'fast', botLevel: 'normal' });
    bogus.close();
    room.close();
  });

  it.each(BOT_LEVELS)('level %s reaches decide and decideNow', async (level) => {
    const { room, host } = lobby();
    room.setOptions(host, { botLevel: level });
    for (let i = 0; i < 3; i++) expect(room.addBot(host)).toBeNull();
    expect(room.start(host)).toBeNull();
    const bot = room.seats.findIndex((s) => s.bot);
    await vi.waitFor(() => expect(vi.mocked(brain.decide).mock.calls.length).toBeGreaterThan(0));
    for (const c of vi.mocked(brain.decide).mock.calls) expect(c[6]).toBe(level);
    expect(legalActions(room.game!, bot).length).toBeGreaterThan(0);
    (room as unknown as { botMove(seat: number): void }).botMove(bot);
    expect(vi.mocked(brain.decideNow).mock.calls.at(-1)![5]).toBe(level);
    room.close();
  });
});

describe('setOptions botLevel message', () => {
  it('accepts known levels only', () => {
    expect(parseClientMsg('{"t":"setOptions","botLevel":"sharp"}')).toEqual({ t: 'setOptions', botLevel: 'sharp' });
    expect(parseClientMsg('{"t":"setOptions","pace":"fast","botLevel":"casual"}')).toEqual({ t: 'setOptions', pace: 'fast', botLevel: 'casual' });
    expect(parseClientMsg('{"t":"setOptions","botLevel":"insane"}')).toBeNull();
    expect(parseClientMsg('{"t":"setOptions","pace":"fast","botLevel":"insane"}')).toBeNull();
    expect(parseClientMsg('{"t":"setOptions"}')).toBeNull();
  });
});
