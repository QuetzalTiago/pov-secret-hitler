// Table talk: bots are chat participants, not just actors. They answer when a player talks to them, hold grudges,
// get angry at being ignored, and start accusations of their own. See bottalk.ts for how a line is written.
import type { ServerMsg } from '../shared/protocol';
import type { GameEvent, GameState } from '../shared/types';
import { profiles, type Memory } from '../shared/tracker';
import { viewFor } from '../shared/view';
import { LinePicker } from './botlines';
import { heuristicTalk, mustTalk, planTalk, talkReads, type TalkPlan } from './botchat';
import {
  cool, newMood, offend, readMessage, relation, warmTo,
  writeAccusation, writeIgnored, writeIntent, writeReconsider, writeReply,
  type ChatLine, type Mood, type Suspicion, type Trigger,
} from './bottalk';
import { QUESTION } from './lexicon';
import { askChoice } from './jev';
import { llmEnabled } from './llm';
import { personaFor, type Persona } from './persona';
import { config, type BotLang } from './config';

/** What table talk needs from its room. Functions, so it always reads the room's current state. */
export interface TalkHost {
  game(): GameState | null;
  stage(): 'lobby' | 'game';
  seats(): readonly { name: string; bot: boolean }[];
  seatName(seat: number): string;
  memories(): Memory[];
  closed(): boolean;
  connectedHumans(): number;
  /** The bots' language at this table. */
  lang(): BotLang;
  /** Sends a message to everyone seated. */
  post(msg: ServerMsg): void;
  /** Room counters the talk code bumps (Room.botStats). */
  stats: { talk: { jev: number; heuristic: number }; written: number };
  /** A queued bot line was just posted or dropped; the room releases bot moves held for it. */
  onLinePosted(): void;
}

export class TableTalk {
  constructor(private host: TalkHost) {}

  /** One per room, kept across games, so offline lines don't repeat until a pool is used up. */
  private lines = new LinePicker();
  private lastBotChat = new Map<number, number>();
  /** What the table has said recently. Bots read it so their replies follow the conversation. */
  private transcript: ChatLine[] = [];
  /** Per-seat feelings: anger, grudges, who owes them an answer. Rebuilt on restore (nobody stays angry across a restart). */
  private moods = new Map<number, Mood>();
  private personas = new Map<number, Persona>();
  /** Drives impatience and unprompted accusations while nothing else is happening. */
  private moodTimer: NodeJS.Timeout | null = null;
  /** When any bot last started an unprompted line (complaint, reconsideration, accusation). Bots take turns, not a chorus. */
  private unpromptedAt = 0;
  /** Seat -> when a bot last called it out for being quiet or ignoring a question. Not repeated until that seat speaks again. */
  private silenceCalledOut = new Map<number, number>();
  /** When the last "you've gone quiet" dig (about anyone) was made. */
  private quietDigAt = 0;
  /** Written lines this game, against config.llm.maxCallsPerGame. */
  private written = 0;
  /** Written lines over the room's whole life (all deals, not reset by resetTalk), against config.llm.maxCallsPerRoom. */
  writtenTotal = 0;

  // ---------- table talk ----------

  /** Whether a line from this seat is still waiting its turn. */
  hasQueued(seat: number): boolean {
    return this.chatQueue.some((c) => c.seat === seat);
  }

  forgetPersona(seat: number) {
    this.personas.delete(seat);
  }

  /** Cancels every timer; the room is closing. */
  stop() {
    if (this.chatTimer) clearTimeout(this.chatTimer);
    for (const t of this.talkTimers) clearTimeout(t);
    this.stopMoodTimer();
  }

  /** A human said something: show it to the table, let people read it, and let the bots react. */
  heard(seat: number, text: string) {
    const msg: ServerMsg = { t: 'chat', seat, name: this.host.seats()[seat].name, text };
    this.host.post(msg);
    this.remember({ seat, name: this.host.seats()[seat].name, text, at: Date.now() });
    this.chatFreeAt = Math.max(this.chatFreeAt, Date.now() + TableTalk.readMs(text));
    this.botsReactTo(seat, text);
  }

