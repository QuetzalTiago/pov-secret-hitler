import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Tweens, arcPoint, ease } from '../client/scene/tween';
import { Mover } from '../client/scene/world';

describe('ease', () => {
  for (const [name, fn] of Object.entries(ease)) {
    it(`${name} hits 0 and 1 exactly`, () => {
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    });
  }

  it('outBack overshoots', () => {
    let max = 0;
    for (let t = 0.01; t < 1; t += 0.01) max = Math.max(max, ease.outBack(t));
    expect(max).toBeGreaterThan(1);
  });

  it('outBounce stays within [0,1]', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const v = ease.outBounce(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('Tweens', () => {
  it('counts down the delay, then applies leftover dt', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    let done = 0;
    tw.tween(o, { x: 10 }, { dur: 1, delay: 0.5, ease: ease.linear, onDone: () => done++ });
    tw.update(0.4);
    expect(o.x).toBe(0);
    tw.update(0.6);
    expect(o.x).toBeCloseTo(5);
    tw.update(0.5);
    expect(o.x).toBe(10);
    expect(done).toBe(1);
    tw.update(1);
    expect(done).toBe(1);
    expect(tw.active).toBe(0);
  });

  it('applies leftover dt after the delay', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    tw.tween(o, { x: 10 }, { dur: 1, delay: 0.2, ease: ease.linear });
    tw.update(0.3);
    expect(o.x).toBeCloseTo(1);
  });

  it('captures the start value after the delay', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    tw.tween(o, { x: 10 }, { dur: 1, delay: 0.5, ease: ease.linear });
    tw.update(0.25);
    o.x = 4;
    tw.update(0.25 + 0.5);
    expect(o.x).toBeCloseTo(7);
  });

  it('arc passes through the lifted midpoint', () => {
    const out = arcPoint({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 1, 0.5, { x: 0, y: 0, z: 0 });
    expect(out.x).toBeCloseTo(1);
    expect(out.y).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);

    const tw = new Tweens();
    const p = new THREE.Vector3();
    tw.arc(p, { x: 2, y: 0, z: 0 }, 1, { dur: 1, ease: ease.linear });
    tw.update(0.5);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1);
    expect(p.z).toBeCloseTo(0);
    tw.update(0.5);
    expect(p.x).toBe(2);
    expect(p.y).toBe(0);
    expect(p.z).toBe(0);
  });

  it('staggers starts in order', () => {
    const tw = new Tweens();
    const order: number[] = [];
    const items = [{ x: 0 }, { x: 0 }, { x: 0 }];
    const handles = tw.stagger(items, 0.1, (it, i, delay) =>
      tw.tween(it, { x: 1 }, { dur: 0.05, delay, onDone: () => order.push(i) }));
    expect(handles).toHaveLength(3);
    let t = 0;
    let item1DoneAt01 = false;
    while (tw.active > 0 && t < 5) {
      tw.update(0.02);
      t += 0.02;
      if (t <= 0.1 + 1e-9 && order.includes(1)) item1DoneAt01 = true;
    }
    expect(order).toEqual([0, 1, 2]);
    expect(item1DoneAt01).toBe(false);
  });

  it('sequence runs steps one after another', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    const seq = tw.sequence([
      () => tw.tween(o, { x: 10 }, { dur: 1, ease: ease.linear }),
      () => tw.tween(o, { x: 20 }, { dur: 1, ease: ease.linear }),
    ]);
    tw.update(0.5);
    expect(o.x).toBeCloseTo(5);
    expect(seq.done).toBe(false);
    tw.update(0.5);
    expect(o.x).toBe(10);
    // second step was created inside onDone: it must not advance in the same update
    tw.update(0.5);
    expect(o.x).toBeCloseTo(15);
    expect(seq.done).toBe(false);
    tw.update(0.5);
    expect(o.x).toBe(20);
    expect(seq.done).toBe(true);
    expect(tw.active).toBe(0);
  });

  it('sequence cancel stops the chain', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    let second = false;
    const seq = tw.sequence([
      () => tw.tween(o, { x: 10 }, { dur: 1, ease: ease.linear }),
      () => { second = true; return tw.tween(o, { x: 20 }, { dur: 1 }); },
    ]);
    tw.update(0.5);
    seq.cancel();
    tw.update(5);
    expect(second).toBe(false);
    expect(o.x).toBeCloseTo(5);
    expect(tw.active).toBe(0);
  });

  it('hold is balanced across delay, run, finish and cancel', () => {
    const tw = new Tweens();
    const h = { hold: 0 };
    const o = { x: 0 };
    tw.tween(o, { x: 1 }, { dur: 1, delay: 0.5, hold: h });
    expect(h.hold).toBe(0);
    tw.update(0.25);
    expect(h.hold).toBe(0);
    tw.update(0.5);
    expect(h.hold).toBe(1);
    tw.update(1);
    expect(h.hold).toBe(0);

    const t2 = tw.tween(o, { x: 5 }, { dur: 1, hold: h });
    tw.update(0.1);
    expect(h.hold).toBe(1);
    t2.cancel();
    expect(h.hold).toBe(0);
    t2.cancel();
    expect(h.hold).toBe(0);

    const t3 = tw.tween(o, { x: 5 }, { dur: 1, delay: 1, hold: h });
    t3.cancel();
    tw.update(2);
    expect(h.hold).toBe(0);
  });

  it('cancelTarget stops tweens without onDone', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    let done = 0;
    tw.tween(o, { x: 10 }, { dur: 1, onDone: () => done++ });
    tw.update(0.2);
    tw.cancelTarget(o);
    tw.update(2);
    expect(done).toBe(0);
    expect(tw.active).toBe(0);
    expect(o.x).toBeLessThan(10);
  });
});

describe('Mover hold', () => {
  it('does not lerp while held', () => {
    const obj = new THREE.Object3D();
    const m = new Mover(obj);
    m.pos.set(1, 0, 0);
    m.hold = 1;
    m.update(0.1);
    expect(obj.position.x).toBe(0);
    m.hold = 0;
    m.update(0.1);
    expect(obj.position.x).toBeGreaterThan(0);
  });
});
