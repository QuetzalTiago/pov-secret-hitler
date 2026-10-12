// DOM overlay: lobby, HUD, prompt, timer, chat, toasts, credits, game over. Always textContent, never innerHTML with user data.
import { BOT_LEVELS, PACES, type BotLevel, type Pace, type RoomView, type Series } from '../shared/protocol';
import type { Power } from '../shared/types';
import type { GameView, PlayerView } from '../shared/view';
import type { Badge, CardConfirmCopy, HudModel, ScreenBlood } from './hudmodel';
import { SCREEN_BLOOD_S, screenBloodFrame, screenSplats, type ScreenSplat } from './screenblood';
import { portraitUrl, sealUrl } from './art';
import { isMuted, setMuted } from './audio';
import { nearBottom } from './chatscroll';
import { ENACT_BANNER_MS, enactBanner } from './enact';
import { fullscreenSupported, isFullscreen, isFullscreenKey, toggleFullscreen } from './fullscreen';
import { loadRecord, recordGame, recordLine, saveRecord } from './record';
import { REASONS, VICTORY_MS, victoryParticles, type VictoryBanner } from './victory';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface UIHandlers {
  create(name: string): void;
  quickStart(name: string): void;
  join(code: string, name: string): void;
  addBot(): void;
  setPace(pace: Pace): void;
  setBotLevel(level: BotLevel): void;
  removeBot(): void;
  start(): void;
  leave(): void;
  chat(text: string): void;
  rematch(): void;
  playAgain(): void;
  redeal(): void;
}

/** One line of series score for the lobby and game-over panel; '' before any game was played. */
export function seriesLine(series: Series, names: string[]): string {
  if (series.liberal + series.fascist === 0) return '';
  const wins = names
    .map((n) => [n, (Object.hasOwn(series.wins, n) ? series.wins[n] : 0)] as const)
    .filter(([, w]) => w >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([n, w]) => `${n} ${w}`);
  return ['Series', `Liberals ${series.liberal} – Fascists ${series.fascist}`, ...(wins.length ? [wins.join(', ')] : [])].join(' · ');
}

const POWER_GLYPHS: Record<Power, string> = { peek: '👁', investigate: '🔍', special: '★', execute: '✕' };

/** One game-over roster row: official role card thumbnail, name, role tag. */
export function gameOverRow(p: PlayerView, you: number): HTMLLIElement {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.className = 'portrait';
  img.alt = '';
  img.width = 48;
  img.height = 68;
  img.src = portraitUrl(p.role === 'hitler' ? 'hitler' : p.role === 'fascist' ? 'fascist' : 'liberal');
  li.appendChild(img);
  li.appendChild(document.createTextNode(`${p.name}${p.seat === you ? ' (you)' : ''}`));
  const span = document.createElement('span');
  span.className = `tag ${p.role === 'liberal' ? 'liberal' : 'fascist'}`;
  span.textContent = `${p.role === 'hitler' ? 'Hitler' : p.role === 'fascist' ? 'Fascist' : 'Liberal'}${p.alive ? '' : ' ✝'}`;
  li.appendChild(span);
  return li;
}

/** Game-over roster order: Hitler, then Fascists, then Liberals, each by seat. */
export function gameOverOrder(players: PlayerView[]): PlayerView[] {
  const rank = (p: PlayerView) => (p.role === 'hitler' ? 0 : p.role === 'fascist' ? 1 : p.role === 'liberal' ? 2 : 3);
  return [...players].sort((a, b) => rank(a) - rank(b) || a.seat - b.seat);
}

export class UI {
  private chipKey = '';
  private timerText: string | null = null;
  private timerClass: string | null = null;
  private timerMax = 0;
  private room: RoomView | null = null;
  private copyLabels = new Map<string, string>();
  private copyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private enactTimer: ReturnType<typeof setTimeout> | undefined;
  private enactOn = false;
  private victoryTimers: ReturnType<typeof setTimeout>[] = [];
  private victoryDone: (() => void) | null = null;
  private rosterKey = '';
  private bloodSplats: ScreenSplat[] = [];
  private bloodStart = 0;
  private bloodRaf = 0;
  private markers = new Map<string, { key: string; label: string; w: number; h: number }>();
  /** Set by the game: a roster row was clicked, turn the camera to that seat. */
  onLookAt?: (seat: number) => void;
  onMark?: (seat: number) => void;
  /** Set by the game: the player skipped the Extrablatt banner. */
  onEnactSkip: (() => void) | null = null;

