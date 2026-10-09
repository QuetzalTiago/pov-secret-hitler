// Live check: one scripted player + bots play a full game with the real Jev API.
// Usage: npx tsx scripts/jev-game.ts [players=5]
import WebSocket from 'ws';
import { botAction } from '../shared/bot';
import type { RoomView, ServerMsg } from '../shared/protocol';
import { legalFromView } from '../shared/view';
import { config } from '../server/config';
import { startServer } from '../server/index';
import { jevEnabled, jevStats } from '../server/jev';

const players = Number(process.argv[2] ?? 5);
config.botDelayMs = 300;
if (!jevEnabled()) console.warn('Jev is NOT configured (no TYPESAFE_API_KEY): bots will use the built-in strategy.');
const server = await startServer(0);
const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
let room: RoomView | null = null;
let acted = '';
const t0 = Date.now();

await new Promise<void>((resolve) => {
  ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: 'Scripted' })));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    if (m.t === 'chat') console.log(`  💬 ${m.name}: ${m.text}`);
    if (m.t !== 'room') return;
    const first = !room;
    room = m.room;
    if (first) {
      for (let i = 1; i < players; i++) ws.send(JSON.stringify({ t: 'addBot' }));
      setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 300);
      return;
    }
    const g = room.game;
    if (!g) return;
    for (const e of room.events) {
      if (e.k === 'enacted') console.log(`  ${e.policy === 'L' ? '🔵 Liberal' : '🔴 Fascist'} policy${e.chaos ? ' (chaos)' : ''}  L${g.liberal} F${g.fascist}`);
      if (e.k === 'executed') console.log(`  🔫 ${room.seats[e.target].name} executed`);
    }
    if (g.phase === 'gameOver') return resolve();
    const legal = legalFromView(g);
    const key = `${g.phase}:${g.round}:${g.vetoRefused}:${g.hand?.length ?? 0}`;
    if (legal.length && key !== acted) {
      acted = key;
      ws.send(JSON.stringify({ t: 'act', a: botAction(g, legal, Math.random) }));
    }
  });
});

const g = room!.game!;
console.log(`\nWinner: ${g.winner} (${g.winReason}) after ${g.round} rounds in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('Roles:', g.players.map((p) => `${p.name}=${p.role}`).join(', '));
const r = [...server.rooms.values()][0];
console.log('Bot decisions:', r?.botStats, '| Jev calls:', { ok: jevStats.ok, failed: jevStats.failed, inputTokens: jevStats.inputTokens, lastError: jevStats.lastError });
ws.close();
await new Promise((res) => setTimeout(res, 3000)); // let trailing bot chat arrive
await server.close();
process.exit(0);
