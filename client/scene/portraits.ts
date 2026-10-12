import { COLORS } from './textures';

/**
 * Flat, blocky portrait busts in the house style (see docs/design/art-direction.md): solid inks, a thick
 * ink outline, no gradients. Fascists are lizards in suits and hats, Hitler a lizard in a peaked cap,
 * liberals 1930s humans. Original drawing, deterministic for (kind, seed).
 */
export type PortraitKind = 'liberal' | 'fascist' | 'hitler';
export const PORTRAIT_VARIANTS = 4; // variants per kind

const SKIN = '#a88a6c'; // muted human skin
const SCALES = '#5f7a4a'; // muted lizard green

type Pt = [number, number];
type Hat = 'fedora' | 'homburg' | 'cloche' | 'cap' | 'none';
/** Drawing frame: box, mirror flag, party ink. Shapes are authored in 0..1 box units facing +x. */
type S = { g: CanvasRenderingContext2D; x: number; y: number; w: number; h: number; m: number; party: string };

/** Seeded value noise (same LCG as textures.ts). */
function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const pt = (s: S, px: number, py: number): Pt => [s.x + (s.m > 0 ? px : 1 - px) * s.w, s.y + py * s.h];

function path(s: S, pts: Pt[], close: boolean) {
  s.g.beginPath();
  pts.forEach(([px, py], i) => {
    const [X, Y] = pt(s, px, py);
    if (i) s.g.lineTo(X, Y);
    else s.g.moveTo(X, Y);
  });
  if (close) s.g.closePath();
}

/** Filled polygon with the ink outline. */
function poly(s: S, pts: Pt[], fill: string) {
  s.g.fillStyle = fill;
  path(s, pts, true);
  s.g.fill();
  s.g.stroke();
}

/** Open stroke; thin cream by default, thick ink for features. */
function line(s: S, pts: Pt[], color = COLORS.line, width = 0.012) {
  s.g.save();
  s.g.strokeStyle = color;
  s.g.lineWidth = s.w * width;
  path(s, pts, false);
  s.g.stroke();
  s.g.restore();
}

function dot(s: S, px: number, py: number, r: number, fill: string, outline = false) {
  const [X, Y] = pt(s, px, py);
  s.g.fillStyle = fill;
  s.g.beginPath();
  s.g.arc(X, Y, s.w * r, 0, Math.PI * 2);
  s.g.fill();
  if (outline) s.g.stroke();
}

const flip = (pts: Pt[]): Pt[] => pts.map(([px, py]) => [1 - px, py]);

/** Slit eye or round eye: ink mark plus a cream highlight. */
function eye(s: S, px: number, py: number, slit: boolean) {
  if (slit) poly(s, [[px - 0.05, py], [px, py - 0.025], [px + 0.05, py], [px, py + 0.015]], COLORS.ink);
  else dot(s, px, py, 0.017, COLORS.ink);
  dot(s, px + 0.01, py - 0.006, 0.006, COLORS.line);
}

// --- clothes ---

function neckAndSuit(s: S, tie: 'tie' | 'bow' | 'dress', wide: number) {
  // Shoulders, then neck over them, so the collar V reads.
  poly(s, [[0.08, 1], [0.1, 0.84], [0.3, 0.74], [0.5, 0.78], [0.7, 0.74], [0.9, 0.84], [0.92, 1]], COLORS.ink);
  poly(s, [[0.5 - wide, 0.56], [0.5 + wide, 0.56], [0.5 + wide, 0.8], [0.5, 0.9], [0.5 - wide, 0.8]], s.party === COLORS.liberal ? SKIN : SCALES);
  if (tie === 'dress') {
    // Round dress collar: two rounded wings in the party ink.
    const wing: Pt[] = [[0.5, 0.82], [0.4, 0.76], [0.31, 0.8], [0.33, 0.88], [0.44, 0.92]];
    poly(s, wing, s.party);
    poly(s, flip(wing), s.party);
    line(s, [[0.5, 0.84], [0.44, 0.9]]);
    line(s, flip([[0.5, 0.84], [0.44, 0.9]]));
    return;
  }
  // Collar V and lapels in cream line.
  line(s, [[0.5 - wide, 0.76], [0.5, 0.9], [0.5 + wide, 0.76]]);
  line(s, [[0.4, 0.8], [0.3, 0.97]]);
  line(s, [[0.6, 0.8], [0.7, 0.97]]);
  if (tie === 'tie') {
    poly(s, [[0.47, 0.8], [0.53, 0.8], [0.54, 0.85], [0.46, 0.85]], s.party);
    poly(s, [[0.46, 0.85], [0.54, 0.85], [0.56, 0.96], [0.5, 1], [0.44, 0.96]], s.party);
  } else {
    poly(s, [[0.5, 0.84], [0.4, 0.79], [0.4, 0.89]], s.party);
    poly(s, [[0.5, 0.84], [0.6, 0.79], [0.6, 0.89]], s.party);
    poly(s, [[0.47, 0.82], [0.53, 0.82], [0.53, 0.87], [0.47, 0.87]], s.party);
  }
}

