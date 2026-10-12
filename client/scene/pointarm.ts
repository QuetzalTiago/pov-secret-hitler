import * as THREE from 'three';

export interface PointingArm {
  elbow: THREE.Vector3;
  grip: THREE.Vector3;
  /** Unit forearm direction, elbow to grip. */
  dir: THREE.Vector3;
}

const BASE = new THREE.Vector3(0.15, -0.14, -0.45); // right hand, above the prompt banner
const FOREARM = 0.42;
const SHIFT = 0.22; // how far the hand leans toward the target's side, per unit of slope
const MIN_RISE = 0.005; // the forearm always climbs a little: the arm comes up from below, never from above the eye
const d = new THREE.Vector3();

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

/**
 * The raised right arm pointing at `targetLocal` (camera space, -Z ahead): the forearm runs along
 * (nearly) the line to the target so the wrist stays straight, and the hand stays in view.
 */
export function pointingArm(targetLocal: THREE.Vector3, out: PointingArm = { elbow: new THREE.Vector3(), grip: new THREE.Vector3(), dir: new THREE.Vector3() }): PointingArm {
  d.copy(targetLocal).sub(BASE).normalize();
  const fwd = Math.max(-d.z, 0.1);
  out.grip.set(BASE.x + clamp((d.x / fwd) * SHIFT, 0.12), BASE.y + clamp((d.y / fwd) * SHIFT, 0.145), BASE.z);
  d.copy(targetLocal).sub(out.grip).normalize();
  if (d.y < MIN_RISE) {
    d.y = MIN_RISE;
    const xz = Math.hypot(d.x, d.z) || 1;
    const s = Math.sqrt(1 - MIN_RISE * MIN_RISE) / xz;
    d.x *= s;
    d.z *= s;
  }
  out.dir.copy(d);
  out.elbow.copy(out.grip).addScaledVector(d, -FOREARM);
  return out;
}
