import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBackBar, chairModel, lampModel, normalizeProp, stoolModel } from '../client/scene/roomprops';

const PROPS = path.resolve(__dirname, '../client/models/props');
const NAMES = ['chair_wood', 'stool_wood', 'lamp_pendant', 'bottle_old', 'bottle_a', 'bottle_b', 'bottle_wine', 'glass_vodka', 'glass_cognac', 'glass_wine'];
const props: Record<string, THREE.Group> = {};

beforeAll(async () => {
  // Texture decoding needs browser APIs; stub them so the real GLBs still parse in node.
  (globalThis as any).self ??= globalThis;
  (globalThis as any).createImageBitmap ??= async () => ({ width: 4, height: 4, close() {} });
  for (const n of NAMES) {
    const buf = fs.readFileSync(path.join(PROPS, `${n}.glb`));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    props[n] = (await new GLTFLoader().parseAsync(ab, '')).scene;
  }
});

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => {
    if (((c as THREE.Mesh).isMesh || (c as THREE.InstancedMesh).isInstancedMesh) && c.visible) out.push(c as THREE.Mesh);
  });
  return out;
}

function bounds(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
}

describe('normalizeProp', () => {
  it('stands on y 0 at the requested height, centred in x/z', () => {
    for (const n of NAMES) {
      const b = bounds(normalizeProp(props[n], 0.3));
      expect(Math.abs(b.min.y)).toBeLessThan(1e-3);
      expect(Math.abs(b.max.y - 0.3)).toBeLessThan(1e-3);
      expect(Math.abs(b.min.x + b.max.x)).toBeLessThan(1e-3);
      expect(Math.abs(b.min.z + b.max.z)).toBeLessThan(1e-3);
    }
  });

  it('does not touch the source', () => {
    const before = bounds(props.chair_wood).max.y;
    normalizeProp(props.chair_wood, 5);
    expect(bounds(props.chair_wood).max.y).toBe(before);
  });
});

describe('buildBackBar', () => {
  it('draws 40+ bottles and the glasses in at most 4 meshes', () => {
    const bar = buildBackBar(props);
    expect(bar.userData.bottles).toBeGreaterThanOrEqual(40);
    const drawn = meshes(bar);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThanOrEqual(4);
  });

  it('sits on the shelves and the counter, glass is transparent without depth writes', () => {
    const bar = buildBackBar(props);
    const b = bounds(bar);
    expect(b.min.y).toBeGreaterThan(1.0);
    expect(b.max.y).toBeLessThan(3.0);
    const glass = meshes(bar).filter((m) => (m.material as THREE.Material).transparent);
    expect(glass).toHaveLength(1);
    expect((glass[0].material as THREE.MeshStandardMaterial).depthWrite).toBe(false);
  });
});

describe('chairModel', () => {
  it('is one shadow-casting mesh about 0.9 m tall', () => {
    const chair = chairModel(props);
    const m = meshes(chair);
    expect(m).toHaveLength(1);
    expect(m[0].castShadow).toBe(true);
    const b = bounds(chair);
    expect(Math.abs(b.max.y - b.min.y - 0.9)).toBeLessThan(0.1);
    expect(Math.abs(b.min.y)).toBeLessThan(1e-3);
  });

  function backrestZ(chair: THREE.Group): number {
    const p = (meshes(chair)[0].geometry as THREE.BufferGeometry).getAttribute('position');
    let sum = 0;
    let n = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.6 * 0.96) {
        sum += p.getZ(i);
        n++;
      }
    }
    return sum / n;
  }

  it('has its backrest on +Z', () => {
    expect(backrestZ(chairModel(props))).toBeGreaterThan(0);
  });

  it('turns a chair modelled with its back on -Z and keeps one already on +Z', () => {
    for (const backZ of [-0.24, 0.24]) {
      const fake = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x663311 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.48), mat);
      seat.position.y = 0.45;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.06), mat);
      back.position.set(0, 0.6, backZ);
      fake.add(seat, back);
      expect(backrestZ(chairModel({ chair_wood: fake }))).toBeGreaterThan(0);
    }
  });
});

describe('stoolModel', () => {
  it('is one mesh with the seat at 0.78 m', () => {
    const stool = stoolModel(props);
    expect(meshes(stool)).toHaveLength(1);
    expect(Math.abs(bounds(stool).max.y - 0.78)).toBeLessThan(1e-3);
  });
});

describe('lampModel', () => {
  it('has no transmissive material, an emissive glass and a ~0.45 m shade', () => {
    const lamp = lampModel(props);
    const mats = meshes(lamp).map((m) => m.material as THREE.MeshPhysicalMaterial);
    expect(mats.length).toBeGreaterThan(0);
    for (const m of mats) expect(m.transmission ?? 0).toBe(0);
    expect(mats.some((m) => m.emissiveIntensity > 0 && m.emissive.getHex() === 0xffb060)).toBe(true);
    const size = bounds(lamp).getSize(new THREE.Vector3());
    expect(Math.abs(Math.max(size.x, size.z) - 0.45)).toBeLessThan(0.01);
    // The source still has its transmissive glass.
    expect(meshes(props.lamp_pendant).some((m) => ((m.material as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0)).toBe(true);
  });
});
