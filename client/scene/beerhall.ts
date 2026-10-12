import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeParts, paintGeometry } from './patron';

// Pure geometry for the 1930s Berlin beer-hall dressing of the bar room (no materials, no textures, no scene).
// Every builder returns ONE merged, non-indexed geometry (the scene is draw-call bound) in room coordinates
// (floor y=0, walls at x=+-5 and z=+-5, ceiling y=3.6) and builds a new geometry per call: the caller owns and
// disposes it.

const COUNTER_TOP = 1.05;
const SHELF_Z = -4.85;
const BOTTLE_COLOURS = [0x3f6b2a, 0x7a3b12, 0x8c8f99, 0x5a1a14, 0x2d4b6b, 0xa2742a];
const RADIO_X = 2.2;

type Sconce = { x: number; y: number; z: number; dir: 1 | -1 };
type Pendant = { x: number; z: number; shadeBottom: number };

/** Wall sconces: centre of the backplate on the wall, and `dir`, the x direction into the room. */
export const SCONCE_POSITIONS: ReadonlyArray<Sconce> = [
  { x: -4.97, y: 2.3, z: -3, dir: 1 },
  { x: -4.97, y: 2.3, z: 0, dir: 1 },
  { x: -4.97, y: 2.3, z: 3, dir: 1 },
  { x: 4.97, y: 2.3, z: -2.6, dir: -1 },
  { x: 4.97, y: 2.3, z: 0.6, dir: -1 },
  { x: 4.97, y: 2.3, z: 3, dir: -1 },
];

/** Pendant lamps over the bar: x/z of the cord and `shadeBottom`, the y of the shade's lower rim. */
export const PENDANT_POSITIONS: ReadonlyArray<Pendant> = [
  { x: -2, z: -4.1, shadeBottom: 2.3 },
  { x: 0, z: -4.1, shadeBottom: 2.3 },
  { x: 2, z: -4.1, shadeBottom: 2.3 },
];

const SHADE_H = 0.18;
const CORD_TOP = 3.55;
const SCONCE_GLASS_R = 0.06;
const PENDANT_BULB_R = 0.05;

/** Rotate (x, then y, then z), translate and paint a part in one go. */
function placed(
  g: THREE.BufferGeometry,
  hex: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paintGeometry(g, hex);
}

/** The back-bar bottles (22 per shelf row, a few gaps, varied heights and colours), each with a neck; vertex-coloured. */
export function bottlesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let row = 0; row < 3; row++) {
    for (let b = 0; b < 22; b++) {
      if ((b * 7 + row * 3) % 5 === 0) continue;
      const h = 0.22 + ((b * 13 + row) % 5) * 0.04;
      const x = -2.6 + b * 0.25;
      if (row === 2 && Math.abs(x - RADIO_X) < 0.25) continue; // the radio stands here
      const base = 1.48 + row * 0.55;
      const hex = BOTTLE_COLOURS[(b + row) % BOTTLE_COLOURS.length];
      parts.push(placed(new THREE.CylinderGeometry(0.035, 0.045, h, 8), hex, x, base + h / 2, SHELF_Z));
      parts.push(placed(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), hex, x, base + h + 0.03, SHELF_Z));
    }
  }
  return mergeParts(parts);
}

/** A beer stein standing on the counter at x: stoneware body, pewter lid disc and a half-torus handle. */
function steinParts(x: number, z: number): THREE.BufferGeometry[] {
  const y = COUNTER_TOP;
  return [
    placed(new THREE.CylinderGeometry(0.042, 0.048, 0.14, 10), 0x8a7f6a, x, y + 0.07, z),
    placed(new THREE.CylinderGeometry(0.047, 0.047, 0.015, 10), 0x6d6d70, x, y + 0.1475, z),
    placed(new THREE.TorusGeometry(0.035, 0.009, 5, 8, Math.PI), 0x8a7f6a, x + 0.045, y + 0.07, z, 0, 0, -Math.PI / 2),
  ];
}

/** A barrel lying along x with its centre at (x, y, z): lathe bulge plus two iron hoops. */
function barrelParts(x: number, y: number, z: number): THREE.BufferGeometry[] {
  const profile = [
    [0.001, -0.35],
    [0.25, -0.35],
    [0.285, -0.17],
    [0.3, 0],
    [0.285, 0.17],
    [0.25, 0.35],
    [0.001, 0.35],
  ].map(([r, py]) => new THREE.Vector2(r, py));
  const parts = [placed(new THREE.LatheGeometry(profile, 12), 0x5a3a1f, x, y, z, 0, 0, Math.PI / 2)];
  for (const off of [-0.2, 0.2]) {
    parts.push(placed(new THREE.TorusGeometry(0.283, 0.012, 5, 14), 0x2a2622, x + off, y, z, 0, Math.PI / 2));
  }
  return parts;
}

