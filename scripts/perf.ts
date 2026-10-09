// Dev helper: renderer baseline (fps, draw calls, ...) via the client's ?perf HUD hook (window.__sh.perf()).
// The server serves the built client from dist/client, so run `npx vite build` first.
// Usage: tsx scripts/perf.ts [--players 5,10] [--gpu] [--seconds 5]
//   default: swiftshader (software GL): counts are deterministic, fps/frame times are NOT meaningful.
//   --gpu:   launches chromium without the swiftshader flags so it can use the machine's real GPU.
import { chromium, type Page } from '@playwright/test';
import { config } from '../server/config';
import { startServer } from '../server/index';

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const players = (opt('players') ?? '5,10').split(',').map(Number);
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

config.botDelayMs = 300;
const server = await startServer(0);
const browser = await chromium.launch(gpu ? {} : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors: string[] = [];
const rows: string[] = [];

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

console.log(`Browser: chromium ${browser.version()}, mode: ${gpu ? 'gpu' : 'swiftshader (fps not meaningful)'}\n`);
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
