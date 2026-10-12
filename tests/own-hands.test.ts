import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareCharacter, type CharacterTemplate, type Outfit } from '../client/scene/assets';
import { handGeometry } from '../client/scene/hands';
import { riggedHandGeometry } from '../client/scene/ownhands';

const MODELS = path.resolve(__dirname, '../client/models');
const FILES: Record<Outfit, string> = { suit: 'man_suit', shirt: 'man_casual', dress: 'woman_dress' };
const templates = {} as Record<Outfit, CharacterTemplate>;

beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
  for (const o of Object.keys(FILES) as Outfit[]) {
    const buf = fs.readFileSync(path.join(MODELS, 'chars', `${FILES[o]}.glb`));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    templates[o] = prepareCharacter(await new GLTFLoader().parseAsync(ab, ''), o);
  }
});

const boxOf = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!.clone();
};
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

describe.each(['suit', 'shirt', 'dress'] as Outfit[])('riggedHandGeometry %s', (outfit) => {
  describe.each([1, -1] as const)('side %i', (side) => {
    it('is a position + normal mitten in the frame of the procedural flat hand', () => {
      const g = riggedHandGeometry(templates[outfit], side, 'flat');
      expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position']);
      expect(tris(g)).toBeGreaterThan(20);
      const ref = boxOf(handGeometry('flat', side));
      const b = boxOf(g);
      expect((b.max.z - b.min.z) / (ref.max.z - ref.min.z)).toBeGreaterThan(0.7);
      expect((b.max.z - b.min.z) / (ref.max.z - ref.min.z)).toBeLessThan(1.3);
      expect(b.max.z).toBeGreaterThan(0.05);
      expect(b.min.z).toBeCloseTo(ref.min.z, 2);
      expect(Math.abs(b.min.y + 0.02)).toBeLessThan(0.01);
      // Lies flat: wider than it is thick.
      expect(b.max.x - b.min.x).toBeGreaterThan(2 * (b.max.y - b.min.y));
    });

    it('has the thumb toward the body midline (-side X) and the fist shorter than the flat hand', () => {
      const flat = riggedHandGeometry(templates[outfit], side, 'flat');
      const fist = riggedHandGeometry(templates[outfit], side, 'fist');
      // The thumb sticks out of the palm, so the box is lopsided toward the midline (-side X), as the procedural hand's is.
      const b = boxOf(flat);
      expect(Math.sign(b.min.x + b.max.x)).toBe(-side);
      const fb = boxOf(fist);
      expect(fb.max.z - fb.min.z).toBeLessThan(b.max.z - b.min.z - 0.01);
      expect(fb.min.z).toBeCloseTo(b.min.z, 2);
      expect(tris(fist)).toBeGreaterThan(20);
      // The fingers fold down toward the palm.
      expect(fb.min.y).toBeLessThan(b.min.y + 0.01);
    });
  });

  it('mirrors between the hands', () => {
    const l = boxOf(riggedHandGeometry(templates[outfit], 1, 'flat'));
    const r = boxOf(riggedHandGeometry(templates[outfit], -1, 'flat'));
    expect(l.max.z - l.min.z).toBeCloseTo(r.max.z - r.min.z, 2);
    // The model's two hands are not exact mirrors.
    expect(Math.abs(l.max.x - l.min.x - (r.max.x - r.min.x))).toBeLessThan(0.02);
    expect(Math.sign(l.min.x + l.max.x)).not.toBe(Math.sign(r.min.x + r.max.x));
  });
});
