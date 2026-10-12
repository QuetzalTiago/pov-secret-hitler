import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../client/i18n';
import { actionLabel, cardConfirmCopy, edgeMarker, guideTarget, hudModel, idlePulse, nextMark, roleGoal, roleShown, screenBlood, type HudOpts } from '../client/hudmodel';
import type { RoomView } from '../shared/protocol';
import type { Role } from '../shared/types';
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

  it('hints that a cast ballot can be taken back', () => {
    const { v, room } = fixture({ phase: 'vote', nominee: 2, pending: [1, 2, 3, 4] });
    v.players[0].hasVoted = true;
    const m = hudModel(v, room, { ...opts, myVote: true });
    expect(m.action.detail).toBe('1 of 5 voted Click your ballot to take it back.');
    expect(hudModel(v, room, opts).action.detail).toBe('1 of 5 voted');
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

  it('carries private marks for other seats only', () => {
    const { v, room } = fixture();
    const m = hudModel(v, room, { ...opts, marks: { 0: 'F', 2: 'L', 3: '?' } });
    expect(m.roster.map((r) => r.mark)).toEqual([null, null, 'L', '?', null]);
    expect(hudModel(v, room, opts).roster.every((r) => r.mark === null)).toBe(true);
  });

  it('tags investigated players with the party you saw', () => {
    const { v, room } = fixture({ yourInvestigations: [{ target: 3, party: 'fascist' }] });
    const m = hudModel(v, room, opts);
    expect(m.roster.map((r) => r.intel)).toEqual([null, null, null, 'fascist', null]);
  });

  it('gives watchers a detail line in every power phase', () => {
    for (const phase of ['veto', 'peek', 'investigate', 'special', 'execute'] as const) {
      const { v, room } = fixture({ phase, president: 1, chancellor: 2, pending: [1] }, 0);
      const m = hudModel(v, room, opts);
      expect(m.action.mine).toBe(false);
      expect(m.action.detail.length).toBeGreaterThan(0);
      if (phase === 'investigate') expect(m.action.detail).toContain('investigate');
    }
  });
});

describe('hudModel shown state', () => {
  it('pips follow shown counts while a beat is pending', () => {
    const { v, room } = fixture({ fascist: 3, tracker: 0, liberal: 1 });
    const m = hudModel(v, room, { ...opts, shown: { liberal: 1, fascist: 2, tracker: 2 } });
    expect(m.status.fascist).toBe(2);
    expect(m.status.tracker).toBe(2);
    expect(m.status.liberal).toBe(1);
    const live = hudModel(v, room, opts);
    expect(live.status.fascist).toBe(3);
    expect(live.status.tracker).toBe(0);
  });

  it('gameOver with roles held does not leak roles or the winner', () => {
    const { v, room } = fixture({ phase: 'gameOver', winner: 'fascist', pending: [] });
    const roles = ['liberal', 'fascist', 'hitler', 'liberal', 'liberal'] as const;
    v.players.forEach((p, i) => (p.role = roles[i]));
    const held: (Role | null)[] = ['liberal', 'fascist', null, null, null];
    const m = hudModel(v, room, { ...opts, heldRoles: held });
    expect(m.roster.map((r) => r.knownRole)).toEqual(held);
    expect(m.action.title).toBe('');
    expect(m.action.title).not.toContain('win');
    expect(m.action.detail).toBe('');
  });

  it('gameOver without held roles shows everything', () => {
    const { v, room } = fixture({ phase: 'gameOver', winner: 'fascist', pending: [] });
    const roles = ['liberal', 'fascist', 'hitler', 'liberal', 'liberal'] as const;
    v.players.forEach((p, i) => (p.role = roles[i]));
    const m = hudModel(v, room, { ...opts, heldRoles: null });
    expect(m.roster.map((r) => r.knownRole)).toEqual([...roles]);
    expect(m.action.title).toBe('The Fascists win');
  });
});

describe('roleShown', () => {
  it('uses the live role when nothing is held', () => {
    expect(roleShown('fascist', null, 1)).toBe('fascist');
    expect(roleShown(null, null, 1)).toBeNull();
  });

  it('uses the held role when held', () => {
    expect(roleShown('fascist', ['liberal', null], 0)).toBe('liberal');
    expect(roleShown('fascist', ['liberal', null], 1)).toBeNull();
  });

  it('is null for a seat missing from the held array', () => {
    expect(roleShown('fascist', ['liberal'], 3)).toBeNull();
  });
});

describe('nextMark', () => {
  it('cycles none, ?, L, F, none', () => {
    expect(nextMark(null)).toBe('?');
    expect(nextMark('?')).toBe('L');
    expect(nextMark('L')).toBe('F');
    expect(nextMark('F')).toBeNull();
  });
});

