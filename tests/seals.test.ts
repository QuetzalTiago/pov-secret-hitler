import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
let tx: typeof import('../client/scene/textures');

beforeAll(() => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => recorder().g }),
  };
});

beforeEach(async () => {
  vi.resetModules();
  tx = await import('../client/scene/textures');
  seals = await import('../client/scene/seals');
});

function seal(party: 'L' | 'F' | null, r = 60) {
  const { g, log } = recorder();
  seals.drawSeal(g, party, 100, 100, r, '#222222');
  return log;
}

describe('drawSeal', () => {
  it('letters the ring per party and differs between L, F and neutral', () => {
    const l = seal('L').text.join('');
    const f = seal('F').text.join('');
    const n = seal(null).text.join('');
    expect(l).toContain('LIBERAL PARTY');
    expect(f).toContain('FASCIST PARTY');
    expect(n).toContain('SECRET');
    expect(new Set([l, f, n]).size).toBe(3);
  });

  it('skips lettering at small radii', () => {
    for (const p of ['L', 'F', null] as const) expect(seal(p, 16).text).toEqual([]);
  });

  it('stays flat and balanced', () => {
    for (const p of ['L', 'F', null] as const) {
      const log = seal(p);
      expect(log.calls.filter((c) => /Gradient|createPattern/.test(c))).toEqual([]);
      expect(log.sets.filter((s) => /^(shadowBlur|filter)=/.test(s))).toEqual([]);
      expect(log.calls.filter((c) => c === 'save').length).toBe(log.calls.filter((c) => c === 'restore').length);
    }
  });
});

describe('roleCard seeds', () => {
  it('caches per role and seed', () => {
    expect(tx.roleCard('fascist', 0)).not.toBe(tx.roleCard('fascist', 1));
    expect(tx.roleCard('fascist', 1)).toBe(tx.roleCard('fascist', 1));
  });
});
