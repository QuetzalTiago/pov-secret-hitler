// Turns server RoomViews + events into a physical, animated table. Holds no authority.
import * as THREE from 'three';
import type { RoomView } from '../shared/protocol';
import type { ActionBody, Party, Policy, Power, Role } from '../shared/types';
import { partyOf } from '../shared/rules';
import { actingSeats, legalFromView, type GameView } from '../shared/view';
import { BeatQueue, VOTE_REVEAL_MS, scheduleBatch, type Beat } from './beats';
import { duckMusic, setMusicMood, sfx, voice } from './audio';
import { ENACT_BANNER_DELAY_MS, ceremonyEndsAt } from './enact';
import { eventCopy, powerCopy } from './eventcopy';
import { actionLabel, cardConfirmCopy, edgeMarker, guideTarget, hudModel, idlePulse, nextMark, roleShown, screenBlood, type Mark, type ScreenBlood } from './hudmodel';
import { sleeveBlood } from './screenblood';
import { loadMarks, saveMarks } from './marks';
import type { Interactable, Interactor } from './interact';
import { bloodSeed, pickAnchor, type AnchorRect } from './scene/blood';
import { Bloodshed, type BloodShot, type ResolveAnchor } from './scene/bloodfx';
import { createCharacter, type Patron } from './scene/characters';
import { seedOf } from './scene/looks';
import { GUN_MUZZLE, GUN_SCALE } from './scene/gun';
import { disposeObject } from './scene/dispose';
import { ActingRings, Board, CARD_H, CARD_W, Card, Envelope, Pile, Placard, ballotCard, policyCard, revolver } from './scene/props';
import { COLORS, ballotFace, bloodAtlas, cardBack, labelTexture, membershipCard, policyFace, roleCard } from './scene/textures';
import { slowmoScale, tweens } from './scene/tween';
import { fanLayer } from './scene/handfan';
import { Mover, TABLE_Y, type World } from './scene/world';
import { tr } from './i18n';
import { flagTab, unflagTab } from './tabflag';
import { TurnCue, myTurnKey } from './turncue';
import type { UI } from './ui';
import { victoryBanner, type VictoryBanner } from './victory';

type Where = 'pile' | 'held' | 'discard' | 'board';
interface PoolCard {
  card: Card;
  mover: Mover;
  where: Where;
  holder: number;
  face: Policy | null; // visible face for this client, null = show back
  boardSlot: THREE.Vector3 | null;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const Q = (axis: 'x' | 'y' | 'z', angle: number, out = new THREE.Quaternion()) =>
  out.setFromAxisAngle(axis === 'x' ? AXIS_X : axis === 'y' ? AXIS_Y : AXIS_Z, angle);
/** out = a * b (* c). `out` may alias `a`, never `b` or `c`. */
const mul = (out: THREE.Quaternion, a: THREE.Quaternion, b: THREE.Quaternion, c?: THREE.Quaternion) => {
  out.copy(a).multiply(b);
  if (c) out.multiply(c);
  return out;
};
// Shared constants for computeTargets. Mover.set copies them, so never mutate these.
const IDENTITY_Q = new THREE.Quaternion();
const FLIP_X_Q = Q('x', Math.PI);
const GUN_REST_Q = mul(new THREE.Quaternion(), Q('y', 0.7), Q('z', Math.PI / 2));
const TABLE_CENTRE = new THREE.Vector3(0, TABLE_Y, 0);
// Scratch for computeTargets: Mover.set copies, so a frame allocates nothing.
const QA = new THREE.Quaternion();
const QB = new THREE.Quaternion();
const QC = new THREE.Quaternion();
const QOUT = new THREE.Quaternion();
const DISCARD_LIFT = new THREE.Vector3(0, 0.02, 0);
const BOARD_LIFT = new THREE.Vector3(0, 0.03, 0);

export class Game {
  room: RoomView | null = null;
  private marks: Record<number, Mark> = {}; // private suspicion marks for the current room
  private marksCode: string | null = null;
  view: GameView | null = null;
  private chars = new Map<number, Patron>();
  private lookSeed = 0;
  private board = new Board();
  private drawPile: Pile;
  private discardPile: Pile;
  private presPlacard = new Placard('PRESIDENT', '#FBB969');
  private chanPlacard = new Placard('CHANCELLOR', '#F7E1C3');
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
  private rings = new ActingRings();
  private turnCue = new TurnCue();
  private voteCards = new Map<number, { card: Card; mover: Mover; shown: boolean }>();
  private vetoToken: THREE.Mesh;
  private vetoMover: Mover;
  private gun = revolver();
  private gunMover: Mover;
  private gunSnapFrames = 0; // frames the revolver is pinned to the shooter's hand after a shot
  private invCard: Card;
  private invMover: Mover;
  private reveals = new Map<number, { card: Card; mover: Mover }>();
  private beats = new BeatQueue();
  /** Counts the board shows right now; trails the view while a batch of beats plays out. */
  private shown = { liberal: 0, fascist: 0, tracker: 0 };
  /** At game over the view carries every role; hold them back until the Hitler beat and the victory. */
  private rolesHeld = false;
  private heldRoles: (Role | null)[] = [];
  private revealedSeats = new Set<number>();
  private tileMovers: Mover[] = [];
  private tokenMover!: Mover;

