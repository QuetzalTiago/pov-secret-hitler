import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { botAction } from '../shared/bot';
import type { RoomView, ServerMsg } from '../shared/protocol';
import { legalFromView } from '../shared/view';
import { config } from '../server/config';
import { startServer, type RunningServer } from '../server/index';

const dir = mkdtempSync(join(tmpdir(), 'pov-sh-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

class Client {
  ws: WebSocket;
  room: RoomView | null = null;
  token = '';
  code = '';
  errors: string[] = [];
  autoplay = false;
  private acted = '';
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      if (m.t === 'welcome') {
        this.token = m.token;
        this.code = m.code;
      }
      if (m.t === 'error') this.errors.push(m.msg);
      if (m.t === 'room') {
        this.room = m.room;
        if (this.autoplay) this.play();
      }
    });
  }
  open() {
    return new Promise<void>((r) => this.ws.once('open', () => r()));
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  play() {
    const g = this.room?.game;
    if (!g) return;
    const legal = legalFromView(g);
    const key = `${g.phase}:${g.round}:${g.vetoRefused}:${g.hand?.length ?? 0}`;
    if (!legal.length || key === this.acted) return;
    this.acted = key;
    this.send({ t: 'act', a: botAction(g, legal, Math.random) });
  }
  async until(pred: () => boolean, ms = 15000) {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

async function boot(): Promise<RunningServer> {
  config.dbPath = join(dir, 'rooms.db');
  config.botDelayMs = 5;
  return startServer(0);
}

describe('persistence', () => {
  it('a game in progress survives a server restart', async () => {
    let server = await boot();
    const host = new Client(server.port);
    await host.open();
    host.send({ t: 'create', name: 'Keeper' });
    await host.until(() => !!host.code);
    for (let i = 0; i < 4; i++) host.send({ t: 'addBot' });
    await host.until(() => host.room?.seats.length === 5);
    host.send({ t: 'start' });
    host.autoplay = true;
    // Play until a few rounds in.
    await host.until(() => (host.room?.game?.round ?? 0) >= 3 || host.room?.game?.phase === 'gameOver');
    host.autoplay = false;
    await new Promise((r) => setTimeout(r, 50));
    const before = host.room!.game!;
    const { code, token } = host;
    host.ws.terminate();
    await new Promise((r) => setTimeout(r, 50));
    await server.close();

    // New process, same database file.
    server = await boot();
    expect(server.rooms.has(code)).toBe(true);
    const back = new Client(server.port);
    await back.open();
    back.send({ t: 'resume', code, token });
    await back.until(() => !!back.room?.game);
    const after = back.room!.game!;
    expect(back.room!.you).toBe(before.you);
    expect(after.yourRole).toBe(before.yourRole);
    expect(after.players.map((p) => p.name)).toEqual(before.players.map((p) => p.name));
    expect(after.liberal + after.fascist).toBeGreaterThanOrEqual(before.liberal + before.fascist);
    expect(after.round).toBeGreaterThanOrEqual(before.round);
    expect(back.room!.seats.filter((s) => s.bot).length).toBe(4);

    // And the restored game plays on to the end.
    back.autoplay = true;
    back.play();
    await back.until(() => back.room?.game?.phase === 'gameOver', 30000);
    expect(back.errors.filter((e) => !/not allowed/.test(e))).toEqual([]);
    back.ws.terminate();
    await server.close();
  });

  it('a lobby survives a restart; rooms that really end are deleted', async () => {
    let server = await boot();
    const host = new Client(server.port);
    await host.open();
    host.send({ t: 'create', name: 'Lobbyist' });
    await host.until(() => !!host.code);
    host.send({ t: 'addBot' });
    await host.until(() => host.room?.seats.length === 2);
    const { code, token } = host;
    host.ws.terminate();
    await new Promise((r) => setTimeout(r, 50));
    await server.close();

    server = await boot();
    const back = new Client(server.port);
    await back.open();
    back.send({ t: 'resume', code, token });
    await back.until(() => back.room?.stage === 'lobby');
    expect(back.room!.seats.map((s) => s.name)).toEqual(['Lobbyist', expect.any(String)]);
    // Leaving an empty lobby ends the room for good.
    back.send({ t: 'leave' });
    await back.until(() => !server.rooms.has(code));
    back.ws.terminate();
    await new Promise((r) => setTimeout(r, 50));
    await server.close();
    server = await boot();
    expect(server.rooms.has(code)).toBe(false);
    await server.close();
  });
});