// --- heads ---

function humanHead(s: S, r: () => number, hair: boolean) {
  const cx = 0.48;
  const rx = 0.17 + r() * 0.02;
  const ry = 0.21 + r() * 0.02;
  const [X, Y] = pt(s, cx, 0.4);
  dot(s, 0.31, 0.43, 0.035, SKIN, true); // ear on the far side
  s.g.fillStyle = SKIN;
  s.g.beginPath();
  s.g.ellipse(X, Y, s.w * rx, s.h * ry, 0, 0, Math.PI * 2);
  s.g.fill();
  s.g.stroke();
  eye(s, 0.5, 0.4, false);
  eye(s, 0.62, 0.4, false);
  line(s, [[0.45, 0.35], [0.54, 0.34]], COLORS.ink, 0.02);
  line(s, [[0.58, 0.34], [0.67, 0.35]], COLORS.ink, 0.02);
  line(s, [[0.58, 0.42], [0.64, 0.5], [0.58, 0.51]], COLORS.ink, 0.014); // nose
  line(s, [[0.52, 0.58], [0.6, 0.57]], COLORS.ink, 0.016); // mouth
  if (hair) {
    poly(s, [[0.31, 0.42], [0.3, 0.25], [0.4, 0.17], [0.56, 0.17], [0.67, 0.27], [0.64, 0.31], [0.5, 0.26], [0.37, 0.32], [0.34, 0.44]], COLORS.ink);
    line(s, [[0.42, 0.2], [0.5, 0.2], [0.58, 0.23]]);
  }
}

/** Lizard head in three-quarter profile: long snout, slit eye, crest at the back, scale chevrons. */
function lizardHead(s: S, r: () => number, v: number, mustache: boolean) {
  const tx = 0.73 + r() * 0.05 + (v % 2) * 0.08; // snout tip
  // Crest behind the head: n teeth up the back, spiked or a rounded frill by variant.
  const n = 3 + (v % 3);
  const crest: Pt[] = [[0.34, 0.5]];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const bx = 0.3 + t * 0.26;
    const by = 0.42 - t * 0.26;
    const len = 0.07 + r() * 0.04;
    crest.push([bx - len, by - (v < 2 ? len : len * 0.3)], [bx + 0.03, by - 0.06]);
  }
  crest.push([0.56, 0.2]);
  poly(s, crest, s.party);
  poly(s, [
    [0.3, 0.38], [0.36, 0.2], [0.52, 0.15], [0.62, 0.25], [tx - 0.05, 0.33], [tx, 0.4],
    [tx - 0.02, 0.5], [0.62, 0.52], [0.58, 0.63], [0.42, 0.66], [0.32, 0.56],
  ], SCALES);
  line(s, [[0.62, 0.5], [tx - 0.03, 0.47]], COLORS.ink, 0.02); // mouth
  dot(s, tx - 0.06, 0.37, 0.011, COLORS.ink); // nostril
  if (mustache) poly(s, [[tx - 0.11, 0.41], [tx - 0.01, 0.42], [tx - 0.02, 0.46], [tx - 0.1, 0.45]], COLORS.ink);
  line(s, [[0.5, 0.24], [0.6, 0.27]], COLORS.ink, 0.024); // brow ridge
  eye(s, 0.56, 0.3, true);
  for (let i = 0; i < 3; i++) {
    const cx = 0.38 + i * 0.07;
    const cy = 0.46 + (i % 2) * 0.05;
    line(s, [[cx - 0.025, cy - 0.025], [cx, cy], [cx + 0.025, cy - 0.025]], COLORS.ink, 0.012);
  }
}

// --- hats ---

