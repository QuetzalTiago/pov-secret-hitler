import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('../client/scene/textures', async (orig) => ({
  ...(await orig<typeof import('../client/scene/textures')>()),
  cardBack: () => new THREE.Texture(),
}));

import {
  DEAL, FLIP, SLAM, STAMP, dealFlight, flipTo, pileMotion, revealDelay, revealOrder, slam, stamp, stampImpactAt,
} from '../client/scene/cardmotion';
import { Pile } from '../client/scene/props';
import { Tweens, ease } from '../client/scene/tween';
import { Mover } from '../client/scene/world';

const DT = 1 / 60;
function run(tw: Tweens, seconds: number, each?: (t: number) => void) {
  const n = Math.round(seconds / DT);
  for (let i = 1; i <= n; i++) {
    tw.update(DT);
    each?.(i * DT);
  }
}

function setup() {
  const obj = new THREE.Object3D();
  const mover = new Mover(obj);
  mover.pos.set(1, 0.5, -2);
  mover.quat.setFromEuler(new THREE.Euler(0.3, 1, 0));
  return { obj, mover, tw: new Tweens() };
}

describe('helpers', () => {
  it('reveals your own seat first and wraps around', () => {
    expect(revealOrder(2, 2, 5)).toBe(0);
    expect(revealDelay(0, 0, 5)).toBe(FLIP.start);
    expect(revealOrder(2, 3, 5)).toBe(4);
    expect(revealDelay(2, 3, 5)).toBeCloseTo(FLIP.start + FLIP.gap * 4);
  });

  it('pileMotion picks a curve per direction', () => {
    expect(pileMotion(4, 4)).toBeNull();
    expect(pileMotion(10, 3)).toEqual({ dur: 0.35, delay: 0, ease: ease.inOutCubic });
    expect(pileMotion(0, 11)).toEqual({ dur: 0.6, delay: 0.3, ease: ease.outBack });
    expect(pileMotion(4, 7)).toEqual({ dur: 0.25, delay: 0, ease: ease.outQuad });
  });

  it('stampImpactAt sums fly, hover and drop', () => {
    expect(stampImpactAt()).toBe(STAMP.fly + STAMP.hover + STAMP.drop);
  });
});

describe('dealFlight', () => {
  it('stays at from during the delay, arcs, and lands on the live target', () => {
    const { obj, mover, tw } = setup();
    const from = new THREE.Vector3(0, 0.2, 3);
    dealFlight(obj, mover, from, 0.5, tw);
    expect(mover.hold).toBe(1);
    run(tw, 0.4, () => mover.update(DT));
    expect(obj.position.equals(from)).toBe(true);
    let maxY = -Infinity;
    run(tw, 0.1 + DEAL.dur / 2, () => {
      mover.update(DT);
      maxY = Math.max(maxY, obj.position.y);
    });
    expect(maxY).toBeGreaterThan(Math.max(from.y, mover.pos.y));
    mover.pos.set(-1, 0.4, 0.5);
    run(tw, DEAL.dur, () => mover.update(DT));
    expect(obj.position.distanceTo(mover.pos)).toBeLessThan(1e-6);
    expect(obj.quaternion.angleTo(mover.quat)).toBeLessThan(1e-6);
    expect(mover.hold).toBe(0);
  });
});

describe('slam', () => {
  it('impacts once after lift+drop, squashes, then settles', () => {
    const { obj, mover, tw } = setup();
    let hits = 0;
    let at = 0;
    let squashed: THREE.Vector3 | null = null;
    slam(obj, mover, { onImpact: () => { hits++; squashed = obj.scale.clone(); } }, tw);
    run(tw, 0.5, (t) => {
      if (hits === 1 && !at) at = t;
    });
    expect(hits).toBe(1);
    expect(at).toBeGreaterThan(SLAM.lift + SLAM.drop - 2 * DT);
    expect(at).toBeLessThan(SLAM.lift + SLAM.drop + 3 * DT);
    expect(squashed!.y).toBeLessThan(1);
    expect(squashed!.x).toBeGreaterThan(1);
    expect(obj.scale.x).toBeCloseTo(1);
    expect(obj.scale.y).toBeCloseTo(1);
    expect(obj.scale.z).toBeCloseTo(1);
    expect(mover.hold).toBe(0);
    expect(obj.position.distanceTo(mover.pos)).toBeLessThan(1e-6);
  });
});

