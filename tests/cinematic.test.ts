import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BASE_PITCH } from '../client/scene/look';
import {
  CINE,
  CONFETTI,
  Confetti,
  confettiAt,
  confettiPieces,
  dollyPose,
  revealAt,
  revealEndsAt,
  stageLevel,
  stageTint,
  type ConfettiPiece,
} from '../client/scene/cinematic';

const TABLE_Y = 0.78;
const layoutFor = (n: number) => {
  const rx = 1.25 + Math.max(n, 5) * 0.075;
  return { rx, rz: rx * 0.68 };
};
const mkOut = () => ({ pos: new THREE.Vector3(), pitch: 0, yaw: 0 });

describe('dollyPose', () => {
  it('starts at the seat eye', () => {
    const l = layoutFor(7);
    const p = dollyPose(0, l, mkOut());
    expect(p.pos.x).toBeCloseTo(0);
    expect(p.pos.y).toBeCloseTo(1.27);
    expect(p.pos.z).toBeCloseTo(l.rz + 0.36);
    expect(p.pitch).toBeCloseTo(BASE_PITCH);
    expect(p.yaw).toBeCloseTo(0);
  });
  it('ends high over the table for small and large rooms', () => {
    for (const n of [5, 10]) {
      const p = dollyPose(1, layoutFor(n), mkOut());
      expect(p.pos.y).toBeGreaterThan(2.5);
      expect(p.pos.y).toBeLessThan(3.6);
      expect(p.pitch).toBeLessThan(-0.8);
      expect(Math.abs(p.yaw)).toBeLessThan(1e-6);
    }
  });
  it('rises monotonically and clamps k', () => {
    const l = layoutFor(8);
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const y = dollyPose(i / 20, l, mkOut()).pos.y;
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    expect(dollyPose(-3, l, mkOut()).pos.y).toBeCloseTo(dollyPose(0, l, mkOut()).pos.y);
    expect(dollyPose(4, l, mkOut()).pos.y).toBeCloseTo(dollyPose(1, l, mkOut()).pos.y);
  });
});

describe('revealAt', () => {
  it('own seat first, distinct times, last equals revealEndsAt', () => {
    const n = 7;
    const me = 3;
    expect(revealAt(me, me, n)).toBeCloseTo(CINE.revealStart);
    const times = Array.from({ length: n }, (_, s) => revealAt(s, me, n));
    expect(new Set(times.map((t) => t.toFixed(6))).size).toBe(n);
    expect(Math.max(...times)).toBeCloseTo(revealEndsAt(n));
  });
});

describe('stage values', () => {
  it('stageLevel', () => {
    expect(stageLevel('liberal', 'liberal')).toBe(1);
    expect(stageLevel('fascist', 'liberal')).toBe(-1);
    expect(stageLevel(null, 'fascist')).toBe(0);
  });
  it('stageTint', () => {
    expect(stageTint(-1)).toEqual({ color: 0.4, emissive: [0, 0, 0] });
    const w = stageTint(1);
    expect(w.color).toBe(1);
    expect(w.emissive).toEqual([0.22, 0.15, 0.06]);
    expect(stageTint(0)).toEqual({ color: 1, emissive: [0, 0, 0] });
  });
});

describe('confettiPieces', () => {
  const { rx, rz } = layoutFor(7);
  it('is deterministic per seed and respects count', () => {
    const a = confettiPieces(50, 1, rx, rz);
    expect(a).toHaveLength(50);
    expect(confettiPieces(50, 1, rx, rz)).toEqual(a);
    expect(confettiPieces(50, 2, rx, rz)).not.toEqual(a);
  });
  it('spawns inside the 1.15x ellipse', () => {
    for (const p of confettiPieces(200, 9, rx, rz)) {
      expect((p.x / (1.15 * rx)) ** 2 + (p.z / (1.15 * rz)) ** 2).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('confettiAt', () => {
  const { rx, rz } = layoutFor(7);
  const mk = (x: number, z: number): ConfettiPiece => ({ x, z, delay: 0.5, fall: 0.8, spin: 3, phase: 1, sway: 0.1, tint: 0 });
  const out = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
  it('is invisible before its delay and starts at the top', () => {
    const p = mk(0, 0);
    expect(confettiAt(p, 0.4, rx, rz, out)).toBe(false);
    expect(confettiAt(p, 0.5 + 1e-6, rx, rz, out)).toBe(true);
    expect(out.pos.y).toBeCloseTo(CONFETTI.top, 3);
  });
  it('lands flat on the table or the floor and freezes', () => {
    for (const [p, floor] of [
      [mk(0, 0), TABLE_Y + 0.003],
      [mk(2 * rx, 0), 0.003],
    ] as const) {
      expect(confettiAt(p, 30, rx, rz, out)).toBe(true);
      expect(out.pos.y).toBeCloseTo(floor, 9);
      expect(out.rot.x).toBeCloseTo(-Math.PI / 2);
      const a = out.pos.clone();
      confettiAt(p, 40, rx, rz, out);
      expect(out.pos.distanceTo(a)).toBe(0);
    }
  });
});

describe('Confetti', () => {
  it('builds one coloured instanced mesh and runs', () => {
    const c = new Confetti();
    const { rx, rz } = layoutFor(7);
    expect(c.mesh.children.length).toBe(0);
    expect(c.mesh.instanceColor).not.toBeNull();
    expect(c.mesh.count).toBe(0);
    expect(c.running).toBe(false);
    c.start('liberal', 5, rx, rz);
    expect(c.running).toBe(true);
    expect(c.mesh.visible).toBe(true);
    for (let i = 0; i < 20; i++) c.update(0.1);
    expect(c.mesh.count).toBeGreaterThan(0);
    expect(c.mesh.count).toBeLessThanOrEqual(CONFETTI.count);
    const col = new THREE.Color();
    c.mesh.getColorAt(0, col);
    expect([0x3f7fb5, 0xd8cfb8]).toContain(col.getHex());
    // Every drawn slot keeps the colour of the piece drawn in it, also while later pieces are still spawning.
    const fresh = new Confetti();
    fresh.start('fascist', 11, rx, rz);
    const pieces = confettiPieces(CONFETTI.count, 11, rx, rz).sort((a, b) => a.delay - b.delay);
    const hex = [0xb3362c, 0x1c1a18];
    fresh.update(0.6);
    expect(fresh.mesh.count).toBeGreaterThan(0);
    expect(fresh.mesh.count).toBeLessThan(CONFETTI.count);
    for (let i = 0; i < fresh.mesh.count; i++) {
      fresh.mesh.getColorAt(i, col);
      expect(col.getHex()).toBe(hex[pieces[i].tint]);
    }
    fresh.dispose();
    c.stop();
    expect(c.mesh.visible).toBe(false);
    expect(c.mesh.count).toBe(0);
    expect(c.running).toBe(false);
    c.dispose();
  });
});
