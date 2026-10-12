// Procedural low-poly patrons. Original designs: coats, faces and hats vary by seat.
// Geometry comes from patron.ts and is merged per mesh to keep the draw-call count low: one vertex-coloured
// "outfit" material covers everything on the body (coat, skin, shirt, tie, belt), so a patron is a handful of meshes.
import * as THREE from 'three';
import { disposeObject } from './dispose';
import { DEATH_DUR, REACTION_DUR, SMOKE_DUR, blinkScale, deathPose, isSmoker, mouthOpen, nextBlinkDelay, nextDragDelay, reactionPose, smokePose, type DeathPose, type Reaction, type ReactionPose, type SmokePose } from './life';
import { glowTexture, textSprite } from './textures';
import { glossy } from './world';
import { handGeometry } from './hands';
import {
  aimArmGeometry,
  armGeometry,
  armJoints,
  CIGARETTE_TIP,
  armbandGeometry,
  cigaretteGeometry,
  eyesGeometry,
  faceDetailGeometry,
  fingerGeometry,
  hatGeometry,
  headSkinGeometry,
  limbGeometry,
  mergeParts,
  mouthGeometry,
  neckGeometry,
  paintGeometry,
  peakedCapGeometry,
  shirtGeometry,
  tieGeometry,
  torsoGeometry,
  uniformGeometry,
} from './patron';

const COATS = [0x6b2f2a, 0x2f4a6b, 0x4a5a2a, 0x5a3a6b, 0x7a5a2a, 0x2a5a55, 0x6b4a3a, 0x3a3a46, 0x803a50, 0x55602f];
const SKINS = [0xe0b090, 0xb07a55, 0x8a5a3a, 0xd9a07a, 0x6b4430, 0xf0c8a8, 0xc08860, 0x9a6a48, 0xe6b898, 0x7a4e36];
const HATS = ['fedora', 'cap', 'bowler', 'none', 'beret', 'tophat', 'none', 'fedora', 'bowler', 'cap'] as const;
const DARK = 0x1a1410;

function mat(color: number, rough = 0.75) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: false });
}

/** Flat resting hand at the end of an arm, in body space. */
function restHandGeometry(side: 1 | -1) {
  const { elbow, wrist } = armJoints(side);
  const dir = wrist.clone().sub(elbow).setY(0).normalize();
  const hand = handGeometry('flat', side);
  hand.rotateY(Math.atan2(dir.x, dir.z));
  const p = wrist.clone().addScaledVector(dir, 0.055).setY(0.815);
  return hand.translate(p.x, p.y, p.z);
}

/** Body-space hand target (the palm) when the cigarette is at the lips, and the elbow's pull while raised (down and outward). */
const MOUTH_HAND = new THREE.Vector3(0.03, 1.3, 0.19);
const ELBOW_HINT = new THREE.Vector3(0.6, -1, -0.2).normalize();
/** Cigarette in the hand: filter end between the fingers, lit end pointing back and outward (hand space). */
const CIG_AXIS = new THREE.Vector3(0.5, 0.3, -0.8).normalize();
const Y_UP = new THREE.Vector3(0, 1, 0);

/** Two-bone left arm of a smoker, solved analytically each frame (body space; shoulder fixed). */
interface SmokeRig {
  upper: THREE.Group;
  fore: THREE.Group;
  ember: THREE.Mesh;
  emberMat: THREE.MeshStandardMaterial;
  shoulder: THREE.Vector3;
  restHand: THREE.Vector3;
  restPole: THREE.Vector3;
  len1: number;
  len2: number;
  /** Seconds into a drag, or null between drags. */
  dragT: number | null;
  /** Seconds until the next drag. */
  dragIn: number;
  pose: SmokePose;
  hand: THREE.Vector3;
  reach: THREE.Vector3;
  u: THREE.Vector3;
  pole: THREE.Vector3;
  elbow: THREE.Vector3;
  basisX: THREE.Vector3;
  basisY: THREE.Vector3;
  basisM: THREE.Matrix4;
  qUpper: THREE.Quaternion;
  qFore: THREE.Quaternion;
}

