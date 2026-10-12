import { describe, expect, it } from 'vitest';
import { shouldFlushAct, type PendingAct } from '../client/netqueue';
import type { RoomView } from '../shared/protocol';

const p: PendingAct = { msg: '{}', phase: 'vote', seat: 2 };
const room = (o: { stage?: string; game?: object | null; you?: number } = {}) =>
  ({
    stage: o.stage ?? 'game',
    you: o.you ?? 2,
    game: o.game === undefined ? { phase: 'vote', pending: [1, 2] } : o.game,
  }) as unknown as RoomView;

describe('shouldFlushAct', () => {
  it('flushes when phase and seat match and the seat is pending', () => {
    expect(shouldFlushAct(p, room())).toBe(true);
  });
  it('drops when the phase changed', () => {
    expect(shouldFlushAct(p, room({ game: { phase: 'legislate', pending: [2] } }))).toBe(false);
  });
  it('drops when the seat is no longer pending', () => {
    expect(shouldFlushAct(p, room({ game: { phase: 'vote', pending: [1] } }))).toBe(false);
  });
  it('drops when we are a different seat', () => {
    expect(shouldFlushAct(p, room({ you: 3 }))).toBe(false);
  });
  it('drops in the lobby, with no room or no game', () => {
    expect(shouldFlushAct(p, room({ stage: 'lobby' }))).toBe(false);
    expect(shouldFlushAct(p, null)).toBe(false);
    expect(shouldFlushAct(p, room({ game: null }))).toBe(false);
  });
});
