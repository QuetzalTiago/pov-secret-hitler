import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMarks, saveMarks } from '../client/marks';

const g = globalThis as { sessionStorage?: unknown };
let saved: unknown;
let store: Map<string, string>;

beforeEach(() => {
  saved = g.sessionStorage;
  store = new Map();
  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});
afterEach(() => {
  g.sessionStorage = saved;
});

describe('marks storage', () => {
  it('round-trips marks per room code and drops null entries', () => {
    saveMarks('ABCD', { 1: 'L', 2: null, 4: '?' });
    expect(loadMarks('ABCD')).toEqual({ 1: 'L', 4: '?' });
    expect(loadMarks('WXYZ')).toEqual({});
  });

  it('returns {} for invalid JSON and drops invalid values', () => {
    store.set('sh-marks:ABCD', '{nope');
    expect(loadMarks('ABCD')).toEqual({});
    store.set('sh-marks:ABCD', JSON.stringify({ 1: 'X', 2: 'F', 3: 5 }));
    expect(loadMarks('ABCD')).toEqual({ 2: 'F' });
    store.set('sh-marks:ABCD', 'null');
    expect(loadMarks('ABCD')).toEqual({});
  });

  it('does nothing when storage is unavailable', () => {
    g.sessionStorage = undefined;
    expect(loadMarks('ABCD')).toEqual({});
    expect(() => saveMarks('ABCD', { 1: 'L' })).not.toThrow();
  });
});