  /** Everything queued, scheduled or being written belongs to the old generation and is never posted. */
  resetTalk() {
    this.talkGen++;
    for (const item of this.chatQueue.splice(0)) item.done();
    if (this.chatTimer) clearTimeout(this.chatTimer);
    this.chatTimer = null;
    for (const t of this.talkTimers) clearTimeout(t);
    this.talkTimers.clear();
    this.transcript = [];
    this.moods.clear();
    this.personas.clear();
    this.lastBotChat.clear();
    this.unpromptedAt = 0;
    this.silenceCalledOut.clear();
    this.quietDigAt = 0;
    this.written = 0;
  }

  private personaOf(seat: number): Persona {
    let p = this.personas.get(seat);
    if (!p) {
      p = personaFor(this.host.seatName(seat), this.host.lang());
      this.personas.set(seat, p);
    }
    return p;
  }

  private moodOf(seat: number): Mood {
    let m = this.moods.get(seat);
    if (!m) {
      m = newMood();
      this.moods.set(seat, m);
    }
    return m;
  }

  /** A bot may write a generated line only while the per-game budget lasts. */
  private canWrite(): boolean {
    return llmEnabled() && this.written < config.llm.maxCallsPerGame && this.writtenTotal < config.llm.maxCallsPerRoom;
  }

  /** Counted when a request is really sent, not when a bot merely decides to write. */
  private noteSent = () => {
    this.written++;
    this.writtenTotal++;
    this.host.stats.written++;
  };

  private talkContext(seat: number) {
    return {
      view: viewFor(this.host.game()!, seat),
      memory: this.host.memories()[seat],
      persona: this.personaOf(seat),
      mood: this.moodOf(seat),
      name: (x: number) => this.host.seatName(x),
      transcript: this.transcript,
      lang: this.host.lang(),
      onSent: this.noteSent,
    };
  }

  /** Seats that are permanent bots and still allowed to speak. */
  private talkingBots(): number[] {
    const g = this.host.game();
    return this.host.seats()
      .map((_, seat) => seat)
      .filter((seat) => this.host.seats()[seat].bot && (!g || g.phase === 'gameOver' || g.players[seat]?.alive));
  }

  /** Posts a line to everyone and records it so bots can follow the conversation. */
  private postChat(seat: number, text: string) {
    if (this.host.closed() || !text) return;
    const name = this.host.seats()[seat]?.name ?? '?';
    const msg: ServerMsg = { t: 'chat', seat, name, text };
    this.host.post(msg);
    this.remember({ seat, name, text, at: Date.now() });
    this.chatFreeAt = Date.now() + TableTalk.readMs(text);
  }

  private remember(line: ChatLine) {
    this.transcript.push(line);
    if (this.transcript.length > 24) this.transcript.shift();
  }

  /** Permanent bots chat about what just happened (from their own point of view). */
  botTalk(events: GameEvent[]) {
    const g = this.host.game();
    if (!g) return;
    // At most two bots comment on any one batch of events, so the table does not all pipe up at once.
    let spoke = 0;
    this.host.seats().forEach((s, seat) => {
      if (!s.bot || (!g.players[seat]?.alive && g.phase !== 'gameOver')) return;
      const now = Date.now();
      const view = viewFor(g, seat);
      const planFor = (e: GameEvent) =>
        planTalk(e, view, this.host.memories()[seat], (x) => this.host.seatName(x), Math.random, this.host.lang(), this.lines);
      // A must plan (an investigation result) ignores the throttle and the cap, and does not count toward the cap.
      const mustEvent = events.find((e) => mustTalk(e, seat));
      let plan = mustEvent ? planFor(mustEvent) : null;
      if (!plan) {
        if (spoke >= 2 || now - (this.lastBotChat.get(seat) ?? 0) < 15000) return;
        for (const e of events) if ((plan = planFor(e))) break;
        if (!plan) return;
        spoke++;
      }
      const prev = this.lastBotChat.get(seat);
      this.lastBotChat.set(seat, now);
      // The throttle holds while speak runs, but only a posted line keeps it.
      const gen = this.talkGen;
      const release = () => {
        if (gen !== this.talkGen) return;
        if (prev === undefined) this.lastBotChat.delete(seat);
        else this.lastBotChat.set(seat, prev);
      };
      this.speak(seat, plan)
        .then((said) => said || release())
        .catch((e) => {
          release();
          console.error('[bot] speak failed', e);
        });
    });
  }

