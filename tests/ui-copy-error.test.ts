import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UI } from '../client/ui';

// Minimal fake DOM: every id resolves to a cached stub element.
function stubEl(text = '') {
  const cls = new Set<string>();
  return {
    textContent: text,
    value: '',
    onclick: null as null | (() => void),
    classList: {
      add: (c: string) => cls.add(c),
      remove: (c: string) => cls.delete(c),
      contains: (c: string) => cls.has(c),
      toggle: (c: string) => (cls.has(c) ? cls.delete(c) : cls.add(c)),
    },
    style: {},
    dataset: {},
    addEventListener() {},
    focus() {},
    blur() {},
    select() {},
    click() {},
  };
}

describe('UI copy and error timers', () => {
  let els: Record<string, ReturnType<typeof stubEl>>;
  let ui: UI;

  beforeEach(() => {
    vi.useFakeTimers();
    els = {};
    const get = (id: string) => (els[id] ??= stubEl(id === 'copy-code' ? 'copy' : ''));
    vi.stubGlobal('document', { getElementById: get, activeElement: null });
    vi.stubGlobal('window', { addEventListener() {} });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    vi.stubGlobal('location', { origin: 'http://x' });
    ui = new UI({} as any);
    get('hud').classList.add('hidden');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restores the original label after two quick copy clicks', async () => {
    const btn = els['copy-code'];
    btn.onclick!();
    await vi.advanceTimersByTimeAsync(500);
    expect(btn.textContent).toBe('copied');
    btn.onclick!();
    await vi.advanceTimersByTimeAsync(500);
    expect(btn.textContent).toBe('copied');
    await vi.advanceTimersByTimeAsync(2000);
    expect(btn.textContent).toBe('copy');
  });

  it('a newer error is not hidden by the older error timer', () => {
    ui.error('a');
    vi.advanceTimersByTime(3000);
    ui.error('b');
    vi.advanceTimersByTime(2500);
    expect(els['lobby-error'].classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(2500);
    expect(els['lobby-error'].classList.contains('hidden')).toBe(true);
  });
});
