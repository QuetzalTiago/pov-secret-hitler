import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RoomView, ServerMsg } from '../shared/protocol';
import { config } from '../server/config';
import { startServer, type RunningServer } from '../server/index';

// "Everyone away": with no human connected for config.abandonMs (1 minute in production, shortened here),
// the room is ended and deleted. One player being away is handled by the separate 60 s grace (bot takeover).
let server: RunningServer;
const ABANDON = 400;

beforeAll(async () => {
  config.abandonMs = ABANDON;
  config.reconnectGraceMs = 10_000; // longer than ABANDON, so only the abandon rule can end the room
  config.botDelayMs = 1e7; // bots hold still
  server = await startServer(0);
});
afterAll(async () => {
  await server.close();
});

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
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe('everyone away', () => {
  it('ends the session once no human has been connected for the timeout', async () => {
    const [host] = await gameWith(1);
    const code = host.code;
    host.ws.terminate(); // closes the tab without clicking Leave
    await sleep(ABANDON / 2);
    expect(server.rooms.has(code)).toBe(true); // still within the minute
    await sleep(ABANDON);
    expect(server.rooms.has(code)).toBe(false);

    // Coming back afterwards finds no session.
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
    guest.ws.terminate(); // one player away: not the everyone-away case
    await sleep(ABANDON * 2);
    expect(server.rooms.has(code)).toBe(true);

    host.ws.terminate(); // now everyone is away
    await sleep(ABANDON / 2);
    const back = new Client();
    await back.open();
    back.send({ t: 'resume', code, token: host.token }); // back inside the window
    await back.until(() => back.room?.stage === 'game');
    await sleep(ABANDON * 2);
    expect(server.rooms.has(code)).toBe(true);
    back.ws.terminate();
    await sleep(ABANDON * 2);
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
    host.ws.terminate();
    await sleep(ABANDON * 2);
    expect(server.rooms.has(code)).toBe(false);
  });
});
