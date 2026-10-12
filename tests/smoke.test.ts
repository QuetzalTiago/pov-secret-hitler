import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { SmokePool } from '../client/scene/smoke';

describe('SmokePool', () => {
  it('never exceeds capacity', () => {
    const p = new SmokePool(8);
    for (let i = 0; i < 24; i++) p.emit(0, 0, 0, 0, 0, 0, 0.05, 3);
    p.update(0.016);
    expect(p.alive).toBe(8);
    expect(p.position.length).toBe(24);
  });

  it('overwrites the oldest slot when full', () => {
    const p = new SmokePool(3);
    for (let i = 0; i < 3; i++) {
      p.emit(i, 0, 0, 0, 0, 0, 0.05, 10);
      p.update(1);
    }
    // slot 0 is oldest (age 3), slot 2 youngest
    const slot = p.emit(9, 0, 0, 0, 0, 0, 0.05, 10);
    expect(slot).toBe(0);
    expect(p.position[0]).toBe(9);
    expect(p.position[3]).toBeCloseTo(1, 0); // slot 1 untouched (only drifted)
  });

  it('reuses a dead slot before overwriting a live one', () => {
    const p = new SmokePool(2);
    p.emit(0, 0, 0, 0, 0, 0, 0.05, 0.5);
    p.emit(1, 0, 0, 0, 0, 0, 0.05, 5);
    p.update(1);
    expect(p.alive).toBe(1);
    expect(p.emit(2, 0, 0, 0, 0, 0, 0.05, 5)).toBe(0);
  });

  it('rises, grows, and fades to nothing by its life', () => {
    const p = new SmokePool(4);
    p.emit(0, 1, 0, 0, 0, 0, 0.05, 2);
    let maxAlpha = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      p.update(1 / 60);
      maxAlpha = Math.max(maxAlpha, p.alpha[0]);
    }
    expect(p.position[1]).toBeGreaterThan(1);
    expect(p.size[0]).toBeGreaterThan(0.05);
    expect(maxAlpha).toBeGreaterThan(0.1);
    expect(maxAlpha).toBeLessThanOrEqual(0.35);
    for (let t = 0; t < 1.1; t += 1 / 60) p.update(1 / 60);
    expect(p.alpha[0]).toBe(0);
    expect(p.size[0]).toBe(0);
    expect(p.alive).toBe(0);
  });

  it('dead and never-used slots have alpha 0 and alive counts live ones', () => {
    const p = new SmokePool(5);
    p.emit(0, 0, 0, 0, 0, 0, 0.05, 1);
    p.emit(0, 0, 0, 0, 0, 0, 0.05, 3);
    p.update(0.5);
    expect(p.alive).toBe(2);
    p.update(0.6);
    expect(p.alive).toBe(1);
    expect(p.alpha[0]).toBe(0);
    for (let i = 2; i < 5; i++) expect(p.alpha[i]).toBe(0);
  });
});

describe('CigaretteSmoke', () => {
  beforeAll(() => {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })),
      set: (t, k: string, v) => ((t[k] = v), true),
    });
    (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  });

  it('exposes the geometry attributes and emits a wisp at ~6/s', async () => {
    const { CigaretteSmoke } = await import('../client/scene/smoke');
    const s = new CigaretteSmoke();
    for (const n of ['position', 'aSize', 'aAlpha', 'aRot']) expect(s.points.geometry.getAttribute(n)).toBeDefined();
    expect(s.pool.capacity).toBe(192);
    const tip = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 60; i++) s.wisp(1, tip, 1 / 60);
    s.update(0);
    expect(s.pool.alive).toBeGreaterThanOrEqual(4);
    expect(s.pool.alive).toBeLessThanOrEqual(8);
    s.dispose();
  });
});
