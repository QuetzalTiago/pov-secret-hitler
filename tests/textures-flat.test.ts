import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake canvas: counts gradient and pattern creation and records every font assignment.
const calls = { gradient: 0, fonts: [] as string[], texts: [] as { text: string; font: string }[] };
function fakeCtx() {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 10 });
      if (k === 'getImageData')
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern')
        return () => {
          calls.gradient++;
          return { addColorStop() {} };
        };
      if (k === 'fillText')
        return (text: string) => {
          calls.texts.push({ text: String(text), font: String(t.font ?? '') });
        };
      if (k in t) return t[k];
      return () => ({ addColorStop() {} });
    },
    set(t, k: string, v) {
      if (k === 'font') calls.fonts.push(String(v));
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
  calls.gradient = 0;
  calls.fonts = [];
  calls.texts = [];
  tx = await import('../client/scene/textures');
});

describe('flat ink textures', () => {
  const cards: [string, () => unknown][] = [
    ['policyFace L', () => tx.policyFace('L')],
    ['policyFace F', () => tx.policyFace('F')],
    ['cardBack', () => tx.cardBack()],
    ['cardBack BALLOT', () => tx.cardBack('BALLOT')],
    ['ballotFace ja', () => tx.ballotFace(true)],
    ['ballotFace nein', () => tx.ballotFace(false)],
    ['roleCard liberal', () => tx.roleCard('liberal')],
    ['roleCard fascist', () => tx.roleCard('fascist')],
    ['roleCard hitler', () => tx.roleCard('hitler')],
    ['roleCard liberal seed 3', () => tx.roleCard('liberal', 3)],
    ['roleCard hitler seed 1', () => tx.roleCard('hitler', 1)],
    ['membershipCard Ana', () => tx.membershipCard('Ana', 'liberal')],
    ['membershipCard Bo', () => tx.membershipCard('Bo', 'fascist')],
  ];
  const others: [string, () => unknown][] = [
    ['signTexture', () => tx.signTexture()],
    ['envelopeTexture', () => tx.envelopeTexture()],
    ['posterAtlas', () => tx.posterAtlas()],
    ['bloodAtlas', () => tx.bloodAtlas()],
    ['boardTexture', () => tx.boardTexture([null, null, 'peek', 'execute', 'execute', null])],
  ];

  it.each([...cards, ...others])('%s uses no gradients or patterns', (_name, make) => {
    make();
    expect(calls.gradient).toBe(0);
  });

  it.each(cards)('%s uses no blackletter', (_name, make) => {
    make();
    expect(calls.fonts.length).toBeGreaterThan(0);
    expect(calls.fonts.filter((f) => f.includes('UnifrakturMaguntia'))).toEqual([]);
  });
});

describe('board texture', () => {
  it('pins the slot centres the 3D markers rely on', () => {
    const close = (a: readonly number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
    close(tx.BOARD_SLOTS.liberal(0), [140 / 1024, 172 / 640]);
    close(tx.BOARD_SLOTS.liberal(4), [884 / 1024, 172 / 640]);
    close(tx.BOARD_SLOTS.fascist(5), [900 / 1024, 422 / 640]);
    close(tx.BOARD_SLOTS.tracker(3), [700 / 1024, 580 / 640]);
  });

  it('letters its titles and WIN slots in the blocky face', () => {
    tx.boardTexture([null, null, 'peek', 'execute', 'execute', null]);
    for (const word of ['LIBERAL', 'FASCIST', 'ELECTION TRACKER', 'WIN']) {
      const hits = calls.texts.filter((t) => t.text === word);
      expect(hits.length, word).toBeGreaterThan(0);
      expect(hits.every((t) => t.font.includes('Big Shoulders Display')), word).toBe(true);
    }
  });
});
