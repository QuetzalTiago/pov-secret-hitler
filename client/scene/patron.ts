import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Pure geometry for the procedural patrons (no materials, no scene). Every builder returns ONE merged,
// non-indexed geometry with smooth normals, in the Character's body-local (or head-local) space, and builds a
// new geometry per call: the caller owns and disposes it.

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Merge parts into one non-indexed geometry (position + normal, plus any shared extra attributes); disposes the parts. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    return n;
  });
  const merged = mergeGeometries(flat);
  for (const g of parts) g.dispose();
  for (const g of flat) g.dispose();
  if (!merged) throw new Error('patron: mergeGeometries failed');
  return merged;
}

/** Bake a flat colour into a `color` attribute (for meshes that share one vertex-coloured material). */
export function paintGeometry(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Re-derive smooth normals after a non-uniform scale or vertex edit (welds seams and poles first). */
function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-5);
  g.dispose();
  m.computeVertexNormals();
  return m;
}

function ellipsoid(rx: number, ry: number, rz: number, x = 0, y = 0, z = 0, w = 16, h = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return smooth(g);
}

/** Capsule along X (length = total span), flattened in z, tilted about z, then placed. */
function bar(length: number, r: number, tilt: number, x: number, y: number, z: number, flatZ = 0.8): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, length - 2 * r), 4, 10);
  g.rotateZ(Math.PI / 2 + tilt);
  g.scale(1, 1, flatZ);
  g.translate(x, y, z);
  return smooth(g);
}

/** Lathe from (radius, y) points; traverse the profile counter-clockwise (outer wall up, then inward over the top). */
function lathe(points: [number, number][], segments: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

export function cylinderBetween(from: THREE.Vector3, to: THREE.Vector3, rFrom: number, rTo: number, radial: number, open: boolean): THREE.BufferGeometry {
  const dir = to.clone().sub(from);
  const g = new THREE.CylinderGeometry(rTo, rFrom, dir.length(), radial, 1, open);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()));
  const mid = from.clone().add(to).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** A tapered limb between two points with rounded ends (a capsule), so chained segments meet in a continuous joint. */
export function limbGeometry(from: THREE.Vector3, to: THREE.Vector3, rFrom: number, rTo: number): THREE.BufferGeometry {
  const joint = (p: THREE.Vector3, r: number) => new THREE.SphereGeometry(r, 14, 10).translate(p.x, p.y, p.z);
  return mergeParts([cylinderBetween(from, to, rFrom, rTo, 14, true), joint(from, rFrom), joint(to, rTo)]);
}

// ---- Body ----

/** Coat profile (radius, y), counter-clockwise: waist, chest, then rounded shoulders closing under the neck. */
const TORSO: [number, number][] = [
  [0, 0.54],
  [0.19, 0.54],
  [0.235, 0.57],
  [0.245, 0.62],
  [0.24, 0.75],
  [0.228, 0.9],
  [0.228, 1.0],
  [0.245, 1.1],
  [0.225, 1.16],
  [0.15, 1.2],
  [0.075, 1.225],
  [0, 1.23],
];
/** The coat is slightly flatter front to back than side to side. */
const TORSO_SQUASH = 0.88;

/** Z of the coat's front surface at height y (where shirt, tie, strap and buttons sit). */
export function torsoFront(y: number): number {
  for (let i = 1; i < TORSO.length; i++) {
    const [r0, y0] = TORSO[i - 1];
    const [r1, y1] = TORSO[i];
    if (y1 > y0 && y >= y0 && y <= y1) return (r0 + ((r1 - r0) * (y - y0)) / (y1 - y0)) * TORSO_SQUASH;
  }
  return 0.2;
}

/** Coat torso with rounded shoulder caps. */
export function torsoGeometry(): THREE.BufferGeometry {
  const body = lathe(TORSO, 28);
  body.scale(1, 1, TORSO_SQUASH);
  const parts = [smooth(body)];
  for (const side of [-1, 1]) parts.push(new THREE.SphereGeometry(0.062, 16, 12).translate(side * 0.27, 1.1, 0));
  return mergeParts(parts);
}

/** Joint chain per arm so the hands stay attached: shoulder -> elbow -> wrist on the table edge. */
export function armJoints(side: 1 | -1) {
  return {
    shoulder: new THREE.Vector3(side * 0.27, 1.1, 0.0),
    elbow: new THREE.Vector3(side * 0.31, 0.88, 0.17),
    wrist: new THREE.Vector3(side * 0.23, 0.83, 0.45),
  };
}

