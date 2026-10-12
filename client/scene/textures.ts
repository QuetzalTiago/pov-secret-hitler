// Every texture is drawn on a canvas: official art images when loaded (see officialart.ts), a plain dark card with the blocky title otherwise.
import * as THREE from 'three';
import { officialImage, type ArtKey } from './officialart';
import { rand } from './rand';
import { drawNeutralSeal } from './seals';

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

/** Fallback for a card, board or placard whose official image has not loaded: a plain dark fill with the blocky title. */
function plainCard(g: CanvasRenderingContext2D, w: number, h: number, title: string, color = COLORS.stock) {
  g.fillStyle = COLORS.ink;
  g.fillRect(0, 0, w, h);
  blockTitle(g, title, w / 2, h / 2, 44, color, w - 40);
}

// Card canvases stay 256x360: the texture cache holds 64 entries and 512x720 would need 4x the memory.
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
    plainCard(g, w, h, p === 'L' ? 'LIBERAL' : 'FASCIST');
  });
}

const BACK_ART: Record<string, ArtKey> = { POLICY: 'policy-back', ROLE: 'role-back', MEMBERSHIP: 'member-back', BALLOT: 'ballot-back' };

export function cardBack(label = 'POLICY') {
  return tex(`back-${label}`, 256, 360, (g, w, h) => {
    const key = BACK_ART[label.toUpperCase()];
    if (key && fillImage(g, key, w, h)) return;
    plainCard(g, w, h, label.toUpperCase());
  });
}

export function ballotFace(ja: boolean) {
  return tex(`ballot-${ja}`, 256, 360, (g, w, h) => {
    if (fillImage(g, ja ? 'ballot-ja' : 'ballot-nein', w, h)) return;
    plainCard(g, w, h, ja ? 'JA!' : 'NEIN!');
  });
}

export function roleCard(role: 'liberal' | 'fascist' | 'hitler') {
  return tex(`role-${role}`, 256, 360, (g, w, h) => {
    if (fillImage(g, `role-${role}`, w, h)) return;
    plainCard(g, w, h, role.toUpperCase());
  });
}

