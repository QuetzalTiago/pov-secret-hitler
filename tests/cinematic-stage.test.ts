import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

// Minimal fake canvas so textures.ts can run in node.
function fakeCtx() {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 10 });
      if (k === 'getImageData')
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k in t) return t[k];
      return () => ({ addColorStop() {} });
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
}

let Character: typeof import('../client/scene/characters').Character;

beforeAll(async () => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }),
  };
  ({ Character } = await import('../client/scene/characters'));
});

const DT = 1 / 60;

function run(c: InstanceType<typeof Character>, seconds: number) {
  for (let i = 0; i < seconds / DT; i++) c.update(DT, i * DT);
}

function materials(c: InstanceType<typeof Character>): THREE.MeshStandardMaterial[] {
  return (c as any).mats;
}

/** Colour and emissive channels of every body material. */
const snapshot = (c: InstanceType<typeof Character>) =>
  materials(c).map((m) => ({ color: m.color.toArray(), emissive: m.emissive.toArray() }));

describe('Character stage lighting (game-over cinematic)', () => {
  it('matches the unstaged patron at stage 0', () => {
    const plain = new Character(0, 0, 'normal');
    const staged = new Character(0, 0, 'normal');
    staged.setStage(0);
    run(plain, 1);
    run(staged, 1);
    expect(snapshot(staged)).toEqual(snapshot(plain));
  });

  it('dims losers, glows winners warm, and returns to normal', () => {
    const c = new Character(0, 0, 'normal');
    run(c, 1);
    const normal = snapshot(c);
    expect(normal.length).toBeGreaterThan(0);

    c.setStage(-1);
    run(c, 3);
    snapshot(c).forEach((s, i) => {
      s.color.forEach((v, ch) => expect(v).toBeCloseTo(normal[i].color[ch] * 0.4, 2));
      s.emissive.forEach((v, ch) => expect(v).toBeCloseTo(normal[i].emissive[ch], 3));
    });

    c.setStage(1);
    run(c, 3);
    snapshot(c).forEach((s, i) => {
      s.color.forEach((v, ch) => expect(v).toBeCloseTo(normal[i].color[ch], 3));
      expect(s.emissive[0]).toBeGreaterThan(0.15);
      expect(s.emissive[0]).toBeGreaterThan(s.emissive[2]);
    });

    c.setStage(0);
    run(c, 3);
    snapshot(c).forEach((s, i) => {
      s.color.forEach((v, ch) => expect(v).toBeCloseTo(normal[i].color[ch], 3));
      s.emissive.forEach((v, ch) => expect(v).toBeCloseTo(normal[i].emissive[ch], 3));
    });
  });

  it('clamps out-of-range levels', () => {
    const c = new Character(0, 0, 'normal');
    run(c, 1);
    const normal = snapshot(c);
    c.setStage(-5);
    run(c, 3);
    snapshot(c).forEach((s, i) => s.color.forEach((v, ch) => expect(v).toBeCloseTo(normal[i].color[ch] * 0.4, 2)));
  });
});
