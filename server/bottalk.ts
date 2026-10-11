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
import { ACCUSE, INSULT, QUESTION, REGISTER, SETUP, SUPPORT } from './lexicon';
import type { Persona } from './persona';

export interface ChatLine {
  seat: number;
  name: string;
  text: string;
  at: number;
}

/**
 * How a bot stands with ONE other player. Relationships are per-person on purpose: being called a garca by
 * Bruno is no reason to bite Moni's head off, and a bot that cannot tell its friends from its enemies is
 * not playing the social game at all.
 */
export interface Relation {
  /** -1..1. Below zero is a grudge; above zero they are becoming allies. Moves slowly, fades slowly. */
  rapport: number;
  /** 0..1. How angry this bot is AT THIS PERSON right now. Spikes on an attack, cools off quickly. */
  heat: number;
}

/** What a bot is feeling. Lives in the room, decays over time, and colours every line it writes. */
export interface Mood {
  /** Per-seat standing. Everything social hangs off this. */
  relations: Map<number, Relation>;
  /** It asked someone a direct question and is waiting for an answer. */
  awaiting: { seat: number; at: number } | null;
  /** It already complained about being ignored; don't let it whine every tick. */
  complainedAt: number;
  lastSpokeAt: number;
  /** Players it has already publicly changed its mind about, so it does not keep announcing it. */
  recanted: Set<number>;
}

export function newMood(): Mood {
  return { relations: new Map(), awaiting: null, complainedAt: 0, lastSpokeAt: 0, recanted: new Set() };
}

export function relation(mood: Mood, seat: number): Relation {
  let r = mood.relations.get(seat);
  if (!r) {
    r = { rapport: 0, heat: 0 };
    mood.relations.set(seat, r);
  }
  return r;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Someone attacked this bot. Heat spikes with that person only, and the relationship sours. */
export function offend(mood: Mood, seat: number, amount: number): void {
  const r = relation(mood, seat);
  r.heat = clamp(r.heat + amount, 0, 1);
  r.rapport = clamp(r.rapport - amount * 0.5, -1, 1);
}

/** Someone backed this bot up, voted with it, or governed well with it. This is how allies are made. */
export function warmTo(mood: Mood, seat: number, amount: number): void {
  const r = relation(mood, seat);
  r.rapport = clamp(r.rapport + amount, -1, 1);
  r.heat = clamp(r.heat - amount * 0.6, 0, 1);
}

/** Heat burns off fast, rapport drifts back to neutral slowly. Called whenever the bot speaks. */
export function cool(mood: Mood, factor = 0.7): void {
  for (const [seat, r] of mood.relations) {
    r.heat *= factor;
    r.rapport *= 0.985;
    if (r.heat < 0.03 && Math.abs(r.rapport) < 0.05) mood.relations.delete(seat);
  }
}

/** The angriest this bot currently is with anyone: only used to decide how readily it jumps into chatter. */
export function tension(mood: Mood): number {
  let worst = 0;
  for (const r of mood.relations.values()) worst = Math.max(worst, r.heat);
  return worst;
}

// ---------- reading the room ----------

/** Lowercase, strip accents, so "Gastón" matches "gaston" and "FACHO" matches "facho". */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}


export type Trigger = 'insulted' | 'accused' | 'setup' | 'support' | 'addressed' | 'general';

export interface Reaction {
  trigger: Trigger;
  /** 0..1 chance this bot answers at all. */
  chance: number;
}

/**
 * How a bot reads one message someone else sent. Name matching is deliberately loose (first name,
 * accent-insensitive) because that is how people actually type at a table.
 */
