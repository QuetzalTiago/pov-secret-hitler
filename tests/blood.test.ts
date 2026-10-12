import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TABLE_Y, Layout } from '../client/scene/world';
import { bloodSeed, dropletAt, paintBlood, spray } from '../client/scene/blood';

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

describe('paintBlood', () => {
  const g = new THREE.SphereGeometry(1, 48, 32);
  const pos = g.getAttribute('position').array;
  const nor = g.getAttribute('normal').array;
  const n = pos.length / 3;
  const dir = new THREE.Vector3(0, 0, 1);
  const fresh = () => new Float32Array(n * 3).fill(0.8);
  const facing = (i: number) => nor[3 * i + 2];

  it('leaves vertices facing away bit-identical and changes some facing ones', () => {
    const c = fresh();
    const count = paintBlood(c, pos, nor, dir, 5, 1);
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const f = Math.fround(0.8);
      const same = c[3 * i] === f && c[3 * i + 1] === f && c[3 * i + 2] === f;
      if (facing(i) <= 0.15) expect(same).toBe(true);
      if (!same) changed++;
    }
    expect(changed).toBeGreaterThan(0);
    expect(count).toBe(changed);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = fresh();
    const b = fresh();
    const c = fresh();
    paintBlood(a, pos, nor, dir, 9, 1);
    paintBlood(b, pos, nor, dir, 9, 1);
    paintBlood(c, pos, nor, dir, 10, 1);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('amount 0 changes nothing and amount 1 changes more than 0.3', () => {
    const z = fresh();
    expect(paintBlood(z, pos, nor, dir, 5, 0)).toBe(0);
    expect(z).toEqual(fresh());
    const lo = paintBlood(fresh(), pos, nor, dir, 5, 0.3);
    const hi = paintBlood(fresh(), pos, nor, dir, 5, 1);
    expect(hi).toBeGreaterThan(lo);
  });

  it('skips vertices outside the region', () => {
    const c = fresh();
    paintBlood(c, pos, nor, dir, 5, 1, (i) => i % 2 === 0);
    for (let i = 1; i < n; i += 2) expect([c[3 * i], c[3 * i + 1], c[3 * i + 2]]).toEqual([0.8, 0.8, 0.8].map(Math.fround));
  });
});
