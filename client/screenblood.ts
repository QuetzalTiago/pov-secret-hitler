// First-person blood on the screen: seeded flat-ink splats, their fade/drip timing and the sleeve tint. Pure, no DOM/three.
import type { ScreenBlood } from './hudmodel';
import { rand } from './scene/rand';

/** Total seconds a screen splatter lives. */
export const SCREEN_BLOOD_S = 4;
const FADE_FROM_S = 1.2;
const DRIP_S = 2.5;
/** Spatter keeps this far from the screen centre so the table stays readable. */
const CLEAR_CENTRE = 0.25;

/** One splat: x, y as viewport fractions; r, dx, dy, drip, dripW as fractions of min(viewport w, h). */
export interface ScreenSplat {
  x: number;
  y: number;
  r: number;
  blobs: { dx: number; dy: number; r: number }[];
  drip: number;
  dripW: number;
  color: string;
}

const SPATTER_COLORS = ['#4a070b', '#5c0a0f'];
const VICTIM_COLORS = ['#8e0d14', '#a3111a', '#6d0a10'];

/** Deterministic splats for a hit: a few dark ones near the edges, or a heavy bright covering. */
export function screenSplats(kind: 'spatter' | 'victim', seed: number): ScreenSplat[] {
  const rnd = rand(1 + (seed >>> 0) % 2147483646);
  const between = (a: number, b: number) => a + (b - a) * rnd();
  const victim = kind === 'victim';
  const n = victim ? 16 + Math.floor(rnd() * 7) : 5 + Math.floor(rnd() * 4);
  const colors = victim ? VICTIM_COLORS : SPATTER_COLORS;
  const out: ScreenSplat[] = [];
  for (let i = 0; i < n; i++) {
    let x = rnd();
    let y = rnd();
    const d = Math.hypot(x - 0.5, y - 0.5);
    if (!victim && d < CLEAR_CENTRE) {
      // push the point out to the clear ring along its own direction (it fits in the viewport: the ring radius is under 0.5)
      if (d < 1e-6) x = 0.5 + CLEAR_CENTRE;
      else {
        x = 0.5 + ((x - 0.5) / d) * CLEAR_CENTRE;
        y = 0.5 + ((y - 0.5) / d) * CLEAR_CENTRE;
      }
    }
    const r = victim ? between(0.05, 0.14) : between(0.02, 0.06);
    const blobs = Array.from({ length: 3 + Math.floor(rnd() * 5) }, () => {
      const a = rnd() * Math.PI * 2;
      const dist = between(0.4, 2.2) * r;
      return { dx: Math.cos(a) * dist, dy: Math.sin(a) * dist, r: between(0.15, 0.5) * r };
    });
    const drip = between(0, victim ? 0.4 : 0.25);
    const dripW = between(0.2, 0.45) * r;
    out.push({ x, y, r, blobs, drip, dripW, color: colors[Math.floor(rnd() * colors.length)] });
  }
  return out;
}

/** Overlay opacity and drip progress (both 0..1) `t` seconds after the hit. */
export function screenBloodFrame(t: number): { alpha: number; drip: number } {
  const alpha = t >= SCREEN_BLOOD_S ? 0 : Math.min(1, Math.max(0, 1 - (t - FADE_FROM_S) / (SCREEN_BLOOD_S - FADE_FROM_S)));
  const k = Math.min(1, Math.max(0, t / DRIP_S));
  return { alpha, drip: 1 - (1 - k) * (1 - k) };
}

/** Tint amount for your own sleeves and cuffs. */
export function sleeveBlood(kind: ScreenBlood): number {
  return kind === 'victim' ? 0.65 : kind === 'spatter' ? 0.35 : 0;
}
