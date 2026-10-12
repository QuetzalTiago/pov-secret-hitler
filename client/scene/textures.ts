// Every texture in the game is drawn at runtime on a canvas. No image assets.
import * as THREE from 'three';

const DISPLAY = '"Jost", "Futura", "Century Gothic", "Trebuchet MS", sans-serif';
const MONO = '"Courier Prime", "Courier New", Courier, monospace';
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
  liberal: '#608CB3',
  liberalDeep: '#324869',
  liberalLight: '#d6e4ef',
  fascist: '#F2654A',
  fascistDeep: '#9c2f1f',
  fascistLight: '#f9d2c4',
  hitler: '#BE0804',
  paper: '#F7E1C3',
  ochre: '#FBB969',
  ink: '#231F20',
  kraft: '#C59257',
  gold: '#FDDF50',
};

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

/** Seeded value noise so textures look the same every load. */
function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 7) {
  const r = rand(seed);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
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
    g.fillStyle = '#3a1f1a';
    g.fillRect(0, 0, w, h);
    // Damask-ish wallpaper stripes over a wood wainscot.
    for (let x = 0; x < w; x += 64) {
      g.fillStyle = 'rgba(90,40,30,0.35)';
      g.fillRect(x, 0, 30, h * 0.62);
      g.fillStyle = 'rgba(214,168,74,0.08)';
      for (let y = 20; y < h * 0.6; y += 60) {
        g.beginPath();
        g.ellipse(x + 47, y, 9, 16, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = '#24130b';
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#4d2e16';
    g.fillRect(0, h * 0.62, w, 10);
    for (let x = 0; x < w; x += 128) {
      g.strokeStyle = '#3b2210';
      g.lineWidth = 4;
      g.strokeRect(x + 12, h * 0.67, 104, h * 0.27);
    }
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

function centerText(g: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string) {
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
function emblem(g: CanvasRenderingContext2D, kind: 'L' | 'F', cx: number, cy: number, s: number, color: string, ink = COLORS.ink) {
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

/** A cream panel inset from the card edge with an ink outline. */
function panel(g: CanvasRenderingContext2D, w: number, h: number, inset: number, outline = 3) {
  g.fillStyle = COLORS.paper;
  g.fillRect(inset, inset, w - inset * 2, h - inset * 2);
  frame(g, w, h, COLORS.ink, inset, outline);
}

export function policyFace(p: 'L' | 'F') {
  return tex(`policy-${p}`, 256, 360, (g, w, h) => {
    const lib = p === 'L';
    g.fillStyle = lib ? COLORS.liberal : COLORS.fascist;
    g.fillRect(0, 0, w, h);
    inkEdge(g, w, h);
    panel(g, w, h, 20);
    emblem(g, p, w / 2, h * 0.4, 66, lib ? COLORS.liberal : COLORS.fascist);
    centerText(g, lib ? 'LIBERAL' : 'FASCIST', w / 2, h * 0.74, `800 40px ${DISPLAY}`, lib ? COLORS.liberalDeep : COLORS.fascistDeep);
    centerText(g, 'P O L I C Y', w / 2, h * 0.84, `bold 16px ${MONO}`, COLORS.ink);
    grain(g, w, h, 12, p === 'L' ? 2 : 4);
  });
}

export function cardBack(label = 'POLICY') {
  return tex(`back-${label}`, 256, 360, (g, w, h) => {
    g.fillStyle = COLORS.ochre;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = COLORS.kraft;
    g.lineWidth = 4;
    for (let i = -h; i < w + h; i += 18) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.stroke();
    }
    inkEdge(g, w, h);
    g.fillStyle = COLORS.ink;
    g.fillRect(30, h / 2 - 38, w - 60, 76);
    g.strokeStyle = COLORS.ochre;
    g.lineWidth = 2;
    g.strokeRect(36, h / 2 - 32, w - 72, 64);
    centerText(g, label, w / 2, h / 2 + 1, `800 30px ${DISPLAY}`, COLORS.ochre);
    grain(g, w, h, 12, 8);
  });
}

export function ballotFace(ja: boolean) {
  return tex(`ballot-${ja}`, 256, 360, (g, w, h) => {
    g.fillStyle = COLORS.paper;
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
    // The vote word, tilted like a rubber stamp.
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(((ja ? -6 : 6) * Math.PI) / 180);
    centerText(g, ja ? 'JA!' : 'NEIN!', 0, 0, `800 ${ja ? 104 : 80}px ${DISPLAY}`, COLORS.ink);
    g.restore();
    centerText(g, 'BALLOT', w / 2, h * 0.88, `bold 18px ${MONO}`, COLORS.ink);
    grain(g, w, h, 12, ja ? 1 : 6);
  });
}

export function roleCard(role: 'liberal' | 'fascist' | 'hitler') {
  return tex(`role-${role}`, 256, 360, (g, w, h) => {
    const lib = role === 'liberal';
    const hit = role === 'hitler';
    g.fillStyle = lib ? COLORS.liberal : hit ? COLORS.hitler : COLORS.fascist;
    g.fillRect(0, 0, w, h);
    inkEdge(g, w, h);
    panel(g, w, h, 18);
    centerText(g, 'SECRET ROLE', w / 2, 50, `bold 16px ${MONO}`, COLORS.ink);
    emblem(g, lib ? 'L' : 'F', w / 2, h * 0.43, 58, lib ? COLORS.liberal : hit ? COLORS.hitler : COLORS.fascist);
    const title = hit ? 'HITLER' : role.toUpperCase();
    centerText(g, title, w / 2, h * 0.71, `800 ${hit ? 48 : 40}px ${DISPLAY}`, lib ? COLORS.liberalDeep : hit ? COLORS.hitler : COLORS.fascistDeep);
    centerText(g, lib ? 'Liberal party' : 'Fascist party', w / 2, h * 0.81, `bold 16px ${MONO}`, COLORS.ink);
    centerText(g, 'click to close your eyes', w / 2, h * 0.91, `13px ${MONO}`, '#7a5a32');
  });
}

export function membershipCard(name: string, party: 'liberal' | 'fascist') {
  return tex(`member-${name}-${party}`, 256, 360, (g, w, h) => {
    const lib = party === 'liberal';
    g.fillStyle = COLORS.paper;
    g.fillRect(0, 0, w, h);
    inkEdge(g, w, h);
    frame(g, w, h, lib ? COLORS.liberal : COLORS.fascist, 10, 4);
    centerText(g, 'PARTY MEMBERSHIP', w / 2, 44, `bold 17px ${MONO}`, COLORS.ink);
    centerText(g, name, w / 2, 86, `700 26px ${DISPLAY}`, COLORS.ink);
    emblem(g, lib ? 'L' : 'F', w / 2, h * 0.5, 50, lib ? COLORS.liberal : COLORS.fascist);
    centerText(g, lib ? 'LIBERAL' : 'FASCIST', w / 2, h * 0.75, `800 40px ${DISPLAY}`, lib ? COLORS.liberalDeep : COLORS.fascistDeep);
    centerText(g, 'click to put it away', w / 2, h * 0.9, `13px ${MONO}`, '#7a5a32');
  });
}

export function envelopeTexture() {
  return tex('envelope', 360, 256, (g, w, h) => {
    g.fillStyle = COLORS.kraft;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8c6a3c';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w / 2, h * 0.55);
    g.lineTo(w, 0);
    g.stroke();
    // Wax seal.
    g.fillStyle = COLORS.hitler;
    g.strokeStyle = COLORS.ink;
    g.beginPath();
    g.arc(w / 2, h * 0.55, 22, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // Red rubber stamp, slightly crooked.
    g.save();
    g.translate(w / 2, h * 0.85);
    g.rotate((-4 * Math.PI) / 180);
    centerText(g, 'CONFIDENTIAL', 0, 1, `800 24px ${DISPLAY}`, COLORS.hitler);
    const tw = g.measureText('CONFIDENTIAL').width;
    g.strokeStyle = COLORS.hitler;
    g.lineWidth = 3;
    g.strokeRect(-tw / 2 - 12, -20, tw + 24, 40);
    g.restore();
    grain(g, w, h, 16, 12);
  });
}

export function placardTexture(title: string, color: string) {
  return tex(`placard-${title}`, 512, 128, (g, w, h) => {
    g.fillStyle = COLORS.ink;
    g.fillRect(0, 0, w, h);
    frame(g, w, h, color, 8, 3);
    frame(g, w, h, color, 14, 1);
    centerText(g, title, w / 2, h / 2 + 2, `800 56px ${DISPLAY}`, color);
  });
}

export function labelTexture(text: string, color: string, bg = '#1c130c') {
  return tex(`label-${text}-${color}-${bg}`, 256, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    frame(g, w, h, color, 6, 3);
    frame(g, w, h, color, 12, 1);
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

/** The central board: liberal track, fascist track with powers, election tracker. */
export function boardTexture(powers: (string | null)[]) {
  return tex(`board-${powers.join(',')}`, 1024, 640, (g, w, h) => {
    g.fillStyle = '#2b1d12';
    g.fillRect(0, 0, w, h);
    frame(g, w, h, COLORS.gold, 10, 4);
    // Liberal track.
    g.fillStyle = '#1f4660';
    g.fillRect(40, 40, w - 80, 230);
    centerText(g, 'LIBERAL', w / 2, 66, `bold 30px ${DISPLAY}`, COLORS.liberalLight);
    const lx = (i: number) => 140 + i * 186;
    for (let i = 0; i < 5; i++) {
      g.strokeStyle = COLORS.liberalLight;
      g.lineWidth = 3;
      g.strokeRect(lx(i) - 60, 92, 120, 160);
      if (i === 4) {
        emblem(g, 'L', lx(i), 172, 36, 'rgba(216,236,244,0.35)');
        centerText(g, 'WIN', lx(i), 235, `bold 18px ${MONO}`, 'rgba(216,236,244,0.6)');
      }
    }
    // Fascist track.
    g.fillStyle = '#5a1d16';
    g.fillRect(40, 290, w - 80, 230);
    centerText(g, 'FASCIST', w / 2, 316, `bold 30px ${DISPLAY}`, COLORS.fascistLight);
    const fx = (i: number) => 125 + i * 155;
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = COLORS.fascistLight;
      g.lineWidth = 3;
      g.strokeRect(fx(i) - 60, 342, 120, 160);
      const p = powers[i];
      const label = i === 5 ? 'WIN' : p ? POWER_LABEL[p] : '';
      if (label) {
        g.font = `bold 16px ${MONO}`;
        const words = label.split(' ');
        words.forEach((wd, j) => centerText(g, wd, fx(i), 410 + j * 22 - (words.length - 1) * 11, `bold 17px ${MONO}`, 'rgba(243,217,201,0.75)'));
      }
      if (i >= 3) centerText(g, '!', fx(i), 480, `bold 22px ${DISPLAY}`, 'rgba(243,217,201,0.35)');
    }
    centerText(g, 'Hitler as chancellor wins from the 4th slot on  •  Veto unlocks at 5', w / 2, 508 + 4, `14px ${MONO}`, 'rgba(243,217,201,0.55)');
    // Election tracker.
    centerText(g, 'ELECTION TRACKER', 250, 580, `bold 20px ${MONO}`, COLORS.gold);
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = COLORS.gold;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(430 + i * 90, 580, 22, 0, Math.PI * 2);
      g.stroke();
      if (i === 3) centerText(g, '!', 430 + i * 90, 581, `bold 22px ${DISPLAY}`, COLORS.gold);
    }
    centerText(g, '3 failed = top policy enacted', 860, 580, `14px ${MONO}`, 'rgba(214,168,74,0.7)');
    grain(g, w, h, 10, 21);
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