  constructor(h: UIHandlers) {
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
    $('quick-start').onclick = () => {
      const n = name();
      if (n) h.quickStart(n);
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
    for (const pace of PACES) $(`pace-${pace}`).onclick = () => h.setPace(pace);
    for (const level of BOT_LEVELS) $(`bot-level-${level}`).onclick = () => h.setBotLevel(level);
    $('remove-bot').onclick = () => h.removeBot();
    $('start').onclick = () => h.start();
    $('lobby-leave').onclick = () => h.leave();
    $('leave').onclick = () => {
      if (this.room?.stage === 'game' && this.room.game?.phase !== 'gameOver') {
        this.openDialog('confirm-leave');
      } else h.leave();
    };
    $('confirm-yes').onclick = () => {
      $('confirm-leave').classList.add('hidden');
      h.leave();
    };
    $('confirm-no').onclick = () => $('confirm-leave').classList.add('hidden');
    // Enter confirms and Esc cancels the policy pick (unless typing in chat).
    window.addEventListener('keydown', (e) => {
      if (!this.cardConfirm) return;
      if (!$('confirm-leave').classList.contains('hidden')) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter') this.cardConfirm.confirm();
      else if (e.key === 'Escape') this.cardConfirm.cancel();
      else return;
      // Registered before the chat handler: keep Enter from also opening chat.
      e.preventDefault();
      e.stopImmediatePropagation();
    });
    $('cc-confirm').onclick = () => this.cardConfirm?.confirm();
    $('cc-cancel').onclick = () => this.cardConfirm?.cancel();
    $('rematch').onclick = () => h.rematch();
    $('play-again').onclick = () => h.playAgain();
    $('redeal').onclick = () => h.redeal();
    $('gameover-leave').onclick = () => h.leave();
    for (const id of ['credits-btn', 'home-credits']) $(id).onclick = () => this.openDialog('credits');
    $('credits-close').onclick = () => $('credits').classList.add('hidden');
    $('rules-btn').onclick = () => this.openDialog('rules');
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
    const fsBtn = $('fullscreen-btn');
    const fsHint = $('fs-hint');
    if (!fullscreenSupported()) {
      fsBtn.classList.add('hidden');
      fsHint.classList.add('hidden');
    }
    else {
      fsBtn.onclick = () => toggleFullscreen();
      window.addEventListener('keydown', (e) => {
        if (isFullscreenKey(e, document.activeElement)) {
          e.preventDefault();
          toggleFullscreen();
        }
      });
      document.addEventListener('fullscreenchange', () => {
        const on = isFullscreen();
        const label = on ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
        fsBtn.setAttribute('aria-label', label);
        fsBtn.title = label;
        fsBtn.setAttribute('aria-pressed', String(on));
        fsHint.classList.toggle('hidden', on);
      });
    }
    $('copy-code').onclick = () => this.copy(this.room?.code ?? '', 'copy-code', 'copied');
    $('copy-invite').onclick = () => this.copy(UI.inviteLink(this.room?.code ?? ''), 'copy-invite', 'Link copied!');
    $('invite-link').onclick = () => $<HTMLInputElement>('invite-link').select();

    // Capture phase: a click or Space that skips the banner must not also act on the table.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.enactOn) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.skipEnact();
      },
      { capture: true },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        const t = document.activeElement;
        if (e.key !== ' ' || !this.enactOn || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.skipEnact();
      },
      { capture: true },
    );

