import { beforeEach, describe, expect, it, vi } from 'vitest';

// Recording fake canvas: logs method calls, property sets and fillText strings.
type Log = { calls: string[]; sets: string[]; text: string[] };
function recorder(): { g: CanvasRenderingContext2D; log: Log } {
  const log: Log = { calls: [], sets: [], text: [] };
  const props: Record<string, unknown> = {};
  const g = new Proxy(props, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 10 });
      if (k === 'getImageData')
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        log.calls.push(k);
        if (k === 'fillText') log.text.push(String(args[0]));
        return { addColorStop() {} };
      };
    },
    set(t, k: string, v) {
      log.sets.push(`${k}=${String(v)}`);
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { g, log };
}

let seals: typeof import('../client/scene/seals');

beforeEach(async () => {
  vi.resetModules();
  seals = await import('../client/scene/seals');
});

function seal(r = 60) {
  const { g, log } = recorder();
  seals.drawNeutralSeal(g, 100, 100, r, '#222222');
  return log;
}

describe('drawNeutralSeal', () => {
  it('draws the disc and letters the secret ring', () => {
    const log = seal();
    expect(log.calls).toContain('arc');
    expect(log.text.join('')).toContain('SECRET');
  });

  it('skips lettering at small radii', () => {
    expect(seal(16).text).toEqual([]);
    expect(seal(24).text.length).toBeGreaterThan(0);
  });

  it('stays flat and balanced', () => {
    const log = seal();
    expect(log.calls.filter((c) => /Gradient|createPattern/.test(c))).toEqual([]);
    expect(log.sets.filter((s) => /^(shadowBlur|filter)=/.test(s))).toEqual([]);
    expect(log.calls.filter((c) => c === 'save').length).toBe(log.calls.filter((c) => c === 'restore').length);
  });
});
