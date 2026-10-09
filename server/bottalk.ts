// Turns a bot's situation into the words it types in the chat. Jev (or the built-in strategy) decides the
// INTENT - tell the truth, lie, accuse, stay quiet; this module writes that intent the way the character
// would write it, and reads the room so bots answer when a human talks to them.
//
// Two hard constraints shape everything here:
//  - A bot may only use its own GameView and Memory, so the prompt is built from those alone and can never
//    contain a secret the seat does not hold.
//  - Whatever the model writes is sanitized before it reaches the table: a bot that blurts out its own
//    hidden role would break the game, so those lines are dropped and the scripted line is typed instead.
import { MAX_CHAT, cleanText } from '../shared/protocol';
import { buildState } from '../shared/smartbot';
import { profiles, type Memory } from '../shared/tracker';
import type { GameView } from '../shared/view';
import type { BotLang } from './config';
import { config } from './config';
import { write } from './llm';
import { ACCUSE, INSULT, QUESTION, REGISTER, SETUP } from './lexicon';
import type { Persona } from './persona';

export interface ChatLine {
  seat: number;
  name: string;
  text: string;
  at: number;
}

/** What a bot is feeling. Lives in the room, decays over time, and colours every line it writes. */
export interface Mood {
  /** 0..1 - how worked up this bot is right now. */
  anger: number;
  /** Per-seat resentment, 0..1. Real players remember who screwed them. */
  grudge: Map<number, number>;
  /** It asked someone something and is waiting for an answer. */
  awaiting: { seat: number; at: number } | null;
  /** It already complained about being ignored; don't let it whine every tick. */
  complainedAt: number;
  lastSpokeAt: number;
}

export function newMood(): Mood {
  return { anger: 0, grudge: new Map(), awaiting: null, complainedAt: 0, lastSpokeAt: 0 };
}

export function bump(mood: Mood, seat: number, amount: number): void {
  mood.grudge.set(seat, Math.min(1, (mood.grudge.get(seat) ?? 0) + amount));
  mood.anger = Math.min(1, mood.anger + amount * 0.7);
}

/** Anger fades; grudges fade much slower. Called whenever the bot speaks or a round turns over. */
export function cool(mood: Mood, factor = 0.75): void {
  mood.anger *= factor;
  for (const [seat, g] of mood.grudge) {
    const next = g * 0.95;
    if (next < 0.05) mood.grudge.delete(seat);
    else mood.grudge.set(seat, next);
  }
}

// ---------- reading the room ----------

/** Lowercase, strip accents, so "Gastón" matches "gaston" and "FACHO" matches "facho". */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}


export type Trigger = 'insulted' | 'accused' | 'setup' | 'addressed' | 'general';

export interface Reaction {
  trigger: Trigger;
  /** 0..1 chance this bot answers at all. */
  chance: number;
}

/**
 * How a bot reads one message someone else sent. Name matching is deliberately loose (first name,
 * accent-insensitive) because that is how people actually type at a table.
 */
