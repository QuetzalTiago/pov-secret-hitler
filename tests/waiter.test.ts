import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareCharacter, type CharacterTemplate } from '../client/scene/assets';

const MODELS = path.resolve(__dirname, '../client/models');

// Minimal fake canvas so textures.ts can run in node.
function fakeCtx() {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 10 });
      if (k === 'getImageData')
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k in t) return t[k];
      return () => ({ addColorStop() {} });
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
}

type WaiterMod = typeof import('../client/scene/waiter');
let mod: WaiterMod;
let tpl: CharacterTemplate;
let glassSrc: THREE.Object3D;

const load = async (file: string) => {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new GLTFLoader().parseAsync(ab, '');
};

beforeAll(async () => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }),
  };
  // Texture decoding needs browser APIs; stub them so the real GLBs still parse in node.
  (globalThis as any).self ??= globalThis;
  (globalThis as any).createImageBitmap ??= async () => ({ width: 4, height: 4, close() {} });
  mod = await import('../client/scene/waiter');
  tpl = prepareCharacter(await load(path.join(MODELS, 'chars', 'man_casual.glb')), 'shirt');
  glassSrc = (await load(path.join(MODELS, 'props', 'glass_wine.glb'))).scene;
});

function build() {
  const w = new mod.Waiter(tpl, glassSrc);
  w.group.position.set(mod.WAITER_SPOT.x, 0, mod.WAITER_SPOT.z);
  w.group.updateMatrixWorld(true);
  return w;
}

const skinned = (w: InstanceType<WaiterMod['Waiter']>) => {
  let m!: THREE.SkinnedMesh;
  w.group.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) m = o as THREE.SkinnedMesh;
  });
  return m;
};

const bone = (w: InstanceType<WaiterMod['Waiter']>, name: string) => skinned(w).skeleton.bones.find((b) => b.name === name)!;

/** Lowest world y of the soles, and the most backward z among skinned vertices above `y`. */
function extents(w: InstanceType<WaiterMod['Waiter']>, above = 1.4) {
  w.group.updateMatrixWorld(true);
  const mesh = skinned(w);
  mesh.skeleton.update();
  const v = new THREE.Vector3();
  const feet = new Set([bone(w, 'FootL'), bone(w, 'FootR')].map((b) => mesh.skeleton.bones.indexOf(b)));
  const si = mesh.geometry.getAttribute('skinIndex');
  const sw = mesh.geometry.getAttribute('skinWeight');
  let footY = Infinity;
  let backZ = Infinity;
  for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    let top = -1;
    let best = 0;
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > best) [best, top] = [sw.getComponent(i, k), si.getComponent(i, k)];
    if (feet.has(top)) footY = Math.min(footY, v.y);
    if (v.y > above) backZ = Math.min(backZ, v.z);
  }
  return { footY, backZ };
}

function glassBox(w: InstanceType<WaiterMod['Waiter']>) {
  w.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  w.group.children.forEach((c) => {
    if (c.type === 'Object3D' && c.children.length) box.union(new THREE.Box3().setFromObject(c, true));
  });
  return box;
}

describe('bump', () => {
  it('rises smoothly from 0 to 1 and back', () => {
    expect(mod.bump(0)).toBe(0);
    expect(mod.bump(1)).toBe(0);
    expect(mod.bump(0.5)).toBeCloseTo(1, 5);
    expect(mod.bump(0.1)).toBeGreaterThan(0);
    expect(mod.bump(0.1)).toBeLessThan(mod.bump(0.2));
  });
});

describe('Waiter', () => {
  it('stands with the soles on the floor', () => {
    const { footY } = extents(build());
    expect(Math.abs(footY)).toBeLessThan(0.03);
  });

  it('keeps everything above 1.40 m in front of the shelves, also while looking up at the glass', () => {
    const w = build();
    expect(extents(w).backZ).toBeGreaterThan(-4.7);
    for (let i = 0; i < 15 * 30; i++) {
      w.update(1 / 30);
      expect(extents(w).backZ).toBeGreaterThan(-4.7);
    }
  });

  it('holds the glass above the counter top, in front of its back face', () => {
    const box = glassBox(build());
    expect(box.min.y).toBeGreaterThan(1.05);
    expect(box.min.z).toBeGreaterThan(-4.55);
  });

  it('rubs: the right hand moves but stays near the glass', () => {
    const w = build();
    const hand = bone(w, 'MiddleHandR');
    const p0 = hand.getWorldPosition(new THREE.Vector3());
    let moved = 0;
    for (let i = 0; i < 6; i++) {
      w.update(0.2);
      w.group.updateMatrixWorld(true);
      const p = hand.getWorldPosition(new THREE.Vector3());
      moved = Math.max(moved, p.distanceTo(p0));
      expect(p.distanceTo(glassBox(w).getCenter(new THREE.Vector3()))).toBeLessThan(0.12);
    }
    expect(moved).toBeGreaterThan(0.005);
  });

  it('runs 15 s without NaN and lifts the glass at some point', () => {
    const w = build();
    const y0 = glassBox(w).getCenter(new THREE.Vector3()).y;
    let maxY = y0;
    for (let i = 0; i < 15 * 30; i++) {
      w.update(1 / 30);
      for (const b of skinned(w).skeleton.bones) {
        expect(Number.isNaN(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w)).toBe(false);
      }
      maxY = Math.max(maxY, glassBox(w).getCenter(new THREE.Vector3()).y);
    }
    expect(maxY).toBeGreaterThan(y0 + 0.05);
  });
});
