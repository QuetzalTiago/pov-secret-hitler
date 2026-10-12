import { describe, expect, it } from 'vitest';
import { REASONS, VICTORY_MS, victoryBanner, victoryDelay, victoryParticles } from '../client/victory';

describe('victoryBanner', () => {
  it('titles and class per winner', () => {
    const l = victoryBanner('liberal', 'liberalPolicies', 'liberal');
    expect(l.title).toBe('LIBERALS WIN');
    expect(l.cls).toBe('liberal');
    const f = victoryBanner('fascist', 'fascistPolicies', 'fascist');
    expect(f.title).toBe('FASCISTS WIN');
    expect(f.cls).toBe('fascist');
  });

  it('newspaper masthead, dateline and headline per winner', () => {
    const l = victoryBanner('liberal', 'liberalPolicies', 'liberal');
    expect(l.masthead).toBe('Der Abend');
    expect(l.dateline).toBe('BERLIN · LETZTE AUSGABE');
    expect(l.headline).toBe('LIBERALS TRIUMPH');
    const f = victoryBanner('fascist', 'hitlerElected', null);
    expect(f.masthead).toBe('Der Abend');
    expect(f.dateline).toBe('BERLIN · LETZTE AUSGABE');
    expect(f.headline).toBe('FASCISTS SEIZE POWER');
    expect(f.title).toBe('FASCISTS WIN');
  });

  it('stamp: victory, defeat, spectator', () => {
    expect(victoryBanner('liberal', null, 'liberal').stamp).toBe('VICTORY');
    expect(victoryBanner('liberal', null, 'fascist').stamp).toBe('DEFEAT');
    expect(victoryBanner('fascist', null, 'liberal').stamp).toBe('DEFEAT');
    expect(victoryBanner('fascist', null, null).stamp).toBe('');
  });

  it('reason copy, empty for null', () => {
    expect(victoryBanner('liberal', 'liberalPolicies', null).reason).toBe(REASONS.liberalPolicies);
    expect(victoryBanner('fascist', 'hitlerElected', null).reason).toBe('Hitler was elected Chancellor.');
    expect(victoryBanner('liberal', 'hitlerExecuted', null).reason).toBe('Hitler was executed.');
    expect(victoryBanner('fascist', null, null).reason).toBe('');
  });
});

describe('victoryDelay', () => {
  it('per reason', () => {
    expect(victoryDelay('liberalPolicies')).toBe(2900);
    expect(victoryDelay('fascistPolicies')).toBe(2900);
    expect(victoryDelay('hitlerExecuted')).toBe(2000);
    expect(victoryDelay('hitlerElected')).toBe(1000);
    expect(victoryDelay(null)).toBe(1000);
  });

  it('ceremony length', () => {
    expect(VICTORY_MS).toBe(5500);
  });
});

describe('victoryParticles', () => {
  it('length and clamping', () => {
    expect(victoryParticles('liberal', 30)).toHaveLength(30);
    expect(victoryParticles('liberal', -5)).toHaveLength(0);
    expect(victoryParticles('fascist', 999)).toHaveLength(200);
    expect(victoryParticles('fascist', 3.7)).toHaveLength(3);
  });

  it('deterministic per seed', () => {
    expect(victoryParticles('liberal', 20, 7)).toEqual(victoryParticles('liberal', 20, 7));
    expect(victoryParticles('liberal', 20, 7)).not.toEqual(victoryParticles('liberal', 20, 8));
    expect(victoryParticles('liberal', 20)).toEqual(victoryParticles('liberal', 20, 1));
  });

  it('fields in range', () => {
    for (const winner of ['liberal', 'fascist'] as const) {
      const [smin, smax] = winner === 'liberal' ? [6, 12] : [3, 7];
      for (const p of victoryParticles(winner, 200, 42)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(100);
        expect(p.delay).toBeGreaterThanOrEqual(0);
        expect(p.delay).toBeLessThanOrEqual(1.5);
        expect(p.dur).toBeGreaterThanOrEqual(2.5);
        expect(p.dur).toBeLessThanOrEqual(4.5);
        expect(p.size).toBeGreaterThanOrEqual(smin);
        expect(p.size).toBeLessThanOrEqual(smax);
        expect(p.drift).toBeGreaterThanOrEqual(-12);
        expect(p.drift).toBeLessThanOrEqual(12);
      }
    }
  });

  it('liberal hues alternate blue/gold', () => {
    victoryParticles('liberal', 50, 3).forEach((p, i) => {
      if (i % 2 === 0) {
        expect(p.hue).toBeGreaterThanOrEqual(205);
        expect(p.hue).toBeLessThanOrEqual(215);
      } else {
        expect(p.hue).toBeGreaterThanOrEqual(40);
        expect(p.hue).toBeLessThanOrEqual(48);
      }
    });
  });

  it('fascist hues are red/orange', () => {
    for (const p of victoryParticles('fascist', 100, 5)) {
      expect(p.hue).toBeGreaterThanOrEqual(0);
      expect(p.hue).toBeLessThanOrEqual(28);
    }
  });
});
