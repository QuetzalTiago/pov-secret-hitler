// Bot brain: builds the decision from the bot's own view + memory, asks Jev, falls back to the
// built-in strategy, and always returns a legal action.
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
  if (Object.keys(d.options).length > 1) {
    const criteria = Object.fromEntries(Object.entries(d.options).map(([k, o]) => [k, o.description]));
    const answer = await ask(d.state, d.instructions, criteria);
    if (answer) {
      key = sampleChoice(answer.probabilities, rand);
      if (!(key in d.options)) key = answer.choice;
      source = 'jev';
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
