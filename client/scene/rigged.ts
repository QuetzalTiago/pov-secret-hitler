// Rigged patrons: CC0 glTF characters (one skinned, vertex-coloured mesh each) seated in the chair, tinted per seat.
// The Sitting clip is sampled once per template and baked into plain bone transforms, so there is no per-frame mixer.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getAssets, type CharacterTemplate, type Outfit } from './assets';
import { PatronBadges } from './badges';
import { COATS, HATS, SKINS, type Patron } from './characters';
import { disposeObject } from './dispose';
import { DEATH_DUR, isSmoker, type Reaction } from './life';
import { faceDetailGeometry, hatGeometry, mergeParts, paintGeometry, peakedCapGeometry } from './patron';

const HEIGHT = 1.75;
const HEIGHT_WOMAN = 1.68;
/** Hips in the patron's local space: seat top 0.48 plus the pelvis, a little forward of the backrest. */
const HIPS_AT = new THREE.Vector3(0, 0.56, -0.05);
const DARK = 0x1a1410;
const HAT_COLORS = [0x1d1a18, 0x3a2a1a, 0x22252a, 0x4a1a1a];
/** The accessory geometry in patron.ts assumes a head of this diameter, centred on its origin, eyes at y 0.03, face at z 0.15. */
const HEAD_DIAMETER = 0.3;
const Y_UP = new THREE.Vector3(0, 1, 0);

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

export class RiggedCharacter implements Patron {
  readonly group = new THREE.Group();
  readonly smoker: boolean;
  dead = false;
  hitMeshes: THREE.Object3D[];
  chair: THREE.Object3D | null = null;
  highlight = 0;

  private mesh: THREE.SkinnedMesh;
  private bones: THREE.Bone[];
  private basePos: THREE.Vector3[];
  private baseQuat: THREE.Quaternion[];
  private torso: THREE.Bone;
  private abdomen: THREE.Bone;
  private palmR: THREE.Bone;
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
  private tmpQ = new THREE.Quaternion();
  private readonly xAxis = new THREE.Vector3(1, 0, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

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
    this.palmR = bone('PalmR');

    this.tint(tpl, styleIndex, outfit, hitler);
    this.group.updateMatrixWorld(true);
    this.addAccessories(tpl, styleIndex, hitler);

    // Seat: bake the sitting pose, then slide the whole figure so the hips land on the chair.
    const seated = seatedPose(tpl);
    this.bones.forEach((b, i) => {
      b.position.copy(seated.pos[i]);
      b.quaternion.copy(seated.quat[i]);
    });
    this.basePos = seated.pos;
    this.baseQuat = seated.quat;
    this.group.updateMatrixWorld(true);
    const hips = this.group.worldToLocal(bone('Hips').getWorldPosition(new THREE.Vector3()));
    root.position.add(HIPS_AT).sub(hips);

    this.badges = new PatronBadges(this.group, { tag: 1.86, bubble: 2.0, glow: new THREE.Vector3(0, 1.3, -0.05), glowScale: 1.4 });
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
   * Hat, moustache and beard ride the Head bone as one mesh, the Hitler armband the upper arm.
   * Fitted to the model's own head at rest (world space, metres), then baked into bone space so the bone's scale cancels.
   */
  private addAccessories(tpl: CharacterTemplate, i: number, hitler: boolean) {
    const head = this.bones.find((b) => b.name === 'Head')!;
    const skin = boxOf(this.mesh, head, tpl.parts.Skin);
    const eyes = boxOf(this.mesh, head, tpl.parts.Eyes);
    const f = (skin.max.x - skin.min.x) / HEAD_DIAMETER;
    const parts: THREE.BufferGeometry[] = [];
    if (hitler) {
      const cap = peakedCapGeometry();
      parts.push(paintGeometry(cap.cloth, 0x6e5c3c), paintGeometry(cap.trim, DARK), paintGeometry(cap.badge, 0xc8a050));
    } else {
      const hat = HATS[i % HATS.length];
      if (hat !== 'none') parts.push(paintGeometry(hatGeometry(hat), HAT_COLORS[i % 4]));
    }
    // The model has its own hair and eyes: only brows, moustache and beard.
    parts.push(
      paintGeometry(
        faceDetailGeometry({ browTilt: i % 3 === 0 ? 0.25 : -0.08, mustache: hitler ? 'toothbrush' : i % 4 === 1 ? 'wide' : 'none', beard: !hitler && i % 5 === 2, hair: false, fringe: false }),
        DARK,
      ),
    );
    const eyeY = (eyes.min.y + eyes.max.y) / 2;
    const origin = new THREE.Vector3((skin.min.x + skin.max.x) / 2, eyeY - 0.03 * f, eyes.max.z - 0.15 * f + 0.012);
    this.attach(head, mergeParts(parts).scale(f, f, f).translate(origin.x, origin.y, origin.z));

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

  setHighlight(on: boolean) {
    this.highlightTarget = on ? 1 : 0;
  }

  setAim(target: THREE.Vector3 | null, mode: 'gun' | 'point' = 'gun') {
    if (target) this.aimMode = mode;
    this.aimTarget = target ? target.clone() : null;
  }

  /** World pose of the right palm, where the revolver is held. */
  gunPose(): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    return { pos: this.palmR.getWorldPosition(new THREE.Vector3()), quat: this.palmR.getWorldQuaternion(new THREE.Quaternion()) };
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

  /** Smoking is not animated yet: never emits. */
  smokeEmit(_tip: THREE.Vector3, _mouth: THREE.Vector3, _dir: THREE.Vector3): number {
    return -1;
  }

  update(dt: number, now: number) {
    const t = now + this.phase;
    // Back to the baked seat, then this frame's offsets on top.
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].position.copy(this.basePos[i]);
      this.bones[i].quaternion.copy(this.baseQuat[i]);
    }
    if (!this.dead) this.deathT = null;
    else if (this.deathT === null) this.deathT = DEATH_DUR;
    else this.deathT = Math.min(DEATH_DUR, this.deathT + dt);
    const dk = this.deathT === null ? 0 : this.deathT / DEATH_DUR;
    // Idle: breathing and a slow sway.
    this.torso.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.xAxis, Math.sin(t * 1.6) * 0.012 * (1 - dk)));
    this.torso.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.zAxis, Math.sin(t * 0.5) * 0.02 * (1 - dk)));
    this.abdomen.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.xAxis, Math.sin(t * 1.6 + 0.6) * 0.008 * (1 - dk)));

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
