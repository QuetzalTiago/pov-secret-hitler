// Personal win/loss record: client-only, kept in localStorage and counted once per finished game.
import type { Role } from '../shared/types';
import type { GameView } from '../shared/view';
import { tr } from './i18n';

export interface PlayerRecord {
  played: number;
  wins: { liberal: number; fascist: number; hitler: number }; // keyed by the role you held
  streak: number; // current consecutive wins
  best: number; // best streak ever
  seen: string[]; // keys of games already counted (dedup), last 20 only
}

const STORAGE_KEY = 'sh-record';
const SEEN_MAX = 20;

export function emptyRecord(): PlayerRecord {
  return { played: 0, wins: { liberal: 0, fascist: 0, hitler: 0 }, streak: 0, best: 0, seen: [] };
}

/** Counts a finished game once; returns the same object when there is nothing to count. */
export function recordGame(r: PlayerRecord, v: GameView, key: string): PlayerRecord {
  if (v.phase !== 'gameOver' || !v.winner || !v.yourRole || r.seen.includes(key)) return r;
  const role: Role = v.yourRole;
  const won = (role === 'liberal' ? 'liberal' : 'fascist') === v.winner;
  const streak = won ? r.streak + 1 : 0;
  return {
    played: r.played + 1,
    wins: won ? { ...r.wins, [role]: r.wins[role] + 1 } : { ...r.wins },
    streak,
    best: Math.max(r.best, streak),
    seen: [...r.seen, key].slice(-SEEN_MAX),
  };
}

/** "Your record: 7 wins in 12 · streak 3"; empty before the first game. */
export function recordLine(r: PlayerRecord): string {
  if (r.played === 0) return '';
  const w = r.wins.liberal + r.wins.fascist + r.wins.hitler;
  let line = tr({
    en: `Your record: ${w} ${w === 1 ? 'win' : 'wins'} in ${r.played}`,
    es: `Tu récord: ${w} ${w === 1 ? 'victoria' : 'victorias'} en ${r.played}`,
  });
  if (r.streak > 0) line += tr({ en: ` · streak ${r.streak}`, es: ` · racha ${r.streak}` });
  if (r.best > r.streak) line += tr({ en: ` · best ${r.best}`, es: ` · mejor ${r.best}` });
  return line;
}

const count = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0);

export function parseRecord(raw: unknown): PlayerRecord {
  if (!raw || typeof raw !== 'object') return emptyRecord();
  const o = raw as Record<string, unknown>;
  const w = o.wins && typeof o.wins === 'object' ? (o.wins as Record<string, unknown>) : {};
  return {
    played: count(o.played),
    wins: { liberal: count(w.liberal), fascist: count(w.fascist), hitler: count(w.hitler) },
    streak: count(o.streak),
    best: count(o.best),
    seen: Array.isArray(o.seen) ? o.seen.filter((k): k is string => typeof k === 'string').slice(-SEEN_MAX) : [],
  };
}

export function loadRecord(): PlayerRecord {
  try {
    return parseRecord(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return emptyRecord();
  }
}

export function saveRecord(r: PlayerRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable */
  }
}
