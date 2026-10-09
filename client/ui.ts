// DOM overlay: lobby, HUD, prompt, timer, chat, toasts, credits, game over. Always textContent, never innerHTML with user data.
import type { RoomView } from '../shared/protocol';
import type { GameView } from '../shared/view';
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

export class UI {
  private chatOpen = false;
  private room: RoomView | null = null;

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

  static inviteLink(code: string): string {
    return `${location.origin}/?join=${code}`;
  }

  /** Copies text, confirming on the button itself (toasts are hidden in the lobby). */
  private copy(text: string, buttonId: string, done: string) {
    const btn = $(buttonId);
    const label = btn.textContent;
    const confirm = (msg: string) => {
      btn.textContent = msg;
      setTimeout(() => (btn.textContent = label), 1800);
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
        li.textContent = s.name;
        const tags: string[] = [];
        if (s.seat === room.host) tags.push('host');
        if (s.seat === room.you) tags.push('you');
        if (s.bot) tags.push('bot');
        if (!s.connected) tags.push('away');
        if (tags.length) {
          const span = document.createElement('span');
          span.className = 'tag';
          span.textContent = tags.join(' · ');
          li.appendChild(span);
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
      const g = room.game!;
      const me = g.players[room.you];
      const role = g.yourRole ? (g.yourRole === 'hitler' ? 'Hitler' : g.yourRole === 'fascist' ? 'Fascist' : 'Liberal') : '';
      $('hud-role').textContent = role ? `${me.name} · ${role}${me.alive ? '' : ' (dead)'}` : me.name;
      $('hud-role').className = g.yourRole === 'liberal' ? 'liberal' : 'fascist';
      $('hud-round').textContent = `Round ${g.round} · L ${g.liberal}/5 · F ${g.fascist}/6 · tracker ${g.tracker}/3 · deck ${g.deckCount}`;
    }
  }

  setPrompt(text: string, mine: boolean) {
    const el = $('prompt');
    el.textContent = text;
    el.classList.toggle('mine', mine);
  }

  setTimer(secs: number | null, mine: boolean) {
    const el = $('timer');
    if (secs === null) {
      el.textContent = '';
      el.className = '';
      return;
    }
    el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    el.className = mine && secs <= 10 ? 'urgent' : mine ? 'mine' : '';
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
    setTimeout(() => el.classList.add('hidden'), 5000);
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