  // Transient, client-only presentation state.
  private envelopeOpen = false;
  /** Set when you click a card, so the mouse can be recaptured before the server replies. */
  private cardsDone = false;
  /** Index of the held card picked for discard/enact, awaiting the confirm panel. */
  private selectedCard: number | null = null;
  /** Redraws the confirm panel for the current pick (new language). */
  private reshowCard: (() => void) | null = null;
  /** Set when you pick a player, so your pointing arm drops immediately instead of waiting for the server. */
  private pickedPlayer = false;
  /** The action we sent and are waiting on; blocks re-sends until the view moves on, the server rejects it, or it times out. */
  private inFlight: { key: string; at: number } | null = null;
  private myVote: boolean | null = null;
  /** The ballot an in-flight unvote took back, restored if the server refuses it. */
  private takenBackVote: boolean | null = null;
  private reveal: { votes: (boolean | null)[]; until: number } | null = null;
  private pendingIndex: number | null = null;
  /** Last seat the policies were passed to; the view may already have cleared its chancellor on 'enacted'. */
  private lastChancellor: number | null = null;
  private ceremony = false;
  /** Pending presentation timeouts (vote sfx, enact banner), cancelled by reset(). */
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private ceremonyTimer: ReturnType<typeof setTimeout> | undefined;
  private shot: { by: number; target: number; until: number } | null = null;
  private executeSince = -1;
  private slowmoClock = Infinity;
  private invShown: number | null = null;
  private invKey: string | null = null;
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
    const headOf = (s: number) => (s === me ? this.pointV.copy(this.world.camera.position) : L.head(s, this.pointV));
    // Your own arm drops as soon as you choose; other Presidents hold the point briefly so everyone sees the pick.
    if (this.pickedPlayer) return null;
    if (this.pointAt && this.now < this.pointAt.until && this.pointAt.by !== me) return { seat: this.pointAt.by, at: headOf(this.pointAt.target) };
    if (v.phase !== 'nominate' && v.phase !== 'investigate' && v.phase !== 'special') return null;
    if (v.president === me) {
      // You point wherever you are aiming.
      this.ray.setFromCamera(this.world.aimNdc(), this.world.camera);
      return { seat: me, at: this.ray.ray.at(3, this.pointV) };
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
  private ray = new THREE.Raycaster();
  private tmpV = new THREE.Vector3();
  private bloodA = new THREE.Vector3(); // victim head
  private bloodB = new THREE.Vector3(); // other head
  private bloodDir = new THREE.Vector3();
  private blood: Bloodshed;
  /** Seats whose execution already has blood, so a snapshot does not rebuild it twice. */
  private bloodied = new Set<number>();
  private gore = true;
  /** Heaviest blood tint on your sleeves this game (0 clean). */
  private ownBlood = 0;
  /** Identity anchor (never in the scene) for blood that lands on the table or floor. */
  private static bloodGround = new THREE.Object3D();
  private bloodVictim = new THREE.Vector3();
  private bloodShooter = new THREE.Vector3();
  private bloodHead = new THREE.Vector3();
  private bloodQ = new THREE.Quaternion();
  private bloodE = new THREE.Euler();
  private bloodP = new THREE.Vector3();
  // Per-frame scratch (see computeTargets); each is consumed before it is written again.
  private pointV = new THREE.Vector3(); // pointing() result, read at once by setAim/setOwnArm/lookAt
  private envV = new THREE.Vector3(); // envelope spot, alive across the role card block
  private frontV = new THREE.Vector3(); // any L.front fed straight into mover.set
  private slotV = new THREE.Vector3(); // playedSlot result
  private tiltV = new THREE.Vector3(); // tiltToMe's own playedSlot
  private restV = new THREE.Vector3(); // ballot rest spot
  private topV = new THREE.Vector3(); // pile tops
  private aimV = new THREE.Vector3(); // gun aim target
  private ringV = new THREE.Vector3(); // acting ring spot
  private focusV = new THREE.Vector3(); // updateCharacters focus point
  private handP = new THREE.Vector3();
  private handQ = new THREE.Quaternion();
  private heldCards: PoolCard[] = [];
  private guideNdc: THREE.Vector3[] = [];
  private restP = new THREE.Vector3();
  private restC = new THREE.Vector3();
  private gunRest = new THREE.Vector3();
  private gunPos = new THREE.Vector3();
  private gunUp = new THREE.Vector3(0, 1, 0);
  private gunMat = new THREE.Matrix4();
  private gunQ = new THREE.Quaternion();
  private fallbackAim = new THREE.Vector3(0, 1.2, 0);
  private now = 0;
  /** Game-clock time the running policy-enacted ceremony ends; power presentation waits for it. */
  private ceremonyUntil = -Infinity;
  private deferredPower: { power: Power; president: number; at: number } | null = null;
  private lastHeartbeat = 0;
  private lastSecond = -1;
  deadlineAt: number | null = null;
  /** Head positions per seat (layout-fixed), and a scratch vector for projecting them. */
  private heads: THREE.Vector3[] = [];
  private proj = new THREE.Vector3();
  private guideBox = new THREE.Box3();
  private guideCentre = new THREE.Vector3();
  private guideDir = new THREE.Vector3();
  private guideFwd = new THREE.Vector3();

  constructor(
    private world: World,
    private interactor: Interactor,
    private ui: UI,
    private send: (a: ActionBody) => void,
  ) {
    this.blood = new Bloodshed(this.world.scene, bloodAtlas());
    this.blood.sound = { splat: () => sfx.bloodSplat(), drip: () => sfx.bloodDrip() };
    ui.onEnactSkip = () => {
      this.ceremonyUntil = Math.min(this.ceremonyUntil, this.now);
      if (this.deferredPower) this.deferredPower.at = this.now;
    };
    ui.onLookAt = (seat) => this.world.glanceAt(this.world.layout.head(seat), 3);
    ui.onMark = (seat) => {
      const next = nextMark(this.marks[seat] ?? null);
      if (next) this.marks[seat] = next;
      else delete this.marks[seat];
      if (this.room) saveMarks(this.room.code, this.marks);
      this.refreshHud();
    };
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

    const vt = labelTexture('VETO', COLORS.fascist, COLORS.ink);
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
    scene.add(this.rings.mesh);
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
    const prevView = this.view;
    this.room = room;
    this.view = room.game;
    if (this.marksCode !== room.code) {
      this.marksCode = room.code;
      this.marks = loadMarks(room.code);
    }
    if (this.view?.phase === 'night' && prevPhase !== 'night') {
      this.marks = {}; // a new deal (also a rematch): fresh suspicions
      saveMarks(room.code, this.marks);
      for (const c of this.chars.values()) c.clearBlood();
      this.clearBloodshed();
    }
    this.rings.set(this.view ? actingSeats(this.view) : []);
    const n = room.game ? room.game.players.length : room.seats.length;
    this.relayout(n, room.you);
    this.syncCharacters();
    if (room.game) this.board.setPowers(room.game.powers);

    if (prevPhase === undefined) {
      this.beats.clear();
      if (room.game) this.shown = { liberal: room.game.liberal, fascist: room.game.fascist, tracker: room.game.tracker };
    }
    const s = scheduleBatch(room.events, { chancellor: room.game?.chancellor ?? null, fascistBefore: prevView?.fascist ?? room.game?.fascist ?? 0 });
    const base = this.beats.push(s, performance.now());
    const over = room.events.find((e) => e.k === 'gameOver');
    if (over && over.k === 'gameOver') {
      const mine = this.view?.yourRole ? partyOf(this.view.yourRole) : null;
      const banner = victoryBanner(over.winner, over.reason, mine);
      this.ceremony = true;
      this.rolesHeld = true;
      this.heldRoles = prevView?.players.map((p) => p.role ?? null) ?? [];
      this.revealedSeats.clear();
      this.syncCharacters();
      clearTimeout(this.ceremonyTimer);
      this.ceremonyTimer = setTimeout(() => this.startVictory(over.winner, banner, mine), Math.max(0, base + s.victoryAt! - performance.now()));
    }
    this.drainBeats();

    const v = this.view;
    if (v) {
      if (v.phase !== prevPhase || v.round !== prevRound) {
        if (v.phase !== 'vote') this.myVote = null;
        this.pendingIndex = null;
        // The card survives the phase its result arrived with, then drops.
        if (this.invShown !== null && this.invKey !== `${v.phase}:${v.round}`) {
          this.invShown = null;
          this.invKey = null;
        }
      }
      if (v.phase === 'night' && prevPhase !== 'night') this.envelopeOpen = false;
      if (v.phase !== 'night' && prevPhase === 'night') this.envelopeOpen = false;
      this.reconcilePool();
      this.syncTiles(prevPhase === undefined);
      if (prevPhase === undefined) {
        const pending = new Set(room.events.flatMap((e) => (e.k === 'executed' ? [e.target] : [])));
        for (const p of v.players) {
          if (p.alive || this.bloodied.has(p.seat) || pending.has(p.seat)) continue;
          this.bloodied.add(p.seat);
          this.blood.settle(this.bloodShot(null, p.seat));
          this.stainSleeves(screenBlood(v.you, p.seat, v.players.length));
        }
      }
    } else {
      this.clearTable();
    }
    this.deadlineAt = room.deadlineMs === null ? null : performance.now() + room.deadlineMs;
    // The server has answered once the state our action was for has changed.
    if (this.inFlight && this.flightKey() !== this.inFlight.key) this.settle();
    this.refreshInteractables();
    this.refreshHud();
    if (v?.phase !== 'gameOver' && this.ceremony) this.cancelVictory();
    this.syncGameOverPanel();
    this.ui.setChatEnabled(this.chatEnabled());
    if (this.turnCue.update(v)) {
      sfx.turn();
      if (document.hidden) flagTab();
    }
    if (myTurnKey(v) === null) unflagTab();
  }

  /** Splashes the victim's chest and face, the neighbours and the shooter's gun arm (the local seat has no patron). */
  private bloodOnPatrons(by: number, target: number) {
    if (!this.gore) return;
    const n = this.view?.players.length ?? 0;
    if (n === 0) return;
    const seed = bloodSeed(target, 0); // a seat dies once per game and a snapshot cannot tell the kill order
    const head = (seat: number, out: THREE.Vector3) => this.chars.get(seat)?.headWorld(out) ?? this.world.layout.head(seat, out);
    const victim = this.chars.get(target);
    head(target, this.bloodA);
    victim?.bloody(this.bloodDir.copy(head(by, this.bloodB)).sub(this.bloodA).normalize(), 1, seed, 'upper');
    const next = (target + 1) % n;
    const prev = (target - 1 + n) % n;
    for (const seat of next === prev ? [next] : [next, prev]) {
      if (seat === target) continue;
      this.chars.get(seat)?.bloody(this.bloodDir.copy(this.bloodA).sub(head(seat, this.bloodB)).normalize(), 0.55, seed + 7919 * (seat + 1), 'all');
    }
    this.chars.get(by)?.bloody(this.bloodDir.copy(this.bloodA).sub(head(by, this.bloodB)).normalize(), 0.3, seed + 104729, 'gunArm');
  }

  /** Tints your own sleeves for a hit on you or a neighbour, keeping any heavier earlier stain. */
  private stainSleeves(kind: ScreenBlood) {
    if (!this.gore) return;
    const amount = sleeveBlood(kind);
    if (amount <= this.ownBlood) return;
    this.ownBlood = amount;
    this.world.setOwnBlood(amount);
  }

  /** The Blood setting: turning it off also wipes the blood already on the table and the patrons. */
  setGore(on: boolean) {
    this.gore = on;
    this.blood.enabled = on;
    if (on) return;
    for (const c of this.chars.values()) c.clearBlood();
    this.clearBloodshed();
  }

  private clearBloodshed() {
    this.blood.clear();
    this.bloodied.clear();
    this.ownBlood = 0;
    this.world.setOwnBlood(0);
    this.ui.clearBloodScreen();
  }

  /** Where a droplet landing at (x, z) sticks: a face-up card on the board, the board, the table or the floor. */
  private resolveBlood: ResolveAnchor = (x, z, surface) => {
    const group = this.board.group;
    group.getWorldPosition(this.bloodP);
    const board: AnchorRect = { cx: this.bloodP.x, cz: this.bloodP.z, halfW: this.board.w / 2, halfD: this.board.h / 2, yaw: 0, top: this.bloodP.y + 0.006 };
    const cards = this.pool.filter((p) => p.where === 'board');
    const rects = cards.map((p) => {
      const mesh = p.card.mesh;
      mesh.getWorldPosition(this.bloodP);
      const yaw = this.bloodE.setFromQuaternion(mesh.getWorldQuaternion(this.bloodQ), 'YXZ').y;
      return { cx: this.bloodP.x, cz: this.bloodP.z, halfW: CARD_W / 2, halfD: CARD_H / 2, yaw, top: this.bloodP.y + 0.0015 };
    });
    const pick = pickAnchor(x, z, surface, board, rects);
    const anchor = pick.kind === 'card' ? cards[pick.index].card.mesh : pick.kind === 'board' ? group : Game.bloodGround;
    return { anchor, y: pick.y };
  };

  /** Everything Bloodshed needs for one seat's execution; `by` null stands the table centre in for an unknown shooter. */
  private bloodShot(by: number | null, target: number): BloodShot {
    const L = this.world.layout;
    const headOf = (seat: number, out: THREE.Vector3) => this.chars.get(seat)?.headWorld(out) ?? L.head(seat, out);
    return {
      seed: bloodSeed(target, 0),
      victimHead: headOf(target, this.bloodVictim),
      shooterHead: by === null ? this.bloodShooter.set(0, 1.32, 0) : headOf(by, this.bloodShooter),
      layout: L,
      chair: L.chair(target),
      resolve: this.resolveBlood,
    };
  }

  /** Plays the beats now due; once the queue is empty the board snaps to the view's counts. */
  private drainBeats() {
    const due = this.beats.due(performance.now());
    for (const b of due) this.onBeat(b);
    const v = this.view;
    let changed = due.length > 0;
    if (v && !this.beats.pending) {
      const sh = this.shown;
      if (sh.liberal !== v.liberal || sh.fascist !== v.fascist || sh.tracker !== v.tracker) {
        this.shown = { liberal: v.liberal, fascist: v.fascist, tracker: v.tracker };
        changed = true;
      }
    }
    if (changed && v) {
      this.syncTiles(false);
      this.refreshHud();
    }
  }

  /** The roles panel shows once the game is over and no win ceremony is running. */
  private syncGameOverPanel() {
    const v = this.view;
    if (v?.phase === 'gameOver' && this.room && !this.ceremony) this.ui.showGameOver(v, this.room);
    else this.ui.hideGameOver();
  }

  private startVictory(winner: Party, banner: VictoryBanner, mine: Party | null) {
    if (!this.ceremony) return;
    this.rolesHeld = false;
    this.revealedSeats.clear();
    if (this.room) this.syncCharacters();
    this.refreshHud();
    sfx.victory(winner, mine === null ? null : mine === winner);
    duckMusic(6);
    this.world.addShake(0.7);
    for (const p of this.view?.players ?? []) {
      if (!p.alive || !p.role) continue;
      const party = partyOf(p.role);
      this.chars.get(p.seat)?.react(party === winner ? 'fist' : 'thumbsDown', 0.1 * p.seat);
    }
    this.ui.victory(banner, () => {
      this.ceremony = false;
      this.syncGameOverPanel();
    });
  }

  private cancelVictory() {
    clearTimeout(this.ceremonyTimer);
    this.ceremonyTimer = undefined;
    if (this.ceremony) this.ui.cancelVictory();
    this.ceremony = false;
    this.rolesHeld = false;
    this.revealedSeats.clear();
    if (this.room) this.syncCharacters();
    this.refreshHud();
  }

  /** The state our in-flight action answers; null with no game. */
  private flightKey(): string | null {
    const v = this.view;
    const me = this.room?.you;
    if (!v || me === undefined) return null;
    return `${v.phase}:${v.round}:${v.pending.includes(me)}`;
  }

  private promptActive(): boolean {
    const v = this.view;
    return !!v && v.you !== null && v.pending.includes(v.you) && v.phase !== 'gameOver';
  }

  private settle() {
    this.inFlight = null;
    this.cardsDone = false;
    this.pickedPlayer = false;
  }

  /** The server refused our action (non-fatal error): undo the optimistic state and let the player retry. */
  actionRejected() {
    if (!this.inFlight) return;
    this.settle();
    this.myVote = this.takenBackVote;
    this.takenBackVote = null;
    this.pendingIndex = null;
    this.refreshInteractables();
    this.refreshHud();
  }

  /** The socket reopened: an in-flight action may have been lost, and the server will resend state. */
  connectionReset() {
    this.actionRejected();
  }

  private clearTable() {
    this.cancelVictory();
    this.beats.clear();
    this.shown = { liberal: 0, fascist: 0, tracker: 0 };
    this.tokenMover.set(this.board.slot('tracker', 0).setY(0.014));
    this.board.liberalTiles.concat(this.board.fascistTiles).forEach((t) => (t.visible = false));
    this.pool.forEach((p) => (p.where = 'pile'));
    this.ceremonyUntil = -Infinity;
    this.deferredPower = null;
    this.myVote = null;
    this.reveal = null;
    this.envelopeOpen = false;
    this.pendingIndex = null;
    this.shot = null;
    this.invShown = null;
    this.invKey = null;
    this.invFlight = null;
    this.pointAt = null;
  }

  /** Back to an empty table (left, kicked or fatal error). */
  reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.room = null;
    this.view = null;
    this.turnCue.reset();
    unflagTab();
    this.rings.set([]);
    this.clearTable();
    this.settle();
    this.speaker = null;
    this.deadlineAt = null;
    this.lastSecond = -1;
    this.disposePatrons();
    this.clearBloodshed();
    for (const vc of this.voteCards.values()) {
      this.world.scene.remove(vc.card.mesh);
      disposeObject(vc.card.mesh);
      this.world.movers.delete(vc.mover);
    }
    this.voteCards.clear();
    this.layoutKey = '';
    this.refreshInteractables();
    this.refreshHud();
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
    this.clearBloodshed();
    this.heads = Array.from({ length: Math.max(5, n) }, (_, s) => this.world.layout.head(s));
    this.disposePatrons();
    const L = this.world.layout;
    this.drawPile.group.position.set(-this.board.w / 2 - 0.13, TABLE_Y, -0.02);
    this.discardPile.group.position.set(this.board.w / 2 + 0.13, TABLE_Y, -0.02);
    this.drawPile.at = this.drawPile.group.position.clone();
    // Snap props into place so nothing flies in from the old layout.
    this.computeTargets();
    for (const m of this.world.movers) m.snap();
    void L;
  }