export class Character {
  group = new THREE.Group();
  body = new THREE.Group();
  head = new THREE.Group();
  private mats: THREE.MeshStandardMaterial[] = [];
  private baseColors: THREE.Color[] = [];
  private tag: THREE.Sprite;
  private tagText = '';
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  private phase = Math.random() * 10;
  private lookTarget: THREE.Vector3 | null = null;
  private headYaw = 0;
  private headPitch = 0;
  /** Seconds since the shot (DEATH_DUR = fully dead); null while alive. */
  private deathT: number | null = null;
  private deathPoseState: DeathPose = { lean: 0, drop: 0, push: 0, roll: 0, headPitch: 0, chairTip: 0, chairYaw: 0 };
  /** This patron's chair (set by the game each frame); tipped on its rear legs during the death animation. */
  chair: THREE.Object3D | null = null;
  private chairBase: { obj: THREE.Object3D; yaw: number; pos: THREE.Vector3 } | null = null;
  dead = false;
  highlight = 0;
  private highlightTarget = 0;
  private glow: THREE.Sprite;
  private glowAmt = 0;
  private glowTarget = 0;
  hitMeshes: THREE.Object3D[] = [];
  private eyes: THREE.Mesh[] = [];
  private mouth!: THREE.Mesh;
  private blinkAt = 0;
  private blinkStart = -1;
  private reaction: { kind: Reaction; t: number } | null = null;
  private pose: ReactionPose = { pitch: 0, yaw: 0, lean: 0, armLift: 0 };
  readonly smoker: boolean;
  private rig: SmokeRig | null = null;
  private fistQuat = new THREE.Quaternion();
  private pivot = new THREE.Vector3();
  private baseEuler = new THREE.Euler();
  private readonly xAxis = new THREE.Vector3(1, 0, 0);

