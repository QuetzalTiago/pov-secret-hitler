import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareCharacter, type CharacterTemplate, type Outfit } from '../client/scene/assets';

const MODELS = path.resolve(__dirname, '../client/models');
const FILES: Record<Outfit, string> = { suit: 'man_suit', shirt: 'man_casual', dress: 'woman_dress' };

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const chars = {} as Record<Outfit, CharacterTemplate>;

beforeAll(async () => {
  for (const o of Object.keys(FILES) as Outfit[]) {
    const buf = fs.readFileSync(path.join(MODELS, 'chars', `${FILES[o]}.glb`));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    chars[o] = prepareCharacter(await new GLTFLoader().parseAsync(ab, ''), o);
  }
});

describe('character templates', () => {
  it('every character shares the 31-bone skeleton', () => {
    const ref = [...chars.suit.bones].sort();
    expect(ref).toHaveLength(31);
    // GLTFLoader strips dots from node names (UpperArm.R -> UpperArmR), as it does in animation track names.
    for (const n of ['Head', 'Neck', 'UpperArmR', 'LowerArmR', 'PalmR', 'Hips']) expect(ref).toContain(n);
    expect([...chars.shirt.bones].sort()).toEqual(ref);
    expect([...chars.dress.bones].sort()).toEqual(ref);
  });

  it('prepared character is one skinned mesh with vertex colours', () => {
    for (const c of Object.values(chars)) {
      const skinned: THREE.SkinnedMesh[] = [];
      c.root.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) skinned.push(o as THREE.SkinnedMesh);
      });
      expect(skinned).toEqual([c.mesh]);
      const g = c.mesh.geometry;
      for (const a of ['color', 'position', 'skinIndex', 'skinWeight']) expect(g.getAttribute(a)).toBeDefined();
      const entries = Object.values(c.parts);
      expect(entries.length).toBeGreaterThanOrEqual(3);
      expect(entries.reduce((s, p) => s + p.count, 0)).toBe(g.getAttribute('position').count);
    }
    expect(Object.keys(chars.suit.parts).some((k) => k.includes('Skin'))).toBe(true);
  });

  it('normalised to unit height with feet at 0', () => {
    for (const c of Object.values(chars)) {
      c.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(c.root, true);
      expect(Math.abs(box.min.y)).toBeLessThan(0.02);
      expect(Math.abs(box.max.y - box.min.y - 1)).toBeLessThan(0.02);
    }
  });

  it('clips are keyed by bare name', () => {
    for (const c of Object.values(chars)) {
      for (const n of ['Sitting', 'Idle', 'Death']) expect(c.clips[n]?.duration).toBeGreaterThan(0);
    }
  });

  it('triangle budget', () => {
    for (const c of Object.values(chars)) {
      const g = c.mesh.geometry;
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      expect(tris).toBeLessThanOrEqual(6000);
    }
  });
});

describe('model budget', () => {
  it('stays within the byte limits', () => {
    const size = (files: string[]) => files.filter((f) => !f.endsWith('.md')).reduce((s, f) => s + fs.statSync(f).size, 0);
    expect(size(walk(MODELS))).toBeLessThanOrEqual(4_000_000);
    expect(size(walk(path.join(MODELS, 'chars')))).toBeLessThanOrEqual(1_500_000);
  });
});
