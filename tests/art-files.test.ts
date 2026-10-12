import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ART = path.resolve(__dirname, '../client/art');
const CARDS = [
  'policy-L', 'policy-F', 'policy-back', 'ballot-ja', 'ballot-nein', 'ballot-back',
  'role-liberal', 'role-fascist', 'role-hitler', 'role-back', 'member-liberal', 'member-fascist', 'member-back',
];
const BOARDS = ['board-liberal', 'board-fascist-56', 'board-fascist-78', 'board-fascist-910'];
const SEALS = ['seal-liberal', 'seal-fascist'];
const OTHERS = ['placard-president', 'placard-chancellor', 'logo'];
const ALL = [...CARDS, ...SEALS, ...BOARDS, ...OTHERS];
const BUDGET = 2.5 * 1024 * 1024;

const read = (name: string) => fs.readFileSync(path.join(ART, `${name}.webp`));

/** Pixel size from the first chunk of a RIFF/WEBP file (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(buf: Buffer): { width: number; height: number } {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  throw new Error(`unknown webp chunk ${chunk}`);
}

describe('official art files', () => {
  it('has every expected webp with a RIFF/WEBP header', () => {
    expect(ALL).toHaveLength(22);
    for (const name of ALL) {
      const buf = read(name);
      expect(buf.length, name).toBeGreaterThan(0);
      expect(buf.toString('ascii', 0, 4), name).toBe('RIFF');
      expect(buf.toString('ascii', 8, 12), name).toBe('WEBP');
    }
  });

  it('cards are 512x720', () => {
    for (const name of CARDS) expect(webpSize(read(name)), name).toEqual({ width: 512, height: 720 });
  });

  it('seals are 256x256', () => {
    for (const name of SEALS) expect(webpSize(read(name)), name).toEqual({ width: 256, height: 256 });
  });

  it('boards are at most 2048 px wide', () => {
    for (const name of BOARDS) expect(webpSize(read(name)).width, name).toBeLessThanOrEqual(2048);
  });

  it('stays within the 2.5 MB budget', () => {
    const files = fs.readdirSync(ART).filter((f) => f.endsWith('.webp'));
    const total = files.reduce((sum, f) => sum + fs.statSync(path.join(ART, f)).size, 0);
    expect(total).toBeLessThanOrEqual(BUDGET);
  });

  it('credits the artist and the licence', () => {
    const credits = fs.readFileSync(path.join(ART, 'CREDITS.md'), 'utf8');
    expect(credits).toContain('CC BY-NC-SA 4.0');
    expect(credits).toContain('Mackenzie Schubert');
  });
});