/** Sleeve of one resting arm (upper arm + forearm). */
export function armGeometry(side: 1 | -1): THREE.BufferGeometry {
  const { shoulder, elbow, wrist } = armJoints(side);
  return mergeParts([limbGeometry(shoulder, elbow, 0.058, 0.054), limbGeometry(elbow, wrist, 0.052, 0.045)]);
}

/** Straight sleeve of the aiming arm: pivots at the origin (shoulder), +Z along the arm. */
export function aimArmGeometry(): THREE.BufferGeometry {
  const v = (z: number) => new THREE.Vector3(0, 0, z);
  return mergeParts([limbGeometry(v(0), v(0.28), 0.058, 0.054), limbGeometry(v(0.28), v(0.55), 0.052, 0.047)]);
}

/** Index finger of the pointing hand, along +Z (positioned by its mesh). */
export function fingerGeometry(): THREE.BufferGeometry {
  return mergeParts([new THREE.CapsuleGeometry(0.011, 0.078, 4, 8).rotateX(Math.PI / 2)]);
}

export function neckGeometry(): THREE.BufferGeometry {
  return mergeParts([new THREE.CylinderGeometry(0.06, 0.07, 0.1, 14).translate(0, 1.22, 0)]);
}

/** Shirt V showing between the lapels (its apex at y 0.82). */
export function shirtGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.08, 0.3, 14);
  g.scale(1, 1, 0.3);
  g.rotateX(Math.PI - 0.12);
  g.translate(0, 0.97, torsoFront(0.97));
  return mergeParts([smooth(g)]);
}

/** Half width of the shirt V at height y. */
const shirtHalfWidth = (y: number) => (0.08 * Math.max(0, y - 0.82)) / 0.3;

const polygon = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));

/**
 * A thin bevelled slab from a 2D outline (thickness depth + 2 bevel, centred on z = 0), with z then bent per vertex
 * by `lift(x, y)` so it lies on the coat. Smooth normals, like every builder here.
 */
function slab(pts: [number, number][], depth: number, bevel: number, lift: (x: number, y: number) => number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(polygon(pts), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - depth / 2 + lift(pos.getX(i), pos.getY(i)));
  return smooth(g);
}

/** Necktie: a small tapered knot at the collar over a flat blade that widens (0.022 -> 0.05) to a pointed tip, y 1.14 -> 0.86. */
export function tieGeometry(): THREE.BufferGeometry {
  const top = 1.14;
  const widest = 0.885;
  const tip = 0.86;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const y = top - ((top - widest) * i) / steps;
    const hw = 0.011 + 0.014 * (i / steps);
    left.push([-hw, y]);
    right.unshift([hw, y]);
  }
  const blade = slab([...left, [0, tip], ...right], 0.004, 0.001, (_x, y) => torsoFront(y) + 0.02);
  // Knot: 0.03 wide at the top, 0.02 at the bottom, 0.03 tall, 0.015 deep (bevels included).
  const knot = slab(
    [
      [-0.007, 1.133],
      [0.007, 1.133],
      [0.012, 1.157],
      [-0.012, 1.157],
    ],
    0.007,
    0.004,
    (_x, y) => torsoFront(y) + 0.016,
  );
  return mergeParts([blade, knot]);
}

/** Shirt collar: two thin flaps flanking the knot, pointing down and out. */
export function collarGeometry(): THREE.BufferGeometry {
  const flaps = [-1, 1].map((s) =>
    slab(
      [
        [s * 0.016, 1.168],
        [s * 0.07, 1.158],
        [s * 0.052, 1.1],
      ],
      0.003,
      0.001,
      (_x, y) => torsoFront(y) + 0.014,
    ),
  );
  return mergeParts(flaps);
}

