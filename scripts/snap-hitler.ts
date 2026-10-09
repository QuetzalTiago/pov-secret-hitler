// Dev helper: retries until the human is a Fascist, then photographs the table (Hitler model visible).
import { chromium } from '@playwright/test';
import { config } from '../server/config';
import { startServer } from '../server/index';
config.botDelayMs = 100000;
const server = await startServer(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (let attempt = 0; attempt < 25; attempt++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${server.port}/?nolock=1`);
  await page.fill('#name', 'Tester');
  await page.click('#create');
  await page.waitForSelector('#room:not(.hidden)');
  for (let i = 0; i < 4; i++) await page.click('#add-bot');
  await page.click('#start');
  await page.waitForFunction(() => (window as any).__sh.room()?.game);
  const info = await page.evaluate(() => {
    const g = (window as any).__sh.room().game;
    return { role: g.yourRole, hitler: g.players.findIndex((p: any) => p.role === 'hitler'), you: g.you };
  });
  if (info.role === 'fascist') {
    // Ack night so lights come back up, then look toward Hitler.
    await page.evaluate(() => (window as any).__sh.click('envelope'));
    await page.evaluate(() => (window as any).__sh.click('role-card'));
    await page.mouse.move(640, 320);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: process.argv[2] });
    console.log('fascist; hitler seat', info.hitler, 'you', info.you);
    break;
  }
  await page.close();
}
await browser.close();
await server.close();
