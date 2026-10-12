import './style.css';
import type { RoomView, ServerMsg } from '../shared/protocol';
import { initAudio, isMusicOn, setMusicOn, startMusic } from './audio';
import { Game } from './game';
import { applyStatic, lang, onLangChange, setLang, tr } from './i18n';
import { Interactor } from './interact';
import { Net } from './net';
import { translateServerError } from './servererrors';
import { createPerfHud } from './perf';
import { loadAssets } from './scene/assets';
import { loadOfficialArt } from './scene/officialart';
import { GRAPHICS_MODES, saveGraphicsPref } from './scene/quality';
import { redrawTextures } from './scene/textures';
import { World } from './scene/world';
import { UI } from './ui';

// Canvas textures drawn before the webfonts arrived used the fallback font: redraw them once fonts land.
if ('fonts' in document) document.fonts.addEventListener('loadingdone', () => redrawTextures());
// Canvas text never triggers a font load by itself, so request the faces textures.ts draws with.
if (document.fonts) {
  const faces = ['800 48px "Big Shoulders Display"', '800 48px "Jost"', '400 48px "Courier Prime"', '400 48px "UnifrakturMaguntia"'];
  void Promise.all(faces.map((f) => document.fonts.load(f)))
    .then(() => redrawTextures())
    // A failed load just leaves the fallback fonts on the textures.
    .catch(() => {});
}

interface Session {
  code: string;
  token: string;
}

const SESSION_KEY = 'sh-session';
function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: reconnect just won't survive reloads */
  }
}

let leaving = false; // Leave sent, `left` not yet received: ignore in-flight room/chat updates
const net = new Net();
const ui = new UI({
  create: (name) => {
    leaving = false;
    net.send({ t: 'create', name, lang: lang() });
  },
  quickStart: (name) => {
    leaving = false;
    net.send({ t: 'quickStart', name, lang: lang() });
  },
  join: (code, name) => {
    leaving = false;
    net.send({ t: 'join', code, name });
  },
  addBot: () => net.send({ t: 'addBot' }),
  removeBot: () => net.send({ t: 'removeBot' }),
  start: () => net.send({ t: 'start' }),
  leave: () => {
    net.send({ t: 'leave' });
    leaving = true;
    resetClient();
  },
  chat: (text) => net.send({ t: 'chat', text }),
  rematch: () => net.send({ t: 'rematch' }),
  playAgain: () => net.send({ t: 'playAgain' }),
  redeal: () => net.send({ t: 'redeal' }),
  setPace: (pace) => net.send({ t: 'setOptions', pace }),
  setBotLevel: (botLevel) => net.send({ t: 'setOptions', botLevel }),
});

const world = new World(document.getElementById('app')!);
const interactor = new Interactor(
  world,
  document.getElementById('tooltip')!,
  document.getElementById('crosshair')!,
  document.getElementById('lock-hint')!,
);
const game = new Game(world, interactor, ui, (a) => net.send({ t: 'act', a }));
interactor.cardMode = () => game.cardMode();
let room: RoomView | null = null;
let frames = 0;

function resetClient() {
  room = null;
  net.flushAct(null);
  saveSession(null);
  game.reset();
  ui.resetTable();
  ui.showHome();
}

net.onOpen = () => {
  game.connectionReset();
  const s = loadSession();
  if (s) net.send({ t: 'resume', code: s.code, token: s.token });
};
net.onStatus = (s) => ui.setStatus(s);
net.actContext = () => (room?.game ? { phase: room.game.phase, seat: room.you } : null);
net.onReconnect = () => ui.toast(tr({ en: 'Reconnected', es: 'Reconectado' }));
net.onMessage = (m: ServerMsg) => {
  switch (m.t) {
    case 'welcome':
      leaving = false;
      saveSession({ code: m.code, token: m.token });
      // Drop ?join= so a reload resumes the seat instead of re-joining.
      if (location.search.includes('join=')) history.replaceState(null, '', location.pathname);
      break;
    case 'room':
      if (leaving) break;
      room = m.room;
      net.flushAct(m.room);
      world.stillView = m.room.stage !== 'game';
      ui.showRoom(m.room);
      game.onRoom(m.room);
      interactor.setLockable(m.room.stage === 'game' && m.room.game?.phase !== 'gameOver');
      break;
    case 'chat':
      if (leaving) break;
      ui.addChat(m.name, m.text, m.seat === room?.you);
      if (m.seat !== room?.you) game.onChat(m.seat, m.text);
      break;
    case 'error':
      if (m.fatal) {
        leaving = false;
        resetClient();
      } else if (m.for === 'act') game.actionRejected();
      ui.error(translateServerError(m.msg));
      break;
    case 'left':
      leaving = false;
      resetClient();
      break;
    case 'pong':
      break;
  }
};

