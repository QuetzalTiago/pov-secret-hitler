import { beforeAll, describe, expect, it } from 'vitest';

// Fake canvas context that logs every method call (name + numeric args) and every property set.
type Log = { calls: string[]; sets: string[]; points: [string, number[]][] };
function recorder(): { g: CanvasRenderingContext2D; log: Log } {
  const log: Log = { calls: [], sets: [], points: [] };
  const props: Record<string, unknown> = {};
  const g = new Proxy(props, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        const nums = args.filter((a): a is number => typeof a === 'number').map((n) => Math.round(n * 1000) / 1000);
        log.calls.push(`${k}(${nums.join(',')})`);
        log.points.push([k, nums]);
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

let mod: typeof import('../client/scene/portraits');

beforeAll(async () => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => recorder().g }),
  };
  mod = await import('../client/scene/portraits');
});

const KINDS = ['liberal', 'fascist', 'hitler'] as const;

function run(kind: (typeof KINDS)[number], seed: number, box = [10, 20, 200, 260]) {
  const { g, log } = recorder();
  mod.drawPortrait(g, kind, seed, box[0], box[1], box[2], box[3]);
  return log;
}
const sig = (l: Log) => l.calls.join('|') + '#' + l.sets.join('|');

describe('drawPortrait', () => {
  it('is deterministic for (kind, seed)', () => {
    for (const k of KINDS) expect(sig(run(k, 3))).toBe(sig(run(k, 3)));
  });

  it('draws the three kinds differently', () => {
    const [a, b, c] = KINDS.map((k) => sig(run(k, 1)));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('gives PORTRAIT_VARIANTS distinct drawings per kind', () => {
    for (const k of KINDS) {
      const set = new Set<string>();
      for (let s = 0; s < mod.PORTRAIT_VARIANTS; s++) set.add(sig(run(k, s)));
      expect(set.size).toBe(mod.PORTRAIT_VARIANTS);
    }
  });

  it('never uses gradients, patterns, shadows or filters', () => {
    for (const k of KINDS)
      for (let s = 0; s < 8; s++) {
        const l = run(k, s);
        expect(l.calls.some((c) => /^(createLinearGradient|createRadialGradient|createPattern)/.test(c))).toBe(false);
        expect(l.sets.some((c) => /^(shadowBlur|filter)=/.test(c))).toBe(false);
      }
  });

  it('keeps every point inside the box', () => {
    const [bx, by, bw, bh] = [10, 20, 200, 260];
    const tol = 2;
    const inside = (px: number, py: number) =>
      px >= bx - tol && px <= bx + bw + tol && py >= by - tol && py <= by + bh + tol;
    for (const k of KINDS)
      for (let s = 0; s < 8; s++)
        for (const [name, n] of run(k, s).points) {
          if (name === 'fillRect') {
            expect(inside(n[0], n[1])).toBe(true);
            expect(inside(n[0] + n[2], n[1] + n[3])).toBe(true);
          } else if (name === 'ellipse') {
            expect(inside(n[0] - n[2], n[1] - n[3])).toBe(true);
            expect(inside(n[0] + n[2], n[1] + n[3])).toBe(true);
          } else if (name === 'arc') {
            expect(inside(n[0] - n[2], n[1] - n[2])).toBe(true);
            expect(inside(n[0] + n[2], n[1] + n[2])).toBe(true);
          } else if (['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo'].includes(name)) {
            for (let i = 0; i + 1 < n.length; i += 2) expect(inside(n[i], n[i + 1])).toBe(true);
          }
        }
  });

  it('balances save and restore', () => {
    for (const k of KINDS) {
      const l = run(k, 2);
      const count = (n: string) => l.calls.filter((c) => c.startsWith(n + '(')).length;
      expect(count('save')).toBeGreaterThan(0);
      expect(count('save')).toBe(count('restore'));
    }
  });
});
