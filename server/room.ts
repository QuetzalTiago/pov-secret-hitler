// One room: lobby, game loop, bots, timers, disconnect takeover, chat.
import { randomBytes, randomInt } from 'node:crypto';
import { botAction } from '../shared/bot';
import { RuleError, createGame, legalActions, pendingActors, reduce } from '../shared/engine';
import type { RoomView, SeatInfo, ServerMsg } from '../shared/protocol';
import { MAX_PLAYERS, MIN_PLAYERS } from '../shared/rules';
import type { ActionBody, GameEvent, GameState, Phase } from '../shared/types';
import { viewFor } from '../shared/view';
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
}

const BOT_NAMES = [
  'Vera', 'Otto', 'Mabel', 'Rex', 'Ingrid', 'Silas', 'Dolores', 'Hank', 'Pearl', 'Cyrus', 'Greta', 'Lou',
];

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
    this.seats.push({ name: unique, token, conn, bot: false, botControl: false, disconnectedAt: null });
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
    const timer = setTimeout(() => {
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
    }, config.reconnectGraceMs);
    this.disconnectTimers.set(s.token, timer);
    this.broadcast();
    this.checkEmpty();
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
    if (this.host === seat || this.host >= this.seats.length || this.seats[this.host]?.bot) {
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
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    for (const s of this.seats) if (s.conn) s.conn.room = null;
    this.onEmpty(this);
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
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.seats.length}`;
    this.seats.push({ name, token: randomBytes(16).toString('hex'), conn: null, bot: true, botControl: true, disconnectedAt: null });
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
    this.timer = setTimeout(() => this.onTimeout(key), ms);
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
    const body = botAction(viewFor(g, seat), legal, Math.random);
    const err = this.apply(seat, body);
    if (err) throw new Error(`bot made illegal move: ${err}`);
  }

  /** Schedules the next bot move if a bot-driven seat owes an action. */
  schedule() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    const g = this.game;
    // Nobody watching: pause bots until a human comes back.
    if (!g || g.phase === 'gameOver' || this.closed || this.connectedHumans() === 0) return;
    const botSeats = pendingActors(g).filter((seat) => this.seats[seat]?.botControl);
    if (botSeats.length === 0) return;
    const quick = g.phase === 'vote' || g.phase === 'night';
    const base = config.botDelayMs * (quick ? 0.4 : 1);
    const delay = base + Math.random() * base * 0.8;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const now = this.game;
      if (!now) return;
      const seat = pendingActors(now).find((s) => this.seats[s]?.botControl);
      if (seat !== undefined) this.botMove(seat);
      else this.schedule();
    }, delay);
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
    this.lastActivity = Date.now();
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
  }
}
