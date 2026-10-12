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
