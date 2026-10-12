// The waiter behind the back bar: an ambient, non-interactive glTF figure polishing a wine glass with a cloth.
// The Idle clip is sampled once and baked into plain bone transforms; everything else is procedural (no mixer).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterTemplate } from './assets';
import { SKINS } from './characters';
import { boxOf, skinnedMeshOf } from './rigged';
import { normalizeProp } from './roomprops';

/** Where the waiter stands, behind the counter (x, z); his hips are centred here. */
export const WAITER_SPOT = { x: 1.5, z: -4.5 };
const HEIGHT = 1.75;
const GLASS_HEIGHT = 0.16;
/** Where the glass sits in the left hand along its axis, from its base. */
const HOLD = 0.06;
/** Left hand at rest, in group space (the figure faces +z, its left is +x): in front of the chest, above the counter top. */
const HAND_L = new THREE.Vector3(0.1, 1.27, 0.27);
/** The right hand beside the glass's bowl, in the glass's tilted frame. */
const HAND_R = new THREE.Vector3(-0.05, 0.1, 0.03);
/** Radius (m) and speed (rad/s) of the rubbing circle: about 1.5 rubs a second. */
const RUB_RADIUS = 0.025;
const RUB_SPEED = 1.5 * Math.PI * 2;
/** Raising the glass to the light: how far up and forward the hand goes (m), and the glass's tilt (rad). */
const LIFT = { up: 0.2, fwd: 0.06, tilt: -0.5 };
const LIFT_DUR = 2;
const GLANCE_DUR = 1.5;
const GLANCE_YAW = 0.4;
/** The elbows hang down and out, a little back (group space, left arm; mirrored for the right). */
const ELBOW_HINT = new THREE.Vector3(0.5, -1, -0.3).normalize();

/** 0 -> 1 -> 0 over u in [0, 1], easing in and out with a short plateau (no snaps). */
export function bump(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  const s = (x: number) => {
    const c = Math.min(1, x);
    return c * c * c * (c * (c * 6 - 15) + 10);
  };
  return s(u / 0.3) * s((1 - u) / 0.3);
}

interface Arm {
  upper: THREE.Bone;
  lower: THREE.Bone;
  mid: THREE.Bone;
  /** In the upper arm's space, toward the elbow. */
  upAxis: THREE.Vector3;
  /** In the forearm's space, toward the middle of the hand. */
  loAxis: THREE.Vector3;
  len1: number;
  len2: number;
}

const idlePoses = new WeakMap<CharacterTemplate, { pos: THREE.Vector3[]; quat: THREE.Quaternion[] }>();

/** The Idle clip at one settled moment, as bone transforms in skeleton order. */
function idlePose(t: CharacterTemplate) {
  const cached = idlePoses.get(t);
  if (cached) return cached;
  const clip = t.clips.Idle;
  if (!clip) throw new Error('waiter: no Idle clip');
  const root = cloneSkinned(t.root);
  const bones = skinnedMeshOf(root).skeleton.bones;
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  mixer.setTime(clip.duration * 0.25);
  const pose = { pos: bones.map((b) => b.position.clone()), quat: bones.map((b) => b.quaternion.clone()) };
  idlePoses.set(t, pose);
  return pose;
}

export class Waiter {
  readonly group = new THREE.Group();

  private mesh: THREE.SkinnedMesh;
  private bones: THREE.Bone[];
  private basePos: THREE.Vector3[];
  private baseQuat: THREE.Quaternion[];
  private torso: THREE.Bone;
  private abdomen: THREE.Bone;
  private neck: THREE.Bone;
  private head: THREE.Bone;
  private armL: Arm;
  private armR: Arm;
  /** Carries the glass (or nothing, without one): the left hand's anchor, turned and tilted. */
  private holder = new THREE.Object3D();
  private cloth: THREE.Mesh;
  private time = Math.random() * 10;
  private liftIn = 3 + Math.random() * 3;
  private liftT: number | null = null;
  private glanceIn = 6 + Math.random() * 6;
  private glanceT: number | null = null;
  private glanceDir = 1;
  private tmpQ = new THREE.Quaternion();
  private readonly xAxis = new THREE.Vector3(1, 0, 0);
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  // Scratch, so a frame allocates nothing.
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private qc = new THREE.Quaternion();
  private qg = new THREE.Quaternion();
  private v0 = new THREE.Vector3();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();
  private hand = new THREE.Vector3();

