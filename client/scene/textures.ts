// Every texture is drawn on a canvas: official art images when loaded (see officialart.ts), procedural draws otherwise.
import * as THREE from 'three';
import { officialImage, type ArtKey } from './officialart';
import { rand } from './rand';
import { drawPortrait } from './portraits';
import { drawSeal } from './seals';

const DISPLAY = '"Jost", "Futura", "Century Gothic", "Trebuchet MS", sans-serif';
const MONO = '"Courier Prime", "Courier New", Courier, monospace';
/** Blackletter for period headings (sign, posters, card backs); never for small or game-critical text. */
const BLACK = '"UnifrakturMaguntia", "Old English Text MT", "Times New Roman", serif';
/** Blocky condensed display face for headings, ballots and card titles. */
export const BLOCK = '"Big Shoulders Display", "Jost", "Futura", "Arial Narrow", sans-serif';
const cache = new Map<string, THREE.CanvasTexture>();
const redraws = new WeakMap<THREE.CanvasTexture, () => void>();
const owned = new WeakSet<THREE.Texture>();
const shared = new WeakSet<THREE.Texture>();
const CACHE_MAX = 64;

export function isCachedTexture(t: THREE.Texture): boolean {
  return owned.has(t) || shared.has(t);
}

/** Marks a texture as shared so disposeObject never disposes it. */
export function markSharedTexture(t: THREE.Texture): THREE.Texture {
  shared.add(t);
  return t;
}

export const COLORS = {
  liberal: '#3d6a86',
  liberalDeep: '#22394a',
  liberalLight: '#7f97ab',
  fascist: '#b5482f',
  fascistDeep: '#5e2016',
  fascistLight: '#b0806f',
  hitler: '#7a1a10',
  paper: '#b9a37c',
  ochre: '#8f7448',
  ink: '#14110f',
  /** Cream for strokes, rules and lettering only, never a large fill. */
  line: '#e8d6b0',
  kraft: '#7a5f3a',
  gold: '#b8913f',
  brass: '#b8913f',
  stock: '#b9a37c',
  plaster: '#5a4630',
  oak: '#2b1a0e',
  lacquer: '#1e120a',
};

/** WCAG relative luminance of a #rrggbb colour (0 black .. 1 white). */
export function relLuminance(hex: string): number {
  const v = parseInt(hex.slice(1, 7), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const [c, g] = canvas(w, h);
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  redraws.set(t, () => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    draw(g, w, h);
  });
  cache.set(key, t);
  owned.add(t);
  if (cache.size > CACHE_MAX) {
    const [oldKey, old] = cache.entries().next().value!;
    cache.delete(oldKey);
    owned.delete(old);
    old.dispose();
  }
  return t;
}

/** Redraws every cached texture (e.g. once webfonts load) and flags it for re-upload. */
export function redrawTextures(): number {
  let n = 0;
  for (const t of cache.values()) {
    const redraw = redraws.get(t);
    if (!redraw) continue;
    redraw();
    t.needsUpdate = true;
    n++;
  }
  return n;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 7, ox = 0, oy = 0) {
  const r = rand(seed);
  const img = g.getImageData(ox, oy, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, ox, oy);
}

/**
 * Worn-card finish: a flat worn edge (two ink frames), a few faint tea stains, then light grain. Deterministic per seed.
 * (ox, oy) is the canvas position of the w x h region when drawing into one cell of an atlas.
 */
