import { describe, expect, it } from 'vitest';
import { hitlerKnowsFascists } from '../shared/rules';
import type { GameState, Role } from '../shared/types';
import { viewFor, type GameView } from '../shared/view';
import { playGame } from '../scripts/simcore';
import { act, elect, roles, setup } from './helpers';

const VIEW_KEYS = [
  'you', 'yourRole', 'phase', 'players', 'liberal', 'fascist', 'tracker', 'deckCount', 'discardCount',
  'president', 'nominee', 'chancellor', 'lastPresident', 'lastChancellor', 'eligible', 'pending', 'hand',
  'peek', 'vetoUnlocked', 'vetoRefused', 'lastVotes', 'investigated', 'yourInvestigations', 'powers',
  'currentPower', 'winner', 'winReason', 'round',
].sort();

function allowedRole(s: GameState, viewer: number, target: number): Role | null {
  const role = s.players[target].role;
  if (s.phase === 'gameOver' || viewer === target) return role;
  const mine = s.players[viewer].role;
  if (mine === 'fascist') return role === 'liberal' ? null : role;
  if (mine === 'hitler' && hitlerKnowsFascists(s.players.length) && role === 'fascist') return role;
  return null;
}

/** Asserts a single view exposes exactly what its viewer may know. */
function assertNoLeak(s: GameState, viewer: number, v: GameView) {
  expect(Object.keys(v).sort()).toEqual(VIEW_KEYS);
  for (const p of v.players) {
    expect(p.role).toBe(allowedRole(s, viewer, p.seat));
    expect(Object.keys(p).sort()).toEqual(['acked', 'alive', 'hasVoted', 'name', 'role', 'seat']);
  }
  const holder = s.phase === 'legPresident' ? s.president : s.phase === 'legChancellor' ? s.chancellor : -1;
  if (viewer === holder) expect(v.hand).toEqual(s.hand);
  else expect(v.hand).toBeNull();
  if (s.phase === 'peek' && viewer === s.president) expect(v.peek).toEqual(s.deck.slice(0, 3));
  else expect(v.peek).toBeNull();
  expect(v.yourInvestigations).toEqual(
    s.investigations.filter((i) => i.by === viewer).map((i) => ({ target: i.target, party: i.party })),
  );
  // Vote values are never visible before everyone has voted.
  if (s.phase === 'vote') {
    const json = JSON.stringify(v.players);
    expect(json).not.toMatch(/"ja"|"vote"/);
  }
  // String-level check: a liberal sees no role words except their own and their investigation results.
  if (s.phase !== 'gameOver' && s.players[viewer].role === 'liberal') {
    const redacted = { ...v, yourRole: null, yourInvestigations: [], players: v.players.filter((p) => p.seat !== viewer) };
    expect(JSON.stringify(redacted)).not.toMatch(/:"(hitler|fascist)"/);
  }
  // Card identities only ever appear in your own hand/peek.
  const noCards = { ...v, hand: null, peek: null, lastVotes: null };
  expect(JSON.stringify(noCards)).not.toMatch(/"[LF]"/);
}

describe('knowledge rules', () => {
  it('fascists know each other and Hitler', () => {
    const s = setup(7, { roles: roles(7, 6, [4, 5]) });
    const v = viewFor(s, 4);
    expect(v.players.map((p) => p.role)).toEqual([null, null, null, null, 'fascist', 'fascist', 'hitler']);
  });

  it('Hitler knows the fascists at 5-6 players only', () => {
    for (const n of [5, 6]) {
      const s = setup(n, { roles: roles(n, 0, [1]) });
      expect(viewFor(s, 0).players[1].role).toBe('fascist');
    }
    for (const n of [7, 8, 9, 10]) {
      const s = setup(n, { roles: roles(n, 0, [1, 2]) });
      const v = viewFor(s, 0);
      expect(v.players.filter((p) => p.role !== null).map((p) => p.seat)).toEqual([0]);
    }
  });

  it('liberals only know themselves', () => {
    const s = setup(10, { roles: roles(10, 9, [6, 7, 8]) });
    const v = viewFor(s, 0);
    expect(v.players.map((p) => p.role)).toEqual(['liberal', ...Array(9).fill(null)]);
  });

  it('everyone sees all roles after the game ends', () => {
    let s = setup(5, { president: 0, roles: roles(5, 3, [4]) });
    s.fascist = 3;
    s = elect(s, 3);
    expect(viewFor(s, 0).players.map((p) => p.role)).toEqual(roles(5, 3, [4]));
  });

  it('spectator view (null) knows no roles and no cards', () => {
    let s = setup(5, { president: 0 });
    s = elect(s, 1);
    const v = viewFor(s, null);
    expect(v.players.every((p) => p.role === null)).toBe(true);
    expect(v.hand).toBeNull();
    expect(v.yourRole).toBeNull();
  });
});

describe('hidden info', () => {
  it('only the card holder sees the legislative hand', () => {
    let s = setup(5, { president: 0, deck: ['F', 'L', 'F', 'L', 'L', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'L', 'L', 'L', 'F'] });
    s = elect(s, 2);
    for (let i = 0; i < 5; i++) expect(viewFor(s, i).hand).toEqual(i === 0 ? ['F', 'L', 'F'] : null);
    s = act(s, 0, { type: 'presDiscard', index: 1 });
    for (let i = 0; i < 5; i++) expect(viewFor(s, i).hand).toEqual(i === 2 ? ['F', 'F'] : null);
  });

  it('investigation results are visible only to the investigator', () => {
    let s = setup(7, { president: 0, roles: roles(7, 3, [4, 5]) });
    s.phase = 'investigate';
    s = act(s, 0, { type: 'investigate', target: 3 });
    expect(viewFor(s, 0).yourInvestigations).toEqual([{ target: 3, party: 'fascist' }]);
    for (let i = 1; i < 7; i++) expect(viewFor(s, i).yourInvestigations).toEqual([]);
    expect(viewFor(s, 1).investigated).toEqual([3]); // the fact of investigation is public
  });

  it.each([5, 6, 7, 8, 9, 10])('no leaks in any view across full %i-player games', (n) => {
    for (let g = 0; g < 15; g++) {
      playGame(n, 7000 + n * 31 + g, g % 2 ? 'heuristic' : 'random', (s) => {
        for (let viewer = 0; viewer < n; viewer++) assertNoLeak(s, viewer, viewFor(s, viewer));
      });
    }
  });
});
