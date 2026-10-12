// Shared bot game loop: one Chooser per seat decides every action.
import { botAction, randomAction, type Rand } from '../shared/bot';
import { createGame, legalActions, pendingActors, reduce } from '../shared/engine';
import { nextRandom } from '../shared/rng';
import { buildDecision, heuristicChoice } from '../shared/smartbot';
import { newMemory, noteMyHand, observe, type Memory } from '../shared/tracker';
import type { ActionBody, GameEvent, GameState } from '../shared/types';
import { viewFor } from '../shared/view';

export interface GameResult {
  players: number;
  winner: string;
  reason: string;
  steps: number;
  events: number;
}

export type Chooser = (ctx: {
  s: GameState;
  seat: number;
  legal: ActionBody[];
  rand: Rand;
  memory: Memory;
  names: string[];
}) => ActionBody;

const MAX_STEPS = 5000;

export const randomChooser: Chooser = ({ legal, rand }) => randomAction(legal, rand);

export const heuristicChooser: Chooser = ({ s, seat, legal, rand }) => botAction(viewFor(s, seat), legal, rand);

// Same strategy + memory the server bots use when Jev is unavailable.
export const oldSmartChooser: Chooser = ({ s, seat, legal, rand, memory, names }) => {
  const v = viewFor(s, seat);
  const d = buildDecision(v, legal, memory, (x) => names[x]);
  const body = d.options[heuristicChoice(d, rand)].action;
  if (body.type === 'presDiscard') noteMyHand(memory, v, body.index);
  if (body.type === 'chancEnact') noteMyHand(memory, v, null);
  return body;
};

export function runGame(
  n: number,
  seed: number,
  choose: (seat: number, s: GameState) => Chooser,
  opts: {
    trackMemory?: boolean;
    onStart?: (s: GameState) => void;
    onStep?: (s: GameState, events: GameEvent[]) => void;
  } = {},
): GameResult {
  const names = Array.from({ length: n }, (_, i) => `Bot${i}`);
  let s = createGame(names, seed);
  let r = (seed ^ 0x9e3779b9) >>> 0;
  const rand = () => {
    const [v, next] = nextRandom(r);
    r = next;
    return v;
  };
  opts.onStart?.(s);
  const memories = names.map((_, i) => newMemory(i, n));
  let steps = 0;
  let events = 0;
  while (s.phase !== 'gameOver') {
    if (++steps > MAX_STEPS) throw new Error(`game ${n}p seed ${seed} did not finish`);
    const actors = pendingActors(s);
    const seat = actors[Math.floor(rand() * actors.length)];
    const legal = legalActions(s, seat);
    const body = choose(seat, s)({ s, seat, legal, rand, memory: memories[seat], names });
    const res = reduce(s, { ...body, seat } as never);
    s = res.state;
    if (opts.trackMemory) memories.forEach((m, i) => observe(m, viewFor(s, i), res.events));
    events += res.events.length;
    opts.onStep?.(s, res.events);
  }
  return { players: n, winner: s.winner!, reason: s.winReason!, steps, events };
}