/** A Volksempfaenger-style radio standing at x on the top shelf: bakelite box, speaker disc and dial. */
function radioParts(x: number): THREE.BufferGeometry[] {
  const top = 1.45 + 2 * 0.55 + 0.025;
  const cy = top + 0.175;
  const front = SHELF_Z + 0.09;
  return [
    placed(new THREE.BoxGeometry(0.3, 0.35, 0.18), 0x2a1a10, x, cy, SHELF_Z),
    placed(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 12), 0x6b5a3a, x, cy + 0.04, front + 0.005, Math.PI / 2),
    placed(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 8), 0xb8a070, x + 0.08, cy - 0.12, front + 0.006, Math.PI / 2),
  ];
}

/** A wall sconce body: brass backplate, arm into the room and a cup under the glass. */
function sconceParts(s: Sconce): THREE.BufferGeometry[] {
  const { x, y, z, dir } = s;
  return [
    placed(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 10), 0x9a7a3a, x + dir * 0.0075, y, z, 0, 0, Math.PI / 2),
    placed(new THREE.BoxGeometry(0.12, 0.02, 0.02), 0x9a7a3a, x + dir * 0.07, y, z),
    placed(new THREE.CylinderGeometry(0.03, 0.02, 0.03, 8), 0x9a7a3a, x + dir * 0.14, y, z),
  ];
}

/** A pendant lamp: cord from the ceiling, cap and an open dark-green cone shade. */
function pendantParts(p: Pendant): THREE.BufferGeometry[] {
  const top = p.shadeBottom + SHADE_H;
  const cord = CORD_TOP - top;
  return [
    placed(new THREE.CylinderGeometry(0.006, 0.006, cord, 4), 0x15110d, p.x, top + cord / 2, p.z),
    placed(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8), 0x2a2622, p.x, top + 0.015, p.z),
    placed(new THREE.CylinderGeometry(0.04, 0.2, SHADE_H, 12, 1, true), 0x1f3a2a, p.x, p.shadeBottom + SHADE_H / 2, p.z),
  ];
}

/** Steins, barrels, radio, sconce bodies and pendant lamps (cords and shades); vertex-coloured. */
export function hallPropsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) parts.push(...steinParts(-2.1 + i * 0.6, -4.2));
  // Two low racks: one barrel on the left, two side by side on the right.
  parts.push(placed(new THREE.BoxGeometry(0.8, 0.12, 0.5), 0x3a2514, -3.8, 0.06, -4.5));
  parts.push(placed(new THREE.BoxGeometry(1.7, 0.12, 0.5), 0x3a2514, 3.9, 0.06, -4.5));
  const barrelY = 0.12 + 0.3;
  parts.push(...barrelParts(-3.8, barrelY, -4.5));
  parts.push(...barrelParts(3.5, barrelY, -4.5));
  parts.push(...barrelParts(4.3, barrelY, -4.5));
  parts.push(...radioParts(RADIO_X));
  for (const s of SCONCE_POSITIONS) parts.push(...sconceParts(s));
  for (const p of PENDANT_POSITIONS) parts.push(...pendantParts(p));
  return mergeParts(parts);
}

/** Emissive bits: sconce glass and pendant bulbs (position + normal only, no vertex colour). */
export function hallGlowGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of SCONCE_POSITIONS) {
    parts.push(new THREE.SphereGeometry(SCONCE_GLASS_R, 8, 6).translate(s.x + s.dir * 0.14, s.y + 0.045, s.z));
  }
  for (const p of PENDANT_POSITIONS) {
    parts.push(new THREE.SphereGeometry(PENDANT_BULB_R, 8, 6).translate(p.x, p.shadeBottom + SHADE_H - 0.07, p.z));
  }
  return mergeParts(parts);
}

/** UV rectangle of poster `i` in the 2x2 poster atlas (v=1 is the canvas top): col = i % 2, row = floor(i / 2). */
export function posterUV(i: number): { u0: number; u1: number; v0: number; v1: number } {
  const col = i % 2;
  const row = Math.floor(i / 2);
  return { u0: col * 0.5, u1: col * 0.5 + 0.5, v0: 1 - (row + 1) * 0.5, v1: 1 - row * 0.5 };
}

const POSTER_W = 0.6;
const POSTER_H = 0.9;
const POSTER_Y = 2.1;