function age(g: CanvasRenderingContext2D, w: number, h: number, seed: number, ox = 0, oy = 0) {
  g.save();
  g.translate(ox, oy);
  frame(g, w, h, 'rgba(20,17,15,0.35)', 3, 6);
  frame(g, w, h, 'rgba(20,17,15,0.2)', 9, 3);
  g.restore();
  const r = rand(seed * 31 + 5);
  g.fillStyle = 'rgba(70,42,16,0.04)';
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.ellipse(r() * w, r() * h, w * (0.08 + r() * 0.14), h * (0.05 + r() * 0.1), r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  grain(g, w, h, 6, seed, ox, oy);
}

export function woodTexture(base = '#4a2c18', dark = '#2a170b', key = 'wood', repeat = 1) {
  const t = tex(key, 512, 512, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const r = rand(key.length * 97 + 3);
    for (let i = 0; i < 90; i++) {
      const y = r() * h;
      g.strokeStyle = dark;
      g.globalAlpha = 0.15 + r() * 0.35;
      g.lineWidth = 1 + r() * 4;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * (3 + r() * 6));
      g.stroke();
    }
    g.globalAlpha = 1;
    grain(g, w, h, 18, key.length);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

export function feltTexture() {
  const t = tex('felt', 256, 256, (g, w, h) => {
    g.fillStyle = '#1f4a34';
    g.fillRect(0, 0, w, h);
    grain(g, w, h, 26, 11);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

export function plankTexture() {
  const t = tex('planks', 512, 512, (g, w, h) => {
    const r = rand(5);
    for (let y = 0; y < h; y += 64) {
      const shade = 40 + r() * 25;
      g.fillStyle = `rgb(${shade + 18},${shade},${shade - 14})`;
      g.fillRect(0, y, w, 64);
      g.fillStyle = '#120a05';
      g.fillRect(0, y, w, 3);
      const off = r() * w;
      g.fillRect(off, y, 3, 64);
    }
    grain(g, w, h, 22, 3);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

export function wallTexture() {
  const t = tex('wall', 512, 512, (g, w, h) => {
    const rail = Math.round(h * 0.6);
    // Upper wall: smoke-stained plaster, mottled and darker toward the ceiling.
    g.fillStyle = COLORS.plaster;
    g.fillRect(0, 0, w, rail);
    const r = rand(41);
    for (let i = 0; i < 26; i++) {
      const y = r() * rail;
      g.fillStyle = `rgba(20,12,5,${(0.04 + r() * 0.06) * (1.3 - y / rail)})`;
      g.beginPath();
      g.ellipse(r() * w, y, 30 + r() * 80, 20 + r() * 50, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    const smoke = g.createLinearGradient(0, 0, 0, rail);
    smoke.addColorStop(0, 'rgba(15,9,4,0.5)');
    smoke.addColorStop(0.6, 'rgba(15,9,4,0.12)');
    smoke.addColorStop(1, 'rgba(15,9,4,0)');
    g.fillStyle = smoke;
    g.fillRect(0, 0, w, rail);
    // Stencilled frieze near the top: diamonds and oak leaves between two rules.
    g.fillStyle = 'rgba(58,42,24,0.55)';
    g.fillRect(0, 34, w, 3);
    g.fillRect(0, 84, w, 3);
    g.fillStyle = 'rgba(58,42,24,0.5)';
    for (let x = 0; x < w; x += 64) {
      g.beginPath();
      g.moveTo(x + 16, 60);
      g.lineTo(x + 28, 48);
      g.lineTo(x + 40, 60);
      g.lineTo(x + 28, 72);
      g.closePath();
      g.fill();
      for (const a of [0.5, -0.5]) {
        g.beginPath();
        g.ellipse(x + 56, 60, 5, 11, a, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Lower wall: dark oak panelling with raised panels and lighter bevel lines.
    g.fillStyle = COLORS.oak;
    g.fillRect(0, rail, w, h - rail);
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 1;
    for (let i = 0; i < 24; i++) {
      const x = r() * w;
      g.beginPath();
      g.moveTo(x, rail);
      g.lineTo(x + (r() - 0.5) * 6, h);
      g.stroke();
    }
    const py = rail + 26;
    const pw = 104;
    const ph = h - rail - 42;
    for (let x = 0; x < w; x += 128) {
      const px = x + 12;
      g.fillStyle = '#231409';
      g.fillRect(px, py, pw, ph);
      g.lineWidth = 2;
      g.strokeStyle = '#4a3018';
      g.beginPath();
      g.moveTo(px, py + ph);
      g.lineTo(px, py);
      g.lineTo(px + pw, py);
      g.stroke();
      g.strokeStyle = '#120a05';
      g.beginPath();
      g.moveTo(px + pw, py);
      g.lineTo(px + pw, py + ph);
      g.lineTo(px, py + ph);
      g.stroke();
      g.strokeStyle = '#3a2412';
      g.strokeRect(px + 12, py + 12, pw - 24, ph - 24);
    }
    // Brass-toned chair rail with a highlight and a shadow beneath.
    g.fillStyle = '#6b5322';
    g.fillRect(0, rail, w, 10);
    g.fillStyle = '#7a6128';
    g.fillRect(0, rail, w, 3);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(0, rail + 10, w, 5);
    grain(g, w, h, 14, 9);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

export function smokeTexture() {
  return tex('smoke', 128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(200,190,175,0.55)');
    grad.addColorStop(0.5, 'rgba(160,150,140,0.18)');
    grad.addColorStop(1, 'rgba(120,110,100,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

export function glowTexture(color = '255,180,90') {
  return tex(`glow-${color}`, 128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, `rgba(${color},1)`);
    grad.addColorStop(0.3, `rgba(${color},0.35)`);
    grad.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** Soft annulus: transparent centre, bright band near the rim, fading out at the edge. */
export function ringTexture(color = '255,200,110') {
  return tex(`ring-${color}`, 128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, `rgba(${color},0)`);
    grad.addColorStop(0.55, `rgba(${color},0)`);
    grad.addColorStop(0.78, `rgba(${color},1)`);
    grad.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

function frame(g: CanvasRenderingContext2D, w: number, h: number, color: string, inset = 10, width = 4) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
}

/** Block-face card title, shrunk until it fits maxW. */
function blockTitle(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, maxW: number) {
  g.font = `800 ${size}px ${BLOCK}`;
  const wide = g.measureText(text).width;
  centerText(g, text, x, y, `800 ${wide > maxW ? Math.floor((size * maxW) / wide) : size}px ${BLOCK}`, color);
}

function centerText(g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string | CanvasGradient) {
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

/** Fills and inks a closed polygon given as [x, y] pairs, mirrored across the vertical axis when `m` is -1. */
function inkPoly(g: CanvasRenderingContext2D, pts: number[][], cx: number, cy: number, s: number, m: number) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x * s * m, cy + y * s) : g.moveTo(cx + x * s * m, cy + y * s)));
  g.closePath();
  g.fill();
  g.stroke();
}

/**
 * Original flat emblems with a thick ink outline: a stylised bird in flight, seen from the front,
 * with art-deco stepped wing tiers (liberal), or a geometric skull (fascist). Both fit within +-s.
 */
export function emblem(g: CanvasRenderingContext2D, kind: 'L' | 'F', cx: number, cy: number, s: number, color: string, ink = COLORS.ink) {
  g.save();
  g.fillStyle = color;
  g.strokeStyle = ink;
  g.lineWidth = s * 0.08;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (kind === 'L') {
    // Tail: a small fan of three feathers below the body (y 0.35..1.0).
    inkPoly(g, [[0, 0.35], [-0.32, 0.92], [-0.12, 0.84], [0, 1], [0.12, 0.84], [0.32, 0.92]], cx, cy, s, 1);
    // Wings, mirrored: three stepped tiers, lowest first so the upper tiers overlap it.
    for (const m of [1, -1]) {
      inkPoly(g, [[0.1, 0.08], [0.4, -0.15], [0.75, -0.1], [0.55, 0.15], [0.2, 0.3]], cx, cy, s, m);
      inkPoly(g, [[0.1, -0.1], [0.45, -0.45], [0.9, -0.4], [0.7, -0.15], [0.25, 0.08]], cx, cy, s, m);
      inkPoly(g, [[0.1, -0.3], [0.5, -0.8], [1, -0.7], [0.8, -0.45], [0.3, -0.1]], cx, cy, s, m);
    }
    // Body: a teardrop with the head at the top and a point toward the tail.
    g.beginPath();
    g.moveTo(cx, cy - s * 0.8);
    g.bezierCurveTo(cx + s * 0.32, cy - s * 0.8, cx + s * 0.3, cy - s * 0.35, cx + s * 0.22, cy);
    g.quadraticCurveTo(cx + s * 0.14, cy + s * 0.4, cx, cy + s * 0.62);
    g.quadraticCurveTo(cx - s * 0.14, cy + s * 0.4, cx - s * 0.22, cy);
    g.bezierCurveTo(cx - s * 0.3, cy - s * 0.35, cx - s * 0.32, cy - s * 0.8, cx, cy - s * 0.8);
    g.closePath();
    g.fill();
    g.stroke();
    // Beak and eyes.
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(cx - s * 0.07, cy - s * 0.55);
    g.lineTo(cx + s * 0.07, cy - s * 0.55);
    g.lineTo(cx, cy - s * 0.4);
    g.closePath();
    g.fill();
    for (const m of [1, -1]) {
      g.beginPath();
      g.arc(cx + m * s * 0.1, cy - s * 0.66, s * 0.04, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Skull outline: rounded cranium (top at about -0.92), cheek steps, a square jaw block (bottom 0.95).
    g.beginPath();
    g.moveTo(cx - s * 0.8, cy - s * 0.1);
    g.bezierCurveTo(cx - s * 0.8, cy - s * 1.2, cx + s * 0.8, cy - s * 1.2, cx + s * 0.8, cy - s * 0.1);
    g.lineTo(cx + s * 0.8, cy + s * 0.1);
    g.lineTo(cx + s * 0.55, cy + s * 0.25);
    g.lineTo(cx + s * 0.55, cy + s * 0.95);
    g.lineTo(cx - s * 0.55, cy + s * 0.95);
    g.lineTo(cx - s * 0.55, cy + s * 0.25);
    g.lineTo(cx - s * 0.8, cy + s * 0.1);
    g.closePath();
    g.fill();
    g.stroke();
    // Cut-outs in ink: slanted angular eye sockets and a triangular nose.
    g.fillStyle = ink;
    for (const m of [1, -1]) {
      g.beginPath();
      g.moveTo(cx + m * s * 0.62, cy - s * 0.3);
      g.lineTo(cx + m * s * 0.12, cy - s * 0.2);
      g.lineTo(cx + m * s * 0.2, cy + s * 0.15);
      g.lineTo(cx + m * s * 0.55, cy + s * 0.1);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.moveTo(cx, cy + s * 0.1);
    g.lineTo(cx - s * 0.12, cy + s * 0.45);
    g.lineTo(cx + s * 0.12, cy + s * 0.45);
    g.closePath();
    g.fill();
    // Teeth: a row line plus four gaps across the jaw.
    g.strokeStyle = ink;
    g.lineWidth = s * 0.06;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(cx - s * 0.55, cy + s * 0.62);
    g.lineTo(cx + s * 0.55, cy + s * 0.62);
    for (const x of [-0.33, -0.11, 0.11, 0.33]) {
      g.moveTo(cx + x * s, cy + s * 0.62);
      g.lineTo(cx + x * s, cy + s * 0.95);
    }
    g.stroke();
  }
  g.restore();
}

/** Outer ink edge of a card, drawn inside the canvas. */
function inkEdge(g: CanvasRenderingContext2D, w: number, h: number, width = 6) {
  frame(g, w, h, COLORS.ink, width / 2, width);
}

/** An aged-stock panel inset from the card edge with an ink outline and a thin brass rule. */
function panel(g: CanvasRenderingContext2D, w: number, h: number, inset: number, outline = 3) {
  g.fillStyle = COLORS.stock;
  g.fillRect(inset, inset, w - inset * 2, h - inset * 2);
  frame(g, w, h, COLORS.ink, inset, outline);
  frame(g, w, h, COLORS.brass, inset + 6, 1.5);
}

// Card canvases stay 256x360: the fallback layouts are hand-placed in those pixels and the 64-entry texture cache would need 4x the memory at 512x720.
/** Fills the canvas with the loaded official image for `key`; false (nothing drawn) while it is missing. */
function fillImage(g: CanvasRenderingContext2D, key: ArtKey, w: number, h: number): boolean {
  const img = officialImage(key);
  if (!img) return false;
  g.drawImage(img, 0, 0, w, h);
  return true;
}

export function policyFace(p: 'L' | 'F') {
  return tex(`policy-${p}`, 256, 360, (g, w, h) => {
    if (fillImage(g, `policy-${p}`, w, h)) return;
    const lib = p === 'L';
    const deep = lib ? COLORS.liberalDeep : COLORS.fascistDeep;
    g.fillStyle = deep;
    g.fillRect(0, 0, w, h);
    inkEdge(g, w, h);
    panel(g, w, h, 20);
    drawSeal(g, p, w / 2, h * 0.4, 78, deep);
    blockTitle(g, lib ? 'LIBERAL' : 'FASCIST', w / 2, h * 0.74, 46, deep, w - 60);
    centerText(g, 'P O L I C Y', w / 2, h * 0.84, `bold 16px ${MONO}`, COLORS.ink);
    age(g, w, h, p === 'L' ? 2 : 4);
  });
}

const BACK_ART: Record<string, ArtKey> = { POLICY: 'policy-back', ROLE: 'role-back', MEMBERSHIP: 'member-back', BALLOT: 'ballot-back' };

export function cardBack(label = 'POLICY') {
  return tex(`back-${label}`, 256, 360, (g, w, h) => {
    const key = BACK_ART[label.toUpperCase()];
    if (key && fillImage(g, key, w, h)) return;
    g.fillStyle = COLORS.ink;
    g.fillRect(0, 0, w, h);
    // Fine brass diagonal lattice, low alpha.
    g.save();
    g.globalAlpha = 0.2;
    g.strokeStyle = COLORS.brass;
    g.lineWidth = 1;
    for (let i = -h; i < w + h; i += 12) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.moveTo(i + h, 0);
      g.lineTo(i, h);
      g.stroke();
    }
    g.restore();
    frame(g, w, h, COLORS.brass, 12, 2);
    frame(g, w, h, COLORS.brass, 18, 1);
    g.fillStyle = COLORS.ink;
    g.fillRect(30, h / 2 - 38, w - 60, 76);
    g.strokeStyle = COLORS.brass;
    g.lineWidth = 2;
    g.strokeRect(30, h / 2 - 38, w - 60, 76);
    g.lineWidth = 1;
    g.strokeRect(36, h / 2 - 32, w - 72, 64);
    blockTitle(g, label.toUpperCase(), w / 2, h / 2 + 1, 40, COLORS.brass, w - 72);
    age(g, w, h, 8);
  });
}

export function ballotFace(ja: boolean) {
  return tex(`ballot-${ja}`, 256, 360, (g, w, h) => {
    if (fillImage(g, ja ? 'ballot-ja' : 'ballot-nein', w, h)) return;
    g.fillStyle = COLORS.stock;
    g.fillRect(0, 0, w, h);
    inkEdge(g, w, h);
    frame(g, w, h, COLORS.ink, 14, 2);
    // Corner mark: a round stamp for JA, a square one for NEIN.
    g.fillStyle = COLORS.ink;
    if (ja) {
      g.beginPath();
      g.arc(40, 44, 12, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillRect(28, 32, 24, 24);
    }
    // The vote word, tilted like a rubber stamp: a faded double impression.
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(((ja ? -6 : 6) * Math.PI) / 180);
    const word = ja ? 'JA!' : 'NEIN!';
    const size = ja ? 120 : 92;
    g.font = `800 ${size}px ${BLOCK}`;
    const wide = g.measureText(word).width;
    const font = `800 ${wide > w - 60 ? Math.floor((size * (w - 60)) / wide) : size}px ${BLOCK}`;
    g.globalAlpha = 0.45;
    centerText(g, word, 3, 2, font, COLORS.ink);
    g.globalAlpha = 0.75;
    centerText(g, word, 0, 0, font, COLORS.ink);
    g.restore();
    centerText(g, 'BALLOT', w / 2, h * 0.88, `bold 18px ${MONO}`, COLORS.ink);
    age(g, w, h, ja ? 1 : 6);
  });
}

export function roleCard(role: 'liberal' | 'fascist' | 'hitler', seed = 0) {
  return tex(`role-${role}-${seed}`, 256, 360, (g, w, h) => {
    if (fillImage(g, `role-${role}`, w, h)) return;
    const lib = role === 'liberal';
    const hit = role === 'hitler';
    const deep = lib ? COLORS.liberalDeep : COLORS.fascistDeep;
    g.fillStyle = lib ? COLORS.liberalDeep : hit ? COLORS.hitler : COLORS.fascistDeep;
    g.fillRect(0, 0, w, h);
    inkEdge(g, w, h);
    panel(g, w, h, 18);
    centerText(g, 'SECRET ROLE', w / 2, 50, `bold 16px ${MONO}`, COLORS.ink);
    drawPortrait(g, role, seed, 34, 66, w - 68, 168);
    g.strokeStyle = COLORS.ink;
    g.lineWidth = 4;
    g.strokeRect(34, 66, w - 68, 168);
    drawSeal(g, lib ? 'L' : 'F', w - 34, 234, 22, deep);
    const title = hit ? 'HITLER' : lib ? 'LIBERAL' : 'FASCIST';
    blockTitle(g, title, w / 2, h * 0.74, hit ? 60 : 52, hit ? COLORS.hitler : deep, w - 60);
    centerText(g, lib ? 'Liberal party' : 'Fascist party', w / 2, h * 0.83, `bold 16px ${MONO}`, COLORS.ink);
    centerText(g, 'click to close your eyes', w / 2, h * 0.91, `13px ${MONO}`, COLORS.kraft);
    age(g, w, h, 10 + role.length);
  });
}

export function membershipCard(name: string, party: 'liberal' | 'fascist') {
  return tex(`member-${name}-${party}`, 256, 360, (g, w, h) => {
    if (fillImage(g, `member-${party}`, w, h)) {
      // Name strip across the very top, clear of the header and the seal.
      const strip = Math.round(h * 0.075);
      g.fillStyle = COLORS.ink;
      g.fillRect(0, 0, w, strip);
      blockTitle(g, name, w / 2, strip / 2 + 1, 22, COLORS.stock, w - 24);
      return;
    }
    const lib = party === 'liberal';
    const deep = lib ? COLORS.liberalDeep : COLORS.fascistDeep;
    g.fillStyle = COLORS.stock;
    g.fillRect(0, 0, w, h);
    inkEdge(g, w, h);
    frame(g, w, h, deep, 10, 4);
    frame(g, w, h, COLORS.brass, 17, 1.5);
    centerText(g, 'PARTY MEMBERSHIP', w / 2, 44, `bold 17px ${MONO}`, COLORS.ink);
    blockTitle(g, name, w / 2, 86, 30, COLORS.ink, w - 60);
    drawSeal(g, lib ? 'L' : 'F', w / 2, h * 0.5, 62, deep);
    blockTitle(g, lib ? 'LIBERAL' : 'FASCIST', w / 2, h * 0.75, 52, deep, w - 60);
    centerText(g, 'click to put it away', w / 2, h * 0.9, `13px ${MONO}`, COLORS.kraft);
    age(g, w, h, 20 + name.length);
  });
}

const POSTER_W = 512;
const POSTER_H = 768;

/** Election poster: a coloured field with a thin paper margin, emblem, big headline and sub line. */
function electionPoster(g: CanvasRenderingContext2D, kind: 'L' | 'F', head: string, big: string, sub: string, field: string, deep: string) {
  const w = POSTER_W;
  const h = POSTER_H;
  g.fillStyle = COLORS.stock;
  g.fillRect(0, 0, w, h);
  g.fillStyle = field;
  g.fillRect(14, 14, w - 28, h - 28);
  frame(g, w, h, COLORS.ink, 14, 3);
  frame(g, w, h, COLORS.stock, 26, 2);
  centerText(g, head, w / 2, 100, `800 84px ${DISPLAY}`, COLORS.stock);
  emblem(g, kind, w / 2, 340, 150, COLORS.stock, COLORS.ink);
  centerText(g, big, w / 2, 590, `800 100px ${DISPLAY}`, COLORS.stock);
  g.fillStyle = deep;
  g.fillRect(40, 660, w - 80, 56);
  centerText(g, sub, w / 2, 689, `bold 28px ${MONO}`, COLORS.stock);
}

function noticePoster(g: CanvasRenderingContext2D) {
  const w = POSTER_W;
  g.fillStyle = COLORS.paper;
  g.fillRect(0, 0, w, POSTER_H);
  frame(g, w, POSTER_H, COLORS.ink, 18, 4);
  frame(g, w, POSTER_H, COLORS.ink, 30, 1.5);
  centerText(g, 'Reichstagswahl', w / 2, 150, `88px ${BLACK}`, COLORS.ink);
  g.fillStyle = COLORS.ink;
  g.fillRect(70, 215, w - 140, 4);
  g.fillRect(70, 225, w - 140, 1.5);
  centerText(g, '31. Juli 1932', w / 2, 290, `bold 46px ${MONO}`, COLORS.ink);
  g.fillRect(70, 335, w - 140, 1.5);
  const lines = ['Wahllokal:', 'Bierhalle zum Adler', 'Wahlzeit 8 bis 18 Uhr', 'Stimmzettel sind mitzubringen', 'und persönlich abzugeben.'];
  lines.forEach((l, i) => centerText(g, l, w / 2, 400 + i * 48, `bold ${i === 1 ? 28 : 24}px ${MONO}`, COLORS.ink));
  g.fillRect(70, 660, w - 140, 1.5);
  centerText(g, 'Der Wahlvorsteher', w / 2, 705, `bold 24px ${MONO}`, COLORS.ink);
}

function beerPoster(g: CanvasRenderingContext2D) {
  const w = POSTER_W;
  g.fillStyle = COLORS.kraft;
  g.fillRect(0, 0, w, POSTER_H);
  g.fillStyle = COLORS.ochre;
  g.fillRect(24, 24, w - 48, POSTER_H - 48);
  frame(g, w, POSTER_H, COLORS.ink, 24, 4);
  centerText(g, 'Adlerbräu', w / 2, 140, `110px ${BLACK}`, COLORS.ink);
  centerText(g, 'Das Bier der Hauptstadt', w / 2, 225, `bold 26px ${MONO}`, COLORS.ink);
  // Stein: foam, glass body, handle and a band.
  g.lineWidth = 8;
  g.strokeStyle = COLORS.ink;
  g.lineJoin = 'round';
  g.beginPath();
  g.ellipse(352, 470, 52, 70, 0, -Math.PI / 2, Math.PI / 2);
  g.stroke();
  g.fillStyle = COLORS.gold;
  g.fillRect(150, 330, 200, 280);
  g.strokeRect(150, 330, 200, 280);
  g.fillStyle = COLORS.stock;
  g.beginPath();
  g.arc(170, 330, 34, 0, Math.PI * 2);
  g.arc(215, 318, 42, 0, Math.PI * 2);
  g.arc(265, 322, 40, 0, Math.PI * 2);
  g.arc(318, 332, 32, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = COLORS.kraft;
  g.fillRect(150, 440, 200, 20);
  g.fillRect(150, 560, 200, 16);
  g.strokeRect(150, 440, 200, 20);
  centerText(g, 'Berlin', w / 2, 690, `78px ${BLACK}`, COLORS.ink);
}

/** 2x2 atlas of period posters, each 512x768 (cell i at col i%2, row floor(i/2)); wear applied per poster. */
export function posterAtlas() {
  return tex('posters', POSTER_W * 2, POSTER_H * 2, (g) => {
    const draws: ((g: CanvasRenderingContext2D) => void)[] = [
      (c) => electionPoster(c, 'L', 'WÄHLT', 'LISTE 1', 'LIBERALE PARTEI', COLORS.liberal, COLORS.liberalDeep),
      (c) => electionPoster(c, 'F', 'ORDNUNG!', 'LISTE 2', 'WÄHLT LISTE 2', COLORS.fascist, COLORS.fascistDeep),
      noticePoster,
      beerPoster,
    ];
    draws.forEach((draw, i) => {
      const ox = (i % 2) * POSTER_W;
      const oy = Math.floor(i / 2) * POSTER_H;
      g.save();
      g.translate(ox, oy);
      g.beginPath();
      g.rect(0, 0, POSTER_W, POSTER_H);
      g.clip();
      draw(g);
      age(g, POSTER_W, POSTER_H, 40 + i, ox, oy);
      g.restore();
    });
  });
}

export const BLOOD_TILES = 4;

/** Four flat-ink blood splat shapes in one row of 128px tiles; spatter tails run along +x. */
export function bloodAtlas() {
  return tex('blood', 512, 128, (g) => {
    const T = 128;
    for (let i = 0; i < BLOOD_TILES; i++) {
      const r = rand(900 + i);
      const cx = i * T + T / 2 - (i % 2 ? 8 : 0);
      const cy = T / 2;
      const base = 20 + r() * 10;
      const blob = (x: number, y: number, rad: number, fill: string) => {
        const n = 14 + Math.floor(r() * 7);
        g.fillStyle = fill;
        g.beginPath();
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const d = rad * (0.72 + r() * 0.5);
          const px = x + Math.cos(a) * d;
          const py = y + Math.sin(a) * d;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
      };
      const dot = (x: number, y: number, rad: number, fill: string) => {
        g.fillStyle = fill;
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
      };
      if (i < 2) {
        // streak: tapered tail along +x
        g.fillStyle = '#4a0606';
        g.beginPath();
        g.moveTo(cx, cy - base * 0.5);
        g.lineTo(i * T + T - 8, cy - 2 - r() * 3);
        g.lineTo(i * T + T - 8, cy + 2 + r() * 3);
        g.lineTo(cx, cy + base * 0.5);
        g.closePath();
        g.fill();
      }
      blob(cx, cy, base, '#4a0606');
      blob(cx + (r() - 0.5) * 6, cy + (r() - 0.5) * 6, base * 0.5, '#2e0303');
      const sats = 4 + Math.floor(r() * 3);
      for (let k = 0; k < sats; k++) {
        const a = r() * Math.PI * 2;
        const d = base * (1.35 + r() * 0.6);
        const x = Math.min(i * T + T - 8, Math.max(i * T + 8, cx + Math.cos(a) * d));
        const y = Math.min(T - 8, Math.max(8, cy + Math.sin(a) * d));
        dot(x, y, 2 + r() * 3.5, k % 2 ? '#4a0606' : '#2e0303');
      }
      for (let k = 0; k < 3; k++) {
        const a = r() * Math.PI * 2;
        const d = r() * base * 0.6;
        dot(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + r() * 2.5, '#6a0b0b');
      }
    }
  });
}

/** The painted bar sign: dark lacquered board, brass double border, flat brass blackletter name. */
export function signTexture() {
  return tex('sign', 1024, 256, (g, w, h) => {
    g.fillStyle = COLORS.lacquer;
    g.fillRect(0, 0, w, h);
    frame(g, w, h, COLORS.brass, 12, 5);
    frame(g, w, h, COLORS.brass, 26, 2);
    const text = 'Bierhalle zum Adler';
    const font = `120px ${BLACK}`;
    centerText(g, text, w / 2 + 4, h * 0.45 + 5, font, 'rgba(0,0,0,0.75)');
    centerText(g, text, w / 2, h * 0.45, font, COLORS.brass);
    centerText(g, '·  BERLIN  ·', w / 2, h * 0.85, `bold 28px ${MONO}`, COLORS.brass);
    grain(g, w, h, 10, 17);
  });
}

// No official envelope art: always procedural.
export function envelopeTexture() {
  return tex('envelope', 360, 256, (g, w, h) => {
    g.fillStyle = COLORS.kraft;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#4f3a1f';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w / 2, h * 0.55);
    g.lineTo(w, 0);
    g.stroke();
    // Neutral oxblood seal: the envelope is identical for every player, so it never shows a party.
    drawSeal(g, null, w / 2, h * 0.55, 22, COLORS.fascistDeep);
    // Oxblood rubber stamp, slightly crooked.
    g.save();
    g.translate(w / 2, h * 0.85);
    g.rotate((-4 * Math.PI) / 180);
    g.globalAlpha = 0.85;
    centerText(g, 'CONFIDENTIAL', 0, 1, `800 24px ${DISPLAY}`, COLORS.hitler);
    const tw = g.measureText('CONFIDENTIAL').width;
    g.strokeStyle = COLORS.hitler;
    g.lineWidth = 3;
    g.strokeRect(-tw / 2 - 12, -20, tw + 24, 40);
    g.restore();
    age(g, w, h, 12);
  });
}

const PLACARD_ART: Record<string, ArtKey> = { PRESIDENT: 'placard-president', CHANCELLOR: 'placard-chancellor' };

/** Largest rect with the image's aspect that fits inside w x h, centred. */
export function containRect(iw: number, ih: number, w: number, h: number) {
  const s = Math.min(w / iw, h / ih);
  return { x: (w - iw * s) / 2, y: (h - ih * s) / 2, w: iw * s, h: ih * s };
}

export function placardTexture(title: string, color: string) {
  return tex(`placard-${title}`, 512, 128, (g, w, h) => {
    const key = PLACARD_ART[title];
    const img = key ? officialImage(key) : null;
    if (img) {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      const r = containRect(img.width, img.height, w, h);
      g.drawImage(img, r.x, r.y, r.w, r.h);
      return;
    }
    g.fillStyle = COLORS.ink;
    g.fillRect(0, 0, w, h);
    frame(g, w, h, COLORS.brass, 8, 3);
    frame(g, w, h, COLORS.brass, 14, 1);
    centerText(g, title, w / 2, h / 2 + 2, `800 56px ${DISPLAY}`, color);
  });
}

export function labelTexture(text: string, color: string, bg = '#1c130c') {
  return tex(`label-${text}-${color}-${bg}`, 256, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    frame(g, w, h, COLORS.brass, 6, 3);
    frame(g, w, h, COLORS.brass, 12, 1);
    const size = text.length > 8 ? 30 : 44;
    centerText(g, text, w / 2, h / 2 + 2, `800 ${size}px ${DISPLAY}`, color);
  });
}

const POWER_LABEL: Record<string, string> = {
  peek: 'Policy peek',
  investigate: 'Investigate',
  special: 'Special election',
  execute: 'Execution',
};

/** Original flat icon for a presidential power, centred at (cx, cy) and kept within +-s. */
function powerIcon(g: CanvasRenderingContext2D, kind: string, cx: number, cy: number, s: number, color = COLORS.stock) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 4;
  if (kind === 'peek') {
    g.beginPath();
    g.moveTo(cx - s, cy);
    g.quadraticCurveTo(cx, cy - s * 1.1, cx + s, cy);
    g.quadraticCurveTo(cx, cy + s * 1.1, cx - s, cy);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, s * 0.36, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'investigate') {
    const r = s * 0.55;
    const lx = cx - s * 0.3;
    const ly = cy - s * 0.3;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(lx, ly, r, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(lx + r * Math.SQRT1_2 + 2, ly + r * Math.SQRT1_2 + 2);
    g.lineTo(cx + s * 0.85, cy + s * 0.85);
    g.stroke();
  } else if (kind === 'special') {
    g.beginPath();
    g.rect(cx - s * 0.8, cy - s * 0.9, s * 1.6, s * 0.3);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(cx - s * 0.6, cy - s * 0.6);
    g.lineTo(cx + s * 0.6, cy - s * 0.6);
    g.lineTo(cx + s * 0.85, cy + s * 0.9);
    g.lineTo(cx - s * 0.85, cy + s * 0.9);
    g.closePath();
    g.fill();
    g.stroke();
  } else if (kind === 'execute') {
    const hw = s * 0.32;
    g.beginPath();
    g.moveTo(cx - hw, cy + s);
    g.lineTo(cx - hw, cy - s * 0.2);
    g.quadraticCurveTo(cx - hw, cy - s, cx, cy - s);
    g.quadraticCurveTo(cx + hw, cy - s, cx + hw, cy - s * 0.2);
    g.lineTo(cx + hw, cy + s);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = COLORS.fascistDeep;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - hw, cy + s * 0.45);
    g.lineTo(cx + hw, cy + s * 0.45);
    g.stroke();
  }
  g.restore();
}

/** A recessed slot: dark fill, flat inset shadow along the top and left, brass-ruled edge. */
function recess(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(x, y, w, 10);
  g.fillRect(x, y + 10, 8, h - 10);
  g.strokeStyle = COLORS.brass;
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
  g.save();
  g.globalAlpha = 0.35;
  g.lineWidth = 1;
  g.strokeRect(x + 4, y + 4, w - 8, h - 8);
  g.restore();
}

/** Deco wave band: a row of scallop arcs across x..x+w within height h, broken over `gap` (x range). */
function waveBand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, gap?: [number, number]) {
  const r = h / 2;
  g.save();
  g.globalAlpha = 0.55;
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  for (let cx = x + r; cx + r <= x + w; cx += h) {
    if (gap && cx + r > gap[0] && cx - r < gap[1]) continue;
    g.moveTo(cx - r, y + h);
    g.arc(cx, y + h, r, Math.PI, 0);
  }
  g.stroke();
  g.restore();
}

/** Deco key band: a stepped Greek-key meander across x..x+w within height h, broken over `gap` (x range). */
function keyBand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, gap?: [number, number]) {
  const cell = h * 1.5;
  g.save();
  g.globalAlpha = 0.55;
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.lineJoin = 'miter';
  g.beginPath();
  for (let cx = x; cx + cell <= x + w; cx += cell) {
    if (gap && cx + cell > gap[0] && cx < gap[1]) continue;
    g.moveTo(cx, y + h);
    g.lineTo(cx, y);
    g.lineTo(cx + h, y);
    g.lineTo(cx + h, y + h * 0.6);
    g.lineTo(cx + h * 0.4, y + h * 0.6);
    g.moveTo(cx + h, y + h);
    g.lineTo(cx + cell, y + h);
  }
  g.stroke();
  g.restore();
}

/** A small dark plaque with a brass outline that the panel title sits on. */
function titlePlaque(g: CanvasRenderingContext2D, cx: number, y: number, w: number, h: number, fill: string) {
  g.fillStyle = fill;
  g.fillRect(cx - w / 2, y, w, h);
  g.strokeStyle = COLORS.brass;
  g.lineWidth = 2;
  g.strokeRect(cx - w / 2, y, w, h);
}

/** The central board: liberal track, fascist track with powers, election tracker, inlaid in dark leather. */
export function boardTexture(powers: (string | null)[]) {
  return tex(`board-${powers.join(',')}`, 1024, 640, (g, w, h) => {
    // Dark leather / walnut ground with grain streaks.
    g.fillStyle = '#2a1a10';
    g.fillRect(0, 0, w, h);
    const r = rand(77);
    g.strokeStyle = '#120a05';
    for (let i = 0; i < 120; i++) {
      const y = r() * h;
      g.globalAlpha = 0.1 + r() * 0.25;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.015 + i) * (2 + r() * 5));
      g.stroke();
    }
    g.globalAlpha = 1;
    frame(g, w, h, COLORS.brass, 8, 3);
    frame(g, w, h, COLORS.brass, 16, 1);
    // Liberal track: a recessed navy panel.
    g.fillStyle = COLORS.liberalDeep;
    g.fillRect(40, 40, w - 80, 230);
    g.strokeStyle = COLORS.brass;
    g.lineWidth = 2;
    g.strokeRect(40, 40, w - 80, 230);
    const plaque: [number, number] = [w / 2 - 130, w / 2 + 130];
    waveBand(g, 48, 44, w - 96, 12, COLORS.line, plaque);
    waveBand(g, 48, 256, w - 96, 11, COLORS.line);
    titlePlaque(g, w / 2, 46, 240, 42, COLORS.liberalDeep);
    centerText(g, 'LIBERAL', w / 2, 68, `800 34px ${BLOCK}`, COLORS.brass);
    const lx = (i: number) => 140 + i * 186;
    for (let i = 0; i < 5; i++) {
      recess(g, lx(i) - 60, 92, 120, 160, '#10202f');
      if (i === 4) {
        drawSeal(g, 'L', lx(i), 165, 40, COLORS.liberalDeep);
        centerText(g, 'WIN', lx(i), 232, `800 20px ${BLOCK}`, COLORS.brass);
      }
    }
    // Fascist track: a recessed oxblood panel.
    g.fillStyle = COLORS.fascistDeep;
    g.fillRect(40, 290, w - 80, 230);
    g.strokeStyle = COLORS.brass;
    g.lineWidth = 2;
    g.strokeRect(40, 290, w - 80, 230);
    keyBand(g, 48, 294, w - 96, 12, COLORS.line, plaque);
    titlePlaque(g, w / 2, 296, 240, 42, COLORS.fascistDeep);
    centerText(g, 'FASCIST', w / 2, 318, `800 34px ${BLOCK}`, COLORS.brass);
    const fx = (i: number) => 125 + i * 155;
    for (let i = 0; i < 6; i++) {
      const x = fx(i);
      recess(g, x - 60, 342, 120, 160, '#2a0a06');
      if (i >= 3) {
        // Danger hatch, clipped to the slot.
        g.save();
        g.beginPath();
        g.rect(x - 60, 342, 120, 160);
        g.clip();
        g.strokeStyle = COLORS.fascist;
        g.globalAlpha = 0.35;
        g.lineWidth = 3;
        g.beginPath();
        for (let k = -160; k < 120; k += 16) {
          g.moveTo(x - 60 + k, 502);
          g.lineTo(x - 60 + k + 160, 342);
        }
        g.stroke();
        g.restore();
      }
      const p = powers[i];
      if (i === 5) {
        drawSeal(g, 'F', x, 410, 40, COLORS.fascistDeep);
        centerText(g, 'WIN', x, 480, `800 20px ${BLOCK}`, COLORS.brass);
      } else if (p && POWER_LABEL[p]) {
        powerIcon(g, p, x, 395, 20, COLORS.brass);
        POWER_LABEL[p].split(' ').forEach((wd, j) => centerText(g, wd, x, 440 + j * 18, `800 17px ${BLOCK}`, COLORS.line));
      }
    }
    centerText(g, 'Hitler as chancellor wins from the 4th slot on  •  Veto unlocks at 5', w / 2, 512, `bold 13px ${MONO}`, COLORS.stock);
    // Election tracker: a dark strip with brass rings.
    g.fillStyle = '#150d07';
    g.fillRect(40, 540, w - 80, 80);
    g.strokeStyle = COLORS.brass;
    g.lineWidth = 2;
    g.strokeRect(40, 540, w - 80, 80);
    centerText(g, 'ELECTION TRACKER', 250, 580, `800 24px ${BLOCK}`, COLORS.brass);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#0c0704';
      g.strokeStyle = COLORS.brass;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(430 + i * 90, 580, 22, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (i === 3) centerText(g, '!', 430 + i * 90, 581, `800 22px ${BLOCK}`, COLORS.fascist);
    }
    centerText(g, '3 failed = top policy enacted', 860, 580, `bold 13px ${MONO}`, COLORS.stock);
    age(g, w, h, 21);
  });
}

/** Board-space helpers (u,v in 0..1 of the board texture). */
export const BOARD_SLOTS = {
  liberal: (i: number) => [(140 + i * 186) / 1024, 172 / 640] as const,
  fascist: (i: number) => [(125 + i * 155) / 1024, 422 / 640] as const,
  tracker: (i: number) => [(430 + i * 90) / 1024, 580 / 640] as const,
};

export function textSprite(
  text: string,
  opts: { color?: string; bg?: string; size?: number; maxWidth?: number; border?: string } = {},
): { texture: THREE.CanvasTexture; aspect: number } {
  const size = opts.size ?? 40;
  const maxWidth = opts.maxWidth ?? 520;
  const [c, g] = canvas(8, 8);
  g.font = `bold ${size}px ${MONO}`;
  // Wrap words.
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  const width = Math.ceil(Math.min(maxWidth, Math.max(...lines.map((l) => g.measureText(l).width)))) + size;
  const height = Math.ceil(lines.length * size * 1.25 + size * 0.6);
  c.width = width;
  c.height = height;
  if (opts.bg) {
    g.fillStyle = opts.bg;
    const r = size * 0.4;
    g.beginPath();
    g.roundRect(2, 2, width - 4, height - 4, r);
    g.fill();
    if (opts.border) {
      g.strokeStyle = opts.border;
      g.lineWidth = 3;
      g.stroke();
    }
  }
  g.font = `bold ${size}px ${MONO}`;
  g.fillStyle = opts.color ?? '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, width / 2, size * 0.3 + size * 1.25 * (i + 0.5) + 2));
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}
