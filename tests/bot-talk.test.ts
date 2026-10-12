import { describe, expect, it, vi } from 'vitest';
import { beliefs } from '../shared/belief';
import { newMemory } from '../shared/tracker';
import { viewFor } from '../shared/view';
import { talkReads } from '../server/botchat';
import { writeAccusation } from '../server/bottalk';
import { Room, type Conn } from '../server/room';
import { roles, setup } from './helpers';

// A bot that picks a silent option must not be throttled.
vi.mock('../server/botchat', async (orig) => ({
  ...(await orig<typeof import('../server/botchat')>()),
  planTalk: vi.fn(() => ({ kind: 'line', line: '', situation: 'nothing happened' })),
}));

vi.mock('../server/bottalk', async (orig) => ({
  ...(await orig<typeof import('../server/bottalk')>()),
  writeAccusation: vi.fn(async () => null),
}));

describe('bot chat throttle', () => {
  it('is not consumed when the bot stays quiet', async () => {
    const conn: Conn = { id: 1, room: null, seat: -1, send: () => {} };
    const room = new Room('ABCD', () => {});
    room.join(conn, 'Human');
    for (let i = 0; i < 4; i++) room.addBot(conn);
    expect(room.start(conn)).toBeNull();
    (room as any).talk.botTalk([{ type: 'x' }]);
    await new Promise((r) => setTimeout(r, 10));
    expect((room as any).talk.lastBotChat.size).toBe(0);
    room.close();
  });
});

describe('talkReads', () => {
  it('is flat for an untouched seat and high for one who turned my Liberal into a Fascist policy', () => {
    const s = setup(5, { president: 0, roles: roles(5, 4, [3]) });
    const fresh = talkReads(newMemory(2, 5), viewFor(s, 2));
    expect(Math.abs(fresh.sus[0])).toBeLessThan(0.01);
    expect(Math.abs(fresh.sus[1])).toBeLessThan(0.01);

    // I am seat 0 and passed seat 1 one Liberal and one Fascist; they enacted the Fascist.
    const m = newMemory(0, 5);
    for (let i = 1; i <= 2; i++) {
      m.governments.push({ round: i, president: 0, chancellor: 1, result: 'F' });
      m.elections.push({ round: i, president: 0, nominee: 1, votes: [true, true, true, true, true], passed: true });
      m.passed.push({ round: i, gave: ['L', 'F'] } as never);
    }
    expect(talkReads(m, viewFor(s, 0)).sus[1]).toBeGreaterThan(1.8);
  });
});

describe('who a bot accuses', () => {
  // Seat `target` runs five Fascist governments, so it is the one the belief model likes least.
  const seeded = () => {
    const conn: Conn = { id: 1, room: null, seat: -1, send: () => {} };
    const room = new Room('ABCD', () => {});
    room.join(conn, 'Human');
    for (let i = 0; i < 4; i++) room.addBot(conn);
    expect(room.start(conn)).toBeNull();
    const r = room as any;
    const roleOf = (i: number): string => r.game.players[i].role;
    const feed = (seat: number, target: number) => {
      const m = newMemory(seat, 5);
      const others = [0, 1, 2, 3, 4].filter((x) => x !== target);
      for (let i = 0; i < 5; i++) {
        const chancellor = others[i % others.length];
        m.governments.push({ round: i + 1, president: target, chancellor, result: 'F' });
        m.elections.push({ round: i + 1, president: target, nominee: chancellor, votes: [true, true, true, true, true], passed: true });
      }
      r.memories[seat] = m;
    };
    return { room, r, roleOf, feed };
  };

  const accuseFrom = async (r: any, seat: number): Promise<number | undefined> => {
    vi.mocked(writeAccusation).mockClear();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      r.talk.maybeAccuse(seat, r.talk.moodOf(seat), Date.now());
      await new Promise((res) => setTimeout(res, 10));
    } finally {
      vi.spyOn(Math, 'random').mockRestore();
    }
    return vi.mocked(writeAccusation).mock.calls[0]?.[1];
  };

  it('a Liberal bot accuses the seat its own beliefs rate most Fascist', async () => {
    const { room, r, roleOf, feed } = seeded();
    const seat = [1, 2, 3, 4].find((i) => roleOf(i) === 'liberal')!;
    const target = [0, 1, 2, 3, 4].find((i) => i !== seat)!;
    feed(seat, target);
    const pF = beliefs(r.memories[seat], viewFor(r.game, seat)).pFascist;
    const expected = [0, 1, 2, 3, 4].filter((i) => i !== seat).sort((a, b) => pF[b] - pF[a])[0];
    expect(await accuseFrom(r, seat)).toBe(expected);
    room.close();
  });

  it('a Fascist bot accuses by the table view and never a teammate', async () => {
    const { room, r, roleOf, feed } = seeded();
    const seat = [1, 2, 3, 4].find((i) => roleOf(i) !== 'liberal')!;
    // Aim the evidence at a Liberal so the table-view pick is not a teammate.
    const target = [0, 1, 2, 3, 4].find((i) => i !== seat && roleOf(i) === 'liberal')!;
    feed(seat, target);
    const view = viewFor(r.game, seat);
    const pF = beliefs(r.memories[seat], view, { observer: 'liberal' }).pFascist;
    const expected = [0, 1, 2, 3, 4]
      .filter((i) => i !== seat && roleOf(i) === 'liberal')
      .sort((a, b) => pF[b] - pF[a])[0];
    expect(await accuseFrom(r, seat)).toBe(expected);
    room.close();
  });
});
