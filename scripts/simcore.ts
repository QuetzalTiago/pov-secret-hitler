// Plays complete games with bots and checks invariants after every step.
import { aliveCount, cardCounts, legalActions, pendingActors } from '../shared/engine';
import { FASCIST_WIN, HITLER_ZONE, LIBERAL_WIN } from '../shared/rules';
import { PHASES, type GameEvent, type GameState } from '../shared/types';
import { heuristicChooser, oldSmartChooser, randomChooser, runGame, type GameResult } from './gameloop';

export type { GameResult };

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
  const chooser = mode === 'random' ? randomChooser : mode === 'heuristic' ? heuristicChooser : oldSmartChooser;
  return runGame(n, seed, () => chooser, {
    trackMemory: mode === 'smart',
    onStart: checkInvariants,
    onStep: (s, events) => {
      eventsAreClean(events);
      checkInvariants(s);
      onStep?.(s, events);
    },
  });
}
