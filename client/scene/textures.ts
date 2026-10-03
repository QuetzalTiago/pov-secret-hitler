// Every texture in the game is drawn at runtime on a canvas. No image assets.
import * as THREE from 'three';

const SERIF = '"Georgia", "Times New Roman", serif';
const SANS = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const cache = new Map<string, THREE.CanvasTexture>();

export const COLORS = {
  liberal: '#2f6f9a',
  liberalLight: '#d8ecf4',
  fascist: '#b0342a',
  fascistLight: '#f3d9c9',
  paper: '#efe3c8',
  ink: '#231a12',
  gold: '#d6a84a',
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, g] = canvas(w, h);
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
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

/** An original emblem: a dove-like chevron (liberal) or an angular raven head (fascist). */
function emblem(g: CanvasRenderingContext2D, kind: 'L' | 'F', cx: number, cy: number, s: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  if (kind === 'L') {
    g.moveTo(cx - s, cy - s * 0.1);
    g.quadraticCurveTo(cx - s * 0.4, cy - s * 0.9, cx, cy - s * 0.2);
    g.quadraticCurveTo(cx + s * 0.4, cy - s * 0.9, cx + s, cy - s * 0.1);
    g.quadraticCurveTo(cx + s * 0.3, cy + s * 0.05, cx, cy + s * 0.7);
    g.quadraticCurveTo(cx - s * 0.3, cy + s * 0.05, cx - s, cy - s * 0.1);
  } else {
    g.moveTo(cx - s * 0.7, cy + s * 0.7);
    g.lineTo(cx - s * 0.5, cy - s * 0.4);
    g.lineTo(cx, cy - s * 0.85);
    g.lineTo(cx + s * 0.55, cy - s * 0.45);
    g.lineTo(cx + s * 1.05, cy - s * 0.25);
    g.lineTo(cx + s * 0.5, cy - s * 0.05);
    g.lineTo(cx + s * 0.7, cy + s * 0.7);
  }
  g.closePath();
  g.fill();
  if (kind === 'F') {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.arc(cx + s * 0.1, cy - s * 0.4, s * 0.1, 0, Math.PI * 2);
    g.fill();
  }
}

export function policyFace(p: 'L' | 'F') {
  return tex(`policy-${p}`, 256, 360, (g, w, h) => {
    const lib = p === 'L';
    g.fillStyle = lib ? COLORS.liberal : COLORS.fascist;
    g.fillRect(0, 0, w, h);
    g.fillStyle = lib ? COLORS.liberalLight : COLORS.fascistLight;
    g.fillRect(16, 16, w - 32, h - 32);
    frame(g, w, h, lib ? COLORS.liberal : COLORS.fascist, 24, 3);
    emblem(g, p, w / 2, h * 0.42, 62, lib ? COLORS.liberal : COLORS.fascist);
    centerText(g, lib ? 'LIBERAL' : 'FASCIST', w / 2, h * 0.75, `bold 34px ${SERIF}`, lib ? COLORS.liberal : COLORS.fascist);
    centerText(g, 'ARTICLE', w / 2, h * 0.84, `16px ${SANS}`, COLORS.ink);
    grain(g, w, h, 12, p === 'L' ? 2 : 4);
  });
}

export function cardBack(label = 'POLICY') {
  return tex(`back-${label}`, 256, 360, (g, w, h) => {
    g.fillStyle = '#3a2a1c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6e5233';
    g.lineWidth = 2;
    for (let i = -h; i < w + h; i += 18) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.stroke();
    }
    g.fillStyle = '#2a1d12';
    g.fillRect(40, h / 2 - 34, w - 80, 68);
    frame(g, w, h, COLORS.gold, 14, 3);
    centerText(g, label, w / 2, h / 2, `bold 30px ${SERIF}`, COLORS.gold);
    grain(g, w, h, 12, 8);
  });
}

export function ballotFace(ja: boolean) {
  return tex(`ballot-${ja}`, 256, 360, (g, w, h) => {
    g.fillStyle = ja ? '#e9dfc4' : '#2a2320';
    g.fillRect(0, 0, w, h);
    frame(g, w, h, ja ? '#2a2320' : '#e9dfc4', 14, 4);
    centerText(g, ja ? 'JA!' : 'NEIN', w / 2, h / 2, `bold ${ja ? 96 : 76}px ${SERIF}`, ja ? '#2a2320' : '#e9dfc4');
    centerText(g, 'BALLOT', w / 2, h * 0.85, `18px ${SANS}`, ja ? '#6b5d48' : '#9c8f7a');
    grain(g, w, h, 12, ja ? 1 : 6);
  });
}

export function roleCard(role: 'liberal' | 'fascist' | 'hitler') {
  return tex(`role-${role}`, 256, 360, (g, w, h) => {
    const lib = role === 'liberal';
    g.fillStyle = lib ? COLORS.liberal : role === 'hitler' ? '#5a120d' : COLORS.fascist;
    g.fillRect(0, 0, w, h);
    g.fillStyle = COLORS.paper;
    g.fillRect(18, 18, w - 36, h - 36);
    frame(g, w, h, lib ? COLORS.liberal : COLORS.fascist, 26, 3);
    centerText(g, 'SECRET ROLE', w / 2, 52, `16px ${SANS}`, COLORS.ink);
    emblem(g, lib ? 'L' : 'F', w / 2, h * 0.43, 58, lib ? COLORS.liberal : COLORS.fascist);
    const title = role === 'hitler' ? 'HITLER' : role.toUpperCase();
    centerText(g, title, w / 2, h * 0.72, `bold ${role === 'hitler' ? 44 : 36}px ${SERIF}`, lib ? COLORS.liberal : COLORS.fascist);
    centerText(g, lib ? 'Liberal party' : 'Fascist party', w / 2, h * 0.82, `italic 18px ${SERIF}`, COLORS.ink);
    centerText(g, 'click to close your eyes', w / 2, h * 0.91, `13px ${SANS}`, '#6b5d48');
  });
}