/** Notched jacket lapels along both edges of the shirt V; the inner edges ride over the tie blade's outer edges. */
export function lapelGeometry(): THREE.BufferGeometry {
  const bottom = 0.84;
  const topY = 1.12;
  const xIn = (y: number) => shirtHalfWidth(y) + 0.008;
  const width = (y: number) => 0.03 + (0.017 * (y - bottom)) / (topY - bottom);
  const xOut = (y: number) => xIn(y) + width(y);
  const sides = [-1, 1].map((s) => {
    const inner: [number, number][] = [];
    const outer: [number, number][] = [];
    for (const y of [bottom, 0.9, 0.97, 1.04, topY]) inner.push([s * xIn(y), y]);
    for (const y of [bottom, 0.9, 0.97, 1.04]) outer.push([s * xOut(y), y]);
    // Notch near the top of the outer edge, then up to the shoulder line.
    outer.push([s * xOut(1.05), 1.05], [s * (xOut(1.062) - 0.014), 1.062], [s * xOut(1.075), 1.075], [s * xOut(topY), topY]);
    return slab([...inner, ...outer.reverse()], 0.006, 0.001, (x, y) => {
      const t = Math.min(1, Math.max(0, (xOut(y) - Math.abs(x)) / width(y)));
      return torsoFront(y) + 0.006 + 0.024 * t;
    });
  });
  return mergeParts(sides);
}

/** Two small flat coat buttons below the V. */
export function coatButtonsGeometry(): THREE.BufferGeometry {
  return mergeParts([0.79, 0.72].map((y) => ellipsoid(0.012, 0.012, 0.004, 0, y, torsoFront(y) + 0.0045, 12, 8)));
}

// ---- Hitler uniform ----

export function uniformGeometry(): { dark: THREE.BufferGeometry; brass: THREE.BufferGeometry } {
  const belt = lathe(
    [
      [0.236, 0.675],
      [0.255, 0.679],
      [0.258, 0.7],
      [0.255, 0.721],
      [0.236, 0.725],
    ],
    28,
  );
  belt.scale(1, 1, TORSO_SQUASH);
  const strap = new THREE.CapsuleGeometry(0.0175, 0.465, 4, 8);
  strap.scale(1, 1, 0.5);
  strap.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.12, 0, -0.55)));
  strap.translate(-0.04, 0.93, torsoFront(0.93) + 0.004);
  const dark = mergeParts([smooth(belt), smooth(strap)]);

  const parts = [ellipsoid(0.028, 0.022, 0.01, 0, 0.7, torsoFront(0.7) + 0.006)];
  for (let i = 0; i < 3; i++) {
    const y = 0.8 + i * 0.09;
    parts.push(new THREE.SphereGeometry(0.009, 10, 8).translate(0.05, y, torsoFront(y) + 0.002));
  }
  return { dark, brass: mergeParts(parts) };
}

/** Plain armband on the upper arm (deliberately no insignia), plus a pale disc on its outside. */
export function armbandGeometry(): { band: THREE.BufferGeometry; disc: THREE.BufferGeometry } {
  const { shoulder, elbow } = armJoints(1);
  const band = mergeParts([cylinderBetween(shoulder.clone().lerp(elbow, 0.38), shoulder.clone().lerp(elbow, 0.62), 0.066, 0.068, 20, false)]);
  const mid = shoulder.clone().lerp(elbow, 0.5);
  const disc = mergeParts([new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16).rotateZ(Math.PI / 2).translate(mid.x + 0.07, mid.y, mid.z)]);
  return { band, disc };
}

/** Cigarette along +Z: tan filter at the origin, white paper out to the lit end at z = CIGARETTE_TIP. */
export const CIGARETTE_TIP = 0.078;

export function cigaretteGeometry(): THREE.BufferGeometry {
  const filter = new THREE.CylinderGeometry(0.006, 0.006, 0.018, 10).rotateX(Math.PI / 2).translate(0, 0, 0.009);
  const paper = new THREE.CylinderGeometry(0.006, 0.006, CIGARETTE_TIP - 0.018, 10).rotateX(Math.PI / 2).translate(0, 0, (CIGARETTE_TIP + 0.018) / 2);
  return mergeParts([paintGeometry(filter, 0xc89a5a), paintGeometry(paper, 0xf2eee2)]);
}

// ---- Head (head-local space; the head group sits at y 1.4) ----

/** A low-poly rounded taper between two points (a small limbGeometry, for face features). */
function taper(from: THREE.Vector3, to: THREE.Vector3, rFrom: number, rTo: number): THREE.BufferGeometry {
  const cap = (p: THREE.Vector3, r: number) => new THREE.SphereGeometry(r, 8, 6).translate(p.x, p.y, p.z);
  return mergeParts([cylinderBetween(from, to, rFrom, rTo, 8, true), cap(from, rFrom), cap(to, rTo)]);
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Gaussian bump in the (x, y) plane, 1 at the centre. */
const blob = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2));
/** Sideways scale of the head at height y: the jaw narrows below the cheeks. */
const jawScale = (y: number) => 1 - 0.3 * smoothstep(0, 1, Math.min(1, Math.max(0, (-0.05 - y) / 0.118)));

