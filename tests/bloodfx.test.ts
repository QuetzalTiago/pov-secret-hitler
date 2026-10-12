import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Layout, TABLE_Y } from '../client/scene/world';
import { drip } from '../client/scene/blood';
import { BloodDroplets, BloodPool, Bloodshed, POOL_GROW, type BloodShot } from '../client/scene/bloodfx';

const scaleOf = (m: THREE.InstancedMesh, i: number) => {
  const mat = new THREE.Matrix4();
  m.getMatrixAt(i, mat);
  return new THREE.Vector3().setFromMatrixScale(mat).x;
};
const matrices = (m: THREE.InstancedMesh, n: number) => {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.Matrix4();
    m.getMatrixAt(i, mat);
    out.push(mat.toArray());
  }
  return out;
};

describe('BloodDroplets', () => {
  const fall = () => drip(new THREE.Vector3(0, 1, 0));

  it('fires onLand once and then goes idle', () => {
    const b = new BloodDroplets();
    let n = 0;
    const d = fall();
    b.launch(d, () => n++);
    expect(b.active).toBe(1);
    b.update(d.t / 2);
    expect(n).toBe(0);
    expect(b.points.visible).toBe(true);
    b.update(d.t);
    b.update(1);
    expect(n).toBe(1);
    expect(b.active).toBe(0);
    expect(b.points.visible).toBe(false);
  });

  it('still calls onLand for a droplet dropped because the pool is full', () => {
    const b = new BloodDroplets(2);
    let n = 0;
    for (let i = 0; i < 3; i++) b.launch(fall(), () => n++);
    expect(b.active).toBe(2);
    expect(n).toBe(1);
  });

  it('clear drops flights without calling onLand', () => {
    const b = new BloodDroplets();
    let n = 0;
    b.launch(fall(), () => n++);
    b.clear();
    b.update(5);
    expect(n).toBe(0);
    expect(b.active).toBe(0);
  });
});