/** Hat resting on the head: `cx` crown centre, `hw` half width of the crown. */
function hat(s: S, kind: Hat, cx: number, hw: number, top: number) {
  if (kind === 'none') return;
  if (kind === 'cloche') {
    poly(s, [[0.3, 0.34], [0.3, 0.18], [0.38, 0.09], [0.5, 0.07], [0.62, 0.09], [0.7, 0.18], [0.72, 0.33], [0.6, 0.3], [0.4, 0.3]], s.party);
    line(s, [[0.3, 0.27], [0.5, 0.29], [0.71, 0.27]]);
    poly(s, [[0.3, 0.38], [0.28, 0.5], [0.34, 0.5], [0.34, 0.38]], COLORS.ink); // bob hair
    return;
  }
  if (kind === 'cap') {
    // Peaked cap: tall flared crown, band with cream piping, visor forward, badge disc.
    poly(s, [[cx - hw, 0.27], [cx - hw - 0.02, 0.12], [cx - 0.1, top], [cx + 0.1, top], [cx + hw + 0.04, 0.12], [cx + hw, 0.27]], COLORS.ink);
    poly(s, [[cx - hw, 0.2], [cx + hw, 0.2], [cx + hw, 0.27], [cx - hw, 0.27]], s.party);
    line(s, [[cx - hw - 0.02, 0.12], [cx - 0.1, top + 0.01], [cx + 0.1, top + 0.01], [cx + hw + 0.04, 0.12]]);
    poly(s, [[cx - 0.02, 0.27], [cx + hw + 0.2, 0.3], [cx + hw + 0.22, 0.34], [cx - 0.02, 0.32]], COLORS.ink);
    line(s, [[cx, 0.325], [cx + hw + 0.2, 0.335]]);
    dot(s, cx + 0.04, 0.2, 0.025, COLORS.line, true);
    dot(s, cx + 0.04, 0.2, 0.01, COLORS.ink);
    return;
  }
  // Fedora (pinched crown, wide brim) or homburg (dented crown, narrow rolled brim).
  const brim = kind === 'fedora' ? 0.2 : 0.14;
  poly(s, [[cx - hw, 0.27], [cx - hw + 0.02, top + 0.06], [cx - hw * 0.5, top], [cx, top + (kind === 'fedora' ? 0.04 : 0.01)], [cx + hw * 0.5, top], [cx + hw - 0.02, top + 0.06], [cx + hw, 0.27]], COLORS.ink);
  poly(s, [[cx - hw, 0.2], [cx + hw, 0.2], [cx + hw + 0.01, 0.27], [cx - hw - 0.01, 0.27]], s.party);
  line(s, [[cx - hw, 0.2], [cx + hw, 0.2]]);
  poly(s, [[cx - hw - brim, 0.29], [cx - hw * 0.5, 0.25], [cx + hw * 0.5, 0.25], [cx + hw + brim + 0.05, 0.29], [cx + hw * 0.5, 0.33], [cx - hw * 0.5, 0.33]], COLORS.ink);
  line(s, [[cx - hw - brim + 0.02, 0.29], [cx - hw * 0.5, 0.265], [cx + hw * 0.5, 0.265]]);
}

export function drawPortrait(g: CanvasRenderingContext2D, kind: PortraitKind, seed: number, x: number, y: number, w: number, h: number): void {
  const v = ((seed % PORTRAIT_VARIANTS) + PORTRAIT_VARIANTS) % PORTRAIT_VARIANTS;
  const r = rand((Math.abs(seed) * 2654 + 17 + kind.length * 101) % 2147483646 + 1);
  const liberal = kind === 'liberal';
  const s: S = { g, x, y, w, h, m: v & 1 ? -1 : 1, party: liberal ? COLORS.liberal : COLORS.fascist };
  g.save();
  g.fillStyle = liberal ? COLORS.liberalDeep : kind === 'hitler' ? COLORS.hitler : COLORS.fascistDeep;
  g.fillRect(x, y, w, h);
  g.strokeStyle = COLORS.ink;
  g.lineWidth = w * 0.02;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const tie = (['tie', 'bow', 'bow', 'tie'] as const)[v];
  if (liberal) {
    const hats: Hat[] = ['fedora', 'cloche', 'none', 'homburg'];
    neckAndSuit(s, v === 1 ? 'dress' : tie, 0.09);
    humanHead(s, r, v === 2);
    hat(s, hats[v], 0.48, 0.15, 0.08 + r() * 0.03);
  } else {
    neckAndSuit(s, tie, 0.1);
    lizardHead(s, r, v, kind === 'hitler');
    if (kind === 'hitler') {
      line(s, [[0.3, 0.77], [0.72, 1]]); // diagonal belt strap across the coat
      hat(s, 'cap', 0.46, 0.17, 0.03 + r() * 0.03);
    } else {
      hat(s, v < 2 ? 'fedora' : 'homburg', 0.46, 0.15, 0.07 + r() * 0.03);
    }
  }
  g.restore();
}