/** One ear: a C-shaped rim (open towards the face) around a flatter disc, angled back a little. */
function earGeometry(side: 1 | -1): THREE.BufferGeometry {
  const gap = 1;
  // After the Y rotation a torus's local -x (side 1) or +x (side -1) faces forward; open the C there.
  const open = side === 1 ? Math.PI : 0;
  const rim = new THREE.TorusGeometry(0.021, 0.0042, 6, 16, Math.PI * 2 - gap);
  rim.rotateZ(open + gap / 2);
  rim.scale(0.85, 1.3, 1);
  rim.rotateY((side * Math.PI) / 2);
  const g = mergeParts([smooth(rim), ellipsoid(0.005, 0.025, 0.015, side * -0.005, 0, 0, 10, 8)]);
  g.rotateX(-0.2);
  g.translate(side * 0.152, -0.005, -0.005);
  return smooth(g);
}

/** Skull with brow ridge, eye sockets, cheekbones, a narrower jaw and chin, rimmed ears and a nose bridge, all in one geometry. */
export function headSkinGeometry(): THREE.BufferGeometry {
  const skull = new THREE.SphereGeometry(0.15, 40, 28);
  skull.scale(1, 1.12, 1);
  const pos = skull.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(x);
    const front = smoothstep(0.05, 0.12, z);
    const cheek = Math.exp(-Math.pow(y / 0.045, 2)) * smoothstep(0, 0.08, z);
    // Radial displacement, as a fraction of the radius: flatter face front, brow ridge, sockets, cheekbones, chin.
    const d =
      front *
      (0.03 * smoothstep(0, 0.06, ax) * (1 - smoothstep(0.08, 0.13, ax)) * (1 - smoothstep(0.05, 0.1, y)) +
        0.04 * blob(0, y - 0.062, 1, 0.014) * Math.exp(-Math.pow(ax / 0.085, 2)) -
        0.045 * blob(ax - 0.055, y - 0.028, 0.024, 0.018) +
        0.035 * blob(ax - 0.085, y + 0.01, 0.03, 0.025) +
        0.05 * blob(x, y + 0.125, 0.03, 0.03));
    const k = 1 + d;
    pos.setXYZ(i, x * jawScale(y) * (1 + 0.05 * cheek) * k, y * k, z * k);
  }
  const parts = [smooth(skull), earGeometry(-1), earGeometry(1)];
  // Nose: a bridge ridge from between the eyes down to the tip, then the tip and nostril wings.
  const bridge = taper(new THREE.Vector3(0, 0.035, 0.138), new THREE.Vector3(0, -0.006, 0.18), 0.007, 0.012);
  bridge.scale(0.85, 1, 1);
  parts.push(smooth(bridge));
  parts.push(ellipsoid(0.0145, 0.013, 0.014, 0, -0.012, 0.19, 10, 8));
  for (const side of [-1, 1]) parts.push(ellipsoid(0.01, 0.01, 0.012, side * 0.014, -0.014, 0.178, 8, 6));
  return mergeParts(parts);
}

const SCLERA = 0xf6f2ec;
const IRIS = 0x3a2414;
const PUPIL = 0x050403;

/** Both eyes (sclera, iris, pupil; vertex-coloured), centred at y 0 (place the mesh at the eye line and blink by scaling its y). */
export function eyesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const x = side * 0.055;
    parts.push(paintGeometry(ellipsoid(0.019, 0.0125, 0.0125, x, 0, 0.002, 12, 8), SCLERA));
    parts.push(paintGeometry(ellipsoid(0.0078, 0.0078, 0.007, x, 0, 0.0085, 10, 6), IRIS));
    parts.push(paintGeometry(ellipsoid(0.0036, 0.0036, 0.004, x, 0, 0.0122, 6, 4), PUPIL));
  }
  return mergeParts(parts);
}

const MOUTH_INSIDE = 0x1a0a08;

