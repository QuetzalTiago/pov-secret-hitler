// Rigged patrons: CC0 glTF characters (one skinned, vertex-coloured mesh each) seated in the chair, tinted per seat.
// The Sitting clip is sampled once per template and baked into plain bone transforms, so there is no per-frame mixer.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getAssets, type CharacterTemplate, type Outfit } from './assets';
import { PatronBadges } from './badges';
import { COATS, SKINS, type Patron } from './characters';
import { disposeObject } from './dispose';
import { DEATH_DUR, REACTION_DUR, SMOKE_DUR, deathPose, isSmoker, mouthOpen, nextDragDelay, reactionPose, smokePose, type DeathPose, type Reaction, type ReactionPose, type SmokePose } from './life';
import { CIGARETTE_TIP, cigaretteGeometry, mergeParts, paintGeometry } from './patron';

const HEIGHT = 1.75;
const HEIGHT_WOMAN = 1.68;
/**
 * The seat of client/models/props/chair_wood.glb as chairModel() builds it (see chairSeat() in roomprops.ts; a test keeps
 * these in step). Chair space: the backrest is on +Z, so the patron, which faces +Z, sits at z from -back to -front.
 */
export const SEAT = { top: 0.4476, front: -0.2703, back: 0.2013 };
/** How far in front of the backrest the buttocks sit. */
const BACK_GAP = 0.015;
/** Where the Hips bone sat before the figure was placed on the measured seat. */
const BADGE_HIPS_Y = 0.56;
/** The buttocks sink this far into the seat. */
const BUTTOCK_SINK = 0.01;
/** The bones carrying the pelvis and thighs, and how far from the backmost of their vertices the buttocks reach. */
const BUTTOCK_BONES = ['Body', 'Hips', 'UpperLegL', 'UpperLegR'];
export const BUTTOCK_DEPTH = 0.15;
/** Where the soles should end up above the floor. */
const FOOT_CLEARANCE = 0.02;
/** The most the thighs are tipped forward-down at the hip to bring the soles to the floor, radians. */
const MAX_THIGH_TIP = 0.4;
/** The accessory geometry in patron.ts assumes a head of this diameter, centred on its origin, eyes at y 0.03, face at z 0.15. */
const HEAD_DIAMETER = 0.3;
const Y_UP = new THREE.Vector3(0, 1, 0);
const HEAD_Y = 1.4;
/** Group-space directions of the surrender pose: the left upper arm (mirrored for the right) and the forearms. */
const UP_UPPER = new THREE.Vector3(0.85, 0.25, 0.35).normalize();
const UP_FORE = new THREE.Vector3(0, 1, 0.15).normalize();
/** The raised elbow's pull, down and outward (group space, left arm). */
const ELBOW_HINT = new THREE.Vector3(0.6, -1, -0.2).normalize();
/** Cigarette in the left hand (MiddleHandL space): the filter end between the fingers, the lit end along CIG_AXIS. */
const CIG_AXIS = new THREE.Vector3(-0.77, -0.2, 0.6).normalize();
const CIG_FILTER = CIG_AXIS.clone().multiplyScalar(-0.03).add(new THREE.Vector3(0, 0.02, 0));
/** Finger curl about the hand's local X (negative closes the fingers into the palm), radians at full aim. */
const CURL = { gun: -1.3, point: -0.4 };

/** One arm's bones, plus the bone-local axes the IK points at world directions and the world bone lengths. */
interface Arm {
  upper: THREE.Bone;
  lower: THREE.Bone;
  palm: THREE.Bone;
  mid: THREE.Bone;
  /** In the upper arm's space, toward the elbow. */
  upAxis: THREE.Vector3;
  /** In the forearm's space, toward the end effector (the cigarette filter on the left, the hand centre on the right). */
  loAxis: THREE.Vector3;
  /** The end effector in the mid-hand's space. */
  eff: THREE.Vector3;
  len1: number;
  len2: number;
}

function outfitFor(styleIndex: number, variant: 'normal' | 'hitler'): Outfit {
  if (variant === 'hitler') return 'suit';
  if (styleIndex === 2 || styleIndex === 7) return 'dress';
  if (styleIndex === 5 || styleIndex === 8) return 'shirt';
  return 'suit';
}

/** The patron's cloth part: the jacket on the suit (named Shirt in the glTF), the shirt, the dress. */
const CLOTH: Record<Outfit, string> = { suit: 'Shirt', shirt: 'Shirt', dress: 'Dress' };

interface SeatedPose {
  pos: THREE.Vector3[];
  quat: THREE.Quaternion[];
  /** Seconds into the Sitting clip. */
  time: number;
}

const seatedPoses = new WeakMap<CharacterTemplate, SeatedPose>();

function skinnedMeshOf(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  if (!found) throw new Error('rigged: no skinned mesh');
  return found;
}

