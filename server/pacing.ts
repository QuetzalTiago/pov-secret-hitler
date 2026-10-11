import type { GameEvent, Phase } from '../shared/types';
import { config } from './config';

/** Think-time range per phase, in seconds at the default botDelayMs (1400 ms = 1 unit). */
export const THINK_SECONDS: Record<Phase, [number, number]> = {
  night: [4, 10], nominate: [5, 12], vote: [3, 9], legPresident: [4, 9], legChancellor: [4, 9],
  veto: [4, 8], peek: [3, 6], investigate: [6, 14], special: [6, 14], execute: [6, 14], gameOver: [0, 0],
};

// Matches client/game.ts animations: vote reveal `until: now + 4.5`, nomination point 2.5 s, shot 2.8 s.
/** Seconds the clients need to finish animating an event, at the default botDelayMs (1400 ms = 1 unit). */
export const SETTLE_SECONDS = { votes: 4.5, nominated: 2.5, executed: 3, enacted: 1.5, other: 1 };

/** How long bots wait for the animations of these events to settle, scaled by unitMs/1400; 0 for no events. */
export function settleMs(events: GameEvent[], unitMs: number = config.botDelayMs): number {
  let seconds = 0;
  for (const e of events) {
    const s = e.k === 'votes' || e.k === 'nominated' || e.k === 'executed' || e.k === 'enacted' ? SETTLE_SECONDS[e.k] : SETTLE_SECONDS.other;
    seconds = Math.max(seconds, s);
  }
  return (seconds * 1000 * unitMs) / 1400;
}

/** How long a bot "thinks" before acting in this phase, scaled by unitMs/1400. Pure given rand and unitMs. */
export function botThinkMs(phase: Phase, rand: () => number = Math.random, unitMs: number = config.botDelayMs): number {
  const [min, max] = THINK_SECONDS[phase];
  return ((min + rand() * (max - min)) * 1000 * unitMs) / 1400;
}