  /**
   * Posts a bot's line. Jev (or the built-in strategy) picks the intent; the text model writes it in the
   * bot's own voice, falling back to the scripted template line whenever it cannot.
   * Resolves to whether a line was posted.
   */
  private async speak(seat: number, plan: TalkPlan): Promise<boolean> {
    const started = Date.now();
    const gen = this.talkGen;
    let line: string | null;
    let intent: string | null = null;
    if (plan.kind === 'line') {
      line = plan.line;
      intent = plan.line;
    } else {
      const criteria = Object.fromEntries(Object.entries(plan.options).map(([k, o]) => [k, o.description]));
      const answer = await askChoice(plan.state, plan.instructions, criteria, fetch, 2);
      if (gen !== this.talkGen) return false;
      const key = answer && answer.choice in plan.options ? answer.choice : heuristicTalk(plan.options, Math.random);
      this.host.stats.talk[answer ? 'jev' : 'heuristic']++;
      const chosen = plan.options[key];
      line = chosen.line;
      intent = chosen.description;
    }
    if (!line) return false; // chose to stay quiet
    if (this.host.game() && this.canWrite()) {
      try {
        line = await writeIntent(this.talkContext(seat), plan.situation, intent ?? line, line);
      } catch (e) {
        console.error('[bot] writeIntent failed', e);
      }
      if (gen !== this.talkGen) return false;
    }
    const delay = Math.max(0, 900 + Math.random() * 1800 - (Date.now() - started));
    this.sayLater(seat, line, delay, gen, plan.must);
    return true;
  }

  // ---------- one bot at a time ----------

  /** Bot lines waiting their turn. Bots never talk over each other; humans are never delayed. */
  private chatQueue: { seat: number; text: string; queuedAt: number; gen: number; must?: boolean; done: () => void }[] = [];
  private chatTimer: NodeJS.Timeout | null = null;
  /** Seats shift when a redeal drops players, so lines are tagged with the deal they were meant for. */
  private talkGen = 0;
  private talkTimers = new Set<NodeJS.Timeout>();
  /** No bot line is posted before this time, so people can finish reading the last line (bot or human). */
  private chatFreeAt = 0;

  /** How long people need to read a line before the next bot speaks. */
  static readMs(text: string): number {
    return Math.min(7000, Math.max(2500, 1800 + text.length * 50)) * config.chatPacing;
  }

  /**
   * Queues a bot line. It is posted once the chat is free, and the bot's mood settles a little for having
   * said it. Resolves when the line is posted (or dropped), so a reply can wait for the one before it.
   */
  private say(seat: number, text: string, gen = this.talkGen, must = false): Promise<void> {
    return new Promise((done) => {
      if (this.host.closed() || !text || gen !== this.talkGen) return done();
      // A backlog would only deliver stale lines late; skip it rather than flood the chat.
      if (this.chatQueue.length >= 4 && !must) return done();
      this.chatQueue.push({ seat, text, queuedAt: Date.now(), gen, must, done });
      this.pumpChat();
    });
  }