/** The Sitting clip's settled seat: the sample where the hips are lowest, as bone transforms in skeleton order. */
function seatedPose(t: CharacterTemplate): SeatedPose {
  const cached = seatedPoses.get(t);
  if (cached) return cached;
  const clip = t.clips.Sitting;
  if (!clip) throw new Error('rigged: no Sitting clip');
  const root = cloneSkinned(t.root);
  const bones = skinnedMeshOf(root).skeleton.bones;
  const hips = bones.find((b) => b.name === 'Hips')!;
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  // The clip stands up at the very start and end; sample the settled middle.
  const at = (k: number) => clip.duration * (0.2 + (0.65 * k) / 40);
  let best = at(0);
  let lowest = Infinity;
  for (let k = 0; k <= 40; k++) {
    mixer.setTime(at(k));
    root.updateMatrixWorld(true);
    const y = hips.getWorldPosition(new THREE.Vector3()).y;
    if (y < lowest) {
      lowest = y;
      best = at(k);
    }
  }
  mixer.setTime(best);
  const pose = { pos: bones.map((b) => b.position.clone()), quat: bones.map((b) => b.quaternion.clone()), time: best };
  seatedPoses.set(t, pose);
  return pose;
}

/** Calls `fn` with each vertex whose strongest skin weight is `bone`, in world space at the current (rest) pose. */
function eachDominated(mesh: THREE.SkinnedMesh, bone: THREE.Bone, fn: (p: THREE.Vector3) => void, range?: { start: number; count: number }) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const bi = mesh.skeleton.bones.indexOf(bone);
  const toWorld = new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[bi]).multiply(mesh.bindMatrix);
  const v = new THREE.Vector3();
  for (let i = range?.start ?? 0; i < (range ? range.start + range.count : pos.count); i++) {
    let w = 0;
    let top = -1;
    for (let k = 0; k < 4; k++) {
      if (sw.getComponent(i, k) > w) {
        w = sw.getComponent(i, k);
        top = si.getComponent(i, k);
      }
    }
    if (top === bi) fn(v.fromBufferAttribute(pos, i).applyMatrix4(toWorld));
  }
}

function boxOf(mesh: THREE.SkinnedMesh, bone: THREE.Bone, range?: { start: number; count: number }): THREE.Box3 {
  const box = new THREE.Box3();
  eachDominated(mesh, bone, (p) => box.expandByPoint(p), range);
  return box;
}

/**
 * The buttocks at the current pose (world space): the pelvis and the rear of the thighs, up to BUTTOCK_DEPTH from the
 * backmost point. The thighs' fronts are left out, they slope down toward the knees.
 */
function buttocksOf(mesh: THREE.SkinnedMesh, bones: THREE.Bone[]): { minY: number; minZ: number; centreX: number } {
  const set = BUTTOCK_BONES.map((n) => bones.find((b) => b.name === n)!);
  let minZ = Infinity;
  for (const b of set) eachDominated(mesh, b, (p) => (minZ = Math.min(minZ, p.z)));
  let minY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const b of set) {
    eachDominated(mesh, b, (p) => {
      if (p.z > minZ + BUTTOCK_DEPTH) return;
      minY = Math.min(minY, p.y);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    });
  }
  return { minY, minZ, centreX: (minX + maxX) / 2 };
}

export class RiggedCharacter implements Patron {
  readonly group = new THREE.Group();
  readonly smoker: boolean;
  dead = false;
  hitMeshes: THREE.Object3D[];
  chair: THREE.Object3D | null = null;
  highlight = 0;

