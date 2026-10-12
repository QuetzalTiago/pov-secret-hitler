import { drawPortrait } from './scene/portraits';
import { drawSeal } from './scene/seals';
import { COLORS } from './scene/textures';

// HUD <img> sources drawn with the same canvas painters as the 3D cards; memoised so each is drawn once.
const cache = new Map<string, string>();

function render(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  draw(g);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function portraitUrl(kind: 'liberal' | 'fascist' | 'hitler', seed: number, w = 96, h = 120): string {
  return render(`p:${kind}:${seed}:${w}:${h}`, w, h, (g) => drawPortrait(g, kind, seed, 0, 0, w, h));
}

export function sealUrl(party: 'L' | 'F' | null, size = 64): string {
  const field = party === 'L' ? COLORS.liberalDeep : party === 'F' ? COLORS.fascistDeep : COLORS.ink;
  return render(`s:${party}:${size}`, size, size, (g) => drawSeal(g, party, size / 2, size / 2, size / 2 - 2, field));
}