  private pumpChat() {
    if (this.chatTimer || this.host.closed() || !this.chatQueue.length) return;
    this.chatTimer = setTimeout(() => {
      this.chatTimer = null;
      const item = this.chatQueue.shift();
      if (!item) return;
      try {
        const g = this.host.game();
        // Too old to still make sense, or the bot has died since: drop it.
        const stale = !item.must && Date.now() - item.queuedAt > 25_000;
        const dead = !!g && g.phase !== 'gameOver' && !g.players[item.seat]?.alive;
        if (!this.host.closed() && !stale && !dead && item.gen === this.talkGen) {
          this.postChat(item.seat, item.text);
          const mood = this.moodOf(item.seat);
          mood.lastSpokeAt = Date.now();
          cool(mood);
          this.noteAwaiting(item.seat, item.text);
        }
      } catch (e) {
        console.error('[room] chat failed', e);
      } finally {
        item.done();
        this.host.onLinePosted();
        this.pumpChat();
      }
    }, Math.max(0, this.chatFreeAt - Date.now()));
  }

  /** Types a line after a human-looking pause, re-checking that the room is still alive. */
  private sayLater(seat: number, text: string, delay: number, gen = this.talkGen, must = false) {
    const t = setTimeout(() => {
      this.talkTimers.delete(t);
      void this.say(seat, text, gen, must);
    }, delay);
    this.talkTimers.add(t);
  }

