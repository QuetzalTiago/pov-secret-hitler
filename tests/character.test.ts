import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

// Baseline before the patron rebuild (todo #140): meshes / triangles per Character (Sprites excluded).
//   normal 0: 24 / 1012    normal 1: 25 / 1066    normal 2: 25 / 1102    normal 3: 23 / 1042    normal 4: 23 / 972
//   normal 5: 25 / 1032    normal 6: 23 / 1042    normal 7: 25 / 1024    normal 8: 24 / 1090    normal 9: 25 / 1066
//   hitler 0: 36 / 1336
// Budget: at most half the meshes (the scene is draw-call bound), at least 3x the triangles.
const BASELINE: Record<string, { meshes: number; tris: number }> = {
  'normal 0': { meshes: 24, tris: 1012 },
  'normal 1': { meshes: 25, tris: 1066 },
  'normal 2': { meshes: 25, tris: 1102 },
  'normal 3': { meshes: 23, tris: 1042 },
  'normal 4': { meshes: 23, tris: 972 },
  'normal 5': { meshes: 25, tris: 1032 },
  'normal 6': { meshes: 23, tris: 1042 },
  'normal 7': { meshes: 25, tris: 1024 },
  'normal 8': { meshes: 24, tris: 1090 },
  'normal 9': { meshes: 25, tris: 1066 },
  'hitler 0': { meshes: 36, tris: 1336 },
};

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

let Character: typeof import('../client/scene/characters').Character;

beforeAll(async () => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }),
  };
  ({ Character } = await import('../client/scene/characters'));
});

function measure(c: InstanceType<typeof Character>) {
  let meshes = 0;
  let tris = 0;
  const mats = new Set<THREE.Material>();
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const pos = m.geometry.getAttribute('position');
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
  });
  return { meshes, tris, mats };
}

const cases: [string, number, 'normal' | 'hitler'][] = [
  ...[...Array(10).keys()].map((i) => [`normal ${i}`, i, 'normal'] as [string, number, 'normal']),
  ['hitler 0', 0, 'hitler'],
];

describe.each(cases)('Character %s', (key, style, variant) => {
  const base = BASELINE[key];

  it('stays within the draw-call and triangle budget', () => {
    const { meshes, tris } = measure(new Character(0, style, variant));
    expect(meshes).toBeLessThanOrEqual(Math.floor(base.meshes / 2));
    expect(tris).toBeGreaterThanOrEqual(base.tris * 3);
  });

  it('has hit meshes and smooth-shaded materials', () => {
    const c = new Character(0, style, variant);
    expect(c.hitMeshes.length).toBeGreaterThan(0);
    for (const m of measure(c).mats) expect((m as THREE.MeshStandardMaterial).flatShading).toBe(false);
  });

  it('updates, dies and disposes without throwing', () => {
    const c = new Character(0, style, variant);
    c.setLabel('Test');
    for (let i = 0; i < 5; i++) c.update(0.016, i * 0.016);
    c.setAim(new THREE.Vector3(1, 1.2, 2), 'point');
    c.react('fist');
    for (let i = 0; i < 20; i++) c.update(0.1, 1 + i * 0.1);
    c.die();
    for (let i = 0; i < 5; i++) c.update(0.016, 4 + i * 0.016);
    expect(() => c.dispose()).not.toThrow();
  });
});

describe('Character rig', () => {
  it('blinks by scaling the single merged eye mesh and hides the rest arm while aiming', () => {
    const c = new Character(0, 1);
    c.update(0.016, 0);
    const eyes = (c as any).eyes as THREE.Mesh[];
    expect(eyes).toHaveLength(1);
    c.dead = true;
    c.update(0.016, 1);
    expect(eyes[0].scale.y).toBeCloseTo(0.1, 5);

    const d = new Character(0, 1);
    d.setAim(new THREE.Vector3(0, 1.2, 2));
    for (let i = 0; i < 40; i++) d.update(0.05, i * 0.05);
    expect((d as any).restArm.every((m: THREE.Object3D) => !m.visible)).toBe(true);
    expect((d as any).aimArm.visible).toBe(true);
  });
});
