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

  it('ignores the warm-up and an isolated long hitch such as a backgrounded tab', () => {
    const q = new AdaptiveQuality(2);
    expect(run(q, 40, 3500)).toEqual([]);
    q.frame(1000);
    expect(run(q, 16.7, 30_000)).toEqual([]);
    expect(q.level).toBe(0);
  });

  it('steps a very slow machine (300 ms frames) all the way down', () => {
    const q = new AdaptiveQuality(2);
    let frames = 0;
    while (q.level < q.steps.length - 1 && frames < 200) {
      q.frame(300);
      frames++;
    }
    expect(q.current).toEqual({ pixelRatio: 0.75, shadows: false });
    expect(frames).toBeLessThan(200);
  });

  it('does not step down for a single huge hitch among fast frames', () => {
    const q = new AdaptiveQuality(2);
    run(q, 16.7, 5000);
    q.frame(5000);
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

  it('high and low pin their step and never adapt', () => {
    const high = new AdaptiveQuality(2, 'high');
    expect(run(high, 40, 60_000)).toEqual([]);
    expect(high.current).toEqual({ pixelRatio: 1.5, shadows: true });
    const low = new AdaptiveQuality(2, 'low');
    expect(low.current).toEqual({ pixelRatio: 0.75, shadows: false });
  });

  it('switching back to auto starts over from the top', () => {
    const q = new AdaptiveQuality(2, 'low');
    expect(q.setMode('auto')).toEqual({ pixelRatio: 1.5, shadows: true });
    expect(run(q, 40, 9000)).toEqual([{ pixelRatio: 1, shadows: true }]);
  });
});
