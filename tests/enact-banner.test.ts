import { describe, expect, it } from 'vitest';
import { ENACT_BANNER_DELAY_MS, ENACT_BANNER_MS, ceremonyEndsAt, enactBanner } from '../client/enact';

describe('enactBanner', () => {
  it('liberal: title, class, 5 pips', () => {
    const b = enactBanner('L', 1, false);
    expect(b.title).toBe('LIBERAL POLICY');
    expect(b.subtitle).toBe('ENACTED');
    expect(b.cls).toBe('liberal');
    expect(b.pips).toHaveLength(5);
  });

  it('fascist: title, class, 6 pips', () => {
    const b = enactBanner('F', 1, false);
    expect(b.title).toBe('FASCIST POLICY');
    expect(b.cls).toBe('fascist');
    expect(b.pips).toHaveLength(6);
  });

  it('fills the first count pips', () => {
    expect(enactBanner('L', 3, false).pips).toEqual([true, true, true, false, false]);
    expect(enactBanner('F', 6, false).pips.every(Boolean)).toBe(true);
  });

  it('clamps count to the track length', () => {
    expect(enactBanner('L', 0, false).pips.some(Boolean)).toBe(false);
    expect(enactBanner('L', -4, false).pips.some(Boolean)).toBe(false);
    expect(enactBanner('L', 9, false).pips.every(Boolean)).toBe(true);
    expect(enactBanner('F', 99, false).pips).toHaveLength(6);
  });

  it('kicker only on chaos', () => {
    expect(enactBanner('F', 2, true).kicker).toBe('CHAOS');
    expect(enactBanner('F', 2, false).kicker).toBe('');
  });
});

describe('ceremonyEndsAt', () => {
  it('banner timings', () => {
    expect(ENACT_BANNER_DELAY_MS).toBe(650);
    expect(ENACT_BANNER_MS).toBe(2500);
  });

  it('ends after the banner delay plus its duration', () => {
    expect(ceremonyEndsAt(10)).toBeCloseTo(13.15);
  });
});