ui.showHome();
// Invite links look like /?join=ABCD.
const invite = new URLSearchParams(location.search).get('join')?.trim().toUpperCase() ?? '';
if (/^[A-Z]{4}$/.test(invite)) {
  const s = loadSession();
  if (s && s.code !== invite) saveSession(null); // the invite wins over an old table
  if (!s || s.code !== invite) ui.setInvite(invite);
}
// Official card and board art: cached canvas textures repaint once it lands; until then they show a plain fallback.
void loadOfficialArt().then((n) => {
  if (n) redrawTextures();
});
// Models load first so the scene can use them; a slow or failed load must not hold the table up.
void Promise.race([loadAssets(), new Promise<null>((r) => setTimeout(r, 10_000))])
  .then((assets) => {
    if (assets) world.useAssets(assets);
  })
  .catch((err) => console.warn('[assets] could not apply, keeping the procedural room', err))
  .then(() => net.connect());
const showHome = ui.showHome.bind(ui);
ui.showHome = () => {
  interactor.setLockable(false);
  world.stillView = true;
  showHome();
};

const unlockAudio = () => {
  initAudio();
  startMusic();
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// ?perf HUD: read now, the welcome handler's history.replaceState drops the query string later.
const perf = new URLSearchParams(location.search).has('perf') ? createPerfHud(world.renderer) : null;

let last = performance.now();
let frozen = false; // test hook: sim only advances via __sh.step
function frame(t: number) {
  const frameMs = t - last;
  // The first rAF timestamp can predate `last` (slow startup), and a negative dt runs every easing backwards.
  const dt = Math.max(0, Math.min(0.1, frameMs / 1000));
  last = t;
  if (!frozen) {
    const s = game.timeScale(dt);
    game.update(dt * s);
    world.update(dt * s);
  }
  interactor.update();
  world.render(frameMs);
  perf?.tick(t);
  frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hooks: Playwright drives the real UI through these (same click path as the mouse).
declare global {
  interface Window {
    __sh: unknown;
  }
}
window.__sh = {
  room: () => room,
  frames: () => frames,
  actions: () => [...interactor.items.values()].filter((i) => i.action).map((i) => i.id),
  interactables: () => [...interactor.items.keys()],
  screenPos: (id: string) => interactor.screenPos(id),
  hovered: () => interactor.hovered,
  click: (id: string) => interactor.activate(id),
  prompt: () => document.getElementById('prompt')?.textContent ?? '',
  settled: () => world.settled(),
  perf: () => perf?.stats() ?? null,
  freeze: (on: boolean) => {
    frozen = on;
  },
  step: (seconds: number) => {
    for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
      game.update(1 / 60);
      world.update(1 / 60);
    }
    world.render();
  },
  world,
};


// Graphics toggle cycles auto / high / low (lobby and in-game buttons share one setting, remembered between visits).
const graphicsButtons = [...document.querySelectorAll<HTMLButtonElement>('.graphics-toggle')];
const showGraphics = () => graphicsButtons.forEach((b) => (b.textContent = `${tr({ en: 'Graphics', es: 'Gráficos' })}: ${tr({ en: world.graphicsMode, es: { auto: 'auto', high: 'alto', low: 'bajo' }[world.graphicsMode] })}`));
showGraphics();
graphicsButtons.forEach((b) =>
  b.addEventListener('click', () => {
    const mode = GRAPHICS_MODES[(GRAPHICS_MODES.indexOf(world.graphicsMode) + 1) % GRAPHICS_MODES.length];
    world.setGraphicsMode(mode);
    saveGraphicsPref(mode);
    showGraphics();
  }),
);

// Music toggle (lobby and in-game buttons share one setting, remembered between visits).
const musicButtons = [...document.querySelectorAll<HTMLButtonElement>('.music-toggle')];
const showMusic = () => musicButtons.forEach((b) => (b.textContent = `${tr({ en: 'Music', es: 'Música' })}: ${isMusicOn() ? tr({ en: 'on', es: 'sí' }) : tr({ en: 'off', es: 'no' })}`));
showMusic();
musicButtons.forEach((b) =>
  b.addEventListener('click', () => {
    setMusicOn(!isMusicOn());
    showMusic();
  }),
);

// Language toggle (lobby and in-game buttons): the label names the other language; static markup is swapped live.
const langButtons = [...document.querySelectorAll<HTMLButtonElement>('.lang-toggle')];
const showLang = () => langButtons.forEach((b) => (b.textContent = lang() === 'en' ? 'Español' : 'English'));
applyStatic(document);
showLang();
langButtons.forEach((b) => b.addEventListener('click', () => setLang(lang() === 'en' ? 'es' : 'en')));
onLangChange(() => {
  applyStatic(document);
  showLang();
  // applyStatic reset every data-es element: redo the text that JS sets itself.
  showGraphics();
  showMusic();
  ui.relang();
  game.relang();
});
