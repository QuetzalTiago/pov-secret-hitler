// Pure, deterministic Secret Hitler rules engine. No I/O.
import {
  CHAOS_AT, FASCIST_POLICIES, FASCIST_WIN, HITLER_ZONE, LIBERAL_POLICIES, LIBERAL_WIN,
  MAX_PLAYERS, MIN_PLAYERS, VETO_AT, partyOf, rolesFor, trackFor,
} from './rules';
import { nextRandom, shuffle } from './rng';
import type {
  Action, ActionBody, GameEvent, GameState, Party, Policy, Power, ReduceResult, WinReason,
} from './types';

export class RuleError extends Error {}

function fail(msg: string): never {
  throw new RuleError(msg);
}

export function freshDeck(): Policy[] {
  const deck: Policy[] = [];
  for (let i = 0; i < LIBERAL_POLICIES; i++) deck.push('L');
  for (let i = 0; i < FASCIST_POLICIES; i++) deck.push('F');
  return deck;
}

export function createGame(names: string[], seed: number): GameState {
  const n = names.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) fail(`Need ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  let rng = seed >>> 0;
  let roles;
  [roles, rng] = shuffle(rolesFor(n), rng);
  let deck;
  [deck, rng] = shuffle(freshDeck(), rng);
  let r;
  [r, rng] = nextRandom(rng);
  const firstPresident = Math.floor(r * n);
  return {
    players: names.map((name, seat) => ({ seat, name, role: roles[seat], alive: true })),
    phase: 'night',
    deck,
    discard: [],
    hand: [],
    liberal: 0,
    fascist: 0,
    tracker: 0,
    president: firstPresident,
    nominee: null,
    chancellor: null,
    lastPresident: null,
    lastChancellor: null,
    specialReturn: null,
    votes: names.map(() => null),
    lastVotes: null,
    nightAcks: names.map(() => false),
    vetoRefused: false,
    investigations: [],
    winner: null,
    winReason: null,
    rng,
    round: 1,
  };
}

export function clone(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p })),
    deck: s.deck.slice(),
    discard: s.discard.slice(),
    hand: s.hand.slice(),
    votes: s.votes.slice(),
    lastVotes: s.lastVotes ? s.lastVotes.slice() : null,
    nightAcks: s.nightAcks.slice(),
    investigations: s.investigations.map((i) => ({ ...i })),
  };
}

// ---------- queries ----------

export function aliveSeats(s: GameState): number[] {
  return s.players.filter((p) => p.alive).map((p) => p.seat);
}

export function aliveCount(s: GameState): number {
  return s.players.reduce((c, p) => c + (p.alive ? 1 : 0), 0);
}

export function nextAliveAfter(s: GameState, seat: number): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const cand = (seat + i) % n;
    if (s.players[cand].alive) return cand;
  }
  return seat;
}

export function vetoUnlocked(s: GameState): boolean {
  return s.fascist >= VETO_AT;
}

export function canBeChancellor(s: GameState, target: number): boolean {
  const p = s.players[target];
  if (!p || !p.alive) return false;
  if (target === s.president) return false;
  if (target === s.lastChancellor) return false;
  if (aliveCount(s) > 5 && target === s.lastPresident) return false;
  return true;
}

export function eligibleChancellors(s: GameState): number[] {
  return s.players.map((p) => p.seat).filter((seat) => canBeChancellor(s, seat));
}

export function powerFor(s: GameState, fascistCount: number): Power | null {
  return trackFor(s.players.length)[fascistCount - 1] ?? null;
}

/** Seats that currently owe an action. */
export function pendingActors(s: GameState): number[] {
  switch (s.phase) {
    case 'night':
      return s.players.filter((p) => !s.nightAcks[p.seat]).map((p) => p.seat);
    case 'vote':
      return aliveSeats(s).filter((seat) => s.votes[seat] === null);
    case 'nominate':
    case 'legPresident':
    case 'veto':
    case 'peek':
    case 'investigate':
    case 'special':
    case 'execute':
      return [s.president];
    case 'legChancellor':
      return s.chancellor === null ? [] : [s.chancellor];
    case 'gameOver':
      return [];
  }
}

/** Every legal action for a seat in the current state. */
export function legalActions(s: GameState, seat: number): ActionBody[] {
  if (!pendingActors(s).includes(seat)) return [];
  const others = (pred: (t: number) => boolean) =>
    s.players.filter((p) => p.alive && p.seat !== s.president && pred(p.seat)).map((p) => p.seat);
  switch (s.phase) {
    case 'night':
      return [{ type: 'ack' }];
    case 'nominate':
      return eligibleChancellors(s).map((target) => ({ type: 'nominate', target }));
    case 'vote':
      return [{ type: 'vote', ja: true }, { type: 'vote', ja: false }];
    case 'legPresident':
      return s.hand.map((_, index) => ({ type: 'presDiscard', index }));
    case 'legChancellor': {
      const acts: ActionBody[] = s.hand.map((_, index) => ({ type: 'chancEnact', index }));
      if (vetoUnlocked(s) && !s.vetoRefused) acts.push({ type: 'proposeVeto' });
      return acts;
    }
    case 'veto':
      return [{ type: 'vetoResponse', accept: true }, { type: 'vetoResponse', accept: false }];
    case 'peek':
      return [{ type: 'peekDone' }];
    case 'investigate':
      return others((t) => !s.investigations.some((i) => i.target === t)).map((target) => ({
        type: 'investigate',
        target,
      }));
    case 'special':
      return others(() => true).map((target) => ({ type: 'specialElect', target }));
    case 'execute':
      return others(() => true).map((target) => ({ type: 'execute', target }));
    case 'gameOver':
      return [];
  }
}

export function isLegal(s: GameState, a: Action): boolean {
  return legalActions(s, a.seat).some((b) => sameBody(a, b));
}

function sameBody(a: ActionBody, b: ActionBody): boolean {
  if (a.type !== b.type) return false;
  const ka = a as Record<string, unknown>;
  const kb = b as Record<string, unknown>;
  for (const key of Object.keys(kb)) if (ka[key] !== kb[key]) return false;
  return true;
}

// ---------- transitions (mutate the cloned draft) ----------

class Draft {
  events: GameEvent[] = [];
  constructor(public s: GameState) {}

  emit(e: GameEvent) {
    this.events.push(e);
  }

  win(winner: Party, reason: WinReason) {
    this.s.phase = 'gameOver';
    this.s.winner = winner;
    this.s.winReason = reason;
    this.s.hand = [];
    this.emit({ k: 'gameOver', winner, reason });
  }

  ensureDeck() {
    const s = this.s;
    if (s.deck.length < 3) {
      let shuffled;
      [shuffled, s.rng] = shuffle(s.deck.concat(s.discard), s.rng);
      s.deck = shuffled;
      s.discard = [];
      this.emit({ k: 'reshuffled', deck: s.deck.length });
    }
  }

  startPresidency(seat: number, special: boolean) {
    const s = this.s;
    s.president = seat;
    s.nominee = null;
    s.chancellor = null;
    s.votes = s.players.map(() => null);
    s.hand = [];
    s.vetoRefused = false;
    s.phase = 'nominate';
    s.round += 1;
    this.emit({ k: 'newPresident', seat, special });
  }

  advancePresidency() {
    const s = this.s;
    const base = s.specialReturn ?? s.president;
    s.specialReturn = null;
    this.startPresidency(nextAliveAfter(s, base), false);
  }

  /** Places a policy on the board. Returns true if the game ended. */
  placePolicy(policy: Policy, chaos: boolean): boolean {
    const s = this.s;
    if (policy === 'L') s.liberal += 1;
    else s.fascist += 1;
    this.emit({ k: 'enacted', policy, chaos });
    if (s.liberal >= LIBERAL_WIN) {
      this.win('liberal', 'liberalPolicies');
      return true;
    }
    if (s.fascist >= FASCIST_WIN) {
      this.win('fascist', 'fascistPolicies');
      return true;
    }
    this.ensureDeck();
    return false;
  }

  failElection() {
    const s = this.s;
    s.tracker += 1;
    this.emit({ k: 'tracker', value: s.tracker });
    if (s.tracker >= CHAOS_AT) {
      s.tracker = 0;
      s.lastPresident = null;
      s.lastChancellor = null;
      this.ensureDeck();
      const top = s.deck.shift()!;
      this.emit({ k: 'tracker', value: 0 });
      if (this.placePolicy(top, true)) return;
    }
    this.advancePresidency();
  }

  enactFromGovernment(policy: Policy) {
    const s = this.s;
    s.hand = [];
    s.tracker = 0;
    if (this.placePolicy(policy, false)) return;
    const power = policy === 'F' ? powerFor(s, s.fascist) : null;
    if (power) {
      s.phase = power;
      this.emit({ k: 'power', power, president: s.president });
    } else {
      this.advancePresidency();
    }
  }
}

export function reduce(state: GameState, action: Action): ReduceResult {
  if (!isLegal(state, action)) fail(`Illegal action ${action.type} by seat ${action.seat} in ${state.phase}`);
  const d = new Draft(clone(state));
  const s = d.s;
  const seat = action.seat;

  switch (action.type) {
    case 'ack': {
      s.nightAcks[seat] = true;
      d.emit({ k: 'acked', seat });
      if (s.nightAcks.every(Boolean)) {
        s.phase = 'nominate';
        d.emit({ k: 'newPresident', seat: s.president, special: false });
      }
      break;
    }
    case 'nominate': {
      s.nominee = action.target;
      s.votes = s.players.map(() => null);
      s.phase = 'vote';
      d.emit({ k: 'nominated', president: s.president, target: action.target });
      break;
    }
    case 'vote': {
      s.votes[seat] = action.ja;
      d.emit({ k: 'voted', seat });
      if (pendingActors(s).length > 0) break;
      const ja = s.votes.filter((v) => v === true).length;
      const passed = ja > aliveCount(s) / 2;
      s.lastVotes = s.votes.slice();
      d.emit({ k: 'votes', votes: s.lastVotes.slice(), passed });
      const nominee = s.nominee!;
      if (!passed) {
        s.nominee = null;
        d.failElection();
        break;
      }
      s.chancellor = nominee;
      s.nominee = null;
      s.lastPresident = s.president;
      s.lastChancellor = nominee;
      if (s.fascist >= HITLER_ZONE && s.players[nominee].role === 'hitler') {
        d.win('fascist', 'hitlerElected');
        break;
      }
      s.tracker = 0;
      d.emit({ k: 'tracker', value: 0 });
      d.ensureDeck();
      s.hand = s.deck.splice(0, 3);
      s.phase = 'legPresident';
      d.emit({ k: 'drawn', seat: s.president, count: 3 });
      break;
    }
    case 'presDiscard': {
      const [card] = s.hand.splice(action.index, 1);
      s.discard.push(card);
      d.emit({ k: 'presDiscarded', seat });
      d.emit({ k: 'passedToChancellor', from: seat, to: s.chancellor! });
      s.phase = 'legChancellor';
      break;
    }
    case 'chancEnact': {
      const enacted = s.hand[action.index];
      const other = s.hand[1 - action.index];
      s.discard.push(other);
      d.emit({ k: 'chancDiscarded', seat });
      d.enactFromGovernment(enacted);
      break;
    }
    case 'proposeVeto': {
      s.phase = 'veto';
      d.emit({ k: 'vetoProposed', seat });
      break;
    }
    case 'vetoResponse': {
      d.emit({ k: 'vetoAnswer', accepted: action.accept });
      if (action.accept) {
        s.discard.push(...s.hand);
        s.hand = [];
        d.failElection();
      } else {
        s.vetoRefused = true;
        s.phase = 'legChancellor';
      }
      break;
    }
    case 'peekDone': {
      d.emit({ k: 'peeked', seat });
      d.advancePresidency();
      break;
    }
    case 'investigate': {
      s.investigations.push({ by: seat, target: action.target, party: partyOf(s.players[action.target].role) });
      d.emit({ k: 'investigated', by: seat, target: action.target });
      d.advancePresidency();
      break;
    }
    case 'specialElect': {
      d.emit({ k: 'specialElected', by: seat, target: action.target });
      s.specialReturn = seat;
      d.startPresidency(action.target, true);
      break;
    }
    case 'execute': {
      const target = s.players[action.target];
      target.alive = false;
      d.emit({ k: 'executed', by: seat, target: action.target });
      if (target.role === 'hitler') {
        d.win('liberal', 'hitlerExecuted');
        break;
      }
      d.advancePresidency();
      break;
    }
  }
  return { state: s, events: d.events };
}

/** Card conservation check used by tests and the simulator. */
export function cardCounts(s: GameState): { L: number; F: number } {
  const all = [...s.deck, ...s.discard, ...s.hand];
  return {
    L: all.filter((c) => c === 'L').length + s.liberal,
    F: all.filter((c) => c === 'F').length + s.fascist,
  };
}
