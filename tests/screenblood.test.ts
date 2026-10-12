import { describe, expect, it } from 'vitest';
import { SCREEN_BLOOD_S, screenBloodFrame, screenSplats, sleeveBlood } from '../client/screenblood';

const SEEDS = [1, 2, 3, 17, 99, 12345, 777777];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('screenSplats', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(screenSplats('victim', 5)).toEqual(screenSplats('victim', 5));
    expect(screenSplats('spatter', 5)).toEqual(screenSplats('spatter', 5));
    expect(screenSplats('victim', 5)).not.toEqual(screenSplats('victim', 6));
  });

  it('makes the victim hit bigger and heavier than a spatter', () => {
    for (const s of SEEDS) {
      const v = screenSplats('victim', s);
      const p = screenSplats('spatter', s);
      expect(v.length).toBeGreaterThanOrEqual(16);
      expect(v.length).toBeLessThanOrEqual(22);
      expect(p.length).toBeGreaterThanOrEqual(5);
      expect(p.length).toBeLessThanOrEqual(8);
      expect(v.length).toBeGreaterThan(p.length);
      expect(mean(v.map((q) => q.r))).toBeGreaterThan(mean(p.map((q) => q.r)));
    }
  });

  it('keeps spatter away from the centre', () => {
    for (const s of SEEDS) for (const q of screenSplats('spatter', s)) expect(Math.hypot(q.x - 0.5, q.y - 0.5)).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });

  it('stays inside the viewport with sane sizes', () => {
    for (const kind of ['spatter', 'victim'] as const) {
      for (const s of SEEDS) {
        for (const q of screenSplats(kind, s)) {
          expect(q.x).toBeGreaterThanOrEqual(0);
          expect(q.x).toBeLessThanOrEqual(1);
          expect(q.y).toBeGreaterThanOrEqual(0);
          expect(q.y).toBeLessThanOrEqual(1);
          expect(q.blobs.length).toBeGreaterThanOrEqual(3);
          expect(q.blobs.length).toBeLessThanOrEqual(7);
          expect(q.drip).toBeLessThanOrEqual(kind === 'victim' ? 0.4 : 0.25);
          expect(q.dripW).toBeGreaterThanOrEqual(0.2 * q.r);
          expect(q.dripW).toBeLessThanOrEqual(0.45 * q.r);
        }
      }
    }
  });

  it('uses flat red-dominant hex colours', () => {
    for (const kind of ['spatter', 'victim'] as const) {
      for (const q of screenSplats(kind, 3)) {
        expect(q.color).toMatch(/^#[0-9a-f]{6}$/);
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(q.color.slice(i, i + 2), 16));
        expect(r).toBeGreaterThan(g);
        expect(r).toBeGreaterThan(b);
      }
    }
  });
});

describe('screenBloodFrame', () => {
  it('holds full alpha then fades to nothing', () => {
    expect(screenBloodFrame(0).alpha).toBe(1);
    expect(screenBloodFrame(1.2).alpha).toBe(1);
    expect(screenBloodFrame(SCREEN_BLOOD_S).alpha).toBe(0);
    expect(screenBloodFrame(10).alpha).toBe(0);
    expect(screenBloodFrame(2).alpha).toBeLessThan(1);
    expect(screenBloodFrame(3).alpha).toBeLessThan(screenBloodFrame(2).alpha);
  });

  it('eases the drip from 0 to 1 by 2.5 s', () => {
    expect(screenBloodFrame(0).drip).toBe(0);
    expect(screenBloodFrame(2.5).drip).toBe(1);
    expect(screenBloodFrame(9).drip).toBe(1);
    let last = -1;
    for (let t = 0; t <= 3; t += 0.25) {
      const d = screenBloodFrame(t).drip;
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });
});

describe('sleeveBlood', () => {
  it('tints harder the closer the hit', () => {
    expect(sleeveBlood('none')).toBe(0);
    expect(sleeveBlood('spatter')).toBe(0.35);
    expect(sleeveBlood('victim')).toBe(0.65);
  });
});