describe('edgeMarker', () => {
  it('pushes a far-left point to the left edge', () => {
    const m = edgeMarker({ x: -3, y: 0, z: 0.5 })!;
    expect(m.x).toBeCloseTo(-0.9);
    expect(m.y).toBeCloseTo(0);
    expect(m.angle).toBeCloseTo(Math.PI);
  });

  it('returns null for an on-screen point', () => {
    expect(edgeMarker({ x: 0.2, y: 0.1, z: 0.5 })).toBeNull();
  });

  it('pushes a diagonal point to the corner', () => {
    const m = edgeMarker({ x: 2, y: 2, z: 0.5 })!;
    expect(m.x).toBeCloseTo(0.9);
    expect(m.y).toBeCloseTo(0.9);
  });

  it('flips a point behind the camera', () => {
    const m = edgeMarker({ x: 0.5, y: 0, z: 1.5 })!;
    expect(m.x).toBeLessThan(0);
  });
});

describe('guideTarget', () => {
  const on = { ndc: { x: 0, y: 0, z: 0.5 }, angle: 0.1 };
  const left = { ndc: { x: -3, y: 0, z: 0.5 }, angle: 1.2 };
  const behind = { ndc: { x: 0, y: 0, z: 1.5 }, angle: 2.5 };

  it('is null with no candidates', () => {
    expect(guideTarget([])).toBeNull();
  });

  it('is null when any candidate is on screen', () => {
    expect(guideTarget([left, on, behind])).toBeNull();
  });

  it('picks the smallest angle when all are off screen', () => {
    expect(guideTarget([behind, left])).toBe(left);
  });

  it('counts a behind-camera candidate as off screen', () => {
    expect(guideTarget([behind])).toBe(behind);
  });
});

describe('idlePulse', () => {
  it('starts at the midpoint and peaks at PI/8', () => {
    expect(idlePulse(0)).toBeCloseTo(0.5);
    expect(idlePulse(Math.PI / 8)).toBeCloseTo(1);
  });

  it('stays within 0..1', () => {
    for (let t = 0; t < 20; t += 0.05) {
      expect(idlePulse(t)).toBeGreaterThanOrEqual(0);
      expect(idlePulse(t)).toBeLessThanOrEqual(1);
    }
  });
});

describe('cardConfirmCopy', () => {
  it('names the discard verb and the policy', () => {
    const c = cardConfirmCopy('discard', 'F', 3);
    expect(c.verb).toBe('DISCARD');
    expect(c.policy).toBe('FASCIST POLICY');
    expect(c.face).toBe('F');
    expect(c.detail).toContain('2');
    expect(c.confirm).toBe('Discard it');
  });

  it('names the enact verb and the policy', () => {
    const c = cardConfirmCopy('enact', 'L', 2);
    expect(c.verb).toBe('ENACT');
    expect(c.policy).toBe('LIBERAL POLICY');
    expect(c.confirm).toBe('Enact it');
  });
});

describe('actionLabel', () => {
  it('labels each phase', () => {
    expect(actionLabel('nominate', false)).toBe('Pick a Chancellor');
    expect(actionLabel('investigate', false)).toBe('Investigate a player');
    expect(actionLabel('special', false)).toBe('Pick the next President');
    expect(actionLabel('execute', false)).toBe('Pick who to shoot');
    expect(actionLabel('vote', false)).toBe('Vote JA or NEIN');
    expect(actionLabel('veto', false)).toBe('JA or NEIN on the veto');
    expect(actionLabel('night', false)).toBe('Your envelope');
  });

  it('legChancellor shows the veto token only when it is there', () => {
    expect(actionLabel('legChancellor', true)).toBe('Veto token');
    expect(actionLabel('legChancellor', false)).toBe('Your move');
  });

  it('falls back to Your move', () => {
    expect(actionLabel(undefined, false)).toBe('Your move');
    expect(actionLabel('legPresident', true)).toBe('Your move');
  });
});

describe('screenBlood', () => {
  it('is a full hit when you are the victim', () => {
    expect(screenBlood(2, 2, 5)).toBe('victim');
  });

  it('spatters both neighbours', () => {
    expect(screenBlood(2, 3, 5)).toBe('spatter');
    expect(screenBlood(2, 1, 5)).toBe('spatter');
  });

  it('wraps round the table both ways', () => {
    for (const n of [5, 10]) {
      expect(screenBlood(0, n - 1, n)).toBe('spatter');
      expect(screenBlood(n - 1, 0, n)).toBe('spatter');
    }
  });

  it('ignores a non-neighbour', () => {
    expect(screenBlood(0, 2, 5)).toBe('none');
    expect(screenBlood(0, 5, 10)).toBe('none');
  });

  it('shows nothing to a spectator', () => {
    expect(screenBlood(null, 1, 5)).toBe('none');
  });

  it('rejects out-of-range and non-integer seats', () => {
    expect(screenBlood(5, 1, 5)).toBe('none');
    expect(screenBlood(1, 5, 5)).toBe('none');
    expect(screenBlood(-1, 0, 5)).toBe('none');
    expect(screenBlood(0.5, 1, 5)).toBe('none');
    expect(screenBlood(0, 1, 1)).toBe('none');
  });

  it('treats the only other seat as a neighbour at 2 seats', () => {
    expect(screenBlood(0, 1, 2)).toBe('spatter');
    expect(screenBlood(1, 0, 2)).toBe('spatter');
  });
});

