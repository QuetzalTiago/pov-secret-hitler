import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { SMOKE_DUR } from '../client/scene/life';

// Baseline before the patron rebuild (todo #140): meshes / triangles per Character (Sprites excluded).
//   normal 0: 24 / 1012    normal 1: 25 / 1066    normal 2: 25 / 1102    normal 3: 23 / 1042    normal 4: 23 / 972
//   normal 5: 25 / 1032    normal 6: 23 / 1042    normal 7: 25 / 1024    normal 8: 24 / 1090    normal 9: 25 / 1066
//   hitler 0: 36 / 1336
// Budget: at most half the meshes visible at rest (hidden arm rigs are free; the scene is draw-call bound), at least 3x the triangles.
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
  let visible = 0;
  let tris = 0;
  const mats = new Set<THREE.Material>();
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    // Draw calls: a mesh renders only if it and every ancestor are visible (hidden arm rigs cost nothing).
    let shown = true;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) shown = shown && p.visible;
    if (shown) visible++;
    const pos = m.geometry.getAttribute('position');
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
  });
  return { meshes, visible, tris, mats };
}

const cases: [string, number, 'normal' | 'hitler'][] = [
  ...[...Array(10).keys()].map((i) => [`normal ${i}`, i, 'normal'] as [string, number, 'normal']),
  ['hitler 0', 0, 'hitler'],
];

