import { describe, expect, it } from 'vitest';
import { clampVolume, DEFAULT_AUDIO_PREFS, loadAudioPrefs, musicScale, saveAudioPrefs, sfxGain } from '../client/audioprefs';

const fake = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('audio prefs storage', () => {
  it('defaults with empty and null storage', () => {
    expect(loadAudioPrefs(fake())).toEqual(DEFAULT_AUDIO_PREFS);
    expect(loadAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it('round-trips all four fields', () => {
    const s = fake();
    saveAudioPrefs(s, { sound: false, music: false, musicVolume: 30, sfxVolume: 65 });
    expect(loadAudioPrefs(s)).toEqual({ sound: false, music: false, musicVolume: 30, sfxVolume: 65 });
  });

  it('writes only the given fields', () => {
    const s = fake();
    saveAudioPrefs(s, { sfxVolume: 10 });
    expect([...s.m.keys()]).toEqual(['sh-sfx-vol']);
  });

  it('clamps a stored out-of-range volume', () => {
    const s = fake();
    s.setItem('sh-music-vol', '999');
    expect(loadAudioPrefs(s).musicVolume).toBe(100);
  });

  it('survives a throwing storage', () => {
    expect(loadAudioPrefs(throwing)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(() => saveAudioPrefs(throwing, { sound: false, musicVolume: 5 })).not.toThrow();
    expect(() => saveAudioPrefs(null, { sound: false })).not.toThrow();
  });
});

describe('clampVolume', () => {
  it('clamps, rounds and parses', () => {
    expect(clampVolume(-5)).toBe(0);
    expect(clampVolume(250)).toBe(100);
    expect(clampVolume(42.6)).toBe(43);
    expect(clampVolume('70')).toBe(70);
  });

  it('falls back on garbage', () => {
    expect(clampVolume('abc')).toBe(100);
    expect(clampVolume('abc', 40)).toBe(40);
    expect(clampVolume(NaN, 25)).toBe(25);
    expect(clampVolume('', 25)).toBe(25);
    expect(clampVolume(null, 25)).toBe(25);
  });
});

describe('gains', () => {
  it('sfxGain', () => {
    expect(sfxGain({ sound: false, sfxVolume: 100 })).toBe(0);
    expect(sfxGain({ sound: true, sfxVolume: 100 })).toBe(0.8);
    expect(sfxGain({ sound: true, sfxVolume: 50 })).toBeCloseTo(0.4);
  });

  it('musicScale', () => {
    expect(musicScale(50)).toBe(0.5);
  });
});
