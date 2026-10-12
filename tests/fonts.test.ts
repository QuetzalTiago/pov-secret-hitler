import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const clientDir = resolve(__dirname, '..', 'client');
const css = readFileSync(resolve(clientDir, 'style.css'), 'utf8');
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

describe('self-hosted fonts', () => {
  it('index.html does not load Google Fonts (the CSP blocks them)', () => {
    const html = readFileSync(resolve(clientDir, 'index.html'), 'utf8');
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('fonts.gstatic');
  });

  it('every @font-face url points to an existing file', () => {
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      const urls = [...face.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) expect(existsSync(resolve(clientDir, u)), u).toBe(true);
    }
  });

  it('declares the --font-block token', () => {
    expect(css).toMatch(/--font-block\s*:/);
  });

  it('keeps the woff2 files within 400 KB in total', () => {
    const dir = resolve(clientDir, 'fonts');
    const files = readdirSync(dir).filter((f) => f.endsWith('.woff2'));
    expect(files.length).toBeGreaterThan(0);
    const total = files.reduce((n, f) => n + statSync(resolve(dir, f)).size, 0);
    expect(total).toBeLessThanOrEqual(400 * 1024);
  });

  it('LICENSES.md mentions every @font-face family', () => {
    const licences = readFileSync(resolve(clientDir, 'fonts', 'LICENSES.md'), 'utf8');
    for (const face of faces) {
      const family = /font-family:\s*['"]([^'"]+)['"]/.exec(face)?.[1];
      expect(family).toBeTruthy();
      expect(licences).toContain(family!);
    }
  });
});