describe.each(cases)('Character %s', (key, style, variant) => {
  const base = BASELINE[key];

  it('stays within the draw-call and triangle budget', () => {
    const { visible: meshes, tris } = measure(new Character(0, style, variant));
    expect(meshes).toBeLessThanOrEqual(Math.floor(base.meshes / 2));
    expect(tris).toBeGreaterThanOrEqual(base.tris * 3);
  });

  it('is never a woman, so it keeps the male death sounds', () => {
    expect(new Character(0, style, variant).woman).toBe(false);
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

describe('Character smoking', () => {
  // Smokers pay upper arm + forearm/hand (cigarette baked in) + ember on top of the non-smoker body.
  const SMOKER_MESHES: [number, number][] = [[0, 10], [3, 9], [6, 9], [9, 10]];
  const NON_SMOKER_MESHES: [string, number, 'normal' | 'hitler', number][] = [
    ['normal 1', 1, 'normal', 8],
    ['normal 2', 2, 'normal', 8],
    ['hitler 0', 0, 'hitler', 10],
  ];
  const DT = 1 / 60;
  const MOUTH = new THREE.Vector3(0.03, 1.3, 0.19);

  function handInBody(c: InstanceType<typeof Character>) {
    c.group.updateMatrixWorld(true);
    const r = (c as any).rig;
    return c.body.worldToLocal(r.fore.localToWorld(new THREE.Vector3(0, 0, r.len2)));
  }

  function smoker() {
    const c = new Character(0, 0);
    (c as any).rig.dragIn = 1e9; // only the forced drag
    return c;
  }

  it.each(SMOKER_MESHES)('style %i smokes with a rig, cigarette and ember within +4 meshes', (style, meshes) => {
    const c = new Character(0, style);
    expect(c.smoker).toBe(true);
    expect(measure(c).visible).toBe(meshes);
    const rig = (c as any).rig;
    expect(rig.ember.material.emissiveIntensity).toBeGreaterThan(0);
    // Cigarette (0.012 thick, 0.078 long) is baked into the forearm mesh.
    const fore = rig.fore.children[0] as THREE.Mesh;
    expect(fore.geometry.getAttribute('color')).toBeDefined();
    expect((c as any).mats).not.toContain(rig.ember.material);
  });

  it.each(NON_SMOKER_MESHES)('%s does not smoke and keeps its mesh count', (_k, style, variant, meshes) => {
    const c = new Character(0, style, variant);
    expect(c.smoker).toBe(false);
    expect(measure(c).visible).toBe(meshes);
    expect(c.smokeEmit(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3())).toBe(-1);
  });

  it('rests the hand where the old arm did, raises it to the mouth for a drag and lowers it again', () => {
    const c = smoker();
    c.update(DT, 0);
    const rest = (c as any).rig.restHand as THREE.Vector3;
    expect(handInBody(c).distanceTo(rest)).toBeLessThan(0.02);
    c.startDrag();
    let now = 0;
    let peak = Infinity;
    let exhaled = 0;
    const tip = new THREE.Vector3();
    const mouth = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 0; i < Math.round((SMOKE_DUR + 0.2) * 60); i++) {
      now += DT;
      c.update(DT, now);
      peak = Math.min(peak, handInBody(c).distanceTo(MOUTH));
      exhaled = Math.max(exhaled, c.smokeEmit(tip, mouth, dir));
    }
    expect(peak).toBeLessThan(0.08);
    expect(exhaled).toBeGreaterThan(0.5);
    expect(handInBody(c).distanceTo(rest)).toBeLessThan(0.02);
    // Between drags the mouth is not puffing, and the vectors are world points near the head.
    expect(c.smokeEmit(tip, mouth, dir)).toBe(0);
    expect(mouth.y).toBeGreaterThan(1.2);
    expect(dir.length()).toBeCloseTo(1, 5);
  });

  it('goes silent and dark when dead', () => {
    const c = smoker();
    c.startDrag();
    for (let i = 0; i < 100; i++) c.update(DT, i * DT);
    c.die();
    for (let i = 0; i < 10; i++) c.update(DT, 2 + i * DT);
    expect(c.smokeEmit(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3())).toBe(-1);
    expect((c as any).rig.ember.material.emissiveIntensity).toBe(0);
    expect(handInBody(c).distanceTo((c as any).rig.restHand)).toBeLessThan(0.02);
  });
});

describe('Character hands up', () => {
  const DT = 1 / 60;
  const settle = (c: InstanceType<typeof Character>, from = 0) => {
    for (let i = 0; i < 90; i++) c.update(DT, from + i * DT);
  };
  const rigs = (c: InstanceType<typeof Character>) => (c as any).handsUpArms as { shoulder: THREE.Group }[];

  it('a non-smoker swaps the resting left arm for the surrender rigs and back', () => {
    const c = new Character(0, 1);
    settle(c);
    const left = (c as any).restArmLeft as THREE.Mesh[];
    expect(left).toHaveLength(1);
    expect(left[0].visible).toBe(true);
    expect(rigs(c).every((r) => !r.shoulder.visible)).toBe(true);
    c.setHandsUp(true);
    settle(c, 2);
    expect(left[0].visible).toBe(false);
    expect((c as any).restArm.every((m: THREE.Object3D) => !m.visible)).toBe(true);
    expect(rigs(c)).toHaveLength(2);
    expect(rigs(c).every((r) => r.shoulder.visible)).toBe(true);
    c.setHandsUp(false);
    settle(c, 4);
    expect(left[0].visible).toBe(true);
    expect(rigs(c).every((r) => !r.shoulder.visible)).toBe(true);
  });

  it('keeps the Hitler armband on the left rest arm mesh', () => {
    const c = new Character(0, 0, 'hitler');
    expect((c as any).restArmLeft).toHaveLength(1);
  });

  it('a smoker hides its smoking arm, cancels the drag and emits nothing while hands are up', () => {
    const c = new Character(0, 0);
    const rig = (c as any).rig;
    rig.dragIn = 1e9;
    c.startDrag();
    for (let i = 0; i < 20; i++) c.update(DT, i * DT);
    expect(rig.dragT).not.toBeNull();
    const out = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
    c.setHandsUp(true);
    settle(c, 1);
    expect(rig.upper.visible).toBe(false);
    expect(rig.dragT).toBeNull();
    expect(rig.dragIn).toBeGreaterThanOrEqual(3);
    expect(rigs(c).every((r) => r.shoulder.visible)).toBe(true);
    expect(c.smokeEmit(...out)).toBe(-1);
    c.setHandsUp(false);
    settle(c, 3);
    expect(rig.upper.visible).toBe(true);
    expect(rigs(c).every((r) => !r.shoulder.visible)).toBe(true);
    expect(c.smokeEmit(...out)).toBeGreaterThanOrEqual(0);
  });
});
