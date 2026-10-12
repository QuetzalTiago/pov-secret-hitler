import { BLOCK, COLORS, emblem } from './textures';

const NOTCHES = 24;
/** Below this radius the rim notches and ring lettering are skipped so the seal stays legible. */
const MIN_DETAIL_R = 24;

/** Places each character of `text` along a circle of radius `rad`, spread evenly over the full turn, centred over the top. */
function ringText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, rad: number, size: number) {
  g.save();
  g.font = `800 ${size}px ${BLOCK}`;
  g.fillStyle = COLORS.line;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = [...text];
  const widths = chars.map((c) => g.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let acc = 0;
  chars.forEach((c, i) => {
    const a = -Math.PI / 2 + ((acc + widths[i] / 2) / total - 0.5) * Math.PI * 2;
    acc += widths[i];
    g.save();
    g.translate(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    g.rotate(a + Math.PI / 2);
    g.fillText(c, 0, 0);
    g.restore();
  });
  g.restore();
}

/** Schubert's secret X: two thick cream bars with an ink outline. */
function secretX(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const len = r * 0.8;
  const thick = r * 0.17;
  g.save();
  g.translate(cx, cy);
  g.fillStyle = COLORS.line;
  g.strokeStyle = COLORS.ink;
  g.lineWidth = Math.max(1, r * 0.05);
  g.lineJoin = 'miter';
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    g.save();
    g.rotate(a);
    g.fillRect(-len / 2, -thick / 2, len, thick);
    g.strokeRect(-len / 2, -thick / 2, len, thick);
    g.restore();
  }
  g.restore();
}

/**
 * Ornate party seal: a flat field disc with an ink outline, a stepped art-deco rim, lettering between two rings
 * and the party emblem in the centre. `party === null` is the neutral seal (a secret X) that reveals nothing.
 */
export function drawSeal(g: CanvasRenderingContext2D, party: 'L' | 'F' | null, cx: number, cy: number, r: number, field: string): void {
  const detailed = r >= MIN_DETAIL_R;
  g.save();
  g.fillStyle = field;
  g.strokeStyle = COLORS.ink;
  g.lineWidth = r * 0.06;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  if (detailed) {
    // Stepped rim: square notches around the outer edge.
    const n = r * 0.07;
    g.fillStyle = COLORS.ink;
    for (let i = 0; i < NOTCHES; i++) {
      const a = (i / NOTCHES) * Math.PI * 2;
      g.save();
      g.translate(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93);
      g.rotate(a);
      g.fillRect(-n, -n, n * 2, n * 2);
      g.restore();
    }
  }

  g.lineWidth = Math.max(1, r * 0.025);
  g.strokeStyle = COLORS.line;
  g.beginPath();
  g.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = COLORS.ink;
  g.lineWidth = Math.max(1, r * 0.04);
  g.beginPath();
  g.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  g.stroke();

  if (detailed) {
    const text = party === 'L' ? 'LIBERAL PARTY ★ ' : party === 'F' ? 'FASCIST PARTY ★ ' : 'SECRET • SECRET • ';
    ringText(g, text, cx, cy, r * 0.74, Math.round(r * 0.17));
  }

  if (party === null) secretX(g, cx, cy, r * 0.62);
  else emblem(g, party, cx, cy, r * 0.5, party === 'L' ? COLORS.liberal : COLORS.fascist);
  g.restore();
}
