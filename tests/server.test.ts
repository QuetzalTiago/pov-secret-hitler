import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { botAction } from '../shared/bot';
import { parseClientMsg, type RoomView, type ServerMsg } from '../shared/protocol';
import { legalFromView } from '../shared/view';
import { config } from '../server/config';
import { startServer, type RunningServer } from '../server/index';

let server: RunningServer;
let url: string;

beforeAll(async () => {
  config.botDelayMs = 5;
  config.reconnectGraceMs = 300;
  server = await startServer(0);
  url = `ws://127.0.0.1:${server.port}/ws`;
});
afterAll(async () => {
  await server.close();
});

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  room: RoomView | null = null;
  token = '';
  code = '';
  autoplay = false;
  private waiters: (() => void)[] = [];

  constructor(headers: Record<string, string> = {}) {
    this.ws = new WebSocket(url, { headers });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      this.msgs.push(m);
      if (m.t === 'welcome') {
        this.token = m.token;
        this.code = m.code;
      }
      if (m.t === 'room') {
        this.room = m.room;
        if (this.autoplay) this.play();
      }
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }
  send(m: unknown) {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }
  async until(pred: () => boolean, ms = 10000) {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error('timeout waiting for condition');
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  play() {
    const g = this.room?.game;
    if (!g) return;
    const legal = legalFromView(g);
    if (legal.length) this.send({ t: 'act', a: botAction(g, legal, Math.random) });
  }
  close() {
    this.ws.close();
  }
}

async function client(headers?: Record<string, string>) {
  const c = new Client(headers);
  await c.open();
  return c;
}

describe('protocol validation', () => {
  it('rejects malformed and unknown messages', () => {
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg('[]')).toBeNull();
    expect(parseClientMsg('{"t":"hack"}')).toBeNull();
    expect(parseClientMsg('{"t":"create","name":""}')).toBeNull();
    expect(parseClientMsg('{"t":"create","name":"   "}')).toBeNull();
    expect(parseClientMsg('{"t":"join","code":"ab","name":"x"}')).toBeNull();
    expect(parseClientMsg('{"t":"act","a":{"type":"nominate","target":11}}')).toBeNull();
    expect(parseClientMsg('{"t":"act","a":{"type":"nominate","target":1.5}}')).toBeNull();
    expect(parseClientMsg('{"t":"act","a":{"type":"vote","ja":"yes"}}')).toBeNull();
    expect(parseClientMsg('{"t":"act","a":{"type":"presDiscard","index":3}}')).toBeNull();
    expect(parseClientMsg('{"t":"resume","code":"ABCD","token":"zz"}')).toBeNull();
    expect(parseClientMsg('x'.repeat(5000))).toBeNull();
  });

  it('builds fresh objects and strips extras, control chars and seat spoofing', () => {
    expect(parseClientMsg('{"t":"act","a":{"type":"vote","ja":true,"seat":3},"seat":4}')).toEqual({
      t: 'act',
      a: { type: 'vote', ja: true },
    });
    expect(parseClientMsg('{"t":"create","name":"  Al\\u0000ice\\u202e  "}')).toEqual({ t: 'create', name: 'Alice' });
    expect(parseClientMsg('{"t":"join","code":"abcd","name":"' + 'n'.repeat(40) + '"}')).toEqual({
      t: 'join',
      code: 'ABCD',
      name: 'n'.repeat(16),
    });
    expect(parseClientMsg('{"t":"chat","text":"<b>hi</b>"}')).toEqual({ t: 'chat', text: '<b>hi</b>' });
  });
});

