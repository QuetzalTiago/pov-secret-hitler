import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../client/i18n';
import { knownServerErrors, translateServerError } from '../client/servererrors';

afterEach(() => setLang('en'));

describe('translateServerError', () => {
  it('translates known messages in Spanish', () => {
    setLang('es');
    expect(translateServerError('That room is full.')).toBe('Esa sala está llena.');
    expect(translateServerError('Only the host can start.')).toBe('Solo el anfitrión puede empezar.');
    expect(translateServerError('You are not seated.')).toBe('No tienes asiento.');
  });

  it('keeps the number in the minimum-players message', () => {
    setLang('es');
    expect(translateServerError('Need at least 5 players (add bots to fill seats).')).toBe(
      'Hacen falta al menos 5 jugadores (añade bots para llenar los asientos).',
    );
  });

  it('passes unknown messages through', () => {
    setLang('es');
    expect(translateServerError('Something new.')).toBe('Something new.');
  });

  it('leaves everything unchanged in English', () => {
    setLang('en');
    for (const m of [...knownServerErrors(), 'Need at least 5 players (add bots to fill seats).', 'Something new.']) {
      expect(translateServerError(m)).toBe(m);
    }
  });
});

describe('server error coverage', () => {
  // Messages that are not sent to players.
  const IGNORED = new Set(['Client not built. Run `npm run build` first.']);

  it('every error message literal in server/index.ts and server/room.ts is translated', () => {
    const known = new Set(knownServerErrors());
    const found = new Set<string>();
    for (const file of ['server/index.ts', 'server/room.ts']) {
      const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
      // return '...', msg: '...', and any capitalised sentence literal (covers ternaries like `: 'Slow down.'`).
      for (const re of [/return '([^']+)'/g, /msg: '([^']+)'/g, /'([A-Z][^'$\n]*[.!])'/g]) {
        for (const m of src.matchAll(re)) found.add(m[1]);
      }
    }
    const missing = [...found].filter((m) => /^[A-Z].*[.!]$/.test(m) && !IGNORED.has(m) && !known.has(m));
    expect(missing).toEqual([]);
    expect(found.size).toBeGreaterThan(20);
  });
});
