// Pure copy/timing/particle model for the win ceremony (kept DOM- and audio-free so tests can import it).
import type { Party, WinReason } from '../shared/types';
import { tr } from './i18n';

// Getters, so ui.ts's REASONS[key] reads follow the current language.
export const REASONS: Record<string, string> = {
  get liberalPolicies() {
    return tr({ en: 'Five Liberal policies were enacted.', es: 'Se promulgaron cinco leyes liberales.' });
  },
  get hitlerExecuted() {
    return tr({ en: 'Hitler was executed.', es: 'Hitler fue ejecutado.' });
  },
  get fascistPolicies() {
    return tr({ en: 'Six Fascist policies were enacted.', es: 'Se promulgaron seis leyes fascistas.' });
  },
  get hitlerElected() {
    return tr({ en: 'Hitler was elected Chancellor.', es: 'Hitler fue elegido Canciller.' });
  },
};

export interface VictoryBanner {
  title: string;
  masthead: string;
  dateline: string;
  headline: string;
  reason: string;
  stamp: 'VICTORY' | 'DEFEAT' | ''; // stable code: ui.ts picks the style from it
  stampLabel: string; // the stamp as shown
  cls: 'liberal' | 'fascist';
}

export function victoryBanner(winner: Party, reason: WinReason | null, mine: Party | null): VictoryBanner {
  const stamp = mine === null ? '' : mine === winner ? 'VICTORY' : 'DEFEAT';
  return {
    title: tr(winner === 'liberal' ? { en: 'LIBERALS WIN', es: 'GANAN LOS LIBERALES' } : { en: 'FASCISTS WIN', es: 'GANAN LOS FASCISTAS' }),
    masthead: 'Der Abend',
    dateline: 'BERLIN · LETZTE AUSGABE',
    headline: tr(
      winner === 'liberal'
        ? { en: 'LIBERALS TRIUMPH', es: 'TRIUNFO LIBERAL' }
        : { en: 'FASCISTS SEIZE POWER', es: 'LOS FASCISTAS TOMAN EL PODER' },
    ),
    reason: REASONS[reason ?? ''] ?? '',
    stamp,
    stampLabel: stamp === 'VICTORY' ? tr({ en: 'VICTORY', es: 'VICTORIA' }) : stamp === 'DEFEAT' ? tr({ en: 'DEFEAT', es: 'DERROTA' }) : '',
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

interface VictoryParticle {
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
