// DOM overlay: lobby, HUD, prompt, timer, chat, toasts, credits, game over. Always textContent, never innerHTML with user data.
import type { RoomView } from '../shared/protocol';
import type { Power } from '../shared/types';
import type { GameView } from '../shared/view';
import type { HudModel } from './hudmodel';
import { isMuted, setMuted } from './audio';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UIHandlers {
  create(name: string): void;
  join(code: string, name: string): void;
  addBot(): void;
  removeBot(): void;
  start(): void;
  leave(): void;
  chat(text: string): void;
  rematch(): void;
}

const REASONS: Record<string, string> = {
  liberalPolicies: 'Five Liberal policies were enacted.',
  hitlerExecuted: 'Hitler was executed.',
  fascistPolicies: 'Six Fascist policies were enacted.',
  hitlerElected: 'Hitler was elected Chancellor.',
};

const POWER_GLYPHS: Record<Power, string> = { peek: '👁', investigate: '🔍', special: '★', execute: '✕' };

export class UI {
  private chatOpen = false;
  private timerText: string | null = null;
  private timerClass: string | null = null;
  private timerMax = 0;
  private room: RoomView | null = null;
  private copyLabels = new Map<string, string>();
  private copyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private errorTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private h: UIHandlers) {
    const nameInput = $<HTMLInputElement>('name');
    try {
      nameInput.value = localStorage.getItem('sh-name') ?? '';
    } catch {
      /* storage unavailable */
    }
    const name = () => {
      const n = nameInput.value.trim();
      if (!n) {
        this.error('Pick a name first.');
        nameInput.focus();
        return null;
      }
      try {
        localStorage.setItem('sh-name', n);
      } catch {
        /* ignore */
      }
      return n;
    };
    $('create').onclick = () => {
      const n = name();
      if (n) h.create(n);
    };
    $('join').onclick = () => {
      const n = name();
      const code = $<HTMLInputElement>('code').value.trim().toUpperCase();
      if (!n) return;
      if (code.length !== 4) return this.error('Room codes have four letters.');
      h.join(code, n);
    };
    $<HTMLInputElement>('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('join').click());
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && $(this.invite ? 'join' : 'create').click());
    $('add-bot').onclick = () => h.addBot();
    $('remove-bot').onclick = () => h.removeBot();
    $('start').onclick = () => h.start();
    $('lobby-leave').onclick = () => h.leave();
    $('leave').onclick = () => {
      if (this.room?.stage === 'game' && this.room.game?.phase !== 'gameOver') {
        $('confirm-leave').classList.remove('hidden');
      } else h.leave();
    };
    $('confirm-yes').onclick = () => {
      $('confirm-leave').classList.add('hidden');
      h.leave();
    };
    $('confirm-no').onclick = () => $('confirm-leave').classList.add('hidden');
    $('rematch').onclick = () => h.rematch();
    $('gameover-leave').onclick = () => h.leave();
    for (const id of ['credits-btn', 'home-credits']) $(id).onclick = () => $('credits').classList.remove('hidden');
    $('credits-close').onclick = () => $('credits').classList.add('hidden');
    $('rules-btn').onclick = () => $('rules').classList.remove('hidden');
    // Settings popover: the toggles keep it open so their label change is visible; any other row closes it.
    const settings = $('settings');
    const settingsBtn = $('settings-btn');
    const setSettings = (open: boolean) => {
      settings.classList.toggle('hidden', !open);
      settingsBtn.setAttribute('aria-expanded', String(open));
    };
    settingsBtn.onclick = () => setSettings(settings.classList.contains('hidden'));
    settings.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('button');
      if (row && !row.matches('.graphics-toggle, .music-toggle, #sound')) setSettings(false);
    });
    window.addEventListener('click', (e) => {
      const t = e.target as Node;
      if (!settings.contains(t) && !settingsBtn.contains(t)) setSettings(false);
    });
    $('rules-close').onclick = () => $('rules').classList.add('hidden');
    $('sound').onclick = () => {
      setMuted(!isMuted());
      $('sound').textContent = isMuted() ? 'Sound: off' : 'Sound: on';
    };
    $('copy-code').onclick = () => this.copy(this.room?.code ?? '', 'copy-code', 'copied');
    $('copy-invite').onclick = () => this.copy(UI.inviteLink(this.room?.code ?? ''), 'copy-invite', 'Link copied!');
    $('invite-link').onclick = () => $<HTMLInputElement>('invite-link').select();

    const input = $<HTMLInputElement>('chat-input');
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.activeElement !== input && !$('hud').classList.contains('hidden')) {
        if (input.disabled) return;
        e.preventDefault();
        input.focus();
        this.chatOpen = true;
      } else if (e.key === 'Escape') {
        input.blur();
        setSettings(false);
        $('credits').classList.add('hidden');
        $('rules').classList.add('hidden');
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) h.chat(text);
        input.value = '';
        input.blur();
        this.chatOpen = false;
        e.stopPropagation();
      }
    });
  }

  private invite: string | null = null;

  /** Deterministic avatar hue (0-359) from a name. */
  private static hue(name: string): number {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
    return h;
  }

  static inviteLink(code: string): string {
    return `${location.origin}/?join=${code}`;
  }

  /** Copies text, confirming on the button itself (toasts are hidden in the lobby). */
  private copy(text: string, buttonId: string, done: string) {
    const btn = $(buttonId);
    // Remember the original label once so repeat clicks don't capture the confirmation text.
    if (!this.copyLabels.has(buttonId)) this.copyLabels.set(buttonId, btn.textContent ?? '');
    const label = this.copyLabels.get(buttonId)!;
    const confirm = (msg: string) => {
      btn.textContent = msg;
      clearTimeout(this.copyTimers.get(buttonId));
      this.copyTimers.set(buttonId, setTimeout(() => (btn.textContent = label), 1800));
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => confirm(done), () => this.selectInvite(confirm));
    } else this.selectInvite(confirm);
  }

  private selectInvite(confirm: (msg: string) => void) {
    $<HTMLInputElement>('invite-link').select();
    confirm('Press Ctrl+C');
  }

  /** Arrived through an invite link: pre-fill the table code and make Join the main action. */
  setInvite(code: string) {
    this.invite = code;
    $<HTMLInputElement>('code').value = code;
    $('invite-code').textContent = code;
    $('invite-banner').classList.remove('hidden');
    $('join').classList.add('primary');
    $('join').textContent = `Join table ${code}`;
    $('create').classList.remove('primary');
    $('create').classList.add('link');
    $('create').textContent = 'or open your own table';
    // Invited layout: name, one big Join button, then the option to start your own table.
    const join = $('join');
    const row = join.parentElement!;
    $('create').before(join);
    join.style.width = '100%';
    row.classList.add('hidden');
    document.querySelector('#home .or')?.classList.add('hidden');
    $<HTMLInputElement>('name').focus();
  }

  showHome() {
    this.room = null;
    $('lobby').classList.remove('hidden');
    $('home').classList.remove('hidden');
    $('room').classList.add('hidden');
    $('hud').classList.add('hidden');
    this.hideGameOver();
  }

  resetTable() {
    $('chat-log').replaceChildren();
    $('lobby-chat').replaceChildren();
    $('confirm-leave').classList.add('hidden');
    this.hideGameOver();
    this.setTimer(null, false);
    const input = $<HTMLInputElement>('chat-input');
    input.blur();
    input.value = '';
    this.chatOpen = false;
  }

  showRoom(room: RoomView) {
    this.room = room;
    $('room-code').textContent = room.code;
    $<HTMLInputElement>('invite-link').value = UI.inviteLink(room.code);
    $('hud-code').textContent = room.code;
    if (room.stage === 'lobby') {
      $('lobby').classList.remove('hidden');
      $('home').classList.add('hidden');
      $('room').classList.remove('hidden');
      $('hud').classList.add('hidden');
      const list = $('seats');
      list.replaceChildren();
      room.seats.forEach((s) => {
        const li = document.createElement('li');
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.style.setProperty('--hue', String(UI.hue(s.name)));
        avatar.textContent = [...s.name][0] ?? '?';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = s.name;
        li.append(avatar, name);
        const tags: string[] = [];
        if (s.seat === room.host) tags.push('host');
        if (s.seat === room.you) tags.push('you');
        if (s.bot) tags.push('bot');
        if (!s.connected) tags.push('away');
        if (tags.length) {
          const box = document.createElement('span');
          box.className = 'tags';
          for (const t of tags) {
            const pill = document.createElement('span');
            pill.className = `pill ${t}`;
            pill.textContent = t;
            box.appendChild(pill);
          }
          li.appendChild(box);
        }
        list.appendChild(li);
      });
      const isHost = room.you === room.host;
      $('host-controls').classList.toggle('hidden', !isHost);
      $('guest-note').classList.toggle('hidden', isHost);
      const n = room.seats.length;
      $<HTMLButtonElement>('start').disabled = n < 5;
      $<HTMLButtonElement>('add-bot').disabled = n >= 10;
      $<HTMLButtonElement>('remove-bot').disabled = !room.seats.some((s) => s.bot);
      $('seat-count').textContent = `${n} / 10 seated${n < 5 ? ` · need ${5 - n} more to start` : ''}`;
    } else {
      $('lobby').classList.add('hidden');
      $('hud').classList.remove('hidden');
    }
  }

  /** Renders the status bar, phase stepper and action card from the pure HUD model (null: no game yet). */
  renderHud(model: HudModel | null, mine: boolean, fallback = '') {
    this.renderStatus(model);
    this.renderStepper(model);
    const card = $('prompt');
    const title = model ? model.action.title : fallback;
    card.classList.toggle('hidden', !title);
    card.classList.toggle('mine', mine);
    const action = model?.action;
    $('pr-chip').classList.toggle('hidden', !mine);
    $('pr-title').textContent = title;
    $('pr-detail').textContent = action?.detail ?? '';
    const wait = $('pr-wait');
    const waiting = !mine && !!action && action.waitingOn.length > 0;
    wait.classList.toggle('hidden', !waiting);
    wait.replaceChildren();
    if (waiting) {
      wait.append(document.createTextNode(`Waiting on ${action.waitingOn.join(', ')}`));
      const ell = document.createElement('span');
      ell.className = 'ell';
      wait.appendChild(ell);
    }
    const verb = $('pr-verb');
    const v = mine && action?.verb ? action.verb : null;
    verb.classList.toggle('hidden', !v);
    verb.textContent = v ? v.toUpperCase() : '';
    verb.className = v ? `verb ${v}` : 'verb hidden';
  }

  private renderStatus(model: HudModel | null) {
    const bar = $('status-bar');
    bar.classList.toggle('hidden', !model);
    if (!model) return;
    const st = model.status;
    const me = model.roster.find((r) => r.you);
    const chip = $('sb-role');
    chip.textContent = [me?.name, st.alive ? st.roleLabel : '✝'].filter(Boolean).join(' · ');
    chip.className = `chip ${!st.alive ? 'dead' : st.role === 'liberal' ? 'lib' : st.role ? 'fas' : ''}`;
    const pips = (id: string, total: number, filled: number, powers?: (Power | null)[]) => {
      $(id).replaceChildren(
        ...Array.from({ length: total }, (_, i) => {
          const pip = document.createElement('i');
          pip.className = i < filled ? 'pip on' : 'pip';
          const power = powers?.[i];
          if (power && i >= filled) pip.textContent = POWER_GLYPHS[power];
          return pip;
        }),
      );
    };
    pips('sb-lib', 5, st.liberal);
    pips('sb-fas', 6, st.fascist, st.powers);
    pips('sb-tracker', 3, st.tracker);
    $('sb-deck').textContent = `Deck ${st.deck}`;
    $('sb-discard').textContent = `Discard ${st.discard}`;
  }

  private renderStepper(model: HudModel | null) {
    const el = $('stepper');
    const step = model?.step ?? null;
    el.classList.toggle('hidden', !step);
    if (!step) return;
    el.replaceChildren(
      ...step.labels.map((label, i) => {
        const seg = document.createElement('span');
        seg.className = i < step.index ? 'seg done' : i === step.index ? 'seg cur' : 'seg';
        seg.textContent = i < step.index ? `✓ ${label}` : label;
        return seg;
      }),
    );
  }

  setTimer(secs: number | null, mine: boolean) {
    const text = secs === null ? '' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const cls = secs !== null && mine ? (secs <= 10 ? 'urgent' : 'mine') : '';
    if (text === this.timerText && cls === this.timerClass) return;
    this.timerText = text;
    this.timerClass = cls;
    // The bar's full length is the largest value seen since the timer last cleared.
    this.timerMax = secs === null ? 0 : Math.max(this.timerMax, secs);
    const el = $('timer');
    el.textContent = text;
    el.className = cls;
    const bar = $('timer-bar');
    bar.className = cls;
    bar.classList.toggle('hidden', secs === null);
    $('timer-fill').style.transform = `scaleX(${secs === null || !this.timerMax ? 0 : secs / this.timerMax})`;
  }

  toast(text: string, kind = 'info') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild?.remove();
    setTimeout(() => el.classList.add('fade'), 4200);
    setTimeout(() => el.remove(), 5000);
  }

  error(text: string) {
    const el = $('lobby-error');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => el.classList.add('hidden'), 5000);
    if (!$('hud').classList.contains('hidden')) this.toast(text, 'bad');
  }

  flash() {
    const el = $('flash');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  addChat(name: string, text: string, self: boolean) {
    const log = $('chat-log');
    const line = document.createElement('div');
    line.className = self ? 'line self' : 'line';
    const who = document.createElement('b');
    who.textContent = `${name}: `;
    line.append(who, document.createTextNode(text));
    log.appendChild(line);
    while (log.children.length > 40) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
    if (this.room?.stage === 'lobby') {
      const ll = $('lobby-chat');
      const l2 = line.cloneNode(true);
      ll.appendChild(l2);
      while (ll.children.length > 6) ll.firstElementChild?.remove();
    }
  }

  setChatEnabled(on: boolean) {
    const input = $<HTMLInputElement>('chat-input');
    input.disabled = !on;
    input.placeholder = on ? 'Press Enter to talk…' : 'The dead are silent.';
  }

  showGameOver(v: GameView, room: RoomView) {
    const el = $('gameover');
    el.classList.remove('hidden');
    const title = $('gameover-title');
    title.textContent = v.winner === 'liberal' ? 'The Liberals win' : 'The Fascists win';
    title.className = v.winner ?? '';
    $('gameover-reason').textContent = REASONS[v.winReason ?? ''] ?? '';
    const list = $('gameover-roles');
    list.replaceChildren();
    for (const p of v.players) {
      const li = document.createElement('li');
      li.textContent = `${p.name}${p.seat === room.you ? ' (you)' : ''}`;
      const span = document.createElement('span');
      span.className = `tag ${p.role === 'liberal' ? 'liberal' : 'fascist'}`;
      span.textContent = `${p.role === 'hitler' ? 'Hitler' : p.role === 'fascist' ? 'Fascist' : 'Liberal'}${p.alive ? '' : ' ✝'}`;
      li.appendChild(span);
      list.appendChild(li);
    }
    $('rematch').classList.toggle('hidden', room.you !== room.host);
  }

  hideGameOver() {
    $('gameover').classList.add('hidden');
  }

  setStatus(text: string) {
    $('status').textContent = text;
    $('status').classList.toggle('hidden', !text);
  }
}
