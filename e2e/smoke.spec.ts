// 5 separate browser contexts join one room and play a complete game through the real UI:
// the lobby forms, and raycast mouse clicks on 3D objects (falling back to the same click handler
// via the test hook only if the cursor can't land on the object, e.g. it is off-screen).
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'e2e/screenshots';
const NAMES = ['Ada', 'Bruno', 'Cleo', 'Dmitri', 'Esme'];

interface PageState {
  phase: string | null;
  stage: string | null;
  mine: boolean;
  actions: string[];
  ids: string[];
  winner: string | null;
}

type Hooks = {
  room(): {
    stage: string;
    you: number;
    game: { phase: string; pending: number[]; winner: string | null; players: { acked: boolean }[] } | null;
  } | null;
  actions(): string[];
  interactables(): string[];
  screenPos(id: string): { x: number; y: number } | null;
  hovered(): string | null;
  click(id: string): boolean;
  settled(): boolean;
};

async function state(page: Page): Promise<PageState> {
  return page.evaluate(() => {
    const h = (window as unknown as { __sh: Hooks }).__sh;
    const r = h.room();
    const g = r?.game ?? null;
    return {
      phase: g?.phase ?? null,
      stage: r?.stage ?? null,
      mine: !!g && g.pending.includes(r!.you),
      actions: h.actions(),
      ids: h.interactables(),
      winner: g?.winner ?? null,
    };
  });
}

async function waitSettled(page: Page) {
  await page
    .waitForFunction(() => (window as unknown as { __sh: Hooks }).__sh.settled(), null, { timeout: 4000, polling: 50 })
    .catch(() => {});
}

const stats = { real: 0, fallback: 0 };

/** Moves the real mouse onto a 3D object, waits for the camera to settle, and clicks it. */
async function clickObject(page: Page, id: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const pos = await page.evaluate((i) => (window as unknown as { __sh: Hooks }).__sh.screenPos(i), id);
    if (!pos) break;
    await page.mouse.move(pos.x, pos.y, { steps: 2 });
    await waitSettled(page);
    const hovered = await page.evaluate(() => (window as unknown as { __sh: Hooks }).__sh.hovered());
    if (hovered === id) {
      await page.mouse.down();
      await page.mouse.up();
      stats.real++;
      return;
    }
  }
  const ok = await page.evaluate((i) => (window as unknown as { __sh: Hooks }).__sh.click(i), id);
  if (ok) stats.fallback++;
}

function choose(s: PageState, rand: () => number): string | null {
  if (s.phase === 'night') {
    if (s.ids.includes('role-card') && s.actions.includes('role-card')) return 'role-card';
    if (s.ids.includes('envelope')) return 'envelope';
    return null;
  }
  if (s.ids.includes('inv-card')) return 'inv-card';
  if (!s.actions.length) return null;
  // Lean towards Ja so governments form and the game reaches an ending.
  if (s.actions.includes('vote-ja') && rand() < 0.8) return 'vote-ja';
  return s.actions[Math.floor(rand() * s.actions.length)];
}

test('five players complete a full game through the 3D UI', async ({ browser, baseURL }) => {
  mkdirSync(SHOTS, { recursive: true });
  const errors: string[] = [];
  const pages: Page[] = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${NAMES[i]}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${NAMES[i]} console] ${m.text()}`));
    await page.goto(baseURL!);
    pages.push(page);
  }

  // Lobby: host creates, others join with the code.
  const [host] = pages;
  await host.screenshot({ path: `${SHOTS}/01-home.png` });
  await host.fill('#name', NAMES[0]);
  await host.click('#create');
  await expect(host.locator('#room-code')).toHaveText(/^[A-Z]{4}$/);
  const code = (await host.locator('#room-code').textContent())!;
  for (let i = 1; i < 5; i++) {
    await pages[i].fill('#name', NAMES[i]);
    await pages[i].fill('#code', code);
    await pages[i].click('#join');
  }
  await expect(host.locator('#seats li')).toHaveCount(5);
  await host.screenshot({ path: `${SHOTS}/02-lobby.png` });
  await host.click('#start');
  await expect(host.locator('#hud')).toBeVisible();

  // Chat once so speech bubbles get exercised.
  await pages[2].keyboard.press('Enter');
  await pages[2].keyboard.type('I am definitely a liberal.');
  await pages[2].keyboard.press('Enter');

  let seed = 12345;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const shotTaken = new Set<string>();
  let shotNo = 3;
  const deadline = Date.now() + 18 * 60_000;
  let finished = false;

  while (Date.now() < deadline && !finished) {
    let acted = false;
    const states = await Promise.all(pages.map(state));
    finished = states.every((s) => s.phase === 'gameOver');
    for (let i = 0; i < pages.length && !finished; i++) {
      const s = states[i];
      const key = `${s.phase}-${s.mine ? 'acting' : 'waiting'}`;
      if (s.phase && !shotTaken.has(key) && s.phase !== 'gameOver') {
        shotTaken.add(key);
        await pages[i].waitForTimeout(600);
        await pages[i].screenshot({ path: `${SHOTS}/${String(shotNo++).padStart(2, '0')}-${NAMES[i]}-${key}.png` });
      }
      const id = choose(s, rand);
      if (!id) continue;
      await clickObject(pages[i], id);
      acted = true;
      await pages[i].waitForTimeout(250);
    }
    if (!acted) await host.waitForTimeout(300);
  }

  expect(finished, 'game should reach gameOver on every client').toBe(true);
  await host.waitForTimeout(2500);
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: `${SHOTS}/${String(shotNo++).padStart(2, '0')}-${NAMES[i]}-gameOver.png` });
  }
  const winners = new Set((await Promise.all(pages.map(state))).map((s) => s.winner));
  expect(winners.size).toBe(1);
  expect([...winners][0]).toMatch(/liberal|fascist/);
  await expect(host.locator('#gameover')).toBeVisible();
  console.log(`clicks: ${stats.real} real raycast clicks, ${stats.fallback} hook fallbacks`);
  expect(stats.real).toBeGreaterThan(stats.fallback);
  expect(errors, errors.join('\n')).toEqual([]);
});
