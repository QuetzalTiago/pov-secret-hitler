// Plays complete games with bots and checks invariants after every step.
import { botAction, randomAction } from '../shared/bot';
import { buildDecision, heuristicChoice } from '../shared/smartbot';
import { newMemory, noteMyHand, observe } from '../shared/tracker';
import {
  aliveCount, cardCounts, createGame, legalActions, pendingActors, reduce,
} from '../shared/engine';
import { nextRandom } from '../shared/rng';
import { FASCIST_WIN, HITLER_ZONE, LIBERAL_WIN } from '../shared/rules';
import { PHASES, type GameEvent, type GameState } from '../shared/types';
import { viewFor } from '../shared/view';

export interface GameResult {
  players: number;
  winner: string;
  reason: string;
  steps: number;
  events: number;
}

const MAX_STEPS = 5000;

export function checkInvariants(s: GameState): void {
  const fail = (m: string) => {
    throw new Error(`Invariant violated: ${m}`);
  };
  const c = cardCounts(s);
  if (c.L !== 6 || c.F !== 11) fail(`card counts ${JSON.stringify(c)}`);
  if (!PHASES.includes(s.phase)) fail(`unknown phase ${s.phase}`);
  if (s.tracker < 0 || s.tracker > 2) fail(`tracker ${s.tracker}`);
  if (s.liberal > LIBERAL_WIN || s.fascist > FASCIST_WIN) fail('track overflow');
  if (s.phase !== 'gameOver') {
    if (s.liberal >= LIBERAL_WIN || s.fascist >= FASCIST_WIN) fail('game should have ended');
    if (!s.players[s.president].alive) fail('dead president');
    if (pendingActors(s).length === 0) fail(`nobody to act in ${s.phase}`);
    for (const seat of pendingActors(s)) {
      if (legalActions(s, seat).length === 0) fail(`seat ${seat} pending with no legal action`);
    }
    if (s.deck.length + s.hand.length < 3 && s.phase === 'nominate') fail('deck not reshuffled');
    if (s.players.find((p) => p.role === 'hitler' && !p.alive)) fail('hitler dead but game continues');
  } else {
    if (!s.winner || !s.winReason) fail('gameOver without winner');
    if (s.winReason === 'hitlerElected' && s.fascist < HITLER_ZONE) fail('hitler win too early');
  }
  if ((s.phase === 'legPresident' && s.hand.length !== 3) || (s.phase === 'legChancellor' && s.hand.length !== 2)) {
    fail(`hand size ${s.hand.length} in ${s.phase}`);
  }
  if (aliveCount(s) < s.players.length - 2) fail('more than 2 executions');
  const n = s.players.length;
  if (s.lastChancellor !== null && (s.lastChancellor < 0 || s.lastChancellor >= n)) fail('bad lastChancellor');
}

export function eventsAreClean(events: GameEvent[]): void {
  for (const e of events) {
    const json = JSON.stringify(e);
    if (e.k !== 'enacted' && /"[LF]"/.test(json)) throw new Error(`event leaks a card: ${json}`);
    if (/hitler"|"liberal"|"fascist"/.test(json) && e.k !== 'gameOver') throw new Error(`event leaks a role: ${json}`);
  }
}

export function playGame(
  n: number,
  seed: number,
  mode: 'random' | 'heuristic' | 'smart',
  onStep?: (s: GameState, events: GameEvent[]) => void,
): GameResult {
  const names = Array.from({ length: n }, (_, i) => `Bot${i}`);
  let s = createGame(names, seed);
  let r = (seed ^ 0x9e3779b9) >>> 0;
  const rand = () => {
    const [v, next] = nextRandom(r);
    r = next;
    return v;
  };
  checkInvariants(s);
  const memories = names.map((_, i) => newMemory(i, n));
  let steps = 0;
  let events = 0;
  while (s.phase !== 'gameOver') {
    if (++steps > MAX_STEPS) throw new Error(`game ${n}p seed ${seed} did not finish`);
    const actors = pendingActors(s);
    const seat = actors[Math.floor(rand() * actors.length)];
    const legal = legalActions(s, seat);
    let body;
    if (mode === 'random') body = randomAction(legal, rand);
    else if (mode === 'heuristic') body = botAction(viewFor(s, seat), legal, rand);
    else {
      // Same strategy + memory the server bots use when Jev is unavailable.
      const v = viewFor(s, seat);
      const d = buildDecision(v, legal, memories[seat], (x) => names[x]);
      body = d.options[heuristicChoice(d, rand)].action;
      if (body.type === 'presDiscard') noteMyHand(memories[seat], v, body.index);
      if (body.type === 'chancEnact') noteMyHand(memories[seat], v, null);
    }
    const res = reduce(s, { ...body, seat } as never);
    s = res.state;
    if (mode === 'smart') memories.forEach((m, i) => observe(m, viewFor(s, i), res.events));
    events += res.events.length;
    eventsAreClean(res.events);
    checkInvariants(s);
    onStep?.(s, res.events);
  }
  return { players: n, winner: s.winner!, reason: s.winReason!, steps, events };
}
