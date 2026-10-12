// Bot brain: builds the decision from the bot's own view + memory. The built-in strategy is primary;
// Jev is only asked to break near-ties among the options the strategy scores about equally. Always
// returns a legal action.
import { buildDecision, heuristicChoice, sampleChoice, type Rand } from '../shared/smartbot';
import { noteMyHand, type Memory } from '../shared/tracker';
import type { ActionBody } from '../shared/types';
import type { GameView } from '../shared/view';
import { askChoice } from './jev';

export interface BrainResult {
  action: ActionBody;
  source: 'jev' | 'heuristic' | 'trivial';
}

const TRIVIAL = new Set(['ack', 'peekDone']);

/** Score gap under which the built-in strategy treats options as a near-tie and asks Jev. */
export const JEV_MARGIN = 0.5;

export async function decide(
  view: GameView,
  legal: ActionBody[],
  memory: Memory,
  name: (seat: number) => string,
  rand: Rand = Math.random,
  ask: typeof askChoice = askChoice,
): Promise<BrainResult> {
  if (legal.length === 1 || TRIVIAL.has(legal[0].type)) return { action: legal[0], source: 'trivial' };
  const d = buildDecision(view, legal, memory, name);
  let key = '';
  let source: BrainResult['source'] = 'heuristic';
  const entries = Object.entries(d.options);
  const top = Math.max(...entries.map(([, o]) => o.score));
  const close = entries.filter(([, o]) => o.score >= top - JEV_MARGIN);
  if (close.length > 1) {
    const answer = await ask(d.state, d.instructions, Object.fromEntries(close.map(([k, o]) => [k, o.description])));
    if (answer) {
      const isClose = (k: string) => close.some(([c]) => c === k);
      key = sampleChoice(answer.probabilities, rand);
      if (!isClose(key)) key = answer.choice;
      if (isClose(key)) source = 'jev';
      else key = '';
    }
  }
  if (!(key in d.options)) {
    key = heuristicChoice(d, rand);
    source = 'heuristic';
  }
  const action = d.options[key].action;
  if (action.type === 'presDiscard') noteMyHand(memory, view, action.index);
  if (action.type === 'chancEnact' || action.type === 'proposeVeto') noteMyHand(memory, view, null);
  return { action, source };
}

/** Synchronous version for timeouts and the simulator: built-in strategy only. */
export function decideNow(view: GameView, legal: ActionBody[], memory: Memory, name: (s: number) => string, rand: Rand = Math.random): ActionBody {
  if (legal.length === 1 || TRIVIAL.has(legal[0].type)) return legal[0];
  const d = buildDecision(view, legal, memory, name);
  const action = d.options[heuristicChoice(d, rand)].action;
  if (action.type === 'presDiscard') noteMyHand(memory, view, action.index);
  if (action.type === 'chancEnact' || action.type === 'proposeVeto') noteMyHand(memory, view, null);
  return action;
}
