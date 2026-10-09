// One room: lobby, game loop, bots, timers, disconnect takeover, chat.
// Bots are chat participants, not just actors: they answer when a player talks to them, hold grudges,
// get angry at being ignored, and start accusations of their own. See bottalk.ts for how a line is written.
import { randomBytes, randomInt } from 'node:crypto';
import { RuleError, createGame, legalActions, pendingActors, reduce } from '../shared/engine';
import type { RoomView, SeatInfo, ServerMsg } from '../shared/protocol';
import { MAX_PLAYERS, MIN_PLAYERS } from '../shared/rules';
import type { ActionBody, GameEvent, GameState, Phase } from '../shared/types';
import { newMemory, observe, profiles, type Memory } from '../shared/tracker';
import { viewFor } from '../shared/view';
import { heuristicTalk, planTalk, type TalkPlan } from './botchat';
import {
  bump, cool, newMood, readMessage, writeAccusation, writeIgnored, writeIntent, writeReply,
  type ChatLine, type Mood, type Suspicion, type Trigger,
} from './bottalk';
import { askChoice } from './jev';
import { llmEnabled } from './llm';
import { BOT_NAMES, personaFor, type Persona } from './persona';
import { decide, decideNow } from './brain';
import { config } from './config';

export interface Conn {
  id: number;
  send(msg: ServerMsg): void;
  room: Room | null;
  seat: number;
}

interface Seat {
  name: string;
  token: string;
  conn: Conn | null;
  bot: boolean;
  botControl: boolean;
  disconnectedAt: number | null;
  /** Pressed Leave during a game (as opposed to a dropped socket). */
  left: boolean;
}

export const PHASE_SECONDS: Record<Phase, number> = {
  night: 20,
  nominate: 90,
  vote: 60,
  legPresident: 75,
  legChancellor: 75,
  veto: 45,
  peek: 45,
  investigate: 90,
  special: 90,
  execute: 90,
  gameOver: 0,
};

export class Room {
  seats: Seat[] = [];
  stage: 'lobby' | 'game' = 'lobby';
  game: GameState | null = null;
  host = 0;
  lastActivity = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private timerKey = '';
  private deadline: number | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  private closed = false;
  /** Per-seat memory built from that seat's own view (bots read it; it never leaves the server). */
  private memories: Memory[] = [];
  private thinking = new Set<number>();
  private lastBotChat = new Map<number, number>();
  /** What the table has said recently. Bots read it so their replies follow the conversation. */
  private transcript: ChatLine[] = [];
  /** Per-seat feelings: anger, grudges, who owes them an answer. Rebuilt on restore (nobody stays angry across a restart). */
  private moods = new Map<number, Mood>();
  private personas = new Map<number, Persona>();
  /** Drives impatience and unprompted accusations while nothing else is happening. */
  private moodTimer: NodeJS.Timeout | null = null;
  /** Written lines this game, against config.llm.maxCallsPerGame. */
  private written = 0;
  botStats = { jev: 0, heuristic: 0, trivial: 0, talk: { jev: 0, heuristic: 0 }, written: 0 };

  constructor(public code: string, private onEmpty: (room: Room) => void) {}

  // ---------- membership ----------

  humanCount(): number {
    return this.seats.filter((s) => !s.bot).length;
  }

  connectedHumans(): number {
    return this.seats.filter((s) => !s.bot && s.conn).length;
  }

  join(conn: Conn, name: string): string | null {
    if (this.stage !== 'lobby') return 'That game has already started.';
    if (this.seats.length >= MAX_PLAYERS) return 'That room is full.';
    let unique = name;
    for (let i = 2; this.seats.some((s) => s.name === unique); i++) unique = `${name.slice(0, 13)} ${i}`;
    const token = randomBytes(16).toString('hex');
    this.seats.push({ name: unique, token, conn, bot: false, botControl: false, disconnectedAt: null, left: false });
    this.attach(conn, this.seats.length - 1);
    if (this.humanCount() === 1) this.host = this.seats.length - 1;
    conn.send({ t: 'welcome', code: this.code, token, seat: conn.seat });
    this.broadcast();
    return null;
  }