/** Poster placements; `ry` turns the +z-facing quad to face into the room. */
const POSTERS: ReadonlyArray<{ x: number; z: number; ry: number; index: number }> = [
  { x: -3.6, z: -4.97, ry: 0, index: 0 },
  { x: 3.6, z: -4.97, ry: 0, index: 1 },
  { x: -4.97, z: -1.5, ry: Math.PI / 2, index: 2 },
  { x: -4.97, z: 1.5, ry: Math.PI / 2, index: 3 },
  // +x wall: between the sconces at z 0.6 and 3, and past the one at 3.
  { x: 4.97, z: 1.8, ry: -Math.PI / 2, index: 1 },
  { x: 4.97, z: 4.0, ry: -Math.PI / 2, index: 0 },
];

/** Six poster quads (0.6 x 0.9) on the walls, facing the room, with atlas UVs; NOT vertex-coloured. */
export function posterGeometry(): THREE.BufferGeometry {
  const quads = POSTERS.map((p) => {
    const g = new THREE.PlaneGeometry(POSTER_W, POSTER_H).toNonIndexed();
    const { u0, u1, v0, v1 } = posterUV(p.index);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    g.rotateY(p.ry);
    g.translate(p.x, POSTER_Y, p.z);
    return g;
  });
  const merged = mergeGeometries(quads);
  for (const g of quads) g.dispose();
  if (!merged) throw new Error('beerhall: mergeGeometries failed');
  return merged;
}

const BUNT_Y = 3.3;
const BUNT_SAG = 0.15;
const BUNT_SPAN = 1.2;
const BUNT_PER_SWAG = 4;
const PENNANT_W = 0.16;
const PENNANT_H = 0.22;
const BUNT_COLOURS = [0x1a1a1a, 0x8a1c14, 0xb8913f];
const STRING_STEPS = 6;
const WALL_OFF = 0.02;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** One flat pennant triangle whose front face points along `inward`. */
function pennant(
  a: THREE.Vector3,
  b: THREE.Vector3,
  apex: THREE.Vector3,
  inward: THREE.Vector3,
  hex: number,
): THREE.BufferGeometry {
  const n = new THREE.Vector3().crossVectors(b.clone().sub(a), apex.clone().sub(a));
  const [p1, p2] = n.dot(inward) >= 0 ? [b, apex] : [apex, b];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], 3));
  g.computeVertexNormals();
  return paintGeometry(g, hex);
}

/** Swagged pennant bunting along the top of the back and side walls: dark string plus Weimar black, red and gold flags; vertex-coloured. */
export function buntingGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const e = 5 - WALL_OFF;
  const runs = [
    { from: new THREE.Vector3(-e, 0, -e), to: new THREE.Vector3(e, 0, -e), inward: new THREE.Vector3(0, 0, 1) },
    { from: new THREE.Vector3(-e, 0, -e), to: new THREE.Vector3(-e, 0, e), inward: new THREE.Vector3(1, 0, 0) },
    { from: new THREE.Vector3(e, 0, -e), to: new THREE.Vector3(e, 0, e), inward: new THREE.Vector3(-1, 0, 0) },
  ];
  let flag = 0;
  for (const run of runs) {
    const len = run.from.distanceTo(run.to);
    const swags = Math.round(len / BUNT_SPAN);
    /** Point on swag `s` at parameter t (0..1): along the wall with a parabolic sag. */
    const at = (s: number, t: number) => {
      const p = run.from.clone().lerp(run.to, (s + t) / swags);
      p.y = BUNT_Y - BUNT_SAG * 4 * t * (1 - t);
      return p;
    };
    const half = PENNANT_W / 2 / (len / swags);
    for (let s = 0; s < swags; s++) {
      for (let k = 0; k < STRING_STEPS; k++) {
        const p0 = at(s, k / STRING_STEPS);
        const p1 = at(s, (k + 1) / STRING_STEPS);
        const d = p1.clone().sub(p0);
        const seg = new THREE.CylinderGeometry(0.004, 0.004, d.length(), 4, 1, true);
        seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d.normalize()));
        const mid = p0.add(p1).multiplyScalar(0.5);
        parts.push(placed(seg, 0x15110d, mid.x, mid.y, mid.z));
      }
      for (let i = 0; i < BUNT_PER_SWAG; i++) {
        const t = (i + 0.5) / BUNT_PER_SWAG;
        const apex = at(s, t);
        apex.y -= PENNANT_H;
        parts.push(pennant(at(s, t - half), at(s, t + half), apex, run.inward, BUNT_COLOURS[flag++ % BUNT_COLOURS.length]));
      }
    }
  }
  return mergeParts(parts);
}