  private mesh: THREE.SkinnedMesh;
  private bones: THREE.Bone[];
  private basePos!: THREE.Vector3[];
  private baseQuat!: THREE.Quaternion[];
  private torso: THREE.Bone;
  private abdomen: THREE.Bone;
  private neck: THREE.Bone;
  private head: THREE.Bone;
  private fingersR: THREE.Bone;
  private armL!: Arm;
  private armR!: Arm;
  /** Metres per bone-local unit (the armature is scaled). */
  private ws = 1;
  /** Face centre in Head-bone space, and the head's size relative to the accessory geometry's. */
  private faceCenter = new THREE.Vector3();
  private faceScale = 1;
  private cig: THREE.Mesh | null = null;
  /** The cigarette's lit end in MiddleHandL space. */
  private ember = new THREE.Vector3();
  private smoke = { dragT: null as number | null, dragIn: 1 + Math.random() * 9, pose: { reach: 0, ember: 0.35, exhale: 0 } as SmokePose };
  private mats: THREE.MeshStandardMaterial[] = [];
  private badges: PatronBadges;
  private phase = Math.random() * 10;
  private highlightTarget = 0;
  /** Seconds since the shot (DEATH_DUR = fully dead); null while alive. */
  private deathT: number | null = null;
  // Motion inputs; the animation pass reads these.
  private lookTarget: THREE.Vector3 | null = null;
  private aimTarget: THREE.Vector3 | null = null;
  private aimMode: 'gun' | 'point' = 'gun';
  private handsUp = false;
  private recoilKick = 0;
  private reaction: { kind: Reaction; t: number } | null = null;
  private pose: ReactionPose = { pitch: 0, yaw: 0, lean: 0, armLift: 0 };
  private deathPoseState: DeathPose = { lean: 0, drop: 0, push: 0, roll: 0, headPitch: 0, chairTip: 0, chairYaw: 0 };
  private headYaw = 0;
  private headPitch = 0;
  private talk = 0;
  private aimAmount = 0;
  /** The point the arm tracks: eases toward aimTarget so the arm swings instead of snapping. */
  private smoothAim = new THREE.Vector3();
  private handsUpAmount = 0;
  private chairBase: { obj: THREE.Object3D; yaw: number; pos: THREE.Vector3 } | null = null;
  private tmpQ = new THREE.Quaternion();
  private readonly xAxis = new THREE.Vector3(1, 0, 0);
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  // Scratch, so a frame allocates nothing.
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private qc = new THREE.Quaternion();
  private qu = new THREE.Quaternion();
  private ql = new THREE.Quaternion();
  private qg = new THREE.Quaternion();
  private v0 = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private v5 = new THREE.Vector3();
  private pv = new THREE.Vector3();
  private pw = new THREE.Vector3();
  private euler = new THREE.Euler();

  /**
   * `hitler` is only ever used when the server has revealed this seat's role to the viewer.
   * `template` is for tests; the game takes the loaded assets.
   */
  constructor(public seat: number, styleIndex: number, public variant: 'normal' | 'hitler' = 'normal', template?: CharacterTemplate) {
    const hitler = variant === 'hitler';
    const outfit = outfitFor(styleIndex, variant);
    const tpl = template ?? getAssets()?.characters[outfit];
    if (!tpl) throw new Error('rigged: assets not loaded');
    this.smoker = isSmoker(styleIndex, variant);

    const root = cloneSkinned(tpl.root);
    const height = outfit === 'dress' ? HEIGHT_WOMAN : HEIGHT;
    root.scale.multiplyScalar(height);
    root.position.multiplyScalar(height);
    this.group.add(root);

    // Own geometry (the colours are rewritten per patron) and own material (tint and highlight).
    const mesh = skinnedMeshOf(root);
    mesh.geometry = mesh.geometry.clone();
    const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    mesh.material = body;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.mesh = mesh;
    this.mats.push(body);
    this.hitMeshes = [mesh];
    this.bones = mesh.skeleton.bones;
    const bone = (name: string) => this.bones.find((b) => b.name === name)!;
    this.torso = bone('Torso');
    this.abdomen = bone('Abdomen');
    this.neck = bone('Neck');
    this.head = bone('Head');
    this.fingersR = bone('FingersR');

    this.tint(tpl, styleIndex, outfit, hitler);
    this.group.updateMatrixWorld(true);
    this.addFaceAnchorAndArmband(tpl, hitler);

    this.seatOn(root, tpl);
    this.ws = this.torso.getWorldScale(this.v0).x;
    this.armL = this.makeArm('L', CIG_FILTER);
    this.armR = this.makeArm('R', this.v1.set(0, 0, 0));
    if (this.smoker) this.addCigarette();

    // The badge heights were chosen for hips at BADGE_HIPS_Y; the seat is lower, so the whole figure sits lower.
    const sunk = bone('Hips').getWorldPosition(this.v0).y - BADGE_HIPS_Y;
    this.badges = new PatronBadges(this.group, { tag: 1.86 + sunk, bubble: 2.0 + sunk, glow: new THREE.Vector3(0, 1.3 + sunk, -0.05), glowScale: 1.4 });
  }

