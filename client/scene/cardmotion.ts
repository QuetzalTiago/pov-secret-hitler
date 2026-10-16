// Card flights for the table (deal, slam, flip, stamp): tweens that land on a Mover's live target.
import * as THREE from 'three';
import { Tweens, Tween, arcPoint, ease, tweens as sharedTweens, type Ease } from './tween';
import type { Mover } from './world';

export const DEAL = { dur: 0.5, gap: 0.12, arc: 0.32 };
export const SLAM = { lift: 0.13, liftHeight: 0.09, drop: 0.09, settle: 0.22, squash: 1.18 };
export const FLIP = { dur: 0.42, gap: 0.08, start: 0.1, arc: 0.12 };
export const STAMP = { fly: 0.42, hover: 0.1, drop: 0.11, settle: 0.26, flash: 0.6, lift: 0.14, squash: 1.22 };

const STAMP_ARC = 0.25;
const SQUASH_Y = 0.55;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Position in the reveal sequence: your own seat flips first, then around the table. */
export function revealOrder(seat: number, me: number, n: number): number {
  return (seat - me + n) % n;
}

/** Seconds before `seat` flips its card. */
export function revealDelay(seat: number, me: number, n: number): number {
  return FLIP.start + FLIP.gap * revealOrder(seat, me, n);
}

/** Seconds from the start of a stamp until the card touches the board. */
export function stampImpactAt(): number {
  return STAMP.fly + STAMP.hover + STAMP.drop;
}

/** How a pile's drawn count moves from `from` to `to`; null when unchanged. */
export function pileMotion(from: number, to: number): { dur: number; delay: number; ease: Ease } | null {
  if (from === to) return null;
  if (to < from) return { dur: 0.35, delay: 0, ease: ease.inOutCubic };
  if (to - from > 3) return { dur: 0.6, delay: 0.3, ease: ease.outBack };
  return { dur: 0.25, delay: 0, ease: ease.outQuad };
}

/** Snap the card onto its target, squashed flat as if it just landed. */
function land(obj: THREE.Object3D, mover: Mover, squash: number) {
  obj.position.copy(mover.pos);
  obj.quaternion.copy(mover.quat);
  obj.scale.set(squash * mover.scale, SQUASH_Y * mover.scale, squash * mover.scale);
}

/** Tween the squashed scale back to uniform. */
function settle(obj: THREE.Object3D, mover: Mover, dur: number, tw: Tweens): Tween {
  const s = mover.scale;
  return tw.tween(obj.scale, { x: s, y: s, z: s }, { dur, ease: ease.outBack, hold: mover });
}

/** Fly from `from` to the Mover's live target along an arc, waiting `delay` seconds first. */
export function dealFlight(
  obj: THREE.Object3D, mover: Mover, from: THREE.Vector3, delay: number, tw: Tweens = sharedTweens,
): Tween {
  obj.position.copy(from);
  const start = from.clone();
  const startQ = obj.quaternion.clone();
  const s0 = obj.scale.x;
  return tw.tween({ k: 0 }, { k: 1 }, {
    dur: DEAL.dur, delay, ease: ease.inOutCubic, hold: mover, holdFromStart: true,
    onUpdate: (e) => {
      arcPoint(start, mover.pos, DEAL.arc, e, obj.position);
      obj.quaternion.slerpQuaternions(startQ, mover.quat, e);
      obj.scale.setScalar(s0 + (mover.scale - s0) * e);
    },
  });
}

