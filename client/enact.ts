// Pure copy/model for the policy-enacted banner (kept DOM- and audio-free so tests can import it).
import { tr } from './i18n';

interface EnactBanner {
  title: string;
  subtitle: string;
  kicker: string;
  masthead: string;
  dateline: string;
  cls: 'liberal' | 'fascist';
  pips: boolean[];
}

export function enactBanner(policy: 'L' | 'F', count: number, chaos: boolean): EnactBanner {
  const lib = policy === 'L';
  const len = lib ? 5 : 6;
  const filled = Math.max(0, Math.min(len, Math.floor(count) || 0));
  return {
    title: tr(lib ? { en: 'LIBERAL POLICY', es: 'LEY LIBERAL' } : { en: 'FASCIST POLICY', es: 'LEY FASCISTA' }),
    subtitle: tr({ en: 'ENACTED', es: 'PROMULGADA' }),
    kicker: chaos ? tr({ en: 'CHAOS', es: 'CAOS' }) : '',
    masthead: 'Extrablatt',
    dateline: 'BERLIN · SONDERAUSGABE · 10 PFENNIG',
    cls: lib ? 'liberal' : 'fascist',
    pips: Array.from({ length: len }, (_, i) => i < filled),
  };
}

/** The banner appears this long after the 'enacted' event, so the card can reach the board first. */
export const ENACT_BANNER_DELAY_MS = 650;
export const ENACT_BANNER_MS = 2500;

/** Game-clock time (seconds) at which an enact ceremony started at `nowSeconds` is over. */
export function ceremonyEndsAt(nowSeconds: number): number {
  return nowSeconds + (ENACT_BANNER_DELAY_MS + ENACT_BANNER_MS) / 1000;
}
