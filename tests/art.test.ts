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

  it('portraits are data urls, memoised per kind and seed', () => {
    const a = portraitUrl('fascist', 2);
    expect(a).toMatch(/^data:image\/png;base64,/);
    const made = created;
    expect(portraitUrl('fascist', 2)).toBe(a);
    expect(created).toBe(made);
    expect(portraitUrl('liberal', 2)).not.toBe(a);
    expect(portraitUrl('fascist', 3)).not.toBe(a);
  });

  it('seals differ by party and are memoised', () => {
    const l = sealUrl('L');
    const f = sealUrl('F');
    expect(l).not.toBe(f);
    const made = created;
    expect(sealUrl('L')).toBe(l);
    expect(sealUrl('F')).toBe(f);
    expect(created).toBe(made);
    expect(sealUrl(null)).not.toBe(l);
  });
});
