// Dev helper: forces the execution power and a nomination so the revolver and pointing poses can be photographed.
// Usage: tsx scripts/snap-gun.ts <out-prefix>
import { chromium } from '@playwright/test';
import { config } from '../server/config';
import { startServer } from '../server/index';

config.botDelayMs = 1e7; // bots hold still
config.timerScale = 100; // screenshots are slow: never let a turn deadline expire
const out = process.argv[2] ?? 'gun';
const server = await startServer(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${server.port}/?nolock=1`);
await page.fill('#name', 'Tester');
await page.click('#create');
await page.waitForSelector('#room:not(.hidden)');
for (let i = 0; i < 6; i++) await page.click('#add-bot');
await page.click('#start');
await page.waitForFunction(() => (window as any).__sh.room()?.game);
const room = [...server.rooms.values()][0] as any;

async function force(president: number, file: string, phase = 'execute') {
  const g = room.game;
  g.phase = phase;
  g.president = president;
  g.fascist = 4;
  g.nightAcks = g.nightAcks.map(() => true);
  room.broadcast([]);
  await page.mouse.move(640, 330);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${out}-${file}.png` });
}
await force(3, 'bot'); // seat 3 sits across the table
await force(0, 'me');
// The shot itself: seat 3 aims, then kills seat 4; frames at the flash, the jerk, the fall and settled.
async function shot(by: number, target: number) {
  const g = room.game;
  g.phase = 'execute';
  g.president = by;
  room.broadcast([]);
  await page.mouse.move(640, 330);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}-shot-0-aim.png` });
  // Freeze the client sim so the frames below are deterministic, then step it by hand.
  await page.evaluate(() => (window as any).__sh.freeze(true));
  g.players[target].alive = false;
  room.broadcast([{ k: 'executed', by, target }]);
  await page.waitForFunction((t) => (window as any).__sh.room()?.game?.players?.[t]?.alive === false, target);
  let t = 0;
  for (const [at, name] of [[0.05, '1-flash'], [0.12, '2-jerk'], [0.6, '3-fall'], [1.5, '4-settled']] as const) {
    await page.evaluate((d) => (window as any).__sh.step(d), at - t);
    t = at;
    await page.screenshot({ path: `${out}-shot-${name}.png` });
  }
  await page.evaluate(() => (window as any).__sh.freeze(false));
}
await shot(3, 4);
await force(3, 'point-bot', 'nominate');
await force(0, 'point-me', 'nominate');
await browser.close();
await server.close();
