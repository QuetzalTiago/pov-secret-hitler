// Pure copy/model for the policy-enacted banner (kept DOM- and audio-free so tests can import it).
export interface EnactBanner {
  title: string;
  subtitle: string;
  kicker: string;
  cls: 'liberal' | 'fascist';
  pips: boolean[];
}

export function enactBanner(policy: 'L' | 'F', count: number, chaos: boolean): EnactBanner {
  const lib = policy === 'L';
  const len = lib ? 5 : 6;
  const filled = Math.max(0, Math.min(len, Math.floor(count) || 0));
  return {
    title: lib ? 'LIBERAL POLICY' : 'FASCIST POLICY',
    subtitle: 'ENACTED',
    kicker: chaos ? 'CHAOS' : '',
    cls: lib ? 'liberal' : 'fascist',
    pips: Array.from({ length: len }, (_, i) => i < filled),
  };
}
