import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { handGeometry } from '../client/scene/hands';

function stats(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const size = new THREE.Vector3();
  g.boundingBox!.getSize(size);
  const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  return { size, tris, box: g.boundingBox! };
}

describe('handGeometry', () => {
  it('flat hand has fingers sticking out along +Z', () => {
    const g = handGeometry('flat');
    const { size, tris, box } = stats(g);
    expect(g).toBeInstanceOf(THREE.BufferGeometry);
    expect(g.getAttribute('position')).toBeDefined();
    expect(tris).toBeGreaterThan(300);
    expect(tris).toBeLessThan(2000);
    expect(size.x).toBeGreaterThan(0.085 * 0.5);
    expect(size.x).toBeLessThan(0.085 * 1.5 * 1.6);
    expect(size.y).toBeLessThan(0.04 * 1.5 * 1.6);
    expect(box.max.z).toBeGreaterThan(0.05);
  });

  it('fist is roughly palm sized', () => {
    const { size, tris } = stats(handGeometry('fist', -1));
    expect(tris).toBeGreaterThan(300);
    expect(tris).toBeLessThan(2000);
    expect(size.x).toBeGreaterThan(0.075 * 0.5);
    expect(size.x).toBeLessThan(0.075 * 1.5 * 1.3);
    expect(size.y).toBeGreaterThan(0.09 * 0.5);
    expect(size.y).toBeLessThan(0.09 * 1.5);
  });

  it('has position and normal only (mergeable with sleeves)', () => {
    for (const kind of ['flat', 'fist'] as const) {
      const g = handGeometry(kind);
      expect(g.getAttribute('normal')).toBeDefined();
      expect(g.getAttribute('uv')).toBeUndefined();
    }
  });

  it('puts the flat thumb toward the body midline', () => {
    expect(stats(handGeometry('flat', 1)).box.min.x).toBeLessThan(-0.04);
    expect(stats(handGeometry('flat', -1)).box.max.x).toBeGreaterThan(0.04);
  });

  it('flat fingertips curl down to the palm bottom', () => {
    const g = handGeometry('flat');
    const pos = g.getAttribute('position');
    let tipMin = Infinity;
    let all = Infinity;
    for (let i = 0; i < pos.count; i++) {
      all = Math.min(all, pos.getY(i));
      if (pos.getZ(i) > 0.08) tipMin = Math.min(tipMin, pos.getY(i));
    }
    expect(all).toBeGreaterThan(-0.025);
    expect(tipMin).toBeLessThan(all + 0.008);
  });

  it('builds a fresh geometry per call', () => {
    expect(handGeometry('flat')).not.toBe(handGeometry('flat'));
  });
});
