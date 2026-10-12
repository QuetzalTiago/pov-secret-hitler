import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  bottlesGeometry,
  buntingGeometry,
  hallGlowGeometry,
  hallPropsGeometry,
  posterGeometry,
  posterUV,
} from '../client/scene/beerhall';

const builders = {
  bottles: bottlesGeometry,
  props: hallPropsGeometry,
  glow: hallGlowGeometry,
  poster: posterGeometry,
  bunting: buntingGeometry,
};

function vertices(g: THREE.BufferGeometry): THREE.Vector3[] {
  const p = g.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i));
}

describe('beer-hall geometry', () => {
  for (const [name, build] of Object.entries(builders)) {
    it(`${name}: position and normal, under the vertex budget`, () => {
      const g = build();
      expect(g).toBeInstanceOf(THREE.BufferGeometry);
      expect(g.getAttribute('position')).toBeDefined();
      expect(g.getAttribute('normal')).toBeDefined();
      expect(g.getAttribute('normal').count).toBe(g.getAttribute('position').count);
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      expect(g.getAttribute('position').count).toBeLessThan(60000);
    });

    it(`${name}: inside the room and clear of the table`, () => {
      for (const v of vertices(build())) {
        expect(Math.abs(v.x)).toBeLessThanOrEqual(5);
        expect(Math.abs(v.z)).toBeLessThanOrEqual(5);
        expect(v.y).toBeGreaterThanOrEqual(0);
        expect(v.y).toBeLessThanOrEqual(3.55);
        expect(Math.abs(v.x) < 2.2 && Math.abs(v.z) < 2.2).toBe(false);
      }
    });
  }

  for (const name of ['bottles', 'props', 'bunting'] as const) {
    it(`${name}: vertex colours match the position count`, () => {
      const g = builders[name]();
      expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
    });
  }

  it('glow has no vertex colour', () => {
    expect(hallGlowGeometry().getAttribute('color')).toBeUndefined();
  });

  it('bottles sit on the shelves', () => {
    const g = bottlesGeometry();
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.x).toBeGreaterThanOrEqual(-2.8);
    expect(box.max.x).toBeLessThanOrEqual(2.8);
    expect(box.min.y).toBeGreaterThanOrEqual(1.4);
    expect(box.max.y).toBeLessThanOrEqual(3.2);
  });

  it('posterUV addresses the 2x2 atlas', () => {
    expect(posterUV(0)).toEqual({ u0: 0, u1: 0.5, v0: 0.5, v1: 1 });
    expect(posterUV(1)).toEqual({ u0: 0.5, u1: 1, v0: 0.5, v1: 1 });
    expect(posterUV(2)).toEqual({ u0: 0, u1: 0.5, v0: 0, v1: 0.5 });
    expect(posterUV(3)).toEqual({ u0: 0.5, u1: 1, v0: 0, v1: 0.5 });
  });

  it('posters: six quads with in-range uvs, facing the room centre, not mirrored', () => {
    const g = posterGeometry();
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const nrm = g.getAttribute('normal');
    expect(pos.count).toBe(36);
    expect(uv.count).toBe(36);
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
    const v = vertices(g);
    for (let q = 0; q < 6; q++) {
      const quad = v.slice(q * 6, q * 6 + 6);
      const n = new THREE.Vector3()
        .crossVectors(quad[1].clone().sub(quad[0]), quad[2].clone().sub(quad[0]))
        .normalize();
      const centre = quad.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / 6);
      const toRoom = new THREE.Vector3(-centre.x, 0, -centre.z).normalize();
      expect(n.dot(toRoom)).toBeGreaterThan(0.5);
      // The stored normal agrees with the winding.
      expect(new THREE.Vector3().fromBufferAttribute(nrm, q * 6).dot(n)).toBeGreaterThan(0.99);
      // Not mirrored: u grows to the viewer's right (right = forward x up, forward = -n).
      let iMin = 0;
      let iMax = 0;
      for (let k = 0; k < 6; k++) {
        if (uv.getX(q * 6 + k) < uv.getX(q * 6 + iMin)) iMin = k;
        if (uv.getX(q * 6 + k) > uv.getX(q * 6 + iMax)) iMax = k;
      }
      const right = new THREE.Vector3().crossVectors(n.clone().negate(), new THREE.Vector3(0, 1, 0));
      expect(quad[iMax].clone().sub(quad[iMin]).dot(right)).toBeGreaterThan(0.5);
    }
  });
});