  constructor(tpl: CharacterTemplate, glass: THREE.Object3D | null) {
    const root = cloneSkinned(tpl.root);
    root.scale.multiplyScalar(HEIGHT);
    root.position.multiplyScalar(HEIGHT);
    this.group.add(root);

    const mesh = skinnedMeshOf(root);
    mesh.geometry = mesh.geometry.clone();
    mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.mesh = mesh;
    this.bones = mesh.skeleton.bones;
    const bone = (name: string) => this.bones.find((b) => b.name === name)!;
    this.torso = bone('Torso');
    this.abdomen = bone('Abdomen');
    this.neck = bone('Neck');
    this.head = bone('Head');
    this.tint(tpl);

    const pose = idlePose(tpl);
    this.basePos = pose.pos.map((p) => p.clone());
    this.baseQuat = pose.quat.map((q) => q.clone());
    this.setBase();
    this.standOnFloor(root);
    const ws = this.torso.getWorldScale(this.v0).x;
    this.armL = this.makeArm('L', ws);
    this.armR = this.makeArm('R', ws);

    this.group.add(this.holder);
    this.holder.rotation.order = 'XYZ';
    if (glass) this.holder.add(this.makeGlass(glass));
    this.cloth = this.makeCloth();
    this.group.add(this.cloth);
    this.update(0);
  }

