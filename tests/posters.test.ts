import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake canvas recording drawImage calls (the fake ctx applies no transforms).
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

/** Stubs fetch + createImageBitmap; urls containing a name in `missing` fail to load. */
function stubArt(missing: string[] = []) {
  g.fetch = async (url: string) => ({ ok: !missing.some((m) => url.includes(m)), status: 404, blob: async () => ({ url }) });
  g.createImageBitmap = async (b: { url: string }) => ({ width: 512, height: 720, url: b.url, close() {} });
}

const KEYS = ['role-liberal', 'role-fascist', 'role-hitler', 'logo', 'policy-L', 'policy-F'] as const;

describe('posterAtlas', () => {
  it('uses the procedural posters with no official art', () => {
    tx.posterAtlas();
    expect(drawn).toHaveLength(0);
  });

  it('draws every official image inside its 512x768 cell, in cell order', async () => {
    stubArt();
    await art.loadOfficialArt({ search: '' });
    tx.posterAtlas();
    expect(drawn.map((a) => a[0])).toEqual(KEYS.map((k) => art.officialImage(k)));
    for (const a of drawn) {
      const [, x, y, w, h] = a as number[];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(512);
      expect(y + h).toBeLessThanOrEqual(768);
    }
  });

  it('draws only the logo in cell 3 when a policy card is missing', async () => {
    stubArt(['policy-L']);
    await art.loadOfficialArt({ search: '' });
    expect(art.officialImage('policy-L')).toBeNull();
    tx.posterAtlas();
    const imgs = drawn.map((a) => a[0]);
    expect(imgs).toEqual((['role-liberal', 'role-fascist', 'role-hitler', 'logo'] as const).map((k) => art.officialImage(k)));
    expect(imgs).not.toContain(art.officialImage('policy-F'));
  });

  it('repaints the cached atlas with the art after it loads', async () => {
    tx.posterAtlas();
    expect(drawn).toHaveLength(0);
    stubArt();
    await art.loadOfficialArt({ search: '' });
    tx.redrawTextures();
    expect(drawn).toHaveLength(6);
  });
});
