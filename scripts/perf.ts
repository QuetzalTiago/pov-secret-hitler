// Dev helper: renderer baseline (fps, draw calls, ...) via the client's ?perf HUD hook (window.__sh.perf()).
// The server serves the built client from dist/client, so run `npx vite build` first.
// Usage: tsx scripts/perf.ts [--players 5,10] [--gpu] [--seconds 5] [--leak [rounds]]
//   --leak:  GPU-leak check instead of the table: with the first --players value (default 7) plays `rounds` full
//            games (default 3) with seat churn + rematch between them and prints renderer.info counts at each game over.
//   default: swiftshader (software GL): counts are deterministic, fps/frame times are NOT meaningful.
//   --gpu:   launches chromium with --enable-gpu --ignore-gpu-blocklist and a native ANGLE backend
//            (d3d11 on Windows, gl elsewhere) so headless uses the machine's real GPU; the GL renderer is printed.
import os from 'node:os';
import { chromium, type Page } from '@playwright/test';
import { config } from '../server/config';
import { startServer } from '../server/index';

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const leak = argv.includes('--leak');
const leakRounds = Number(argv[argv.indexOf('--leak') + 1]) || 3;
const players = (opt('players') ?? (leak ? '7' : '5,10')).split(',').map(Number);
const seconds = Number(opt('seconds') ?? 5);
const gpu = argv.includes('--gpu');

interface Stats {
  fps: number;
  frameMs: number;
  worstMs: number;
  calls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
}
type Hooks = {
  room(): { you: number; game: { phase: string } | null } | null;
  actions(): string[];
  interactables(): string[];
  click(id: string): boolean;
  perf(): Stats | null;
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const max = (xs: number[]) => Math.max(0, ...xs);

async function sample(page: Page): Promise<Stats> {
  const got: Stats[] = [];
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => (window as unknown as { __sh: Hooks }).__sh.perf());
    if (s && s.fps > 0) got.push(s);
  }
  const col = (k: keyof Stats) => got.map((s) => s[k]);
  return {
    fps: median(col('fps')),
    frameMs: median(col('frameMs')),
    worstMs: max(col('worstMs')),
    calls: max(col('calls')),
    triangles: max(col('triangles')),
    programs: max(col('programs')),
    geometries: max(col('geometries')),
    textures: max(col('textures')),
  };
}

const phase = (page: Page) => page.evaluate(() => (window as unknown as { __sh: Hooks }).__sh.room()?.game?.phase ?? null);

/** Plays the human through the night and nomination until an election vote is open and unvoted. */
async function reachVote(page: Page): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const h = (window as unknown as { __sh: Hooks }).__sh;
      return { phase: h.room()?.game?.phase ?? null, actions: h.actions(), ids: h.interactables() };
    });
    if (s.phase === 'vote' && s.actions.includes('vote-ja')) return true;
    if (s.phase === 'gameOver') return false;
    let id: string | undefined;
    if (s.phase === 'night') id = s.actions.includes('role-card') ? 'role-card' : s.ids.includes('envelope') ? 'envelope' : undefined;
    else if (s.phase !== 'vote') id = s.actions[0];
    if (id) await page.evaluate((i) => (window as unknown as { __sh: Hooks }).__sh.click(i), id);
    await page.waitForTimeout(400);
  }
  return false;
}

/** Plays the human (clicking available actions) until the game is over; false on timeout. */
async function playToGameOver(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const h = (window as unknown as { __sh: Hooks }).__sh;
      return { phase: h.room()?.game?.phase ?? null, actions: h.actions(), ids: h.interactables() };
    });
    if (s.phase === 'gameOver') return true;
    let id: string | undefined;
    if (s.phase === 'night') id = s.actions.includes('role-card') ? 'role-card' : s.ids.includes('envelope') ? 'envelope' : undefined;
    else id = s.actions[0];
    if (id) await page.evaluate((i) => (window as unknown as { __sh: Hooks }).__sh.click(i), id);
    await page.waitForTimeout(400);
  }
  return false;
}