/** Upper and lower lip (fuller lower, with a cupid's bow) around a dark mouth interior; vertex-coloured, centred at the origin (it scales in y while talking). */
export function mouthGeometry(lipHex: number): THREE.BufferGeometry {
  const lips = [bar(0.06, 0.0042, 0, 0, 0.0045, 0.004, 0.9), bar(0.054, 0.0062, 0, 0, -0.0033, 0.005, 0.9)];
  for (const side of [-1, 1]) lips.push(ellipsoid(0.008, 0.0034, 0.0045, side * 0.0075, 0.0072, 0.0042, 8, 6));
  return mergeParts([...lips.map((g) => paintGeometry(g, lipHex)), paintGeometry(ellipsoid(0.023, 0.0015, 0.004, 0, 0, 0.001, 10, 6), MOUTH_INSIDE)]);
}

/** Eyebrow: a rounded taper, thicker at the inner end, tilted per side. */
function browGeometry(side: number, tilt: number): THREE.BufferGeometry {
  const g = taper(new THREE.Vector3(-side * 0.03, 0, 0), new THREE.Vector3(side * 0.03, 0, 0), 0.0095, 0.0055);
  g.scale(1, 1, 0.8);
  g.rotateZ(side * tilt);
  g.translate(side * 0.055, 0.065, 0.14);
  return smooth(g);
}

/** Hairline height by angle from straight ahead (0 = front, 1 = back of the head): forehead, temples above the ears, down to the nape. */
const HAIRLINE: [number, number][] = [
  [0, 0.115],
  [0.22, 0.1],
  [0.4, 0.055],
  [0.5, 0.04],
  [0.7, -0.03],
  [1, -0.1],
];

function hairlineY(a: number): number {
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [a0, y0] = HAIRLINE[i - 1];
    const [a1, y1] = HAIRLINE[i];
    if (a <= a1) return y0 + ((y1 - y0) * (a - a0)) / (a1 - a0);
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

/** Hair: a shell just outside the skull from the crown down to the hairline, tapering onto the skin along its edge. */
function hairGeometry(): THREE.BufferGeometry {
  const rings = 10;
  const cols = 32;
  const yScale = 1.12;
  const pos: number[] = [];
  const index: number[] = [];
  for (let c = 0; c <= cols; c++) {
    const theta = (c / cols) * Math.PI * 2; // 0 = straight ahead (+z), increasing towards +x
    const a = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) / Math.PI;
    const phiEnd = Math.acos(Math.min(1, hairlineY(a) / (0.157 * yScale)));
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const phi = phiEnd * t;
      const radius = 0.157 - 0.0055 * smoothstep(0.8, 1, t);
      const y = radius * yScale * Math.cos(phi);
      const ring = radius * Math.sin(phi);
      pos.push(ring * Math.sin(theta) * jawScale(y), y, ring * Math.cos(theta));
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rings; r++) {
      const i = c * (rings + 1) + r;
      const j = i + rings + 1;
      index.push(i, i + 1, j, i + 1, j + 1, j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return smooth(g);
}

export interface FaceDetailOptions {
  /** Brow tilt in radians, mirrored per side. */
  browTilt: number;
  mustache: 'none' | 'wide' | 'toothbrush';
  beard: boolean;
  /** Hair (for the bare-headed patrons). */
  hair: boolean;
  /** Dark fringe swept across the forehead. */
  fringe: boolean;
}

/** Everything dark on the face: brows, moustache, beard, hair, fringe. */
export function faceDetailGeometry(opts: FaceDetailOptions): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) parts.push(browGeometry(side, opts.browTilt));
  if (opts.mustache === 'wide') parts.push(bar(0.09, 0.011, 0, 0, -0.042, 0.149));
  if (opts.mustache === 'toothbrush') parts.push(ellipsoid(0.022, 0.0125, 0.01, 0, -0.04, 0.15));
  if (opts.beard) parts.push(ellipsoid(0.085, 0.06, 0.07, 0, -0.105, 0.075, 20, 14));
  if (opts.fringe) {
    const f = new THREE.SphereGeometry(1, 16, 10);
    f.scale(0.078, 0.022, 0.028);
    f.rotateZ(0.35);
    f.translate(-0.025, 0.085, 0.125);
    parts.push(smooth(f));
  }
  if (opts.hair) parts.push(hairGeometry());
  return mergeParts(parts);
}

// ---- Hats ----

export type HatKind = 'fedora' | 'tophat' | 'bowler' | 'cap' | 'beret';

const HAT_SEGMENTS = 32;