  resume(conn: Conn, token: string): string | null {
    const seat = this.seats.findIndex((s) => s.token === token && !s.bot);
    if (seat < 0) return 'Your seat is gone.';
    const s = this.seats[seat];
    if (s.conn && s.conn !== conn) {
      s.conn.send({ t: 'error', msg: 'You connected from somewhere else.', fatal: true });
      s.conn.room = null;
    }
    this.clearDisconnectTimer(s.token);
    s.botControl = false;
    s.left = false;
    s.disconnectedAt = null;
    this.attach(conn, seat);
    conn.send({ t: 'welcome', code: this.code, token, seat });
    this.broadcast();
    this.schedule();
    return null;
  }

  private attach(conn: Conn, seat: number) {
    this.seats[seat].conn = conn;
    conn.room = this;
    conn.seat = seat;
    this.lastActivity = Date.now();
  }

  /** Socket closed without an explicit leave. */
  disconnected(conn: Conn) {
    const seat = this.seatOf(conn);
    if (seat < 0) return;
    const s = this.seats[seat];
    s.conn = null;
    s.disconnectedAt = Date.now();
    this.startGrace(s);
    this.broadcast();
    this.checkEmpty();
  }

  /** After the grace period an absent human loses their lobby seat, or a bot plays for them in a game. */
  private startGrace(s: Seat) {
    this.clearDisconnectTimer(s.token);
    const timer = setTimeout(() => {
      try {
        this.disconnectTimers.delete(s.token);
        if (s.conn) return;
        if (this.stage === 'lobby') {
          this.removeSeat(this.seats.indexOf(s));
          this.checkEmpty();
          if (this.closed) return;
        } else {
          s.botControl = true;
          this.schedule();
        }
        this.broadcast();
      } catch (e) {
        console.error('[room] grace timer failed', e);
      }
    }, config.reconnectGraceMs);
    this.disconnectTimers.set(s.token, timer);
  }

  leave(conn: Conn) {
    const seat = this.seatOf(conn);
    if (seat < 0) return;
    conn.room = null;
    conn.send({ t: 'left' });
    if (this.stage === 'lobby') {
      this.removeSeat(seat);
    } else {
      const s = this.seats[seat];
      s.conn = null;
      s.disconnectedAt = Date.now();
      s.botControl = true;
      s.left = true;
      this.schedule();
    }
    this.broadcast();
    this.checkEmpty();
  }

  private removeSeat(seat: number) {
    if (seat < 0) return;
    const [removed] = this.seats.splice(seat, 1);
    this.clearDisconnectTimer(removed.token);
    this.seats.forEach((s, i) => s.conn && (s.conn.seat = i));
    if (this.host === seat) {
      this.host = Math.max(0, this.seats.findIndex((s) => !s.bot));
    } else if (this.host > seat) {
      this.host -= 1;
    }
  }

  private clearDisconnectTimer(token: string) {
    const t = this.disconnectTimers.get(token);
    if (t) clearTimeout(t);
    this.disconnectTimers.delete(token);
  }

  private seatOf(conn: Conn): number {
    return this.seats.findIndex((s) => s.conn === conn);
  }

  private checkEmpty() {
    if (this.connectedHumans() === 0 && this.stage === 'lobby' && this.humanCount() === 0) this.close();
    else if (this.stage !== 'lobby' && this.humanCount() > 0 && this.seats.every((s) => s.bot || s.left)) this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.stopMoodTimer();
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    for (const s of this.seats) if (s.conn) s.conn.room = null;
    this.onEmpty(this);
  }

