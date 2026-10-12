import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portraitUrl, sealUrl } from '../client/art';

// Fake canvas: the 2D context swallows every call; toDataURL hands out a unique URL per draw.
function fakeContext() {
  return new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 5 }) : () => undefined),
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  });
}

describe('HUD art urls', () => {
  let created: number;

  beforeEach(() => {
    created = 0;
    let n = 0;
    vi.stubGlobal('document', {
      createElement: () => {
        created++;
        return { width: 0, height: 0, getContext: fakeContext, toDataURL: () => `data:image/png;base64,${n++}` };
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('portraits are the official role art, no canvas', () => {
    for (const kind of ['liberal', 'fascist', 'hitler'] as const) {
      const url = portraitUrl(kind);
      expect(url).not.toMatch(/^data:/);
      expect(url).toMatch(new RegExp(`role-${kind}.*\\.webp`));
    }
    expect(created).toBe(0);
  });

  it('seals are the official art, no canvas', () => {
    expect(sealUrl('L')).toMatch(/seal-liberal.*\.webp/);
    expect(sealUrl('F')).toMatch(/seal-fascist.*\.webp/);
    expect(created).toBe(0);
  });
});