describe('server', () => {
  it('plays a full 5-human game over WebSockets without leaking hidden info', async () => {
    const host = await client();
    host.send({ t: 'create', name: 'Host' });
    await host.until(() => !!host.code);
    const others = await Promise.all([1, 2, 3, 4].map(() => client()));
    for (const [i, c] of others.entries()) c.send({ t: 'join', code: host.code, name: `P${i + 1}` });
    await host.until(() => host.room?.seats.length === 5);
    const all = [host, ...others];
    for (const c of all) c.autoplay = true;
    host.send({ t: 'start' });
    for (const c of all) await c.until(() => c.room?.game?.phase === 'gameOver', 30000);

    for (const c of all) {
      for (const m of c.msgs) {
        if (m.t !== 'room' || !m.room.game) continue;
        const g = m.room.game;
        const holder = g.phase === 'legPresident' ? g.president : g.phase === 'legChancellor' ? g.chancellor : -1;
        if (g.you !== holder) expect(g.hand).toBeNull();
        if (g.phase !== 'peek' || g.you !== g.president) expect(g.peek).toBeNull();
        if (g.phase !== 'gameOver' && g.yourRole === 'liberal') {
          expect(g.players.filter((p) => p.seat !== g.you).every((p) => p.role === null)).toBe(true);
        }
        expect(JSON.stringify(m.room.events)).not.toMatch(/"(hitler|fascist|liberal)"(?!,"reason)/);
      }
    }
    const final = host.room!.game!;
    expect(final.winner).toMatch(/liberal|fascist/);
    expect(final.players.every((p) => p.role !== null)).toBe(true);
    all.forEach((c) => c.close());
  });

  it('host can fill seats with bots; non-hosts cannot start', async () => {
    const host = await client();
    host.send({ t: 'create', name: 'Solo' });
    await host.until(() => !!host.code);
    const guest = await client();
    guest.send({ t: 'join', code: host.code, name: 'Guest' });
    await guest.until(() => guest.room?.seats.length === 2);
    guest.send({ t: 'start' });
    guest.send({ t: 'addBot' });
    await guest.until(() => guest.msgs.filter((m) => m.t === 'error').length >= 2);
    expect(guest.msgs.filter((m) => m.t === 'error').map((m) => (m as { msg: string }).msg)).toEqual([
      'Only the host can start.',
      'Only the host can add bots.',
    ]);
    for (let i = 0; i < 3; i++) host.send({ t: 'addBot' });
    await host.until(() => host.room?.seats.length === 5);
    expect(host.room!.seats.filter((s) => s.bot).length).toBe(3);
    host.autoplay = true;
    guest.autoplay = true;
    host.send({ t: 'start' });
    await host.until(() => host.room?.game?.phase === 'gameOver', 30000);
    host.close();
    guest.close();
  });

  it('reconnects with a token and hands a long-disconnected seat to a bot', async () => {
    const host = await client();
    host.send({ t: 'create', name: 'H' });
    await host.until(() => !!host.code);
    for (let i = 0; i < 3; i++) host.send({ t: 'addBot' });
    const p = await client();
    p.send({ t: 'join', code: host.code, name: 'Flaky' });
    await host.until(() => host.room?.seats.length === 5);
    host.send({ t: 'start' });
    await p.until(() => p.room?.stage === 'game');
    const seat = p.room!.you;
    const token = p.token;
    p.close();
    await host.until(() => host.room?.seats[seat].connected === false);
    await host.until(() => host.room?.seats[seat].botControlled === true, 3000);

    const back = await client();
    back.send({ t: 'resume', code: host.code, token });
    await back.until(() => back.room?.you === seat);
    await host.until(() => host.room?.seats[seat].botControlled === false && host.room.seats[seat].connected);
    expect(back.room!.game!.yourRole).not.toBeNull();

    const bad = await client();
    bad.send({ t: 'resume', code: host.code, token: 'f'.repeat(32) });
    await bad.until(() => bad.msgs.some((m) => m.t === 'error'));
    expect(bad.room).toBeNull();
    [host, back, bad].forEach((c) => c.close());
  });

  it('rejects actions out of turn and from non-members', async () => {
    const c = await client();
    c.send({ t: 'act', a: { type: 'ack' } });
    c.send({ t: 'join', code: 'ZZZZ', name: 'x' });
    await c.until(() => c.msgs.filter((m) => m.t === 'error').length >= 2);
    expect(c.msgs.map((m) => (m as { msg?: string }).msg)).toEqual(['You are not in a room.', 'No room with that code.']);
    c.close();
  });

  it('mutes dead players in chat', async () => {
    const host = await client();
    host.send({ t: 'create', name: 'Ghost' });
    await host.until(() => !!host.code);
    for (let i = 0; i < 4; i++) host.send({ t: 'addBot' });
    await host.until(() => host.room?.seats.length === 5);
    host.send({ t: 'start' });
    await host.until(() => host.room?.stage === 'game');
    host.send({ t: 'chat', text: 'hello' });
    await host.until(() => host.msgs.some((m) => m.t === 'chat'));
    server.rooms.get(host.code)!.game!.players[0].alive = false;
    host.send({ t: 'chat', text: 'boo' });
    await host.until(() => host.msgs.some((m) => m.t === 'error'));
    expect(host.msgs.filter((m) => m.t === 'chat').length).toBe(1);
    host.close();
  });

  it('closes connections that send oversized frames', async () => {
    const c = await client();
    const closed = new Promise<number>((r) => c.ws.on('close', (code) => r(code)));
    c.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(4000) }));
    expect(await closed).toBe(1009);
  });

  it('rejects cross-origin WebSocket upgrades', async () => {
    const c = new Client({ Origin: 'https://evil.example' });
    await expect(c.open()).rejects.toThrow(/403/);
  });

  it('rate limits floods', async () => {
    const c = await client();
    for (let i = 0; i < 200; i++) c.send({ t: 'ping' });
    await new Promise((r) => setTimeout(r, 300));
    const pongs = c.msgs.filter((m) => m.t === 'pong').length;
    expect(pongs).toBeLessThan(60);
    c.close();
  });
});
