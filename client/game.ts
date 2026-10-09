// Turns server RoomViews + events into a physical, animated table. Holds no authority.
import * as THREE from 'three';
import type { RoomView } from '../shared/protocol';
import type { ActionBody, GameEvent, Policy } from '../shared/types';
import { legalFromView, type GameView } from '../shared/view';
import { setMusicMood, sfx, voice } from './audio';
import type { Interactable, Interactor } from './interact';
import { Character } from './scene/characters';
import { Board, Card, Envelope, Pile, Placard, ballotCard, policyCard, revolver } from './scene/props';
import { ballotFace, cardBack, labelTexture, membershipCard, policyFace, roleCard } from './scene/textures';
import { Mover, TABLE_Y, type World } from './scene/world';
import type { UI } from './ui';

type Where = 'pile' | 'held' | 'discard' | 'board';
interface PoolCard {
  card: Card;
  mover: Mover;
  where: Where;
  holder: number;
  face: Policy | null; // visible face for this client, null = show back
  boardSlot: THREE.Vector3 | null;
}

const Q = (axis: 'x' | 'y' | 'z', angle: number) =>
  new THREE.Quaternion().setFromAxisAngle(
    axis === 'x' ? new THREE.Vector3(1, 0, 0) : axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1),
    angle,
  );
const mul = (...qs: THREE.Quaternion[]) => qs.reduce((a, b) => a.clone().multiply(b), new THREE.Quaternion());

const POWER_TEXT: Record<string, string> = {
  peek: 'Policy peek: the President looks at the top three policies.',
  investigate: 'Investigate loyalty: the President inspects a party card.',
  special: 'Special election: the President picks the next President.',
  execute: 'Execution: the President picks up the revolver.',
};

export class Game {
  room: RoomView | null = null;
  view: GameView | null = null;
  private chars = new Map<number, Character>();
  private board = new Board();
  private drawPile: Pile;
  private discardPile: Pile;
  private presPlacard = new Placard('PRESIDENT', '#d6a84a');
  private chanPlacard = new Placard('CHANCELLOR', '#c9c2b0');
  private presMover: Mover;
  private chanMover: Mover;
  private envelope = new Envelope();
  private envMover: Mover;
  private envelopes = new Map<number, THREE.Mesh>();
  private roleCard: Card;
  private roleMover: Mover;
  private pool: PoolCard[] = [];
  private ja: Card;
  private nein: Card;
  private jaMover: Mover;
  private neinMover: Mover;
  private voteCards = new Map<number, { card: Card; mover: Mover; shown: boolean }>();
  private vetoToken: THREE.Mesh;
  private vetoMover: Mover;
  private gun = revolver();
  private gunMover: Mover;
  private invCard: Card;
  private invMover: Mover;
  private reveals = new Map<number, { card: Card; mover: Mover }>();
  private tiles = { liberal: 0, fascist: 0 };
  private tileMovers: Mover[] = [];
  private tokenMover!: Mover;

  // Transient, client-only presentation state.
  private envelopeOpen = false;
  /** Set when you click a card, so the mouse can be recaptured before the server replies. */
  private cardsDone = false;
  /** Set when you pick a player, so your pointing arm drops immediately instead of waiting for the server. */
  private pickedPlayer = false;
  private myVote: boolean | null = null;
  private reveal: { votes: (boolean | null)[]; until: number } | null = null;
  private pendingIndex: number | null = null;
  private shot: { by: number; target: number; until: number } | null = null;
  private invShown: number | null = null;
  private invFlight: { by: number; target: number; until: number } | null = null;
  private speaker: { seat: number; until: number } | null = null;
  /** The President keeps pointing at whoever they just chose for a moment. */
  private pointAt: { by: number; target: number; until: number } | null = null;

  /** Who is pointing and at what: a President choosing a player, or one who just chose. */
  private pointing(): { seat: number; at: THREE.Vector3 } | null {
    const v = this.view;
    const me = this.room?.you;
    if (!v || me === undefined) return null;
    const L = this.world.layout;
    const headOf = (s: number) => (s === me ? this.world.camera.position.clone() : L.head(s));
    // Your own arm drops as soon as you choose; other Presidents hold the point briefly so everyone sees the pick.
    if (this.pickedPlayer) return null;
    if (this.pointAt && this.now < this.pointAt.until && this.pointAt.by !== me) return { seat: this.pointAt.by, at: headOf(this.pointAt.target) };
    if (v.phase !== 'nominate' && v.phase !== 'investigate' && v.phase !== 'special') return null;
    if (v.president === me) {
      // You point wherever you are aiming.
      const ray = new THREE.Raycaster();
      ray.setFromCamera(this.world.aimNdc(), this.world.camera);
      return { seat: me, at: ray.ray.at(3, new THREE.Vector3()) };
    }
    // Another President sweeps across the players they may choose from.
    const options =
      v.phase === 'nominate'
        ? v.eligible
        : v.players.filter((p) => p.alive && p.seat !== v.president && (v.phase !== 'investigate' || !v.investigated.includes(p.seat))).map((p) => p.seat);
    if (!options.length) return null;
    return { seat: v.president, at: headOf(options[Math.floor(this.now / 2.2) % options.length]) };
  }
  private layoutKey = '';
  private now = 0;
  private lastHeartbeat = 0;
  private lastSecond = -1;
  deadlineAt: number | null = null;

