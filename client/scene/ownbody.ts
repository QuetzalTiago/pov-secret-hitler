import * as THREE from 'three';
import { cylinderBetween, limbGeometry, mergeParts } from './patron';

// Pure geometry for your own first-person arms: smooth coat sleeves, white shirt cuffs and the pointing finger
// (no materials, no scene). Same conventions as patron.ts: non-indexed, smooth normals, no uv.

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const CUFF_LEN = 0.025;

/** A thin ring (torus) around `dir` at `at`: the rounded rim of a sleeve hem. */
function ringAt(at: THREE.Vector3, dir: THREE.Vector3, r: number, tube: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(r, tube, 8, 20).rotateX(Math.PI / 2);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir));
  return g.translate(at.x, at.y, at.z);
}

/** A smooth tapered coat sleeve from `from` to `to` with a slightly flared, rounded hem at `to`. */
export function sleeveGeometry(from: THREE.Vector3, to: THREE.Vector3, rFrom: number, rTo: number): THREE.BufferGeometry {
  const dir = to.clone().sub(from).normalize();
  const hemStart = to.clone().addScaledVector(dir, -0.045);
  const flare = rTo * 1.09;
  // Open at the hem (no rounded cap) so the shirt cuff shows past it; the elbow end gets a joint sphere.
  return mergeParts([
    new THREE.SphereGeometry(rFrom, 20, 12).translate(from.x, from.y, from.z),
    cylinderBetween(from, hemStart, rFrom, rTo, 20, true),
    cylinderBetween(hemStart, to, rTo, flare, 20, true),
    ringAt(to, dir, flare, 0.0045),
  ]);
}

/** A white shirt cuff band centred on `at` (the sleeve end), axis along `dir`; it pokes half its length out toward the hand. */
export function cuffGeometry(at: THREE.Vector3, dir: THREE.Vector3, r: number): THREE.BufferGeometry {
  const half = dir.clone().normalize().multiplyScalar(CUFF_LEN / 2);
  return mergeParts([cylinderBetween(at.clone().sub(half), at.clone().add(half), r, r, 20, true)]);
}

/** A sleeve along +Y from y 0 to 1 (open ended, tapering rFrom -> rTo), for forearms stretched by scale.y. */
export function unitSleeveGeometry(rFrom: number, rTo: number): THREE.BufferGeometry {
  return mergeParts([new THREE.CylinderGeometry(rTo, rFrom, 1, 20, 1, true).translate(0, 0.5, 0)]);
}

/** Pointing index finger along -Z (tip toward -Z, slight bend), centred near the origin. */
export function pointingFingerGeometry(): THREE.BufferGeometry {
  const a = new THREE.Vector3(0, 0, 0.04);
  const b = new THREE.Vector3(0, 0.003, -0.002);
  const c = new THREE.Vector3(0, -0.004, -0.038);
  return mergeParts([limbGeometry(a, b, 0.0095, 0.0085), limbGeometry(b, c, 0.0085, 0.007)]);
}