  /** Removes every patron and envelope from the scene; they are recreated lazily. */
  private disposePatrons() {
    for (const c of this.chars.values()) {
      this.world.scene.remove(c.group);
      c.dispose();
    }
    this.chars.clear();
    for (const m of this.envelopes.values()) this.removeEnvelope(m);
    this.envelopes.clear();
  }

  /** setTimeout whose handle is tracked so reset() can cancel it. */
  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private smokeTip = new THREE.Vector3();
  private smokeMouth = new THREE.Vector3();
  private smokeDir = new THREE.Vector3();

  private newCharacter(seat: number, variant: 'normal' | 'hitler'): Patron {
    const L = this.world.layout;
    const c = createCharacter(seat, this.lookSeed, variant);
    c.group.position.copy(L.chair(seat));
    c.group.rotation.y = L.yaw(seat) + Math.PI;
    this.world.scene.add(c.group);
    this.chars.set(seat, c);
    return c;
  }

  // Geometry is shared with the template; only the per-clone materials are freed.
  private removeEnvelope(env: THREE.Mesh) {
    this.world.scene.remove(env);
    disposeObject(env, { geometry: false });
  }

  private syncCharacters() {
    const room = this.room!;
    const L = this.world.layout;
    const v = this.view;
    const seats = v ? v.players.map((p) => p.seat) : room.seats.map((s) => s.seat);
    // A new room deals a new line-up: every patron is rebuilt.
    const seed = seedOf(room.code);
    const redeal = seed !== this.lookSeed;
    if (redeal) {
      this.lookSeed = seed;
      this.world.setLookSeed(seed);
    }
    for (const [seat, c] of this.chars) {
      if (redeal || !seats.includes(seat) || seat === room.you) {
        this.world.scene.remove(c.group);
        c.dispose();
        this.chars.delete(seat);
        const env = this.envelopes.get(seat);
        if (env) this.removeEnvelope(env);
        this.envelopes.delete(seat);
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
      }
      if (!this.envelopes.has(seat)) {
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
      const role = roleShown(p?.role ?? null, this.rolesHeld ? this.heldRoles : null, seat);
      if (role && role !== 'liberal') {
        label += role === 'hitler' ? ' · HITLER' : tr({ en: ' · FASCIST', es: ' · FASCISTA' });
        color = '#ff8f7a';
      } else if (role === 'liberal' && v?.phase === 'gameOver' && !this.rolesHeld) {
        label += tr({ en: ' · LIBERAL', es: ' · LIBERAL' });
        color = '#9fd0ef';
      }
      if (info?.bot) label += ' (bot)';
      else if (info && !info.connected) label += tr({ en: ' (away)', es: ' (ausente)' });
      else if (info?.botControlled) label += tr({ en: ' (auto)', es: ' (auto)' });
      if (p && !p.alive) label = `✝ ${label}`;
      c.setLabel(label, color);
    }
  }

  private name(seat: number | null | undefined): string {
    if (seat === null || seat === undefined) return '?';
    if (seat === this.room?.you) return `${this.room.seats[seat]?.name ?? tr({ en: 'You', es: 'Tú' })} ${tr({ en: '(you)', es: '(tú)' })}`;
    return this.room?.seats[seat]?.name ?? this.view?.players[seat]?.name ?? `${tr({ en: 'Seat', es: 'Asiento' })} ${seat + 1}`;
  }

  private say(e: Beat) {
    const c = eventCopy(e, (s) => this.name(s), this.room?.you);
    if (c) this.ui.toast(c.text, c.kind);
  }

  private onBeat(e: Beat) {
    const v = this.view;
    const me = this.room?.you;
    switch (e.k) {
      case 'nightStart':
        sfx.night();
        this.say(e);
        break;
      case 'timedOut':
        this.say(e);
        break;
      case 'newPresident':
        sfx.slide();
        this.say(e);
        break;
      case 'nominated':
        sfx.nominate();
        this.pointAt = { by: e.president, target: e.target, until: this.now + 2.5 };
        this.say(e);
        this.chars.get(e.target)?.react('recoil', 0.15);
        break;
      case 'voted':
        sfx.slap();
        if (e.seat === me) this.world.addShake(0.35);
        break;
      case 'unvoted':
        if (e.seat === me) sfx.flip();
        break;
      case 'votes': {
        this.reveal = { votes: e.votes, until: this.now + VOTE_REVEAL_MS / 1000 };
        this.voteCards.forEach((vc) => (vc.shown = false));
        this.later(() => sfx.flip(), 150);
        // One shout for the table, decided by the group: JA! if the government passed, NEIN! if it failed.
        this.later(() => voice.vote(e.passed), 300);
        this.say(e);
        e.votes.forEach((vote, i) => {
          if (vote !== null) this.chars.get(i)?.react(vote ? 'thumbsUp' : 'thumbsDown', 0.35 + 0.08 * i);
        });
        break;
      }
      case 'tracker':
        this.shown.tracker = e.value;
        if (e.value > 0) {
          sfx.trackerAdvance();
          this.say(e);
        }
        break;
      case 'vetoTracker':
        this.shown.tracker = e.value;
        sfx.trackerAdvance();
        this.say(e);
        break;
      case 'chaos':
        sfx.chaos();
        duckMusic(2.5);
        this.world.addShake(0.8);
        this.say(e);
        break;
      case 'vetoUnlocked':
        if (v?.phase === 'gameOver') break;
        sfx.vetoUnlocked();
        this.say(e);
        break;
      case 'hitlerRevealed':
        this.heldRoles[e.seat] = 'hitler';
        this.revealedSeats.add(e.seat);
        this.syncCharacters();
        sfx.hitlerReveal();
        duckMusic(3);
        this.world.addShake(0.9);
        this.chars.get(e.seat)?.react('fist', 0);
        this.say(e);
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
        this.lastChancellor = e.to;
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
        const count = ++this.shown[e.policy === 'L' ? 'liberal' : 'fascist'];
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
          card.boardSlot = this.board.slot(e.policy === 'L' ? 'liberal' : 'fascist', Math.max(0, count - 1)).add(this.board.group.position);
          this.sendTo(card, 'board');
        }
        this.ceremonyUntil = ceremonyEndsAt(this.now);
        this.later(() => {
          sfx.enact(e.policy);
          duckMusic(2.5);
          this.world.addShake(0.5);
          this.ui.enact(e.policy, count, !!e.chaos);
        }, ENACT_BANNER_DELAY_MS);
        this.say(e);
        if (!e.chaos && this.lastChancellor !== null) this.chars.get(this.lastChancellor)?.react('fist', 0);
        break;
      }
      case 'reshuffled':
        sfx.slide();
        this.say(e);
        break;
      case 'power':
        if (this.now < this.ceremonyUntil) this.deferredPower = { power: e.power, president: e.president, at: this.ceremonyUntil };
        else this.presentPower(e.power, e.president);
        break;
      case 'peeked':
        this.deferredPower = null;
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
          this.invKey = this.view ? `${this.view.phase}:${this.view.round}` : null;
          const res = v?.yourInvestigations.find((i) => i.target === e.target);
          if (res) this.invCard.setFace(membershipCard(this.name(e.target), res.party));
          this.invCard.mesh.position.copy(this.world.layout.front(e.target));
        }
        this.say(e);
        break;
      case 'specialElected':
        this.pointAt = { by: e.by, target: e.target, until: this.now + 2.5 };
        this.say(e);
        break;
      case 'executed': {
        this.shot = { by: e.by, target: e.target, until: this.now + 2.8 };
        const shooter = this.chars.get(e.by);
        shooter?.setAim(this.world.layout.head(e.target), 'gun', true); // the arm may still be drifting to the last target
        if (e.by !== me) this.gunSnapFrames = 2;
        shooter?.recoil();
        this.chars.get(e.target)?.die();
        this.bloodOnPatrons(e.by, e.target);
        if (!this.bloodied.has(e.target)) {
          this.bloodied.add(e.target);
          const sb = screenBlood(me ?? null, e.target, v?.players.length ?? 0);
          if (this.gore) this.ui.bloodScreen(sb, bloodSeed(e.target, 0));
          this.stainSleeves(sb);
          this.blood.execute(this.bloodShot(e.by, e.target), () => this.chars.get(e.target)?.headWorld(this.bloodHead) ?? null);
        }
        voice.gunshot();
        voice.death(this.chars.get(e.target)?.woman ?? false);
        this.world.addShake(e.target === me ? 1.5 : 1.0);
        let muzzle = new THREE.Vector3(0, 0, -0.2).applyMatrix4(this.gun.matrixWorld);
        let dir = new THREE.Vector3(0, 0, -1).transformDirection(this.gun.matrixWorld);
        if (shooter && e.by !== me) {
          const { pos, quat } = shooter.gunPose();
          muzzle = GUN_MUZZLE.clone().multiplyScalar(GUN_SCALE).applyQuaternion(quat).add(pos);
          dir = this.world.layout.head(e.target).sub(muzzle).normalize();
        }
        this.world.flash(muzzle, dir);
        this.slowmoClock = 0;
        this.ui.flash();
        this.say(e);
        break;
      }
      case 'vetoProposed':
        sfx.stamp();
        this.say(e);
        break;
      case 'vetoAnswer':
        sfx.stamp();
        this.say(e);
        if (e.accepted) this.pool.filter((p) => p.where === 'held').forEach((p) => this.sendTo(p, 'discard'));
        break;
      case 'acked':
        break;
    }
  }

  /** Power toast and sound, and for a peek the deal of the top three cards to the President. */
  private presentPower(power: Power, president: number) {
    this.ui.toast(powerCopy(power), 'power');
    if (power === 'execute') sfx.cock();
    if (power === 'peek') {
      sfx.draw();
      this.pool.forEach((p) => {
        p.where = 'held';
        p.holder = president;
        p.face = null;
        p.mover.hideOnArrive = false;
        p.card.mesh.position.copy(this.drawPile.topPosition());
        p.card.mesh.visible = true;
      });
      if (president === this.room?.you) this.dropIntoHand();
    }
  }

  /** Your own cards arrive from above the view and settle into your hand, rather than rising from the table. */
  private dropIntoHand() {
    const cam = this.world.camera;
    cam.updateMatrixWorld();
    const held = this.pool.filter((p) => p.where === 'held');
    held.forEach((p, i) => {
      this.handPose(i, held.length, -0.42, -0.17, this.handP, this.handQ);
      const off = i - (held.length - 1) / 2;
      p.card.mesh.position.copy(new THREE.Vector3(off * 0.125, 0.42 + i * 0.05, -0.45).applyMatrix4(cam.matrixWorld));
      p.card.mesh.quaternion.copy(this.handQ);
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
    // While the peek deal waits for the enact ceremony, nobody holds the cards yet.
    const peek = v.phase === 'peek' && this.deferredPower?.power !== 'peek';
    const holder =
      v.phase === 'legPresident' || peek
        ? v.president
        : v.phase === 'legChancellor' || v.phase === 'veto'
          ? v.chancellor
          : null;
    const count = v.phase === 'legPresident' || peek ? 3 : holder !== null ? 2 : 0;
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
          m.scale = this.board.tileScale;
          m.set(slot, new THREE.Quaternion(), instant ? 50 : 6);
        } else {
          m.visible = false;
          t.visible = false;
        }
      });
    };
    const { liberal, fascist, tracker } = this.shown;
    place(this.board.liberalTiles, liberal, 'liberal', 0);
    place(this.board.fascistTiles, fascist, 'fascist', 5);
    this.tokenMover.set(this.board.slot('tracker', Math.min(3, tracker)).setY(0.014), undefined, instant ? 50 : 5);
  }

  // ---------- interaction ----------

  /** True while a card in your hand is waiting for you to choose it. */
  cardMode(): boolean {
    const v = this.view;
    const me = this.room?.you;
    if (!v || me === undefined || v.phase === 'gameOver') return false;
    if (this.envelopeOpen || this.invShown !== null) return true;
    if (this.cardsDone || !v.pending.includes(me)) return false;
    if (this.deferredPower?.power === 'peek') return false;
    return v.hand !== null || v.peek !== null;
  }

  private act(a: ActionBody, index?: number) {
    if (this.inFlight) return;
    this.clearCardSelection();
    if (a.type === 'presDiscard' || a.type === 'chancEnact' || a.type === 'peekDone') this.cardsDone = true;
    if (a.type === 'nominate' || a.type === 'investigate' || a.type === 'specialElect') this.pickedPlayer = true;
    if (index !== undefined) this.pendingIndex = index;
    if (a.type === 'vote') {
      this.myVote = a.ja;
      this.takenBackVote = null;
      sfx.slap();
      this.world.addShake(0.3);
    }
    if (a.type === 'unvote') {
      this.takenBackVote = this.myVote;
      this.myVote = null;
      sfx.flip();
    }
    const key = this.flightKey();
    if (key !== null) this.inFlight = { key, at: this.now };
    this.send(a);
    this.refreshInteractables();
  }

  private clearCardSelection() {
    this.selectedCard = null;
    this.reshowCard = null;
    this.ui.hideCardConfirm();
  }

  /** First click selects a card and asks for confirmation; clicking it again cancels. */
  private pickCard(a: ActionBody & { type: 'presDiscard' | 'chancEnact' }, face: 'L' | 'F', handSize: number) {
    if (this.selectedCard === a.index) this.clearCardSelection();
    else {
      this.selectedCard = a.index;
      const confirm = () => {
        // Re-check the live legal actions: the pick may be stale.
        const index = this.selectedCard;
        const cur = this.view && !this.inFlight ? legalFromView(this.view).find((l) => l.type === a.type && l.index === index) : undefined;
        if (cur && index !== null) {
          this.act(cur, index);
          this.interactor.relockAfterCards();
        } else this.clearCardSelection();
      };
      const cancel = () => {
        this.clearCardSelection();
        this.refreshInteractables();
      };
      this.reshowCard = () => this.ui.showCardConfirm(cardConfirmCopy(a.type === 'presDiscard' ? 'discard' : 'enact', face, handSize), confirm, cancel);
      this.reshowCard();
    }
    this.refreshInteractables();
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
          ? tr({ en: 'Close your eyes', es: 'Cierra los ojos' })
          : tr({ en: 'Put the role card away', es: 'Guarda la carta de rol' })
        : tr({ en: 'Open your role envelope', es: 'Abre el sobre de tu rol' }),
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
        this.refreshHud();
      },
    });
    if (this.invShown !== null) {
      list.push({
        id: 'inv-card',
        objects: [this.invCard.mesh],
        label: tr({ en: 'Put the membership card away', es: 'Guarda el carné de partido' }),
        action: false,
        onClick: () => {
          this.invShown = null;
          this.invKey = null;
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
        label: tr({
          en: `${this.name(seat)} can't be Chancellor: ${this.limitReason(seat)} (term limit)`,
          es: `${this.name(seat)} no puede ser Canciller: ${this.limitReason(seat)} (mandato limitado)`,
        }),
        action: false,
        onClick: () => this.ui.toast(
            tr({
              en: `${this.name(seat)} is term-limited: ${this.limitReason(seat)}.`,
              es: `${this.name(seat)} tiene el mandato limitado: ${this.limitReason(seat)}.`,
            }),
            'bad',
          ),
      });
    }
    const legal = this.inFlight ? [] : legalFromView(v);
    if (!legal.some((a) => a.type === 'presDiscard' || a.type === 'chancEnact')) this.clearCardSelection();
    for (const a of legal) {
      switch (a.type) {
        case 'nominate':
        case 'investigate':
        case 'specialElect':
        case 'execute': {
          const c = this.chars.get(a.target);
          if (!c) break;
          const verb = {
            nominate: tr({ en: `Nominate ${this.name(a.target)} as Chancellor`, es: `Nominar a ${this.name(a.target)} como Canciller` }),
            investigate: tr({ en: `Investigate ${this.name(a.target)}`, es: `Investigar a ${this.name(a.target)}` }),
            specialElect: tr({ en: `Make ${this.name(a.target)} the next President`, es: `Hacer a ${this.name(a.target)} el próximo Presidente` }),
            execute: tr({ en: `Shoot ${this.name(a.target)}`, es: `Disparar a ${this.name(a.target)}` }),
          }[a.type];
          list.push({ id: `seat-${a.target}`, objects: c.hitMeshes, label: verb, action: true, onClick: () => this.act(a) });
          break;
        }
        case 'vote':
          if (this.myVote !== null) break;
          list.push({
            id: a.ja ? 'vote-ja' : 'vote-nein',
            objects: [a.ja ? this.ja.mesh : this.nein.mesh],
            label: a.ja ? tr({ en: 'Slam JA!', es: '¡Estampa JA!' }) : tr({ en: 'Slam NEIN', es: 'Estampa NEIN' }),
            action: true,
            onClick: () => this.act(a),
          });
          break;
        case 'unvote':
          if (this.myVote === null) break;
          list.push({
            id: this.myVote ? 'vote-ja' : 'vote-nein',
            objects: [this.myVote ? this.ja.mesh : this.nein.mesh],
            label: tr({ en: 'Take back your vote', es: 'Retirar tu voto' }),
            action: true,
            onClick: () => this.act(a),
          });
          break;
        case 'vetoResponse':
          list.push({
            id: a.accept ? 'vote-ja' : 'vote-nein',
            objects: [a.accept ? this.ja.mesh : this.nein.mesh],
            label: a.accept ? tr({ en: 'JA: agree to the veto', es: 'JA: aceptar el veto' }) : tr({ en: 'NEIN: refuse the veto', es: 'NEIN: rechazar el veto' }),
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
              label: tr({
                en: `Select this ${p.face === 'L' ? 'Liberal' : 'Fascist'} policy to discard`,
                es: `Elige esta ley ${p.face === 'L' ? 'liberal' : 'fascista'} para descartarla`,
              }),
              action: true,
              onClick: () => p.face && this.pickCard(a, p.face, held.length),
            });
          } else {
            // Click the card you want to ENACT; the other one is discarded.
            const p = held[a.index];
            if (!p) break;
            list.push({
              id: `hand-${a.index}`,
              objects: [p.card.mesh],
              label: tr({
                en: `Select this ${p.face === 'L' ? 'Liberal' : 'Fascist'} policy to enact`,
                es: `Elige esta ley ${p.face === 'L' ? 'liberal' : 'fascista'} para promulgarla`,
              }),
              action: true,
              onClick: () => p.face && this.pickCard(a, p.face, held.length),
            });
          }
          break;
        }
        case 'proposeVeto':
          list.push({ id: 'veto', objects: [this.vetoToken], label: tr({ en: 'Propose a veto', es: 'Proponer un veto' }), action: true, onClick: () => this.act(a) });
          break;
        case 'peekDone':
          if (this.deferredPower?.power === 'peek') break;
          this.pool
            .filter((p) => p.where === 'held')
            .forEach((p, i) =>
              list.push({ id: `peek-${i}`, objects: [p.card.mesh], label: tr({ en: 'Put the policies back', es: 'Devolver las leyes' }), action: true, onClick: () => this.act(a) }),
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
    if (seat === v.lastChancellor) return tr({ en: 'they were the last elected Chancellor', es: 'fue el último Canciller elegido' });
    if (seat === v.lastPresident) return tr({ en: 'they were the last elected President', es: 'fue el último Presidente elegido' });
    return tr({ en: 'not eligible this round', es: 'no es elegible esta ronda' });
  }

  // ---------- HUD ----------

  /** The language changed: rebuild every string derived from the last view. */
  relang() {
    if (this.room) this.syncCharacters();
    this.refreshInteractables();
    this.reshowCard?.();
    this.refreshHud();
    this.syncGameOverPanel();
    this.ui.setChatEnabled(this.chatEnabled());
  }

  private chatEnabled(): boolean {
    const v = this.view;
    return !v || v.phase === 'gameOver' || !!v.players[this.room?.you ?? -1]?.alive;
  }

  private refreshHud() {
    const { room, view } = this;
    if (room && view) {
      const opts = {
        envelopeOpen: this.envelopeOpen,
        myVote: this.myVote,
        termLimited: this.termLimited(),
        marks: this.marks,
        shown: this.shown,
        heldRoles: this.rolesHeld ? this.heldRoles : null,
      };
      this.ui.renderHud(hudModel(view, room, opts), this.promptActive());
    } else if (room) {
      const text =
        room.seats.length < 5
          ? tr({ en: 'Waiting for players… (5 to 10 seats, the host can add bots)', es: 'Esperando jugadores… (de 5 a 10 asientos, el anfitrión puede añadir bots)' })
          : tr({ en: 'Waiting for the host to start.', es: 'Esperando a que el anfitrión empiece.' });
      this.ui.renderHud(null, false, text);
    } else this.ui.renderHud(null, false);
  }

  // ---------- per-frame ----------

  private handPose(i: number, k: number, z: number, y: number, pos: THREE.Vector3, q: THREE.Quaternion) {
    const off = i - (k - 1) / 2;
    const cam = this.world.camera;
    pos.set(off * 0.125, y - Math.abs(off) * 0.01, z).applyMatrix4(cam.matrixWorld);
    mul(q, cam.quaternion, Q('x', Math.PI / 2 - 0.12, QA), Q('y', -off * 0.08, QB));
    pos.addScaledVector(this.tmpV.set(0, 1, 0).applyQuaternion(q), fanLayer(i, k)); // fanned cards never share a plane
  }

  private computeTargets() {
    const L = this.world.layout;
    const v = this.view;
    const room = this.room;
    const me = room?.you ?? 0;
    const now = this.now;
    const hovered = this.interactor.hovered;
    this.world.camera.updateMatrixWorld();
    const acting = (id: string) => !!this.interactor.items.get(id)?.action;
    const wave = idlePulse(now);

    // Envelope and role card.
    const envPos = L.front(me, -0.3, 0.02, 0.8, this.envV);
    this.envMover.set(this.tmpV.copy(envPos).setY(envPos.y + (hovered === 'envelope' ? 0.02 : 0)), Q('y', L.yaw(me), QA));
    this.envMover.visible = !!v;
    this.envelope.setGlow(hovered === 'envelope' || (v?.phase === 'night' && !this.envelopeOpen && !v.players[me]?.acked) ? 0.6 + Math.sin(now * 4) * 0.3 : 0);
    if (v?.yourRole) this.roleCard.setFace(roleCard(v.yourRole));
    if (this.envelopeOpen) {
      this.handPose(0, 1, -0.38, -0.05, this.handP, this.handQ);
      this.roleMover.set(this.handP, this.handQ, 10);
      this.roleMover.visible = true;
      this.roleMover.hideOnArrive = false;
    } else {
      this.roleMover.set(this.tmpV.copy(envPos).setY(envPos.y + 0.006), Q('y', L.yaw(me), QA), 12);
      this.roleMover.hideOnArrive = true;
    }
    this.roleCard.setGlow(hovered === 'role-card' ? 0.1 : 0);
    for (const [seat, env] of this.envelopes) env.visible = !!v && !!v.players[seat];

    // Placards.
    const restP = this.restP.set(-0.25, TABLE_Y + 0.043, -this.board.h / 2 - 0.12);
    const restC = this.restC.set(0.25, TABLE_Y + 0.043, -this.board.h / 2 - 0.12);
    if (v && v.phase !== 'night') {
      const p = L.front(v.president, -0.2, 0.12, 0.8, this.frontV);
      p.y += 0.043;
      this.presMover.set(p, Q('y', L.yaw(v.president), QA), 4);
    } else this.presMover.set(restP, IDENTITY_Q, 4);
    const chan = v ? (v.phase === 'vote' ? v.nominee : v.chancellor) : null;
    if (chan !== null && chan !== undefined && v?.phase !== 'gameOver') {
      const p = L.front(chan, 0.2, 0.12, 0.8, this.frontV);
      p.y += 0.043;
      this.chanMover.set(p, mul(QOUT, Q('y', L.yaw(chan), QA), Q('x', v?.phase === 'vote' ? -0.35 : 0, QB)), 4);
    } else this.chanMover.set(restC, IDENTITY_Q, 4);

    // Policy cards.
    this.drawPile.setCount(v?.deckCount ?? 17);
    this.discardPile.setCount(v?.discardCount ?? 0);
    const held = this.heldCards;
    held.length = 0;
    for (const p of this.pool) if (p.where === 'held') held.push(p);
    held.forEach((p, i) => {
      const hover = hovered === `hand-${i}` || hovered === `peek-${i}` || this.selectedCard === i;
      if (p.holder === me) {
        // Held high enough to be fully visible; hovering brings the card toward you.
        this.handPose(i, held.length, hover ? -0.36 : -0.42, hover ? -0.045 : -0.07, this.handP, this.handQ);
        p.mover.set(this.handP, this.handQ, 10);
        // Red when the click discards the card, green when it enacts it.
        p.card.setGlow(hover ? 0.5 : acting(`hand-${i}`) ? 0.12 + 0.18 * wave : 0, v?.phase === 'legPresident' ? 'discard' : v?.phase === 'legChancellor' ? 'enact' : undefined);
      } else {
        const off = i - (held.length - 1) / 2;
        const pos = L.front(p.holder, off * 0.09, 0.02, 0.86, this.frontV);
        pos.y += 0.16;
        // Half a turn about the card's normal so the back (seen by everyone else) reads upright.
        const q = mul(QOUT, Q('y', L.yaw(p.holder), QA), Q('x', Math.PI / 2 - 0.25, QB), Q('y', Math.PI - off * 0.12, QC));
        pos.addScaledVector(this.tmpV.set(0, 1, 0).applyQuaternion(q), fanLayer(i, held.length));
        p.mover.set(pos, q, 7);
        p.card.setGlow(0);
        p.card.setFace(cardBack('POLICY'));
      }
      if (p.face && p.holder === me) p.card.setFace(policyFace(p.face));
      p.mover.hideOnArrive = false;
      p.mover.visible = true;
    });
    for (const p of this.pool) {
      if (p.where === 'discard') {
        p.mover.set(this.discardPile.topPosition(this.topV).add(DISCARD_LIFT), FLIP_X_Q, 6);
      } else if (p.where === 'board' && p.boardSlot) {
        p.mover.set(this.tmpV.copy(p.boardSlot).add(BOARD_LIFT), IDENTITY_Q, 5);
      } else if (p.where === 'pile') {
        p.mover.set(this.drawPile.topPosition(this.topV), FLIP_X_Q, 8);
        p.mover.hideOnArrive = true;
      }
      if (p.where !== 'held' && p.where !== 'board') p.card.setGlow(0);
    }

    this.rings.update((s) => L.front(s, 0, 0.08, 0.8, this.ringV));

    // Ballots: your Ja/Nein pair plus everyone else's played cards.
    const revealing = this.reveal && now < this.reveal.until ? this.reveal : null;
    if (this.reveal && !revealing) this.reveal = null;
    const playedSlot = (seat: number, out: THREE.Vector3) => L.front(seat, 0.05, 0.14, 0.8, out);
    const tiltToMe = (seat: number) => {
      const pos = playedSlot(seat, this.tiltV);
      const cam = this.world.camera.position;
      return Math.atan2(cam.x - pos.x, cam.z - pos.z);
    };
    const myChoice = revealing ? revealing.votes[me] : v?.phase === 'vote' ? this.myVote : null;
    for (const [ballot, mover, ja] of [[this.ja, this.jaMover, true], [this.nein, this.neinMover, false]] as const) {
      const rest = L.front(me, ja ? 0.17 : 0.33, 0.03, 0.8, this.restV);
      const bid = ja ? 'vote-ja' : 'vote-nein';
      const hover = hovered === bid;
      if (myChoice === ja) {
        const pos = playedSlot(me, this.slotV);
        if (revealing) {
          pos.y += 0.06;
          mover.set(pos, mul(QOUT, Q('y', tiltToMe(me), QA), Q('x', 0.9, QB)), 10);
        } else mover.set(pos, FLIP_X_Q, 16);
      } else {
        rest.y += hover ? 0.04 : 0;
        mover.set(rest, mul(QOUT, Q('y', 0.08, QA), Q('x', hover ? 0.3 : 0, QB)), 12);
      }
      ballot.setGlow(hover ? 0.25 : acting(bid) ? 0.06 + 0.12 * wave : 0);
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
        const slot = playedSlot(p.seat, this.slotV);
        const rv = revealing?.votes[p.seat];
        if (revealing && rv !== null && rv !== undefined) {
          vc.card.setFace(ballotFace(rv));
          slot.y += 0.06;
          vc.mover.set(slot, mul(QOUT, Q('y', tiltToMe(p.seat), QA), Q('x', 0.9, QB)), 9);
          vc.mover.scale = 1.5;
          vc.mover.visible = true;
          vc.mover.hideOnArrive = false;
        } else if (v.phase === 'vote' && p.hasVoted) {
          if (!vc.shown) {
            vc.shown = true;
            vc.card.mesh.visible = true;
            vc.card.mesh.position.copy(slot);
            vc.card.mesh.position.y += 0.3;
            vc.card.mesh.scale.setScalar(1);
          }
          vc.mover.set(slot, mul(QOUT, Q('y', L.yaw(p.seat), QA), FLIP_X_Q), 16);
          vc.mover.scale = 1;
          vc.mover.visible = true;
          vc.mover.hideOnArrive = false;
        } else {
          vc.shown = false;
          vc.mover.set(this.tmpV.copy(slot).setY(TABLE_Y - 0.05), mul(QOUT, Q('y', L.yaw(p.seat), QA), FLIP_X_Q), 8);
          vc.mover.scale = 1;
          vc.mover.hideOnArrive = true;
        }
      }
    }

    // Veto token.
    const vetoLegal = !!v && v.phase === 'legChancellor' && v.chancellor === me && v.vetoUnlocked && !v.vetoRefused;
    const vt = L.front(me, -0.12, 0.2, 0.8, this.frontV);
    vt.y += vetoLegal ? 0.012 + (hovered === 'veto' ? 0.03 : 0) : -0.05;
    this.vetoMover.set(vt, IDENTITY_Q, 8);
    this.vetoMover.visible = vetoLegal;
    (this.vetoToken.material as THREE.MeshStandardMaterial[])[2].emissiveIntensity = hovered === 'veto' ? 0.9 : acting('veto') ? 0.3 + 0.5 * wave : 0.3;

    // Revolver.
    const gunRest = this.gunRest.set(this.board.w / 2 + 0.1, TABLE_Y + 0.02, this.board.h / 2 + 0.08);
    const shooting = this.shot && now < this.shot.until ? this.shot : null;
    if (this.shot && !shooting) this.shot = null;
    const holderSeat = shooting ? shooting.by : v?.phase === 'execute' ? v.president : null;
    const drift = holderSeat !== null && holderSeat !== undefined ? this.driftSeat(v, holderSeat, now) : null;
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
      const pos = this.gunPos.set(0.16, -0.15, -0.4).applyMatrix4(cam.matrixWorld);
      let aim: THREE.Vector3;
      if (shooting) aim = L.head(shooting.target, this.aimV);
      else {
        this.ray.setFromCamera(this.world.aimNdc(), cam);
        aim = this.ray.ray.at(4, this.aimV);
      }
      const q = this.gunQ.setFromRotationMatrix(this.gunMat.lookAt(pos, aim, this.gunUp));
      this.gunMover.set(pos, shooting && now > shooting.until - 2.6 && now < shooting.until - 2.3 ? mul(QOUT, q, Q('x', 0.5, QA)) : q, 14);
    } else if (holderSeat !== null && holderSeat !== undefined) {
      // The President raises their arm; the aim drifts from player to player until the shot, then locks on.
      const c = this.chars.get(holderSeat);
      const aimAt = shooting
        ? L.head(shooting.target, this.aimV)
        : drift !== null
          ? (drift === me ? this.aimV.copy(this.world.camera.position) : L.head(drift, this.aimV))
          : this.fallbackAim;
      if (c) {
        c.setAim(aimAt);
        const { pos, quat } = c.gunPose(); // the gun sits in the hand and points wherever the arm points
        this.gunMover.set(pos, quat, 16);
        if (this.gunSnapFrames > 0) {
          this.gunMover.snap();
          this.gunSnapFrames--;
        }
      } else {
        const pos = L.front(holderSeat, 0.12, -0.05, 0.92, this.frontV).setY(TABLE_Y + 0.28);
        this.gunMover.set(pos, this.gunQ.setFromRotationMatrix(this.gunMat.lookAt(pos, aimAt, this.gunUp)), 16);
      }
    } else {
      this.gunMover.set(gunRest, GUN_REST_Q, 5);
    }
    // Whoever the gun is aimed at puts their hands up.
    let aimedSeat: number | null = null;
    if (shooting) aimedSeat = shooting.target;
    else if (holderSeat !== null && holderSeat !== undefined && holderSeat !== me) {
      aimedSeat = drift;
    } else if (holderSeat === me && v) {
      const m = /^seat-(\d+)$/.exec(hovered ?? '');
      const seat = m ? Number(m[1]) : -1;
      aimedSeat = seat !== me && v.players.some((p) => p.seat === seat && p.alive) ? seat : null;
    }
    for (const [seat, c] of this.chars) c.setHandsUp(seat === aimedSeat);
    this.world.setOwnHandsUp(aimedSeat === me);

    // Investigation: membership card slides across; the investigator holds it face-up.
    const flight = this.invFlight && now < this.invFlight.until ? this.invFlight : null;
    if (this.invFlight && !flight) this.invFlight = null;
    if (this.invShown !== null) {
      this.handPose(0, 1, -0.38, -0.06, this.handP, this.handQ);
      this.invMover.set(this.handP, this.handQ, 6);
      this.invMover.visible = true;
      this.invMover.hideOnArrive = false;
      this.invCard.setGlow(hovered === 'inv-card' ? 0.1 : 0);
    } else if (flight) {
      const p = L.front(flight.by, 0, 0.1, 0.8, this.frontV);
      p.y += 0.02;
      this.invMover.set(p, mul(QOUT, Q('y', L.yaw(flight.by), QA), FLIP_X_Q), 2.5);
      this.invMover.visible = true;
      this.invMover.hideOnArrive = false;
      if (!this.invCard.mesh.visible) this.invCard.mesh.position.copy(L.front(flight.target, 0, 0, 0.8, this.frontV));
    } else {
      this.invMover.set(L.front(me, 0, 0, 0.6, this.frontV).setY(TABLE_Y - 0.1), IDENTITY_Q, 4);
      this.invMover.hideOnArrive = true;
    }

    // Revealed role cards at game over.
    if (v?.phase === 'gameOver') {
      for (const p of v.players) {
        if (!p.role || (this.rolesHeld && !this.revealedSeats.has(p.seat))) continue;
        let r = this.reveals.get(p.seat);
        if (!r) {
          const card = new Card(roleCard(p.role), cardBack('ROLE'), 1.2);
          card.mesh.position.copy(L.front(p.seat, -0.34, -0.02));
          this.world.scene.add(card.mesh);
          r = { card, mover: this.world.track(new Mover(card.mesh)) };
          this.reveals.set(p.seat, r);
        }
        const pos = L.front(p.seat, -0.34, 0.06, 0.8, this.frontV);
        pos.y += 0.08;
        r.mover.set(pos, mul(QOUT, Q('y', tiltToMe(p.seat), QA), Q('x', 1.0, QB)), 3);
      }
    } else if (this.reveals.size) {
      for (const r of this.reveals.values()) {
        this.world.scene.remove(r.card.mesh);
        disposeObject(r.card.mesh);
        this.world.movers.delete(r.mover);
      }
      this.reveals.clear();
    }
  }

  /** The alive player (not the gun holder) the aim drifts to at `now`, in seat order; null when there is none. */
  private driftSeat(v: GameView | null, holder: number, now: number): number | null {
    if (!v) return null;
    let n = 0;
    for (const p of v.players) if (p.alive && p.seat !== holder) n++;
    if (!n) return null;
    let k = Math.floor(now / 1.8) % n;
    for (const p of v.players) if (p.alive && p.seat !== holder && k-- === 0) return p.seat;
    return null;
  }

  private updateCharacters(dt: number) {
    const v = this.view;
    const room = this.room;
    if (!room) return;
    const L = this.world.layout;
    const me = room.you;
    const camPos = this.world.camera.position;
    const wave = idlePulse(this.now);
    const focusPoint = (seat: number) => (seat === me ? this.focusV.copy(camPos) : L.head(seat, this.focusV));
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
        target = t !== null && t !== undefined ? focusPoint(t) : TABLE_CENTRE;
      } else target = TABLE_CENTRE;
      if (!v) target = camPos;
      if (pointing && pointing.seat === seat) target = pointing.at; // eyes follow the finger
      c.lookAt(target);
      c.setHighlight(hovered === `seat-${seat}` ? 1 : this.interactor.items.get(`seat-${seat}`)?.action ? 0.2 + 0.25 * wave : 0);
      const role = v?.players[seat]?.role;
      c.setTeamGlow(!!knowsTeam && v?.phase === 'night' && !!role && role !== 'liberal');
      c.chair = this.world.chairObject(seat);
      c.update(dt, this.now);
      if (c.smoker) {
        const ex = c.smokeEmit(this.smokeTip, this.smokeMouth, this.smokeDir);
        if (ex >= 0) {
          this.world.cigaretteSmoke.wisp(seat, this.smokeTip, dt);
          this.world.cigaretteSmoke.exhale(seat, this.smokeMouth, this.smokeDir, ex, dt);
        }
      }
    }
  }

  /** Real-time dt in, sim speed factor out: brief slow-motion after an execution. */
  timeScale(realDt: number): number {
    if (this.slowmoClock === Infinity) return 1;
    this.slowmoClock += realDt;
    if (this.slowmoClock >= 0.85) this.slowmoClock = Infinity;
    return slowmoScale(this.slowmoClock);
  }

  /** Edge markers pointing at the President and the Chancellor nominee while their heads are off screen. */
  private updateMarkers() {
    const v = this.view;
    const me = this.room?.you;
    const live = !!v && v.phase !== 'night' && v.phase !== 'gameOver';
    this.marker('pres', live && v!.president !== me ? v!.president : null, tr({ en: 'PRESIDENT', es: 'PRESIDENTE' }));
    this.marker('nom', live && v!.phase === 'vote' && v!.nominee !== me ? v!.nominee : null, tr({ en: 'NOMINEE', es: 'NOMINADO' }));
    this.actionMarker();
  }

  /** Edge arrow to your nearest clickable move while none of them is on screen. */
  private actionMarker() {
    const v = this.view;
    const me = this.room?.you;
    const cam = this.world.camera;
    const cands: { ndc: THREE.Vector3; angle: number }[] = [];
    if (v && me !== undefined && !this.interactor.cardMode()) {
      const env = v.phase === 'night' && !v.players[me]?.acked && !this.envelopeOpen ? this.interactor.items.get('envelope') : undefined;
      cam.getWorldDirection(this.guideFwd);
      for (const item of this.interactor.items.values()) {
        if (item !== env && (!item.action || item.id.startsWith('hand-') || item.id.startsWith('peek-'))) continue;
        this.guideBox.makeEmpty();
        for (const o of item.objects) this.guideBox.expandByObject(o);
        if (this.guideBox.isEmpty()) continue;
        this.guideBox.getCenter(this.guideCentre);
        cands.push({
          ndc: (this.guideNdc[cands.length] ??= new THREE.Vector3()).copy(this.guideCentre).project(cam),
          angle: this.guideFwd.angleTo(this.guideDir.copy(this.guideCentre).sub(cam.position)),
        });
      }
    }
    const t = guideTarget(cands);
    const m = t && edgeMarker(t.ndc);
    const label = actionLabel(v?.phase, this.interactor.items.has('veto'));
    this.ui.setMarker('act', m && { ...m, label });
  }

  private marker(id: 'pres' | 'nom', seat: number | null, tag: string) {
    const head = seat === null ? undefined : this.heads[seat];
    const m = head ? edgeMarker(this.proj.copy(head).project(this.world.camera)) : null;
    this.ui.setMarker(id, m && { ...m, label: `${tag} ${this.view?.players[seat!]?.name ?? ''}` });
  }

  update(dt: number) {
    this.now += dt;
    tweens.update(dt);
    this.blood.update(dt);
    this.drainBeats();
    if (this.inFlight && this.now - this.inFlight.at > 5) this.actionRejected();
    const v = this.view;
    const dp = this.deferredPower;
    if (dp && this.now >= dp.at) {
      this.deferredPower = null;
      if (v?.phase === dp.power) {
        this.presentPower(dp.power, dp.president);
        this.reconcilePool();
        this.refreshInteractables();
        this.refreshHud();
      }
    }
    this.world.setNight(v?.phase === 'night');
    this.world.setOwnOutfit(v?.yourRole === 'hitler');
    setMusicMood(v?.phase === 'night', !!v && (v.phase === 'execute' || (!!this.shot && this.now < this.shot.until)));
    this.world.tension = v ? v.fascist / 6 : 0;
    if (v?.phase !== 'execute') this.executeSince = -1;
    else if (this.executeSince < 0) this.executeSince = this.now;
    const shooting = !!this.shot && this.now < this.shot.until;
    this.world.danger = shooting ? 1 : this.executeSince >= 0 ? 0.25 + 0.75 * Math.min(1, (this.now - this.executeSince) / 8) : 0;
    if (v?.phase === 'execute' && this.now - this.lastHeartbeat > 1.1) {
      this.lastHeartbeat = this.now;
      sfx.heartbeat();
    }
    this.computeTargets();
    this.updateCharacters(dt);
    this.updateMarkers();
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
