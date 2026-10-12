// Blood effects for an execution: flying droplets, splats stuck to what they land on, a growing pool and a head drip.
import * as THREE from 'three';
import { BLOOD_INK, BloodSplats, drip, dropletAt, spray, splatMesh, type Droplet, type Surface } from './blood';
import { rand } from './rand';
import { BLOOD_TILES } from './textures';

export const POOL_GROW = 10;
export const BLOOD_DROPS = 56;

interface Flight {
  d: Droplet;
  time: number;
  onLand?: () => void;
}

const tmpV = new THREE.Vector3();

/** One pooled THREE.Points for every droplet in flight; driven by sim time, so slow-mo applies. */
export class BloodDroplets {
  readonly points: THREE.Points;
  private readonly attr: THREE.BufferAttribute;
  private flights: Flight[] = [];

  constructor(private readonly cap = 160) {
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color: BLOOD_INK, size: 0.03, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  get active(): number {
    return this.flights.length;
  }

  /** Starts a flight; when every slot is busy the droplet is dropped but onLand still fires so no splat is lost. */
  launch(d: Droplet, onLand?: () => void): void {
    if (this.flights.length >= this.cap) onLand?.();
    else this.flights.push({ d, time: 0, onLand });
  }

  update(dt: number): void {
    const live: Flight[] = [];
    for (const f of this.flights) {
      f.time += dt;
      if (f.time >= f.d.t) f.onLand?.();
      else live.push(f);
    }
    this.flights = live;
    for (let i = 0; i < live.length; i++) {
      dropletAt(live[i].d, live[i].time, tmpV);
      this.attr.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
    }
    this.attr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, live.length);
    this.points.visible = live.length > 0;
  }

  clear(): void {
    this.flights = [];
    this.points.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }
}

interface PoolBlob {
  center: THREE.Vector3;
  radius: number;
  rot: number;
  born: number;
  grow: number;
}

const mP = new THREE.Matrix4();
const mR = new THREE.Matrix4();
const mK = new THREE.Matrix4();

/** The blood pool on the floor: a few instanced quads that grow from a point over POOL_GROW seconds. */
export class BloodPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly ring: (PoolBlob | null)[];
  private readonly tileAttr: THREE.InstancedBufferAttribute;
  private head = 0;
  private live = 0;
  private time = 0;

  constructor(map: THREE.Texture | null = null, cap = 8, tiles = BLOOD_TILES) {
    const { mesh, tileAttr } = splatMesh(map, cap, tiles);
    this.mesh = mesh;
    this.tileAttr = tileAttr;
    this.ring = new Array<PoolBlob | null>(cap).fill(null);
  }

  get count(): number {
    return this.live;
  }

  /** Adds a pool of the given final radius; `at = -Infinity` is fully grown. When full, recycles the oldest. */
  add(center: THREE.Vector3, radius: number, rot: number, tile: number, at = this.time, grow = POOL_GROW): void {
    const slot = this.head;
    this.ring[slot] = { center: center.clone(), radius, rot, born: at, grow };
    this.tileAttr.setX(slot, tile);
    this.tileAttr.needsUpdate = true;
    this.head = (slot + 1) % this.ring.length;
    this.live = Math.min(this.live + 1, this.ring.length);
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.live; i++) {
      const p = this.ring[i]!;
      const k = Math.min(Math.max((this.time - p.born) / p.grow, 0), 1);
      const d = 2 * p.radius * Math.max(0.02, 1 - (1 - k) ** 3);
      mP.makeTranslation(p.center.x, 0.003, p.center.z).multiply(mR.makeRotationY(p.rot)).multiply(mK.makeScale(d, 1, d));
      this.mesh.setMatrixAt(i, mP);
    }
    this.mesh.count = this.live;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.live > 0;
  }

  clear(): void {
    this.ring.fill(null);
    this.head = 0;
    this.live = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}

export type ResolveAnchor = (x: number, z: number, surface: Surface) => { anchor: THREE.Object3D; y: number };
export interface BloodShot {
  seed: number;
  victimHead: THREE.Vector3;
  shooterHead: THREE.Vector3;
  layout: { rx: number; rz: number };
  /** The victim's chair position (floor). */
  chair: THREE.Vector3;
  resolve: ResolveAnchor;
  /** Droplet count, default BLOOD_DROPS. */
  n?: number;
}

