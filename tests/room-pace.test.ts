import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type Conn } from '../server/room';
import { config } from '../server/config';
import { parseClientMsg, type Pace } from '../shared/protocol';

const original = { timerScale: config.timerScale, botDelayMs: config.botDelayMs };

type Plan = { key: string; readyAt: number; timer: unknown };
const plansOf = (room: Room) => (room as unknown as { botPlans: Map<number, Plan> }).botPlans;

function table(pace?: Pace) {
  const room = new Room('ABCD', () => {});
  const conn: Conn = { id: 1, room: null, seat: -1, send: () => {} };
  expect(room.join(conn, 'Human')).toBeNull();
  if (pace) expect(room.setOptions(conn, { pace })).toBeNull();
  return { room, conn };
}

// Quick-starts a table at the given pace; returns each bot seat's wait (ms from just before the deal) and the phase deadline.
function dealt(pace: Pace) {
  const { room, conn } = table(pace);
  const before = Date.now();
  expect(room.quickStart(conn)).toBeNull();
  const waits = new Map<number, number>();
  for (const [seat, plan] of plansOf(room)) waits.set(seat, plan.readyAt - before);
  const deadlineMs = room.viewFor(0).deadlineMs!;
  room.close();
  return { waits, deadlineMs };
}

describe('table pace', () => {
  beforeEach(() => {
    config.timerScale = 1;
    config.botDelayMs = 1_000_000;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    config.timerScale = original.timerScale;
    config.botDelayMs = original.botDelayMs;
  });

  it('scales a bot ready time: Fast about 0.5x, Relaxed about 1.5x of Normal', () => {
    // Math.random is pinned, so every table seats the same bots (same names, same tempo) at the same seats.
    // Default unit, so (settle + think) * pace stays under the deadline cap at every pace (night: <= 10.5 s * pace).
    // Plans are read right after the deal and the rooms closed, so no bot fires.
    config.botDelayMs = 1400;
    const normal = dealt('normal');
    const fast = dealt('fast');
    const relaxed = dealt('relaxed');
    expect(normal.waits.size).toBeGreaterThan(0);
    for (const [seat, wait] of normal.waits) {
      expect(fast.waits.get(seat)! / wait).toBeGreaterThan(0.45);
      expect(fast.waits.get(seat)! / wait).toBeLessThan(0.55);
      expect(relaxed.waits.get(seat)! / wait).toBeGreaterThan(1.45);
      expect(relaxed.waits.get(seat)! / wait).toBeLessThan(1.55);
    }
  });

  it('scales the phase deadline', () => {
    const normal = dealt('normal');
    const fast = dealt('fast');
    expect(fast.deadlineMs / normal.deadlineMs).toBeGreaterThan(0.45);
    expect(fast.deadlineMs / normal.deadlineMs).toBeLessThan(0.55);
  });

  it('refuses a guest and refuses once the game has started', () => {
    const { room, conn } = table();
    const guest: Conn = { id: 2, room: null, seat: -1, send: () => {} };
    expect(room.join(guest, 'Guest')).toBeNull();
    expect(room.setOptions(guest, { pace: 'fast' })).not.toBeNull();
    expect(room.options.pace).toBe('normal');
    expect(room.quickStart(conn)).toBeNull();
    expect(room.setOptions(conn, { pace: 'fast' })).not.toBeNull();
    expect(room.options.pace).toBe('normal');
    room.close();
  });

  it('rejects an unknown pace on the wire', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'setOptions', pace: 'turbo' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'setOptions' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'setOptions', pace: 'fast' }))).toEqual({ t: 'setOptions', pace: 'fast' });
  });

  it('keeps pace across a snapshot round trip and defaults old snapshots to normal', () => {
    const { room } = table('relaxed');
    const snap = JSON.parse(JSON.stringify(room.snapshot()));
    const back = Room.restore(snap, () => {});
    expect(back.options.pace).toBe('relaxed');
    back.close();
    delete snap.options;
    const old = Room.restore(snap, () => {});
    expect(old.options.pace).toBe('normal');
    old.close();
    room.close();
  });
});