  /** Server shutdown: stop timers but keep the room (it stays in the database and is restored on start). */
  shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.stopMoodTimer();
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
  }

  // ---------- persistence ----------

  /** Called after every change so the room can be saved. */
  onChange: ((room: Room) => void) | null = null;

  snapshot(): RoomSnapshot {
    return {
      v: 1,
      code: this.code,
      stage: this.stage,
      host: this.host,
      seats: this.seats.map((s) => ({ name: s.name, token: s.token, bot: s.bot, botControl: s.botControl })),
      game: this.game,
      memories: this.memories.map((m) => ({ ...m, known: [...m.known.entries()] })),
    };
  }

  /** Rebuilds a room after a restart. Humans are treated as just disconnected: they get the usual grace period. */
  static restore(snap: RoomSnapshot, onEmpty: (room: Room) => void): Room {
    if (snap?.v !== 1 || typeof snap.code !== 'string' || !Array.isArray(snap.seats)) throw new Error('bad room snapshot');
    if (snap.stage !== 'lobby' && snap.stage !== 'game') throw new Error('bad room snapshot');
    if (snap.game && snap.seats.length !== snap.game.players.length) throw new Error('bad room snapshot');
    if (!Number.isInteger(snap.host) || snap.host < 0 || snap.host >= snap.seats.length) throw new Error('bad room snapshot');
    const room = new Room(snap.code, onEmpty);
    room.stage = snap.stage;
    room.host = snap.host;
    room.game = snap.game;
    room.memories = (snap.memories ?? []).map((m) => ({ ...m, known: new Map(m.known) }) as Memory);
    if (room.game && room.memories.length !== room.game.players.length) {
      room.memories = room.game.players.map((p) => newMemory(p.seat, room.game!.players.length));
    }
    const now = Date.now();
    room.seats = snap.seats.map((s) => ({ ...s, conn: null, disconnectedAt: s.bot ? null : now, left: false }));
    for (const s of room.seats) if (!s.bot) room.startGrace(s);
    room.lastActivity = now;
    room.resetTimerIfNeeded(); // fresh phase timer
    if (room.stage === 'game') room.startMoodTimer();
    return room;
  }

  // ---------- host controls ----------

  private isHost(conn: Conn) {
    return this.seatOf(conn) === this.host;
  }

  addBot(conn: Conn): string | null {
    if (!this.isHost(conn)) return 'Only the host can add bots.';
    if (this.stage !== 'lobby') return 'The game has started.';
    if (this.seats.length >= MAX_PLAYERS) return 'The table is full.';
    const used = new Set(this.seats.map((s) => s.name));
    const pool = BOT_NAMES[config.llm.lang] ?? BOT_NAMES.en;
    const name = pool.find((n) => !used.has(n)) ?? `Bot ${this.seats.length}`;
    this.seats.push({ name, token: randomBytes(16).toString('hex'), conn: null, bot: true, botControl: true, disconnectedAt: null, left: false });
    this.broadcast();
    return null;
  }

  removeBot(conn: Conn): string | null {
    if (!this.isHost(conn)) return 'Only the host can remove bots.';
    if (this.stage !== 'lobby') return 'The game has started.';
    for (let i = this.seats.length - 1; i >= 0; i--) {
      if (this.seats[i].bot) {
        this.removeSeat(i);
        this.broadcast();
        return null;
      }
    }
    return 'There are no bots to remove.';
  }

  start(conn: Conn): string | null {
    if (!this.isHost(conn)) return 'Only the host can start.';
    if (this.stage !== 'lobby') return 'Already started.';
    if (this.seats.length < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players (add bots to fill seats).`;
    this.stage = 'game';
    this.game = createGame(this.seats.map((s) => s.name), randomInt(0, 2 ** 32));
    this.memories = this.seats.map((_, i) => newMemory(i, this.seats.length));
    this.thinking.clear();
    this.resetTalk();
    this.startMoodTimer();
    this.after([{ k: 'nightStart' }]);
    return null;
  }

  rematch(conn: Conn): string | null {
    if (!this.isHost(conn)) return 'Only the host can start a new game.';
    if (this.game?.phase !== 'gameOver') return 'The game is not over.';
    this.stage = 'lobby';
    this.game = null;
    // Drop seats of humans who are gone; keep everyone else.
    for (let i = this.seats.length - 1; i >= 0; i--) {
      const s = this.seats[i];
      if (!s.bot && !s.conn) this.removeSeat(i);
      else s.botControl = s.bot;
    }
    this.clearTimer();
    this.stopMoodTimer();
    this.resetTalk();
    this.broadcast();
    return null;
  }

  // ---------- game ----------

  act(conn: Conn, body: ActionBody): string | null {
    if (this.stage !== 'game' || !this.game) return 'No game in progress.';
    const seat = this.seatOf(conn);
    if (seat < 0) return 'You are not seated.';
    return this.apply(seat, body);
  }

  private apply(seat: number, body: ActionBody): string | null {
    if (!this.game) return 'No game.';
    try {
      const res = reduce(this.game, { ...body, seat } as never);
      this.game = res.state;
      this.lastActivity = Date.now();
      this.after(res.events);
      return null;
    } catch (err) {
      if (err instanceof RuleError) return 'That move is not allowed right now.';
      throw err;
    }
  }

  private after(events: GameEvent[]) {
    const g = this.game;
    if (g) {
      this.memories.forEach((m, seat) => observe(m, viewFor(g, seat), events));
      this.feel(events);
      this.botTalk(events);
    }
    this.resetTimerIfNeeded();
    this.broadcast(events);
    this.schedule();
  }

  private resetTimerIfNeeded() {
    const g = this.game;
    if (!g) return;
    const key = `${g.phase}:${g.round}:${g.vetoRefused}`;
    if (key === this.timerKey) return;
    this.timerKey = key;
    this.clearTimer();
    if (g.phase === 'gameOver') return;
    const ms = PHASE_SECONDS[g.phase] * 1000 * config.timerScale;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      try {
        this.onTimeout(key);
      } catch (e) {
        console.error('[room] onTimeout failed', e);
      }
    }, ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  /** Phase timer expired: make a move for everyone still owing one. */
  private onTimeout(key: string) {
    if (!this.game || key !== this.timerKey) return;
    this.timerKey = '';
    if (this.connectedHumans() === 0) {
      this.resetTimerIfNeeded();
      return;
    }
    for (const seat of pendingActors(this.game)) {
      if (!this.game || `${this.game.phase}:${this.game.round}:${this.game.vetoRefused}` !== key) break;
      this.botMove(seat);
    }
    this.resetTimerIfNeeded();
  }

  private botMove(seat: number) {
    const g = this.game;
    if (!g) return;
    const legal = legalActions(g, seat);
    if (legal.length === 0) return;
    let body = legal[0];
    try {
      body = decideNow(viewFor(g, seat), legal, this.memories[seat], (s) => this.seatName(s));
    } catch (e) {
      console.error('[bot] decideNow failed', e);
    }
    this.botStats.heuristic++;
    const err = this.tryApply(seat, body);
    if (!err) return;
    console.error('[bot] illegal move', seat, body, err);
    if (body === legal[0]) return; // the phase timer will retry
    const err2 = this.tryApply(seat, legal[0]);
    if (err2) console.error('[bot] fallback move also illegal', seat, legal[0], err2);
  }

  /** apply() for bot moves: an unexpected exception becomes an error string instead of escaping. */
  private tryApply(seat: number, body: ActionBody): string | null {
    try {
      return this.apply(seat, body);
    } catch (e) {
      return String(e);
    }
  }

  /** Schedules the next bot move if a bot-driven seat owes an action. */
  schedule() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const g = this.game;
    // Nobody watching: pause bots until a human comes back.
    if (!g || g.phase === 'gameOver' || this.closed || this.connectedHumans() === 0) return;
    const botSeats = pendingActors(g).filter((seat) => this.seats[seat]?.botControl && !this.thinking.has(seat));
    if (botSeats.length === 0) return;
    const quick = g.phase === 'vote' || g.phase === 'night';
    const base = config.botDelayMs * (quick ? 0.4 : 1);
    const delay = base + Math.random() * base * 0.8;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      try {
        const now = this.game;
        if (!now) return;
        const seat = pendingActors(now).find((s) => this.seats[s]?.botControl && !this.thinking.has(s));
        if (seat !== undefined) this.think(seat).catch((e) => console.error('[bot] think failed', e));
        this.schedule(); // let other bots (e.g. voters) start thinking too
      } catch (e) {
        console.error('[room] botTimer failed', e);
      }
    }, delay);
  }

  /** Asks the brain (Jev, falling back to the built-in strategy) and plays the move if still relevant. */
  private async think(seat: number) {
    const g = this.game;
    if (!g) return;
    const key = `${g.phase}:${g.round}:${g.vetoRefused}`;
    const legal = legalActions(g, seat);
    if (!legal.length) return;
    this.thinking.add(seat);
    let action: ActionBody;
    try {
      const r = await decide(viewFor(g, seat), legal, this.memories[seat], (s) => this.seatName(s));
      action = r.action;
      this.botStats[r.source]++;
    } catch (e) {
      console.error('[bot] brain error', e);
      action = legal[0];
    } finally {
      this.thinking.delete(seat);
    }
    const now = this.game;
    // The world may have moved on while we were thinking (timer, reconnect, game over).
    if (this.closed || !now || `${now.phase}:${now.round}:${now.vetoRefused}` !== key || !pendingActors(now).includes(seat) || !this.seats[seat]?.botControl) {
      this.schedule();
      return;
    }
    if (this.tryApply(seat, action)) this.botMove(seat); // stale or illegal: fall back to an immediate legal move
  }

  private seatName(seat: number): string {
    return this.seats[seat]?.name ?? `Seat ${seat + 1}`;
  }

  // ---------- table talk ----------

  private resetTalk() {
    this.transcript = [];
    this.moods.clear();
    this.personas.clear();
    this.lastBotChat.clear();
    this.written = 0;
  }

  private personaOf(seat: number): Persona {
    let p = this.personas.get(seat);
    if (!p) {
      p = personaFor(this.seatName(seat), config.llm.lang);
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
    return llmEnabled() && this.written < config.llm.maxCallsPerGame;
  }

  private talkContext(seat: number) {
    return {
      view: viewFor(this.game!, seat),
      memory: this.memories[seat],
      persona: this.personaOf(seat),
      mood: this.moodOf(seat),
      name: (x: number) => this.seatName(x),
      transcript: this.transcript,
      lang: config.llm.lang,
    };
  }

  /** Seats that are permanent bots and still allowed to speak. */
  private talkingBots(): number[] {
    const g = this.game;
    return this.seats
      .map((_, seat) => seat)
      .filter((seat) => this.seats[seat].bot && (!g || g.phase === 'gameOver' || g.players[seat]?.alive));
  }

  /** Posts a line to everyone and records it so bots can follow the conversation. */
  private postChat(seat: number, text: string) {
    if (this.closed || !text) return;
    const name = this.seats[seat]?.name ?? '?';
    const msg: ServerMsg = { t: 'chat', seat, name, text };
    for (const x of this.seats) x.conn?.send(msg);
    this.remember({ seat, name, text, at: Date.now() });
  }

  private remember(line: ChatLine) {
    this.transcript.push(line);
    if (this.transcript.length > 24) this.transcript.shift();
  }

  /** Permanent bots chat about what just happened (from their own point of view). */
  private botTalk(events: GameEvent[]) {
    const g = this.game;
    if (!g) return;
    this.seats.forEach((s, seat) => {
      if (!s.bot || (!g.players[seat]?.alive && g.phase !== 'gameOver')) return;
      const now = Date.now();
      if (now - (this.lastBotChat.get(seat) ?? 0) < 6000) return;
      const view = viewFor(g, seat);
      for (const e of events) {
        const plan = planTalk(e, view, this.memories[seat], (x) => this.seatName(x), Math.random);
        if (!plan) continue;
        const prev = this.lastBotChat.get(seat);
        this.lastBotChat.set(seat, now);
        // The throttle holds while speak runs, but only a posted line keeps it.
        const release = () => (prev === undefined ? this.lastBotChat.delete(seat) : this.lastBotChat.set(seat, prev));
        this.speak(seat, plan)
          .then((said) => said || release())
          .catch((e) => {
            release();
            console.error('[bot] speak failed', e);
          });
        break;
      }
    });
  }

  /**
   * Posts a bot's line. Jev (or the built-in strategy) picks the intent; the text model writes it in the
   * bot's own voice, falling back to the scripted template line whenever it cannot.
   * Resolves to whether a line was posted.
   */
  private async speak(seat: number, plan: TalkPlan): Promise<boolean> {
    const started = Date.now();
    let line: string | null;
    let intent: string | null = null;
    if (plan.kind === 'line') {
      line = plan.line;
      intent = plan.line;
    } else {
      const criteria = Object.fromEntries(Object.entries(plan.options).map(([k, o]) => [k, o.description]));
      const answer = await askChoice(plan.state, plan.instructions, criteria, fetch, 2);
      const key = answer && answer.choice in plan.options ? answer.choice : heuristicTalk(plan.options, Math.random);
      this.botStats.talk[answer ? 'jev' : 'heuristic']++;
      const chosen = plan.options[key];
      line = chosen.line;
      intent = chosen.description;
    }
    if (!line) return false; // chose to stay quiet
    if (this.game && this.canWrite()) {
      this.written++;
      this.botStats.written++;
      try {
        line = await writeIntent(this.talkContext(seat), plan.situation, intent ?? line, line);
      } catch (e) {
        console.error('[bot] writeIntent failed', e);
      }
    }
    const delay = Math.max(0, 900 + Math.random() * 1800 - (Date.now() - started));
    this.sayLater(seat, line, delay);
    return true;
  }

  /** Types a line after a human-looking pause, re-checking that the room is still alive. */
  private sayLater(seat: number, text: string, delay: number) {
    setTimeout(() => {
      try {
        if (this.closed) return;
        this.postChat(seat, text);
        const mood = this.moodOf(seat);
        mood.lastSpokeAt = Date.now();
        cool(mood);
        this.noteAwaiting(seat, text);
      } catch (e) {
        console.error('[room] chat failed', e);
      }
    }, delay);
  }

  /** If a bot named someone in its line, it now expects an answer from them. */
  private noteAwaiting(seat: number, text: string) {
    const target = this.seats.findIndex((s, i) => i !== seat && new RegExp(`\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    if (target >= 0) this.moodOf(seat).awaiting = { seat: target, at: Date.now() };
  }

  // ---------- chat ----------

  chat(conn: Conn, text: string): string | null {
    const seat = this.seatOf(conn);
    if (seat < 0) return 'You are not seated.';
    if (this.game && this.stage === 'game' && !this.game.players[seat].alive && this.game.phase !== 'gameOver') {
      return 'The dead tell no tales.';
    }
    const msg: ServerMsg = { t: 'chat', seat, name: this.seats[seat].name, text };
    for (const s of this.seats) s.conn?.send(msg);
    this.remember({ seat, name: this.seats[seat].name, text, at: Date.now() });
    this.lastActivity = Date.now();
    this.botsReactTo(seat, text);
    return null;
  }

  /**
   * Bots read what was just said and decide whether to answer. Being named, accused or insulted almost
   * always gets a reply; general table talk only pulls in the chatty ones. At most two bots answer any one
   * message, so a table of six does not turn into a wall of text.
   */
  private botsReactTo(from: number, text: string) {
    // Only during a game: a bot writes from its own GameView, and in the lobby there is none to write from.
    if (this.closed || !this.game || this.stage !== 'game' || this.connectedHumans() === 0) return;
    const now = Date.now();
    const candidates: { seat: number; trigger: Trigger; chance: number }[] = [];
    for (const seat of this.talkingBots()) {
      if (seat === from) continue;
      const mood = this.moodOf(seat);
      // Someone answering clears the "nobody listens to me" clock.
      if (mood.awaiting?.seat === from) mood.awaiting = null;
      const r = readMessage(text, this.seatName(seat), this.personaOf(seat), mood);
      // Taking offence happens either way: with no text model a bot cannot answer, but it still remembers.
      if (r.trigger === 'insulted') bump(mood, from, 0.2 + this.personaOf(seat).temper * 0.3);
      else if (r.trigger === 'accused') bump(mood, from, 0.15);
      if (now - (this.lastBotChat.get(seat) ?? 0) < 4000) continue;
      candidates.push({ seat, trigger: r.trigger, chance: r.chance });
    }
    // Without a model nobody can reply, and claiming the chat throttle here would only mute the
    // event-driven template lines in botTalk().
    if (!this.canWrite()) return;
    const replying = candidates
      .filter((c) => Math.random() < c.chance)
      .sort((a, b) => b.chance - a.chance)
      .slice(0, 2);
    for (const [i, c] of replying.entries()) {
      this.lastBotChat.set(c.seat, now);
      this.reply(c.seat, from, text, c.trigger, i).catch((e) => console.error('[bot] reply failed', e));
    }
  }

  private async reply(seat: number, from: number, text: string, trigger: Trigger, order: number) {
    this.written++;
    this.botStats.written++;
    const started = Date.now();
    const line = await writeReply(this.talkContext(seat), this.seatName(from), text, trigger);
    if (!line) {
      this.lastBotChat.delete(seat);
      return;
    }
    // Reading, then typing: the second bot to pile on waits a little longer.
    const think = 600 + order * 1400 + text.length * 15 + Math.random() * 1200;
    this.sayLater(seat, line, Math.max(0, think - (Date.now() - started)));
  }

  // ---------- impatience and unprompted accusations ----------

  /**
   * While the table is quiet, bots still have an inner life: they get annoyed at whoever ignored them and
   * they start accusations nobody asked for. This is what makes them feel like players rather than a
   * commentary track on the game events.
   */
  private startMoodTimer() {
    this.stopMoodTimer();
    if (this.closed) return;
    this.moodTimer = setInterval(() => {
      try {
        this.moodTick();
      } catch (e) {
        console.error('[room] moodTick failed', e);
      }
    }, 9000);
    this.moodTimer.unref?.();
  }

  private stopMoodTimer() {
    if (this.moodTimer) clearInterval(this.moodTimer);
    this.moodTimer = null;
  }

  private moodTick() {
    const g = this.game;
    if (this.closed || !g || g.phase === 'gameOver' || this.connectedHumans() === 0 || !this.canWrite()) return;
    const now = Date.now();
    for (const seat of this.talkingBots()) {
      const mood = this.moodOf(seat);
      if (now - (this.lastBotChat.get(seat) ?? 0) < 20000) continue;
      if (this.complainIgnored(seat, mood, now)) continue;
      this.maybeAccuse(seat, mood, now);
    }
  }

  /** Nobody answered a bot that asked a direct question. Real players take that badly. */
  private complainIgnored(seat: number, mood: Mood, now: number): boolean {
    const waiting = mood.awaiting;
    if (!waiting || now - waiting.at < 25000) return false;
    // Did they say anything at all since?
    if (this.transcript.some((l) => l.seat === waiting.seat && l.at > waiting.at)) {
      mood.awaiting = null;
      return false;
    }
    mood.awaiting = null;
    if (now - mood.complainedAt < 60000) return false;
    const persona = this.personaOf(seat);
    if (Math.random() > 0.35 + persona.temper * 0.5) return false;
    mood.complainedAt = now;
    bump(mood, waiting.seat, 0.3 + persona.temper * 0.2);
    this.lastBotChat.set(seat, now);
    this.written++;
    this.botStats.written++;
    writeIgnored(this.talkContext(seat), waiting.seat)
      .then((line) => (line ? this.sayLater(seat, line, 400 + Math.random() * 900) : this.lastBotChat.delete(seat)))
      .catch((e) => {
        this.lastBotChat.delete(seat);
        console.error('[bot] writeIgnored failed', e);
      });
    return true;
  }

  /**
   * Says something about another player with nobody having prompted it. Most of what gets said at a real
   * table is this: a passing read ("ese está raro"), a dig at whoever has gone silent, and now and then a
   * full accusation when the evidence is actually there.
   */
  private maybeAccuse(seat: number, mood: Mood, now: number) {
    const g = this.game;
    if (!g) return;
    const view = viewFor(g, seat);
    const fascist = view.yourRole !== 'liberal';
    const prof = profiles(this.memories[seat], view);
    const speakable = prof
      .filter((p) => p.seat !== seat && g.players[p.seat].alive)
      // Never hand your own team in: a Fascist knows who its teammates are.
      .filter((p) => !(fascist && view.players[p.seat].role && view.players[p.seat].role !== 'liberal'));
    if (!speakable.length) return;
    const heatOf = (s: number) => (prof[s].suspicion ?? 0) + (mood.grudge.get(s) ?? 0) * 2;
    const target = speakable.sort((a, b) => heatOf(b.seat) - heatOf(a.seat))[0];
    const heat = heatOf(target.seat);
    const persona = this.personaOf(seat);

    // Who has said nothing for a while? Being the quiet one is suspicious in itself.
    const silent = speakable
      .filter((p) => !this.transcript.some((l) => l.seat === p.seat && now - l.at < 120000))
      .sort((a, b) => heatOf(b.seat) - heatOf(a.seat))[0];

    let kind: Suspicion;
    let target_ = target.seat;
    if (heat >= 1.8) kind = 'accusation';
    else if (silent && this.transcript.length >= 4 && Math.random() < 0.4) {
      kind = 'quiet';
      target_ = silent.seat;
    } else if (heat >= 0.7) kind = 'read';
    else return;

    const chance = kind === 'accusation' ? 0.12 + persona.paranoia * 0.3 : 0.08 + persona.chattiness * 0.22;
    if (Math.random() > chance) return;
    this.lastBotChat.set(seat, now);
    this.written++;
    this.botStats.written++;
    writeAccusation(this.talkContext(seat), target_, prof[target_].proof, kind)
      .then((line) => (line ? this.sayLater(seat, line, 500 + Math.random() * 1500) : this.lastBotChat.delete(seat)))
      .catch((e) => {
        this.lastBotChat.delete(seat);
        console.error('[bot] writeAccusation failed', e);
      });
  }

  /** Game events that put a bot in a bad mood: being voted down, being shot, being investigated. */
  private feel(events: GameEvent[]) {
    const g = this.game;
    if (!g) return;
    for (const e of events) {
      if (e.k === 'votes') {
        const nominee = g.nominee ?? g.chancellor;
        if (nominee === null || e.passed || !this.seats[nominee]?.bot) continue;
        // The table rejected this bot. It remembers every NEIN.
        const mood = this.moodOf(nominee);
        e.votes.forEach((v, s) => v === false && s !== nominee && bump(mood, s, 0.18));
      } else if (e.k === 'executed' && this.seats[e.target]?.bot) {
        bump(this.moodOf(e.target), e.by, 0.9);
      } else if (e.k === 'investigated' && this.seats[e.target]?.bot) {
        bump(this.moodOf(e.target), e.by, 0.1);
      }
    }
  }

  // ---------- views ----------

  seatInfo(): SeatInfo[] {
    return this.seats.map((s, seat) => ({
      seat,
      name: s.name,
      bot: s.bot,
      botControlled: s.botControl && !s.bot,
      connected: s.bot || s.conn !== null,
    }));
  }

  viewFor(seat: number, events: GameEvent[] = []): RoomView {
    return {
      code: this.code,
      stage: this.stage,
      host: this.host,
      you: seat,
      seats: this.seatInfo(),
      game: this.game ? viewFor(this.game, seat) : null,
      events,
      deadlineMs: this.deadline === null ? null : Math.max(0, this.deadline - Date.now()),
    };
  }

  broadcast(events: GameEvent[] = []) {
    this.seats.forEach((s, seat) => s.conn?.send({ t: 'room', room: this.viewFor(seat, events) }));
    // Every state change ends in a broadcast, so this is the one place that persists the room.
    if (!this.closed) this.onChange?.(this);
  }
}

type StoredMemory = Omit<Memory, 'known'> & { known: [number, 'liberal' | 'fascist'][] };

export interface RoomSnapshot {
  v: 1;
  code: string;
  stage: 'lobby' | 'game';
  host: number;
  seats: { name: string; token: string; bot: boolean; botControl: boolean }[];
  game: GameState | null;
  memories: StoredMemory[];
}