  /** White shirt, black trousers and a patron's skin; the rest of the model keeps its own colours. */
  private tint(tpl: CharacterTemplate) {
    const colors: Record<string, number> = { Shirt: 0xe6e1d6, Pants: 0x161412, Skin: SKINS[Math.floor(Math.random() * SKINS.length)] };
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

  private setBase() {
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].position.copy(this.basePos[i]);
      this.bones[i].quaternion.copy(this.baseQuat[i]);
    }
  }

  /** Centres the figure over the group origin and drops it until the soles touch y 0. */
  private standOnFloor(root: THREE.Object3D) {
    this.group.updateMatrixWorld(true);
    const hips = this.bones.find((b) => b.name === 'Hips')!.getWorldPosition(this.v0);
    root.position.x -= hips.x;
    root.position.z -= hips.z;
    this.group.updateMatrixWorld(true);
    const feet = new THREE.Box3().union(boxOf(this.mesh, this.bones.find((b) => b.name === 'FootL')!)).union(boxOf(this.mesh, this.bones.find((b) => b.name === 'FootR')!));
    root.position.y -= feet.min.y;
    this.group.updateMatrixWorld(true);
  }

  /** Same construction as RiggedCharacter's arms; the end effector is the middle of the hand. */
  private makeArm(side: 'L' | 'R', ws: number): Arm {
    const bone = (n: string) => this.bones.find((b) => b.name === n + side)!;
    const lower = bone('LowerArm');
    const palm = bone('Palm');
    const mid = bone('MiddleHand');
    const toEff = mid.position.clone().applyQuaternion(palm.quaternion).add(palm.position);
    return {
      upper: bone('UpperArm'),
      lower,
      mid,
      upAxis: lower.position.clone().normalize(),
      loAxis: toEff.clone().normalize(),
      len1: lower.position.length() * ws,
      len2: toEff.length() * ws,
    };
  }

  /** A clone of the glass prop with its own geometry (the room is disposed on rebuild) and a clear glass material. */
  private makeGlass(src: THREE.Object3D): THREE.Object3D {
    const g = normalizeProp(src, GLASS_HEIGHT);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8e6e0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry = m.geometry.clone();
      m.material = mat;
    });
    // The prop stands on y 0 and is centred; hang it so HOLD is at the holder's origin.
    g.position.y = -HOLD;
    return g;
  }

  /** A thin, slightly crumpled off-white cloth, about 0.12 x 0.18 m. */
  private makeCloth(): THREE.Mesh {
    const geo = new THREE.BoxGeometry(0.12, 0.012, 0.18, 4, 1, 5);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.sin(p.getX(i) * 53) * Math.cos(p.getZ(i) * 41) * 0.006);
    geo.computeVertexNormals();
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.95 }));
    cloth.castShadow = true;
    return cloth;
  }

  // ---- Bone helpers (zero allocation) ----

  /** Rotates `bone` by `angle` about an axis given in the group's frame, on top of its current rotation. */
  private twist(bone: THREE.Bone, axis: THREE.Vector3, angle: number) {
    bone.parent!.getWorldQuaternion(this.qa).invert();
    this.v0.copy(axis).applyQuaternion(this.qg).applyQuaternion(this.qa);
    bone.quaternion.premultiply(this.qb.setFromAxisAngle(this.v0, angle));
  }

  /** Rotates `bone` so its local `axis` points along the world direction `dir`, by the shortest turn. */
  private pointBone(bone: THREE.Bone, axis: THREE.Vector3, dir: THREE.Vector3) {
    bone.parent!.getWorldQuaternion(this.qc);
    this.qb.copy(this.qc).multiply(bone.quaternion);
    this.v0.copy(axis).applyQuaternion(this.qb);
    this.qb.premultiply(this.qa.setFromUnitVectors(this.v0, dir));
    bone.quaternion.copy(this.qc.invert()).multiply(this.qb);
  }

  /** Two-bone IK: puts the middle of the hand on `target` (world), the elbow on the `hint` side (world). */
  private reach(arm: Arm, target: THREE.Vector3, hint: THREE.Vector3) {
    const shoulder = arm.upper.getWorldPosition(this.v1);
    const to = this.v2.copy(target).sub(shoulder);
    const d = Math.min(Math.max(to.length(), 0.05), arm.len1 + arm.len2 - 1e-3);
    const u = to.normalize();
    const pole = this.v3.copy(hint).addScaledVector(u, -hint.dot(u)).normalize();
    const a = (arm.len1 * arm.len1 - arm.len2 * arm.len2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, arm.len1 * arm.len1 - a * a));
    const elbow = this.v4.copy(u).multiplyScalar(a).addScaledVector(pole, h);
    const toHand = this.v2.copy(u).multiplyScalar(d).sub(elbow).normalize();
    elbow.normalize();
    this.pointBone(arm.upper, arm.upAxis, elbow);
    this.pointBone(arm.lower, arm.loAxis, toHand);
  }

  /** Counts down to the next lift of the glass and the next glance at the table. */
  private schedule(dt: number) {
    if (this.liftT === null) {
      this.liftIn -= dt;
      if (this.liftIn <= 0) this.liftT = 0;
    } else {
      this.liftT += dt;
      if (this.liftT >= LIFT_DUR) {
        this.liftT = null;
        this.liftIn = 7 + Math.random() * 5;
      }
    }
    if (this.glanceT === null) {
      this.glanceIn -= dt;
      if (this.glanceIn <= 0) {
        this.glanceT = 0;
        this.glanceDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else {
      this.glanceT += dt;
      if (this.glanceT >= GLANCE_DUR) {
        this.glanceT = null;
        this.glanceIn = 10 + Math.random() * 10;
      }
    }
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    this.schedule(dt);
    const lift = this.liftT === null ? 0 : bump(this.liftT / LIFT_DUR);
    const glance = this.glanceT === null ? 0 : bump(this.glanceT / GLANCE_DUR) * this.glanceDir;

    this.setBase();
    this.group.getWorldQuaternion(this.qg);
    // Breathing.
    this.torso.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.xAxis, Math.sin(t * 1.7) * 0.012));
    this.abdomen.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.xAxis, Math.sin(t * 1.7 + 0.6) * 0.008));
    // Head: down at the glass, up at the light when he lifts it, aside when he glances at the table.
    const pitch = 0.12 * (1 - lift) - 0.3 * lift;
    const yaw = glance * GLANCE_YAW + Math.sin(t * 0.3) * 0.04;
    this.twist(this.neck, this.xAxis, pitch * 0.4);
    this.twist(this.neck, this.yAxis, yaw * 0.4);
    this.twist(this.head, this.xAxis, pitch * 0.6);
    this.twist(this.head, this.yAxis, yaw * 0.6);

    // The glass: held in the left hand, which drifts slightly, turns slowly and rises and tilts on a lift.
    const h = this.holder;
    const tilt = LIFT.tilt * lift;
    h.rotation.set(tilt, t * 0.6, 0);
    h.position.set(HAND_L.x + Math.sin(t * 0.8) * 0.006, HAND_L.y + LIFT.up * lift, HAND_L.z + LIFT.fwd * lift);
    // The right hand rubs small circles at the bowl, following the glass's tilt but not its turn.
    this.tmpQ.setFromAxisAngle(this.xAxis, tilt);
    const ang = t * RUB_SPEED;
    const target = this.v0.copy(HAND_R).applyQuaternion(this.tmpQ).add(h.position);
    target.x += Math.cos(ang) * RUB_RADIUS;
    target.z += Math.sin(ang) * RUB_RADIUS;
    this.cloth.position.copy(target);
    this.cloth.quaternion.copy(this.tmpQ);
    this.cloth.rotateY(Math.sin(ang) * 0.25);
    this.hand.copy(target);

    // Arms, aimed at world-space targets.
    this.group.updateMatrixWorld(true);
    this.reach(this.armR, this.hand.applyMatrix4(this.group.matrixWorld), this.v0.set(-ELBOW_HINT.x, ELBOW_HINT.y, ELBOW_HINT.z).applyQuaternion(this.qg));
    this.reach(this.armL, this.hand.copy(h.position).applyMatrix4(this.group.matrixWorld), this.v0.copy(ELBOW_HINT).applyQuaternion(this.qg));
  }
}
