import { beforeAll, describe, expect, it } from 'vitest';
import { LIGHTING, POSTER_TINT, PRINT_TINT } from '../client/scene/lighting';

// Fake canvas so props.ts can build its textures.
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

let props: typeof import('../client/scene/props');

beforeAll(async () => {
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }) };
  props = await import('../client/scene/props');
});

const luminance = (hex: number) => {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('LIGHTING', () => {
  it('is no brighter than the previous dark pass', () => {
    expect(LIGHTING.exposure).toBeLessThanOrEqual(0.75);
    expect(LIGHTING.env).toBeLessThanOrEqual(0.06);
    expect(LIGHTING.ambient).toBeLessThanOrEqual(0.12);
    expect(LIGHTING.fill).toBeLessThanOrEqual(1.5);
    expect(LIGHTING.neon).toBeLessThanOrEqual(0.6);
    expect(LIGHTING.waiterSpot).toBeLessThanOrEqual(8);
    expect(LIGHTING.lamp.angle).toBeLessThanOrEqual(Math.PI / 3.2);
    expect(LIGHTING.lamp.distance).toBeLessThanOrEqual(6);
    expect(LIGHTING.vignette).toBeGreaterThanOrEqual(0.6);
  });
});

describe('print tints', () => {
  it('dim printed art and posters', () => {
    expect(luminance(PRINT_TINT)).toBeLessThan(0.85);
    expect(luminance(POSTER_TINT)).toBeLessThan(0.6);
  });

  it('the placard face is tinted and not self-lit', () => {
    const face = (new props.Placard('PRESIDENT', '#000').mesh.material as any[])[4];
    expect(face.emissive.getHex() === 0 || face.emissiveIntensity === 0).toBe(true);
    expect(face.color.getHex()).toBe(PRINT_TINT);
  });

  it('the policy card face is tinted', () => {
    const face = (props.policyCard().mesh.material as any[])[2];
    expect(face.color.getHex()).toBe(PRINT_TINT);
  });
});
