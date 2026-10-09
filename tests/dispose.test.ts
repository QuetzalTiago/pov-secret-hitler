import * as THREE from 'three';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeAll(() => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }),
  };
});

let disposeObject: typeof import('../client/scene/dispose').disposeObject;
let tx: typeof import('../client/scene/textures');

beforeEach(async () => {
  vi.resetModules(); // fresh texture cache per test
  tx = await import('../client/scene/textures');
  ({ disposeObject } = await import('../client/scene/dispose'));
});

function count(r: any) {
  const c = { n: 0 };
  r.addEventListener('dispose', () => c.n++);
  return c;
}

const plainTex = () => new THREE.Texture();

describe('disposeObject', () => {
  it('disposes geometry, material and non-cached map once each; shared material once', () => {
    const geo = new THREE.BoxGeometry();
    const geo2 = new THREE.BoxGeometry();
    const map = plainTex();
    const mat = new THREE.MeshBasicMaterial({ map });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo2, mat));
    const [cg, cg2, cm, ct] = [count(geo), count(geo2), count(mat), count(map)];
    disposeObject(g);
    expect([cg.n, cg2.n, cm.n, ct.n]).toEqual([1, 1, 1, 1]);
  });

  it('disposes a shared geometry once and handles material arrays', () => {
    const geo = new THREE.BoxGeometry();
    const m1 = new THREE.MeshBasicMaterial();
    const m2 = new THREE.MeshBasicMaterial();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, [m1, m2]), new THREE.Mesh(geo, m1));
    const [cg, c1, c2] = [count(geo), count(m1), count(m2)];
    disposeObject(g);
    expect([cg.n, c1.n, c2.n]).toEqual([1, 1, 1]);
  });

  it('keep skips a listed material (and its textures) but not others', () => {
    const keepMat = new THREE.MeshBasicMaterial({ map: plainTex() });
    const otherMat = new THREE.MeshBasicMaterial();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), keepMat), new THREE.Mesh(new THREE.BoxGeometry(), otherMat));
    const [ck, co, cmap] = [count(keepMat), count(otherMat), count(keepMat.map)];
    disposeObject(g, { keep: [keepMat] });
    expect([ck.n, co.n, cmap.n]).toEqual([0, 1, 0]);
  });

  it('keep skips a listed geometry', () => {
    const geo = new THREE.BoxGeometry();
    const c = count(geo);
    disposeObject(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()), { keep: [geo] });
    expect(c.n).toBe(0);
  });

  it('geometry:false skips geometry but still disposes material', () => {
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshBasicMaterial();
    const [cg, cm] = [count(geo), count(mat)];
    disposeObject(new THREE.Mesh(geo, mat), { geometry: false });
    expect([cg.n, cm.n]).toEqual([0, 1]);
  });

  it('Sprite: geometry untouched, material and textSprite texture disposed', () => {
    const { texture } = tx.textSprite('hello world');
    expect(tx.isCachedTexture(texture)).toBe(false);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
    const [cg, cm, ct] = [count(sprite.geometry), count(sprite.material), count(texture)];
    disposeObject(sprite);
    expect([cg.n, cm.n, ct.n]).toEqual([0, 1, 1]);
  });

  it('material with a cached texture: material disposed, texture not', () => {
    const t = tx.labelTexture('x', '#fff');
    expect(tx.isCachedTexture(t)).toBe(true);
    const mat = new THREE.MeshBasicMaterial({ map: t });
    const [cm, ct] = [count(mat), count(t)];
    disposeObject(new THREE.Mesh(new THREE.BoxGeometry(), mat));
    expect([cm.n, ct.n]).toEqual([1, 0]);
  });
});

describe('texture cache LRU', () => {
  const label = (i: number) => tx.labelTexture(`lbl-${i}`, '#fff');

  it('evicts and disposes the oldest entry past 64', () => {
    const first = label(0);
    const c = count(first);
    for (let i = 1; i < 64; i++) label(i);
    expect(tx.isCachedTexture(first)).toBe(true);
    expect(c.n).toBe(0);
    label(64); // 65th distinct key
    expect(c.n).toBe(1);
    expect(tx.isCachedTexture(first)).toBe(false);
    expect(tx.isCachedTexture(label(1))).toBe(true);
  });

  it('re-requesting a key bumps it so the next-oldest is evicted instead', () => {
    const t1 = label(0);
    const t2 = label(1);
    const [c1, c2] = [count(t1), count(t2)];
    for (let i = 2; i < 64; i++) label(i);
    expect(label(0)).toBe(t1); // cache hit, bump
    label(64);
    expect([c1.n, c2.n]).toEqual([0, 1]);
    expect(tx.isCachedTexture(t1)).toBe(true);
    expect(tx.isCachedTexture(t2)).toBe(false);
  });
});