  /**
   * A bot only expects an answer when it actually ASKED something of ONE person. Merely naming someone
   * ("ojo Nacho, te van a hacer la cama") is a warning, not a question, and getting no reply to it is
   * perfectly normal - sulking about that is what made the bots insufferable.
   */
  private noteAwaiting(seat: number, text: string) {
    const mood = this.moodOf(seat);
    if (!QUESTION.test(text.toLowerCase())) {
      mood.awaiting = null;
      return;
    }
    const named = this.host.seats()
      .map((s, i) => ({ i, hit: i !== seat && new RegExp(`\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text) }))
      .filter((x) => x.hit);
    // Exactly one person was asked. A question thrown at the whole table is nobody's to answer.
    mood.awaiting = named.length === 1 ? { seat: named[0].i, at: Date.now() } : null;
  }

  /**
   * Bots read what was just said and decide whether to answer. Being named, accused or insulted almost
   * always gets a reply; general table talk only pulls in the chatty ones. At most two bots answer any one
   * message, so a table of six does not turn into a wall of text.
   */
  private botsReactTo(from: number, text: string) {
    // Only during a game: a bot writes from its own GameView, and in the lobby there is none to write from.
    if (this.host.closed() || !this.host.game() || this.host.stage() !== 'game' || this.host.connectedHumans() === 0) return;
    const now = Date.now();
    const candidates: { seat: number; trigger: Trigger; chance: number }[] = [];
    for (const seat of this.talkingBots()) {
      if (seat === from) continue;
      const mood = this.moodOf(seat);
      // Someone answering clears the "nobody listens to me" clock.
      if (mood.awaiting?.seat === from) mood.awaiting = null;
      const r = readMessage(text, this.host.seatName(seat), this.personaOf(seat), mood, from);
      // Taking offence happens either way: with no text model a bot cannot answer, but it still remembers.
      // Note this only touches the relation with `from` - being insulted by one player is no reason to turn
      // on the rest of the table.
      if (r.trigger === 'insulted') offend(mood, from, 0.18 + this.personaOf(seat).temper * 0.22);
      else if (r.trigger === 'accused') offend(mood, from, 0.12);
      else if (r.trigger === 'support') warmTo(mood, from, 0.3);
      if (now - (this.lastBotChat.get(seat) ?? 0) < 10000) continue;
      candidates.push({ seat, trigger: r.trigger, chance: r.chance });
    }
    // Without a model nobody can reply, and claiming the chat throttle here would only mute the
    // event-driven template lines in botTalk().
    if (!this.canWrite()) return;
    const replying = candidates
      .filter((c) => Math.random() < c.chance)
      .sort((a, b) => b.chance - a.chance)
      .slice(0, 1);
    for (const c of replying) this.lastBotChat.set(c.seat, now);
    // One at a time, not in parallel: a bot that writes while the other's line is still in flight cannot
    // see it in the transcript, and the two end up saying the same thing in different words.
    void this.replyInTurn(replying, from, text);
  }

  private async replyInTurn(replying: { seat: number; trigger: Trigger }[], from: number, text: string) {
    const gen = this.talkGen;
    for (const c of replying) {
      try {
        await this.reply(c.seat, from, text, c.trigger, gen);
      } catch (e) {
        console.error('[bot] reply failed', e);
      }
      if (this.host.closed() || gen !== this.talkGen) return;
    }
  }

  private async reply(seat: number, from: number, text: string, trigger: Trigger, gen: number) {
    const started = Date.now();
    const line = await writeReply(this.talkContext(seat), from, text, trigger);
    if (gen !== this.talkGen) return;
    if (!line) {
      this.lastBotChat.delete(seat);
      return;
    }
    // Reading the message, then typing the answer.
    const think = 600 + text.length * 15 + Math.random() * 1200;
    await new Promise((r) => setTimeout(r, Math.max(0, think - (Date.now() - started))));
    if (gen !== this.talkGen) return;
    await this.say(seat, line, gen); // the next replier writes only after seeing this line
  }

  // ---------- impatience and unprompted accusations ----------

  /**
   * While the table is quiet, bots still have an inner life: they get annoyed at whoever ignored them and
   * they start accusations nobody asked for. This is what makes them feel like players rather than a
   * commentary track on the game events.
   */
  startMoodTimer() {
    this.stopMoodTimer();
    if (this.host.closed()) return;
    this.moodTimer = setInterval(() => {
      try {
        this.moodTick();
      } catch (e) {
        console.error('[room] moodTick failed', e);
      }
    }, 9000);
    this.moodTimer.unref?.();
  }

  stopMoodTimer() {
    if (this.moodTimer) clearInterval(this.moodTimer);
    this.moodTimer = null;
  }

  private moodTick() {
    const g = this.host.game();
    if (this.host.closed() || !g || g.phase === 'gameOver' || this.host.connectedHumans() === 0 || !this.canWrite()) return;
    const now = Date.now();
    if (now - this.unpromptedAt < 20000) return;
    // Random order so it is not always the same bot who gets the first word.
    const bots = this.talkingBots();
    for (let i = bots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bots[i], bots[j]] = [bots[j], bots[i]];
    }
    for (const seat of bots) {
      const mood = this.moodOf(seat);
      if (now - (this.lastBotChat.get(seat) ?? 0) < 45000) continue;
      if (this.complainIgnored(seat, mood, now) || this.maybeReconsider(seat, mood, now) || this.maybeAccuse(seat, mood, now)) {
        this.unpromptedAt = now;
        break;
      }
    }
  }

  /** Whether a bot already called this seat out and the seat has not said anything since. */
  private calledOutSinceSpoke(seat: number): boolean {
    const lastSpoke = this.transcript.reduce((t, l) => (l.seat === seat ? Math.max(t, l.at) : t), 0);
    return (this.silenceCalledOut.get(seat) ?? -Infinity) >= lastSpoke;
  }

  /** Nobody answered a bot that asked a direct question. Real players take that badly. */
  private complainIgnored(seat: number, mood: Mood, now: number): boolean {
    const waiting = mood.awaiting;
    // A long fuse on purpose: people take a while to answer, and a bot that nags after 25s is exhausting.
    if (!waiting || now - waiting.at < 50000) return false;
    // Did they say anything at all since?
    if (this.transcript.some((l) => l.seat === waiting.seat && l.at > waiting.at)) {
      mood.awaiting = null;
      return false;
    }
    mood.awaiting = null;
    if (this.calledOutSinceSpoke(waiting.seat)) return false; // someone already complained about them
    if (now - mood.complainedAt < 60000) return false;
    const persona = this.personaOf(seat);
    if (Math.random() > 0.2 + persona.temper * 0.35) return false;
    mood.complainedAt = now;
    this.silenceCalledOut.set(waiting.seat, now);
    offend(mood, waiting.seat, 0.12 + persona.temper * 0.12);
    this.lastBotChat.set(seat, now);
    const gen = this.talkGen;
    writeIgnored(this.talkContext(seat), waiting.seat)
      .then((line) => {
        if (gen !== this.talkGen) return;
        if (line) this.sayLater(seat, line, 400 + Math.random() * 900, gen);
        else this.lastBotChat.delete(seat);
      })
      .catch((e) => {
        if (gen === this.talkGen) this.lastBotChat.delete(seat);
        console.error('[bot] writeIgnored failed', e);
      });
    return true;
  }

  /**
   * Somebody this bot had written off has since behaved like a Liberal. Saying so out loud is the whole
   * difference between a player and a scoreboard: getting stuck with one Fascist policy should not brand
   * you for the rest of the game, and a bot that never updates is the least believable thing at the table.
   * Each player is reconsidered at most once, so it does not become a tic.
   */
  private maybeReconsider(seat: number, mood: Mood, now: number): boolean {
    const g = this.host.game();
    if (!g) return false;
    const view = viewFor(g, seat);
    const m = this.host.memories()[seat];
    const { sus } = talkReads(m, view);
    for (const p of view.players) {
      if (p.seat === seat || !p.alive || mood.recanted.has(p.seat)) continue;
      const rel = relation(mood, p.seat);
      const govs = m.governments.filter((x) => x.president === p.seat || x.chancellor === p.seat);
      const last = govs.at(-1);
      if (!last || last.result !== 'L' || view.round - last.round > 2) continue; // nothing new in their favour
      const wasDown = rel.rapport < -0.15 || sus[p.seat] >= 1.2 || govs.some((x) => x.result === 'F');
      if (!wasDown) continue;
      if (Math.random() > 0.45) continue;
      mood.recanted.add(p.seat);
      warmTo(mood, p.seat, 0.45);
      this.lastBotChat.set(seat, now);
      const why = `en la ronda ${last.round} puso una liberal ${last.chancellor === p.seat ? 'como canciller' : 'como presidente'}`;
      const gen = this.talkGen;
      writeReconsider(this.talkContext(seat), p.seat, why)
        .then((line) => {
          if (gen !== this.talkGen) return;
          if (line) this.sayLater(seat, line, 500 + Math.random() * 1200, gen);
          else this.lastBotChat.delete(seat);
        })
        .catch((e) => {
          if (gen === this.talkGen) this.lastBotChat.delete(seat);
          console.error('[bot] writeReconsider failed', e);
        });
      return true;
    }
    return false;
  }

  /**
   * Says something about another player with nobody having prompted it. Most of what gets said at a real
   * table is this: a passing read ("ese está raro"), a dig at whoever has gone silent, and now and then a
   * full accusation when the evidence is actually there.
   */
  private maybeAccuse(seat: number, mood: Mood, now: number): boolean {
    const g = this.host.game();
    if (!g) return false;
    const view = viewFor(g, seat);
    const fascist = view.yourRole !== 'liberal';
    const prof = profiles(this.host.memories()[seat], view);
    const { sus } = talkReads(this.host.memories()[seat], view);
    const speakable = prof
      .filter((p) => p.seat !== seat && g.players[p.seat].alive)
      // Never hand your own team in: a Fascist knows who its teammates are.
      .filter((p) => !(fascist && view.players[p.seat].role && view.players[p.seat].role !== 'liberal'));
    if (!speakable.length) return false;
    // An ally gets the benefit of the doubt; someone you are at odds with gets less of it.
    const heatOf = (s: number) => sus[s] - relation(mood, s).rapport * 1.5 + relation(mood, s).heat;
    const target = speakable.sort((a, b) => heatOf(b.seat) - heatOf(a.seat))[0];
    const heat = heatOf(target.seat);
    const persona = this.personaOf(seat);

    // Who has said nothing for a while? Being the quiet one is suspicious in itself.
    const silent = speakable
      .filter((p) => !this.transcript.some((l) => l.seat === p.seat && now - l.at < 120000))
      // One dig per silence: not again until they have spoken, and never two in a row from the table.
      .filter((p) => !this.calledOutSinceSpoke(p.seat) && now - this.quietDigAt >= 180000)
      .sort((a, b) => heatOf(b.seat) - heatOf(a.seat))[0];

    let kind: Suspicion;
    let target_ = target.seat;
    if (heat >= 1.8) kind = 'accusation';
    else if (silent && this.transcript.length >= 4 && Math.random() < 0.4) {
      kind = 'quiet';
      target_ = silent.seat;
    } else if (heat >= 0.7) kind = 'read';
    else return false;

    const chance = kind === 'accusation' ? 0.06 + persona.paranoia * 0.15 : 0.04 + persona.chattiness * 0.11;
    if (Math.random() > chance) return false;
    if (kind === 'quiet') {
      this.silenceCalledOut.set(target_, now);
      this.quietDigAt = now;
    }
    this.lastBotChat.set(seat, now);
    const gen = this.talkGen;
    writeAccusation(this.talkContext(seat), target_, prof[target_].proof, kind)
      .then((line) => {
        if (gen !== this.talkGen) return;
        if (line) this.sayLater(seat, line, 500 + Math.random() * 1500, gen);
        else this.lastBotChat.delete(seat);
      })
      .catch((e) => {
        if (gen === this.talkGen) this.lastBotChat.delete(seat);
        console.error('[bot] writeAccusation failed', e);
      });
    return true;
  }

  /**
   * What the game itself does to a bot's relationships. Both directions matter: a table that rejects you
   * earns a grudge, but someone who votes with you or governs well with you earns trust, and without that
   * second half a bot can never make an ally.
   */
  feel(events: GameEvent[]) {
    const g = this.host.game();
    if (!g) return;
    for (const e of events) {
      if (e.k === 'votes') {
        const nominee = g.nominee ?? g.chancellor;
        for (const seat of this.talkingBots()) {
          const mood = this.moodOf(seat);
          const mine = e.votes[seat];
          if (mine === null || mine === undefined) continue;
          e.votes.forEach((v, s) => {
            if (s === seat || v === null) return;
            // Voting the same way, over and over, is how players find each other.
            if (v === mine) warmTo(mood, s, 0.05);
          });
          // Being personally rejected stings, but a single NEIN is not a declaration of war.
          if (seat === nominee && !e.passed) {
            e.votes.forEach((v, s) => v === false && s !== seat && offend(mood, s, 0.1));
          }
        }
      } else if (e.k === 'enacted' && !e.chaos) {
        const gov = g.chancellor !== null ? { pres: g.president, chanc: g.chancellor } : null;
        if (!gov) continue;
        // A government that produced a Liberal policy makes both of them look good to everyone watching.
        for (const seat of this.talkingBots()) {
          if (seat === gov.pres || seat === gov.chanc) continue;
          const mood = this.moodOf(seat);
          if (e.policy === 'L') {
            warmTo(mood, gov.pres, 0.12);
            warmTo(mood, gov.chanc, 0.15);
          }
        }
      } else if (e.k === 'executed' && this.host.seats()[e.target]?.bot) {
        offend(this.moodOf(e.target), e.by, 0.9);
      } else if (e.k === 'investigated' && this.host.seats()[e.target]?.bot) {
        offend(this.moodOf(e.target), e.by, 0.08);
      }
    }
  }
}
