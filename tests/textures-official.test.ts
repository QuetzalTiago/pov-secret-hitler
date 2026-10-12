import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake canvas recording drawImage, fillText, fillRect and gradient calls in order.
const drawn: unknown[][] = [];
const texts: string[] = [];
const rects: { y: number; h: number; afterImage: boolean }[] = [];
const calls = { gradient: 0 };
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
      if (k === 'fillText')
        return (text: string) => {
          texts.push(String(text));
        };
      if (k === 'fillRect')
        return (_x: number, y: number, _w: number, h: number) => {
          rects.push({ y, h, afterImage: drawn.length > 0 });
        };
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern')
        return () => {
          calls.gradient++;
          return { addColorStop() {} };
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
type Key = Parameters<typeof import('../client/scene/officialart').officialImage>[0];

beforeEach(async () => {
  vi.resetModules();
  drawn.length = 0;
  texts.length = 0;
  rects.length = 0;
  calls.gradient = 0;
  tx = await import('../client/scene/textures');
  art = await import('../client/scene/officialart');
});

afterEach(() => {
  art.resetOfficialArt();
  g.fetch = saved.fetch;
  g.createImageBitmap = saved.createImageBitmap;
});

async function loadArt() {
  g.fetch = async (url: string) => ({ ok: true, blob: async () => ({ url }) });
  g.createImageBitmap = async () => ({ width: 512, height: 720, close() {} });
  await art.loadOfficialArt({ search: '' });
}

const cases: [string, Key, () => unknown][] = [
  ['policyFace L', 'policy-L', () => tx.policyFace('L')],
  ['policyFace F', 'policy-F', () => tx.policyFace('F')],
  ['cardBack POLICY', 'policy-back', () => tx.cardBack('POLICY')],
  ['cardBack ROLE', 'role-back', () => tx.cardBack('ROLE')],
  ['cardBack MEMBERSHIP', 'member-back', () => tx.cardBack('MEMBERSHIP')],
  ['cardBack BALLOT', 'ballot-back', () => tx.cardBack('BALLOT')],
  ['ballotFace ja', 'ballot-ja', () => tx.ballotFace(true)],
  ['ballotFace nein', 'ballot-nein', () => tx.ballotFace(false)],
  ['roleCard liberal', 'role-liberal', () => tx.roleCard('liberal')],
  ['roleCard fascist', 'role-fascist', () => tx.roleCard('fascist')],
  ['roleCard hitler', 'role-hitler', () => tx.roleCard('hitler')],
  ['roleCard hitler seed 3', 'role-hitler', () => tx.roleCard('hitler', 3)],
  ['membershipCard Ana', 'member-liberal', () => tx.membershipCard('Ana', 'liberal')],
  ['membershipCard Bo', 'member-fascist', () => tx.membershipCard('Bo', 'fascist')],
];

describe('official card art', () => {
  it.each(cases)('%s fills the canvas with the loaded image', async (_n, key, make) => {
    await loadArt();
    make();
    const img = art.officialImage(key);
    expect(img).not.toBeNull();
    expect(drawn).toHaveLength(1);
    expect(drawn[0][0]).toBe(img);
    expect(drawn[0]).toEqual([img, 0, 0, 256, 360]);
    expect(calls.gradient).toBe(0);
  });

  it.each(cases)('%s draws procedurally without art', (_n, _key, make) => {
    make();
    expect(drawn).toHaveLength(0);
    expect(calls.gradient).toBe(0);
  });

  it.each(cases)('%s picks up art loaded after creation on redraw', async (_n, key, make) => {
    make();
    expect(drawn).toHaveLength(0);
    await loadArt();
    tx.redrawTextures();
    expect(drawn).toHaveLength(1);
    expect(drawn[0][0]).toBe(art.officialImage(key));
  });

  it('keeps the discard back procedural', async () => {
    await loadArt();
    tx.cardBack('DISCARD');
    expect(drawn).toHaveLength(0);
  });

  it('keeps the envelope procedural', async () => {
    await loadArt();
    tx.envelopeTexture();
    expect(drawn).toHaveLength(0);
  });

  it('letters the membership name in a top strip clear of the seal', async () => {
    await loadArt();
    tx.membershipCard('Ana', 'liberal');
    expect(texts).toContain('Ana');
    const after = rects.filter((r) => r.afterImage);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((r) => r.y + r.h <= 0.23 * 360)).toBe(true);
  });
});
