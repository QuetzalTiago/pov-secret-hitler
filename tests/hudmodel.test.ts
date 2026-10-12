import { describe, expect, it } from 'vitest';
import { hudModel, type HudOpts } from '../client/hudmodel';
import type { RoomView } from '../shared/protocol';
import type { GameView } from '../shared/view';

const NAMES = ['Ann', 'Bob', 'Cy', 'Di', 'Ed'];

/** A full 5-player view seen by `you` (default seat 0), with any field overridable. */
function fixture(over: Partial<GameView> = {}, you = 0): { v: GameView; room: RoomView } {
  const v = {
    you,
    yourRole: 'liberal',
    phase: 'nominate',
    players: NAMES.map((name, seat) => ({ seat, name, alive: true, role: null, hasVoted: false, acked: false })),
    liberal: 0,
    fascist: 0,
    tracker: 0,
    deckCount: 17,
    discardCount: 0,
    president: 0,
    nominee: null,
    chancellor: null,
    lastPresident: null,
    lastChancellor: null,
    eligible: [],
    pending: [0],
    hand: null,
    peek: null,
    vetoUnlocked: false,
    vetoRefused: false,
    lastVotes: null,
    investigated: [],
    yourInvestigations: [],
    powers: [null, null, null, null, null, null],
    currentPower: null,
    winner: null,
    winReason: null,
    round: 1,
    ...over,
  } as GameView;
  const room = {
    you,
    seats: NAMES.map((name, seat) => ({ seat, name, bot: seat === 4, botControlled: false, connected: seat !== 3 })),
  } as unknown as RoomView;
  return { v, room };
}

const opts: HudOpts = { envelopeOpen: false, myVote: null, termLimited: [] };

describe('hudModel', () => {
  it('lets the President discard in legPresident', () => {
    const { v, room } = fixture({ phase: 'legPresident', chancellor: 2, pending: [0] });
    const m = hudModel(v, room, opts);
    expect(m.action.verb).toBe('discard');
    expect(m.action.mine).toBe(true);
    expect(m.action.title).toBe('Discard one policy');
  });

  it('lets the Chancellor enact, with a veto hint when unlocked', () => {
    const { v, room } = fixture({ phase: 'legChancellor', president: 1, chancellor: 0, pending: [0] });
    expect(hudModel(v, room, opts).action.verb).toBe('enact');
    expect(hudModel(v, room, opts).action.detail).not.toContain('VETO');
    const unlocked = fixture({ phase: 'legChancellor', president: 1, chancellor: 0, pending: [0], vetoUnlocked: true });
    expect(hudModel(unlocked.v, unlocked.room, opts).action.detail).toContain('Or stamp VETO.');
  });

  it('maps phases to step indices', () => {
    const idx = (phase: GameView['phase']) => {
      const { v, room } = fixture({ phase });
      return hudModel(v, room, opts).step?.index ?? null;
    };
    expect(idx('nominate')).toBe(0);
    expect(idx('vote')).toBe(1);
    expect(idx('legPresident')).toBe(2);
    expect(idx('legChancellor')).toBe(2);
    expect(idx('execute')).toBe(3);
    expect(idx('night')).toBeNull();
    expect(idx('gameOver')).toBeNull();
  });

  it('badges the nominee, voters and President during a vote', () => {
    const { v, room } = fixture({ phase: 'vote', nominee: 2, pending: [0, 1, 2, 3, 4] });
    v.players[1].hasVoted = true;
    const m = hudModel(v, room, opts);
    expect(m.roster[0].badges).toContain('president');
    expect(m.roster[2].badges).toContain('nominee');
    expect(m.roster[1].badges).toContain('voted');
    expect(m.roster[1].badges).toContain('acting');
    expect(m.action.detail).toBe('President Ann · Chancellor Cy');
  });

  it('tells a waiting player who is choosing', () => {
    const { v, room } = fixture({ phase: 'nominate', president: 1, pending: [1] }, 0);
    const m = hudModel(v, room, opts);
    expect(m.action.mine).toBe(false);
    expect(m.action.waitingOn).toContain('Bob');
    expect(m.action.title).toContain('Bob');
  });

  it('prefixes the detail for a dead player', () => {
    const { v, room } = fixture({ phase: 'nominate', president: 1, pending: [1] }, 0);
    v.players[0].alive = false;
    expect(hudModel(v, room, opts).action.detail.startsWith('You are dead')).toBe(true);
  });

  it('marks term-limited seats and names them in the nominate detail', () => {
    const { v, room } = fixture({ phase: 'nominate', pending: [0] });
    const m = hudModel(v, room, { ...opts, termLimited: [2, 3] });
    expect(m.roster[2].badges).toContain('termLimited');
    expect(m.roster[3].badges).toContain('termLimited');
    expect(m.action.detail).toContain('Term-limited: Cy, Di.');
  });

  it('reports bots and away seats, and the winner', () => {
    const { v, room } = fixture({ phase: 'gameOver', winner: 'fascist', pending: [] });
    const m = hudModel(v, room, opts);
    expect(m.roster[4].bot).toBe(true);
    expect(m.roster[3].away).toBe(true);
    expect(m.action.title).toBe('The Fascists win');
    expect(m.action.mine).toBe(false);
  });
});