  constructor(
    private world: World,
    private interactor: Interactor,
    private ui: UI,
    private send: (a: ActionBody) => void,
  ) {
    const scene = world.scene;
    scene.add(this.board.group);
    this.drawPile = new Pile('POLICY', new THREE.Vector3(-0.66, TABLE_Y, -0.05));
    this.discardPile = new Pile('DISCARD', new THREE.Vector3(0.66, TABLE_Y, -0.05));
    scene.add(this.drawPile.group, this.discardPile.group);

    this.presMover = world.track(new Mover(this.presPlacard.mesh));
    this.chanMover = world.track(new Mover(this.chanPlacard.mesh));
    scene.add(this.presPlacard.mesh, this.chanPlacard.mesh);

    scene.add(this.envelope.mesh);
    this.envMover = world.track(new Mover(this.envelope.mesh));
    this.roleCard = new Card(roleCard('liberal'), cardBack('ROLE'), 1.25);
    scene.add(this.roleCard.mesh);
    this.roleMover = world.track(new Mover(this.roleCard.mesh));

    for (let i = 0; i < 3; i++) {
      const card = policyCard();
      card.mesh.visible = false;
      scene.add(card.mesh);
      const mover = world.track(new Mover(card.mesh));
      mover.hideOnArrive = true;
      this.pool.push({ card, mover, where: 'pile', holder: -1, face: null, boardSlot: null });
    }

    this.ja = ballotCard(true);
    this.nein = ballotCard(false);
    scene.add(this.ja.mesh, this.nein.mesh);
    this.jaMover = world.track(new Mover(this.ja.mesh));
    this.neinMover = world.track(new Mover(this.nein.mesh));

    const vt = labelTexture('VETO', '#ff8a7a', '#3a0f0a');
    const edge = new THREE.MeshStandardMaterial({ color: 0x3a0f0a });
    this.vetoToken = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.08), [
      edge, edge, new THREE.MeshStandardMaterial({ map: vt, emissive: 0xffffff, emissiveMap: vt, emissiveIntensity: 0.3 }), edge, edge, edge,
    ]);
    scene.add(this.vetoToken);
    this.vetoMover = world.track(new Mover(this.vetoToken));

    scene.add(this.gun);
    this.gunMover = world.track(new Mover(this.gun));

    this.invCard = new Card(membershipCard('?', 'liberal'), cardBack('MEMBERSHIP'), 1.25);
    scene.add(this.invCard.mesh);
    this.invMover = world.track(new Mover(this.invCard.mesh));

    this.tileMovers = [...this.board.liberalTiles, ...this.board.fascistTiles].map((t) => world.track(new Mover(t)));
    // Election tracker coin sits on its circle (board-local coordinates) and slides when it advances.
    this.board.token.position.copy(this.board.slot('tracker', 0).setY(0.014));
    this.tokenMover = world.track(new Mover(this.board.token).set(this.board.slot('tracker', 0).setY(0.014), undefined, 5));
    this.board.setPowers([null, null, 'peek', 'execute', 'execute', null]);
    this.relayout(5, 0);
  }

  // ---------- server input ----------

  onRoom(room: RoomView) {
    const prevPhase = this.view?.phase;
    const prevRound = this.view?.round;
    this.room = room;
    this.view = room.game;
    this.cardsDone = false;
    this.pickedPlayer = false;
    const n = room.game ? room.game.players.length : room.seats.length;
    this.relayout(n, room.you);
    this.syncCharacters();
    if (room.game) this.board.setPowers(room.game.powers);

    for (const e of room.events) this.onEvent(e);

    const v = this.view;
    if (v) {
      if (v.phase !== prevPhase || v.round !== prevRound) {
        if (v.phase !== 'vote') this.myVote = null;
        this.pendingIndex = null;
      }
      if (v.phase === 'night' && prevPhase !== 'night') this.envelopeOpen = false;
      if (v.phase !== 'night' && prevPhase === 'night') this.envelopeOpen = false;
      this.reconcilePool();
      this.syncTiles(prevPhase === undefined);
    } else {
      this.clearTable();
    }
    this.deadlineAt = room.deadlineMs === null ? null : performance.now() + room.deadlineMs;
    this.refreshInteractables();
    this.ui.setPrompt(this.promptText(), !!v && v.you !== null && v.pending.includes(v.you) && v.phase !== 'gameOver');
    if (v?.phase === 'gameOver') this.ui.showGameOver(v, room);
    else this.ui.hideGameOver();
    const me = v?.players[room.you];
    this.ui.setChatEnabled(!v || v.phase === 'gameOver' || !!me?.alive);
  }

  private clearTable() {
    this.tiles = { liberal: 0, fascist: 0 };
    this.tokenMover.set(this.board.slot('tracker', 0).setY(0.014));
    this.board.liberalTiles.concat(this.board.fascistTiles).forEach((t) => (t.visible = false));
    this.pool.forEach((p) => (p.where = 'pile'));
    this.myVote = null;
    this.reveal = null;
    this.envelopeOpen = false;
    this.pendingIndex = null;
    this.shot = null;
    this.invShown = null;
    this.invFlight = null;
    this.pointAt = null;
  }

  /** Back to an empty table (left, kicked or fatal error). */
  reset() {
    this.room = null;
    this.view = null;
    this.clearTable();
    this.cardsDone = false;
    this.pickedPlayer = false;
    this.speaker = null;
    this.deadlineAt = null;
    this.lastSecond = -1;
    this.refreshInteractables();
    this.ui.setPrompt('', false);
    this.ui.setTimer(null, false);
  }

  onChat(seat: number, text: string) {
    const c = this.chars.get(seat);
    c?.say(text, this.now);
    this.speaker = { seat, until: this.now + 3 };
  }

  private relayout(n: number, me: number) {
    const key = `${Math.max(5, n)}:${me}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.world.setLayout(n, me);
    for (const c of this.chars.values()) {
      this.world.scene.remove(c.group);
      c.dispose();
    }
    this.chars.clear();
    for (const m of this.envelopes.values()) this.world.scene.remove(m);
    this.envelopes.clear();
    const L = this.world.layout;
    this.drawPile.group.position.set(-this.board.w / 2 - 0.13, TABLE_Y, -0.02);
    this.discardPile.group.position.set(this.board.w / 2 + 0.13, TABLE_Y, -0.02);
    this.drawPile.at = this.drawPile.group.position.clone();
    // Snap props into place so nothing flies in from the old layout.
    this.computeTargets();
    for (const m of this.world.movers) m.snap();
    void L;
  }

  private newCharacter(seat: number, variant: 'normal' | 'hitler'): Character {
    const L = this.world.layout;
    const c = new Character(seat, seat, variant);
    c.group.position.copy(L.chair(seat));
    c.group.rotation.y = L.yaw(seat) + Math.PI;
    this.world.scene.add(c.group);
    this.chars.set(seat, c);
    return c;
  }

  private syncCharacters() {
    const room = this.room!;
    const L = this.world.layout;
    const v = this.view;
    const seats = v ? v.players.map((p) => p.seat) : room.seats.map((s) => s.seat);
    for (const [seat, c] of this.chars) {
      if (!seats.includes(seat) || seat === room.you) {
        this.world.scene.remove(c.group);
        c.dispose();
        this.chars.delete(seat);
      }
    }
    for (const seat of seats) {
      if (seat === room.you) continue;
      let c = this.chars.get(seat);
      // Only a viewer the server told "this seat is Hitler" (fascists, or everyone at game over) gets the special model.
      const variant = v?.players[seat]?.role === 'hitler' ? 'hitler' : 'normal';
      if (c && c.variant !== variant) {
        this.world.scene.remove(c.group);
        c.dispose();
        this.chars.delete(seat);
        c = this.newCharacter(seat, variant);
      }
      if (!c) {
        c = this.newCharacter(seat, variant);
        const env = this.envelope.mesh.clone();
        env.material = (this.envelope.mesh.material as THREE.Material[]).map((m) => m.clone());
        env.position.copy(L.front(seat, -0.34, -0.02));
        env.rotation.y = L.yaw(seat);
        this.world.scene.add(env);
        this.envelopes.set(seat, env);
      }
      const info = room.seats[seat];
      const p = v?.players[seat];
      c.dead = !!p && !p.alive;
      let label = info?.name ?? p?.name ?? '?';
      let color = '#f0e6d2';
      if (p?.role && p.role !== 'liberal') {
        label += p.role === 'hitler' ? ' · HITLER' : ' · FASCIST';
        color = '#ff8f7a';
      } else if (p?.role === 'liberal' && v?.phase === 'gameOver') {
        label += ' · LIBERAL';
        color = '#9fd0ef';
      }
      if (info?.bot) label += ' (bot)';
      else if (info && !info.connected) label += ' (away)';
      else if (info?.botControlled) label += ' (auto)';
      if (p && !p.alive) label = `✝ ${label}`;
      c.setLabel(label, color);
    }
  }

  private name(seat: number | null | undefined): string {
    if (seat === null || seat === undefined) return '?';
    if (seat === this.room?.you) return `${this.room.seats[seat]?.name ?? 'You'} (you)`;
    return this.room?.seats[seat]?.name ?? this.view?.players[seat]?.name ?? `Seat ${seat + 1}`;
  }

  /** 'You nominate' / 'Vera nominates'. */
  private subj(seat: number, verb: string): string {
    return seat === this.room?.you ? `You ${verb}` : `${this.name(seat)} ${verb}s`;
  }

  private onEvent(e: GameEvent) {
    const v = this.view;
    const me = this.room?.you;
    switch (e.k) {
      case 'nightStart':
        sfx.night();
        this.ui.toast('Night falls. Open your envelope.', 'night');
        break;
      case 'newPresident':
        sfx.slide();
        this.ui.toast(e.seat === me ? 'You are the President.' : `${this.name(e.seat)} is President.`, e.special ? 'power' : 'info');
        break;
      case 'nominated':
        sfx.slide();
        this.pointAt = { by: e.president, target: e.target, until: this.now + 2.5 };
        this.ui.toast(`${this.subj(e.president, 'nominate')} ${this.name(e.target)} for Chancellor.`);
        break;
      case 'voted':
        sfx.slap();
        if (e.seat === me) this.world.addShake(0.35);
        break;
      case 'votes': {
        const ja = e.votes.filter((x) => x === true).length;
        const nein = e.votes.filter((x) => x === false).length;
        this.reveal = { votes: e.votes, until: this.now + 4.5 };
        this.voteCards.forEach((vc) => (vc.shown = false));
        setTimeout(() => sfx.flip(), 150);
        // One shout for the table, decided by the group: JA! if the government passed, NEIN! if it failed.
        setTimeout(() => voice.vote(e.passed), 300);
        this.ui.toast(e.passed ? `JA! ${ja} to ${nein}. The government is elected.` : `NEIN. ${ja} to ${nein}. The election fails.`, e.passed ? 'good' : 'bad');
        break;
      }
      case 'tracker':
        if (e.value > 0) {
          sfx.tick();
          this.ui.toast(`Election tracker: ${e.value} of 3.`, 'bad');
        }
        break;
      case 'drawn':
        sfx.draw();
        this.pool.forEach((p) => {
          p.where = 'held';
          p.holder = e.seat;
          p.face = null;
          p.mover.hideOnArrive = false;
          p.card.mesh.position.copy(this.drawPile.topPosition());
          p.card.mesh.quaternion.copy(new THREE.Quaternion());
          p.card.mesh.visible = true;
        });
        if (e.seat === me) this.dropIntoHand();
        break;
      case 'presDiscarded': {
        sfx.toss();
        const held = this.pool.filter((p) => p.where === 'held');
        const idx = e.seat === me && this.pendingIndex !== null ? this.pendingIndex : held.length - 1;
        const out = held[Math.min(idx, held.length - 1)];
        if (out) this.sendTo(out, 'discard');
        this.pendingIndex = null;
        break;
      }
      case 'passedToChancellor':
        sfx.slide();
        if (e.to === me) this.dropIntoHand();
        this.pool.filter((p) => p.where === 'held').forEach((p) => {
          p.holder = e.to;
          p.face = null;
        });
        break;
      case 'chancDiscarded': {
        sfx.toss();
        const held = this.pool.filter((p) => p.where === 'held');
        // pendingIndex is the card the chancellor ENACTED; the other one is discarded.
        const keep = e.seat === me && this.pendingIndex !== null ? this.pendingIndex : 0;
        const out = held[keep === 0 ? 1 : 0];
        if (out) this.sendTo(out, 'discard');
        break;
      }
      case 'enacted': {
        const held = this.pool.filter((p) => p.where === 'held');
        let card = held[0];
        if (e.chaos || !card) {
          card = this.pool.find((p) => p.where === 'pile')!;
          card.card.mesh.position.copy(this.drawPile.topPosition());
          card.card.mesh.visible = true;
        }
        if (card) {
          card.face = e.policy;
          card.card.setFace(policyFace(e.policy));
          const slot = e.policy === 'L' ? (v?.liberal ?? 1) - 1 : (v?.fascist ?? 1) - 1;
          card.boardSlot = this.board.slot(e.policy === 'L' ? 'liberal' : 'fascist', Math.max(0, slot)).add(this.board.group.position);
          this.sendTo(card, 'board');
        }
        setTimeout(() => {
          sfx.stamp();
          this.world.addShake(0.25);
        }, 650);
        this.ui.toast(
          `${e.chaos ? 'Chaos! The top policy is enacted: ' : ''}${e.policy === 'L' ? 'Liberal' : 'Fascist'} policy enacted.`,
          e.policy === 'L' ? 'liberal' : 'fascist',
        );
        break;
      }
      case 'reshuffled':
        sfx.slide();
        this.ui.toast('The discard pile is shuffled back into the deck.');
        break;
      case 'power':
        this.ui.toast(POWER_TEXT[e.power], 'power');
        if (e.power === 'execute') sfx.cock();
        if (e.power === 'peek') {
          sfx.draw();
          this.pool.forEach((p) => {
            p.where = 'held';
            p.holder = e.president;
            p.face = null;
            p.mover.hideOnArrive = false;
            p.card.mesh.position.copy(this.drawPile.topPosition());
            p.card.mesh.visible = true;
          });
          if (e.president === me) this.dropIntoHand();
        }
        break;
      case 'peeked':
        this.pool.forEach((p) => {
          if (p.where === 'held') this.sendTo(p, 'pile');
        });
        break;
      case 'investigated':
        sfx.slide();
        this.pointAt = { by: e.by, target: e.target, until: this.now + 2.5 };
        this.invFlight = { by: e.by, target: e.target, until: this.now + 2.6 };
        if (e.by === me) {
          this.invShown = e.target;
          const res = v?.yourInvestigations.find((i) => i.target === e.target);
          if (res) this.invCard.setFace(membershipCard(this.name(e.target), res.party));
          this.invCard.mesh.position.copy(this.world.layout.front(e.target));
        }
        this.ui.toast(`${this.subj(e.by, 'investigate')} ${this.name(e.target)}.`, 'power');
        break;
      case 'specialElected':
        this.pointAt = { by: e.by, target: e.target, until: this.now + 2.5 };
        this.ui.toast(`${this.subj(e.by, 'call')} a special election: ${this.name(e.target)} will preside.`, 'power');
        break;
      case 'executed': {
        this.shot = { by: e.by, target: e.target, until: this.now + 2.8 };
        this.chars.get(e.by)?.recoil();
        voice.gunshot();
        voice.death();
        this.world.addShake(e.target === me ? 1.5 : 1.0);
        const muzzle = new THREE.Vector3(0, 0, -0.2).applyMatrix4(this.gun.matrixWorld);
        this.world.flash(muzzle);
        this.ui.flash();
        this.ui.toast(e.target === me ? 'You have been executed.' : `${this.name(e.target)} has been executed.`, 'bad');
        break;
      }
      case 'vetoProposed':
        sfx.stamp();
        this.ui.toast(`${this.subj(e.seat, 'propose')} a VETO.`, 'power');
        break;
      case 'vetoAnswer':
        sfx.stamp();
        this.ui.toast(e.accepted ? 'Veto accepted. Both policies are discarded.' : 'Veto refused. The Chancellor must enact.', e.accepted ? 'power' : 'bad');
        if (e.accepted) this.pool.filter((p) => p.where === 'held').forEach((p) => this.sendTo(p, 'discard'));
        break;
      case 'gameOver': {
        const mine = v?.yourRole ? (v.yourRole === 'liberal' ? 'liberal' : 'fascist') : null;
        sfx.chime(mine === e.winner);
        break;
      }
      case 'acked':
        break;
    }
  }

  /** Your own cards arrive from above the view and settle into your hand, rather than rising from the table. */
  private dropIntoHand() {
    const cam = this.world.camera;
    cam.updateMatrixWorld();
    const held = this.pool.filter((p) => p.where === 'held');
    held.forEach((p, i) => {
      const [, q] = this.handPose(i, held.length);
      const off = i - (held.length - 1) / 2;
      p.card.mesh.position.copy(new THREE.Vector3(off * 0.125, 0.42 + i * 0.05, -0.45).applyMatrix4(cam.matrixWorld));
      p.card.mesh.quaternion.copy(q);
      p.card.mesh.visible = true;
    });
  }

  private sendTo(p: PoolCard, where: Where) {
    p.where = where;
    p.holder = -1;
    p.mover.hideOnArrive = where !== 'held';
    if (where === 'discard') p.face = null;
  }

  /** Makes card ownership match the authoritative view (also handles reconnects). */
  private reconcilePool() {
    const v = this.view!;
    const holder =
      v.phase === 'legPresident' || v.phase === 'peek'
        ? v.president
        : v.phase === 'legChancellor' || v.phase === 'veto'
          ? v.chancellor
          : null;
    const count = v.phase === 'legPresident' || v.phase === 'peek' ? 3 : holder !== null ? 2 : 0;
    let held = this.pool.filter((p) => p.where === 'held');
    if (held.length !== count || held.some((p) => p.holder !== holder)) {
      // Out of sync (e.g. after a reconnect): rebuild ownership without animation.
      this.pool.forEach((p, i) => {
        if (i < count && holder !== null) {
          p.where = 'held';
          p.holder = holder;
          p.mover.hideOnArrive = false;
          p.card.mesh.visible = true;
        } else if (p.where === 'held') this.sendTo(p, 'pile');
      });
      held = this.pool.filter((p) => p.where === 'held');
    }
    const faces = v.peek ?? v.hand;
    held.forEach((p, i) => {
      p.face = faces ? faces[i] ?? null : null;
      if (p.face) p.card.setFace(policyFace(p.face));
    });
  }

  private syncTiles(instant: boolean) {
    const v = this.view!;
    const place = (tiles: THREE.Mesh[], count: number, kind: 'liberal' | 'fascist', offset: number) => {
      tiles.forEach((t, i) => {
        const m = this.tileMovers[offset + i];
        const slot = this.board.slot(kind, i);
        if (i < count) {
          if (!t.visible) {
            t.visible = true;
            t.position.copy(slot).add(new THREE.Vector3(0, instant ? 0 : 0.5, 0));
          }
          m.visible = true;
          m.set(slot, new THREE.Quaternion(), instant ? 50 : 6);
        } else {
          m.visible = false;
          t.visible = false;
        }
      });
    };
    place(this.board.liberalTiles, v.liberal, 'liberal', 0);
    place(this.board.fascistTiles, v.fascist, 'fascist', 5);
    this.tiles = { liberal: v.liberal, fascist: v.fascist };
    this.tokenMover.set(this.board.slot('tracker', Math.min(3, v.tracker)).setY(0.014), undefined, instant ? 50 : 5);
  }

  // ---------- interaction ----------

  /** True while a card in your hand is waiting for you to choose it. */
  cardMode(): boolean {
    const v = this.view;
    const me = this.room?.you;
    if (!v || me === undefined || v.phase === 'gameOver') return false;
    if (this.envelopeOpen || this.invShown !== null) return true;
    if (this.cardsDone || !v.pending.includes(me)) return false;
    return v.hand !== null || v.peek !== null;
  }

  private act(a: ActionBody, index?: number) {
    if (a.type === 'presDiscard' || a.type === 'chancEnact' || a.type === 'peekDone') this.cardsDone = true;
    if (a.type === 'nominate' || a.type === 'investigate' || a.type === 'specialElect') this.pickedPlayer = true;
    if (index !== undefined) this.pendingIndex = index;
    if (a.type === 'vote') {
      this.myVote = a.ja;
      sfx.slap();
      this.world.addShake(0.3);
    }
    this.send(a);
  }

  private refreshInteractables() {
    const list: Interactable[] = [];
    const v = this.view;
    const room = this.room;
    if (!room || !v) {
      this.interactor.set([]);
      return;
    }
    const me = room.you;
    // Envelope is always yours to open (re-check your role any time).
    list.push({
      id: this.envelopeOpen ? 'role-card' : 'envelope',
      objects: [this.envelopeOpen ? this.roleCard.mesh : this.envelope.mesh],
      label: this.envelopeOpen
        ? v.phase === 'night' && !v.players[me].acked
          ? 'Close your eyes'
          : 'Put the role card away'
        : 'Open your role envelope',
      action: v.phase === 'night' && !v.players[me].acked && this.envelopeOpen,
      onClick: () => {
        if (!this.envelopeOpen) {
          this.envelopeOpen = true;
          sfx.envelope();
        } else {
          this.envelopeOpen = false;
          sfx.envelope();
          if (v.phase === 'night' && !v.players[me].acked) this.act({ type: 'ack' });
        }
        this.refreshInteractables();
        this.ui.setPrompt(this.promptText(), true);
      },
    });
    if (this.invShown !== null) {
      list.push({
        id: 'inv-card',
        objects: [this.invCard.mesh],
        label: 'Put the membership card away',
        action: false,
        onClick: () => {
          this.invShown = null;
          this.refreshInteractables();
        },
      });
    }
    // Term-limited players can be hovered so the rule is explained instead of silently ignored.
    for (const seat of this.termLimited()) {
      const c = this.chars.get(seat);
      if (!c) continue;
      list.push({
        id: `limited-${seat}`,
        objects: c.hitMeshes,
        label: `${this.name(seat)} can't be Chancellor: ${this.limitReason(seat)} (term limit)`,
        action: false,
        onClick: () => this.ui.toast(`${this.name(seat)} is term-limited: ${this.limitReason(seat)}.`, 'bad'),
      });
    }
    const legal = legalFromView(v);
    for (const a of legal) {
      switch (a.type) {
        case 'nominate':
        case 'investigate':
        case 'specialElect':
        case 'execute': {
          const c = this.chars.get(a.target);
          if (!c) break;
          const verb = {
            nominate: `Nominate ${this.name(a.target)} as Chancellor`,
            investigate: `Investigate ${this.name(a.target)}`,
            specialElect: `Make ${this.name(a.target)} the next President`,
            execute: `Shoot ${this.name(a.target)}`,
          }[a.type];
          list.push({ id: `seat-${a.target}`, objects: c.hitMeshes, label: verb, action: true, onClick: () => this.act(a) });
          break;
        }
        case 'vote':
          if (this.myVote !== null) break;
          list.push({
            id: a.ja ? 'vote-ja' : 'vote-nein',
            objects: [a.ja ? this.ja.mesh : this.nein.mesh],
            label: a.ja ? 'Slam JA!' : 'Slam NEIN',
            action: true,
            onClick: () => this.act(a),
          });
          break;
        case 'vetoResponse':
          list.push({
            id: a.accept ? 'vote-ja' : 'vote-nein',
            objects: [a.accept ? this.ja.mesh : this.nein.mesh],
            label: a.accept ? 'JA: agree to the veto' : 'NEIN: refuse the veto',
            action: true,
            onClick: () => this.act(a),
          });
          break;
        case 'presDiscard':
        case 'chancEnact': {
          const held = this.pool.filter((p) => p.where === 'held');
          if (a.type === 'presDiscard') {
            const p = held[a.index];
            if (!p) break;
            list.push({
              id: `hand-${a.index}`,
              objects: [p.card.mesh],
              label: `Discard this ${p.face === 'L' ? 'Liberal' : 'Fascist'} policy`,
              action: true,
              onClick: () => this.act(a, a.index),
            });
          } else {
            // Click the card you want to THROW AWAY; the other one is enacted.
            const other = 1 - a.index;
            const p = held[other];
            if (!p) break;
            const keep = held[a.index];
            list.push({
              id: `hand-${other}`,
              objects: [p.card.mesh],
              label: `Discard this; enact the ${keep?.face === 'L' ? 'Liberal' : 'Fascist'} policy`,
              action: true,
              onClick: () => this.act(a, a.index),
            });
          }
          break;
        }
        case 'proposeVeto':
          list.push({ id: 'veto', objects: [this.vetoToken], label: 'Propose a veto', action: true, onClick: () => this.act(a) });
          break;
        case 'peekDone':
          this.pool
            .filter((p) => p.where === 'held')
            .forEach((p, i) =>
              list.push({ id: `peek-${i}`, objects: [p.card.mesh], label: 'Put the policies back', action: true, onClick: () => this.act(a) }),
            );
          break;
        case 'ack':
          break;
      }
    }
    this.interactor.set(list);
  }

  /** Living players (other than the President) who can't be nominated right now. */
  private termLimited(): number[] {
    const v = this.view;
    if (!v || v.phase !== 'nominate') return [];
    return v.players
      .filter((p) => p.alive && p.seat !== v.president && !v.eligible.includes(p.seat))
      .map((p) => p.seat);
  }

  private limitReason(seat: number): string {
    const v = this.view!;
    if (seat === v.lastChancellor) return 'they were the last elected Chancellor';
    if (seat === v.lastPresident) return 'they were the last elected President';
    return 'not eligible this round';
  }

  // ---------- prompt ----------

  promptText(): string {
    const v = this.view;
    const room = this.room;
    if (!room) return '';
    if (!v) return room.seats.length < 5 ? 'Waiting for players… (5 to 10 seats, the host can add bots)' : 'Waiting for the host to start.';
    const me = room.you;
    const mine = v.pending.includes(me);
    const pres = this.name(v.president);
    const dead = !v.players[me].alive && v.phase !== 'gameOver' ? 'You are dead: watch in silence. ' : '';
    const waitingOn = v.pending.filter((s) => s !== me).map((s) => this.name(s));
    switch (v.phase) {
      case 'night':
        if (!v.players[me].acked) return this.envelopeOpen ? 'Memorise your role, then click the card to close your eyes.' : 'Night. Click your envelope to see your secret role.';
        return `Eyes closed. Waiting for ${waitingOn.length} more…`;
      case 'nominate': {
        const limited = this.termLimited().map((s) => this.name(s));
        const note = limited.length ? ` Term-limited: ${limited.join(', ')}.` : '';
        return mine
          ? `You are President. Click a player to nominate them as Chancellor.${note}`
          : `${dead}Waiting for President ${pres} to nominate a Chancellor.${note}`;
      }
      case 'vote':
        if (mine && this.myVote === null) return `Vote on President ${pres} with Chancellor ${this.name(v.nominee)}: slam JA! or NEIN.`;
        return `${dead}Votes are in from ${v.players.filter((p) => p.hasVoted).length} of ${v.players.filter((p) => p.alive).length}. Waiting for ${waitingOn.join(', ') || 'the reveal'}.`;
      case 'legPresident':
        return mine ? 'Click the policy you want to DISCARD. The other two go to your Chancellor.' : `${dead}President ${pres} is choosing a policy to discard.`;
      case 'legChancellor':
        return mine
          ? `Click the policy you want to DISCARD; the other is enacted.${v.vetoUnlocked && !v.vetoRefused ? ' Or stamp VETO.' : ''}`
          : `${dead}Chancellor ${this.name(v.chancellor)} is choosing a policy to enact.`;
      case 'veto':
        return mine ? `Chancellor ${this.name(v.chancellor)} wants to veto. Slam JA! to agree or NEIN to refuse.` : `${dead}President ${pres} is considering the veto.`;
      case 'peek':
        return mine ? 'These are the next three policies. Click them to put them back.' : `${dead}President ${pres} is peeking at the deck.`;
      case 'investigate':
        return mine ? 'Click a player to investigate their party membership.' : `${dead}President ${pres} is choosing someone to investigate.`;
      case 'special':
        return mine ? 'Click the player who will be the next President.' : `${dead}President ${pres} is choosing the next President.`;
      case 'execute':
        return mine ? 'Aim the revolver and click the player to execute.' : `${dead}President ${pres} has the revolver…`;
      case 'gameOver':
        return v.winner === 'liberal' ? 'The Liberals win.' : 'The Fascists win.';
    }
  }

  // ---------- per-frame ----------

  private handPose(i: number, k: number, z = -0.42, y = -0.17): [THREE.Vector3, THREE.Quaternion] {
    const off = i - (k - 1) / 2;
    const cam = this.world.camera;
    const pos = new THREE.Vector3(off * 0.125, y - Math.abs(off) * 0.01, z).applyMatrix4(cam.matrixWorld);
    const q = mul(cam.quaternion, Q('x', Math.PI / 2 - 0.12), Q('y', -off * 0.08));
    return [pos, q];
  }

  private computeTargets() {
    const L = this.world.layout;
    const v = this.view;
    const room = this.room;
    const me = room?.you ?? 0;
    const now = this.now;
    const hovered = this.interactor.hovered;
    this.world.camera.updateMatrixWorld();

    // Envelope and role card.
    const envPos = L.front(me, -0.3, 0.02);
    this.envMover.set(envPos.clone().setY(envPos.y + (hovered === 'envelope' ? 0.02 : 0)), Q('y', L.yaw(me)));
    this.envMover.visible = !!v;
    this.envelope.setGlow(hovered === 'envelope' || (v?.phase === 'night' && !this.envelopeOpen && !v.players[me]?.acked) ? 0.6 + Math.sin(now * 4) * 0.3 : 0);
    if (v?.yourRole) this.roleCard.setFace(roleCard(v.yourRole));
    if (this.envelopeOpen) {
      const [p, q] = this.handPose(0, 1, -0.38, -0.05);
      this.roleMover.set(p, q, 10);
      this.roleMover.visible = true;
      this.roleMover.hideOnArrive = false;
    } else {
      this.roleMover.set(envPos.clone().setY(envPos.y + 0.006), Q('y', L.yaw(me)), 12);
      this.roleMover.hideOnArrive = true;
    }
    this.roleCard.setGlow(hovered === 'role-card' ? 0.1 : 0);
    for (const [seat, env] of this.envelopes) env.visible = !!v && !!v.players[seat];

    // Placards.
    const restP = new THREE.Vector3(-0.25, TABLE_Y + 0.043, -this.board.h / 2 - 0.12);
    const restC = new THREE.Vector3(0.25, TABLE_Y + 0.043, -this.board.h / 2 - 0.12);
    if (v && v.phase !== 'night') {
      const p = L.front(v.president, -0.2, 0.12);
      p.y += 0.043;
      this.presMover.set(p, Q('y', L.yaw(v.president)), 4);
    } else this.presMover.set(restP, new THREE.Quaternion(), 4);
    const chan = v ? (v.phase === 'vote' ? v.nominee : v.chancellor) : null;
    if (chan !== null && chan !== undefined && v?.phase !== 'gameOver') {
      const p = L.front(chan, 0.2, 0.12);
      p.y += 0.043;
      this.chanMover.set(p, mul(Q('y', L.yaw(chan)), Q('x', v?.phase === 'vote' ? -0.35 : 0)), 4);
    } else this.chanMover.set(restC, new THREE.Quaternion(), 4);

    // Policy cards.
    this.drawPile.setCount(v?.deckCount ?? 17);
    this.discardPile.setCount(v?.discardCount ?? 0);
    const held = this.pool.filter((p) => p.where === 'held');
    held.forEach((p, i) => {
      const hover = hovered === `hand-${i}` || hovered === `peek-${i}`;
      if (p.holder === me) {
        // Held high enough to be fully visible; hovering brings the card toward you.
        const [pos, q] = this.handPose(i, held.length, hover ? -0.36 : -0.42, hover ? -0.045 : -0.07);
        p.mover.set(pos, q, 10);
        p.card.setGlow(hover ? 0.12 : 0);
      } else {
        const off = i - (held.length - 1) / 2;
        const pos = L.front(p.holder, off * 0.09, 0.02, 0.86);
        pos.y += 0.16;
        p.mover.set(pos, mul(Q('y', L.yaw(p.holder)), Q('x', Math.PI / 2 - 0.25), Q('y', -off * 0.12)), 7);
        p.card.setGlow(0);
        p.card.setFace(cardBack('POLICY'));
      }
      if (p.face && p.holder === me) p.card.setFace(policyFace(p.face));
      p.mover.hideOnArrive = false;
      p.mover.visible = true;
    });
    for (const p of this.pool) {
      if (p.where === 'discard') {
        p.mover.set(this.discardPile.topPosition().add(new THREE.Vector3(0, 0.02, 0)), Q('x', Math.PI), 6);
      } else if (p.where === 'board' && p.boardSlot) {
        p.mover.set(p.boardSlot.clone().add(new THREE.Vector3(0, 0.03, 0)), new THREE.Quaternion(), 5);
      } else if (p.where === 'pile') {
        p.mover.set(this.drawPile.topPosition(), Q('x', Math.PI), 8);
        p.mover.hideOnArrive = true;
      }
      if (p.where !== 'held' && p.where !== 'board') p.card.setGlow(0);
    }

    // Ballots: your Ja/Nein pair plus everyone else's played cards.
    const revealing = this.reveal && now < this.reveal.until ? this.reveal : null;
    if (this.reveal && !revealing) this.reveal = null;
    const playedSlot = (seat: number) => L.front(seat, 0.05, 0.14);
    const tiltToMe = (seat: number) => {
      const pos = playedSlot(seat);
      const dir = this.world.camera.position.clone().sub(pos).setY(0);
      return Math.atan2(dir.x, dir.z);
    };
    const myChoice = revealing ? revealing.votes[me] : v?.phase === 'vote' ? this.myVote : null;
    for (const [ballot, mover, ja] of [[this.ja, this.jaMover, true], [this.nein, this.neinMover, false]] as const) {
      const rest = L.front(me, ja ? 0.17 : 0.33, 0.03);
      const hover = hovered === (ja ? 'vote-ja' : 'vote-nein');
      if (myChoice === ja) {
        const pos = playedSlot(me);
        if (revealing) {
          pos.y += 0.06;
          mover.set(pos, mul(Q('y', tiltToMe(me)), Q('x', 0.9)), 10);
        } else mover.set(pos, Q('x', Math.PI), 16);
      } else {
        rest.y += hover ? 0.04 : 0;
        mover.set(rest, mul(Q('y', 0.08), Q('x', hover ? 0.3 : 0)), 12);
      }
      ballot.setGlow(hover ? 0.25 : 0);
      mover.visible = !!v && v.players[me]?.alive !== false;
    }
    if (v) {
      for (const p of v.players) {
        if (p.seat === me) continue;
        let vc = this.voteCards.get(p.seat);
        if (!vc) {
          const card = ballotCard(true);
          card.mesh.visible = false;
          this.world.scene.add(card.mesh);
          const mover = this.world.track(new Mover(card.mesh));
          vc = { card, mover, shown: false };
          this.voteCards.set(p.seat, vc);
        }
        const slot = playedSlot(p.seat);
        const rv = revealing?.votes[p.seat];
        if (revealing && rv !== null && rv !== undefined) {
          vc.card.setFace(ballotFace(rv));
          slot.y += 0.06;
          vc.mover.set(slot, mul(Q('y', tiltToMe(p.seat)), Q('x', 0.9)), 9);
          vc.mover.scale = 1.5;
          vc.mover.visible = true;
          vc.mover.hideOnArrive = false;
        } else if (v.phase === 'vote' && p.hasVoted) {
          if (!vc.shown) {
            vc.shown = true;
            vc.card.mesh.visible = true;
            vc.card.mesh.position.copy(slot).add(new THREE.Vector3(0, 0.3, 0));
            vc.card.mesh.scale.setScalar(1);
          }
          vc.mover.set(slot, mul(Q('y', L.yaw(p.seat)), Q('x', Math.PI)), 16);
          vc.mover.scale = 1;
          vc.mover.visible = true;
          vc.mover.hideOnArrive = false;
        } else {
          vc.shown = false;
          vc.mover.set(slot.clone().setY(TABLE_Y - 0.05), mul(Q('y', L.yaw(p.seat)), Q('x', Math.PI)), 8);
          vc.mover.scale = 1;
          vc.mover.hideOnArrive = true;
        }
      }
    }

    // Veto token.
    const vetoLegal = !!v && v.phase === 'legChancellor' && v.chancellor === me && v.vetoUnlocked && !v.vetoRefused;
    const vt = L.front(me, -0.12, 0.2);
    vt.y += vetoLegal ? 0.012 + (hovered === 'veto' ? 0.03 : 0) : -0.05;
    this.vetoMover.set(vt, new THREE.Quaternion(), 8);
    this.vetoMover.visible = vetoLegal;

    // Revolver.
    const gunRest = new THREE.Vector3(this.board.w / 2 + 0.1, TABLE_Y + 0.02, this.board.h / 2 + 0.08);
    const shooting = this.shot && now < this.shot.until ? this.shot : null;
    if (this.shot && !shooting) this.shot = null;
    const holderSeat = shooting ? shooting.by : v?.phase === 'execute' ? v.president : null;
    // Arms: the gun holder aims; a President choosing someone points; everyone else rests.
    const pointing = this.pointing();
    for (const [seat, c] of this.chars) {
      if (seat === holderSeat) continue;
      c.setAim(pointing && pointing.seat === seat ? pointing.at : null, 'point');
    }
    if (holderSeat === me && v) this.world.setOwnArm({ gun: this.gun });
    else if (pointing && pointing.seat === me) this.world.setOwnArm({ point: pointing.at });
    else this.world.setOwnArm(null);
    if (holderSeat === me && v) {
      const cam = this.world.camera;
      const pos = new THREE.Vector3(0.16, -0.15, -0.4).applyMatrix4(cam.matrixWorld);
      let aim: THREE.Vector3;
      if (shooting) aim = L.head(shooting.target);
      else {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(this.world.aimNdc(), cam);
        aim = ray.ray.at(4, new THREE.Vector3());
      }
      const m = new THREE.Matrix4().lookAt(pos, aim, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      this.gunMover.set(pos, shooting && now > shooting.until - 2.6 && now < shooting.until - 2.3 ? mul(q, Q('x', 0.5)) : q, 14);
    } else if (holderSeat !== null && holderSeat !== undefined) {
      // The President raises their arm; the aim drifts from player to player until the shot, then locks on.
      const c = this.chars.get(holderSeat);
      const candidates = v ? v.players.filter((p) => p.alive && p.seat !== holderSeat).map((p) => p.seat) : [];
      const aimAt = shooting
        ? L.head(shooting.target)
        : candidates.length
          ? (candidates[Math.floor(now / 1.8) % candidates.length] === me ? this.world.camera.position.clone() : L.head(candidates[Math.floor(now / 1.8) % candidates.length]))
          : new THREE.Vector3(0, 1.2, 0);
      if (c) {
        c.setAim(aimAt);
        const { pos, quat } = c.gunPose(); // the gun sits in the hand and points wherever the arm points
        this.gunMover.set(pos, quat, 16);
      } else {
        const pos = L.front(holderSeat, 0.12, -0.05, 0.92).setY(TABLE_Y + 0.28);
        this.gunMover.set(pos, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, aimAt, new THREE.Vector3(0, 1, 0))), 16);
      }
    } else {
      this.gunMover.set(gunRest, mul(Q('y', 0.7), Q('z', Math.PI / 2)), 5);
    }

    // Investigation: membership card slides across; the investigator holds it face-up.
    const flight = this.invFlight && now < this.invFlight.until ? this.invFlight : null;
    if (this.invFlight && !flight) this.invFlight = null;
    if (this.invShown !== null) {
      const [p, q] = this.handPose(0, 1, -0.38, -0.06);
      this.invMover.set(p, q, 6);
      this.invMover.visible = true;
      this.invMover.hideOnArrive = false;
      this.invCard.setGlow(hovered === 'inv-card' ? 0.1 : 0);
    } else if (flight) {
      const p = L.front(flight.by, 0, 0.1);
      p.y += 0.02;
      this.invMover.set(p, mul(Q('y', L.yaw(flight.by)), Q('x', Math.PI)), 2.5);
      this.invMover.visible = true;
      this.invMover.hideOnArrive = false;
      if (!this.invCard.mesh.visible) this.invCard.mesh.position.copy(L.front(flight.target));
    } else {
      this.invMover.set(L.front(me, 0, 0, 0.6).setY(TABLE_Y - 0.1), new THREE.Quaternion(), 4);
      this.invMover.hideOnArrive = true;
    }

    // Revealed role cards at game over.
    if (v?.phase === 'gameOver') {
      for (const p of v.players) {
        if (!p.role) continue;
        let r = this.reveals.get(p.seat);
        if (!r) {
          const card = new Card(roleCard(p.role), cardBack('ROLE'), 1.2);
          card.mesh.position.copy(L.front(p.seat, -0.34, -0.02));
          this.world.scene.add(card.mesh);
          r = { card, mover: this.world.track(new Mover(card.mesh)) };
          this.reveals.set(p.seat, r);
        }
        const pos = L.front(p.seat, -0.34, 0.06);
        pos.y += 0.08;
        r.mover.set(pos, mul(Q('y', tiltToMe(p.seat)), Q('x', 1.0)), 3);
      }
    } else if (this.reveals.size) {
      for (const r of this.reveals.values()) {
        this.world.scene.remove(r.card.mesh);
        this.world.movers.delete(r.mover);
      }
      this.reveals.clear();
    }
  }

  private updateCharacters(dt: number) {
    const v = this.view;
    const room = this.room;
    if (!room) return;
    const L = this.world.layout;
    const me = room.you;
    const camPos = this.world.camera.position;
    const focusPoint = (seat: number) => (seat === me ? camPos.clone() : L.head(seat));
    let focus: number | null = null;
    if (v) {
      switch (v.phase) {
        case 'vote':
          focus = v.nominee;
          break;
        case 'legChancellor':
        case 'veto':
          focus = v.phase === 'veto' ? v.president : v.chancellor;
          break;
        case 'night':
        case 'gameOver':
          focus = null;
          break;
        default:
          focus = v.president;
      }
    }
    if (this.shot && this.now < this.shot.until) focus = this.shot.target;
    const speaking = this.speaker && this.now < this.speaker.until ? this.speaker.seat : null;
    const hovered = this.interactor.hovered;
    const pointing = this.pointing();
    const knowsTeam = v?.yourRole && v.yourRole !== 'liberal';
    for (const [seat, c] of this.chars) {
      let target: THREE.Vector3 | null = null;
      const who = speaking !== null && speaking !== seat ? speaking : focus;
      if (v?.phase === 'night') target = null;
      else if (who !== null && who !== seat) target = focusPoint(who);
      else if (who === seat) {
        // The actor looks at whoever they are dealing with, or at the board.
        const t = v?.phase === 'vote' ? v.president : v?.phase === 'legPresident' ? v.chancellor : null;
        target = t !== null && t !== undefined ? focusPoint(t) : new THREE.Vector3(0, TABLE_Y, 0);
      } else target = new THREE.Vector3(0, TABLE_Y, 0);
      if (!v) target = camPos.clone();
      if (pointing && pointing.seat === seat) target = pointing.at; // eyes follow the finger
      c.lookAt(target);
      c.setHighlight(hovered === `seat-${seat}`);
      const role = v?.players[seat]?.role;
      c.setTeamGlow(!!knowsTeam && v?.phase === 'night' && !!role && role !== 'liberal');
      c.update(dt, this.now);
    }
  }

  update(dt: number) {
    this.now += dt;
    const v = this.view;
    this.world.setNight(v?.phase === 'night');
    this.world.setOwnOutfit(v?.yourRole === 'hitler');
    setMusicMood(v?.phase === 'night', !!v && (v.phase === 'execute' || (!!this.shot && this.now < this.shot.until)));
    this.world.tension = v ? v.fascist / 6 : 0;
    this.world.danger = v && (v.phase === 'execute' || (this.shot && this.now < this.shot.until)) ? 1 : 0;
    if (v?.phase === 'execute' && this.now - this.lastHeartbeat > 1.1) {
      this.lastHeartbeat = this.now;
      sfx.heartbeat();
    }
    this.computeTargets();
    this.updateCharacters(dt);
    // Timer.
    if (this.deadlineAt !== null && v && v.phase !== 'gameOver') {
      const left = Math.max(0, this.deadlineAt - performance.now());
      const secs = Math.ceil(left / 1000);
      this.ui.setTimer(secs, v.you !== null && v.pending.includes(v.you));
      if (secs !== this.lastSecond && secs <= 5 && secs > 0 && v.you !== null && v.pending.includes(v.you)) sfx.tick();
      this.lastSecond = secs;
    } else this.ui.setTimer(null, false);
  }
}
