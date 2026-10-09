import { describe, expect, it, vi } from 'vitest';
import { Room, type Conn } from '../server/room';

// A bot that picks a silent option must not be throttled.
vi.mock('../server/botchat', async (orig) => ({
  ...(await orig<typeof import('../server/botchat')>()),
  planTalk: vi.fn(() => ({ kind: 'line', line: '' })),
}));

describe('bot chat throttle', () => {
  it('is not consumed when the bot stays quiet', async () => {
    const conn: Conn = { id: 1, room: null, seat: -1, send: () => {} };
    const room = new Room('ABCD', () => {});
    room.join(conn, 'Human');
    for (let i = 0; i < 4; i++) room.addBot(conn);
    expect(room.start(conn)).toBeNull();
    (room as any).botTalk([{ type: 'x' }]);
    await new Promise((r) => setTimeout(r, 10));
    expect((room as any).lastBotChat.size).toBe(0);
    room.close();
  });
});