export function readMessage(text: string, botName: string, persona: Persona, mood: Mood, from = -1): Reaction {
  const t = fold(text);
  const named = new RegExp(`(^|[^a-z0-9])${fold(botName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t);
  const insult = INSULT.test(t);
  const accuse = ACCUSE.test(t);
  const setup = SETUP.test(t);
  const support = SUPPORT.test(t);
  const rel = from >= 0 ? relation(mood, from) : { rapport: 0, heat: 0 };
  // Eagerness rises with how worked up this bot already is WITH THIS PERSON, not with the table at large.
  const heat = rel.heat * 0.25;

  if (named && insult) return { trigger: 'insulted', chance: 0.97 };
  // Checked before a plain accusation: "te van a hacer la cama" warns this bot rather than accusing it.
  if (named && setup) return { trigger: 'setup', chance: 0.95 };
  if (named && accuse) return { trigger: 'accused', chance: 0.95 };
  // Somebody offering to back it up is worth answering: this is how a bot picks up an ally.
  if (named && support) return { trigger: 'support', chance: 0.8 };
  if (named && QUESTION.test(t)) return { trigger: 'addressed', chance: 0.9 };
  if (named) return { trigger: 'addressed', chance: 0.75 + heat };
  // Not named: an insult, an accusation or a cry of "they set me up" still pulls in the loud ones.
  if (insult) return { trigger: 'insulted', chance: 0.1 + persona.temper * 0.15 + heat };
  if (setup) return { trigger: 'setup', chance: 0.15 + persona.paranoia * 0.2 + heat };
  if (accuse) return { trigger: 'accused', chance: 0.08 + persona.paranoia * 0.2 + heat };
  return { trigger: 'general', chance: persona.chattiness * 0.05 + heat * 0.25 };
}

// ---------- prompts ----------

/** Which tone tier applies toward one player. */
export function toneFor(mood: Mood, seat: number | null): 'calm' | 'edgy' | 'hot' {
  const h = seat === null ? tension(mood) * 0.5 : relation(mood, seat).heat;
  return h > 0.55 ? 'hot' : h > 0.25 ? 'edgy' : 'calm';
}

/** Where this bot stands with everyone: who it is angry at, who it is warming to, and who owes it nothing. */
function standing(mood: Mood, lang: BotLang, name: (s: number) => string, toward: number | null): string {
  const es = lang === 'es-AR';
  const bits: string[] = [];
  if (toward !== null) {
    const r = relation(mood, toward);
    const who = name(toward);
    if (r.heat > 0.55) bits.push(es ? `Con ${who} estás caliente de verdad.` : `You are genuinely angry at ${who}.`);
    else if (r.heat > 0.25) bits.push(es ? `${who} te tiene picado.` : `${who} is getting on your nerves.`);
    else if (r.rapport > 0.3) bits.push(es ? `A ${who} lo venís bancando, juega derecho con vos.` : `You have been backing ${who}; they play straight with you.`);
    else bits.push(es ? `Con ${who} no tenés ningún problema.` : `You have no problem with ${who}.`);
  }
  const allies = [...mood.relations.entries()].filter(([, r]) => r.rapport > 0.3).sort((a, b) => b[1].rapport - a[1].rapport);
  const enemies = [...mood.relations.entries()].filter(([, r]) => r.rapport < -0.3 || r.heat > 0.5).sort((a, b) => a[1].rapport - b[1].rapport);
  if (allies.length) {
    const who = allies.slice(0, 2).map(([s]) => name(s)).join(es ? ' y ' : ' and ');
    bits.push(es ? `Te llevás bien con ${who}.` : `You get on well with ${who}.`);
  }
  if (enemies.length) {
    const who = enemies.slice(0, 2).map(([s]) => name(s)).join(es ? ' y ' : ' and ');
    bits.push(es ? `Estás enganchado con ${who}.` : `You are at odds with ${who}.`);
  }
  if (!allies.length) {
    bits.push(es ? 'Todavía no tenés a nadie de tu lado: te conviene encontrar con quién aliarte.' : 'Nobody is on your side yet: you could use an ally.');
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

/** `toward` is the player this line is aimed at, which is what decides how hard the bot comes out. */
function systemPrompt(ctx: TalkContext, me: string, toward: number | null): string {
  const L = REGISTER[ctx.lang] ?? REGISTER.en;
  const es = ctx.lang === 'es-AR';
  const head = es
    ? `Sos ${me}, un jugador de Secret Hitler sentado en una mesa con otros jugadores. Tu personalidad: ${ctx.persona.style}`
    : `You are ${me}, a player in a game of Secret Hitler sitting at a table with other players. Your personality: ${ctx.persona.style}`;
  return [
    head,
    L.voice,
    config.llm.profanity ? L.tone[toneFor(ctx.mood, toward)] : L.clean,
    L.idioms,
    (es ? 'Reglas:' : 'Rules:') + '\n- ' + L.rules.join('\n- '),
  ].join('\n\n');
}

/** Everything this seat is allowed to know, as compact JSON plus the recent chat. */
/**
 * A leaner state than the decision layer's. `buildState` spells out every player's full record twice over,
 * which is right when Jev is weighing a move but costs ~1700 prompt tokens here - enough to push a chat
 * reply past its timeout. The trend lines below say the same thing in prose, so this keeps only the facts
 * they do not cover. Built from the same `view` and `memory`, so it can still never carry a secret.
 */
function talkState(ctx: TalkContext, prof: ReturnType<typeof profiles>) {
  const full = buildState(ctx.view, ctx.memory, prof, ctx.name);
  return {
    you: full.you,
    board: full.board,
    players: (full.players as { name: string; alive: boolean; knownRole: string; evidence: string[] }[]).map((p) => ({
      name: p.name,
      alive: p.alive,
      knownRole: p.knownRole,
      ...(p.evidence.length ? { evidence: p.evidence } : {}),
    })),
    history: (full.history as string[]).slice(-8),
    myCards: full.myCards,
  };
}

function situationBlock(ctx: TalkContext, situation: string, toward: number | null): string {
  const es = ctx.lang === 'es-AR';
  const prof = profiles(ctx.memory, ctx.view);
  const state = talkState(ctx, prof);
  const chat = ctx.transcript
    .slice(-10)
    .map((l) => `${l.name}: ${l.text}`)
    .join('\n');
  const reads = readsOn(ctx, prof);
  return [
    `${es ? 'ESTADO DE LA PARTIDA (sólo lo que vos sabés)' : 'GAME STATE (only what you know)'}:\n${JSON.stringify(state)}`,
    reads ? `${es ? 'CÓMO VIENE CADA UNO (lo último pesa más que lo viejo)' : 'HOW EACH PLAYER IS TRENDING (recent beats old)'}:\n${reads}` : '',
    chat ? `${es ? 'CHAT RECIENTE' : 'RECENT CHAT'}:\n${chat}` : '',
    `${es ? 'DÓNDE ESTÁS PARADO' : 'WHERE YOU STAND'}: ${standing(ctx.mood, ctx.lang, ctx.name, toward)}`,
    `${es ? 'SITUACIÓN' : 'SITUATION'}: ${situation}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * A short per-player trend line. The raw suspicion score in the game state is cumulative, which anchors the
 * writer on whatever someone did first and never lets it move. This says what each player has done LATELY,
 * and flags the Chancellor who had no choice, so a bot can actually change its mind.
 */
function readsOn(ctx: TalkContext, prof: ReturnType<typeof profiles>): string {
  const es = ctx.lang === 'es-AR';
  const me = ctx.view.you!;
  const round = ctx.view.round;
  const lines: string[] = [];
  for (const p of ctx.view.players) {
    if (p.seat === me || !p.alive) continue;
    const govs = ctx.memory.governments.filter((g) => g.president === p.seat || g.chancellor === p.seat);
    if (!govs.length) {
      lines.push(es ? `${ctx.name(p.seat)}: todavía no estuvo en ningún gobierno, no hay nada en su contra.` : `${ctx.name(p.seat)}: has not been in a government yet; nothing against them.`);
      continue;
    }
    const recent = govs.filter((g) => round - g.round <= 2);
    const bad = recent.filter((g) => g.result === 'F');
    const good = recent.filter((g) => g.result === 'L');
    const last = govs[govs.length - 1];
    const forced = last.result === 'F' && last.chancellor === p.seat;
    const bits: string[] = [];
    if (good.length && !bad.length) bits.push(es ? `viene poniendo liberales (ronda ${good.at(-1)!.round})` : `has been placing Liberals (round ${good.at(-1)!.round})`);
    else if (bad.length && !good.length) bits.push(es ? `quedó pegado con facha en la ronda ${bad.at(-1)!.round}` : `was stuck with a Fascist in round ${bad.at(-1)!.round}`);
    else if (bad.length && good.length) bits.push(es ? 'mezcla de las dos cosas últimamente' : 'a mix of both lately');
    else bits.push(es ? `hace ${round - last.round} rondas que no toca una carta` : `has not touched a card in ${round - last.round} rounds`);
    if (forced) {
      bits.push(es
        ? `ojo: fue CANCILLER, puede no haber tenido opción si ${ctx.name(last.president)} le pasó dos fachas`
        : `note: they were CHANCELLOR and may have had no choice if ${ctx.name(last.president)} handed them two Fascists`);
    }
    lines.push(`${ctx.name(p.seat)}: ${bits.join('; ')}. ${es ? 'Sospecha acumulada' : 'Cumulative suspicion'} ${prof[p.seat].suspicion.toFixed(1)}.`);
  }
  return lines.join('\n');
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

async function compose(ctx: TalkContext, situation: string, task: string, temperature: number, toward: number | null = null): Promise<string | null> {
  const me = ctx.name(ctx.view.you!);
  const raw = await write({
    system: systemPrompt(ctx, me, toward),
    user: `${situationBlock(ctx, situation, toward)}\n\n${task}`,
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
export async function writeReply(ctx: TalkContext, fromSeat: number, text: string, trigger: Trigger): Promise<string | null> {
  const from = ctx.name(fromSeat);
  const es = ctx.lang === 'es-AR';
  const how = es
    ? {
        insulted: `${from} te acaba de insultar. Contestale a la altura, no te dejes pisar.`,
        accused: `${from} te está acusando. Defendete con lo que sabés de la partida y devolvé la sospecha si te sirve.`,
        setup: `${from} está hablando de que a alguien le están haciendo la cama. Fijate bien qué dijo: puede estar avisándote a vos, quejándose de que se la hicieron a él, o acusándote de que se la hiciste vos. Contestá en consecuencia, con lo que sabés de la partida.`,
        support: `${from} te está bancando o te está dando la razón. Agradecelo y devolvé la gentileza si te cierra: un aliado te sirve. Podés proponerle ir juntos en la próxima votación.`,
        addressed: `${from} te habló directamente. Contestale.`,
        general: `${from} dijo eso en la mesa. Metete en la conversación si tenés algo para aportar.`,
      }[trigger]
    : {
        insulted: `${from} just insulted you. Give it back, do not let them walk over you.`,
        accused: `${from} is accusing you. Defend yourself with what you know and turn the suspicion around if it helps.`,
        setup: `${from} is talking about someone being set up to take the blame. Read what they said: they may be warning you, complaining it was done to them, or accusing you of doing it. Answer accordingly, using what you know.`,
        support: `${from} is backing you up or agreeing with you. Acknowledge it and return the favour if it fits: an ally is worth having. You could propose voting together next time.`,
        addressed: `${from} spoke to you directly. Answer them.`,
        general: `${from} said that at the table. Jump in if you have something to add.`,
      }[trigger];
  const task = `${how}\n${es ? `Lo que dijo ${from}` : `What ${from} said`}: "${text}"`;
  return compose(ctx, es ? `${from} te habló en el chat.` : `${from} spoke to you in the chat.`, task, 1.05, fromSeat);
}

/**
 * Walking a suspicion back out loud. A player who gets stuck with one Fascist policy and is branded for the
 * rest of the game is the single most unrealistic thing a bot can do, so when the evidence turns they say so.
 */
export async function writeReconsider(ctx: TalkContext, target: number, why: string): Promise<string | null> {
  const es = ctx.lang === 'es-AR';
  const who = ctx.name(target);
  const task = es
    ? `Venías desconfiando de ${who}, pero cambiaste de idea: ${why}. Decilo en voz alta, sin dramatizar, como quien reconoce que se equivocó. Podés ofrecerle ir juntos de acá en adelante.`
    : `You had been suspicious of ${who}, but you have changed your mind: ${why}. Say so out loud, without making a speech, like someone admitting they got it wrong. You can offer to work together from here.`;
  return compose(ctx, es ? `Te estabas equivocando con ${who}.` : `You were wrong about ${who}.`, task, 1, target);
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
  return compose(ctx, situation, task, 1, target);
}

/** Writes the "you are all ignoring me" line. Real players get offended; so do these. */
export async function writeIgnored(ctx: TalkContext, target: number | null): Promise<string | null> {
  const es = ctx.lang === 'es-AR';
  const who = target === null ? null : ctx.name(target);
  const task = es
    ? `Dijiste algo importante y ${who ? `${who} te ignoró` : 'nadie te dio bola'}. Quejate, estás caliente porque no te escuchan.`
    : `You said something important and ${who ? `${who} ignored you` : 'nobody paid any attention'}. Complain: you are angry at being ignored.`;
  return compose(ctx, es ? 'Te están ignorando en la mesa.' : 'The table is ignoring you.', task, 1.05, target);
}
