import { describe, expect, it, vi } from 'vitest';
import { fullscreenSupported, isFullscreenKey, toggleFullscreen } from '../client/fullscreen';

function fakeDoc(over: Record<string, unknown> = {}) {
  const requestFullscreen = vi.fn(() => Promise.resolve());
  const exitFullscreen = vi.fn(() => Promise.resolve());
  const doc = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: { requestFullscreen },
    exitFullscreen,
    ...over,
  } as unknown as Document;
  return { doc, requestFullscreen, exitFullscreen };
}

const key = (k: string, over: Partial<KeyboardEvent> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  ...over,
});
const el = (tagName: string) => ({ tagName }) as Element;

describe('fullscreen', () => {
  it('requests fullscreen when not fullscreen', () => {
    const { doc, requestFullscreen, exitFullscreen } = fakeDoc();
    toggleFullscreen(doc);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('exits fullscreen when fullscreen', () => {
    const { doc, requestFullscreen, exitFullscreen } = fakeDoc({ fullscreenElement: {} });
    toggleFullscreen(doc);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('swallows a rejected request', async () => {
    const { doc } = fakeDoc();
    (doc.documentElement as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = () =>
      Promise.reject(new Error('denied'));
    expect(() => toggleFullscreen(doc)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('reports support from fullscreenEnabled', () => {
    expect(fullscreenSupported(fakeDoc().doc)).toBe(true);
    expect(fullscreenSupported(fakeDoc({ fullscreenEnabled: false }).doc)).toBe(false);
  });

  it('accepts f and F', () => {
    expect(isFullscreenKey(key('f'), null)).toBe(true);
    expect(isFullscreenKey(key('F'), el('BODY'))).toBe(true);
  });

  it('rejects modifiers, repeat, text fields and other keys', () => {
    expect(isFullscreenKey(key('f', { ctrlKey: true }), null)).toBe(false);
    expect(isFullscreenKey(key('f', { repeat: true }), null)).toBe(false);
    expect(isFullscreenKey(key('f'), el('INPUT'))).toBe(false);
    expect(isFullscreenKey(key('f'), el('TEXTAREA'))).toBe(false);
    expect(isFullscreenKey(key('g'), null)).toBe(false);
  });
});