  /**
   * `hitler` is only ever used when the server has revealed this seat's role to the viewer
   * (fascist teammates, or everyone at game over). Everybody else gets the seat's normal patron.
   */
  constructor(public seat: number, styleIndex: number, public variant: 'normal' | 'hitler' = 'normal') {
    const hitler = variant === 'hitler';
    this.smoker = isSmoker(styleIndex, variant);
    const coatHex = hitler ? 0x7a6844 : COATS[styleIndex % COATS.length];
    const skinHex = hitler ? 0xe8c4a4 : SKINS[(styleIndex * 3) % SKINS.length];
    const shirtHex = hitler ? 0x8c7450 : 0xd8d0c0;
    const tieHex = hitler ? 0x14100c : styleIndex % 2 ? 0x8a1a1a : 0x1a2a4a;
    // Vertex-coloured, so coat, skin, shirt and tie share one material (one draw call); tint and emissive act on it as a whole.
    const outfit = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, flatShading: false, vertexColors: true });
    const skin = mat(skinHex, 0.6);
    const dark = mat(DARK, 0.6);
    this.mats.push(outfit, skin, dark);
    const paint = paintGeometry;

    // Body: coat torso with rounded shoulders, the left arm and hand, neck, shirt V and tie in a single mesh.
    const parts = [
      paint(torsoGeometry(), coatHex),
      paint(neckGeometry(), skinHex),
      paint(shirtGeometry(), shirtHex),
      paint(tieGeometry(), tieHex),
    ];
    // The resting left arm (with the Hitler armband) is its own mesh so it can be hidden while the hands are up.
    const bandParts: THREE.BufferGeometry[] = [];
    if (hitler) {
      // Plain red armband on the upper arm (deliberately no insignia).
      const band = armbandGeometry();
      bandParts.push(paint(band.band, 0xa01818), paint(band.disc, 0xe8e0d0));
    }
    if (this.smoker) this.rig = this.buildSmokeRig(outfit, coatHex, skinHex);
    else {
      const leftArm = new THREE.Mesh(mergeParts([paint(armGeometry(1), coatHex), paint(restHandGeometry(1), skinHex), ...bandParts.map((g) => g.clone())]), outfit);
      this.restArmLeft = [leftArm];
      this.body.add(leftArm);
    }
    this.buildHandsUpArm(-1, outfit, coatHex, skinHex, []);
    this.buildHandsUpArm(1, outfit, coatHex, skinHex, bandParts);
    // Right arm (the figure faces +Z, so its right is -X): swapped for the aiming rig when holding the gun.
    const rightArm = new THREE.Mesh(mergeParts([paint(armGeometry(-1), coatHex), paint(restHandGeometry(-1), skinHex)]), outfit);
    this.restArm = [rightArm];
    this.body.add(rightArm);
    const { shoulder, wrist } = armJoints(-1);
    this.buildAimArm(shoulder, wrist, outfit, coatHex, skinHex);
    if (hitler) this.addUniform(parts);
    this.body.add(new THREE.Mesh(mergeParts(parts), outfit));

    // Head: shaped skull with ears and nose, both eyes in one mesh, the mouth on its own (it scales while talking).
    const headSkin = new THREE.Mesh(headSkinGeometry(), skin);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0c0806, emissive: 0x221100, roughness: 0.3, flatShading: false });
    const eyes = new THREE.Mesh(eyesGeometry(), eyeMat);
    eyes.position.set(0, 0.03, 0.135);
    this.eyes.push(eyes);
    const mouth = new THREE.Mesh(mouthGeometry(), dark);
    mouth.position.set(0, -0.07, 0.135);
    this.mouth = mouth;
    const hat = hitler ? 'peaked' : HATS[styleIndex % HATS.length];
    const cap = hitler ? peakedCapGeometry() : null;
    const detail = faceDetailGeometry({
      browTilt: styleIndex % 3 === 0 ? 0.25 : -0.08,
      mustache: hitler ? 'toothbrush' : styleIndex % 4 === 1 ? 'wide' : 'none',
      beard: !hitler && styleIndex % 5 === 2,
      hair: hat === 'none',
      fringe: hitler,
    });
    // The peaked cap's dark band and visor ride along with the dark face details.
    const details = new THREE.Mesh(cap ? mergeParts([detail, cap.trim]) : detail, dark);
    this.head.add(headSkin, eyes, mouth, details);
    if (cap) this.addPeakedCap(cap.cloth, cap.badge);
    else if (hat !== 'peaked') this.addHat(hat, styleIndex);
    this.head.position.y = 1.4;
    this.body.add(this.head);
    this.group.add(this.body);

    // Face details are too small to cast a visible shadow; skipping them keeps them out of the shadow pass.
    const faceDetails = new Set<THREE.Object3D>([eyes, details, mouth]);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = !faceDetails.has(o);
        o.receiveShadow = true;
        this.hitMeshes.push(o);
      }
    });
    // Added after the traverse: too small to cast shadows or be picked.
    if (this.rig) this.rig.fore.add(this.rig.ember);
    for (const m of this.mats) this.baseColors.push(m.color.clone());

    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.tag.position.y = 1.86;
    this.tag.renderOrder = 10;
    this.group.add(this.tag);

    // Fake night team glow: sprite aura plus emissive tint, no real light (lights force shader recompiles).
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,40,20'), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.glow.position.set(0, 1.3, -0.05);
    this.glow.scale.setScalar(1.4);
    this.glow.renderOrder = 1;
    this.glow.visible = false;
    this.group.add(this.glow);
  }

  /** Left arm as upper arm + forearm-with-hand pivots (so it can lift the cigarette), matching the resting arm at reach 0. */
  private buildSmokeRig(outfit: THREE.Material, coatHex: number, skinHex: number): SmokeRig {
    const { shoulder, elbow, wrist } = armJoints(1);
    // Where restHandGeometry puts the palm.
    const restHand = wrist.clone().addScaledVector(wrist.clone().sub(elbow).setY(0).normalize(), 0.055).setY(0.815);
    const len1 = shoulder.distanceTo(elbow);
    const len2 = restHand.distanceTo(elbow);
    const restDir = restHand.clone().sub(shoulder).normalize();
    const elbowRel = elbow.clone().sub(shoulder);
    const restPole = elbowRel.addScaledVector(restDir, -elbowRel.dot(restDir)).normalize();

    const upper = new THREE.Group();
    upper.position.copy(shoulder);
    upper.add(new THREE.Mesh(paintGeometry(limbGeometry(new THREE.Vector3(), new THREE.Vector3(0, 0, len1), 0.058, 0.054), coatHex), outfit));
    const fore = new THREE.Group();
    fore.position.set(0, 0, len1);
    const sleeve = paintGeometry(limbGeometry(new THREE.Vector3(), new THREE.Vector3(0, 0, wrist.distanceTo(elbow)), 0.052, 0.045), coatHex);
    // The cigarette is baked into the forearm mesh: filter end between the fingers, lit end pointing back and outward.
    const cigPos = new THREE.Vector3(0, 0.012, len2 + 0.04);
    const cig = cigaretteGeometry().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), CIG_AXIS)).translate(cigPos.x, cigPos.y, cigPos.z);
    fore.add(new THREE.Mesh(mergeParts([sleeve, paintGeometry(handGeometry('flat', 1).translate(0, 0, len2), skinHex), cig]), outfit));
    upper.add(fore);
    this.body.add(upper);

    // Not in this.mats: the tint loop would overwrite its emissive.
    const emberMat = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff5a1a, emissiveIntensity: 0.6 });
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 8, 6), emberMat);
    ember.position.copy(cigPos).addScaledVector(CIG_AXIS, CIGARETTE_TIP);
    return {
      upper,
      fore,
      ember,
      emberMat,
      shoulder,
      restHand,
      restPole,
      len1,
      len2,
      dragT: null,
      dragIn: 1 + Math.random() * 9,
      pose: { reach: 0, ember: 0.35, exhale: 0 },
      hand: new THREE.Vector3(),
      reach: new THREE.Vector3(),
      u: new THREE.Vector3(),
      pole: new THREE.Vector3(),
      elbow: new THREE.Vector3(),
      basisX: new THREE.Vector3(),
      basisY: new THREE.Vector3(),
      basisM: new THREE.Matrix4(),
      qUpper: new THREE.Quaternion(),
      qFore: new THREE.Quaternion(),
    };
  }

  /** Belt and cross strap join the body's vertex-coloured geometry; the brass buckle and buttons are their own glossy mesh. */
  private addUniform(parts: THREE.BufferGeometry[]) {
    const u = uniformGeometry();
    parts.push(paintGeometry(u.dark, DARK));
    const brass = glossy(mat(0xc8a050, 0.35), 0.5);
    brass.metalness = 0.8;
    this.body.add(new THREE.Mesh(u.brass, brass));
  }

  /** Military peaked cap: tall crown and a brass badge (the dark band and glossy visor are merged into the face details). */
  private addPeakedCap(cloth: THREE.BufferGeometry, badge: THREE.BufferGeometry) {
    const capMat = mat(0x6e5c3c, 0.7);
    this.mats.push(capMat);
    this.head.add(new THREE.Mesh(cloth, capMat), new THREE.Mesh(badge, mat(0xc8a050, 0.35)));
  }

  private addHat(kind: (typeof HATS)[number], i: number) {
    if (kind === 'none') return; // bare-headed patrons get a hair cap in the face details
    const hatMat = mat([0x1d1a18, 0x3a2a1a, 0x22252a, 0x4a1a1a][i % 4], 0.8);
    this.mats.push(hatMat);
    this.head.add(new THREE.Mesh(hatGeometry(kind), hatMat));
  }

  setLabel(text: string, color = '#f0e6d2') {
    const key = text + color;
    if (key === this.tagText) return;
    this.tagText = key;
    const old = this.tag.material.map;
    const { texture, aspect } = textSprite(text, { color, bg: 'rgba(10,6,4,0.72)', size: 34, border: 'rgba(214,168,74,0.5)' });
    this.tag.material.map = texture;
    this.tag.material.needsUpdate = true;
    this.tag.scale.set(0.16 * aspect, 0.16, 1);
    old?.dispose();
  }

  say(text: string, now: number) {
    if (this.bubble) {
      this.group.remove(this.bubble);
      this.bubble.material.map?.dispose();
      this.bubble.material.dispose();
    }
    const { texture, aspect } = textSprite(text, { color: '#1a120c', bg: 'rgba(245,236,214,0.95)', size: 30, maxWidth: 440 });
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    const h = 0.12 * (texture.image.height / 50);
    this.bubble.scale.set(h * aspect, h, 1);
    this.bubble.position.y = 2.0 + h / 2;
    this.bubble.renderOrder = 11;
    this.group.add(this.bubble);
    this.bubbleUntil = now + 5 + text.length * 0.04;
  }

  lookAt(target: THREE.Vector3 | null) {
    this.lookTarget = target;
  }

  setHighlight(on: boolean) {
    this.highlightTarget = on ? 1 : 0;
  }

  private restArm: THREE.Mesh[] = [];
  private restArmLeft: THREE.Mesh[] = [];
  private handsUpArms: { shoulder: THREE.Group; elbow: THREE.Group; restS: THREE.Quaternion; restE: THREE.Quaternion; upS: THREE.Quaternion; upE: THREE.Quaternion }[] = [];
  private handsUpTarget = 0;
  private handsUpAmount = 0;
  private handsUpQ = new THREE.Quaternion();
  private aimArm = new THREE.Group();
  /** Where the revolver's grip sits while aiming (world position read by the game each frame). */
  handAnchor = new THREE.Object3D();
  private aimTarget: THREE.Vector3 | null = null;
  private aimAmount = 0;
  private recoilKick = 0;
  private restQuat = new THREE.Quaternion();

  /** A straight arm pivoting at the shoulder; its +Z axis points along the arm toward the hand. */
  private buildAimArm(shoulder: THREE.Vector3, wrist: THREE.Vector3, outfit: THREE.Material, coatHex: number, skinHex: number) {
    this.aimArm.position.copy(shoulder);
    // Sleeve and fist in one vertex-coloured mesh.
    const arm = new THREE.Mesh(mergeParts([paintGeometry(aimArmGeometry(), coatHex), paintGeometry(handGeometry('fist', -1).translate(0, 0, 0.58), skinHex)]), outfit);
    this.handAnchor.position.set(0, 0.0, 0.6);
    // Index finger, shown only when pointing (not when holding the gun).
    this.finger = new THREE.Mesh(paintGeometry(fingerGeometry(), skinHex), outfit);
    this.finger.position.set(0, 0.02, 0.66);
    this.aimArm.add(arm, this.finger, this.handAnchor);
    this.aimArm.visible = false;
    // Resting orientation: pointing from the shoulder down toward the hand on the table.
    const m = new THREE.Matrix4().lookAt(wrist, shoulder, new THREE.Vector3(0, 1, 0));
    this.restQuat.setFromRotationMatrix(m);
    this.aimArm.quaternion.copy(this.restQuat);
    this.body.add(this.aimArm);
  }

  /**
   * The surrender rig for one arm: a shoulder group (upper arm, plus the armband if any) and a child elbow group
   * (forearm and flat hand), whose +Z runs along the bone, with their rest (arm on the table) and raised
   * (upper arm out and up, forearm straight up) orientations. `extras` are body-space parts riding on the upper arm.
   */
  private buildHandsUpArm(side: 1 | -1, outfit: THREE.Material, coatHex: number, skinHex: number, extras: THREE.BufferGeometry[]) {
    const { shoulder, elbow, wrist } = armJoints(side);
    const z = new THREE.Vector3(0, 0, 1);
    const q = (dir: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(z, dir.clone().normalize());
    const upperLen = elbow.distanceTo(shoulder);
    const foreLen = 0.28;
    const restS = q(elbow.clone().sub(shoulder));
    // Armband parts move from body space into the shoulder group's rest frame.
    const toLocal = new THREE.Matrix4().compose(shoulder, restS, new THREE.Vector3(1, 1, 1)).invert();
    const upperParts = [paintGeometry(limbGeometry(new THREE.Vector3(), new THREE.Vector3(0, 0, upperLen), 0.058, 0.054), coatHex), ...extras.map((g) => g.clone().applyMatrix4(toLocal))];
    const sg = new THREE.Group();
    sg.position.copy(shoulder);
    sg.add(new THREE.Mesh(mergeParts(upperParts), outfit));
    const eg = new THREE.Group();
    eg.position.z = upperLen;
    const foreParts = [
      paintGeometry(limbGeometry(new THREE.Vector3(), new THREE.Vector3(0, 0, foreLen), 0.052, 0.045), coatHex),
      paintGeometry(handGeometry('flat', side).translate(0, 0, foreLen + 0.05), skinHex),
    ];
    eg.add(new THREE.Mesh(mergeParts(foreParts), outfit));
    sg.add(eg);
    sg.visible = false;
    this.body.add(sg);
    const upS = q(new THREE.Vector3(side * 0.85, 0.25, 0.35));
    // The elbow group is relative to the shoulder group: inverse(shoulder) * world.
    const restE = restS.clone().invert().multiply(q(wrist.clone().sub(elbow)));
    const upE = upS.clone().invert().multiply(q(new THREE.Vector3(0, 1, 0.15)));
    this.handsUpArms.push({ shoulder: sg, elbow: eg, restS, restE, upS, upE });
  }

  /** The aimed-at patron raises both hands (false lowers them). */
  setHandsUp(on: boolean) {
    this.handsUpTarget = on ? 1 : 0;
  }

  /** Runs after updateAim and updateSmoke: while raised, the surrender rig replaces the rest arms, the smoking arm and the aim arm. */
  private updateHandsUp(dt: number, now: number) {
    this.handsUpAmount += ((this.handsUpTarget && !this.dead ? 1 : 0) - this.handsUpAmount) * (1 - Math.exp(-7 * dt));
    const a = this.handsUpAmount;
    const up = a > 0.02;
    for (const m of this.restArmLeft) m.visible = !up;
    if (this.rig) {
      this.rig.upper.visible = !up;
      if (up) {
        this.rig.dragT = null;
        this.rig.dragIn = Math.max(this.rig.dragIn, 3);
      }
    }
    for (const arm of this.handsUpArms) arm.shoulder.visible = up;
    if (!up) return;
    for (const m of this.restArm) m.visible = false;
    this.aimArm.visible = false;
    const e = a * a * (3 - 2 * a);
    for (const arm of this.handsUpArms) {
      arm.shoulder.quaternion.slerpQuaternions(arm.restS, arm.upS, e);
      arm.elbow.quaternion.slerpQuaternions(arm.restE, arm.upE, e).multiply(this.handsUpQ.setFromAxisAngle(this.xAxis, Math.sin(now * 23 + this.phase) * 0.03 * a));
    }
  }

  /** Raise the gun arm toward a world point (null lowers it back to the table). */
  private finger!: THREE.Mesh;
  private aimMode: 'gun' | 'point' = 'gun';

  setAim(target: THREE.Vector3 | null, mode: 'gun' | 'point' = 'gun') {
    if (target) this.aimMode = mode;
    if (target && !this.aimTarget) this.smoothAim.copy(target); // start where they first look
    this.aimTarget = target ? target.clone() : null;
  }

  /** The point the arm actually tracks: eases toward aimTarget so the arm swings instead of snapping. */
  private smoothAim = new THREE.Vector3();

  /** World pose for a revolver held in the aiming hand (the revolver model points along -Z). */
  gunPose(): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const pos = this.handAnchor.getWorldPosition(new THREE.Vector3());
    const quat = this.handAnchor.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    return { pos, quat };
  }

  /** Start the animated death (a room snapshot that merely shows them dead skips straight to the final pose). */
  die() {
    this.dead = true;
    this.deathT = 0;
  }

  recoil() {
    this.recoilKick = 1;
  }

  /** One-shot gesture starting `delay` seconds from now; replaces any running one. */
  react(kind: Reaction, delay = 0) {
    if (this.dead) return;
    this.reaction = { kind, t: -delay };
  }

  private updateAim(dt: number) {
    const k = 1 - Math.exp(-5 * dt);
    this.aimAmount += ((this.aimTarget && !this.dead ? 1 : 0) - this.aimAmount) * k;
    this.recoilKick = Math.max(0, this.recoilKick - dt * 4);
    // Fist slam reuses the aim arm when not aiming: rest pose rotated about local X (-angle raises the hand).
    const fist = !this.aimTarget && this.aimAmount <= 0.02 && !this.dead && this.reaction?.kind === 'fist' && this.reaction.t > 0;
    const aiming = this.aimAmount > 0.02;
    this.aimArm.visible = aiming || fist;
    this.finger.visible = this.aimMode === 'point' && !fist;
    for (const m of this.restArm) m.visible = !(aiming || fist);
    if (fist) {
      this.aimArm.quaternion.copy(this.restQuat).multiply(this.fistQuat.setFromAxisAngle(this.xAxis, -this.pose.armLift));
      return;
    }
    if (!aiming) return;
    let aimQuat = this.restQuat;
    if (this.aimTarget) {
      this.smoothAim.lerp(this.aimTarget, 1 - Math.exp(-4 * dt));
      // Orientation (in the body's space) that points the arm's +Z at the target.
      const shoulderWorld = this.aimArm.parent!.localToWorld(this.aimArm.position.clone());
      const m = new THREE.Matrix4().lookAt(this.smoothAim, shoulderWorld, new THREE.Vector3(0, 1, 0));
      const world = new THREE.Quaternion().setFromRotationMatrix(m);
      const parentWorld = this.aimArm.parent!.getWorldQuaternion(new THREE.Quaternion());
      aimQuat = parentWorld.invert().multiply(world);
      if (this.recoilKick > 0) aimQuat = aimQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.45 * this.recoilKick));
    }
    this.aimArm.quaternion.slerpQuaternions(this.restQuat, aimQuat, this.aimAmount);
  }

  /** Test hook / trigger: begin a drag now (ignored for non-smokers, the dead, or mid-drag). */
  startDrag() {
    if (this.rig && !this.dead && this.rig.dragT === null) this.rig.dragT = 0;
  }

  /** Orient `q` so its +Z points along `dir`, keeping local +Y roughly up. */
  private aimBasis(r: SmokeRig, q: THREE.Quaternion, dir: THREE.Vector3) {
    r.basisX.crossVectors(Y_UP, dir);
    if (r.basisX.lengthSq() < 1e-8) r.basisX.set(1, 0, 0);
    r.basisX.normalize();
    r.basisY.crossVectors(dir, r.basisX);
    q.setFromRotationMatrix(r.basisM.makeBasis(r.basisX, r.basisY, dir));
  }

  private updateSmoke(r: SmokeRig, dt: number, now: number) {
    if (this.dead) r.dragT = null;
    else if (r.dragT === null) {
      r.dragIn -= dt;
      if (r.dragIn <= 0) {
        const talking = this.bubble !== null && this.bubbleUntil - now > 1;
        if (!this.aimTarget && this.aimAmount < 0.05 && !this.reaction && !talking) r.dragT = 0;
        else r.dragIn = 2;
      }
    } else {
      r.dragT += dt;
      if (r.dragT >= SMOKE_DUR) {
        r.dragT = null;
        r.dragIn = nextDragDelay(Math.random());
      }
    }
    smokePose(r.dragT ?? 0, r.pose);
    if (this.dead) r.pose.reach = r.pose.exhale = 0;
    r.emberMat.emissiveIntensity = this.dead ? 0 : 0.6 + 3.4 * r.pose.ember + 0.15 * Math.sin(now * 31 + this.phase) * r.pose.ember;

    // Two-bone IK in body space: the shoulder is fixed, the elbow sits on the circle that keeps both bone lengths.
    const reach = r.pose.reach;
    r.hand.lerpVectors(r.restHand, MOUTH_HAND, reach).sub(r.shoulder);
    const d = Math.min(Math.max(r.hand.length(), 0.05), r.len1 + r.len2 - 1e-3);
    r.u.copy(r.hand).normalize();
    r.hand.copy(r.u).multiplyScalar(d);
    r.pole.lerpVectors(r.restPole, ELBOW_HINT, reach);
    r.pole.addScaledVector(r.u, -r.pole.dot(r.u)).normalize();
    const a = (r.len1 * r.len1 - r.len2 * r.len2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, r.len1 * r.len1 - a * a));
    r.elbow.copy(r.u).multiplyScalar(a).addScaledVector(r.pole, h);
    this.aimBasis(r, r.qUpper, r.elbow.normalize());
    r.upper.quaternion.copy(r.qUpper);
    r.reach.copy(r.hand).addScaledVector(r.elbow, -r.len1).normalize();
    this.aimBasis(r, r.qFore, r.reach);
    r.fore.quaternion.copy(r.qUpper).invert().multiply(r.qFore);
  }

  /**
   * Writes the ember's, the mouth's and the head's facing (slightly down) in world space; returns the exhale amount 0..1.
   * -1 for non-smokers, the dead and while the hands are up (nothing to emit).
   */
  smokeEmit(tip: THREE.Vector3, mouth: THREE.Vector3, dir: THREE.Vector3): number {
    const r = this.rig;
    if (!r || this.dead || this.handsUpAmount > 0.02) return -1;
    r.ember.getWorldPosition(tip);
    this.head.getWorldQuaternion(r.qFore);
    mouth.set(0, -0.07, 0.16);
    this.head.localToWorld(mouth);
    dir.set(0, -0.15, 1).applyQuaternion(r.qFore).normalize();
    return r.pose.exhale;
  }

  setTeamGlow(on: boolean) {
    this.glowTarget = on ? 1 : 0;
  }

  private updateChair(dp: DeathPose) {
    const c = this.chair;
    if (!c) return;
    if (this.chairBase?.obj !== c) this.chairBase = { obj: c, yaw: c.rotation.y, pos: c.position.clone() };
    const b = this.chairBase;
    c.rotation.order = 'YXZ';
    // Positive rotation.x carries the chair-local +y (top) toward +z (the back side), i.e. tips it backward.
    c.rotation.set(dp.chairTip, b.yaw + dp.chairYaw, 0);
    // Keep the rear-leg line (local z = 0.2, y = 0) fixed in place so the rear feet stay on the floor.
    this.pivot.set(0, 0, 0.2).applyEuler(this.baseEuler.set(0, b.yaw, 0));
    c.position.copy(b.pos).add(this.pivot);
    this.pivot.set(0, 0, 0.2).applyEuler(c.rotation);
    c.position.sub(this.pivot);
  }

  update(dt: number, now: number) {
    const t = now + this.phase;
    if (this.reaction) {
      this.reaction.t += dt;
      if (this.reaction.t >= REACTION_DUR[this.reaction.kind]) this.reaction = null;
    }
    if (this.reaction) reactionPose(this.reaction.kind, Math.max(0, this.reaction.t), this.pose);
    else this.pose.pitch = this.pose.yaw = this.pose.lean = this.pose.armLift = 0;
    this.updateAim(dt);
    if (this.rig) this.updateSmoke(this.rig, dt, now);
    this.updateHandsUp(dt, now);
    // Idle: breathing and a slow sway.
    const k = 1 - Math.exp(-4 * dt);
    if (!this.dead) this.deathT = null;
    else if (this.deathT === null) this.deathT = DEATH_DUR;
    else this.deathT = Math.min(DEATH_DUR, this.deathT + dt);
    const dk = this.deathT === null ? 0 : this.deathT / DEATH_DUR;
    const dp = deathPose(this.deathT ?? 0, this.deathPoseState);
    this.body.position.y = Math.sin(t * 1.6) * 0.006 * (1 - dk) - dp.drop;
    this.body.rotation.z = Math.sin(t * 0.5) * 0.02 * (1 - dk) + dp.roll;
    this.body.rotation.x = dp.lean;
    this.body.position.z = dp.push;
    this.updateChair(dp);

    // Head tracking in local space.
    let yaw = Math.sin(t * 0.3) * 0.15;
    let pitch = -0.08;
    if (this.lookTarget && !this.dead) {
      const local = this.group.worldToLocal(this.lookTarget.clone());
      local.y -= 1.4;
      yaw = Math.max(-1.2, Math.min(1.2, Math.atan2(local.x, local.z)));
      pitch = Math.max(-0.5, Math.min(0.4, -Math.atan2(local.y, Math.hypot(local.x, local.z))));
    }
    if (this.dead) {
      this.headYaw = 0.3;
      this.headPitch = dp.headPitch;
    } else {
      this.headYaw += (yaw - this.headYaw) * k;
      this.headPitch += (pitch - this.headPitch) * k;
    }
    this.head.rotation.set(this.headPitch + this.pose.pitch, this.headYaw + this.pose.yaw, 0, 'YXZ');
    this.body.rotation.x += this.pose.lean;
    this.body.position.z += this.pose.lean * 0.25;

    // Blink (eyes stay shut when dead).
    if (!this.blinkAt) this.blinkAt = now + nextBlinkDelay(Math.random());
    if (!this.dead && now >= this.blinkAt) {
      this.blinkStart = now;
      this.blinkAt = now + nextBlinkDelay(Math.random());
    }
    const eyeY = this.dead ? 0.1 : blinkScale(now - this.blinkStart);
    for (const eye of this.eyes) eye.scale.y = eyeY;

    // Mouth flaps while the bubble is up (not while it fades out).
    const talking = this.bubble !== null && this.bubbleUntil - now > 1 && !this.dead;
    const mouthY = talking ? 1 + 3.5 * mouthOpen(t) : 1;
    this.mouth.scale.y += (mouthY - this.mouth.scale.y) * (talking ? 0.6 : k);

    // Highlight / death tint.
    this.highlight += (this.highlightTarget - this.highlight) * (1 - Math.exp(-12 * dt));
    this.glowAmt += (this.glowTarget - this.glowAmt) * k;
    const h = this.highlight;
    const g = this.glowAmt;
    this.mats.forEach((m, i) => {
      m.color.copy(this.baseColors[i]).multiplyScalar(1 - dk * 0.55);
      m.emissive.setRGB(h * 0.35 + g * 0.45, h * 0.25 + g * 0.05, h * 0.08 + g * 0.03);
    });
    const glowMat = this.glow.material as THREE.SpriteMaterial;
    glowMat.opacity = g * 0.75;
    this.glow.visible = glowMat.opacity > 0.01;
    (this.tag.material as THREE.SpriteMaterial).opacity = this.dead ? 0.5 : 1;

    if (this.bubble) {
      const left = this.bubbleUntil - now;
      this.bubble.material.opacity = Math.max(0, Math.min(1, left));
      if (left <= 0) {
        this.group.remove(this.bubble);
        this.bubble.material.map?.dispose();
        this.bubble.material.dispose();
        this.bubble = null;
      }
    }
  }

  dispose() {
    disposeObject(this.group);
  }
}
