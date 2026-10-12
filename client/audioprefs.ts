// Persisted audio preferences. Pure: no DOM, the storage is passed in.

export const SFX_MASTER = 0.8;

export interface AudioPrefs {
  sound: boolean;
  music: boolean;
  /** 0-100 */
  musicVolume: number;
  /** 0-100 */
  sfxVolume: number;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { sound: true, music: true, musicVolume: 100, sfxVolume: 100 };

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;

export function clampVolume(v: unknown, fallback = 100): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function read(storage: Store, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function write(storage: Store, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function loadAudioPrefs(storage: Store): AudioPrefs {
  return {
    sound: read(storage, 'sh-sound') !== 'off',
    music: read(storage, 'sh-music') !== 'off',
    musicVolume: clampVolume(read(storage, 'sh-music-vol')),
    sfxVolume: clampVolume(read(storage, 'sh-sfx-vol')),
  };
}

export function saveAudioPrefs(storage: Store, prefs: Partial<AudioPrefs>) {
  if (prefs.sound !== undefined) write(storage, 'sh-sound', prefs.sound ? 'on' : 'off');
  if (prefs.music !== undefined) write(storage, 'sh-music', prefs.music ? 'on' : 'off');
  if (prefs.musicVolume !== undefined) write(storage, 'sh-music-vol', String(clampVolume(prefs.musicVolume)));
  if (prefs.sfxVolume !== undefined) write(storage, 'sh-sfx-vol', String(clampVolume(prefs.sfxVolume)));
}

export function sfxGain(p: Pick<AudioPrefs, 'sound' | 'sfxVolume'>): number {
  return p.sound ? (SFX_MASTER * p.sfxVolume) / 100 : 0;
}

export function musicScale(volume: number): number {
  return clampVolume(volume) / 100;
}
