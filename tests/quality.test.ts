import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, qualitySteps } from '../client/scene/quality';

const run = (q: AdaptiveQuality, ms: number, totalMs: number) => {
  const drops = [];
  for (let t = 0; t < totalMs; t += ms) {
    const step = q.frame(ms);
    if (step) drops.push(step);
  }
  return drops;
};

describe('adaptive quality', () => {
  it('steps from the capped device ratio down to no shadows', () => {
    expect(qualitySteps(2)).toEqual([
      { pixelRatio: 1.5, shadows: true },
      { pixelRatio: 1, shadows: true },
      { pixelRatio: 0.75, shadows: true },
      { pixelRatio: 0.75, shadows: false },
    ]);
    expect(qualitySteps(1).map((s) => s.pixelRatio)).toEqual([1, 0.75, 0.75]);
  });

  it('leaves a machine that holds 60 fps alone', () => {
    const q = new AdaptiveQuality(2);
    expect(run(q, 16.7, 60_000)).toEqual([]);
    expect(q.level).toBe(0);
  });

  it('drops one step at a time on a slow machine and stops at the bottom', () => {
    const q = new AdaptiveQuality(2);
    const drops = run(q, 40, 9000);
    expect(drops).toEqual([{ pixelRatio: 1, shadows: true }]);
    run(q, 40, 60_000);
    expect(q.current).toEqual({ pixelRatio: 0.75, shadows: false });
  });

  it('ignores the warm-up and long hitches such as a backgrounded tab', () => {
    const q = new AdaptiveQuality(2);
    expect(run(q, 40, 3500)).toEqual([]);
    for (let i = 0; i < 200; i++) q.frame(1000);
    expect(run(q, 16.7, 30_000)).toEqual([]);
    expect(q.level).toBe(0);
  });

  it('needs slowness to persist, not one bad window', () => {
    const q = new AdaptiveQuality(2);
    run(q, 16.7, 5000);
    run(q, 40, 2000);
    expect(run(q, 16.7, 20_000)).toEqual([]);
    expect(q.level).toBe(0);
  });
});
