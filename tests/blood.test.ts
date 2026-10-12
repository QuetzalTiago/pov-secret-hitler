import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TABLE_Y, Layout } from '../client/scene/world';
import { BloodSplats, bloodSeed, drip, dropletAt, paintBlood, pickAnchor, spray, type AnchorRect } from '../client/scene/blood';

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

describe('BloodSplats', () => {
  const pos = (b: BloodSplats, i: number) => {
    const m = new THREE.Matrix4();
    b.mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  const anchorAt = (x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.updateMatrixWorld();
    return o;
  };

  it('an instance follows a moved anchor', () => {
    const b = new BloodSplats(null);
    const a = anchorAt(1, 0, 0);
    b.add(a, new THREE.Matrix4().makeTranslation(0, 0.01, 0.2), 0);
    b.update(1);
    expect(pos(b, 0).distanceTo(new THREE.Vector3(1, 0.01, 0.2))).toBeLessThan(1e-5);
    a.position.set(-2, 0.5, 3);
    a.rotation.y = Math.PI / 2;
    a.updateMatrixWorld();
    b.update(0.016);
    const want = new THREE.Vector3(0, 0.01, 0.2).applyMatrix4(a.matrixWorld);
    expect(pos(b, 0).distanceTo(want)).toBeLessThan(1e-5);
  });

  it('scales in', () => {
    const b = new BloodSplats(null);
    b.add(anchorAt(0, 0, 0), new THREE.Matrix4(), 1);
    const scale = () => {
      const m = new THREE.Matrix4();
      b.mesh.getMatrixAt(0, m);
      return new THREE.Vector3().setFromMatrixScale(m).x;
    };
    b.update(0);
    expect(scale()).toBeLessThan(0.5);
    b.update(1);
    expect(scale()).toBeCloseTo(1, 5);
  });

  it('the cap recycles the oldest', () => {
    const b = new BloodSplats(null, 4);
    for (let i = 0; i < 5; i++) b.add(anchorAt(i, 0, 0), new THREE.Matrix4(), i === 4 ? 3 : 1);
    b.update(1);
    expect(b.count).toBe(4);
    expect(pos(b, 0).x).toBeCloseTo(4);
    for (let i = 1; i < 4; i++) expect(pos(b, i).x).toBeCloseTo(i);
    const tile = b.mesh.geometry.getAttribute('tile') as THREE.BufferAttribute;
    expect(tile.getX(0)).toBe(3);
    expect(tile.getX(1)).toBe(1);
  });

  it('clear empties it', () => {
    const b = new BloodSplats(null);
    b.add(anchorAt(1, 0, 0), new THREE.Matrix4(), 2);
    b.update(1);
    b.clear();
    expect(b.count).toBe(0);
    expect(b.mesh.count).toBe(0);
    expect(b.mesh.visible).toBe(false);
    expect(b.add(anchorAt(3, 0, 0), new THREE.Matrix4(), 3)).toBe(0);
    b.update(1);
    expect(b.count).toBe(1);
    expect(pos(b, 0).x).toBeCloseTo(3);
  });
});

describe('pickAnchor', () => {
  const rect = (cx: number, cz: number, top: number, yaw = 0, halfW = 0.065, halfD = 0.09): AnchorRect => ({ cx, cz, halfW, halfD, yaw, top });
  const board = rect(0, 0, TABLE_Y + 0.012, 0, 0.5, 0.3125);

  it('floor landings stay on the floor even over the board', () => {
    expect(pickAnchor(0, 0, 'floor', board, [rect(0, 0, 1)])).toEqual({ kind: 'floor', y: 0 });
  });

  it('table points off the board and cards land on the table', () => {
    expect(pickAnchor(1.2, 0.9, 'table', board, [rect(0.7, 0.7, 1)])).toEqual({ kind: 'table', y: TABLE_Y });
    expect(pickAnchor(1.2, 0.9, 'table', null, [])).toEqual({ kind: 'table', y: TABLE_Y });
  });

  it('a card on the board wins over the board', () => {
    const card = rect(0.2, 0.1, TABLE_Y + 0.0135);
    expect(pickAnchor(0.3, 0.2, 'table', board, [card])).toEqual({ kind: 'board', y: board.top });
    expect(pickAnchor(0.2, 0.1, 'table', board, [card])).toEqual({ kind: 'card', index: 0, y: card.top });
  });

  it('overlapping cards: the higher top wins, ties take the lowest index', () => {
    const lo = rect(0, 0, 1);
    const hi = rect(0.01, 0, 1.01);
    expect(pickAnchor(0, 0, 'table', null, [lo, hi])).toEqual({ kind: 'card', index: 1, y: 1.01 });
    expect(pickAnchor(0, 0, 'table', null, [lo, rect(0, 0, 1)])).toEqual({ kind: 'card', index: 0, y: 1 });
  });

  it('honours the yaw of a rotated card', () => {
    const yaw = Math.PI / 4;
    const card = rect(0.3, -0.2, 1, yaw, 0.03);
    const o = new THREE.Object3D();
    o.position.set(card.cx, 0, card.cz);
    o.rotation.y = yaw;
    o.updateMatrixWorld();
    const world = (u: number, v: number) => o.localToWorld(new THREE.Vector3(u, 0, v));
    // Inside the rotated rect (near its long end) but outside the axis-aligned one.
    const a = world(0, 0.085);
    expect(Math.abs(a.x - card.cx)).toBeGreaterThan(card.halfW);
    expect(pickAnchor(a.x, a.z, 'table', null, [card]).kind).toBe('card');
    // Inside the axis-aligned rect but outside the rotated one.
    const x = card.cx + 0.025;
    const z = card.cz + 0.085;
    const p = o.worldToLocal(new THREE.Vector3(x, 0, z));
    expect(Math.abs(x - card.cx) <= card.halfW && Math.abs(z - card.cz) <= card.halfD).toBe(true);
    expect(Math.abs(p.x) > card.halfW || Math.abs(p.z) > card.halfD).toBe(true);
    expect(pickAnchor(x, z, 'table', null, [card]).kind).toBe('table');
    // Just past the rotated rect's long end.
    const b = world(0, 0.095);
    expect(pickAnchor(b.x, b.z, 'table', null, [card]).kind).toBe('table');
  });
});

describe('drip', () => {
  it('falls straight down to the floor under its start', () => {
    const d = drip(new THREE.Vector3(0.4, 1.1, -0.7));
    expect(d.surface).toBe('floor');
    expect(d.land.x).toBe(0.4);
    expect(d.land.z).toBe(-0.7);
    expect(d.land.y).toBe(0);
    expect(dropletAt(d, d.t, new THREE.Vector3()).y).toBeCloseTo(0, 6);
    expect(dropletAt(d, d.t / 2, new THREE.Vector3()).x).toBe(0.4);
  });
});
