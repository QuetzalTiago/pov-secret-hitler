import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { goreEnabled, setGore } from '../client/gore';
import { Layout, TABLE_Y } from '../client/scene/world';
import { Bloodshed, type BloodShot } from '../client/scene/bloodfx';

const fake = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('goreEnabled', () => {
  it('defaults to on', () => {
    expect(goreEnabled('', null)).toBe(true);
    expect(goreEnabled('', fake())).toBe(true);
  });

  it('follows the stored choice', () => {
    expect(goreEnabled('', fake({ 'sh-gore': 'off' }))).toBe(false);
    expect(goreEnabled('', fake({ 'sh-gore': 'on' }))).toBe(true);
  });

  it('the query beats storage', () => {
    expect(goreEnabled('?gore=0', fake({ 'sh-gore': 'on' }))).toBe(false);
    expect(goreEnabled('?gore=1', fake({ 'sh-gore': 'off' }))).toBe(true);
  });

  it('a throwing storage means on', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(goreEnabled('', bad)).toBe(true);
  });
});

describe('setGore', () => {
  it('round-trips through storage', () => {
    const s = fake();
    setGore(false, s);
    expect(goreEnabled('', s)).toBe(false);
    setGore(true, s);
    expect(goreEnabled('', s)).toBe(true);
  });

  it('ignores a throwing storage', () => {
    const bad = {
      setItem: () => {
        throw new Error('private mode');
      },
    };
    expect(() => setGore(false, bad)).not.toThrow();
    expect(() => setGore(false, null)).not.toThrow();
  });
});

describe('Bloodshed.enabled', () => {
  const layout = new Layout(7, 0);
  const n = 40;
  const make = () => {
    const board = new THREE.Object3D();
    board.updateMatrixWorld();
    const ground = new THREE.Object3D();
    const shot: BloodShot = {
      seed: 4242,
      victimHead: layout.head(2),
      shooterHead: layout.head(5),
      layout,
      chair: layout.chair(2),
      resolve: (_x, _z, surface) => (surface === 'table' ? { anchor: board, y: TABLE_Y } : { anchor: ground, y: 0 }),
      n,
    };
    const b = new Bloodshed(new THREE.Group());
    const c = { splats: 0, drips: 0 };
    b.sound = { splat: () => c.splats++, drip: () => c.drips++ };
    return { b, shot, c };
  };
  const run = (b: Bloodshed) => {
    for (let i = 0; i < 400; i++) b.update(0.02);
  };

  it('enabled execute and settle make splats, a pool and sounds (control)', () => {
    const { b, shot, c } = make();
    b.execute(shot, () => new THREE.Vector3(0, 1, 0));
    run(b);
    expect(b.splats.count).toBe(n);
    expect(b.pool.count).toBe(1);
    expect(c.splats).toBe(1);
    expect(c.drips).toBeGreaterThan(0);
    const s = make();
    s.b.settle(s.shot);
    s.b.update(0);
    expect(s.b.splats.count).toBe(n);
    expect(s.b.pool.count).toBe(1);
  });

  it('disabled execute and settle do nothing', () => {
    const { b, shot, c } = make();
    b.enabled = false;
    b.execute(shot, () => new THREE.Vector3(0, 1, 0));
    b.settle(shot);
    expect(b.drops.active).toBe(0);
    run(b);
    expect(b.splats.count).toBe(0);
    expect(b.pool.count).toBe(0);
    expect(c.splats).toBe(0);
    expect(c.drips).toBe(0);
  });
});
