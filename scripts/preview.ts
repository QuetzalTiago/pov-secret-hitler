// Dev helper: one human + bots, screenshots at key moments. Usage: tsx scripts/preview.ts [outDir] [players]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { config } from '../server/config';
import { startServer } from '../server/index';

const out = process.argv[2] ?? 'e2e/screenshots/preview';
const players = Number(process.argv[3] ?? 7);
mkdirSync(out, { recursive: true });
config.botDelayMs = 700;

const server = await startServer(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.port}/?nolock=1`);
await page.screenshot({ path: `${out}/00-home.png` });
await page.fill('#name', 'Tester');
await page.click('#create');
await page.waitForSelector('#room:not(.hidden)');
for (let i = 1; i < players; i++) await page.click('#add-bot');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/01-lobby.png` });
await page.click('#start');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/02-night.png` });

type Hooks = {
  room(): { game: { phase: string; pending: number[] } | null; you: number } | null;
  actions(): string[];
  click(id: string): boolean;
  screenPos(id: string): { x: number; y: number } | null;
};
const hooks = () => (window as unknown as { __sh: Hooks }).__sh;

let shot = 3;
let lastVotes = 'null';
let reveals = 0;
const seen = new Set<string>();
for (let step = 0; step < 400; step++) {
  const state = await page.evaluate(() => {
    const h = (window as unknown as { __sh: Hooks }).__sh;
    const r = h.room();
    return { votes: JSON.stringify((r?.game as any)?.lastVotes ?? null), phase: r?.game?.phase, mine: r?.game?.pending.includes(r.you), actions: h.actions(), ids: (h as unknown as { interactables(): string[] }).interactables() };
  });
  if (!state.phase) break;
  if (state.votes !== lastVotes) {
    lastVotes = state.votes;
    if (state.votes !== 'null' && reveals++ < 2) {
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-reveal.png` });
    }
  }
  const key = `${state.phase}-${state.mine}`;
  if (!seen.has(key)) {
    seen.add(key);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-${key}.png` });
  }
  if (state.phase === 'gameOver') break;
  if (state.phase === 'night' && state.mine) {
    await page.evaluate(() => (window as unknown as { __sh: Hooks }).__sh.click('envelope'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-role.png` });
    await page.evaluate(() => (window as unknown as { __sh: Hooks }).__sh.click('role-card'));
  } else if (state.mine && state.actions.length) {
    const id = state.actions[Math.floor(Math.random() * state.actions.length)];
    const pos = await page.evaluate((i) => (window as unknown as { __sh: Hooks }).__sh.screenPos(i), id);
    if (pos) {
      await page.mouse.move(pos.x, pos.y);
      await page.waitForTimeout(500);
      const pos2 = await page.evaluate((i) => (window as unknown as { __sh: Hooks }).__sh.screenPos(i), id);
      if (pos2) await page.mouse.move(pos2.x, pos2.y);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-hover-${id}.png` });
      if (pos2) await page.mouse.click(pos2.x, pos2.y);
    } else {
      await page.evaluate((i) => (window as unknown as { __sh: Hooks }).__sh.click(i), id);
    }
  }
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/99-end.png` });
void hooks;
await browser.close();
await server.close();
console.log('done', shot);
