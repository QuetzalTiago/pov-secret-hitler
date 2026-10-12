import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareCharacter, type CharacterTemplate, type Outfit } from '../client/scene/assets';

const MODELS = path.resolve(__dirname, '../client/models');
const FILES: Record<Outfit, string> = { suit: 'man_suit', shirt: 'man_casual', dress: 'woman_dress' };

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

type Rigged = typeof import('../client/scene/rigged');
type Chars = typeof import('../client/scene/characters');
let RiggedCharacter: Rigged['RiggedCharacter'];
let chars: Chars;
const templates = {} as Record<Outfit, CharacterTemplate>;
// Template used for each style by the default (assets) lookup, replicated for the injected one.
const OUTFIT = (i: number, variant: 'normal' | 'hitler'): Outfit => (variant === 'hitler' ? 'suit' : i === 2 || i === 7 ? 'dress' : i === 5 || i === 8 ? 'shirt' : 'suit');

beforeAll(async () => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }),
  };
  ({ RiggedCharacter } = await import('../client/scene/rigged'));
  chars = await import('../client/scene/characters');
  for (const o of Object.keys(FILES) as Outfit[]) {
    const buf = fs.readFileSync(path.join(MODELS, 'chars', `${FILES[o]}.glb`));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    templates[o] = prepareCharacter(await new GLTFLoader().parseAsync(ab, ''), o);
  }
});

const build = (i: number, variant: 'normal' | 'hitler' = 'normal') => new RiggedCharacter(i, i, variant, templates[OUTFIT(i, variant)]);

function measure(c: InstanceType<Rigged['RiggedCharacter']>) {
  let visible = 0;
  let tris = 0;
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let shown = true;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) shown = shown && p.visible;
    if (!shown) return;
    visible++;
    const pos = m.geometry.getAttribute('position');
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
  });
  return { visible, tris };
}

function boneY(c: InstanceType<Rigged['RiggedCharacter']>, name: string): number {
  let y = NaN;
  c.group.traverse((o) => {
    if (o.name === name && (o as THREE.Bone).isBone) y = o.getWorldPosition(new THREE.Vector3()).y;
  });
  return y;
}

const cases: [string, number, 'normal' | 'hitler'][] = [
  ...[...Array(10).keys()].map((i) => [`normal ${i}`, i, 'normal'] as [string, number, 'normal']),
  ['hitler 0', 0, 'hitler'],
];

describe.each(cases)('RiggedCharacter %s', (_key, style, variant) => {
  it('stays within the draw-call and triangle budget', () => {
    const { visible, tris } = measure(build(style, variant));
    expect(visible).toBeLessThanOrEqual(3);
    expect(tris).toBeLessThanOrEqual(6000);
  });

  it('sits with the head above the hips', () => {
    const c = build(style, variant);
    c.update(0.016, 0);
    c.group.updateMatrixWorld(true);
    const head = boneY(c, 'Head');
    const hips = boneY(c, 'Hips');
    expect(head).toBeGreaterThanOrEqual(1.1);
    expect(head).toBeLessThanOrEqual(1.5);
    expect(hips).toBeGreaterThanOrEqual(0.5);
    expect(hips).toBeLessThanOrEqual(0.65);
  });

  it('has the Patron members the game uses', () => {
    const c = build(style, variant);
    expect(c.hitMeshes).toHaveLength(1);
    expect(c.smoker).toBe(variant !== 'hitler' && style % 3 === 0);
    expect(c.smokeEmit(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3())).toBe(-1);
    c.setLabel('Seat', '#fff');
    c.say('hello', 0);
    c.setHighlight(true);
    c.setTeamGlow(true);
    c.lookAt(new THREE.Vector3(0, 1, 2));
    c.setAim(new THREE.Vector3(1, 1, 1));
    c.setHandsUp(true);
    c.react('nod');
    c.recoil();
    for (let i = 0; i < 10; i++) c.update(0.05, i * 0.05);
    c.group.updateMatrixWorld(true);
    expect(c.gunPose().pos.y).toBeGreaterThan(0);
    c.die();
    for (let i = 0; i < 30; i++) c.update(0.1, 1 + i * 0.1);
    expect(c.dead).toBe(true);
    expect(() => c.dispose()).not.toThrow();
  });
});

describe('RiggedCharacter styles and disposal', () => {
  it('styles get different coat colours', () => {
    const colorAt = (c: InstanceType<Rigged['RiggedCharacter']>, t: CharacterTemplate, part: string) => {
      const mesh = c.hitMeshes[0] as THREE.SkinnedMesh;
      const a = mesh.geometry.getAttribute('color');
      const i = t.parts[part].start;
      return [a.getX(i), a.getY(i), a.getZ(i)];
    };
    const a = build(0);
    const b = build(1);
    expect(colorAt(a, templates.suit, 'Shirt')).not.toEqual(colorAt(b, templates.suit, 'Shirt'));
    expect(colorAt(a, templates.suit, 'Skin')).not.toEqual(colorAt(b, templates.suit, 'Skin'));
    // And the template keeps its own colours.
    const tc = templates.suit.mesh.geometry.getAttribute('color');
    expect([tc.getX(0), tc.getY(0), tc.getZ(0)]).not.toEqual(colorAt(a, templates.suit, 'Shirt'));
    const dress = build(2);
    const dress2 = build(7);
    expect(colorAt(dress, templates.dress, 'Dress')).not.toEqual(colorAt(dress2, templates.dress, 'Dress'));
  });

  it('dispose leaves the template geometry intact', () => {
    const g = templates.suit.mesh.geometry;
    const before = g.getAttribute('position').array.length;
    const c = build(0);
    expect((c.hitMeshes[0] as THREE.Mesh).geometry).not.toBe(g);
    c.dispose();
    expect(g.getAttribute('position').array.length).toBe(before);
    expect(g.getAttribute('skinWeight').array.length).toBeGreaterThan(0);
    expect(() => build(3)).not.toThrow();
  });

  it('createCharacter falls back to the procedural patron without assets', () => {
    const p = chars.createCharacter(0, 0, 'normal');
    expect(p).toBeInstanceOf(chars.Character);
    p.dispose();
  });
});
