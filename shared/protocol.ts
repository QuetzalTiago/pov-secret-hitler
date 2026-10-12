// Wire protocol: message shapes plus strict validators for everything a client may send.
import type { ActionBody, GameEvent } from './types';
import type { GameView } from './view';

export const MAX_MESSAGE_BYTES = 2048;
export const MAX_NAME = 16;
export const MAX_CHAT = 200;
export const QUICK_START_SEATS = 7;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Table pace: scales bot think/settle time and human phase timers. */
export type Pace = 'relaxed' | 'normal' | 'fast';
export const PACES: readonly Pace[] = ['relaxed', 'normal', 'fast'];

/** Bot difficulty: casual plays the old heuristics loosely, normal the belief strategy, sharp the belief strategy greedily. */
export type BotLevel = 'casual' | 'normal' | 'sharp';
export const BOT_LEVELS: readonly BotLevel[] = ['casual', 'normal', 'sharp'];

/** Host-chosen table options: pace and bot level. */
export interface TableOptions {
  pace: Pace;
  botLevel: BotLevel;
}
export const DEFAULT_OPTIONS: TableOptions = { pace: 'normal', botLevel: 'normal' };

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'quickStart'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; token: string }
  | { t: 'addBot' }
  | { t: 'removeBot' }
  | { t: 'setOptions'; pace?: Pace; botLevel?: BotLevel }
  | { t: 'start' }
  | { t: 'act'; a: ActionBody }
  | { t: 'chat'; text: string }
  | { t: 'leave' }
  | { t: 'rematch' }
  | { t: 'playAgain' }
  | { t: 'redeal' }
  | { t: 'ping' };

export interface SeatInfo {
  seat: number;
  name: string;
  bot: boolean; // a permanent bot added by the host
  botControlled: boolean; // a human seat temporarily driven by a bot
  connected: boolean;
  ready: boolean; // pressed Play again at game over
}

/** Running score of games at one table; wins are keyed by player name. */
export interface Series {
  liberal: number;
  fascist: number;
  wins: Record<string, number>;
}

export interface RoomView {
  code: string;
  stage: 'lobby' | 'game';
  host: number;
  you: number;
  seats: SeatInfo[];
  game: GameView | null;
  events: GameEvent[];
  series: Series;
  options: TableOptions;
  deadlineMs: number | null; // ms remaining on the phase timer
}

export type ServerMsg =
  | { t: 'welcome'; code: string; token: string; seat: number }
  | { t: 'room'; room: RoomView }
  | { t: 'chat'; seat: number; name: string; text: string }
  | { t: 'error'; msg: string; fatal?: boolean }
  | { t: 'left' }
  | { t: 'pong' };

// ---------- validation ----------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSeat = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10;
const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 3;

/** Strips control/format characters and collapses whitespace. */
export function cleanText(raw: string, max: number): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const name = cleanText(raw, MAX_NAME);
  return name.length >= 1 ? name : null;
}

export function validCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return code.length === 4 && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

function parseAction(a: unknown): ActionBody | null {
  if (!isObj(a) || typeof a.type !== 'string') return null;
  switch (a.type) {
    case 'ack':
    case 'proposeVeto':
    case 'peekDone':
      return { type: a.type };
    case 'nominate':
    case 'investigate':
    case 'specialElect':
    case 'execute':
      return isSeat(a.target) ? { type: a.type, target: a.target } : null;
    case 'vote':
      return typeof a.ja === 'boolean' ? { type: 'vote', ja: a.ja } : null;
    case 'presDiscard':
    case 'chancEnact':
      return isIndex(a.index) ? { type: a.type, index: a.index } : null;
    case 'vetoResponse':
      return typeof a.accept === 'boolean' ? { type: 'vetoResponse', accept: a.accept } : null;
    default:
      return null;
  }
}

/** Parses and validates a raw client frame. Returns a freshly built message (never the input object). */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'create': {
      const name = cleanName(m.name);
      return name ? { t: 'create', name } : null;
    }
    case 'quickStart': {
      const name = cleanName(m.name);
      return name ? { t: 'quickStart', name } : null;
    }
    case 'join': {
      const name = cleanName(m.name);
      const code = validCode(m.code);
      return name && code ? { t: 'join', code, name } : null;
    }
    case 'resume': {
      const code = validCode(m.code);
      const token = typeof m.token === 'string' && /^[a-f0-9]{32}$/.test(m.token) ? m.token : null;
      return code && token ? { t: 'resume', code, token } : null;
    }
    case 'act': {
      const a = parseAction(m.a);
      return a ? { t: 'act', a } : null;
    }
    case 'chat': {
      if (typeof m.text !== 'string' || m.text.length > MAX_CHAT * 2) return null;
      const text = cleanText(m.text, MAX_CHAT);
      return text ? { t: 'chat', text } : null;
    }
    case 'setOptions': {
      const pace = PACES.find((p) => p === m.pace);
      const botLevel = BOT_LEVELS.find((l) => l === m.botLevel);
      if ((m.pace !== undefined && !pace) || (m.botLevel !== undefined && !botLevel)) return null;
      if (!pace && !botLevel) return null;
      return { t: 'setOptions', ...(pace && { pace }), ...(botLevel && { botLevel }) };
    }
    case 'addBot':
    case 'removeBot':
    case 'start':
    case 'leave':
    case 'rematch':
    case 'playAgain':
    case 'redeal':
    case 'ping':
      return { t: m.t };
    default:
      return null;
  }
}
