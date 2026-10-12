import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake canvas: counts gradient and pattern creation and records every font assignment.
const calls = { gradient: 0, fonts: [] as string[], texts: [] as { text: string; font: string }[], images: [] as unknown[][] };
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
      if (k === 'drawImage')
        return (...args: unknown[]) => {
          calls.images.push(args);
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
  calls.images = [];
  tx = await import('../client/scene/textures');
});

describe('flat ink textures', () => {
  const cards: [string, () => unknown][] = [
    ['policyFace L', () => tx.policyFace('L')],
    ['policyFace F', () => tx.policyFace('F')],
    ['cardBack', () => tx.cardBack()],
    ['cardBack BALLOT', () => tx.cardBack('BALLOT')],
    ['cardBack DISCARD', () => tx.cardBack('DISCARD')],
    ['ballotFace ja', () => tx.ballotFace(true)],
    ['ballotFace nein', () => tx.ballotFace(false)],
    ['roleCard liberal', () => tx.roleCard('liberal')],
    ['roleCard fascist', () => tx.roleCard('fascist')],
    ['roleCard hitler', () => tx.roleCard('hitler')],
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
  it('pins the official slot centres', () => {
    const close = (a: readonly number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
    const lib = 660 / 2018;
    const split = lib / (lib + 673 / 2035);
    close(tx.BOARD_SLOTS.liberal(0), [428 / 2018, (330.5 / 660) * split]);
    close(tx.BOARD_SLOTS.fascist(5), [1751 / 2035, split + (341 / 673) * (1 - split)]);
    close(tx.BOARD_SLOTS.tracker(3), [1290 / 2018, (586.5 / 660) * split]);
    for (let i = 0; i < 6; i++) {
      const [u, v] = tx.BOARD_SLOTS.fascist(i);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThan(split);
      expect(v).toBeLessThan(1);
    }
    for (let i = 0; i < 5; i++) {
      const [u, v] = tx.BOARD_SLOTS.liberal(i);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(split);
    }
    for (let i = 0; i < 4; i++) {
      const [, v] = tx.BOARD_SLOTS.tracker(i);
      expect(v).toBeGreaterThan(tx.BOARD_SLOTS.liberal(0)[1]);
      expect(v).toBeLessThan(split);
    }
    expect(tx.BOARD_ASPECT).toBeCloseTo(1.5203, 3);
  });

  it('picks the fascist board art for each player-count track', () => {
    expect(tx.fascistBoardKey([null, null, 'peek', 'execute', 'execute', null])).toBe('board-fascist-56');
    expect(tx.fascistBoardKey([null, 'investigate', 'special', 'execute', 'execute', null])).toBe('board-fascist-78');
    expect(tx.fascistBoardKey(['investigate', 'investigate', 'special', 'execute', 'execute', null])).toBe('board-fascist-910');
  });
});

describe('fallback without art', () => {
  const plain: [string, () => unknown, string[]][] = [
    ['policyFace L', () => tx.policyFace('L'), ['LIBERAL']],
    ['policyFace F', () => tx.policyFace('F'), ['FASCIST']],
    ['cardBack', () => tx.cardBack(), ['POLICY']],
    ['cardBack DISCARD', () => tx.cardBack('DISCARD'), ['DISCARD']],
    ['ballotFace ja', () => tx.ballotFace(true), ['JA!']],
    ['ballotFace nein', () => tx.ballotFace(false), ['NEIN!']],
    ['roleCard liberal', () => tx.roleCard('liberal'), ['LIBERAL']],
    ['roleCard fascist', () => tx.roleCard('fascist'), ['FASCIST']],
    ['roleCard hitler', () => tx.roleCard('hitler'), ['HITLER']],
    ['membershipCard', () => tx.membershipCard('Ana', 'liberal'), ['LIBERAL', 'Ana']],
    ['placardTexture', () => tx.placardTexture('PRESIDENT', '#ffffff'), ['PRESIDENT']],
    ['boardTexture', () => tx.boardTexture([null, null, 'peek', 'execute', 'execute', null]), ['LIBERAL', 'FASCIST']],
  ];

  it.each(plain)('%s draws its title in the blocky face, no gradients, no images', (_name, make, titles) => {
    expect(tx.officialBoard([])).toBeNull();
    make();
    for (const title of titles) {
      const hits = calls.texts.filter((t) => t.text === title);
      expect(hits.length, title).toBeGreaterThan(0);
      expect(hits.every((t) => t.font.includes('Big Shoulders Display')), title).toBe(true);
    }
    expect(calls.gradient).toBe(0);
    expect(calls.images).toEqual([]);
  });
});

describe('board texture with official art', () => {
  const bitmaps = { 'board-liberal': { id: 'lib' }, 'board-fascist-56': { id: 'f56' }, 'board-fascist-78': { id: 'f78' } };
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../client/scene/officialart', () => ({ officialImage: (k: keyof typeof bitmaps) => bitmaps[k] ?? null }));
    tx = await import('../client/scene/textures');
  });

  it('draws only the two stacked board images', () => {
    tx.boardTexture([null, 'investigate', 'special', 'execute', 'execute', null]);
    expect(calls.images.map((a) => a[0])).toEqual([bitmaps['board-liberal'], bitmaps['board-fascist-78']]);
    const [, , , lw, lh] = calls.images[0] as number[];
    const [, , fy, fw, fh] = calls.images[1] as number[];
    expect(fy).toBeCloseTo(lh, 6);
    expect(fw).toBe(lw);
    expect((lw as number) / (lh + fh)).toBeCloseTo(tx.BOARD_ASPECT, 3);
    expect(calls.texts).toEqual([]);
    expect(calls.gradient).toBe(0);
  });
});
