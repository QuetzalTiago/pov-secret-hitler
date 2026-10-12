import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ART_KEYS, artForcedOld, loadOfficialArt, officialImage, resetOfficialArt } from '../client/scene/officialart';

const g = globalThis as any;
const saved = { fetch: g.fetch, createImageBitmap: g.createImageBitmap };
let fetchCalls: string[];
let closers: Record<string, ReturnType<typeof vi.fn>>;
let failUrl: string | null;
let logoDelayMs: number | null; // null: instant, negative: never resolves

beforeEach(() => {
  fetchCalls = [];
  closers = {};
  failUrl = null;
  logoDelayMs = null;
  g.fetch = async (url: string) => {
    fetchCalls.push(url);
    if (failUrl && url.includes(failUrl)) return { ok: false, status: 404 };
    return { ok: true, blob: async () => ({ url }) };
  };
  g.createImageBitmap = async (blob: { url: string }) => {
    const bitmap = { width: 512, height: 720, close: vi.fn(), src: blob.url };
    closers[blob.url] = bitmap.close;
    if (blob.url.includes('logo') && logoDelayMs !== null) {
      if (logoDelayMs < 0) return new Promise(() => {});
      await new Promise((r) => setTimeout(r, logoDelayMs!));
    }
    return bitmap;
  };
  resetOfficialArt();
});

afterEach(() => {
  resetOfficialArt();
  g.fetch = saved.fetch;
  g.createImageBitmap = saved.createImageBitmap;
  vi.restoreAllMocks();
});

describe('official art loader', () => {
  it('loads every image', async () => {
    expect(officialImage('policy-L')).toBeNull();
    const n = await loadOfficialArt({ search: '' });
    expect(n).toBe(ART_KEYS.length);
    expect(n).toBe(20);
    expect(officialImage('policy-L')?.width).toBe(512);
    expect(fetchCalls).toHaveLength(20);
  });

  it('?art=old loads nothing', async () => {
    expect(await loadOfficialArt({ search: '?art=old' })).toBe(0);
    expect(fetchCalls).toHaveLength(0);
    expect(officialImage('policy-L')).toBeNull();
    expect(artForcedOld('?art=old')).toBe(true);
    expect(artForcedOld('?join=ABCD')).toBe(false);
  });

  it('a failing image stays null without rejecting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failUrl = 'role-hitler';
    expect(await loadOfficialArt({ search: '' })).toBe(19);
    expect(officialImage('role-hitler')).toBeNull();
    expect(officialImage('role-fascist')).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a never-resolving image does not hold the load past the cap', async () => {
    logoDelayMs = -1;
    expect(await loadOfficialArt({ timeoutMs: 20, search: '' })).toBe(19);
    expect(officialImage('logo')).toBeNull();
  });

  it('an image arriving after the cap is closed, not stored', async () => {
    logoDelayMs = 50;
    await loadOfficialArt({ timeoutMs: 20, search: '' });
    await new Promise((r) => setTimeout(r, 80));
    expect(officialImage('logo')).toBeNull();
    const logoUrl = Object.keys(closers).find((u) => u.includes('logo'))!;
    expect(closers[logoUrl]).toHaveBeenCalled();
  });

  it('returns 0 without createImageBitmap', async () => {
    delete g.createImageBitmap;
    expect(await loadOfficialArt({ search: '' })).toBe(0);
    expect(officialImage('policy-L')).toBeNull();
  });
});
