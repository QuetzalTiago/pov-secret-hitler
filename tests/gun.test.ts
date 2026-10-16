import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pistolGeometry } from '../client/scene/gun';
import { pistol } from '../client/scene/props';

type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

describe('pistol', () => {
  it('is a group of exactly two meshes', () => {
    const g = pistol();
    expect(g.children).toHaveLength(2);
    for (const c of g.children) expect(c).toBeInstanceOf(THREE.Mesh);
  });

  it('builds non-indexed, smooth, uv-free geometries', () => {
    const { metal, grip } = pistolGeometry();
    for (const g of [metal, grip]) {
      expect(g.index).toBeNull();
      expect(g.getAttribute('normal')).toBeDefined();
      expect(g.getAttribute('uv')).toBeUndefined();
      expect(g.getAttribute('position').count % 3).toBe(0);
    }
  });

  // The old primitive model measured ~0.15 tall, ~0.03 wide, z -0.185..0.108.
  it('keeps the old footprint: muzzle at -0.185, grip behind, similar height and width', () => {
    const { metal, grip } = pistolGeometry();
    const box = new THREE.Box3();
    for (const g of [metal, grip]) {
      g.computeBoundingBox();
      box.union(g.boundingBox!);
    }
    const size = box.getSize(new THREE.Vector3());
    expect(box.min.z).toBeGreaterThan(-0.21);
    expect(box.min.z).toBeLessThan(-0.17);
    expect(box.max.z).toBeGreaterThan(0.08);
    expect(box.max.z).toBeLessThan(0.14);
    expect(size.y).toBeGreaterThan(0.11);
    expect(size.y).toBeLessThan(0.17);
    expect(size.x).toBeGreaterThan(0.02);
    expect(size.x).toBeLessThan(0.07);
  });

  it('puts the muzzle on the barrel axis', () => {
    const pos = pistolGeometry().metal.getAttribute('position');
    let minZ = Infinity;
    for (let i = 0; i < pos.count; i++) minZ = Math.min(minZ, pos.getZ(i));
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < minZ + 0.002) expect(Math.abs(pos.getY(i) - 0.03)).toBeLessThan(0.02);
    }
  });

  it('has a box magazine ahead of the trigger guard', () => {
    const pos = pistolGeometry().metal.getAttribute('position');
    let found = false;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) >= -0.05 && pos.getZ(i) <= -0.01 && pos.getY(i) < -0.025) found = true;
    expect(found).toBe(true);
  });

  it('faces normals outward', () => {
    const { metal, grip } = pistolGeometry();
    const x = (a: Attr, i: number) => a.getX(i);
    const z = (a: Attr, i: number) => a.getZ(i);
    for (const [g, get] of [[metal, x], [grip, z]] as const) {
      const pos = g.getAttribute('position');
      let best = 0;
      for (let i = 1; i < pos.count; i++) if (get(pos, i) > get(pos, best)) best = i;
      expect(get(g.getAttribute('normal'), best)).toBeGreaterThan(0);
    }
  });

  it('stays within the triangle budget', () => {
    const { metal, grip } = pistolGeometry();
    const tris = (metal.getAttribute('position').count + grip.getAttribute('position').count) / 3;
    expect(tris).toBeGreaterThan(1000);
    expect(tris).toBeLessThan(8000);
  });
});
