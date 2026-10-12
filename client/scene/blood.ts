// Pure seeded blood spray: droplet launch, analytic landing on the table or floor.
import * as THREE from 'three';
import { rand } from './rand';
import { TABLE_Y } from './world';

export type Surface = 'table' | 'floor';
export interface Droplet {
  /** Launch point (near the victim's head). */
  start: THREE.Vector3;
  /** Initial velocity, m/s. */
  vel: THREE.Vector3;
  /** Flight time to landing, s. */
  t: number;
  /** Landing point: y === TABLE_Y on 'table', y === 0 on 'floor'. */
  land: THREE.Vector3;
  surface: Surface;
  /** Splat radius, metres. */
  size: number;
}
export const GRAVITY = 9.8;

const BLOWBACK_HALF = (35 * Math.PI) / 180;
const EXIT_HALF = (40 * Math.PI) / 180;

/** Seed from (victim seat, kill index); always a valid non-zero rand() seed. */
export function bloodSeed(victimSeat: number, killIndex: number): number {
  const h = (Math.imul(victimSeat + 1, 73856093) ^ Math.imul(killIndex + 1, 19349663)) >>> 0;
  return (h % 2147483646) + 1;
}

/** Position of a droplet at time t (clamped to its landing time). */
export function dropletAt(d: Droplet, t: number, out: THREE.Vector3): THREE.Vector3 {
  const k = Math.min(Math.max(t, 0), d.t);
  return out.set(
    d.start.x + d.vel.x * k,
    d.start.y + d.vel.y * k - 0.5 * GRAVITY * k * k,
    d.start.z + d.vel.z * k,
  );
}

/** Time at which a ballistic point starting at y0 with vertical speed vy descends through height y. */
function fallTime(y0: number, vy: number, y: number): number {
  return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * GRAVITY * (y0 - y)))) / GRAVITY;
}

/** n droplets sprayed from victimHead: mostly blowback toward the table, some exit spray behind, a few straight up. */
export function spray(
  seed: number,
  victimHead: THREE.Vector3,
  shooterHead: THREE.Vector3,
  n: number,
  layout: { rx: number; rz: number },
): Droplet[] {
  const rnd = rand(seed);
  const between = (a: number, b: number) => a + (b - a) * rnd();
  // Horizontal blowback heading: halfway between toward-shooter and toward-centre.
  let tx = shooterHead.x - victimHead.x;
  let tz = shooterHead.z - victimHead.z;
  const tl = Math.hypot(tx, tz);
  let cx = -victimHead.x;
  let cz = -victimHead.z;
  const cl = Math.hypot(cx, cz);
  if (tl > 1e-6) { tx /= tl; tz /= tl; } else { tx = 0; tz = 0; }
  if (cl > 1e-6) { cx /= cl; cz /= cl; } else { cx = 0; cz = 0; }
  let bx = tx + cx;
  let bz = tz + cz;
  if (Math.hypot(bx, bz) < 1e-6) { bx = cx; bz = cz; }
  const bl = Math.hypot(bx, bz);
  const base = bl > 1e-6 ? Math.atan2(bz / bl, bx / bl) : 0;
  const out: Droplet[] = [];
  for (let i = 0; i < n; i++) {
    const start = new THREE.Vector3(
      victimHead.x + between(-0.05, 0.05),
      victimHead.y + between(-0.05, 0.05),
      victimHead.z + between(-0.05, 0.05),
    );
    const family = rnd();
    let ang: number;
    let speed: number;
    let vy: number;
    if (family < 0.6) {
      ang = base + between(-BLOWBACK_HALF, BLOWBACK_HALF);
      speed = between(2, 4);
      vy = between(-1, 1.5);
    } else if (family < 0.9) {
      ang = base + Math.PI + between(-EXIT_HALF, EXIT_HALF);
      speed = between(1, 3);
      vy = between(-1, 1.5);
    } else {
      ang = between(0, Math.PI * 2);
      speed = between(0, 0.8);
      vy = between(2, 4);
    }
    const vel = new THREE.Vector3(Math.cos(ang) * speed, vy, Math.sin(ang) * speed);
    let t = fallTime(start.y, vy, TABLE_Y);
    let surface: Surface = 'table';
    let x = start.x + vel.x * t;
    let z = start.z + vel.z * t;
    if (start.y < TABLE_Y || (x * x) / (layout.rx * layout.rx) + (z * z) / (layout.rz * layout.rz) > 1) {
      surface = 'floor';
      t = fallTime(start.y, vy, 0);
      x = start.x + vel.x * t;
      z = start.z + vel.z * t;
    }
    out.push({
      start,
      vel,
      t,
      land: new THREE.Vector3(x, surface === 'table' ? TABLE_Y : 0, z),
      surface,
      size: between(0.015, 0.07),
    });
  }
  return out;
}

export type BloodPart = 'all' | 'upper' | 'gunArm';

/** Dark flat blood ink, linear RGB. */
export const BLOOD_INK = new THREE.Color(0x4a0606);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Integer lattice hash to [0,1). */
function hash4(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Trilinear value noise in [0,1) with a smoothstep fade. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash4(ix + dx, iy + dy, iz + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/**
 * Darkens noisy patches of vertices whose normals face localDir (all arrays are xyz triples, same vertex count).
 * Deterministic in seed; vertices outside region or not facing localDir are left bit-for-bit untouched.
 * Returns how many vertices changed.
 */
export function paintBlood(
  colors: { [i: number]: number; length: number },
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  localDir: THREE.Vector3,
  seed: number,
  amount: number,
  region?: (vertex: number) => boolean,
): number {
  if (amount <= 0 || localDir.lengthSq() === 0) return 0;
  const dl = localDir.length();
  const dx = localDir.x / dl;
  const dy = localDir.y / dl;
  const dz = localDir.z / dl;
  const n = Math.floor(positions.length / 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const cell = (Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1) / 18;
  const fine = cell * 0.4;
  const cap = Math.min(amount, 1);
  const ink = [BLOOD_INK.r, BLOOD_INK.g, BLOOD_INK.b];
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (region && !region(i)) continue;
    const nx = normals[3 * i], ny = normals[3 * i + 1], nz = normals[3 * i + 2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-8) continue;
    const facing = (nx * dx + ny * dy + nz * dz) / nl;
    if (facing <= 0.15) continue;
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    const k = 0.6 * noise3(x / cell, y / cell, z / cell, seed) + 0.4 * noise3(x / fine, y / fine, z / fine, seed + 1);
    const lo = 1 - Math.sqrt(facing) * cap;
    const w = smooth(lo, lo + 0.25, k) * 0.92;
    if (w <= 0) continue;
    for (let c = 0; c < 3; c++) colors[3 * i + c] += (ink[c] - colors[3 * i + c]) * w;
    count++;
  }
  return count;
}
