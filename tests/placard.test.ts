import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake canvas recording drawImage calls.
const drawn: unknown[][] = [];
function fakeCtx() {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 10 });
      if (k === 'getImageData')
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k === 'drawImage')
        return (...a: unknown[]) => {
          drawn.push(a);
        };
      if (k in t) return t[k];
      return () => ({ addColorStop() {} });
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
}

const g = globalThis as any;
const saved = { fetch: g.fetch, createImageBitmap: g.createImageBitmap, document: g.document };

beforeAll(() => {
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }) };
});

let tx: typeof import('../client/scene/textures');
let art: typeof import('../client/scene/officialart');

beforeEach(async () => {
  vi.resetModules();
  drawn.length = 0;
  tx = await import('../client/scene/textures');
  art = await import('../client/scene/officialart');
});

afterEach(() => {
  art.resetOfficialArt();
  g.fetch = saved.fetch;
  g.createImageBitmap = saved.createImageBitmap;
});

describe('containRect', () => {
  it('fits the president placard art into the 512x128 canvas', () => {
    const r = tx.containRect(1024, 275, 512, 128);
    expect(r.h).toBeCloseTo(128);
    expect(r.w).toBeCloseTo(476.6, 1);
    expect(r.x).toBeCloseTo(17.7, 1);
    expect(r.y).toBeCloseTo(0);
  });

  it('letterboxes a wider image vertically', () => {
    const r = tx.containRect(2000, 250, 512, 128);
    expect(r.w).toBeCloseTo(512);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeGreaterThan(0);
  });
});

describe('placardTexture', () => {
  it('uses the procedural draw with no official image', () => {
    tx.placardTexture('PRESIDENT', '#fff');
    expect(drawn).toHaveLength(0);
  });

  it('draws the loaded official image contain-fitted, also after a redraw', async () => {
    tx.placardTexture('PRESIDENT', '#fff');
    expect(drawn).toHaveLength(0);
    g.fetch = async (url: string) => ({ ok: true, blob: async () => ({ url }) });
    g.createImageBitmap = async () => ({ width: 1024, height: 275, close() {} });
    await art.loadOfficialArt({ search: '' });
    const img = art.officialImage('placard-president');
    expect(img).not.toBeNull();
    drawn.length = 0;
    tx.redrawTextures();
    const calls = drawn.filter((a) => a[0] === img);
    expect(calls).toHaveLength(1);
    const r = tx.containRect(1024, 275, 512, 128);
    expect(calls[0].slice(1)).toEqual([r.x, r.y, r.w, r.h]);
  });

  it('ignores other titles', async () => {
    g.fetch = async (url: string) => ({ ok: true, blob: async () => ({ url }) });
    g.createImageBitmap = async () => ({ width: 1024, height: 275, close() {} });
    await art.loadOfficialArt({ search: '' });
    tx.placardTexture('SOMEONE', '#fff');
    expect(drawn).toHaveLength(0);
  });
});
