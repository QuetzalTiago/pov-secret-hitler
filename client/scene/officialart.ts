// Official card and board art from Lee Yingtong Li's colour remake (CC BY-NC-SA 4.0, credits in client/art/CREDITS.md).
// null means "draw the procedural texture"; ?art=old forces that fallback.
import policyLUrl from '../art/policy-L.webp?url';
import policyFUrl from '../art/policy-F.webp?url';
import policyBackUrl from '../art/policy-back.webp?url';
import ballotJaUrl from '../art/ballot-ja.webp?url';
import ballotNeinUrl from '../art/ballot-nein.webp?url';
import ballotBackUrl from '../art/ballot-back.webp?url';
import roleLiberalUrl from '../art/role-liberal.webp?url';
import roleFascistUrl from '../art/role-fascist.webp?url';
import roleHitlerUrl from '../art/role-hitler.webp?url';
import roleBackUrl from '../art/role-back.webp?url';
import memberLiberalUrl from '../art/member-liberal.webp?url';
import memberFascistUrl from '../art/member-fascist.webp?url';
import memberBackUrl from '../art/member-back.webp?url';
import placardPresidentUrl from '../art/placard-president.webp?url';
import placardChancellorUrl from '../art/placard-chancellor.webp?url';
import boardLiberalUrl from '../art/board-liberal.webp?url';
import boardFascist56Url from '../art/board-fascist-56.webp?url';
import boardFascist78Url from '../art/board-fascist-78.webp?url';
import boardFascist910Url from '../art/board-fascist-910.webp?url';
import logoUrl from '../art/logo.webp?url';

const ART_URLS = {
  'policy-L': policyLUrl,
  'policy-F': policyFUrl,
  'policy-back': policyBackUrl,
  'ballot-ja': ballotJaUrl,
  'ballot-nein': ballotNeinUrl,
  'ballot-back': ballotBackUrl,
  'role-liberal': roleLiberalUrl,
  'role-fascist': roleFascistUrl,
  'role-hitler': roleHitlerUrl,
  'role-back': roleBackUrl,
  'member-liberal': memberLiberalUrl,
  'member-fascist': memberFascistUrl,
  'member-back': memberBackUrl,
  'placard-president': placardPresidentUrl,
  'placard-chancellor': placardChancellorUrl,
  'board-liberal': boardLiberalUrl,
  'board-fascist-56': boardFascist56Url,
  'board-fascist-78': boardFascist78Url,
  'board-fascist-910': boardFascist910Url,
  logo: logoUrl,
} as const;

export type ArtKey = keyof typeof ART_URLS;
export const ART_KEYS = Object.keys(ART_URLS) as ArtKey[];

const images = new Map<ArtKey, ImageBitmap>();

export function officialImage(key: ArtKey): ImageBitmap | null {
  return images.get(key) ?? null;
}

/** True when `?art=old` asks for the procedural textures. */
export function artForcedOld(search = typeof location !== 'undefined' ? location.search : ''): boolean {
  return new URLSearchParams(search).get('art') === 'old';
}

/** Loads every image, never rejects, and resolves with how many are available; slow or failed ones stay null. */
export async function loadOfficialArt(opts: { timeoutMs?: number; search?: string } = {}): Promise<number> {
  if (artForcedOld(opts.search) || typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return 0;
  let open = true;
  const load = async (key: ArtKey) => {
    try {
      const res = await fetch(ART_URLS[key]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bitmap = await createImageBitmap(await res.blob());
      if (open) images.set(key, bitmap);
      else bitmap.close(); // arrived after the cap: the look must not change without a redraw
    } catch (err) {
      console.warn('[art] could not load', key, err);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(ART_KEYS.map(load)),
      new Promise<void>((r) => {
        timer = setTimeout(r, opts.timeoutMs ?? 10_000);
      }),
    ]);
  } finally {
    open = false;
    clearTimeout(timer);
  }
  return images.size;
}

/** Closes and clears every stored image (used by tests). */
export function resetOfficialArt(): void {
  for (const b of images.values()) b.close();
  images.clear();
}
