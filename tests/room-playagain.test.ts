import { describe, expect, it } from 'vitest';
import { seriesLine } from '../client/ui';
import { Room, type Conn } from '../server/room';

const mk = (id: number): Conn => ({ id, room: null, seat: -1, send: () => {} });

/** Two humans (A host, B) plus bots, started and forced to a Liberal win. */
function finished(bots = 3) {
  const room = new Room('ABCD', () => {});
  const conns = ['A', 'B'].map((n, i) => {
    const c = mk(i);
    room.join(c, n);
    return c;
  });
  for (let i = 0; i < bots; i++) expect(room.addBot(conns[0])).toBeNull();
  expect(room.start(conns[0])).toBeNull();
  room.game = { ...room.game!, phase: 'gameOver', winner: 'liberal', winReason: 'liberalPolicies' };
  (room as any).after([{ k: 'gameOver', winner: 'liberal', reason: 'liberalPolicies' }]);
  return { room, conns };
}

const ready = (room: Room, name: string) => room.seatInfo().find((s) => s.name === name)!.ready;

describe('series and play again', () => {
  it('records the result once, for the winning side by name', () => {
    const { room } = finished();
    const libs = room.game!.players.filter((p) => p.role === 'liberal').map((p) => p.name);
    const others = room.game!.players.filter((p) => p.role !== 'liberal').map((p) => p.name);
    expect(room.series.liberal).toBe(1);
    expect(room.series.fascist).toBe(0);
    for (const n of libs) expect(room.series.wins[n]).toBe(1);
    for (const n of others) expect(room.series.wins[n]).toBeUndefined();
    room.close();
  });

  it('re-deals only once every connected human is ready', () => {
    const { room, conns } = finished();
    expect(room.playAgain(conns[0])).toBeNull();
    expect(room.game!.phase).toBe('gameOver');
    expect(ready(room, 'A')).toBe(true);
    expect(room.playAgain(conns[1])).toBeNull();
    expect(room.stage).toBe('game');
    expect(room.game!.phase).not.toBe('gameOver');
    expect(room.seats).toHaveLength(5);
    expect(room.seatInfo().some((s) => s.ready)).toBe(false);
    expect(room.series.liberal).toBe(1);
    room.close();
  });

  it('un-readies when pressed twice', () => {
    const { room, conns } = finished();
    room.playAgain(conns[0]);
    room.playAgain(conns[0]);
    expect(ready(room, 'A')).toBe(false);
    room.close();
  });

  it('re-deals when the only un-ready human disconnects, dropping that seat', () => {
    const { room, conns } = finished(4);
    room.playAgain(conns[0]);
    expect(room.game!.phase).toBe('gameOver');
    room.disconnected(conns[1]);
    expect(room.game!.phase).not.toBe('gameOver');
    expect(room.seats).toHaveLength(5);
    expect(room.seats.some((s) => s.name === 'B')).toBe(false);
    room.close();
  });

  it('forceRedeal is host only and needs no ready votes', () => {
    const { room, conns } = finished();
    expect(room.forceRedeal(conns[1])).toBe('Only the host can deal.');
    expect(room.game!.phase).toBe('gameOver');
    expect(room.forceRedeal(conns[0])).toBeNull();
    expect(room.game!.phase).not.toBe('gameOver');
    room.close();
  });

  it('refuses before the game is over', () => {
    const room = new Room('ABCD', () => {});
    const c = mk(0);
    room.join(c, 'A');
    expect(room.playAgain(c)).toBe('The game is not over.');
    expect(room.forceRedeal(c)).toBe('The game is not over.');
    room.close();
  });

  it('survives a snapshot round trip and defaults old snapshots', () => {
    const { room } = finished();
    const snap = room.snapshot();
    const back = Room.restore(JSON.parse(JSON.stringify(snap)), () => {});
    expect(back.series).toEqual(room.series);
    back.close();
    const old = JSON.parse(JSON.stringify(snap));
    delete old.series;
    const zero = Room.restore(old, () => {});
    expect(zero.series).toEqual({ liberal: 0, fascist: 0, wins: {} });
    zero.close();
    room.close();
  });
});

describe('seriesLine', () => {
  it('is empty before any game', () => {
    expect(seriesLine({ liberal: 0, fascist: 0, wins: {} }, ['Ana'])).toBe('');
  });
  it('lists the score and seated winners, most wins first', () => {
    expect(seriesLine({ liberal: 2, fascist: 1, wins: { Bo: 1, Ana: 2, Gone: 3, Cy: 0 } }, ['Bo', 'Ana', 'Cy'])).toBe(
      'Series · Liberals 2 – Fascists 1 · Ana 2, Bo 1',
    );
  });
});