/** A hat in head-local space (solid underneath, so no hollow shows below the brim). */
export function hatGeometry(kind: HatKind): THREE.BufferGeometry {
  switch (kind) {
    case 'fedora': {
      const g = lathe(
        [
          [0, 0.119],
          [0.147, 0.118],
          [0.2, 0.116],
          [0.248, 0.12],
          [0.256, 0.126],
          [0.248, 0.132],
          [0.2, 0.13],
          [0.155, 0.133],
          [0.15, 0.15],
          [0.142, 0.2],
          [0.13, 0.24],
          [0.115, 0.26],
          [0.08, 0.268],
          [0.03, 0.268],
          [0, 0.267],
        ],
        HAT_SEGMENTS,
      );
      // Pinch the crown into a teardrop and dent a crease lengthwise along the top.
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const up = Math.min(1, Math.max(0, (y - 0.16) / 0.1));
        pos.setX(i, x * (1 - 0.14 * up * up));
        pos.setY(i, y - 0.024 * up * up * Math.exp(-Math.pow(x / 0.045, 2)));
      }
      return mergeParts([smooth(g)]);
    }
    case 'tophat':
      return mergeParts([
        smooth(
          lathe(
            [
              [0, 0.11],
              [0.13, 0.11],
              [0.21, 0.112],
              [0.222, 0.12],
              [0.21, 0.128],
              [0.14, 0.13],
              [0.13, 0.14],
              [0.13, 0.36],
              [0.126, 0.376],
              [0.11, 0.38],
              [0, 0.38],
            ],
            HAT_SEGMENTS,
          ),
        ),
      ]);
    case 'bowler': {
      const pts: [number, number][] = [
        [0, 0.104],
        [0.15, 0.104],
        [0.19, 0.106],
        [0.2, 0.111],
        [0.19, 0.117],
        [0.16, 0.117],
      ];
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * (Math.PI / 2);
        pts.push([0.15 * Math.cos(a), 0.115 + 0.145 * Math.sin(a)]);
      }
      return mergeParts([smooth(lathe(pts, HAT_SEGMENTS))]);
    }
    case 'cap': {
      const pts: [number, number][] = [
        [0, 0.07],
        [0.165, 0.07],
      ];
      for (let k = 1; k <= 10; k++) {
        const a = (k / 10) * (Math.PI / 2);
        pts.push([0.165 * Math.cos(a), 0.07 + 0.165 * Math.sin(a)]);
      }
      const visor = new THREE.SphereGeometry(1, 20, 8);
      visor.scale(0.1, 0.008, 0.05);
      visor.rotateX(0.15);
      visor.translate(0, 0.078, 0.155);
      return mergeParts([lathe(pts, HAT_SEGMENTS), smooth(visor)]);
    }
    case 'beret': {
      const g = lathe(
        [
          [0, -0.03],
          [0.12, -0.03],
          [0.16, -0.025],
          [0.172, -0.01],
          [0.17, 0.01],
          [0.15, 0.028],
          [0.08, 0.032],
          [0.02, 0.03],
          [0, 0.036],
        ],
        HAT_SEGMENTS,
      );
      g.rotateZ(0.2);
      g.translate(0, 0.15, 0);
      return mergeParts([smooth(g)]);
    }
  }
}

/** Military peaked cap: tall crown (cloth), dark band and glossy visor (trim), brass badge. */
export function peakedCapGeometry(): { cloth: THREE.BufferGeometry; trim: THREE.BufferGeometry; badge: THREE.BufferGeometry } {
  const crown = lathe(
    [
      [0, -0.05],
      [0.15, -0.05],
      [0.158, -0.02],
      [0.175, 0.02],
      [0.195, 0.048],
      [0.19, 0.056],
      [0.12, 0.058],
      [0, 0.054],
    ],
    HAT_SEGMENTS,
  );
  crown.scale(1, 1, 1.08);
  crown.rotateX(-0.12);
  crown.translate(0, 0.17, 0);
  const band = new THREE.CylinderGeometry(0.155, 0.155, 0.05, HAT_SEGMENTS, 1, true).translate(0, 0.12, 0);
  const visor = new THREE.CylinderGeometry(0.12, 0.12, 0.012, 20, 1, false, -Math.PI / 2, Math.PI);
  visor.rotateX(0.22);
  visor.translate(0, 0.1, 0.1);
  const badge = new THREE.CylinderGeometry(0.02, 0.02, 0.008, 16);
  badge.rotateX(Math.PI / 2 - 0.12);
  badge.translate(0, 0.18, 0.175);
  return { cloth: mergeParts([smooth(crown)]), trim: mergeParts([band, visor]), badge: mergeParts([badge]) };
}
