import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cuffGeometry, pointingFingerGeometry, sleeveGeometry, unitSleeveGeometry } from '../client/scene/ownbody';

const tris = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3;

function expectPlain(g: THREE.BufferGeometry) {
  expect(g.index).toBeNull();
  expect(g.getAttribute('normal')).toBeDefined();
  expect(g.getAttribute('uv')).toBeUndefined();
}

/** Max distance of any vertex from the line through `c` along unit `d`, and the span of vertices along `d`. */
function around(g: THREE.BufferGeometry, c: THREE.Vector3, d: THREE.Vector3) {
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  let radius = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(c);
    const t = v.dot(d);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
    radius = Math.max(radius, v.addScaledVector(d, -t).length());
  }
  return { radius, lo, hi };
}

describe('own-body geometry', () => {
  it('sleeve is a smooth non-indexed mesh, not a box', () => {
    const g = sleeveGeometry(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, -0.1, 0.3), 0.05, 0.04);
    expectPlain(g);
    expect(tris(g)).toBeGreaterThan(200);
  });

  it('unit sleeve spans y 0..1 and tapers', () => {
    const g = unitSleeveGeometry(0.05, 0.04);
    expectPlain(g);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(g.boundingBox!.max.y).toBeCloseTo(1, 6);
    const p = g.getAttribute('position');
    const radiusAt = (y: number) => {
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - y) < 1e-6) return Math.hypot(p.getX(i), p.getZ(i));
      return NaN;
    };
    expect(radiusAt(0)).toBeCloseTo(0.05, 6);
    expect(radiusAt(1)).toBeCloseTo(0.04, 6);
  });

  it('cuff ring is centred on the point with its axis along dir', () => {
    const at = new THREE.Vector3(0.3, 0.8, -0.2);
    const dir = new THREE.Vector3(1, -0.5, 2).normalize();
    const g = cuffGeometry(at, dir, 0.038);
    expectPlain(g);
    const { radius, lo, hi } = around(g, at, dir);
    expect(radius).toBeCloseTo(0.038, 5);
    expect(lo).toBeCloseTo(-0.0125, 5);
    expect(hi).toBeCloseTo(0.0125, 5);
  });

  it('pointing finger is a thin smooth mesh along -Z', () => {
    const g = pointingFingerGeometry();
    expectPlain(g);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeGreaterThan(0.08);
    expect(g.boundingBox!.max.x).toBeLessThan(0.012);
  });
});
