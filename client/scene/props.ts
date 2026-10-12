// Physical props on the table.
import * as THREE from 'three';
import {
  BOARD_SLOTS, ballotFace, boardTexture, cardBack, envelopeTexture, placardTexture, policyFace, ringTexture,
} from './textures';
import { ease, tween, type Tween } from './tween';
import { TABLE_Y } from './world';

export const CARD_W = 0.13;
export const CARD_H = 0.18;

/** A thin card: face texture on +Y, back texture on -Y. Lying flat face-up by default. */
export class Card {
  mesh: THREE.Mesh;
  private faceMat: THREE.MeshStandardMaterial;
  private backMat: THREE.MeshStandardMaterial;
  constructor(face: THREE.Texture | null, back: THREE.Texture, scale = 1) {
    const edge = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.8 });
    this.faceMat = new THREE.MeshStandardMaterial({ map: face ?? back, roughness: 0.7 });
    this.backMat = new THREE.MeshStandardMaterial({ map: back, roughness: 0.7 });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W * scale, 0.003, CARD_H * scale), [
      edge, edge, this.faceMat, this.backMat, edge, edge,
    ]);
    this.mesh.castShadow = true;
  }
  setFace(t: THREE.Texture) {
    if (this.faceMat.map !== t) {
      this.faceMat.map = t;
      this.faceMat.needsUpdate = true;
    }
  }
  setGlow(v: number, tint?: 'discard' | 'enact') {
    const [r, g, b] = tint === 'discard' ? [0.45, 0.08, 0.05] : tint === 'enact' ? [0.08, 0.35, 0.12] : [0.35, 0.3, 0.15];
    this.faceMat.emissive.setRGB(v * r, v * g, v * b);
    this.backMat.emissive.setRGB(v * r, v * g, v * b);
  }
}

export function policyCard(): Card {
  return new Card(policyFace('L'), cardBack('POLICY'));
}

export function ballotCard(ja: boolean): Card {
  return new Card(ballotFace(ja), cardBack('BALLOT'));
}

export class Placard {
  mesh: THREE.Mesh;
  constructor(title: string, color: string) {
    const t = placardTexture(title, color);
    const side = new THREE.MeshStandardMaterial({ color: 0x1c130c });
    const face = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25 });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.085, 0.03), [side, side, side, side, face, face]);
    this.mesh.castShadow = true;
  }
}

/** Soft gold rings on the table in front of every seat the game is waiting on: one InstancedMesh, one draw call. */
export class ActingRings {
  mesh: THREE.InstancedMesh;
  private seats = new Map<number, { amt: number; tween: Tween | null }>();
  /** Seats currently asked for (the rest are fading out). */
  private lit = new Set<number>();
  private pulse = { k: 0.65 };
  private m = new THREE.Matrix4();
  private c = new THREE.Color();

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, 10);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < 10; i++) this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.loop(1);
  }

  /** Breathe the shared brightness between 0.65 and 1, forever. */
  private loop(to: number) {
    tween(this.pulse, { k: to }, { dur: 0.9, ease: ease.inOutCubic, onDone: () => this.loop(to === 1 ? 0.65 : 1) });
  }

  /** Ring exactly these seats: new ones fade in, ones that left fade out. */
  set(seats: number[]) {
    for (const s of seats) {
      if (this.lit.has(s)) continue;
      this.lit.add(s);
      const e = this.seats.get(s) ?? { amt: 0, tween: null };
      this.seats.set(s, e);
      e.tween?.cancel();
      e.tween = tween(e, { amt: 1 }, { dur: 0.35, ease: ease.outQuad });
    }
    for (const s of [...this.lit]) {
      if (seats.includes(s)) continue;
      this.lit.delete(s);
      const e = this.seats.get(s);
      if (!e) continue;
      e.tween?.cancel();
      e.tween = tween(e, { amt: 0 }, { dur: 0.5, onDone: () => this.seats.delete(s) });
    }
  }

  update(pos: (seat: number) => THREE.Vector3) {
    let n = 0;
    this.seats.forEach((e, seat) => {
      if (e.amt <= 0.001) return;
      const p = pos(seat);
      this.m.makeScale(0.46, 0.46, 0.46).setPosition(p.x, p.y + 0.003, p.z);
      this.mesh.setMatrixAt(n, this.m);
      const k = e.amt * this.pulse.k * 0.8;
      this.mesh.setColorAt(n, this.c.setRGB(k, 0.78 * k, 0.38 * k));
      n++;
    });
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}