config.botDelayMs = 300;
const server = await startServer(0);
const gpuArgs = ['--enable-gpu', '--ignore-gpu-blocklist', process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=gl'];
const browser = await chromium.launch({ args: gpu ? gpuArgs : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let glRenderer = '';
const errors: string[] = [];
const rows: string[] = [];

const seatCount = (page: Page, c: number) => page.waitForFunction((k) => document.querySelectorAll('#seats li').length === k, c);

async function leakCheck(n: number) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${n}p] ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?perf&nolock=1`);
  await page.fill('#name', 'Perf');
  await page.click('#create');
  await page.waitForSelector('#room:not(.hidden)');
  for (let i = 1; i < n; i++) await page.click('#add-bot');
  await seatCount(page, n);
  const readings: Stats[] = [];
  for (let r = 1; r <= leakRounds; r++) {
    // seat churn: two bots leave, two join
    for (let i = 1; i <= 2; i++) { await page.click('#remove-bot'); await seatCount(page, n - i); }
    for (let i = 1; i <= 2; i++) { await page.click('#add-bot'); await seatCount(page, n - 2 + i); }
    await page.click('#start');
    await page.waitForSelector('#hud', { state: 'visible' });
    if (!(await playToGameOver(page, 240_000))) {
      console.error(`round ${r}: game over not reached within 240s, stopping`);
      break;
    }
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => (window as unknown as { __sh: Hooks }).__sh.perf());
    if (!s) break;
    readings.push(s);
    rows.push(`| ${r} | ${s.geometries} | ${s.textures} | ${s.programs} | ${s.calls} |`);
    await page.click('#rematch');
    await page.waitForFunction(() => (window as unknown as { __sh: Hooks }).__sh.room()?.game == null);
  }
  await ctx.close();
  return readings;
}

if (leak) {
  const readings = await leakCheck(players[0]);
  console.log(`Leak check: ${players[0]} players, ${leakRounds} rounds, mode: ${gpu ? 'gpu' : 'swiftshader'}\n`);
  console.log('| round | geometries | textures | programs | draw calls |');
  console.log('|---|---|---|---|---|');
  console.log(rows.join('\n'));
  const a = readings[0];
  const b = readings[readings.length - 1];
  const d = (x: number) => (x >= 0 ? '+' : '') + x;
  if (a && b) console.log(`\nround 1 -> ${readings.length}: geometries ${d(b.geometries - a.geometries)}, textures ${d(b.textures - a.textures)}`);
  await browser.close();
  await server.close();
  if (errors.length) console.error(`page errors:\n${errors.join('\n')}`);
  process.exit(errors.length || readings.length < leakRounds ? 1 : 0);
}

for (const n of players) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${n}p] ${e.message}`));
  const row = (scene: string, s: Stats) =>
    rows.push(
      `| ${n} | ${scene} | ${s.fps.toFixed(1)} | ${s.frameMs.toFixed(1)} | ${s.worstMs.toFixed(1)} | ${s.calls} | ${s.triangles} | ${s.programs} | ${s.geometries} | ${s.textures} |`,
    );
  await page.goto(`http://127.0.0.1:${server.port}/?perf&nolock=1`);
  await page.fill('#name', 'Perf');
  await page.click('#create');
  await page.waitForSelector('#room:not(.hidden)');
  if (!glRenderer) {
    glRenderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
  }
  for (let i = 1; i < n; i++) await page.click('#add-bot');
  await page.waitForFunction((c) => document.querySelectorAll('#seats li').length === c, n);

  await page.waitForTimeout(2000);
  row('lobby', await sample(page));

  await page.click('#start');
  await page.waitForSelector('#hud', { state: 'visible' });
  await page.waitForFunction(() => (window as unknown as { __sh: Hooks }).__sh.room()?.game?.phase === 'night');
  await page.waitForTimeout(3000);
  row('night', await sample(page));

  if (await reachVote(page)) {
    await page.waitForTimeout(3000);
    if ((await phase(page)) === 'vote') row('vote', await sample(page));
    else console.error(`${n} players: vote phase ended before sampling, skipped`);
  } else console.error(`${n} players: vote not reached within 60s, skipped`);
  await ctx.close();
}

console.log(`Browser: chromium ${browser.version()}, mode: ${gpu ? 'gpu' : 'swiftshader (fps not meaningful)'}, GL: ${glRenderer}`);
console.log(`CPU: ${os.cpus()[0]?.model ?? 'unknown'}, viewport: 1280x720\n`);
console.log('| players | scene | fps | frame ms | worst ms | draw calls | triangles | programs | geometries | textures |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
await browser.close();
await server.close();
if (errors.length) {
  console.error(`page errors:\n${errors.join('\n')}`);
  process.exit(1);
}
process.exit(0);
