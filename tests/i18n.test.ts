import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectLang, lang, onLangChange, setLang, tr } from '../client/i18n';

describe('detectLang', () => {
  it('a saved en stays en', () => {
    expect(detectLang('en')).toBe('en');
  });
  it('a saved es stays es', () => {
    expect(detectLang('es')).toBe('es');
  });
  it('no saved choice defaults to es', () => {
    expect(detectLang(null)).toBe('es');
  });
  it('junk stored values default to es', () => {
    expect(detectLang('de')).toBe('es');
    expect(detectLang('')).toBe('es');
  });
});

describe('tr and setLang', () => {
  it('returns the side for the current language', () => {
    setLang('es');
    expect(lang()).toBe('es');
    expect(tr({ en: 'Leave', es: 'Salir' })).toBe('Salir');
    setLang('en');
    expect(tr({ en: 'Leave', es: 'Salir' })).toBe('Leave');
  });
  it('listeners hear the new language until they unsubscribe', () => {
    const seen: string[] = [];
    const off = onLangChange((l) => seen.push(l));
    setLang('es');
    setLang('en');
    off();
    setLang('es');
    expect(seen).toEqual(['es', 'en']);
    setLang('en');
  });
});

describe('index.html markup', () => {
  const html = readFileSync(resolve(__dirname, '..', 'client', 'index.html'), 'utf8');
  const attrs = [...html.matchAll(/\bdata-es="([^"]*)"/g)];

  it('has plenty of Spanish and none empty', () => {
    expect(attrs.length).toBeGreaterThanOrEqual(60);
    for (const m of attrs) expect(m[1].trim()).not.toBe('');
  });

  // Elements carrying data-es: tag name, then content up to the matching close tag (no nested same-name tags here).
  const withEs = [...html.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-es="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)];

  it('no data-es element contains an id or an input', () => {
    expect(withEs.length).toBe(attrs.length);
    for (const m of withEs) {
      expect(m[2], m[0].slice(0, 80)).not.toMatch(/\bid=|<input/);
    }
  });

  it('the dynamic children are never swapped out', () => {
    for (const id of ['name', 'room-code', 'copy-code', 'hud-code', 'invite-code', 'cc-confirm-label']) {
      for (const m of withEs) expect(m[2]).not.toContain(`id="${id}"`);
    }
  });
});
