// Fullscreen helpers. The document is a parameter so they can be tested with a fake object.

export function fullscreenSupported(doc: Document = document): boolean {
  return !!doc.fullscreenEnabled && typeof doc.documentElement.requestFullscreen === 'function';
}

export function isFullscreen(doc: Document = document): boolean {
  return !!doc.fullscreenElement;
}

export function toggleFullscreen(doc: Document = document): void {
  // The browser may refuse (e.g. no user gesture); that is expected and harmless.
  if (isFullscreen(doc)) void doc.exitFullscreen().catch(() => {});
  else void doc.documentElement.requestFullscreen().catch(() => {});
}

/** F toggles fullscreen, except with modifiers, on key repeat, or while typing in a text field. */
export function isFullscreenKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>,
  active: Element | null,
): boolean {
  if (e.key !== 'f' && e.key !== 'F') return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  const tag = active?.tagName;
  return tag !== 'INPUT' && tag !== 'TEXTAREA';
}
