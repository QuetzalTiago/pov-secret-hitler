const KEY = 'sh-gore';

/** Whether blood shows: ?gore=0 / ?gore=1 beat the saved choice; the default is on. Storage may throw, so it falls back to on. */
export function goreEnabled(search: string, storage: Pick<Storage, 'getItem'> | null): boolean {
  const q = new URLSearchParams(search).get('gore');
  if (q === '0') return false;
  if (q === '1') return true;
  try {
    return storage?.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setGore(on: boolean, storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Private mode can refuse writes; the choice then lasts for this visit only.
  }
}
