import './style.css';
import type { RoomView, ServerMsg } from '../shared/protocol';
import { initAudio, startAmbience } from './audio';
import { Game } from './game';
import { Interactor } from './interact';
import { Net } from './net';
import { World } from './scene/world';
import { UI } from './ui';

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

const net = new Net();
const ui = new UI({
  create: (name) => net.send({ t: 'create', name }),
  join: (code, name) => net.send({ t: 'join', code, name }),
  addBot: () => net.send({ t: 'addBot' }),
  removeBot: () => net.send({ t: 'removeBot' }),
  start: () => net.send({ t: 'start' }),
  leave: () => {
    net.send({ t: 'leave' });
    saveSession(null);
    ui.showHome();
  },
  chat: (text) => net.send({ t: 'chat', text }),
  rematch: () => net.send({ t: 'rematch' }),
});

const world = new World(document.getElementById('app')!);
const interactor = new Interactor(world, document.getElementById('tooltip')!);
const game = new Game(world, interactor, ui, (a) => net.send({ t: 'act', a }));
let room: RoomView | null = null;
let frames = 0;

net.onOpen = () => {
  const s = loadSession();
  if (s) net.send({ t: 'resume', code: s.code, token: s.token });
};
net.onStatus = (s) => ui.setStatus(s);
net.onMessage = (m: ServerMsg) => {
  switch (m.t) {
    case 'welcome':
      saveSession({ code: m.code, token: m.token });
      break;
    case 'room':
      room = m.room;
      ui.showRoom(m.room);
      game.onRoom(m.room);
      break;
    case 'chat':
      ui.addChat(m.name, m.text, m.seat === room?.you);
      if (m.seat !== room?.you) game.onChat(m.seat, m.text);
      break;
    case 'error':
      if (m.fatal) {
        saveSession(null);
        room = null;
        ui.showHome();
      }
      ui.error(m.msg);
      break;
    case 'left':
      room = null;
      saveSession(null);
      ui.showHome();
      break;
    case 'pong':
      break;
  }
};

ui.showHome();
net.connect();

const unlockAudio = () => {
  initAudio();
  startAmbience();
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  game.update(dt);
  world.update(dt);
  interactor.update();
  world.render();
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
  world,
};
