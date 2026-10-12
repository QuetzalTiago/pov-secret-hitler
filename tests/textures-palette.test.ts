import { beforeAll, describe, expect, it } from 'vitest';

// textures.ts only touches document inside draw callbacks, but stub it like textures-redraw.test.ts.
let tx: typeof import('../client/scene/textures');

beforeAll(async () => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }) }),
  };
  tx = await import('../client/scene/textures');
});

describe('relLuminance', () => {
  it('maps white to 1 and black to 0', () => {
    expect(tx.relLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(tx.relLuminance('#000000')).toBe(0);
  });
});

describe('aged noir palette', () => {
  it('keeps large-fill colours dark enough to sit under the lamp', () => {
    const { COLORS } = tx;
    for (const c of [COLORS.paper, COLORS.stock, COLORS.liberal, COLORS.fascist, COLORS.hitler, COLORS.ink, COLORS.ochre]) {
      expect(tx.relLuminance(c)).toBeLessThanOrEqual(0.45);
    }
  });

  it('has darker paper than the old poster cream', () => {
    expect(tx.relLuminance(tx.COLORS.paper)).toBeLessThan(tx.relLuminance('#F7E1C3'));
  });
});