/** Lift, drop and squash the card onto its target, then settle; onImpact fires on the landing. */
export function slam(
  obj: THREE.Object3D, mover: Mover, opts: { delay?: number; onImpact?: () => void }, tw: Tweens = sharedTweens,
): Tween {
  const p0 = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const startQ = new THREE.Quaternion();
  const midQ = new THREE.Quaternion();
  let first = true;
  return tw.sequence([
    () => tw.tween({ k: 0 }, { k: 1 }, {
      dur: SLAM.lift, delay: opts.delay ?? 0, ease: ease.outQuad, hold: mover, holdFromStart: true,
      onUpdate: (e) => {
        if (first) {
          first = false;
          p0.copy(obj.position);
          startQ.copy(obj.quaternion);
        }
        lift.copy(p0).lerp(mover.pos, 0.3).y += SLAM.liftHeight;
        midQ.slerpQuaternions(startQ, mover.quat, 0.5);
        obj.position.lerpVectors(p0, lift, e);
        obj.quaternion.slerpQuaternions(startQ, midQ, e);
      },
    }),
    () => tw.tween({ k: 0 }, { k: 1 }, {
      dur: SLAM.drop, ease: ease.inCubic, hold: mover,
      onUpdate: (e) => {
        obj.position.lerpVectors(lift, mover.pos, e);
        obj.quaternion.slerpQuaternions(midQ, mover.quat, e);
      },
      onDone: () => {
        land(obj, mover, SLAM.squash);
        opts.onImpact?.();
      },
    }),
    () => settle(obj, mover, SLAM.settle, tw),
  ]);
}

/** Flip-reveal: arc from where the card is now to the Mover's live target. */
export function flipTo(obj: THREE.Object3D, mover: Mover, delay: number, tw: Tweens = sharedTweens): Tween {
  const start = obj.position.clone();
  const startQ = obj.quaternion.clone();
  const s0 = obj.scale.x;
  return tw.tween({ k: 0 }, { k: 1 }, {
    dur: FLIP.dur, delay, ease: ease.inOutCubic, hold: mover, holdFromStart: true,
    onUpdate: (e) => {
      arcPoint(start, mover.pos, FLIP.arc, e, obj.position);
      obj.quaternion.slerpQuaternions(startQ, mover.quat, e);
      obj.scale.setScalar(s0 + (mover.scale - s0) * e);
    },
  });
}

/** Fly above the target, hover, stamp down with a squash and flash, then settle. onDone fires when the flash ends. */
export function stamp(
  obj: THREE.Object3D, mover: Mover,
  opts: { onImpact?: () => void; onFlash?: (v: number) => void; onDone?: () => void },
  tw: Tweens = sharedTweens,
): Tween {
  const start = obj.position.clone();
  const startQ = obj.quaternion.clone();
  const s0 = obj.scale.x;
  const hoverAt = (out: THREE.Vector3) => {
    out.copy(mover.pos).y += STAMP.lift;
    return out;
  };
  return tw.sequence([
    () => tw.tween({ k: 0 }, { k: 1 }, {
      dur: STAMP.fly, ease: ease.inOutCubic, hold: mover,
      onUpdate: (e) => {
        arcPoint(start, hoverAt(tmpA), STAMP_ARC, e, obj.position);
        obj.quaternion.slerpQuaternions(startQ, mover.quat, e);
        obj.scale.setScalar(s0 + (mover.scale - s0) * e);
      },
    }),
    () => tw.tween({ k: 0 }, { k: 1 }, {
      dur: STAMP.hover, hold: mover,
      onUpdate: () => {
        obj.position.copy(hoverAt(tmpB));
        obj.quaternion.copy(mover.quat);
      },
    }),
    () => tw.tween({ k: 0 }, { k: 1 }, {
      dur: STAMP.drop, ease: ease.inCubic, hold: mover,
      onUpdate: (e) => {
        obj.position.copy(hoverAt(tmpA)).lerp(mover.pos, e);
        obj.quaternion.copy(mover.quat);
      },
      onDone: () => {
        land(obj, mover, STAMP.squash);
        opts.onFlash?.(1);
        opts.onImpact?.();
      },
    }),
    () => {
      tw.tween({ k: 0 }, { k: 1 }, {
        dur: STAMP.flash, ease: ease.linear,
        onUpdate: (e) => opts.onFlash?.(1 - e),
        onDone: opts.onDone,
      });
      return settle(obj, mover, STAMP.settle, tw);
    },
  ]);
}
