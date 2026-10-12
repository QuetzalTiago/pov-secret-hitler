// One room: lobby, game loop, bots, timers, disconnect takeover, chat.
import { randomBytes, randomInt } from 'node:crypto';
import { RuleError, createGame, legalActions, pendingActors, reduce } from '../shared/engine';
import { BOT_LEVELS, DEFAULT_OPTIONS, PACES, QUICK_START_SEATS } from '../shared/protocol';
import type { BotLevel, Pace, RoomView, SeatInfo, ServerMsg, Series, TableOptions } from '../shared/protocol';
import { MAX_PLAYERS, MIN_PLAYERS, partyOf } from '../shared/rules';
import type { ActionBody, GameEvent, GameState, Phase } from '../shared/types';
import { newMemory, noteMyAction, observe, type Memory } from '../shared/tracker';
import { viewFor } from '../shared/view';
import { BOT_NAMES, pickBotName, tooSimilar } from './persona';
import { TableTalk } from './tabletalk';
import { decide, decideNow } from './brain';
import { config, type BotLang } from './config';
import { PACE_FACTOR, botTempo, botThinkMs, settleMs } from './pacing';

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
  /** One plan per pending bot seat: when it acts (readyAt), its timer, and its already-running brain call. */
  private botPlans = new Map<number, { key: string; readyAt: number; timer: NodeJS.Timeout | null; held: boolean; decision: Promise<ActionBody | null> }>();
  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  /** Running while no human is connected; ends the room when it fires. */
  private abandonTimer: NodeJS.Timeout | null = null;
  private closed = false;
  /** Running score of games at this table; wins are keyed by player name (seats get re-indexed). */
  series: Series = { liberal: 0, fascist: 0, wins: emptyWins() };
  options: TableOptions = { ...DEFAULT_OPTIONS };
  /** Seat tokens of humans who pressed Play again after the game ended. */
  private ready = new Set<string>();
  /** Per-seat memory built from that seat's own view (bots read it; it never leaves the server). */
  private memories: Memory[] = [];
  botStats = { jev: 0, heuristic: 0, trivial: 0, talk: { jev: 0, heuristic: 0 }, written: 0 };
  /** The bots' side of the chat; it reads this room's state through the host adapter. */
  private readonly talk = new TableTalk({
    game: () => this.game,
    stage: () => this.stage,
    seats: () => this.seats,
    seatName: (s) => this.seatName(s),
    memories: () => this.memories,
    closed: () => this.closed,
    connectedHumans: () => this.connectedHumans(),
    post: (msg) => {
      for (const s of this.seats) s.conn?.send(msg);
    },
    stats: this.botStats,
    lang: () => this.lang,
    onLinePosted: () => this.releaseHeldBots(),
  });

  /** The bots' language at this table: the host's client language when it opened, else config.llm.lang. */
  readonly lang: BotLang;

  constructor(public code: string, private onEmpty: (room: Room) => void, lang: BotLang = config.llm.lang) {
    this.lang = lang;
  }

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
    // A player keeps the name they chose; any bot that is now confusable with it steps aside instead.
    this.renameClashingBots(unique);
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
    this.checkAbandoned();
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
    if (!this.closed) this.checkReady();
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
      // The seat stays during a game, so hand host to someone who can still Deal now / go back to the lobby.
      if (this.host === seat) {
        const next = this.seats.findIndex((x) => !x.bot && x.conn);
        if (next >= 0) this.host = next;
      }
      this.schedule();
    }
    this.broadcast();
    this.checkEmpty();
    if (!this.closed) this.checkReady();
  }

  /** Renames bots whose names are too close to `name`, so nobody at the table can be mixed up. */
  private renameClashingBots(name: string) {
    const pool = BOT_NAMES[this.lang] ?? BOT_NAMES.en;
    for (const s of this.seats) {
      if (!s.bot || !tooSimilar(s.name, name)) continue;
      const taken = this.seats.filter((x) => x !== s).map((x) => x.name).concat(name);
      const next = pickBotName(taken, pool, this.seats.length);
      // The persona is derived from the name, so renaming gives this bot a new character. In the lobby,
      // before anyone has met it, that costs nothing.
      this.talk.forgetPersona(this.seats.indexOf(s));
      s.name = next;
    }
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
    else this.checkAbandoned();
  }

  /**
   * Everyone away: if no human is connected for config.abandonMs (1 minute), the session is ended and deleted.
   * Anyone reconnecting in time cancels it.
   */
  private checkAbandoned() {
    if (this.closed) return;
    if (this.connectedHumans() > 0) {
      if (this.abandonTimer) clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
      return;
    }
    if (this.abandonTimer) return;
    this.abandonTimer = setTimeout(() => {
      this.abandonTimer = null;
      if (!this.closed && this.connectedHumans() === 0) this.close();
    }, config.abandonMs);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.clearBotPlans();
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.talk.stop();
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    for (const s of this.seats) if (s.conn) s.conn.room = null;
    this.onEmpty(this);
  }

  /** Server shutdown: stop timers but keep the room (it stays in the database and is restored on start). */
  shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.clearBotPlans();
    if (this.abandonTimer) clearTimeout(this.abandonTimer);
    this.talk.stop();
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
      series: this.series,
      options: this.options,
      ready: [...this.ready],
      llmCalls: this.talk.writtenTotal,
      lang: this.lang,
    };
  }

  /** Rebuilds a room after a restart. Humans are treated as just disconnected: they get the usual grace period. */
  static restore(snap: RoomSnapshot, onEmpty: (room: Room) => void): Room {
    if (snap?.v !== 1 || typeof snap.code !== 'string' || !Array.isArray(snap.seats)) throw new Error('bad room snapshot');
    if (snap.stage !== 'lobby' && snap.stage !== 'game') throw new Error('bad room snapshot');
    if (snap.stage === 'game' && !snap.game) throw new Error('bad room snapshot');
    if (snap.game && snap.seats.length !== snap.game.players.length) throw new Error('bad room snapshot');
    if (!Number.isInteger(snap.host) || snap.host < 0 || snap.host >= snap.seats.length) throw new Error('bad room snapshot');
    const room = new Room(snap.code, onEmpty, snap.lang === 'en' || snap.lang === 'es-AR' ? snap.lang : config.llm.lang);
    room.stage = snap.stage;
    room.host = snap.host;
    room.game = snap.game;
    room.series = validSeries(snap.series);
    room.options = validOptions(snap.options);
    room.memories = (snap.memories ?? []).map((m) => ({ ...m, known: new Map(m.known) }) as Memory);
    if (room.game && room.memories.length !== room.game.players.length) {
      room.memories = room.game.players.map((p) => newMemory(p.seat, room.game!.players.length));
    }
    const now = Date.now();
    room.seats = snap.seats.map((s) => ({ ...s, conn: null, disconnectedAt: s.bot ? null : now, left: false }));
    for (const s of room.seats) if (!s.bot) room.startGrace(s);
    if (room.game?.phase === 'gameOver' && Array.isArray(snap.ready)) {
      const tokens = new Set(room.seats.filter((s) => !s.bot).map((s) => s.token));
      for (const t of snap.ready) if (typeof t === 'string' && tokens.has(t)) room.ready.add(t);
    }
    room.talk.writtenTotal = Number.isFinite(snap.llmCalls) && snap.llmCalls! >= 0 ? snap.llmCalls! : 0;
    room.lastActivity = now;
    room.resetTimerIfNeeded(); // fresh phase timer
    if (room.stage === 'game') room.talk.startMoodTimer();
    room.checkAbandoned();
    return room;
  }

  // ---------- host controls ----------

  private paceFactor() {
    return PACE_FACTOR[this.options.pace];
  }

  /** Host-only, lobby-only: merges the given table options and tells everyone. */
  setOptions(conn: Conn, opts: { pace?: Pace; botLevel?: BotLevel }): string | null {
    if (!this.isHost(conn)) return 'Only the host can change table options.';
    if (this.stage !== 'lobby') return 'The game has started.';
    if (opts.pace) this.options = { ...this.options, pace: opts.pace };
    if (opts.botLevel) this.options = { ...this.options, botLevel: opts.botLevel };
    this.broadcast();
    return null;
  }

  private isHost(conn: Conn) {
    return this.seatOf(conn) === this.host;
  }

  addBot(conn: Conn): string | null {
    if (!this.isHost(conn)) return 'Only the host can add bots.';
    if (this.stage !== 'lobby') return 'The game has started.';
    if (this.seats.length >= MAX_PLAYERS) return 'The table is full.';
    const pool = BOT_NAMES[this.lang] ?? BOT_NAMES.en;
    const name = pickBotName(this.seats.map((s) => s.name), pool, this.seats.length);
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
    this.ready.clear();
    this.deal();
    return null;
  }

  /** Play vs bots: fills the table to QUICK_START_SEATS with bots and deals. */
  quickStart(conn: Conn): string | null {
    if (this.stage !== 'lobby') return 'The game has started.';
    while (this.seats.length < QUICK_START_SEATS) {
      const err = this.addBot(conn);
      if (err) return err;
    }
    return this.start(conn);
  }

  private deal() {
    this.stage = 'game';
    this.game = createGame(this.seats.map((s) => s.name), randomInt(0, 2 ** 32));
    this.memories = this.seats.map((_, i) => newMemory(i, this.seats.length));
    this.clearBotPlans();
    this.talk.resetTalk();
    this.talk.startMoodTimer();
    this.after([{ k: 'nightStart' }]);
  }

  /** A human at the game-over screen toggles being ready for another game at the same table. */
  playAgain(conn: Conn): string | null {
    if (this.game?.phase !== 'gameOver') return 'The game is not over.';
    const seat = this.seatOf(conn);
    if (seat < 0) return 'You are not seated.';
    const token = this.seats[seat].token;
    if (!this.ready.delete(token)) this.ready.add(token);
    this.broadcast();
    this.checkReady();
    return null;
  }

  /** Re-deals once every connected human is ready. */
  private checkReady() {
    if (this.game?.phase !== 'gameOver') return;
    const humans = this.seats.filter((s) => !s.bot && s.conn);
    if (humans.length > 0 && humans.every((s) => this.ready.has(s.token))) this.redeal();
  }

  forceRedeal(conn: Conn): string | null {
    if (!this.isHost(conn)) return 'Only the host can deal.';
    if (this.game?.phase !== 'gameOver') return 'The game is not over.';
    return this.redeal();
  }

  /** Drops humans who left or whose reconnect grace ran out; a refreshing tab keeps its seat. */
  private dropGoneHumans(): void {
    for (let i = this.seats.length - 1; i >= 0; i--) {
      const s = this.seats[i];
      if (!s.bot && (s.left || (!s.conn && !this.disconnectTimers.has(s.token)))) this.removeSeat(i);
      else s.botControl = s.bot;
    }
  }

  private redeal(): string | null {
    this.ready.clear();
    this.dropGoneHumans();
    this.clearTimer();
    if (this.seats.length < MIN_PLAYERS) {
      this.stage = 'lobby';
      this.game = null;
      this.talk.stopMoodTimer();
      this.talk.resetTalk();
      this.broadcast();
      return null;
    }
    this.deal();
    return null;
  }

  rematch(conn: Conn): string | null {
    if (!this.isHost(conn)) return 'Only the host can start a new game.';
    if (this.game?.phase !== 'gameOver') return 'The game is not over.';
    this.ready.clear();
    this.stage = 'lobby';
    this.game = null;
    this.dropGoneHumans();
    this.clearTimer();
    this.talk.stopMoodTimer();
    this.talk.resetTalk();
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

  private apply(seat: number, body: ActionBody, extra: GameEvent[] = []): string | null {
    if (!this.game) return 'No game.';
    try {
      const before = viewFor(this.game, seat);
      const res = reduce(this.game, { ...body, seat } as never);
      this.game = res.state;
      if (this.memories[seat]) noteMyAction(this.memories[seat], before, body);
      this.lastActivity = Date.now();
      this.after([...extra, ...res.events]);
      return null;
    } catch (err) {
      if (err instanceof RuleError) return 'That move is not allowed right now.';
      throw err;
    }
  }

  private after(events: GameEvent[]) {
    const g = this.game;
    const over = events.find((e) => e.k === 'gameOver');
    if (g && over?.k === 'gameOver') this.recordResult(g, over.winner);
    if (g) {
      this.memories.forEach((m, seat) => observe(m, viewFor(g, seat), events));
      this.talk.feel(events);
      this.talk.botTalk(events);
    }
    this.resetTimerIfNeeded();
    this.broadcast(events);
    this.schedule(settleMs(events));
  }

  private recordResult(g: GameState, winner: 'liberal' | 'fascist') {
    this.series[winner] += 1;
    for (const p of g.players) {
      if (partyOf(p.role) === winner) this.series.wins[p.name] = (Object.hasOwn(this.series.wins, p.name) ? this.series.wins[p.name] : 0) + 1;
    }
  }

  private resetTimerIfNeeded() {
    const g = this.game;
    if (!g) return;
    const key = this.phaseKey(g);
    if (key === this.timerKey) return;
    this.timerKey = key;
    this.clearTimer();
    if (g.phase === 'gameOver') return;
    const ms = PHASE_SECONDS[g.phase] * 1000 * config.timerScale * this.paceFactor();
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
      if (!this.game || this.phaseKey(this.game) !== key) break;
      this.botMove(seat, this.seats[seat]?.bot ? [] : [{ k: 'timedOut', seat }]);
    }
    this.resetTimerIfNeeded();
  }

  private botMove(seat: number, extra: GameEvent[] = []) {
    const g = this.game;
    if (!g) return;
    const legal = legalActions(g, seat);
    if (legal.length === 0) return;
    let body = legal[0];
    try {
      body = decideNow(viewFor(g, seat), legal, this.memories[seat], (s) => this.seatName(s), Math.random, this.options.botLevel);
    } catch (e) {
      console.error('[bot] decideNow failed', e);
    }
    this.botStats.heuristic++;
    const err = this.tryApply(seat, body, extra);
    if (!err) return;
    console.error('[bot] illegal move', seat, body, err);
    if (body === legal[0]) return; // the phase timer will retry
    const err2 = this.tryApply(seat, legal[0], extra);
    if (err2) console.error('[bot] fallback move also illegal', seat, legal[0], err2);
  }

  /** apply() for bot moves: an unexpected exception becomes an error string instead of escaping. */
  private tryApply(seat: number, body: ActionBody, extra: GameEvent[] = []): string | null {
    try {
      return this.apply(seat, body, extra);
    } catch (e) {
      return String(e);
    }
  }

  /** Gives every pending bot seat its own readyAt for this phase and arms a timer per seat; decide() starts right away. New plans wait `settle` ms (client animations), then think for a time scaled by the bot's tempo. */
  schedule(settle = 0) {
    const g = this.game;
    // Nobody watching: pause bots until a human comes back (plans keep their readyAt).
    if (!g || g.phase === 'gameOver' || this.closed || this.connectedHumans() === 0) {
      for (const plan of this.botPlans.values()) {
        if (plan.timer) clearTimeout(plan.timer);
        plan.timer = null;
      }
      return;
    }
    const key = this.phaseKey(g);
    const pending = pendingActors(g).filter((seat) => this.seats[seat]?.botControl);
    for (const [seat, plan] of this.botPlans) {
      if (pending.includes(seat) && plan.key === key) continue;
      if (plan.timer) clearTimeout(plan.timer);
      this.botPlans.delete(seat);
    }
    for (const seat of pending) {
      if (this.botPlans.has(seat)) continue;
      const now = Date.now();
      let readyAt = now + (settle + botThinkMs(g.phase) * botTempo(this.seatName(seat))) * this.paceFactor();
      // Never let a bot sit on its move until the phase timer takes over.
      if (this.deadline !== null) readyAt = Math.min(readyAt, Math.max(now, this.deadline - 5000 * config.timerScale * this.paceFactor()));
      this.botPlans.set(seat, { key, readyAt, timer: null, held: false, decision: this.decideFor(seat) });
    }
    for (const [seat, plan] of this.botPlans) {
      if (plan.timer) continue;
      try {
        plan.timer = setTimeout(() => {
          this.fire(seat, key).catch((e) => console.error('[bot] think failed', e));
        }, Math.max(0, plan.readyAt - Date.now()));
      } catch (e) {
        console.error('[room] bot timer failed', e);
      }
    }
  }

  /** How long a bot may hold its move for its queued chat line. */
  private chatHoldMs() {
    return (5000 * config.botDelayMs) / 1400;
  }

  private phaseKey(g: GameState): string {
    return `${g.phase}:${g.round}:${g.vetoRefused}`;
  }

  private clearBotPlans() {
    for (const plan of this.botPlans.values()) if (plan.timer) clearTimeout(plan.timer);
    this.botPlans.clear();
  }

  /** Asks the brain (Jev, falling back to the built-in strategy) for this seat's move. Never rejects. */
  private async decideFor(seat: number): Promise<ActionBody | null> {
    const g = this.game;
    if (!g) return null;
    const legal = legalActions(g, seat);
    if (!legal.length) return null;
    try {
      const r = await decide(viewFor(g, seat), legal, this.memories[seat], (s) => this.seatName(s), undefined, undefined, this.options.botLevel);
      this.botStats[r.source]++;
      return r.action;
    } catch (e) {
      console.error('[bot] brain error', e);
      return legal[0];
    }
  }

  /** The seat's readyAt arrived: play its decided move if the plan is still relevant. */
  private async fire(seat: number, key: string) {
    const plan = this.botPlans.get(seat);
    if (!plan || plan.key !== key) return;
    plan.timer = null;
    const action = await plan.decision;
    const now = this.game;
    // The world may have moved on while we were thinking (timer, reconnect, game over); the next state change reschedules.
    if (this.closed || !now || this.phaseKey(now) !== key || !pendingActors(now).includes(seat) || !this.seats[seat]?.botControl || this.botPlans.get(seat) !== plan) return;
    // Its line is still queued: wait for it to be posted, but never past the cap.
    if (this.talk.hasQueued(seat) && Date.now() < plan.readyAt + this.chatHoldMs()) {
      plan.held = true;
      plan.timer = setTimeout(() => {
        this.fire(seat, key).catch((e) => console.error('[bot] think failed', e));
      }, Math.max(0, plan.readyAt + this.chatHoldMs() - Date.now()));
      return;
    }
    this.botPlans.delete(seat);
    if (action === null) this.botMove(seat);
    else if (this.tryApply(seat, action)) this.botMove(seat); // stale or illegal: fall back to an immediate legal move
  }

  /** A queued bot line was posted or dropped: bot moves held for it may go ahead. */
  private releaseHeldBots() {
    let released = false;
    for (const [seat, plan] of this.botPlans) {
      if (!plan.held || this.talk.hasQueued(seat)) continue;
      if (plan.timer) clearTimeout(plan.timer);
      plan.timer = null;
      plan.held = false;
      released = true;
    }
    if (released) this.schedule();
  }

  private seatName(seat: number): string {
    return this.seats[seat]?.name ?? `Seat ${seat + 1}`;
  }

  // ---------- chat ----------

  chat(conn: Conn, text: string): string | null {
    const seat = this.seatOf(conn);
    if (seat < 0) return 'You are not seated.';
    if (this.game && this.stage === 'game' && !this.game.players[seat].alive && this.game.phase !== 'gameOver') {
      return 'The dead tell no tales.';
    }
    this.lastActivity = Date.now();
    this.talk.heard(seat, text);
    return null;
  }

  // ---------- views ----------

  seatInfo(): SeatInfo[] {
    return this.seats.map((s, seat) => ({
      seat,
      name: s.name,
      bot: s.bot,
      botControlled: s.botControl && !s.bot,
      connected: s.bot || s.conn !== null,
      ready: !s.bot && this.ready.has(s.token),
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
      series: this.series,
      options: this.options,
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

/** Maps a client's UI language to the bots' language for the table it opens. */
export function botLangFor(client: 'en' | 'es' | undefined): BotLang {
  return client === 'en' ? 'en' : client === 'es' ? 'es-AR' : config.llm.lang;
}

export interface RoomSnapshot {
  v: 1;
  code: string;
  stage: 'lobby' | 'game';
  host: number;
  seats: { name: string; token: string; bot: boolean; botControl: boolean }[];
  game: GameState | null;
  memories: StoredMemory[];
  series?: Series;
  options?: TableOptions;
  ready?: string[];
  /** Generated lines over the room's life, so a restart does not reset the budget. */
  llmCalls?: number;
  /** The bots' language at this table; absent in old snapshots. */
  lang?: BotLang;
}

const isCount = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

function validOptions(o: unknown): TableOptions {
  const x = o as Partial<TableOptions> | undefined;
  return {
    pace: PACES.find((p) => p === x?.pace) ?? DEFAULT_OPTIONS.pace,
    botLevel: BOT_LEVELS.find((l) => l === x?.botLevel) ?? DEFAULT_OPTIONS.botLevel,
  };
}

/** Wins are keyed by player name, so no prototype: "constructor" and "__proto__" are ordinary names. */
function emptyWins(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

function validSeries(s: unknown): Series {
  const x = s as Series | undefined;
  if (typeof x !== 'object' || x === null || !isCount(x.liberal) || !isCount(x.fascist)) return { liberal: 0, fascist: 0, wins: emptyWins() };
  const wins = emptyWins();
  if (typeof x.wins === 'object' && x.wins !== null) for (const [k, v] of Object.entries(x.wins)) if (isCount(v)) wins[k] = v;
  return { liberal: x.liberal, fascist: x.fascist, wins };
}
