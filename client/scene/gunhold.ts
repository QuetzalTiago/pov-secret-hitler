import * as THREE from 'three';
import { GUN_GRIP, GUN_SCALE } from './gun';

export interface FistOnGun {
  /** World position and orientation of the fist mesh (its geometry is the turned fist, knuckles -Z, wrist +Z). */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** World point where the forearm and cuff end: the fist's wrist. */
  wrist: THREE.Vector3;
}

/**
 * Where the finger loop of the turned fist (handGeometry('fist') after rotateY(PI): knuckles -Z, wrist +Z, back of
 * the fingers +Y, thumb -X) closes around a handle. The loop in the geometry runs from y 0.02 over the front (z 0.058)
 * to the tips at y -0.018, z 0.047, so its hollow sits at about y 0.005, z 0.035 before the turn: z -0.035 after.
 */
const FIST_GRIP = new THREE.Vector3(0, 0.005, -0.035);
const FIST_WRIST_Z = 0.065; // the wrist end of the fist geometry
/**
 * Roll about the arm axis: the finger stack (fist X, thumb at -X) runs down the grip with the thumb on top, the back of
 * the fingers faces the gun's right and the knuckles point down the barrel with the wrist behind.
 */
const ROLL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
const HOLD = GUN_GRIP.clone().multiplyScalar(GUN_SCALE); // gun space, scaled
const v = new THREE.Vector3();

/**
 * The right fist wrapped around the pistol's grip, given the gun's world position and orientation:
 * the fist is rolled so its thumb lies along the top of the grip and slid so its finger loop surrounds GUN_GRIP.
 * `handScale` is the fist mesh's scale.
 */
export function fistOnGun(
  gunPos: THREE.Vector3,
  gunQuat: THREE.Quaternion,
  handScale: number,
  out: FistOnGun = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), wrist: new THREE.Vector3() },
): FistOnGun {
  out.quaternion.copy(gunQuat).multiply(ROLL);
  // Mesh origin (gun space) = hold point - rotated finger-loop centre; then to world.
  v.copy(FIST_GRIP).multiplyScalar(handScale).applyQuaternion(ROLL);
  out.position.copy(HOLD).sub(v).applyQuaternion(gunQuat).add(gunPos);
  out.wrist.set(0, 0, FIST_WRIST_Z * handScale).applyQuaternion(out.quaternion).add(out.position);
  return out;
}