describe('BloodPool', () => {
  const c = new THREE.Vector3(1, 0, 2);

  it('grows monotonically to full size at POOL_GROW', () => {
    const p = new BloodPool(null);
    p.add(c, 0.4, 0.3, 0);
    p.update(0);
    let last = scaleOf(p.mesh, 0);
    expect(last).toBeLessThan(0.1);
    for (let i = 0; i < 20; i++) {
      p.update(POOL_GROW / 20);
      const s = scaleOf(p.mesh, 0);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
    expect(last).toBeCloseTo(0.8, 5);
    p.update(5);
    expect(scaleOf(p.mesh, 0)).toBeCloseTo(0.8, 5);
  });

  it('-Infinity is full immediately', () => {
    const p = new BloodPool(null);
    p.add(c, 0.4, 0, 0, -Infinity);
    p.update(0);
    expect(scaleOf(p.mesh, 0)).toBeCloseTo(0.8, 5);
  });

  it('recycles the oldest at the cap', () => {
    const p = new BloodPool(null, 2);
    for (let i = 0; i < 3; i++) p.add(new THREE.Vector3(i, 0, 0), 0.3, 0, 0, -Infinity);
    p.update(1);
    expect(p.count).toBe(2);
    const m = new THREE.Matrix4();
    p.mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(2);
  });
});

describe('Bloodshed', () => {
  const layout = new Layout(7, 0);
  const n = 40;
  const make = () => {
    const board = new THREE.Object3D();
    board.position.set(0, 0.2, 0);
    board.updateMatrixWorld();
    const ground = new THREE.Object3D();
    const shot: BloodShot = {
      seed: 4242,
      victimHead: layout.head(2),
      shooterHead: layout.head(5),
      layout,
      chair: layout.chair(2),
      // Everything landing on the table counts as the (movable) board.
      resolve: (_x, _z, surface) =>
        surface === 'table' ? { anchor: board, y: TABLE_Y } : { anchor: ground, y: 0 },
      n,
    };
    return { board, shot, root: new THREE.Group() };
  };

  it('execute places every splat once the droplets land', () => {
    const { shot, root } = make();
    const b = new Bloodshed(root);
    expect(root.children).toHaveLength(3);
    b.execute(shot);
    expect(b.drops.active).toBe(n);
    for (let i = 0; i < 400 && b.drops.active > 0; i++) b.update(0.02);
    expect(b.drops.active).toBe(0);
    b.update(0);
    expect(b.splats.count).toBe(n);
    expect(b.pool.count).toBe(1);
  });

  it('drips from the head while executing', () => {
    const { shot, root } = make();
    const b = new Bloodshed(root);
    b.execute({ ...shot, n: 0 }, () => new THREE.Vector3(0, 1, 0));
    b.update(0.01);
    expect(b.drops.active).toBeGreaterThan(0);
    for (let i = 0; i < 700; i++) b.update(0.02);
    expect(b.drops.active).toBe(0);
  });

  it('settle yields the same splats as execute, fully grown', () => {
    const a = make();
    const ba = new Bloodshed(a.root);
    ba.execute(a.shot);
    for (let i = 0; i < 400; i++) ba.update(0.02);
    ba.update(1);
    const s = make();
    const bs = new Bloodshed(s.root);
    bs.settle(s.shot);
    expect(bs.drops.active).toBe(0);
    bs.update(1);
    expect(bs.splats.count).toBe(n);
    // Execute fills slots in landing order, settle in spray order: compare as sets.
    const byPos = (a: number[], b: number[]) => a[12] - b[12] || a[14] - b[14];
    const want = matrices(ba.splats.mesh, n).sort(byPos);
    const got = matrices(bs.splats.mesh, n).sort(byPos);
    for (let i = 0; i < n; i++) for (let k = 0; k < 16; k++) expect(got[i][k]).toBeCloseTo(want[i][k], 4);
    expect(scaleOf(bs.pool.mesh, 0)).toBeGreaterThan(0.6);
  });

  it('a splat on a moved anchor follows it', () => {
    const { board, shot, root } = make();
    const b = new Bloodshed(root);
    b.settle(shot);
    b.update(1);
    const before = matrices(b.splats.mesh, n);
    const idx = before.findIndex((m) => m[13] > TABLE_Y - 1e-6);
    expect(idx).toBeGreaterThanOrEqual(0);
    board.position.y += 0.5;
    board.updateMatrixWorld();
    b.update(0.016);
    expect(matrices(b.splats.mesh, n)[idx][13]).toBeCloseTo(before[idx][13] + 0.5, 5);
  });

  const counted = (b: Bloodshed) => {
    const c = { splats: 0, drips: 0 };
    b.sound = { splat: () => c.splats++, drip: () => c.drips++ };
    return c;
  };

  it('execute splats sound once, on the first landing', () => {
    const { shot, root } = make();
    const b = new Bloodshed(root);
    const c = counted(b);
    b.execute(shot);
    expect(c.splats).toBe(0);
    let firstAt = -1;
    for (let i = 0; i < 300; i++) {
      b.update(0.01);
      if (firstAt < 0 && c.splats > 0) {
        firstAt = i;
        expect(b.splats.count).toBeLessThanOrEqual(1);
      }
    }
    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(c.splats).toBe(1);
    expect(c.drips).toBe(0);
  });

  it('drip sound per landed drip', () => {
    const { shot, root } = make();
    const b = new Bloodshed(root);
    const c = counted(b);
    b.execute({ ...shot, n: 0 }, () => new THREE.Vector3(0, 1, 0));
    for (let i = 0; i < (POOL_GROW + 2) / 0.01; i++) b.update(0.01);
    expect(c.splats).toBe(0);
    expect(c.drips).toBeGreaterThanOrEqual(10);
    expect(c.drips).toBeLessThanOrEqual(23);
  });

  it('settle is silent', () => {
    const { shot, root } = make();
    const b = new Bloodshed(root);
    const c = counted(b);
    b.settle(shot);
    for (let i = 0; i < 300; i++) b.update(0.01);
    expect(c).toEqual({ splats: 0, drips: 0 });
  });

  it('each execute splats once', () => {
    const { shot, root } = make();
    const b = new Bloodshed(root);
    const c = counted(b);
    b.execute(shot);
    b.execute({ ...shot, seed: 7 });
    for (let i = 0; i < 300; i++) b.update(0.01);
    expect(c.splats).toBe(2);
  });

  it('clear empties everything', () => {
    const { shot, root } = make();
    const b = new Bloodshed(root);
    b.execute(shot, () => new THREE.Vector3(0, 1, 0));
    b.update(0.5);
    b.clear();
    b.update(5);
    expect(b.drops.active).toBe(0);
    expect(b.splats.count).toBe(0);
    expect(b.pool.count).toBe(0);
  });

  it('dispose removes the meshes', () => {
    const { root } = make();
    const b = new Bloodshed(root);
    b.dispose();
    expect(root.children).toHaveLength(0);
  });
});