export function readMessage(text: string, botName: string, persona: Persona, mood: Mood): Reaction {
  const t = fold(text);
  const named = new RegExp(`(^|[^a-z0-9])${fold(botName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t);
  const insult = INSULT.test(t);
  const accuse = ACCUSE.test(t);
  const setup = SETUP.test(t);
  const heat = mood.anger * 0.25;

  if (named && insult) return { trigger: 'insulted', chance: 0.97 };
  // Checked before a plain accusation: "te van a hacer la cama" warns this bot rather than accusing it.
  if (named && setup) return { trigger: 'setup', chance: 0.95 };
  if (named && accuse) return { trigger: 'accused', chance: 0.95 };
  if (named && QUESTION.test(t)) return { trigger: 'addressed', chance: 0.9 };
  if (named) return { trigger: 'addressed', chance: 0.75 + heat };
  // Not named: an insult, an accusation or a cry of "they set me up" still pulls in the loud ones.
  if (insult) return { trigger: 'insulted', chance: 0.2 + persona.temper * 0.3 + heat };
  if (setup) return { trigger: 'setup', chance: 0.3 + persona.paranoia * 0.35 + heat };
  if (accuse) return { trigger: 'accused', chance: 0.15 + persona.paranoia * 0.35 + heat };
  return { trigger: 'general', chance: persona.chattiness * 0.12 + heat * 0.5 };
}

// ---------- prompts ----------

function moodLine(mood: Mood, lang: BotLang, name: (s: number) => string): string {
  const es = lang === 'es-AR';
  const bits: string[] = [];
  const a = mood.anger;
  if (a > 0.66) bits.push(es ? 'Estás REALMENTE caliente, al borde de explotar.' : 'You are REALLY angry, about to explode.');
  else if (a > 0.33) bits.push(es ? 'Estás picado, de mal humor.' : 'You are annoyed and in a bad mood.');
  else if (a > 0.12) bits.push(es ? 'Estás un poco molesto.' : 'You are slightly irritated.');
  else bits.push(es ? 'Estás tranquilo.' : 'You are calm.');
  const worst = [...mood.grudge.entries()].sort((x, y) => y[1] - x[1]).filter(([, g]) => g > 0.25);
  if (worst.length) {
    const who = worst.slice(0, 2).map(([s]) => name(s)).join(es ? ' y ' : ' and ');
    bits.push(es ? `Le tenés bronca a ${who}.` : `You hold a grudge against ${who}.`);
  }
  return bits.join(' ');
}

export interface TalkContext {
  view: GameView;
  memory: Memory;
  persona: Persona;
  mood: Mood;
  name: (seat: number) => string;
  transcript: ChatLine[];
  lang: BotLang;
}

function systemPrompt(ctx: TalkContext, me: string): string {
  const L = REGISTER[ctx.lang] ?? REGISTER.en;
  const es = ctx.lang === 'es-AR';
  const head = es
    ? `Sos ${me}, un jugador de Secret Hitler sentado en una mesa con otros jugadores. Tu personalidad: ${ctx.persona.style}`
    : `You are ${me}, a player in a game of Secret Hitler sitting at a table with other players. Your personality: ${ctx.persona.style}`;
  return [
    head,
    L.voice,
    config.llm.profanity ? L.swearing : L.clean,
    L.idioms,
    (es ? 'Reglas:' : 'Rules:') + '\n- ' + L.rules.join('\n- '),
  ].join('\n\n');
}

/** Everything this seat is allowed to know, as compact JSON plus the recent chat. */
function situationBlock(ctx: TalkContext, situation: string): string {
  const es = ctx.lang === 'es-AR';
  const state = buildState(ctx.view, ctx.memory, profiles(ctx.memory, ctx.view), ctx.name);
  const chat = ctx.transcript
    .slice(-10)
    .map((l) => `${l.name}: ${l.text}`)
    .join('\n');
  return [
    `${es ? 'ESTADO DE LA PARTIDA (sólo lo que vos sabés)' : 'GAME STATE (only what you know)'}:\n${JSON.stringify(state)}`,
    chat ? `${es ? 'CHAT RECIENTE' : 'RECENT CHAT'}:\n${chat}` : '',
    `${es ? 'TU ÁNIMO' : 'YOUR MOOD'}: ${moodLine(ctx.mood, ctx.lang, ctx.name)}`,
    `${es ? 'SITUACIÓN' : 'SITUATION'}: ${situation}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ---------- sanitizing ----------

const SELF_REVEAL = [
  /\bsoy\s+(?:un[ao]?\s+|el\s+|la\s+)?(?:fascista|facho|hitler)\b/i,
  /\bestoy\s+(?:con\s+)?(?:los\s+)?fascistas\b/i,
  /\bi'?m\s+(?:a\s+|the\s+)?(?:fascist|hitler)\b/i,
  /\bi\s+am\s+(?:a\s+|the\s+)?(?:fascist|hitler)\b/i,
];
const NEGATED = /\b(no|nunca|jamas|jamás|not|never|n'?t)\b[^.!?]{0,14}$/i;
const AI_META = /\b(soy\s+(?:una?\s+)?(?:ia|inteligencia artificial|modelo|bot)|como\s+(?:una?\s+)?(?:ia|modelo)|as an ai|language model|i'?m an ai|i am an ai|chatbot)\b/i;

/** True when the line literally gives away the speaker's own hidden role ("soy fascista", not "no soy fascista"). */
export function revealsOwnRole(text: string): boolean {
  for (const re of SELF_REVEAL) {
    const m = re.exec(text);
    if (!m) continue;
    if (NEGATED.test(text.slice(0, m.index))) continue; // "no soy fascista" is a normal claim
    return true;
  }
  return false;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const QUOTES = /^[\s"'`“”‘’]+/;

/**
 * Trims the model's output down to something a player would actually have typed, and refuses anything
 * that breaks the game. Returns null when the line must be thrown away.
 *
 * `names` is every player at the table: models like to write transcripts ("Moni: no me jodas"), sometimes
 * naming a speaker other than themselves, and a real chat line never carries a speaker prefix.
 *
 * `guardRole` drops any literal claim of being a Fascist or Hitler. For the Fascist team that is the line
 * that loses the game; for a Liberal it is a claim no real player ever makes, so it just reads as broken.
 * It is lifted once the game is over and every role is public, where owning up to it is normal table banter.
 */
export function sanitize(raw: string, names: string[], guardRole: boolean): string | null {
  let t = raw.trim();
  t = t.split('\n').find((l) => l.trim().length > 0) ?? ''; // first non-empty line only
  t = t.replace(/\*[^*]*\*/g, ' '); // *narrator asides*
  const prefix = new RegExp(`^\\s*(?:${names.map(escape).join('|')})\\s*[:>-]\\s*`, 'i');
  // Quotes and speaker prefixes nest in either order, so peel until nothing changes.
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(QUOTES, '').replace(prefix, '');
    if (t === before) break;
  }
  t = t.replace(/[\s"'`“”‘’]+$/, '');
  t = cleanText(t, MAX_CHAT);
  if (!t) return null;
  if (AI_META.test(t)) return null;
  if (guardRole && revealsOwnRole(t)) return null;
  return t;
}

// ---------- the two things a bot writes ----------

async function compose(ctx: TalkContext, situation: string, task: string, temperature: number): Promise<string | null> {
  const me = ctx.name(ctx.view.you!);
  const raw = await write({
    system: systemPrompt(ctx, me),
    user: `${situationBlock(ctx, situation)}\n\n${task}`,
    maxTokens: 90,
    temperature,
  });
  if (raw === null) return null;
  return sanitize(raw, ctx.view.players.map((p) => p.name), ctx.view.phase !== 'gameOver');
}

/**
 * Writes the line for an intent the strategy layer already chose (e.g. "claim you drew three Fascists").
 * `fallback` is the scripted template line, returned when the model is unavailable or says nothing usable.
 */
export async function writeIntent(ctx: TalkContext, situation: string, intent: string, fallback: string): Promise<string> {
  const es = ctx.lang === 'es-AR';
  const task = es
    ? `Querés transmitir esto a la mesa: "${intent}". Escribilo con tus palabras, en personaje, como lo tipearías en el chat.`
    : `You want to get this across to the table: "${intent}". Write it in your own words, in character, as you would type it in chat.`;
  return (await compose(ctx, situation, task, 1)) ?? fallback;
}

/** Writes a reply to something a player just said. Returns null when the bot has nothing worth typing. */
export async function writeReply(ctx: TalkContext, from: string, text: string, trigger: Trigger): Promise<string | null> {
  const es = ctx.lang === 'es-AR';
  const how = es
    ? {
        insulted: `${from} te acaba de insultar. Contestale a la altura, no te dejes pisar.`,
        accused: `${from} te está acusando. Defendete con lo que sabés de la partida y devolvé la sospecha si te sirve.`,
        setup: `${from} está hablando de que a alguien le están haciendo la cama. Fijate bien qué dijo: puede estar avisándote a vos, quejándose de que se la hicieron a él, o acusándote de que se la hiciste vos. Contestá en consecuencia, con lo que sabés de la partida.`,
        addressed: `${from} te habló directamente. Contestale.`,
        general: `${from} dijo eso en la mesa. Metete en la conversación si tenés algo para aportar.`,
      }[trigger]
    : {
        insulted: `${from} just insulted you. Give it back, do not let them walk over you.`,
        accused: `${from} is accusing you. Defend yourself with what you know and turn the suspicion around if it helps.`,
        setup: `${from} is talking about someone being set up to take the blame. Read what they said: they may be warning you, complaining it was done to them, or accusing you of doing it. Answer accordingly, using what you know.`,
        addressed: `${from} spoke to you directly. Answer them.`,
        general: `${from} said that at the table. Jump in if you have something to add.`,
      }[trigger];
  const task = `${how}\n${es ? `Lo que dijo ${from}` : `What ${from} said`}: "${text}"`;
  return compose(ctx, es ? `${from} te habló en el chat.` : `${from} spoke to you in the chat.`, task, 1.05);
}

/** How hard a bot comes out with a suspicion. Real tables do both, and mostly the soft one. */
export type Suspicion = 'read' | 'quiet' | 'accusation';

/**
 * Writes something the bot says about another player with nobody having prompted it. Most table talk is
 * this: not a formal accusation, just thinking out loud about who is behaving oddly or who has gone silent.
 */
export async function writeAccusation(ctx: TalkContext, target: number, why: string[], kind: Suspicion = 'accusation'): Promise<string | null> {
  const es = ctx.lang === 'es-AR';
  const who = ctx.name(target);
  const reasons = why.join('; ') || (es ? 'su historial en los gobiernos' : 'their record in governments');
  const task = es
    ? {
        read: `Nadie está hablando de esto, pero a vos ${who} no te cierra. Tirá la lectura al pasar, sin acusar del todo: que está raro, que tiene pinta, que algo no cuadra. Lo que tenés: ${reasons}.`,
        quiet: `${who} hace rato que no abre la boca y eso te da mala espina. Marcalo delante de todos y pedile que diga algo.`,
        accusation: `Nadie lo está diciendo, así que lo decís vos: acusá a ${who} delante de todos. Tus motivos: ${reasons}. Sé concreto, nombrá la ronda o la carta si la tenés.`,
      }[kind]
    : {
        read: `Nobody is talking about this, but ${who} does not add up to you. Float it in passing rather than accusing outright: they are being weird, something does not fit. What you have: ${reasons}.`,
        quiet: `${who} has not said a word in a long time and it bothers you. Call it out and ask them to say something.`,
        accusation: `Nobody is saying it, so you will: accuse ${who} in front of everyone. Your reasons: ${reasons}. Be concrete, name the round or the card if you have it.`,
      }[kind];
  const situation = es
    ? { read: `Algo de ${who} no te cierra.`, quiet: `${who} está demasiado callado.`, accusation: `Sospechás de ${who} y querés que la mesa lo escuche.` }[kind]
    : { read: `Something about ${who} does not add up.`, quiet: `${who} has gone very quiet.`, accusation: `You suspect ${who} and want the table to hear it.` }[kind];
  return compose(ctx, situation, task, 1);
}

/** Writes the "you are all ignoring me" line. Real players get offended; so do these. */
export async function writeIgnored(ctx: TalkContext, target: number | null): Promise<string | null> {
  const es = ctx.lang === 'es-AR';
  const who = target === null ? null : ctx.name(target);
  const task = es
    ? `Dijiste algo importante y ${who ? `${who} te ignoró` : 'nadie te dio bola'}. Quejate, estás caliente porque no te escuchan.`
    : `You said something important and ${who ? `${who} ignored you` : 'nobody paid any attention'}. Complain: you are angry at being ignored.`;
  return compose(ctx, es ? 'Te están ignorando en la mesa.' : 'The table is ignoring you.', task, 1.05);
}