export function membershipCard(name: string, party: 'liberal' | 'fascist') {
  return tex(`member-${name}-${party}`, 256, 360, (g, w, h) => {
    if (!fillImage(g, `member-${party}`, w, h)) plainCard(g, w, h, party.toUpperCase());
    // Name strip across the very top, clear of the header and the seal.
    const strip = Math.round(h * 0.075);
    g.fillStyle = COLORS.ink;
    g.fillRect(0, 0, w, strip);
    blockTitle(g, name, w / 2, strip / 2 + 1, 22, COLORS.stock, w - 24);
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

type ArtImage = ImageBitmap;

/** Draws img contain-fitted into the rect (x, y, w, h). */
function drawContained(g: CanvasRenderingContext2D, img: ArtImage, x: number, y: number, w: number, h: number) {
  const r = containRect(img.width, img.height, w, h);
  g.drawImage(img, x + r.x, y + r.y, r.w, r.h);
}

/** Official single-card poster: ink field with the card contain-fitted 24 px in from every edge. */
function artPoster(g: CanvasRenderingContext2D, img: ArtImage) {
  g.fillStyle = COLORS.ink;
  g.fillRect(0, 0, POSTER_W, POSTER_H);
  drawContained(g, img, 24, 24, POSTER_W - 48, POSTER_H - 48);
}

/** Official logo poster: logo on top, the two policy cards below it when both are loaded. */
function logoPoster(g: CanvasRenderingContext2D, logo: ArtImage, l: ArtImage | null, f: ArtImage | null) {
  g.fillStyle = COLORS.ink;
  g.fillRect(0, 0, POSTER_W, POSTER_H);
  drawContained(g, logo, 24, 24, 464, 330);
  if (l && f) {
    drawContained(g, l, 40, 380, 200, 350);
    drawContained(g, f, 272, 380, 200, 350);
  }
}

/** 2x2 atlas of posters, each 512x768 (cell i at col i%2, row floor(i/2)); official art (role cards, logo + policy cards) when loaded, else the period posters per cell; wear applied per poster. */
export function posterAtlas() {
  return tex('posters', POSTER_W * 2, POSTER_H * 2, (g) => {
    const liberal = officialImage('role-liberal');
    const fascist = officialImage('role-fascist');
    const hitler = officialImage('role-hitler');
    const logo = officialImage('logo');
    const draws: ((g: CanvasRenderingContext2D) => void)[] = [
      liberal ? (c) => artPoster(c, liberal) : (c) => electionPoster(c, 'L', 'WÄHLT', 'LISTE 1', 'LIBERALE PARTEI', COLORS.liberal, COLORS.liberalDeep),
      fascist ? (c) => artPoster(c, fascist) : (c) => electionPoster(c, 'F', 'ORDNUNG!', 'LISTE 2', 'WÄHLT LISTE 2', COLORS.fascist, COLORS.fascistDeep),
      hitler ? (c) => artPoster(c, hitler) : noticePoster,
      logo ? (c) => logoPoster(c, logo, officialImage('policy-L'), officialImage('policy-F')) : beerPoster,
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
        g.fillStyle = '#9a0e0e';
        g.beginPath();
        g.moveTo(cx, cy - base * 0.5);
        g.lineTo(i * T + T - 8, cy - 2 - r() * 3);
        g.lineTo(i * T + T - 8, cy + 2 + r() * 3);
        g.lineTo(cx, cy + base * 0.5);
        g.closePath();
        g.fill();
      }
      blob(cx, cy, base, '#9a0e0e');
      blob(cx + (r() - 0.5) * 6, cy + (r() - 0.5) * 6, base * 0.5, '#5c0606');
      const sats = 4 + Math.floor(r() * 3);
      for (let k = 0; k < sats; k++) {
        const a = r() * Math.PI * 2;
        const d = base * (1.35 + r() * 0.6);
        const x = Math.min(i * T + T - 8, Math.max(i * T + 8, cx + Math.cos(a) * d));
        const y = Math.min(T - 8, Math.max(8, cy + Math.sin(a) * d));
        dot(x, y, 2 + r() * 3.5, k % 2 ? '#9a0e0e' : '#5c0606');
      }
      for (let k = 0; k < 3; k++) {
        const a = r() * Math.PI * 2;
        const d = r() * base * 0.6;
        dot(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + r() * 2.5, '#c41a14');
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
    drawNeutralSeal(g, w / 2, h * 0.55, 22, COLORS.fascistDeep);
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
    plainCard(g, w, h, title, color);
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

/** Which official fascist board art matches a game's power list (5-6 has peek at slot 3, 7-8 investigates at slot 2, 9-10 at slot 1). */
export function fascistBoardKey(powers: (string | null)[]): 'board-fascist-56' | 'board-fascist-78' | 'board-fascist-910' {
  if (powers[0] === 'investigate') return 'board-fascist-910';
  if (powers[1] === 'investigate') return 'board-fascist-78';
  return 'board-fascist-56';
}

/** Both official board images for these powers, or null until they have loaded. */
export function officialBoard(powers: (string | null)[]): { liberal: ImageBitmap; fascist: ImageBitmap } | null {
  const liberal = officialImage('board-liberal');
  const fascist = officialImage(fascistBoardKey(powers));
  return liberal && fascist ? { liberal, fascist } : null;
}

/** Official board art heights over widths: the liberal board stacked over a fascist board makes one composite. */
const LIB_FRAC = 660 / 2018;
const FAS_FRAC = 673 / 2035;
/** v where the fascist board starts in the composite. */
const BOARD_SPLIT = LIB_FRAC / (LIB_FRAC + FAS_FRAC);
/** Width / height of the composite board (the table mesh and texture share it). */
export const BOARD_ASPECT = 1 / (LIB_FRAC + FAS_FRAC);

/** The central board: the official art when loaded, else a plain dark card with the two track titles. */
export function boardTexture(powers: (string | null)[]) {
  return tex(`board-${powers.join(',')}`, 2048, Math.round(2048 / BOARD_ASPECT), (g, cw, ch) => {
    const official = officialBoard(powers);
    if (official) {
      g.drawImage(official.liberal, 0, 0, cw, ch * BOARD_SPLIT);
      g.drawImage(official.fascist, 0, ch * BOARD_SPLIT, cw, ch * (1 - BOARD_SPLIT));
      return;
    }
    g.fillStyle = COLORS.ink;
    g.fillRect(0, 0, cw, ch);
    blockTitle(g, 'LIBERAL', cw / 2, (ch * BOARD_SPLIT) / 2, 120, COLORS.stock, cw - 200);
    blockTitle(g, 'FASCIST', cw / 2, (ch * (BOARD_SPLIT + 1)) / 2, 120, COLORS.stock, cw - 200);
  });
}

type BoardSlots = {
  liberal: (i: number) => readonly [number, number];
  fascist: (i: number) => readonly [number, number];
  tracker: (i: number) => readonly [number, number];
};

const LIB_X = [428, 716.5, 1008, 1298.5, 1591];
const TRK_X = [697, 894.5, 1092, 1290];
const FAS_X = [292, 581.5, 872.5, 1165, 1460.5, 1751];

/** Slot centres on the official composite board, measured from the art. */
export const BOARD_SLOTS: BoardSlots = {
  liberal: (i) => [LIB_X[i] / 2018, (330.5 / 660) * BOARD_SPLIT],
  fascist: (i) => [FAS_X[i] / 2035, BOARD_SPLIT + (341 / 673) * (1 - BOARD_SPLIT)],
  tracker: (i) => [TRK_X[i] / 2018, (586.5 / 660) * BOARD_SPLIT],
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