describe('flipTo', () => {
  it('ends on the target with the mover scale', () => {
    const { obj, mover, tw } = setup();
    mover.scale = 1.5;
    flipTo(obj, mover, 0.1, tw);
    expect(mover.hold).toBe(1);
    run(tw, 0.1 + FLIP.dur + 2 * DT);
    expect(obj.position.distanceTo(mover.pos)).toBeLessThan(1e-6);
    expect(obj.quaternion.angleTo(mover.quat)).toBeLessThan(1e-6);
    expect(obj.scale.x).toBe(1.5);
    expect(mover.hold).toBe(0);
  });
});

describe('stamp', () => {
  it('impacts near stampImpactAt, flashes 1 to 0, calls onDone after the flash', () => {
    const { obj, mover, tw } = setup();
    const flashes: number[] = [];
    let hits = 0;
    let done = 0;
    let impactAt = 0;
    let doneAt = 0;
    stamp(obj, mover, {
      onImpact: () => { hits++; },
      onFlash: (v) => flashes.push(v),
      onDone: () => { done++; expect(hits).toBe(1); },
    }, tw);
    run(tw, 1.5, (t) => {
      if (hits && !impactAt) impactAt = t;
      if (done && !doneAt) doneAt = t;
    });
    expect(hits).toBe(1);
    expect(done).toBe(1);
    expect(Math.abs(impactAt - stampImpactAt())).toBeLessThan(3 * DT);
    expect(Math.abs(doneAt - (stampImpactAt() + STAMP.flash))).toBeLessThan(4 * DT);
    expect(flashes[0]).toBe(1);
    expect(flashes[flashes.length - 1]).toBe(0);
    expect(obj.position.distanceTo(mover.pos)).toBeLessThan(1e-6);
    expect(obj.scale.x).toBeCloseTo(1);
    expect(mover.hold).toBe(0);
  });

  it('cancelling mid-flight releases the mover', () => {
    const { obj, mover, tw } = setup();
    const h = stamp(obj, mover, {}, tw);
    run(tw, 0.2);
    expect(mover.hold).toBe(1);
    h.cancel();
    expect(mover.hold).toBe(0);
  });
});

describe('Pile', () => {
  let tw: Tweens;
  let pile: Pile;
  const stackOf = (p: Pile) => (p as unknown as { stack: THREE.Mesh }).stack;
  beforeEach(() => {
    tw = new Tweens();
    pile = new Pile('POLICY', new THREE.Vector3(), tw);
  });

  it('snaps first, animates changes, hides at zero', () => {
    pile.setCount(17);
    expect(stackOf(pile).scale.y).toBe(17 * 0.0028);
    pile.setCount(2);
    run(tw, 0.15, () => pile.setCount(2));
    const mid = stackOf(pile).scale.y;
    expect(mid).toBeLessThan(17 * 0.0028);
    expect(mid).toBeGreaterThan(2 * 0.0028);
    run(tw, 0.5, () => pile.setCount(2));
    expect(stackOf(pile).scale.y).toBeCloseTo(2 * 0.0028);
    pile.setCount(0);
    run(tw, 0.5, () => pile.setCount(0));
    expect(stackOf(pile).visible).toBe(false);
  });

  it('snap jumps to the target', () => {
    pile.setCount(10);
    pile.setCount(3);
    pile.snap();
    expect(stackOf(pile).scale.y).toBe(3 * 0.0028);
    expect(tw.active).toBe(0);
  });
});
