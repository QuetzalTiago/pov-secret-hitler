import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RoomView, ServerMsg } from '../shared/protocol';
import { config } from '../server/config';
import { startServer, type RunningServer } from '../server/index';
import { Room } from '../server/room';

// Bots speak one at a time and give people time to read: pacing is real here, just 50x faster.
const PACE = 0.02;
let server: RunningServer;

beforeAll(async () => {
  config.chatPacing = PACE;
  config.botDelayMs = 1e7; // bots hold still: only the lines we queue get posted
  server = await startServer(0);
});
afterAll(async () => {
  await server.close();
});

interface Heard {
  seat: number;
  text: string;
  at: number;
}

async function table() {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const heard: Heard[] = [];
  let room: RoomView | null = null;
  let code = '';
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    if (m.t === 'welcome') code = m.code;
    if (m.t === 'room') room = m.room;
    if (m.t === 'chat') heard.push({ seat: m.seat, text: m.text, at: Date.now() });
  });
  await new Promise<void>((r) => ws.once('open', () => r()));
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  const until = async (pred: () => boolean) => {
    const end = Date.now() + 5000;
    while (!pred()) {
      if (Date.now() > end) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  send({ t: 'create', name: 'Reader' });
  await until(() => !!code);
  for (let i = 0; i < 4; i++) send({ t: 'addBot' });
  await until(() => (room as RoomView | null)?.seats.length === 5);
  send({ t: 'start' });
  await until(() => (room as RoomView | null)?.stage === 'game');
  // Reach into the room to queue bot lines directly (say() is what every bot line goes through).
  const r = server.rooms.get(code)! as unknown as {
    say(seat: number, text: string): Promise<void>;
    game: { players: { alive: boolean }[] };
    botPlans: Map<number, { readyAt: number; timer: NodeJS.Timeout | null }>;
    schedule(): void;
    chatFreeAt: number;
  };
  return { ws, heard, send, until, room: r };
}

describe('bot chat pacing', () => {
  it('posts bot lines one at a time, each after the previous one has had time to be read', async () => {
    const t = await table();
    const lines = ['Yo pasé dos fascistas.', 'No le creo nada a Vera.', 'Che, ¿y vos qué votaste?'];
    await Promise.all(lines.map((text, i) => t.room.say(i + 1, text)));
    await t.until(() => t.heard.filter((h) => h.seat !== 0).length === lines.length); // posted, now delivered
    const bot = t.heard.filter((h) => h.seat !== 0);
    expect(bot.map((h) => h.text)).toEqual(lines); // in order, nothing lost
    for (let i = 1; i < bot.length; i++) {
      const gap = bot[i].at - bot[i - 1].at;
      expect(gap).toBeGreaterThanOrEqual(Room.readMs(bot[i - 1].text) - 5);
    }
    t.ws.terminate();
  });

  it("a human's message makes the next bot line wait until it has been read", async () => {
    const t = await table();
    const long = 'Escuchen todos, yo pasé un liberal y un fascista y el canciller eligió el fascista, así que ojo con él.';
    t.send({ t: 'chat', text: long });
    await t.until(() => t.heard.some((h) => h.seat === 0));
    const humanAt = t.heard.find((h) => h.seat === 0)!.at;
    await t.room.say(1, 'Uh, qué raro.');
    await t.until(() => t.heard.some((h) => h.seat === 1));
    const botAt = t.heard.find((h) => h.seat === 1)!.at;
    expect(botAt - humanAt).toBeGreaterThanOrEqual(Room.readMs(long) - 20);
    t.ws.terminate();
  });

  it('caps the backlog and skips a bot that died before its turn', async () => {
    const t = await table();
    t.room.game.players[3].alive = false; // seat 3 dies while its line waits
    const said = [1, 2, 3, 4, 1, 2].map((seat, i) => t.room.say(seat, `línea ${i}`));
    await Promise.all(said);
    await new Promise((r) => setTimeout(r, 100)); // let the last posted line arrive
    const texts = t.heard.filter((h) => h.seat !== 0).map((h) => h.text);
    expect(texts).not.toContain('línea 2'); // the dead bot's line
    expect(texts.length).toBeLessThanOrEqual(4); // never more than 4 waiting
    expect(texts[0]).toBe('línea 0');
    t.ws.terminate();
  });

  // Bot 1 has a pending move (night ack) and a queued line; its move is forced due right now.
  async function dueBot(blockChat: boolean) {
    const t = await table();
    const seat = 1;
    const plan = t.room.botPlans.get(seat)!;
    if (blockChat) t.room.chatFreeAt = Date.now() + 10_000;
    else void t.room.say(2, 'x'.repeat(120)); // posts at once, then holds the chat while it is read
    void t.room.say(seat, 'Hola, ya voy.');
    const start = Date.now();
    let actedAt = 0;
    const watch = setInterval(() => {
      if (!actedAt && !t.room.botPlans.has(seat)) actedAt = Date.now();
    }, 2);
    clearTimeout(plan.timer!);
    plan.timer = null;
    plan.readyAt = start;
    t.room.schedule();
    const acted = async () => {
      try {
        await t.until(() => actedAt > 0);
      } finally {
        clearInterval(watch);
      }
      return actedAt - start;
    };
    return { t, seat, acted };
  }

  it('a bot finishes its queued line before acting', async () => {
    config.botDelayMs = 140; // hold cap 500 ms
    try {
      const { t, seat, acted } = await dueBot(false);
      const after = await acted();
      await new Promise((r) => setTimeout(r, 30)); // let the line reach us
      const spoke = t.heard.find((h) => h.seat === seat);
      expect(spoke).toBeDefined();
      expect(after).toBeGreaterThanOrEqual(100); // waited for the blocker to be read, then spoke
      t.ws.terminate();
    } finally {
      config.botDelayMs = 1e7;
    }
  });

  it('the hold is capped when the line cannot be posted', async () => {
    config.botDelayMs = 140;
    try {
      const { t, seat, acted } = await dueBot(true);
      const after = await acted();
      expect(after).toBeGreaterThanOrEqual(450);
      expect(after).toBeLessThan(2000);
      expect(t.heard.some((h) => h.seat === seat)).toBe(false);
      t.ws.terminate();
    } finally {
      config.botDelayMs = 1e7;
    }
  });
});
