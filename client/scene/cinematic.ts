// Game-over cinematic: camera dolly pose, role reveal timing, winner/loser stage values and confetti.
import * as THREE from 'three';
import { BASE_PITCH, lookAngles } from './look';
import { arcPoint } from './tween';
import { revealOrder } from './cardmotion';
import { TABLE_Y } from './world';

/** Seconds: dolly up, first role reveal, gap between reveals, confetti start, dolly back. */
export const CINE = { dolly: 2.6, revealStart: 0.5, revealGap: 0.28, confettiAt: 0.7, back: 1.0 };

const EYE_Y = 1.27; // matches world.ts EYE_Y
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const startPos = new THREE.Vector3();
const endPos = new THREE.Vector3();
const aimPos = new THREE.Vector3();

/** Camera pose at eased progress `k` (0 = seat eye, 1 = high over your side). Fills and returns `out`; pitch is absolute. */
export function dollyPose(
  k: number,
  layout: { rx: number; rz: number },
  out: { pos: THREE.Vector3; pitch: number; yaw: number },
): { pos: THREE.Vector3; pitch: number; yaw: number } {
  k = clamp(k, 0, 1);
  const { rx, rz } = layout;
  startPos.set(0, EYE_Y, rz + 0.36);
  endPos.set(0, TABLE_Y + 1.75 + 0.2 * rx, rz + 0.25);
  aimPos.set(0, TABLE_Y, -0.15 * rz);
  const look = lookAngles(endPos, aimPos);
  const endPitch = BASE_PITCH + look.pitch;
  arcPoint(startPos, endPos, 0.25, k, out.pos);
  out.pitch = BASE_PITCH + (endPitch - BASE_PITCH) * k;
  out.yaw = look.yaw * k;
  return out;
}

/** Seconds after the cinematic starts at which `seat` reveals its role card. */
export function revealAt(seat: number, me: number, n: number): number {
  return CINE.revealStart + CINE.revealGap * revealOrder(seat, me, n);
}

/** Seconds at which the last seat reveals. */
export function revealEndsAt(n: number): number {
  return CINE.revealStart + CINE.revealGap * (n - 1);
}

/** +1 for the winning party, -1 for the losing party, 0 for an unknown role. */
export function stageLevel(party: 'liberal' | 'fascist' | null, winner: 'liberal' | 'fascist'): number {
  if (party === null) return 0;
  return party === winner ? 1 : -1;
}

const tint: { color: number; emissive: [number, number, number] } = { color: 1, emissive: [0, 0, 0] };

/** Material multiplier for a patron at stage `level` (-1..1): losers dim, winners glow warm.
 * Patrons call it every frame, so it returns one shared object, overwritten on the next call. */
export function stageTint(level: number): { color: number; emissive: [number, number, number] } {
  level = clamp(level, -1, 1);
  const w = Math.max(0, level);
  tint.color = level < 0 ? 1 + 0.6 * level : 1;
  tint.emissive[0] = 0.22 * w;
  tint.emissive[1] = 0.15 * w;
  tint.emissive[2] = 0.06 * w;
  return tint;
}

export const CONFETTI = { count: 140, life: 4.2, top: 3.3, size: [0.055, 0.08] as const };

export interface ConfettiPiece {
  x: number;
  z: number;
  delay: number;
  fall: number;
  spin: number;
  phase: number;
  sway: number;
  tint: 0 | 1;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic confetti pieces spawned inside a 1.15x table ellipse. */
export function confettiPieces(count: number, seed: number, rx: number, rz: number): ConfettiPiece[] {
  const rnd = mulberry32(seed);
  const pieces: ConfettiPiece[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    pieces.push({
      x: Math.cos(a) * r * 1.15 * rx,
      z: Math.sin(a) * r * 1.15 * rz,
      delay: rnd() * 1.2,
      fall: 0.55 + rnd() * 0.4,
      spin: (2 + rnd() * 4) * (rnd() < 0.5 ? -1 : 1),
      phase: rnd() * Math.PI * 2,
      sway: 0.05 + rnd() * 0.13,
      tint: rnd() < 0.65 ? 0 : 1,
    });
  }
  return pieces;
}

/** Piece pose `t` seconds after confetti start; false while it has not spawned yet. Lands flat and freezes. */
export function confettiAt(
  p: ConfettiPiece,
  t: number,
  rx: number,
  rz: number,
  out: { pos: THREE.Vector3; rot: THREE.Euler },
): boolean {
  if (t < p.delay) return false;
  const inTable = (p.x / rx) ** 2 + (p.z / rz) ** 2 <= 1;
  const floor = inTable ? TABLE_Y + 0.003 : 0.003;
  const land = (CONFETTI.top - floor) / p.fall;
  const tau = t - p.delay;
  if (tau >= land) {
    out.pos.set(p.x + p.sway * Math.sin(2.1 * land + p.phase), floor, p.z + p.sway * Math.cos(1.7 * land + p.phase));
    out.rot.set(-Math.PI / 2, p.phase, 0);
    return true;
  }
  out.pos.set(
    p.x + p.sway * Math.sin(2.1 * tau + p.phase),
    CONFETTI.top - p.fall * tau,
    p.z + p.sway * Math.cos(1.7 * tau + p.phase),
  );
  out.rot.set(p.spin * tau, p.phase + 0.7 * p.spin * tau, 0.5 * Math.sin(3 * tau + p.phase));
  return true;
}

const TINTS = {
  liberal: [0x3f7fb5, 0xd8cfb8],
  fascist: [0xb3362c, 0x1c1a18],
};

/** Party-coloured policy-card confetti, one InstancedMesh. Not added to any scene. */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private pieces: ConfettiPiece[] = [];
  private t = 0;
  private active = false;
  private rx = 1;
  private rz = 1;
  private readonly pose = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly mat = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor() {
    const geo = new THREE.PlaneGeometry(CONFETTI.size[0], CONFETTI.size[1]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, CONFETTI.count);
    this.color.setRGB(0, 0, 0);
    for (let i = 0; i < CONFETTI.count; i++) this.mesh.setColorAt(i, this.color);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  get running(): boolean {
    return this.active;
  }

  start(winner: 'liberal' | 'fascist', seed: number, rx: number, rz: number): void {
    this.pieces = confettiPieces(CONFETTI.count, seed, rx, rz);
    this.rx = rx;
    this.rz = rz;
    const tints = TINTS[winner];
    for (let i = 0; i < this.pieces.length; i++) {
      this.mesh.setColorAt(i, this.color.setHex(tints[this.pieces[i].tint]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.t = 0;
    this.active = true;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    let n = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      if (!confettiAt(this.pieces[i], this.t, this.rx, this.rz, this.pose)) continue;
      this.quat.setFromEuler(this.pose.rot);
      this.mat.compose(this.pose.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(n++, this.mat);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  stop(): void {
    this.active = false;
    this.mesh.visible = false;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
