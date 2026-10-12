import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TABLE_Y, Layout } from '../client/scene/world';
import { bloodSeed, dropletAt, spray } from '../client/scene/blood';

const cases = [7, 5, 10];

describe('spray', () => {
  const layout = new Layout(7, 0);
  const victim = layout.head(2);
  const shooter = layout.head(5);

  it('is deterministic per seed and differs across seeds', () => {
    const a = spray(123, victim, shooter, 50, layout);
    expect(spray(123, victim, shooter, 50, layout)).toEqual(a);
    expect(spray(124, victim, shooter, 50, layout)).not.toEqual(a);
  });

  it('bloodSeed is deterministic, distinct and never 0', () => {
    expect(bloodSeed(3, 1)).toBe(bloodSeed(3, 1));
    const seeds = new Set<number>();
    for (let s = 0; s < 10; s++) {
      for (let k = 0; k < 10; k++) {
        const v = bloodSeed(s, k);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(2147483647);
        seeds.add(v);
      }
    }
    expect(seeds.size).toBe(100);
  });

  it('lands exactly on the table plane inside the ellipse, or on the floor', () => {
    for (const d of spray(9, victim, shooter, 300, layout)) {
      expect(d.t).toBeGreaterThan(0);
      expect(d.size).toBeGreaterThanOrEqual(0.015);
      expect(d.size).toBeLessThanOrEqual(0.07);
      if (d.surface === 'table') {
        expect(d.land.y).toBe(TABLE_Y);
        expect(d.land.x ** 2 / layout.rx ** 2 + d.land.z ** 2 / layout.rz ** 2).toBeLessThanOrEqual(1 + 1e-9);
      } else {
        expect(d.land.y).toBe(0);
      }
      const p = dropletAt(d, d.t, new THREE.Vector3());
      expect(p.x).toBeCloseTo(d.land.x, 6);
      expect(p.y).toBeCloseTo(d.land.y, 6);
      expect(p.z).toBeCloseTo(d.land.z, 6);
      expect(dropletAt(d, d.t + 5, new THREE.Vector3()).y).toBeCloseTo(d.land.y, 6);
    }
  });

  for (const n of cases) {
    it(`at least 40% land on the table for every victim seat (${n} seats)`, () => {
      const l = new Layout(n, 0);
      for (let v = 0; v < n; v++) {
        const ds = spray(bloodSeed(v, 0), l.head(v), l.head((v + 3) % n), 200, l);
        const f = ds.filter((d) => d.surface === 'table').length / ds.length;
        expect(f).toBeGreaterThanOrEqual(0.4);
      }
    });
  }

  it('sends some droplets to the floor and leaves inputs untouched', () => {
    const v0 = victim.clone();
    const s0 = shooter.clone();
    const ds = spray(5, victim, shooter, 200, layout);
    expect(ds.some((d) => d.surface === 'floor')).toBe(true);
    expect(victim).toEqual(v0);
    expect(shooter).toEqual(s0);
  });
});