export interface BloodSound {
  splat(): void;
  drip(): void;
}

interface Dripper {
  left: number;
  wait: number;
  rnd: () => number;
  head: () => THREE.Vector3 | null;
}

const mW = new THREE.Matrix4();
const mL = new THREE.Matrix4();
const qY = new THREE.Quaternion();
const upY = new THREE.Vector3(0, 1, 0);
const sc = new THREE.Vector3();
const pos = new THREE.Vector3();

/** Orchestrates one execution's blood: spray, splats, pool and head drip. Execute plays it out; settle rebuilds the end state. */
export class Bloodshed {
  readonly splats: BloodSplats;
  readonly drops: BloodDroplets;
  readonly pool: BloodPool;
  private drippers: Dripper[] = [];
  /** Optional sound hooks, driven by sim time: splat on a spray's first landing, drip on each head-drip landing. */
  sound: BloodSound | null = null;
  /** Off by the player's Blood setting: execute and settle do nothing. */
  enabled = true;

  constructor(private readonly parent: THREE.Object3D, map: THREE.Texture | null = null) {
    this.splats = new BloodSplats(map);
    this.drops = new BloodDroplets();
    this.pool = new BloodPool(map);
    parent.add(this.splats.mesh, this.drops.points, this.pool.mesh);
  }

  /** Sprays droplets that splat on landing, grows a pool under the chair and, given a head, drips for POOL_GROW seconds. */
  execute(shot: BloodShot, head?: () => THREE.Vector3 | null): void {
    if (!this.enabled) return;
    let first = true;
    this.each(shot, (d, tile) =>
      this.drops.launch(d, () => {
        if (first) {
          first = false;
          this.sound?.splat();
        }
        this.place(shot, d, tile, undefined);
      }),
    );
    this.addPool(shot, undefined);
    if (head) this.drippers.push({ left: POOL_GROW, wait: 0, rnd: rand(shot.seed + 3), head });
  }

  /** Rebuilds the finished state at once: every splat fully grown, the pool full, no flight or drip. */
  settle(shot: BloodShot): void {
    if (!this.enabled) return;
    this.each(shot, (d, tile) => this.place(shot, d, tile, -Infinity));
    this.addPool(shot, -Infinity);
  }

  update(dt: number): void {
    for (const p of this.drippers) {
      p.left -= dt;
      p.wait -= dt;
      if (p.wait > 0) continue;
      p.wait = 0.45 + 0.45 * p.rnd();
      const h = p.head();
      if (h) this.drops.launch(drip(h), () => this.sound?.drip());
    }
    this.drippers = this.drippers.filter((p) => p.left > 0);
    this.drops.update(dt);
    this.splats.update(dt);
    this.pool.update(dt);
  }

  clear(): void {
    this.drops.clear();
    this.splats.clear();
    this.pool.clear();
    this.drippers = [];
  }

  dispose(): void {
    this.parent.remove(this.splats.mesh, this.drops.points, this.pool.mesh);
    for (const o of [this.splats.mesh, this.drops.points, this.pool.mesh]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }

  private each(shot: BloodShot, fn: (d: Droplet, tile: number) => void): void {
    const tiles = rand(shot.seed + 1);
    for (const d of spray(shot.seed, shot.victimHead, shot.shooterHead, shot.n ?? BLOOD_DROPS, shot.layout)) {
      fn(d, Math.floor(tiles() * BLOOD_TILES));
    }
  }

  private place(shot: BloodShot, d: Droplet, tile: number, at: number | undefined): void {
    const { anchor, y } = shot.resolve(d.land.x, d.land.z, d.surface);
    anchor.updateWorldMatrix(true, false);
    const yaw = Math.atan2(-d.vel.z, d.vel.x);
    mW.compose(pos.set(d.land.x, y + 0.0006, d.land.z), qY.setFromAxisAngle(upY, yaw), sc.set(2 * d.size, 1, 2 * d.size));
    mL.copy(anchor.matrixWorld).invert().multiply(mW);
    this.splats.add(anchor, mL, tile, at);
  }

  private addPool(shot: BloodShot, at: number | undefined): void {
    const r = rand(shot.seed + 2);
    const radius = 0.32 + 0.13 * r();
    this.pool.add(shot.chair, radius, r() * Math.PI * 2, 0, at);
  }
}
