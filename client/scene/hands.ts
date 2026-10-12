import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeParts } from './patron';

type Ring = { p: THREE.Vector3; rn: number; rb: number };

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Smooth lofted tube through `rings` (centre + two radii; frames are parallel-transported). Section is a
 * superellipse of exponent `e` (2 = ellipse). `round` closes the tip with a rounded cap, else a flat fan;
 * the start is always a flat fan (hidden inside the palm or sleeve).
 */
function loft(rings: Ring[], n: number, e: number, round: boolean): THREE.BufferGeometry {
  const pts = rings.map((r) => ({ ...r }));
  const tangents = pts.map((_r, i) => pts[Math.min(i + 1, pts.length - 1)].p.clone().sub(pts[Math.max(i - 1, 0)].p).normalize());
  if (round) {
    const last = pts[pts.length - 1];
    const t = tangents[tangents.length - 1];
    for (const phi of [0.55, 1.05]) {
      pts.push({ p: last.p.clone().addScaledVector(t, Math.min(last.rn, last.rb) * Math.sin(phi)), rn: last.rn * Math.cos(phi), rb: last.rb * Math.cos(phi) });
      tangents.push(t);
    }
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const ref = Math.abs(tangents[0].y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  let nrm = ref.clone().addScaledVector(tangents[0], -ref.dot(tangents[0])).normalize();
  const sp = (c: number) => Math.sign(c) * Math.abs(c) ** (2 / e);
  for (const [i, r] of pts.entries()) {
    const t = tangents[i];
    nrm = nrm.addScaledVector(t, -nrm.dot(t)).normalize();
    const bin = new THREE.Vector3().crossVectors(t, nrm);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const q = r.p.clone().addScaledVector(nrm, r.rn * sp(Math.cos(a))).addScaledVector(bin, r.rb * sp(Math.sin(a)));
      pos.push(q.x, q.y, q.z);
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k;
      const a2 = i * n + ((k + 1) % n);
      idx.push(a, a2, a + n, a2, a2 + n, a + n);
    }
  }
  const fan = (ringIdx: number, c: THREE.Vector3, flip: boolean) => {
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let k = 0; k < n; k++) {
      const a = ringIdx * n + k;
      const a2 = ringIdx * n + ((k + 1) % n);
      idx.push(...(flip ? [a2, a, ci] : [a, a2, ci]));
    }
  };
  fan(0, pts[0].p, true);
  const end = pts[pts.length - 1];
  fan(pts.length - 1, round ? end.p.clone().addScaledVector(tangents[tangents.length - 1], Math.min(end.rn, end.rb) * 0.5) : end.p, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tapered capsule-like tube through `path` with matching radii. */
function limb(path: THREE.Vector3[], radii: number[]): THREE.BufferGeometry {
  return loft(path.map((p, i) => ({ p, rn: radii[i], rb: radii[i] })), 10, 2, true);
}

/** Welded, smooth-shaded ellipsoid (position + normal only). */
function blob(rx: number, ry: number, rz: number, x: number, y: number, z: number, yaw = 0): THREE.BufferGeometry {
  const s = new THREE.SphereGeometry(1, 12, 8);
  s.deleteAttribute('uv');
  s.deleteAttribute('normal');
  s.scale(rx, ry, rz);
  s.rotateY(yaw);
  s.translate(x, y, z);
  const m = mergeVertices(s, 1e-5);
  s.dispose();
  m.computeVertexNormals();
  return m;
}

/** Finger path from a knuckle: each joint bends further down (cumulative `pitch`), fanned out by `yaw`. */
function fingerPath(x: number, y: number, z: number, yaw: number, lens: number[], pitch: number[]): THREE.Vector3[] {
  const pts = [v3(x - Math.sin(yaw) * 0.008, y, z - Math.cos(yaw) * 0.008), v3(x, y, z)];
  for (const [i, l] of lens.entries()) {
    const d = v3(Math.sin(yaw) * Math.cos(pitch[i]), -Math.sin(pitch[i]), Math.cos(yaw) * Math.cos(pitch[i]));
    pts.push(pts[pts.length - 1].clone().addScaledVector(d, l));
  }
  return pts;
}

// Proximal / middle / distal lengths per finger (index to little): middle longest, little shortest.
const FINGER_LENS = [
  [0.026, 0.016, 0.016],
  [0.03, 0.019, 0.017],
  [0.027, 0.018, 0.016],
  [0.021, 0.012, 0.014],
];

/**
 * One merged geometry per hand (a single draw call). 'flat' rests palm-down with fingers along +Z;
 * 'fist' is for the aiming arm (arm axis +Z). `side` is the hand's side of the body (-1 = the figure's right, -X).
 * Smooth-shaded position + normal only. Builds a new geometry each call: characters dispose their own.
 */
export function handGeometry(kind: 'flat' | 'fist', side: 1 | -1 = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Palm-ish box: rings of (z, half width, half height, centre y), bottom pinned at -0.02 (flat) so it rests on the table.
  const palm = (rows: number[][], e: number) =>
    parts.push(loft(rows.map(([z, w, h, cy]) => ({ p: v3(0, cy, z), rn: h, rb: w })), 14, e, false));

  if (kind === 'flat') {
    // Wrist stub, heel thicker than the knuckle line, widest at the knuckles.
    palm(
      [
        [-0.065, 0.024, 0.014, -0.006],
        [-0.035, 0.026, 0.014, -0.006],
        [-0.01, 0.033, 0.0165, -0.0035],
        [0.015, 0.039, 0.015, -0.005],
        [0.035, 0.042, 0.0125, -0.0075],
        [0.046, 0.041, 0.0115, -0.0085],
      ],
      3,
    );
    // Thenar pad toward the thumb side (the body's midline: opposite the hand's side).
    parts.push(blob(0.02, 0.012, 0.027, -side * 0.024, -0.008, -0.012, -side * 0.3));
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.02;
      const yaw = (i - 1.5) * 0.05;
      const k = i === 3 ? 0.88 : 1;
      parts.push(
        limb(fingerPath(x, 0, 0.04, yaw, FINGER_LENS[i], [0.04, 0.25, 0.5]), [0.0095 * k, 0.0095 * k, 0.0085 * k, 0.0075 * k, 0.006 * k]),
      );
      parts.push(blob(0.008 * k, 0.005, 0.007, x, 0.006, 0.037, yaw));
    }
    // Thumb: two segments angled out from the palm side and slightly down.
    const t0 = v3(-side * 0.028, -0.009, -0.012);
    const t1 = v3(-side * 0.048, -0.011, 0.012);
    const t2 = v3(-side * 0.06, -0.013, 0.035);
    parts.push(limb([t0.clone().lerp(t1, -0.3), t0, t1, t2], [0.0105, 0.0105, 0.0095, 0.0075]));
  } else {
    palm(
      [
        [-0.065, 0.024, 0.02, 0],
        [-0.035, 0.03, 0.024, 0],
        [0, 0.036, 0.027, 0],
        [0.03, 0.037, 0.026, 0],
      ],
      2.6,
    );
    // Four fingers folded into the palm: knuckle on top, over the front, tip tucked back under.
    for (let i = 0; i < 4; i++) {
      const x = -side * (0.03 - i * 0.02);
      const k = i === 3 ? 0.9 : 1;
      parts.push(
        limb(
          [v3(x, 0.02, 0), v3(x, 0.027, 0.034), v3(x, 0.02, 0.058), v3(x, -0.004, 0.063), v3(x, -0.018, 0.047)],
          [0.0095 * k, 0.0095 * k, 0.0085 * k, 0.0078 * k, 0.0066 * k],
        ),
      );
    }
    // Thumb wraps across the front of the fingers from the -side side.
    parts.push(
      limb(
        [v3(-side * 0.034, -0.002, 0.005), v3(-side * 0.04, -0.008, 0.04), v3(-side * 0.026, -0.012, 0.072), v3(-side * 0.005, -0.012, 0.077)],
        [0.011, 0.0105, 0.009, 0.0075],
      ),
    );
  }
  return mergeParts(parts);
}
