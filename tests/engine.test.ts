import { describe, expect, it } from 'vitest';
import {
  RuleError, cardCounts, createGame, eligibleChancellors, legalActions, pendingActors, reduce,
} from '../shared/engine';
import { ROLE_COUNTS, rolesFor, trackFor } from '../shared/rules';
import type { GameState, Policy } from '../shared/types';
import { act, elect, failVote, legislate, names, roles, setup, someChancellor, voteAll } from './helpers';

const FILL: Policy[] = Array(14).fill('L');

describe('setup', () => {
  it.each([
    [5, 3, 1], [6, 4, 1], [7, 4, 2], [8, 5, 2], [9, 5, 3], [10, 6, 3],
  ])('%i players -> %i liberals, %i fascists + Hitler', (n, l, f) => {
    expect(ROLE_COUNTS[n]).toEqual([l, f]);
    for (let seed = 1; seed < 20; seed++) {
      const s = createGame(names(n), seed);
      const rs = s.players.map((p) => p.role);
      expect(rs.filter((r) => r === 'liberal').length).toBe(l);
      expect(rs.filter((r) => r === 'fascist').length).toBe(f);
      expect(rs.filter((r) => r === 'hitler').length).toBe(1);
    }
    expect(rolesFor(n).length).toBe(n);
  });

  it('rejects unsupported player counts', () => {
    expect(() => createGame(names(4), 1)).toThrow();
    expect(() => createGame(names(11), 1)).toThrow();
  });

  it('deck has 6 liberal and 11 fascist policies', () => {
    const s = createGame(names(5), 7);
    expect(s.deck.length).toBe(17);
    expect(s.deck.filter((c) => c === 'L').length).toBe(6);
    expect(s.deck.filter((c) => c === 'F').length).toBe(11);
  });

  it('is deterministic for a seed', () => {
    expect(createGame(names(7), 99)).toEqual(createGame(names(7), 99));
    expect(createGame(names(7), 99)).not.toEqual(createGame(names(7), 100));
  });

  it('night phase waits for every player, then the president nominates', () => {
    let s = createGame(names(5), 3);
    expect(s.phase).toBe('night');
    for (let i = 0; i < 4; i++) s = act(s, i, { type: 'ack' });
    expect(s.phase).toBe('night');
    expect(pendingActors(s)).toEqual([4]);
    s = act(s, 4, { type: 'ack' });
    expect(s.phase).toBe('nominate');
    expect(pendingActors(s)).toEqual([s.president]);
  });
});

