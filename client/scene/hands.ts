import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * One merged geometry per hand (a single draw call). 'flat' rests palm-down with fingers along +Z;
 * 'fist' is for the aiming arm (arm axis +Z). `side` is the hand's side of the body (-1 = the figure's right, -X).
 * Builds a new geometry each call: characters dispose their own.
 */
export function handGeometry(kind: 'flat' | 'fist', side: 1 | -1 = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ellipsoid = (sx: number, sy: number, sz: number) => {
    const g = new THREE.SphereGeometry(0.5, 7, 5);
    g.scale(sx, sy, sz);
    parts.push(g);
  };
  // Capsule laid along Z (or X for knuckles), yawed by `yaw`, then placed.
  const capsule = (r: number, len: number, yaw: number, x: number, y: number, z: number, alongX = false) => {
    const g = new THREE.CapsuleGeometry(r, len, 1, 5);
    g.rotateX(Math.PI / 2);
    if (alongX) g.rotateY(Math.PI / 2);
    g.rotateY(yaw);
    g.translate(x, y, z);
    parts.push(g);
  };

  if (kind === 'flat') {
    ellipsoid(0.085, 0.04, 0.08);
    const lens = [0.038, 0.048, 0.042, 0.032];
    for (let i = 0; i < 4; i++) {
      // Finger roots sink just inside the palm's front edge (z 0.04) so there is no gap.
      capsule(0.01, lens[i], (i - 1.5) * 0.06, (i - 1.5) * 0.02, -0.004, 0.035 + lens[i] / 2);
    }
    // Palm down, the thumb sits toward the body's midline: opposite the hand's side.
    capsule(0.011, 0.03, -side * 0.9, -side * 0.05, -0.004, 0.02);
  } else {
    ellipsoid(0.075, 0.09, 0.09);
    for (let i = 0; i < 4; i++) capsule(0.012, 0.012, 0, (i - 1.5) * 0.02, 0.004, 0.05, true);
    capsule(0.013, 0.03, -side * 0.5, -side * 0.04, -0.01, 0.04);
  }

  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  if (!merged) throw new Error('handGeometry: mergeGeometries failed');
  return merged;
}
