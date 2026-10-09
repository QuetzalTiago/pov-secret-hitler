// Dev helper: one screenshot of a seated table with bots. Usage: tsx scripts/snap.ts out.png
import { chromium } from '@playwright/test';
import { config } from '../server/config';
import { startServer } from '../server/index';
config.botDelayMs = 100000; // keep bots still for the photo
const server = await startServer(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${server.port}/?nolock=1`);
await page.fill('#name', 'Tester');
await page.click('#create');
await page.waitForSelector('#room:not(.hidden)');
for (let i = 0; i < 5; i++) await page.click('#add-bot');
await page.click('#start');
await page.mouse.move(640, 300);
await page.waitForTimeout(4000);
await page.screenshot({ path: process.argv[2] ?? 'snap.png' });
await browser.close();
await server.close();