export class Envelope {
  mesh: THREE.Mesh;
  constructor() {
    const t = envelopeTexture();
    const edge = new THREE.MeshStandardMaterial({ color: 0xb8a37a });
    const top = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.008, 0.155), [edge, edge, top, edge, edge, edge]);
    this.mesh.castShadow = true;
  }
  setGlow(v: number) {
    const m = (this.mesh.material as THREE.MeshStandardMaterial[])[2];
    m.emissive.setRGB(v * 0.3, v * 0.25, v * 0.1);
  }
}

/** Central board with both tracks and the election tracker. */
export class Board {
  group = new THREE.Group();
  readonly w = 1.0;
  readonly h = 0.625;
  private surface: THREE.Mesh;
  liberalTiles: THREE.Mesh[] = [];
  fascistTiles: THREE.Mesh[] = [];
  token: THREE.Mesh;
  private powersKey = '';

  constructor() {
    this.surface = new THREE.Mesh(
      new THREE.BoxGeometry(this.w, 0.012, this.h),
      new THREE.MeshStandardMaterial({ color: 0x2b1d12, roughness: 0.6 }),
    );
    this.surface.receiveShadow = true;
    this.group.add(this.surface);
    const tileGeo = new THREE.BoxGeometry(0.105, 0.006, 0.145);
    const edge = new THREE.MeshStandardMaterial({ color: 0xd8ccb0 });
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(tileGeo, [edge, edge, new THREE.MeshStandardMaterial({ map: policyFace('L') }), edge, edge, edge]);
      m.visible = false;
      m.castShadow = true;
      this.liberalTiles.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(tileGeo, [edge, edge, new THREE.MeshStandardMaterial({ map: policyFace('F') }), edge, edge, edge]);
      m.visible = false;
      m.castShadow = true;
      this.fascistTiles.push(m);
      this.group.add(m);
    }
    this.token = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.016, 16),
      new THREE.MeshStandardMaterial({ color: 0xd6a84a, metalness: 0.8, roughness: 0.3, emissive: 0x3a2a0a }),
    );
    this.token.castShadow = true;
    this.group.add(this.token);
    this.group.position.set(0, TABLE_Y + 0.006, -0.02);
  }

  setPowers(powers: (string | null)[]) {
    const key = powers.join(',');
    if (key === this.powersKey) return;
    this.powersKey = key;
    const t = boardTexture(powers);
    const side = new THREE.MeshStandardMaterial({ color: 0x1c130c });
    for (const m of new Set([this.surface.material].flat())) m.dispose();
    this.surface.material = [side, side, new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }), side, side, side];
  }

  /** Local position of a board slot. */
  slot(kind: 'liberal' | 'fascist' | 'tracker', i: number): THREE.Vector3 {
    const [u, v] = BOARD_SLOTS[kind](i);
    return new THREE.Vector3((u - 0.5) * this.w, 0.01, (v - 0.5) * this.h);
  }
}

/** A stack of face-down cards whose height tracks a count. */
export class Pile {
  group = new THREE.Group();
  private stack: THREE.Mesh;
  constructor(label: string, public at: THREE.Vector3) {
    const edge = new THREE.MeshStandardMaterial({ color: 0xcfc2a5, roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: cardBack(label), roughness: 0.7 });
    this.stack = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 1, CARD_H), [edge, edge, top, edge, edge, edge]);
    this.stack.castShadow = true;
    this.group.add(this.stack);
    this.group.position.copy(at);
  }
  setCount(n: number) {
    const h = Math.max(0.0001, n * 0.0028);
    this.stack.scale.y = h;
    this.stack.position.y = h / 2;
    this.stack.visible = n > 0;
  }
  topPosition(): THREE.Vector3 {
    return this.group.position.clone().setY(this.group.position.y + this.stack.scale.y + 0.004);
  }
}

/** A chunky, original-design six-shooter built from primitives. Points along -Z. */
export function revolver(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.85, roughness: 0.32 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.6 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.17, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.1);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 6), metal);
  cyl.rotation.x = Math.PI / 2;
  cyl.position.set(0, 0.022, 0.0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.04, 0.08), metal);
  frame.position.set(0, 0.03, 0.03);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.045), grip);
  handle.position.set(0, -0.025, 0.07);
  handle.rotation.x = -0.35;
  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.015), metal);
  hammer.position.set(0, 0.058, 0.055);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 10, Math.PI), metal);
  guard.position.set(0, 0.0, 0.03);
  guard.rotation.y = Math.PI / 2;
  guard.rotation.z = Math.PI;
  g.add(barrel, cyl, frame, handle, hammer, guard);
  g.traverse((o) => (o.castShadow = true));
  g.scale.setScalar(1.4);
  return g;
}
