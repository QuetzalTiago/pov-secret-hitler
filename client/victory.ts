// Pure copy/timing/particle model for the win ceremony (kept DOM- and audio-free so tests can import it).
import type { Party, WinReason } from '../shared/types';

export const REASONS: Record<string, string> = {
  liberalPolicies: 'Five Liberal policies were enacted.',
  hitlerExecuted: 'Hitler was executed.',
  fascistPolicies: 'Six Fascist policies were enacted.',
  hitlerElected: 'Hitler was elected Chancellor.',
};

export interface VictoryBanner {
  title: string;
  reason: string;
  stamp: 'VICTORY' | 'DEFEAT' | '';
  cls: 'liberal' | 'fascist';
}

export function victoryBanner(winner: Party, reason: WinReason | null, mine: Party | null): VictoryBanner {
  return {
    title: winner === 'liberal' ? 'LIBERALS WIN' : 'FASCISTS WIN',
    reason: REASONS[reason ?? ''] ?? '',
    stamp: mine === null ? '' : mine === winner ? 'VICTORY' : 'DEFEAT',
    cls: winner,
  };
}

/** Ms to wait before the ceremony starts so it doesn't overlap the previous beat. */
export function victoryDelay(reason: WinReason | null): number {
  switch (reason) {
    case 'liberalPolicies':
    case 'fascistPolicies':
      return 2900;
    case 'hitlerExecuted':
      return 2000;
    default:
      return 1000;
  }
}

/** Ceremony length in ms. */
export const VICTORY_MS = 5500;

export interface VictoryParticle {
  x: number; // start, percent of width
  delay: number; // s
  dur: number; // s
  size: number; // px
  drift: number; // vw
  hue: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function victoryParticles(winner: Party, count: number, seed = 1): VictoryParticle[] {
  const n = Math.max(0, Math.min(200, Math.floor(count) || 0));
  const rnd = mulberry32(seed);
  const lib = winner === 'liberal';
  return Array.from({ length: n }, (_, i) => {
    const x = rnd() * 100;
    const delay = rnd() * 1.5;
    const dur = 2.5 + rnd() * 2;
    const size = lib ? 6 + rnd() * 6 : 3 + rnd() * 4;
    const drift = -12 + rnd() * 24;
    const hue = lib ? (i % 2 === 0 ? 205 + rnd() * 10 : 40 + rnd() * 8) : rnd() * 28;
    return { x, delay, dur, size, drift, hue };
  });
}
