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

test('leaving a table resets client state and a new table works afterwards', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const room = () => page.evaluate(() => (window as unknown as { __sh: Hooks }).__sh.room());
  const actions = () => page.evaluate(() => (window as unknown as { __sh: Hooks }).__sh.actions());
  const expectHomeReset = async () => {
    await expect(page.locator('#home')).not.toHaveClass(/hidden/);
    await expect(page.locator('#room')).toHaveClass(/hidden/);
    await expect(page.locator('#hud')).toHaveClass(/hidden/);
    await expect(page.locator('#gameover')).toHaveClass(/hidden/);
    await expect(page.locator('#confirm-leave')).toHaveClass(/hidden/);
    await expect(page.locator('#chat-log > *')).toHaveCount(0);
    await expect(page.locator('#lobby-chat > *')).toHaveCount(0);
    await expect(page.locator('#chat-input')).toHaveValue('');
    expect(await room()).toBeNull();
    expect(await actions()).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('sh-session'))).toBeNull();
  };

  await page.goto(baseURL!);
  await page.fill('#name', 'Ada');

  // Leave from the lobby.
  await page.click('#create');
  await expect(page.locator('#room-code')).toHaveText(/^[A-Z]{4}$/);
  await page.click('#lobby-leave');
  await expectHomeReset();

  // New table, fill with bots, start, chat, then leave mid-game via the confirm dialog.
  await page.click('#create');
  await expect(page.locator('#room')).not.toHaveClass(/hidden/);
  await expect(page.locator('#room-code')).toHaveText(/^[A-Z]{4}$/);
  expect(await room()).not.toBeNull();
  for (let i = 0; i < 4; i++) await page.click('#add-bot');
  await expect(page.locator('#seats li')).toHaveCount(5);
  await page.click('#start');
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('hello table');
  await page.keyboard.press('Enter');
  await expect(page.locator('#chat-log')).toContainText('hello table');
  await page.click('#leave');
  await expect(page.locator('#confirm-leave')).toBeVisible();
  await page.click('#confirm-yes');
  await expectHomeReset();
  // In-flight room/chat updates from the abandoned table must not bring it back.
  await page.waitForTimeout(1500);
  await expectHomeReset();

  // A fresh table still works.
  await page.click('#create');
  await expect(page.locator('#room')).not.toHaveClass(/hidden/);
  await expect(page.locator('#room-code')).toHaveText(/^[A-Z]{4}$/);
  expect(await room()).not.toBeNull();
  await expect(page.locator('#home')).toHaveClass(/hidden/);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a legal action cannot be double-sent while the first is in flight', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Count outgoing 'act' messages.
  await page.addInitScript(() => {
    const w = window as unknown as { __acts: unknown[] };
    w.__acts = [];
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data: Parameters<WebSocket['send']>[0]) {
      try {
        const m = JSON.parse(String(data));
        if (m && m.t === 'act') w.__acts.push(m);
      } catch {
        /* not JSON */
      }
      return orig.call(this, data);
    };
  });
  const actCount = () => page.evaluate(() => (window as unknown as { __acts: unknown[] }).__acts.length);
  const LEGAL = /^(seat-\d+|vote-ja|vote-nein|hand-\d+|veto|peek-\d+)$/;

  await page.goto(baseURL!);
  await page.fill('#name', 'Ada');
  await page.click('#create');
  await expect(page.locator('#room-code')).toHaveText(/^[A-Z]{4}$/);
  for (let i = 0; i < 4; i++) await page.click('#add-bot');
  await expect(page.locator('#seats li')).toHaveCount(5);
  await page.click('#start');
  await expect(page.locator('#hud')).toBeVisible();

  // Play through the night until the human has a legal action (vote, nomination, ...).
  let legal: string[] = [];
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const s = await state(page);
    legal = s.actions.filter((a) => LEGAL.test(a));
    if (legal.length) break;
    if (s.phase === 'night') {
      const id = s.ids.includes('role-card') ? 'role-card' : s.ids.includes('envelope') ? 'envelope' : null;
      if (id) await page.evaluate((i) => (window as unknown as { __sh: Hooks }).__sh.click(i), id);
    }
    await page.waitForTimeout(300);
  }
  expect(legal.length, 'human should reach a legal action').toBeGreaterThan(0);
  const before = await actCount(); // night acks are 'act' messages too

  const target = legal.includes('vote-ja') ? 'vote-ja' : legal[0];
  const second = legal.includes('vote-nein') ? 'vote-nein' : target;
  const result = await page.evaluate(
    ([a, b]) => {
      const h = (window as unknown as { __sh: Hooks }).__sh;
      const first = h.click(a);
      const idsAfter = h.interactables();
      const again = h.click(b);
      const againSame = h.click(a);
      return { first, again, againSame, idsAfter };
    },
    [target, second],
  );
  expect(result.first).toBe(true);
  expect(result.again).toBe(false);
  expect(result.againSame).toBe(false);
  expect(result.idsAfter.filter((i) => LEGAL.test(i))).toEqual([]);
  expect(await actCount()).toBe(before + 1);

  // After the server answers, the guard releasing must not cause any extra send.
  await page.waitForTimeout(1500);
  expect(await actCount()).toBe(before + 1);
  expect(errors, errors.join('\n')).toEqual([]);
});
