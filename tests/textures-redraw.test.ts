import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal fake canvas so textures.ts can run in node; counts fillText calls.
const calls = { fillText: 0 };
function fakeCtx() {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 10 });
      if (k === 'getImageData')
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k === 'fillText')
        return () => {
          calls.fillText++;
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

beforeAll(() => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }),
  };
});

let tx: typeof import('../client/scene/textures');

beforeEach(async () => {
  vi.resetModules();
  calls.fillText = 0;
  tx = await import('../client/scene/textures');
});

describe('redrawTextures', () => {
  it("re-runs each cached texture's draw and flags it for upload", () => {
    const t = tx.policyFace('L');
    const v = t.version;
    const drawn = calls.fillText;
    expect(drawn).toBeGreaterThan(0);
    expect(tx.redrawTextures()).toBeGreaterThanOrEqual(1);
    expect(t.version).toBeGreaterThan(v);
    expect(calls.fillText).toBeGreaterThan(drawn);
  });
});