export function membershipCard(name: string, party: 'liberal' | 'fascist') {
  return tex(`member-${name}-${party}`, 256, 360, (g, w, h) => {
    const lib = party === 'liberal';
    g.fillStyle = COLORS.paper;
    g.fillRect(0, 0, w, h);
    frame(g, w, h, lib ? COLORS.liberal : COLORS.fascist, 12, 5);
    centerText(g, 'PARTY MEMBERSHIP', w / 2, 44, `bold 17px ${SANS}`, COLORS.ink);
    centerText(g, name, w / 2, 86, `italic 26px ${SERIF}`, COLORS.ink);
    emblem(g, lib ? 'L' : 'F', w / 2, h * 0.5, 50, lib ? COLORS.liberal : COLORS.fascist);
    centerText(g, lib ? 'LIBERAL' : 'FASCIST', w / 2, h * 0.75, `bold 38px ${SERIF}`, lib ? COLORS.liberal : COLORS.fascist);
    centerText(g, 'click to put it away', w / 2, h * 0.9, `13px ${SANS}`, '#6b5d48');
  });
}

export function envelopeTexture() {
  return tex('envelope', 360, 256, (g, w, h) => {
    g.fillStyle = '#c9b48a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8c7650';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w / 2, h * 0.55);
    g.lineTo(w, 0);
    g.stroke();
    g.fillStyle = '#7a1d16';
    g.beginPath();
    g.arc(w / 2, h * 0.55, 22, 0, Math.PI * 2);
    g.fill();
    centerText(g, 'CONFIDENTIAL', w / 2, h * 0.85, `bold 22px ${SERIF}`, '#5b4a2e');
    grain(g, w, h, 16, 12);
  });
}

export function placardTexture(title: string, color: string) {
  return tex(`placard-${title}`, 512, 128, (g, w, h) => {
    g.fillStyle = '#1c130c';
    g.fillRect(0, 0, w, h);
    frame(g, w, h, color, 8, 4);
    centerText(g, title, w / 2, h / 2 + 2, `bold 54px ${SERIF}`, color);
  });
}

export function labelTexture(text: string, color: string, bg = '#1c130c') {
  return tex(`label-${text}-${color}-${bg}`, 256, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    frame(g, w, h, color, 6, 3);
    const size = text.length > 8 ? 30 : 44;
    centerText(g, text, w / 2, h / 2 + 2, `bold ${size}px ${SERIF}`, color);
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
    centerText(g, 'LIBERAL', w / 2, 66, `bold 30px ${SERIF}`, COLORS.liberalLight);
    const lx = (i: number) => 140 + i * 186;
    for (let i = 0; i < 5; i++) {
      g.strokeStyle = COLORS.liberalLight;
      g.lineWidth = 3;
      g.strokeRect(lx(i) - 60, 92, 120, 160);
      if (i === 4) {
        emblem(g, 'L', lx(i), 172, 36, 'rgba(216,236,244,0.35)');
        centerText(g, 'WIN', lx(i), 235, `bold 18px ${SANS}`, 'rgba(216,236,244,0.6)');
      }
    }
    // Fascist track.
    g.fillStyle = '#5a1d16';
    g.fillRect(40, 290, w - 80, 230);
    centerText(g, 'FASCIST', w / 2, 316, `bold 30px ${SERIF}`, COLORS.fascistLight);
    const fx = (i: number) => 125 + i * 155;
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = COLORS.fascistLight;
      g.lineWidth = 3;
      g.strokeRect(fx(i) - 60, 342, 120, 160);
      const p = powers[i];
      const label = i === 5 ? 'WIN' : p ? POWER_LABEL[p] : '';
      if (label) {
        g.font = `bold 16px ${SANS}`;
        const words = label.split(' ');
        words.forEach((wd, j) => centerText(g, wd, fx(i), 410 + j * 22 - (words.length - 1) * 11, `bold 17px ${SANS}`, 'rgba(243,217,201,0.75)'));
      }
      if (i >= 3) centerText(g, '!', fx(i), 480, `bold 22px ${SERIF}`, 'rgba(243,217,201,0.35)');
    }
    centerText(g, 'Hitler as chancellor wins from the 4th slot on  •  Veto unlocks at 5', w / 2, 508 + 4, `14px ${SANS}`, 'rgba(243,217,201,0.55)');
    // Election tracker.
    centerText(g, 'ELECTION TRACKER', 250, 580, `bold 20px ${SANS}`, COLORS.gold);
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = COLORS.gold;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(430 + i * 90, 580, 22, 0, Math.PI * 2);
      g.stroke();
      if (i === 3) centerText(g, '!', 430 + i * 90, 581, `bold 22px ${SERIF}`, COLORS.gold);
    }
    centerText(g, '3 failed = top policy enacted', 860, 580, `14px ${SANS}`, 'rgba(214,168,74,0.7)');
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
  g.font = `bold ${size}px ${SANS}`;
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
  g.font = `bold ${size}px ${SANS}`;
  g.fillStyle = opts.color ?? '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, width / 2, size * 0.3 + size * 1.25 * (i + 0.5) + 2));
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height };
}
