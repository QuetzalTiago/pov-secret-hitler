import type { Phase } from '../shared/types';
import { config } from './config';

/** Think-time range per phase, in seconds at the default botDelayMs (1400 ms = 1 unit). */
export const THINK_SECONDS: Record<Phase, [number, number]> = {
  night: [4, 10], nominate: [5, 12], vote: [3, 9], legPresident: [4, 9], legChancellor: [4, 9],
  veto: [4, 8], peek: [3, 6], investigate: [6, 14], special: [6, 14], execute: [6, 14], gameOver: [0, 0],
};

/** How long a bot "thinks" before acting in this phase, scaled by unitMs/1400. Pure given rand and unitMs. */
export function botThinkMs(phase: Phase, rand: () => number = Math.random, unitMs: number = config.botDelayMs): number {
  const [min, max] = THINK_SECONDS[phase];
  return ((min + rand() * (max - min)) * 1000 * unitMs) / 1400;
}