  /**
   * Bakes the sitting pose, slides the figure so the buttocks rest on the seat just in front of the backrest, and tips
   * the thighs (shins hanging vertical) just far enough for the soles to reach the floor. The bones are driven from this
   * pose every frame, so none of it costs anything at runtime. The group is at the origin here, so group space is world space.
   */
  private seatOn(root: THREE.Object3D, tpl: CharacterTemplate) {
    const seated = seatedPose(tpl);
    // The cached pose is shared by every patron of this template.
    this.basePos = seated.pos.map((p) => p.clone());
    this.baseQuat = seated.quat.map((q) => q.clone());
    const bone = (name: string) => this.bones.find((b) => b.name === name)!;
    const setPose = () =>
      this.bones.forEach((b, i) => {
        b.position.copy(this.basePos[i]);
        b.quaternion.copy(this.baseQuat[i]);
      });
    const boxOfAll = (names: string[]) => {
      this.group.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const n of names) box.union(boxOf(this.mesh, bone(n)));
      return box;
    };
    /** Moves the figure onto the seat; returns the lowest sole vertex. */
    const place = () => {
      this.group.updateMatrixWorld(true);
      const { minY, minZ, centreX } = buttocksOf(this.mesh, this.bones);
      root.position.x -= centreX;
      root.position.y += SEAT.top - BUTTOCK_SINK - minY;
      root.position.z += BACK_GAP - SEAT.back - minZ;
      return boxOfAll(['FootL', 'FootR']).min.y;
    };
    /** Tips both thighs forward-down by `phi` at the hip and hangs the shins vertical from the knees. */
    const bend = (phi: number) => {
      setPose();
      for (const side of ['L', 'R']) {
        const upper = bone(`UpperLeg${side}`);
        const lower = bone(`LowerLeg${side}`);
        const foot = bone(`Foot${side}`);
        // The foot bone hangs off the armature root, not the shin: it follows the shin's end by hand and keeps its orientation.
        this.group.updateMatrixWorld(true);
        const ankle = lower.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
        this.turnAboutX(upper, phi);
        this.group.updateMatrixWorld(true);
        const shin = lower.localToWorld(ankle.clone()).sub(lower.getWorldPosition(new THREE.Vector3()));
        this.turnAboutX(lower, Math.atan2(shin.z, -shin.y));
        this.group.updateMatrixWorld(true);
        foot.position.copy(foot.parent!.worldToLocal(lower.localToWorld(ankle.clone())));
      }
      return place();
    };
    if (bend(0) > FOOT_CLEARANCE) {
      // Bisect for the smallest tip that brings the soles down (the sole height falls as the thighs tip).
      let lo = 0;
      let hi = MAX_THIGH_TIP;
      if (bend(hi) > FOOT_CLEARANCE) lo = hi;
      for (let k = 0; k < 24 && lo < hi; k++) {
        const mid = (lo + hi) / 2;
        if (bend(mid) > FOOT_CLEARANCE) lo = mid;
        else hi = mid;
      }
      bend(hi);
    }
    this.bones.forEach((b, i) => {
      this.basePos[i].copy(b.position);
      this.baseQuat[i].copy(b.quaternion);
    });
    this.group.updateMatrixWorld(true);
  }

  /** Rotates `bone` about the group's X axis (thigh forward-down is positive), whatever its parent's orientation. */
  private turnAboutX(bone: THREE.Bone, angle: number) {
    bone.parent!.getWorldQuaternion(this.qa);
    this.qb.setFromAxisAngle(this.xAxis, angle);
    bone.quaternion.premultiply(this.qa).premultiply(this.qb).premultiply(this.qa.invert());
  }

  /** Per-seat colours written into the vertex colours of the cloned geometry. */
  private tint(tpl: CharacterTemplate, i: number, outfit: Outfit, hitler: boolean) {
    const coat = hitler ? 0x7a6844 : COATS[i % COATS.length];
    const colors: Record<string, number> = {
      [CLOTH[outfit]]: coat,
      Pants: new THREE.Color(coat).multiplyScalar(0.45).getHex(),
      Skin: hitler ? 0xe8c4a4 : SKINS[(i * 3) % SKINS.length],
    };
    if (outfit === 'suit') {
      colors.TieTexture = hitler ? 0x14100c : i % 2 ? 0x8a1a1a : 0x1a2a4a;
      if (hitler) colors.Details = 0x8c7450;
    }
    const attr = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (const [name, hex] of Object.entries(colors)) {
      const part = tpl.parts[name];
      if (!part) continue;
      c.set(hex);
      for (let v = part.start; v < part.start + part.count; v++) attr.setXYZ(v, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  /**
   * Fits the face anchor (the mouth and smoke position) to the model's own head at rest (world space, metres),
   * and ties the Hitler armband to the upper arm. The glTF models have their own hair and faces: no hats or face props.
   */
  private addFaceAnchorAndArmband(tpl: CharacterTemplate, hitler: boolean) {
    const head = this.bones.find((b) => b.name === 'Head')!;
    const skin = boxOf(this.mesh, head, tpl.parts.Skin);
    const eyes = boxOf(this.mesh, head, tpl.parts.Eyes);
    const f = (skin.max.x - skin.min.x) / HEAD_DIAMETER;
    const eyeY = (eyes.min.y + eyes.max.y) / 2;
    const origin = new THREE.Vector3((skin.min.x + skin.max.x) / 2, eyeY - 0.03 * f, eyes.max.z - 0.15 * f + 0.012);
    this.faceCenter.copy(head.worldToLocal(origin.clone()));
    this.faceScale = f;

    if (hitler) {
      const arm = this.bones.find((b) => b.name === 'UpperArmL')!;
      const axis = this.bones.find((b) => b.name === 'LowerArmL')!.getWorldPosition(new THREE.Vector3()).sub(arm.getWorldPosition(new THREE.Vector3()));
      const len = axis.length();
      axis.divideScalar(len);
      const from = arm.getWorldPosition(new THREE.Vector3());
      let radius = 0;
      eachDominated(this.mesh, arm, (p) => {
        const t = p.clone().sub(from);
        const along = t.dot(axis);
        if (along > len * 0.3 && along < len * 0.7) radius = Math.max(radius, t.addScaledVector(axis, -along).length());
      });
      const mid = from.clone().addScaledVector(axis, len * 0.5);
      const out = Y_UP.clone().addScaledVector(axis, -axis.y).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, axis);
      const band = new THREE.CylinderGeometry(radius * 1.08, radius * 1.08, len * 0.24, 20, 1, true).applyQuaternion(q).translate(mid.x, mid.y, mid.z);
      // Plain white disc, deliberately no insignia.
      const disc = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_UP, out));
      const dp = mid.clone().addScaledVector(out, radius * 1.08 + 0.003);
      disc.translate(dp.x, dp.y, dp.z);
      this.attach(arm, mergeParts([paintGeometry(band, 0xa01818), paintGeometry(disc, 0xe8e0d0)]));
    }
  }

  /** `world` is in rest-pose world space; it is moved into the bone's space and parented to the bone. */
  private attach(bone: THREE.Bone, world: THREE.BufferGeometry) {
    world.applyMatrix4(bone.matrixWorld.clone().invert());
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.mats.push(mat);
    const mesh = new THREE.Mesh(world, mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    bone.add(mesh);
  }

  setLabel(text: string, color = '#F7E1C3') {
    this.badges.setLabel(text, color);
  }

  say(text: string, now: number) {
    this.badges.say(text, now);
  }


  lookAt(target: THREE.Vector3 | null) {
    this.lookTarget = target;
  }

  setHighlight(v: number) {
    this.highlightTarget = Math.min(1, Math.max(0, v));
  }

  setAim(target: THREE.Vector3 | null, mode: 'gun' | 'point' = 'gun') {
    if (target) this.aimMode = mode;
    if (target && !this.aimTarget) this.smoothAim.copy(target); // start where they first look
    this.aimTarget = target ? target.clone() : null;
  }

  /** World pose of the hand holding the revolver: the barrel (-Z) runs along the arm, the top (+Y) is up. */
  gunPose(): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const pos = this.armR.mid.getWorldPosition(new THREE.Vector3());
    const z = this.armR.upper.getWorldPosition(new THREE.Vector3()).sub(pos).normalize();
    const x = new THREE.Vector3().crossVectors(Y_UP, z);
    if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)) };
  }

  setHandsUp(on: boolean) {
    this.handsUp = on;
  }

  die() {
    this.dead = true;
    this.deathT = 0;
  }

  recoil() {
    this.recoilKick = 1;
  }

  react(kind: Reaction, delay = 0) {
    if (this.dead) return;
    this.reaction = { kind, t: -delay };
  }

  setTeamGlow(on: boolean) {
    this.badges.setGlow(on);
  }

  /** Test hook / trigger: begin a drag now (ignored for non-smokers, the dead, or mid-drag). */
  startDrag() {
    if (this.smoker && !this.dead && this.smoke.dragT === null) this.smoke.dragT = 0;
  }

  /** Writes the ember's, the mouth's and the head's facing (slightly down) in world space; returns the exhale amount 0..1, or -1 when there is nothing to emit. */
  smokeEmit(tip: THREE.Vector3, mouth: THREE.Vector3, dir: THREE.Vector3): number {
    if (!this.smoker || this.dead || this.handsUpAmount > 0.02) return -1;
    tip.copy(this.ember);
    this.armL.mid.localToWorld(tip);
    this.mouthAt(mouth);
    dir.set(0, -0.15, 1).applyQuaternion(this.qc).normalize();
    return this.smoke.pose.exhale;
  }

  /** The mouth in world space; leaves the head's world rotation in qc. */
  private mouthAt(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.faceCenter);
    this.head.localToWorld(out);
    this.head.getWorldQuaternion(this.qc);
    return out.add(this.pv.set(0, -0.07, 0.16).multiplyScalar(this.faceScale).applyQuaternion(this.qc));
  }

  private makeArm(side: 'L' | 'R', eff: THREE.Vector3): Arm {
    const bone = (n: string) => this.bones.find((b) => b.name === n + side)!;
    const upper = bone('UpperArm');
    const lower = bone('LowerArm');
    const palm = bone('Palm');
    const mid = bone('MiddleHand');
    const local = eff.clone().divideScalar(this.ws);
    const toEff = local.clone().applyQuaternion(mid.quaternion).add(mid.position).applyQuaternion(palm.quaternion).add(palm.position);
    return {
      upper,
      lower,
      palm,
      mid,
      upAxis: lower.position.clone().normalize(),
      loAxis: toEff.clone().normalize(),
      eff: local,
      len1: lower.position.length() * this.ws,
      len2: toEff.length() * this.ws,
    };
  }

  /** One mesh: filter, paper and an over-bright ember (no bloom, so the ember is lit by its colour alone). */
  private addCigarette() {
    const ember = paintGeometry(new THREE.SphereGeometry(0.0065, 8, 6).translate(0, 0, CIGARETTE_TIP), 0xffffff);
    const col = ember.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) col.setXYZ(i, 6, 2, 0.4);
    const u = 1 / this.ws;
    const geo = mergeParts([cigaretteGeometry(), ember])
      .scale(u, u, u)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(this.zAxis, CIG_AXIS))
      .translate(this.armL.eff.x, this.armL.eff.y, this.armL.eff.z);
    this.ember.copy(CIG_AXIS).multiplyScalar(CIGARETTE_TIP * u).add(this.armL.eff);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.armL.mid.add(mesh);
    this.cig = mesh;
  }

  // ---- Bone helpers (zero allocation) ----

  /** The rotation of `bone`'s parent relative to the patron group, into `out`. */
  private parentRot(bone: THREE.Bone, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    for (let p = bone.parent; p && p !== this.group; p = p.parent) out.premultiply(p.quaternion);
    return out;
  }

  /** Rotates `bone` by `angle` about an axis given in the patron's own frame, on top of its current rotation. */
  private twist(bone: THREE.Bone, axis: THREE.Vector3, angle: number) {
    this.parentRot(bone, this.qa).invert();
    this.pv.copy(axis).applyQuaternion(this.qa);
    bone.quaternion.premultiply(this.qb.setFromAxisAngle(this.pv, angle));
  }

  /** Moves `bone` by `v` metres in the patron's own frame. */
  private shift(bone: THREE.Bone, v: THREE.Vector3) {
    this.parentRot(bone, this.qa).invert();
    bone.position.addScaledVector(this.pv.copy(v).applyQuaternion(this.qa), 1 / this.ws);
  }

  /** Rotates `bone` so its local `axis` points along the world direction `dir`, by the shortest turn. */
  private pointBone(bone: THREE.Bone, axis: THREE.Vector3, dir: THREE.Vector3) {
    bone.parent!.getWorldQuaternion(this.qc);
    this.qb.copy(this.qc).multiply(bone.quaternion);
    this.pv.copy(axis).applyQuaternion(this.qb);
    this.qb.premultiply(this.qa.setFromUnitVectors(this.pv, dir));
    bone.quaternion.copy(this.qc.invert()).multiply(this.qb);
  }

  /**
   * Poses an arm: the upper arm's elbow axis along `dirU`, the forearm's effector axis along `dirL` (world),
   * blended from the current pose by `w`. `face` (world) turns the palm to face that way.
   */
  private armPose(arm: Arm, dirU: THREE.Vector3, dirL: THREE.Vector3, w: number, face: THREE.Vector3 | null) {
    this.qu.copy(arm.upper.quaternion);
    this.ql.copy(arm.lower.quaternion);
    this.pointBone(arm.upper, arm.upAxis, dirU);
    this.pointBone(arm.lower, arm.loAxis, dirL);
    if (face) {
      // The palm's normal is its local -Z; roll the forearm about its own axis until it faces `face`.
      arm.palm.getWorldQuaternion(this.qc);
      const n = this.pw.set(0, 0, -1).applyQuaternion(this.qc);
      const f = this.v5.copy(face).addScaledVector(dirL, -face.dot(dirL)).normalize();
      const angle = Math.atan2(dirL.dot(this.pv.crossVectors(n, f)), n.dot(f));
      arm.lower.parent!.getWorldQuaternion(this.qc);
      this.qb.copy(this.qc).multiply(arm.lower.quaternion).premultiply(this.qa.setFromAxisAngle(dirL, angle));
      arm.lower.quaternion.copy(this.qc.invert()).multiply(this.qb);
    }
    this.qa.copy(arm.upper.quaternion);
    arm.upper.quaternion.slerpQuaternions(this.qu, this.qa, w);
    this.qa.copy(arm.lower.quaternion);
    arm.lower.quaternion.slerpQuaternions(this.ql, this.qa, w);
  }

  // ---- Per-frame motion ----

  /** Left arm of a smoker: the drag schedule, then two-bone IK from the rest hand to the lips. */
  private updateSmoke(dt: number, now: number) {
    const s = this.smoke;
    if (this.dead) s.dragT = null;
    else if (s.dragT === null) {
      s.dragIn -= dt;
      if (s.dragIn <= 0) {
        if (!this.aimTarget && this.aimAmount < 0.05 && !this.reaction && !this.badges.talking(now)) s.dragT = 0;
        else s.dragIn = 2;
      }
    } else {
      s.dragT += dt;
      if (s.dragT >= SMOKE_DUR) {
        s.dragT = null;
        s.dragIn = nextDragDelay(Math.random());
      }
    }
    smokePose(s.dragT ?? 0, s.pose);
    if (this.dead) s.pose.reach = s.pose.exhale = 0;
    const reach = s.pose.reach;
    if (reach < 0.001) return;

    const arm = this.armL;
    const shoulder = arm.upper.getWorldPosition(this.v0);
    const elbow0 = arm.lower.getWorldPosition(this.v1);
    const hand = this.v2.copy(arm.eff);
    arm.mid.localToWorld(hand);
    // The rest elbow's side of the shoulder-to-hand line.
    const u0 = this.v3.copy(hand).sub(shoulder).normalize();
    const pole = this.v4.copy(elbow0).sub(shoulder);
    pole.addScaledVector(u0, -pole.dot(u0)).normalize();
    hand.lerp(this.mouthAt(this.v5), reach).sub(shoulder);
    const d = Math.min(Math.max(hand.length(), 0.05), arm.len1 + arm.len2 - 1e-3);
    const u = this.v3.copy(hand).normalize();
    pole.lerp(this.v5.copy(ELBOW_HINT).applyQuaternion(this.qg), reach);
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    const a = (arm.len1 * arm.len1 - arm.len2 * arm.len2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, arm.len1 * arm.len1 - a * a));
    const elbow = this.v1.copy(u).multiplyScalar(a).addScaledVector(pole, h);
    const toHand = this.v2.copy(u).multiplyScalar(d).sub(elbow).normalize();
    this.armPose(arm, elbow.normalize(), toHand, 1, null);
  }

  /** Right arm: extends straight at the target (the revolver's, or a pointing finger's), or lifts for the fist reaction. */
  private updateAim(dt: number) {
    this.aimAmount += ((this.aimTarget && !this.dead ? 1 : 0) - this.aimAmount) * (1 - Math.exp(-5 * dt));
    this.recoilKick = Math.max(0, this.recoilKick - dt * 4);
    const a = this.aimAmount;
    if (a <= 0.02) {
      if (!this.aimTarget && !this.dead && this.reaction?.kind === 'fist' && this.reaction.t > 0) {
        this.twist(this.armR.upper, this.xAxis, -this.pose.armLift * 1.2);
        this.twist(this.armR.lower, this.xAxis, -this.pose.armLift * 0.8);
      }
      return;
    }
    if (this.aimTarget) this.smoothAim.lerp(this.aimTarget, 1 - Math.exp(-4 * dt));
    const arm = this.armR;
    const dir = this.v1.copy(this.smoothAim).sub(arm.upper.getWorldPosition(this.v0)).normalize();
    if (this.recoilKick > 0 && this.aimTarget) {
      const axis = this.v2.crossVectors(dir, Y_UP);
      if (axis.lengthSq() > 1e-8) dir.applyAxisAngle(axis.normalize(), 0.45 * this.recoilKick);
    }
    this.armPose(arm, dir, dir, a, null);
    const curl = CURL[this.aimMode] * a * (1 - this.handsUpAmount);
    this.fingersR.quaternion.premultiply(this.qa.setFromAxisAngle(this.xAxis, curl));
  }

  /** Both arms to the surrender pose, over whatever else they were doing. */
  private updateHandsUp(now: number) {
    const a = this.handsUpAmount;
    const up = a > 0.02;
    if (this.cig) this.cig.visible = !up;
    if (!up) return;
    this.smoke.dragT = null;
    this.smoke.dragIn = Math.max(this.smoke.dragIn, 3);
    const e = a * a * (3 - 2 * a);
    this.surrender(this.armL, 1, e, now);
    this.surrender(this.armR, -1, e, now);
  }

  /** `side` is +1 for the patron's left. Palms forward, with a faint tremble. */
  private surrender(arm: Arm, side: number, e: number, now: number) {
    const upper = this.v2.set(UP_UPPER.x * side, UP_UPPER.y, UP_UPPER.z).applyQuaternion(this.qg);
    const fore = this.v3.copy(UP_FORE).applyQuaternion(this.qg);
    const forward = this.v4.copy(this.zAxis).applyQuaternion(this.qg);
    this.armPose(arm, upper, fore, e, forward);
    this.twist(arm.lower, this.xAxis, Math.sin(now * 23 + this.phase + side) * 0.03 * e);
  }

  private updateChair(dp: DeathPose) {
    const c = this.chair;
    if (!c) return;
    let b = this.chairBase;
    if (!b || b.obj !== c) b = this.chairBase = { obj: c, yaw: c.rotation.y, pos: c.position.clone() };
    c.rotation.order = 'YXZ';
    // Positive rotation.x carries the chair-local +y (top) toward +z (the back side), i.e. tips it backward.
    c.rotation.set(dp.chairTip, b.yaw + dp.chairYaw, 0);
    // Keep the rear-leg line (local z = 0.2, y = 0) fixed in place so the rear feet stay on the floor.
    this.v0.set(0, 0, 0.2).applyEuler(this.euler.set(0, b.yaw, 0));
    c.position.copy(b.pos).add(this.v0);
    this.v0.set(0, 0, 0.2).applyEuler(c.rotation);
    c.position.sub(this.v0);
  }

  update(dt: number, now: number) {
    const t = now + this.phase;
    // Back to the baked seat, then this frame's offsets on top.
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].position.copy(this.basePos[i]);
      this.bones[i].quaternion.copy(this.baseQuat[i]);
    }
    if (this.reaction) {
      this.reaction.t += dt;
      if (this.reaction.t >= REACTION_DUR[this.reaction.kind]) this.reaction = null;
    }
    if (this.reaction) reactionPose(this.reaction.kind, Math.max(0, this.reaction.t), this.pose);
    else this.pose.pitch = this.pose.yaw = this.pose.lean = this.pose.armLift = 0;
    if (!this.dead) this.deathT = null;
    else if (this.deathT === null) this.deathT = DEATH_DUR;
    else this.deathT = Math.min(DEATH_DUR, this.deathT + dt);
    const dk = this.deathT === null ? 0 : this.deathT / DEATH_DUR;
    const dp = deathPose(this.deathT ?? 0, this.deathPoseState);
    this.group.getWorldQuaternion(this.qg);
    // Idle: breathing and a slow sway.
    this.torso.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.xAxis, Math.sin(t * 1.6) * 0.012 * (1 - dk)));
    this.torso.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.zAxis, Math.sin(t * 0.5) * 0.02 * (1 - dk)));
    this.abdomen.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.xAxis, Math.sin(t * 1.6 + 0.6) * 0.008 * (1 - dk)));
    // The body: execution slump and reaction lean (negative = back) pivot about the waist, the drop and push move the upper body.
    const lean = dp.lean + this.pose.lean;
    if (lean) {
      this.twist(this.abdomen, this.xAxis, lean * 0.45);
      this.twist(this.torso, this.xAxis, lean * 0.55);
    }
    if (dp.roll) this.twist(this.abdomen, this.zAxis, dp.roll);
    const push = dp.push + this.pose.lean * 0.25;
    if (dp.drop || push) this.shift(this.abdomen, this.v0.set(0, -dp.drop, push));
    this.updateChair(dp);

    // Head: look at the target (40% neck, 60% head), nod and shake on top, a small bob while talking.
    const k = 1 - Math.exp(-4 * dt);
    let yaw = Math.sin(t * 0.3) * 0.15;
    let pitch = 0;
    if (this.lookTarget && !this.dead) {
      const local = this.group.worldToLocal(this.v0.copy(this.lookTarget));
      local.y -= HEAD_Y;
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
    this.talk += ((this.badges.talking(now) && !this.dead ? 1 : 0) - this.talk) * k;
    const headPitch = this.headPitch + this.pose.pitch + this.talk * 0.05 * mouthOpen(t);
    const headYaw = this.headYaw + this.pose.yaw;
    this.twist(this.neck, this.xAxis, headPitch * 0.4);
    this.twist(this.neck, this.yAxis, headYaw * 0.4);
    this.twist(this.head, this.xAxis, headPitch * 0.6);
    this.twist(this.head, this.yAxis, headYaw * 0.6);

    // Arms: the smoker's drag, the aim, then the surrender over both.
    this.handsUpAmount += ((this.handsUp && !this.dead ? 1 : 0) - this.handsUpAmount) * (1 - Math.exp(-7 * dt));
    if (this.smoker) this.updateSmoke(dt, now);
    this.updateAim(dt);
    this.updateHandsUp(now);

    // Highlight / death tint, as on the procedural patron.
    this.highlight += (this.highlightTarget - this.highlight) * (1 - Math.exp(-12 * dt));
    this.badges.update(dt, now, this.dead);
    const h = this.highlight;
    const g = this.badges.glowAmt;
    for (const m of this.mats) {
      m.color.setScalar(1 - dk * 0.55);
      m.emissive.setRGB(h * 0.35 + g * 0.45, h * 0.25 + g * 0.05, h * 0.08 + g * 0.03);
    }
  }

  /** Frees only this patron's own geometry, materials, skeleton and sprites; the template's stay intact. */
  dispose() {
    this.mesh.skeleton.dispose();
    disposeObject(this.group);
  }
}
