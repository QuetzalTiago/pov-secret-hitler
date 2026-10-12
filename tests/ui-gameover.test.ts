import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '../shared/view';
import { gameOverOrder, gameOverRow } from '../client/ui';

interface Node {
  tag: string;
  className: string;
  children: Node[];
  text?: string;
  [k: string]: unknown;
}

function node(tag: string): Node {
  const n: Node = {
    tag,
    className: '',
    children: [],
    appendChild(c: Node) {
      n.children.push(c);
      return c;
    },
    getContext: () =>
      new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : () => undefined), set: () => true }),
    toDataURL: () => 'data:image/png;base64,x',
  };
  return n;
}

describe('gameOverRow', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: node,
      createTextNode: (text: string) => ({ tag: '#text', className: '', children: [], text }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has exactly one portrait image, the name and a role tag', () => {
    const players = [
      { seat: 0, name: 'Ann', alive: true, role: 'liberal' },
      { seat: 1, name: 'Bo', alive: false, role: 'hitler' },
    ] as PlayerView[];
    const rows = players.map((p) => gameOverRow(p, 0) as unknown as Node);
    for (const li of rows) {
      const imgs = li.children.filter((c) => c.tag === 'img' && c.className === 'portrait');
      expect(imgs).toHaveLength(1);
      expect(imgs[0].width).toBe(48);
      expect(imgs[0].height).toBe(68);
      expect(String(imgs[0].src)).not.toMatch(/^data:/);
    }
    expect(String(rows[0].children[0].src)).toMatch(/role-liberal\.webp/);
    expect(String(rows[1].children[0].src)).toMatch(/role-hitler\.webp/);
    expect(rows[0].children[1].text).toBe('Ann (you)');
    expect(rows[1].children[2].textContent).toBe('Hitler ✝');
  });
});

describe('gameOverOrder', () => {
  it('lists Hitler, then Fascists, then Liberals, each by seat, without mutating the input', () => {
    const players = [
      { seat: 0, role: 'liberal' },
      { seat: 1, role: 'fascist' },
      { seat: 2, role: 'liberal' },
      { seat: 3, role: 'hitler' },
      { seat: 4, role: 'fascist' },
    ] as PlayerView[];
    const out = gameOverOrder(players);
    expect(out.map((p) => p.seat)).toEqual([3, 1, 4, 0, 2]);
    expect(players.map((p) => p.seat)).toEqual([0, 1, 2, 3, 4]);
  });
});