describe('legality', () => {
  it('rejects illegal actions without mutating state', () => {
    const s = setup(5, { president: 0 });
    const before = JSON.stringify(s);
    expect(() => reduce(s, { seat: 1, type: 'nominate', target: 2 })).toThrow(RuleError);
    expect(() => reduce(s, { seat: 0, type: 'nominate', target: 0 })).toThrow(RuleError);
    expect(() => reduce(s, { seat: 0, type: 'vote', ja: true })).toThrow(RuleError);
    expect(() => reduce(s, { seat: 0, type: 'nominate', target: 99 })).toThrow(RuleError);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('does not mutate the input state on legal actions', () => {
    const s = setup(5, { president: 0 });
    const before = JSON.stringify(s);
    reduce(s, { seat: 0, type: 'nominate', target: 1 });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('presidency and nomination', () => {
  it('rotates clockwise after each government', () => {
    let s = setup(7, { president: 5, deck: FILL });
    s = elect(s, 0);
    s = legislate(s);
    expect(s.president).toBe(6);
    s = failVote(s, 1);
    expect(s.president).toBe(0);
  });

  it('skips dead players in rotation', () => {
    let s = setup(7, { president: 0, deck: FILL });
    s.players[1].alive = false;
    s.votes[1] = null;
    s = failVote(s, 2);
    expect(s.president).toBe(2);
  });

  it('bars the last elected president and chancellor from chancellorship (>5 alive)', () => {
    let s = setup(7, { president: 0, deck: FILL });
    s = elect(s, 3);
    s = legislate(s);
    expect(s.president).toBe(1);
    const elig = eligibleChancellors(s);
    expect(elig).not.toContain(0); // last president
    expect(elig).not.toContain(3); // last chancellor
    expect(elig).not.toContain(1); // self
    expect(elig).toEqual([2, 4, 5, 6]);
  });

  it('only bars the last chancellor when 5 or fewer players are alive', () => {
    let s = setup(5, { president: 0, deck: FILL });
    s = elect(s, 3);
    s = legislate(s);
    expect(eligibleChancellors(s)).toEqual([0, 2, 4]);

    let t = setup(7, { president: 0, deck: FILL });
    t.players[5].alive = false;
    t.players[6].alive = false;
    t = elect(t, 3);
    t = legislate(t);
    expect(eligibleChancellors(t)).toEqual([0, 2, 4]);
  });

  it('a failed election does not change term limits', () => {
    let s = setup(7, { president: 0, deck: FILL });
    s = elect(s, 3);
    s = legislate(s);
    s = failVote(s, 2);
    expect(s.lastPresident).toBe(0);
    expect(s.lastChancellor).toBe(3);
  });

  it('cannot nominate dead players', () => {
    const s = setup(7, { president: 0 });
    s.players[4].alive = false;
    expect(eligibleChancellors(s)).not.toContain(4);
  });
});

describe('voting', () => {
  it('requires a strict majority; a tie fails', () => {
    let s = setup(6, { president: 0, deck: FILL });
    s = act(s, 0, { type: 'nominate', target: 1 });
    s = voteAll(s, (seat) => seat < 3); // 3 ja, 3 nein
    expect(s.phase).toBe('nominate');
    expect(s.tracker).toBe(1);

    let t = setup(6, { president: 0, deck: FILL });
    t = act(t, 0, { type: 'nominate', target: 1 });
    t = voteAll(t, (seat) => seat < 4); // 4 ja
    expect(t.phase).toBe('legPresident');
    expect(t.chancellor).toBe(1);
  });

  it('votes are simultaneous: nothing resolves until all living players vote', () => {
    let s = setup(5, { president: 0 });
    s = act(s, 0, { type: 'nominate', target: 1 });
    for (let i = 0; i < 4; i++) s = act(s, i, { type: 'vote', ja: true });
    expect(s.phase).toBe('vote');
    expect(s.lastVotes).toBeNull();
    expect(() => act(s, 0, { type: 'vote', ja: false })).toThrow(); // no double voting
    s = act(s, 4, { type: 'vote', ja: false });
    expect(s.lastVotes).toEqual([true, true, true, true, false]);
  });

  it('dead players do not vote and are not counted', () => {
    let s = setup(7, { president: 0, deck: FILL });
    s.players[6].alive = false;
    s.players[5].alive = false;
    s = act(s, 0, { type: 'nominate', target: 1 });
    expect(pendingActors(s)).toEqual([0, 1, 2, 3, 4]);
    expect(legalActions(s, 6)).toEqual([]);
    s = voteAll(s, (seat) => seat < 3); // 3 of 5
    expect(s.phase).toBe('legPresident');
  });
});

describe('election tracker', () => {
  it('three failed governments enact the top policy with no power and reset tracker and term limits', () => {
    let s = setup(7, { president: 0, deck: ['F', 'F', 'L', ...FILL] });
    s.fascist = 1; // next fascist would be the 2nd -> investigate in 7p
    s.lastPresident = 6;
    s.lastChancellor = 5;
    s = failVote(s, 1);
    s = failVote(s, 2);
    expect(s.tracker).toBe(2);
    s = failVote(s, 3);
    expect(s.fascist).toBe(2);
    expect(s.tracker).toBe(0);
    expect(s.lastPresident).toBeNull();
    expect(s.lastChancellor).toBeNull();
    expect(s.phase).toBe('nominate'); // no investigate power
    expect(s.president).toBe(3);
  });

  it('a successful election resets the tracker', () => {
    let s = setup(7, { president: 0, deck: FILL });
    s = failVote(s, 2);
    expect(s.tracker).toBe(1);
    s = elect(s, 3);
    expect(s.tracker).toBe(0);
  });
});

describe('legislative session', () => {
  it('president draws 3, discards 1, chancellor enacts 1 of 2', () => {
    let s = setup(5, { president: 0, deck: ['F', 'L', 'F', ...FILL] });
    s = elect(s, 2);
    expect(s.hand).toEqual(['F', 'L', 'F']);
    expect(s.deck.length).toBe(14);
    s = act(s, 0, { type: 'presDiscard', index: 0 });
    expect(s.hand).toEqual(['L', 'F']);
    expect(s.discard).toEqual(['F']);
    expect(s.phase).toBe('legChancellor');
    expect(() => act(s, 0, { type: 'chancEnact', index: 0 })).toThrow();
    s = act(s, 2, { type: 'chancEnact', index: 0 });
    expect(s.liberal).toBe(1);
    expect(s.discard).toEqual(['F', 'F']);
    expect(s.hand).toEqual([]);
  });

  it('reshuffles the discard into the draw pile when fewer than 3 cards remain', () => {
    let s = setup(5, { president: 0, deck: ['L', 'F', 'F', 'F', 'L'] });
    s.discard = ['F', 'F', 'F', 'F', 'F', 'F', 'L', 'L', 'L', 'F', 'L', 'F'];
    s = elect(s, 1);
    s = legislate(s, 1, 0); // deck now has 2 -> reshuffle
    expect(s.deck.length).toBe(16);
    expect(s.discard.length).toBe(0);
    expect(cardCounts(s)).toEqual({ L: 6, F: 11 });
  });

  it('keeps card counts conserved', () => {
    let s = setup(5, { president: 0 });
    s = elect(s, 1);
    s = legislate(s);
    expect(cardCounts(s)).toEqual({ L: 6, F: 11 });
  });
});

describe('presidential powers', () => {
  it('track tables match the official boards', () => {
    expect(trackFor(5)).toEqual([null, null, 'peek', 'execute', 'execute', null]);
    expect(trackFor(6)).toEqual(trackFor(5));
    expect(trackFor(7)).toEqual([null, 'investigate', 'special', 'execute', 'execute', null]);
    expect(trackFor(8)).toEqual(trackFor(7));
    expect(trackFor(9)).toEqual(['investigate', 'investigate', 'special', 'execute', 'execute', null]);
    expect(trackFor(10)).toEqual(trackFor(9));
  });

  function enactFascist(s: GameState, chancellor: number): GameState {
    s.deck = ['F', 'F', 'F', ...FILL];
    s = elect(s, chancellor);
    return legislate(s);
  }

  it('5-6p: 3rd fascist policy = policy peek of top 3 (no change to deck)', () => {
    for (const n of [5, 6]) {
      let s = setup(n, { president: 0 });
      s.fascist = 2;
      s = enactFascist(s, 1);
      expect(s.fascist).toBe(3);
      expect(s.phase).toBe('peek');
      const deck = s.deck.slice();
      s = act(s, 0, { type: 'peekDone' });
      expect(s.deck).toEqual(deck);
      expect(s.phase).toBe('nominate');
      expect(s.president).toBe(1);
    }
  });

  it('first fascist policy grants nothing below 9 players', () => {
    let s = setup(8, { president: 0 });
    s = enactFascist(s, 1);
    expect(s.phase).toBe('nominate');
  });

  it.each([
    [5, [null, null, 'peek', 'execute', 'execute']],
    [7, [null, 'investigate', 'special', 'execute', 'execute']],
    [9, ['investigate', 'investigate', 'special', 'execute', 'execute']],
  ])('%i players grant powers in order', (n, expected) => {
    for (let k = 0; k < 5; k++) {
      let s = setup(n as number, { president: 0, roles: roles(n as number, n as number - 1, [n as number - 2]) });
      s.fascist = k;
      s = enactFascist(s, 1);
      const e = (expected as (string | null)[])[k];
      expect(s.phase).toBe(e ?? 'nominate');
    }
  });

  it('investigation reveals party, not role, and nobody is investigated twice', () => {
    let s = setup(7, { president: 0, roles: roles(7, 3, [4, 5]) });
    s.fascist = 1;
    s = enactFascist(s, 1);
    expect(s.phase).toBe('investigate');
    expect(legalActions(s, 0).map((a) => (a as { target: number }).target)).toEqual([1, 2, 3, 4, 5, 6]);
    s = act(s, 0, { type: 'investigate', target: 3 });
    expect(s.investigations).toEqual([{ by: 0, target: 3, party: 'fascist' }]);
    // Next investigation (9p-style second slot) cannot target 3 again.
    s.phase = 'investigate';
    s.president = 1;
    const targets = legalActions(s, 1).map((a) => (a as { target: number }).target);
    expect(targets).not.toContain(3);
    expect(targets).not.toContain(1);
  });

  it('special election: chosen player presides, then rotation resumes left of the original president', () => {
    let s = setup(7, { president: 2 });
    s.fascist = 2;
    s = enactFascist(s, 3);
    expect(s.phase).toBe('special');
    expect(() => act(s, 2, { type: 'specialElect', target: 2 })).toThrow();
    s = act(s, 2, { type: 'specialElect', target: 5 });
    expect(s.president).toBe(5);
    expect(s.phase).toBe('nominate');
    s.deck = FILL.slice();
    s = elect(s, 0);
    s = legislate(s);
    expect(s.president).toBe(3); // left of original president 2
    s = failVote(s, 4);
    expect(s.president).toBe(4);
  });

  it('special election may pick the next player in order, who then serves twice', () => {
    let s = setup(7, { president: 2 });
    s.fascist = 2;
    s = enactFascist(s, 4);
    s = act(s, 2, { type: 'specialElect', target: 3 });
    expect(s.president).toBe(3);
    s = failVote(s, 0);
    expect(s.president).toBe(3);
  });

  it('execution kills the target; they cannot vote or be nominated', () => {
    let s = setup(7, { president: 0, roles: roles(7, 6, [5, 4]) });
    s.fascist = 3;
    s = enactFascist(s, 1);
    expect(s.phase).toBe('execute');
    s = act(s, 0, { type: 'execute', target: 2 });
    expect(s.players[2].alive).toBe(false);
    expect(s.phase).toBe('nominate');
    expect(eligibleChancellors(s)).not.toContain(2);
    s = act(s, s.president, { type: 'nominate', target: 3 });
    expect(pendingActors(s)).not.toContain(2);
  });

  it('executing Hitler wins for the liberals', () => {
    let s = setup(7, { president: 0, roles: roles(7, 6, [5, 4]) });
    s.fascist = 3;
    s = enactFascist(s, 1);
    const r = reduce(s, { seat: 0, type: 'execute', target: 6 });
    expect(r.state.phase).toBe('gameOver');
    expect(r.state.winner).toBe('liberal');
    expect(r.state.winReason).toBe('hitlerExecuted');
    expect(r.events.at(-1)).toEqual({ k: 'gameOver', winner: 'liberal', reason: 'hitlerExecuted' });
  });

  it('chaos policies never trigger powers', () => {
    let s = setup(5, { president: 0, deck: ['F', ...FILL] });
    s.fascist = 2;
    s = failVote(s, 1);
    s = failVote(s, 2);
    s = failVote(s, 3);
    expect(s.fascist).toBe(3);
    expect(s.phase).toBe('nominate');
  });
});

describe('veto', () => {
  function toChancellor(fascist: number, tracker = 0) {
    let s = setup(7, { president: 0, roles: roles(7, 6, [5, 4]), deck: ['F', 'F', 'L', ...FILL] });
    s.fascist = fascist;
    s.tracker = tracker;
    s = elect(s, 1);
    if (tracker) s.tracker = tracker; // election resets; restore for the chaos test
    return act(s, 0, { type: 'presDiscard', index: 2 });
  }

  it('is unavailable before 5 fascist policies', () => {
    const s = toChancellor(4);
    expect(legalActions(s, 1).some((a) => a.type === 'proposeVeto')).toBe(false);
  });

  it('agreed veto discards both cards and advances the tracker', () => {
    let s = toChancellor(5);
    expect(legalActions(s, 1).some((a) => a.type === 'proposeVeto')).toBe(true);
    s = act(s, 1, { type: 'proposeVeto' });
    expect(s.phase).toBe('veto');
    expect(pendingActors(s)).toEqual([0]);
    const discards = s.discard.length;
    s = act(s, 0, { type: 'vetoResponse', accept: true });
    expect(s.discard.length).toBe(discards + 2);
    expect(s.tracker).toBe(1);
    expect(s.fascist).toBe(5);
    expect(s.phase).toBe('nominate');
    expect(s.president).toBe(1);
  });

  it('refused veto forces the chancellor to enact and cannot be proposed again', () => {
    let s = toChancellor(5);
    s = act(s, 1, { type: 'proposeVeto' });
    s = act(s, 0, { type: 'vetoResponse', accept: false });
    expect(s.phase).toBe('legChancellor');
    expect(legalActions(s, 1).some((a) => a.type === 'proposeVeto')).toBe(false);
    s = act(s, 1, { type: 'chancEnact', index: 0 });
    expect(s.fascist).toBe(6);
    expect(s.winner).toBe('fascist');
  });

  it('agreed veto at tracker 2 triggers chaos', () => {
    let s = toChancellor(5, 2);
    s.deck = ['L', ...FILL];
    s = act(s, 1, { type: 'proposeVeto' });
    s = act(s, 0, { type: 'vetoResponse', accept: true });
    expect(s.liberal).toBe(1);
    expect(s.tracker).toBe(0);
    expect(s.lastChancellor).toBeNull();
  });
});

describe('win conditions', () => {
  it('liberals win at 5 liberal policies', () => {
    let s = setup(5, { president: 0, deck: ['L', 'L', 'L', ...FILL] });
    s.liberal = 4;
    s = elect(s, 1);
    s = legislate(s);
    expect(s.winner).toBe('liberal');
    expect(s.winReason).toBe('liberalPolicies');
    expect(pendingActors(s)).toEqual([]);
  });

  it('fascists win at 6 fascist policies (including by chaos)', () => {
    let s = setup(5, { president: 0, deck: ['F', ...FILL] });
    s.fascist = 5;
    s = failVote(s, 1);
    s = failVote(s, 2);
    s = failVote(s, 3);
    expect(s.winner).toBe('fascist');
    expect(s.winReason).toBe('fascistPolicies');
  });

  it('fascists win when Hitler is elected chancellor after 3 fascist policies', () => {
    let s = setup(5, { president: 0, roles: roles(5, 3, [4]) });
    s.fascist = 3;
    s = elect(s, 3);
    expect(s.winner).toBe('fascist');
    expect(s.winReason).toBe('hitlerElected');
  });

  it('Hitler elected chancellor with fewer than 3 fascist policies does not win', () => {
    let s = setup(5, { president: 0, roles: roles(5, 3, [4]) });
    s.fascist = 2;
    s = elect(s, 3);
    expect(s.winner).toBeNull();
    expect(s.phase).toBe('legPresident');
  });

  it('a failed Hitler nomination does not win', () => {
    let s = setup(5, { president: 0, roles: roles(5, 3, [4]) });
    s.fascist = 4;
    s = failVote(s, 3);
    expect(s.winner).toBeNull();
  });

  it('no actions are legal after the game ends', () => {
    let s = setup(5, { president: 0, roles: roles(5, 3, [4]) });
    s.fascist = 3;
    s = elect(s, 3);
    for (let i = 0; i < 5; i++) expect(legalActions(s, i)).toEqual([]);
  });

  it('someChancellor helper sanity', () => {
    const s = setup(5, { president: 0 });
    expect(someChancellor(s)).toBe(1);
  });
});
