import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { RoomView, ServerMsg } from '../shared/protocol';
import { config } from '../server/config';
import { startServer, type RunningServer } from '../server/index';

// "Everyone away": with no human connected for config.abandonMs (1 minute), the room is ended and deleted.
// One player being away is handled by the separate reconnect grace (bot takeover).
// Only the server's abandon timer runs on fake time. Socket I/O and the polling helpers keep the real timers.
const realSetTimeout = globalThis.setTimeout;
let server: RunningServer;
const ABANDON = 60_000;

beforeAll(async () => {
  config.abandonMs = ABANDON;
  config.reconnectGraceMs = 10 * ABANDON; // longer than ABANDON, so only the abandon rule can end the room
  config.botDelayMs = 1e7; // bots hold still
  config.timerScale = 1e4; // phase timers far beyond any advance, so only the abandon timer acts
  server = await startServer(0);
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  vi.useRealTimers();
  await server.close();
});

// Real-time polling: Date.now and the real setTimeout, unaffected by fake timers.
async function until(pred: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => realSetTimeout(r, 20));
  }
}
const abandonArmed = (code: string) => (server.rooms.get(code) as any)?.abandonTimer != null;
const connectedHumans = (code: string) => (server.rooms.get(code) as any)?.connectedHumans() ?? -1;

class Client {
  ws: WebSocket;
  room: RoomView | null = null;
  code = '';
  token = '';
  msgs: ServerMsg[] = [];
  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      this.msgs.push(m);
      if (m.t === 'welcome') {
        this.code = m.code;
        this.token = m.token;
      }
      if (m.t === 'room') this.room = m.room;
    });
  }
  open() {
    return new Promise<void>((r) => this.ws.once('open', () => r()));
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async until(pred: () => boolean, ms = 5000) {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => realSetTimeout(r, 20));
    }
  }
}

async function gameWith(humans: number): Promise<Client[]> {
  const host = new Client();
  await host.open();
  host.send({ t: 'create', name: 'Host' });
  await host.until(() => !!host.code);
  const others: Client[] = [];
  for (let i = 1; i < humans; i++) {
    const c = new Client();
    await c.open();
    c.send({ t: 'join', code: host.code, name: `P${i}` });
    await c.until(() => !!c.code);
    others.push(c);
  }
  for (let i = humans; i < 5; i++) host.send({ t: 'addBot' });
  await host.until(() => host.room?.seats.length === 5);
  host.send({ t: 'start' });
  await host.until(() => host.room?.stage === 'game');
  return [host, ...others];
}

// Fake only the timers the abandon rule uses; socket I/O and polling stay on real time.
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

describe('everyone away', () => {
  it('ends the session once no human has been connected for the timeout', async () => {
    const [host] = await gameWith(1);
    const code = host.code;
    fakeTimers();
    host.ws.terminate(); // closes the tab without clicking Leave
    await until(() => abandonArmed(code));
    await vi.advanceTimersByTimeAsync(ABANDON - 1);
    expect(server.rooms.has(code)).toBe(true); // still within the minute
    await vi.advanceTimersByTimeAsync(1);
    expect(server.rooms.has(code)).toBe(false);

    // Coming back afterwards finds no session.
    vi.useRealTimers();
    const back = new Client();
    await back.open();
    back.send({ t: 'resume', code, token: host.token });
    await back.until(() => back.msgs.some((m) => m.t === 'error'));
    expect(back.msgs.find((m) => m.t === 'error')).toMatchObject({ fatal: true });
    back.ws.terminate();
  });

  it('keeps the session while anyone is still connected, and a reconnect in time saves it', async () => {
    const [host, guest] = await gameWith(2);
    const code = host.code;
    fakeTimers();
    guest.ws.terminate(); // one player away: not the everyone-away case
    await until(() => connectedHumans(code) === 1);
    expect(abandonArmed(code)).toBe(false);
    await vi.advanceTimersByTimeAsync(ABANDON * 2);
    expect(server.rooms.has(code)).toBe(true);

    host.ws.terminate(); // now everyone is away
    await until(() => abandonArmed(code));
    await vi.advanceTimersByTimeAsync(ABANDON / 2);
    const back = new Client();
    await back.open();
    back.send({ t: 'resume', code, token: host.token }); // back inside the window
    await until(() => back.room?.stage === 'game' && !abandonArmed(code));
    await vi.advanceTimersByTimeAsync(ABANDON * 2);
    expect(server.rooms.has(code)).toBe(true);

    back.ws.terminate();
    await until(() => abandonArmed(code));
    await vi.advanceTimersByTimeAsync(ABANDON - 1);
    expect(server.rooms.has(code)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.rooms.has(code)).toBe(false);
  });

  it('a lobby where everyone left is ended too', async () => {
    const host = new Client();
    await host.open();
    host.send({ t: 'create', name: 'Lonely' });
    await host.until(() => !!host.code);
    host.send({ t: 'addBot' });
    await host.until(() => host.room?.seats.length === 2);
    const code = host.code;
    fakeTimers();
    host.ws.terminate();
    await until(() => abandonArmed(code));
    await vi.advanceTimersByTimeAsync(ABANDON - 1);
    expect(server.rooms.has(code)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.rooms.has(code)).toBe(false);
  });
});