    $('victory').onclick = () => this.finishVictory();
    window.addEventListener('keydown', (e) => {
      if (this.victoryDone && (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.finishVictory();
      }
    });

    const input = $<HTMLInputElement>('chat-input');
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.activeElement !== input && !$('hud').classList.contains('hidden')) {
        // Enter on a dialog button activates it natively.
        if ((document.activeElement as HTMLElement | null)?.closest('#confirm-leave, #rules, #credits')) return;
        if (input.disabled) return;
        e.preventDefault();
        input.focus();
      } else if (e.key === 'Escape') {
        input.blur();
        setSettings(false);
        $('credits').classList.add('hidden');
        $('rules').classList.add('hidden');
        $('confirm-leave').classList.add('hidden');
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) h.chat(text);
        input.value = '';
        input.blur();
        e.stopPropagation();
      }
    });
  }

  private invite: string | null = null;

  /** Show a dialog and move focus into it: the primary button (so Enter on the leave confirm stays), else the first, else the element. */
  private openDialog(id: string) {
    const el = $(id);
    el.classList.remove('hidden');
    (el.querySelector<HTMLElement>('button.primary') ?? el.querySelector('button') ?? el).focus();
  }

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
    $('quick-start').classList.add('link');
    // Invited layout: name, one big Join button, then the option to start your own table.
    const join = $('join');
    const row = join.parentElement!;
    $('create').before(join);
    join.style.width = '100%';
    row.classList.add('hidden');
    document.querySelector('#home .or')?.classList.add('hidden');
    $<HTMLInputElement>('name').focus();
  }

  private cardConfirm: { confirm: () => void; cancel: () => void } | null = null;

  showCardConfirm(copy: CardConfirmCopy, onConfirm: () => void, onCancel: () => void) {
    this.cardConfirm = { confirm: onConfirm, cancel: onCancel };
    const verb = $('cc-verb');
    verb.textContent = copy.verb;
    verb.className = `verb ${copy.verb === 'DISCARD' ? 'discard' : 'enact'}`;
    $('cc-policy-row').className = `policy ${copy.face}`;
    $('cc-policy').textContent = copy.policy;
    $('cc-detail').textContent = copy.detail;
    $('cc-confirm-label').textContent = copy.confirm;
    $('cc-policy-row').querySelector('.pip')!.textContent = copy.face;
    const card = $('confirm-card');
    const discard = copy.verb === 'DISCARD';
    card.classList.toggle('discard', discard);
    card.classList.toggle('enact', !discard);
    card.classList.remove('hidden', 'enter');
    void card.offsetWidth;
    card.classList.add('enter');
  }

  hideCardConfirm() {
    this.cardConfirm = null;
    $('confirm-card').classList.add('hidden');
  }

  showHome() {
    this.room = null;
    this.hideCardConfirm();
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
    this.hideCardConfirm();
    this.hideGameOver();
    this.hideEnact();
    $('toasts').replaceChildren();
    this.setTimer(null, false);
    const input = $<HTMLInputElement>('chat-input');
    input.blur();
    input.value = '';
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
      for (const p of PACES) {
        const on = p === room.options.pace;
        $(`pace-${p}`).classList.toggle('active', on);
        $(`pace-${p}`).setAttribute('aria-pressed', String(on));
      }
      for (const l of BOT_LEVELS) {
        const on = l === room.options.botLevel;
        $(`bot-level-${l}`).classList.toggle('active', on);
        $(`bot-level-${l}`).setAttribute('aria-pressed', String(on));
      }
      const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
      $('pace-note').textContent = `Pace: ${cap(room.options.pace)} · Bots: ${cap(room.options.botLevel)}`;
      $('pace-note').classList.toggle('hidden', isHost);
      const n = room.seats.length;
      $<HTMLButtonElement>('start').disabled = n < 5;
      $<HTMLButtonElement>('add-bot').disabled = n >= 10;
      $<HTMLButtonElement>('remove-bot').disabled = !room.seats.some((s) => s.bot);
      $('seat-count').textContent = `${n} / 10 seated${n < 5 ? ` · need ${5 - n} more to start` : ''}`;
      const line = seriesLine(room.series, room.seats.map((s) => s.name));
      $('lobby-series').textContent = line;
      $('lobby-series').classList.toggle('hidden', !line);
      const recLine = recordLine(loadRecord());
      $('lobby-record').textContent = recLine;
      $('lobby-record').classList.toggle('hidden', !recLine);
    } else {
      $('lobby').classList.add('hidden');
      $('hud').classList.remove('hidden');
    }
  }

  /** Renders the status bar, phase stepper and action card from the pure HUD model (null: no game yet). */
  renderHud(model: HudModel | null, mine: boolean, fallback = '') {
    this.renderStatus(model);
    this.renderStepper(model);
    this.renderRoster(model);
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
    const text = [me?.name, st.alive ? st.roleLabel : '✝'].filter(Boolean).join(' · ');
    const party = st.alive && st.role ? (st.role === 'liberal' ? 'L' : 'F') : null;
    const className = `chip ${!st.alive ? 'dead' : st.role === 'liberal' ? 'lib' : st.role ? 'fas' : ''}`;
    const chipKey = `${text}|${party}|${className}`;
    if (chipKey !== this.chipKey) {
      this.chipKey = chipKey;
      const nodes: Node[] = [];
      if (party) {
        const seal = document.createElement('img');
        seal.className = 'seal';
        seal.alt = '';
        seal.src = sealUrl(party);
        nodes.push(seal);
      }
      nodes.push(document.createTextNode(text));
      chip.replaceChildren(...nodes);
      chip.className = className;
    }
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

  private renderRoster(model: HudModel | null) {
    const el = $('roster');
    el.classList.toggle('hidden', !model);
    if (!model) {
      this.rosterKey = '';
      return;
    }
    // Rebuilding mid-click would swallow it, so only touch the DOM when something changed.
    const key = JSON.stringify(model.roster);
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    const BADGES: Partial<Record<Badge, [string, string]>> = {
      president: ['b-pres', 'PRES'],
      chancellor: ['b-chanc', 'CHANC'],
      nominee: ['b-nom', 'NOMINEE'],
      voted: ['b-voted', '✓'],
      acting: ['b-acting', ''],
    };
    el.replaceChildren(
      ...model.roster.map((r) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'r-row';
        row.classList.toggle('dead', !r.alive);
        row.classList.toggle('limited', r.badges.includes('termLimited'));
        row.classList.toggle('k-lib', r.knownRole === 'liberal');
        row.classList.toggle('k-fas', r.knownRole === 'fascist' || r.knownRole === 'hitler');
        row.title = r.name;
        const avatar = document.createElement('span');
        avatar.className = 'r-avatar';
        avatar.style.setProperty('--hue', String(UI.hue(r.name)));
        avatar.textContent = [...r.name][0] ?? '?';
        const name = document.createElement('span');
        name.className = 'r-name';
        name.textContent = r.name;
        row.append(avatar, name);
        if (r.you) {
          const you = document.createElement('span');
          you.className = 'r-you';
          you.textContent = '(you)';
          row.appendChild(you);
        }
        const badges = document.createElement('span');
        badges.className = 'r-badges';
        const add = (cls: string, text: string, title = '') => {
          const b = document.createElement('span');
          b.className = `badge ${cls}`;
          b.textContent = text;
          if (title) b.title = title;
          badges.appendChild(b);
        };
        if (!r.alive) add('b-dead', '✝');
        if (r.intel) {
          add(`b-intel ${r.intel === 'liberal' ? 'lib' : 'fas'}`, `🔍 ${r.intel === 'liberal' ? 'L' : 'F'}`, 'You investigated this player');
        }
        for (const b of r.badges) {
          const def = BADGES[b];
          if (def) add(def[0], def[1]);
        }
        row.appendChild(badges);
        if (!r.you) {
          // A span, not a nested button: the row itself is a button.
          const mark = document.createElement('span');
          mark.className = `r-mark${r.mark ? ` m-${r.mark === '?' ? 'q' : r.mark.toLowerCase()}` : ''}`;
          mark.setAttribute('role', 'button');
          mark.title = 'Your private mark (click to change)';
          mark.textContent = r.mark ?? '·';
          mark.onclick = (ev) => {
            ev.stopPropagation();
            this.onMark?.(r.seat);
          };
          row.appendChild(mark);
        }
        row.onclick = () => {
          this.onLookAt?.(r.seat);
          row.blur(); // keep WASD look working
        };
        return row;
      }),
    );
  }

  /** Shows or moves an edge marker (ndc x/y, arrow angle); touches the DOM only when the rounded value changed. */
  setMarker(id: 'pres' | 'nom' | 'act', m: { x: number; y: number; angle: number; label: string } | null) {
    const el = $(`mk-${id}`);
    let st = this.markers.get(id);
    if (!st) this.markers.set(id, (st = { key: '', label: '', w: 0, h: 0 }));
    if (!m) {
      if (st.key !== 'off') {
        st.key = 'off';
        el.classList.add('hidden');
      }
      return;
    }
    if (st.key === 'off' || st.label !== m.label) {
      st.label = m.label;
      el.querySelector('.mk-text')!.textContent = m.label;
      el.classList.remove('hidden');
      st.w = el.offsetWidth;
      st.h = el.offsetHeight;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const px = Math.round(Math.min(W - st.w / 2 - 8, Math.max(st.w / 2 + 8, ((m.x + 1) / 2) * W)));
    const py = Math.round(Math.min(H - st.h / 2 - 8, Math.max(st.h / 2 + 8, ((1 - m.y) / 2) * H)));
    const deg = Math.round(((Math.PI - m.angle) * 180) / Math.PI);
    const key = `${px},${py},${deg}`;
    if (key === st.key) return;
    st.key = key;
    el.style.transform = `translate(${px - st.w / 2}px, ${py - st.h / 2}px)`;
    (el.firstElementChild as HTMLElement).style.transform = `rotate(${deg}deg)`;
  }

  setTimer(secs: number | null, mine: boolean) {
    const text = secs === null ? '' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const cls = secs !== null && mine ? (secs <= 15 ? 'urgent' : 'mine') : '';
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

  /** Blood on your screen for a few seconds; a second hit while one runs replaces it. */
  bloodScreen(kind: ScreenBlood, seed: number) {
    if (kind === 'none') return;
    const canvas = $<HTMLCanvasElement>('blood-screen');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    cancelAnimationFrame(this.bloodRaf);
    this.bloodSplats = screenSplats(kind, seed);
    this.bloodStart = performance.now();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.display = 'block';
    const frame = () => {
      const t = (performance.now() - this.bloodStart) / 1000;
      if (t >= SCREEN_BLOOD_S) return this.clearBloodScreen();
      this.drawBlood(ctx, canvas.width, canvas.height, screenBloodFrame(t));
      this.bloodRaf = requestAnimationFrame(frame);
    };
    frame();
  }

  /** Stops any running screen blood and hides it. */
  clearBloodScreen() {
    cancelAnimationFrame(this.bloodRaf);
    this.bloodSplats = [];
    const canvas = $<HTMLCanvasElement>('blood-screen');
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = 'none';
  }

  /** Flat-ink splats: a disc, its satellites and a dripping capsule straight down. */
  private drawBlood(ctx: CanvasRenderingContext2D, w: number, h: number, f: { alpha: number; drip: number }) {
    const u = Math.min(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = f.alpha;
    const disc = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const s of this.bloodSplats) {
      const x = s.x * w;
      const y = s.y * h;
      ctx.fillStyle = s.color;
      disc(x, y, s.r * u);
      for (const b of s.blobs) disc(x + b.dx * u, y + b.dy * u, b.r * u);
      const len = s.drip * f.drip * u;
      if (len <= 0) continue;
      const dw = s.dripW * u;
      ctx.fillRect(x - dw / 2, y, dw, len);
      disc(x, y + len, dw * 0.7);
    }
    ctx.globalAlpha = 1;
  }

  /** Big policy-enacted ceremony banner; a second call restarts it. */
  enact(policy: 'L' | 'F', count: number, chaos: boolean) {
    const el = $('enact');
    const b = enactBanner(policy, count, chaos);
    $<HTMLImageElement>('enact-seal').src = sealUrl(policy);
    $('enact-masthead').textContent = b.masthead;
    $('enact-dateline').textContent = b.dateline;
    $('enact-kicker').textContent = b.kicker;
    $('enact-title').textContent = b.title;
    $('enact-sub').textContent = b.subtitle;
    const pips = $('enact-pips');
    pips.replaceChildren(
      ...b.pips.map((on) => {
        const p = document.createElement('span');
        p.className = on ? 'pip on' : 'pip';
        return p;
      }),
    );
    const last = b.pips.lastIndexOf(true);
    if (last >= 0) pips.children[last].classList.add('new');
    clearTimeout(this.enactTimer);
    el.classList.remove('hidden', 'liberal', 'fascist', 'on');
    el.classList.add(b.cls);
    void el.offsetWidth;
    el.classList.add('on');
    this.enactOn = true;
    this.enactTimer = setTimeout(() => {
      el.classList.add('hidden');
      this.enactOn = false;
    }, ENACT_BANNER_MS);
  }

  /** Dismisses the enact banner early; false when none is showing. */
  skipEnact(): boolean {
    if (!this.enactOn) return false;
    this.hideEnact();
    this.onEnactSkip?.();
    return true;
  }

  private hideEnact() {
    clearTimeout(this.enactTimer);
    this.enactTimer = undefined;
    $('enact').classList.add('hidden');
    this.enactOn = false;
  }

  /** Full-screen win ceremony; onDone fires once after VICTORY_MS or when skipped, never after cancelVictory(). */
  victory(b: VictoryBanner, onDone: () => void) {
    this.cancelVictory();
    const el = $('victory');
    $('victory-masthead').textContent = b.masthead;
    $('victory-dateline').textContent = b.dateline;
    $('victory-title').textContent = b.headline;
    $('victory-reason').textContent = b.reason;
    const stamp = $('victory-stamp');
    stamp.textContent = b.stamp;
    stamp.className = b.stamp === 'VICTORY' ? 'victory' : b.stamp === 'DEFEAT' ? 'defeat' : '';
    $('victory-particles').replaceChildren(
      ...victoryParticles(b.cls, 48, Date.now() & 0xffff).map((p) => {
        const s = document.createElement('span');
        s.className = 'vp';
        s.style.setProperty('--x', `${p.x}%`);
        s.style.setProperty('--d', `${p.delay}s`);
        s.style.setProperty('--t', `${p.dur}s`);
        s.style.setProperty('--s', `${p.size}px`);
        s.style.setProperty('--dx', `${p.drift}vw`);
        s.style.setProperty('--h', `${p.hue}`);
        return s;
      }),
    );
    el.classList.remove('hidden', 'liberal', 'fascist', 'out');
    el.classList.add(b.cls);
    void el.offsetWidth;
    el.focus();
    this.victoryDone = onDone;
    this.victoryTimers = [
      setTimeout(() => el.classList.add('out'), VICTORY_MS - 600),
      setTimeout(() => this.finishVictory(), VICTORY_MS),
    ];
  }

  private finishVictory() {
    const done = this.victoryDone;
    this.cancelVictory();
    done?.();
  }

  /** Hide the win ceremony without calling its onDone. */
  cancelVictory() {
    this.victoryTimers.forEach(clearTimeout);
    this.victoryTimers = [];
    this.victoryDone = null;
    $('victory').classList.add('hidden');
    $('victory-particles').replaceChildren();
  }

  addChat(name: string, text: string, self: boolean) {
    const log = $('chat-log');
    const stick = nearBottom(log.scrollTop, log.clientHeight, log.scrollHeight);
    const line = document.createElement('div');
    line.className = self ? 'line self' : 'line';
    const who = document.createElement('b');
    who.textContent = `${name}: `;
    line.append(who, document.createTextNode(text));
    log.appendChild(line);
    while (log.children.length > 40) log.firstElementChild?.remove();
    if (stick) log.scrollTop = log.scrollHeight;
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
    this.hideCardConfirm();
    const el = $('gameover');
    const wasHidden = el.classList.contains('hidden');
    el.classList.remove('hidden');
    const title = $('gameover-title');
    title.textContent = v.winner === 'liberal' ? 'The Liberals win' : 'The Fascists win';
    title.className = v.winner ?? '';
    $('gameover-reason').textContent = REASONS[v.winReason ?? ''] ?? '';
    const list = $('gameover-roles');
    list.replaceChildren();
    for (const p of gameOverOrder(v.players)) list.appendChild(gameOverRow(p, room.you));
    const names = room.seats.map((s) => s.name);
    $('gameover-series').textContent = seriesLine(room.series, names);
    $('gameover-series').classList.toggle('hidden', !room.series.liberal && !room.series.fascist);
    const loaded = loadRecord();
    const rec = recordGame(loaded, v, `${room.code}:${room.series.liberal + room.series.fascist}`);
    if (rec !== loaded) saveRecord(rec);
    const recLine = recordLine(rec);
    $('gameover-record').textContent = recLine;
    $('gameover-record').classList.toggle('hidden', !recLine);
    $('play-again').textContent = room.seats[room.you]?.ready ? 'Ready ✓ (click to cancel)' : 'Play again';
    const humans = room.seats.filter((s) => !s.bot && s.connected);
    $('ready-note').textContent = `${humans.filter((s) => s.ready).length} of ${humans.length} ready`;
    // Runs every view update: only pull focus in when the panel first opens, and never from chat.
    if (wasHidden && document.activeElement?.id !== 'chat-input') $('play-again').focus();
    const isHost = room.you === room.host;
    $('redeal').classList.toggle('hidden', !isHost);
    $('rematch').classList.toggle('hidden', !isHost);
  }

  hideGameOver() {
    $('gameover').classList.add('hidden');
  }

  setStatus(text: string) {
    $('status').textContent = text;
    $('status').classList.toggle('hidden', !text);
  }
}