describe('roleGoal', () => {
  afterEach(() => setLang('en'));

  it('liberal text does not depend on the player count', () => {
    expect(roleGoal('liberal', 5)).toBe('Enact 5 Liberal policies or shoot Hitler.');
    expect(roleGoal('liberal', 9)).toBe(roleGoal('liberal', 5));
  });

  it('fascist knows the team', () => {
    expect(roleGoal('fascist', 7)).toBe(
      'Enact 6 Fascist policies, or get Hitler elected Chancellor after 3. You know your team.',
    );
  });

  it('Hitler knows the Fascist only at 5-6 players', () => {
    const goal = 'Stay hidden. Get elected Chancellor after 3 Fascist policies.';
    for (const n of [5, 6]) expect(roleGoal('hitler', n)).toBe(`${goal} You know your Fascist.`);
    for (const n of [7, 10]) expect(roleGoal('hitler', n)).toBe(`${goal} You don't know your Fascists.`);
  });

  it('is translated to Spanish', () => {
    setLang('es');
    expect(roleGoal('liberal', 5)).toBe('Promulga 5 leyes Liberales o dispara a Hitler.');
    expect(roleGoal('fascist', 5)).toContain('Conoces a tu equipo.');
    expect(roleGoal('hitler', 5)).toBe(
      'Pasa desapercibido. Haz que te elijan Canciller después de 3 leyes Fascistas. Conoces a tu Fascista.',
    );
    expect(roleGoal('hitler', 8)).toContain('No conoces a tus Fascistas.');
  });

  it('shows in the night prompt once the card is face up, and on the status chip', () => {
    const { v, room } = fixture({ phase: 'night', yourRole: 'hitler', pending: [0] });
    const open = hudModel(v, room, { ...opts, envelopeOpen: true });
    expect(open.action.title).toBe('Memorise your role');
    expect(open.action.detail.startsWith(roleGoal('hitler', 5))).toBe(true);
    expect(open.action.detail.endsWith('Click the card to close your eyes.')).toBe(true);
    const closed = hudModel(v, room, opts);
    expect(closed.action.detail).toBe('Click your envelope to see it.');
    expect(closed.status.roleGoal).toBe(roleGoal('hitler', 5));
  });
});

describe('hudmodel in Spanish', () => {
  beforeEach(() => setLang('es'));
  afterEach(() => setLang('en'));

  it('cardConfirmCopy keeps the codes and translates the text', () => {
    const d = cardConfirmCopy('discard', 'F', 3);
    expect(d.verb).toBe('DISCARD');
    expect(d.verbLabel).toBe('DESCARTAR');
    expect(d.policy).toBe('LEY FASCISTA');
    expect(d.detail).toBe('Las otras 2 van al Canciller.');
    expect(d.confirm).toBe('Descartarla');
    const e = cardConfirmCopy('enact', 'L', 2);
    expect(e.verbLabel).toBe('PROMULGAR');
    expect(e.policy).toBe('LEY LIBERAL');
    expect(e.confirm).toBe('Promulgarla');
  });

  it('step labels, role label and action titles', () => {
    const { v, room } = fixture({ phase: 'legPresident', chancellor: 2, pending: [0] });
    const m = hudModel(v, room, opts);
    expect(m.step?.labels).toEqual(['Nominar', 'Votar', 'Legislar', 'Poder']);
    expect(m.status.roleLabel).toBe('Liberal');
    expect(m.action.title).toBe('Descarta una ley');
    expect(m.action.detail).toBe('Haz clic en la carta para tirarla. Las otras dos van al Canciller Cy.');
    expect(m.action.verb).toBe('discard');
    const w = fixture({ phase: 'nominate', president: 1, pending: [1] });
    expect(hudModel(w.v, w.room, opts).action.title).toBe('El Presidente Bob está eligiendo');
    expect(actionLabel('nominate', false)).toBe('Elige un Canciller');
  });

  it('switching back to English returns English', () => {
    setLang('en');
    const { v, room } = fixture({ phase: 'legPresident', chancellor: 2, pending: [0] });
    expect(hudModel(v, room, opts).action.title).toBe('Discard one policy');
    expect(cardConfirmCopy('enact', 'L', 2).policy).toBe('LIBERAL POLICY');
  });
});
