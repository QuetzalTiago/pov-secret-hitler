// Procedural low-poly patrons. Original designs: coats, faces and hats vary by seat.
import * as THREE from 'three';
import { textSprite } from './textures';
import { boxLimb } from './world';

const COATS = [0x6b2f2a, 0x2f4a6b, 0x4a5a2a, 0x5a3a6b, 0x7a5a2a, 0x2a5a55, 0x6b4a3a, 0x3a3a46, 0x803a50, 0x55602f];
const SKINS = [0xe0b090, 0xb07a55, 0x8a5a3a, 0xd9a07a, 0x6b4430, 0xf0c8a8, 0xc08860, 0x9a6a48, 0xe6b898, 0x7a4e36];
const HATS = ['fedora', 'cap', 'bowler', 'none', 'beret', 'tophat', 'none', 'fedora', 'bowler', 'cap'] as const;

function mat(color: number, rough = 0.75) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });
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
  private slump = 0;
  dead = false;
  highlight = 0;
  private highlightTarget = 0;
  private glow: THREE.PointLight;
  private glowTarget = 0;
  hitMeshes: THREE.Object3D[] = [];

  /**
   * `hitler` is only ever used when the server has revealed this seat's role to the viewer
   * (fascist teammates, or everyone at game over). Everybody else gets the seat's normal patron.
   */
  constructor(public seat: number, styleIndex: number, public variant: 'normal' | 'hitler' = 'normal') {
    const hitler = variant === 'hitler';
    const coat = mat(hitler ? 0x7a6844 : COATS[styleIndex % COATS.length]);
    const skin = mat(hitler ? 0xe8c4a4 : SKINS[(styleIndex * 3) % SKINS.length], 0.6);
    const dark = mat(0x1a1410, 0.6);
    const shirt = mat(hitler ? 0x8c7450 : 0xd8d0c0);
    this.mats.push(coat, skin, dark, shirt);

    // Torso: tapered coat with a shirt V and lapels.
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.62, 7), coat);
    torso.position.y = 0.86;
    const chest = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 3), shirt);
    chest.position.set(0, 0.98, 0.2);
    chest.rotation.set(-0.12 + Math.PI, 0, 0);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.17, 0.02), mat(hitler ? 0x14100c : styleIndex % 2 ? 0x8a1a1a : 0x1a2a4a));
    tie.position.set(0, 0.99, 0.235);
    tie.rotation.x = -0.12;
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.26), coat);
    shoulders.position.y = 1.13;
    // Arms reaching to the table.
    for (const side of [-1, 1]) {
      // Jointed chain so the hands stay attached: shoulder -> elbow -> wrist on the table edge.
      const shoulder = new THREE.Vector3(side * 0.27, 1.1, 0.0);
      const elbow = new THREE.Vector3(side * 0.31, 0.88, 0.17);
      const wrist = new THREE.Vector3(side * 0.23, 0.83, 0.45);
      const upper = boxLimb(shoulder, elbow, 0.11, 0.12, coat);
      const fore = boxLimb(elbow, wrist, 0.1, 0.1, coat);
      const dir = wrist.clone().sub(elbow).setY(0).normalize();
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.11), skin);
      hand.position.copy(wrist).addScaledVector(dir, 0.055).setY(0.815);
      hand.rotation.y = Math.atan2(dir.x, dir.z);
      this.body.add(upper, fore, hand);
      if (side === -1) {
        // Right arm (the figure faces +Z, so its right is -X): swapped for the aiming rig when holding the gun.
        this.restArm = [upper, fore, hand];
        this.buildAimArm(shoulder, wrist, coat, skin);
      }
      if (hitler && side === 1) {
        // Plain red armband on the upper arm (deliberately no insignia).
        const band = boxLimb(shoulder.clone().lerp(elbow, 0.38), shoulder.clone().lerp(elbow, 0.62), 0.125, 0.135, mat(0xa01818, 0.5));
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 12), mat(0xe8e0d0, 0.5));
        disc.position.copy(shoulder).lerp(elbow, 0.5).add(new THREE.Vector3(0.066, 0, 0));
        disc.rotation.z = Math.PI / 2;
        this.body.add(band, disc);
      }
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), skin);
    neck.position.y = 1.22;
    this.body.add(torso, chest, tie, shoulders, neck);
    if (hitler) this.addUniform(dark);

    // Head: faceted sphere with a simple face.
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), skin);
    skull.scale.set(1, 1.12, 1);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0c0806, emissive: 0x221100, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.022, 0.02), eyeMat);
      eye.position.set(side * 0.055, 0.03, 0.135);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.014, 0.02), dark);
      brow.position.set(side * 0.055, 0.065, 0.135);
      brow.rotation.z = side * (styleIndex % 3 === 0 ? 0.25 : -0.08);
      this.head.add(eye, brow);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 4), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.005, 0.16);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.01), dark);
    mouth.position.set(0, -0.07, 0.135);
    this.head.add(skull, nose, mouth);
    if (hitler) {
      // Short square moustache and a dark fringe swept across the forehead.
      const stache = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.026, 0.02), dark);
      stache.position.set(0, -0.04, 0.148);
      const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.05), dark);
      fringe.position.set(-0.025, 0.085, 0.12);
      fringe.rotation.z = 0.35;
      this.head.add(stache, fringe);
    } else if (styleIndex % 4 === 1) {
      const stache = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.02), dark);
      stache.position.set(0, -0.042, 0.145);
      this.head.add(stache);
    }
    if (!hitler && styleIndex % 5 === 2) {
      const beard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.1), dark);
      beard.position.set(0, -0.11, 0.08);
      this.head.add(beard);
    }
    if (hitler) this.addPeakedCap();
    else this.addHat(HATS[styleIndex % HATS.length], styleIndex);
    this.head.position.y = 1.4;
    this.body.add(this.head);
    this.group.add(this.body);

    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        this.hitMeshes.push(o);
      }
    });
    for (const m of this.mats) this.baseColors.push(m.color.clone());

    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.tag.position.y = 1.86;
    this.tag.renderOrder = 10;
    this.group.add(this.tag);

    this.glow = new THREE.PointLight(0xff1a0a, 0, 1.6, 1.2);
    this.glow.position.set(0, 1.5, 0.5);
    this.group.add(this.glow);
  }

  /** Belt, cross strap and tunic buttons. */
  private addUniform(dark: THREE.MeshStandardMaterial) {
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.05, 7), dark);
    belt.position.y = 0.7;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.5, 0.02), dark);
    strap.position.set(-0.04, 0.93, 0.225);
    strap.rotation.set(-0.12, 0, -0.55);
    const brass = mat(0xc8a050, 0.35);
    brass.metalness = 0.8;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), brass);
    buckle.position.set(0, 0.7, 0.245);
    this.body.add(belt, strap, buckle);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4), brass);
      b.position.set(0.05, 0.8 + i * 0.09, 0.235 - i * 0.008);
      this.body.add(b);
    }
  }

  /** Military peaked cap: tall crown, dark band, glossy visor. */
  private addPeakedCap() {
    const capMat = mat(0x6e5c3c, 0.7);
    const bandMat = mat(0x1a1410, 0.5);
    this.mats.push(capMat);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.15, 0.1, 10), capMat);
    crown.position.y = 0.17;
    crown.rotation.x = -0.12;
    crown.scale.z = 1.08;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 10), bandMat);
    band.position.y = 0.12;
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 10, 1, false, -Math.PI / 2, Math.PI), bandMat);
    visor.position.set(0, 0.1, 0.1);
    visor.rotation.x = 0.22;
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 10), mat(0xc8a050, 0.35));
    badge.rotation.x = Math.PI / 2 - 0.12;
    badge.position.set(0, 0.18, 0.175);
    this.head.add(crown, band, visor, badge);
  }

  private addHat(kind: (typeof HATS)[number], i: number) {
    const hatMat = mat([0x1d1a18, 0x3a2a1a, 0x22252a, 0x4a1a1a][i % 4], 0.8);
    this.mats.push(hatMat);
    const add = (geo: THREE.BufferGeometry, y: number, sx = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, hatMat);
      m.position.y = y;
      m.scale.set(sx, 1, sz);
      this.head.add(m);
      return m;
    };
    switch (kind) {
      case 'fedora':
        add(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 12), 0.12);
        add(new THREE.CylinderGeometry(0.12, 0.15, 0.14, 8), 0.19);
        break;
      case 'tophat':
        add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 12), 0.12);
        add(new THREE.CylinderGeometry(0.13, 0.13, 0.26, 10), 0.25);
        break;
      case 'bowler':
        add(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12), 0.11);
        add(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0.11);
        break;
      case 'cap': {
        add(new THREE.SphereGeometry(0.165, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0.07);
        const brim = add(new THREE.BoxGeometry(0.2, 0.015, 0.12), 0.08);
        brim.position.z = 0.14;
        break;
      }
      case 'beret': {
        const b = add(new THREE.CylinderGeometry(0.17, 0.16, 0.06, 10), 0.15);
        b.rotation.z = 0.2;
        break;
      }
      case 'none': {
        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.158, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), mat(0x2a1a10, 0.9));
        hair.position.y = 0.03;
        this.head.add(hair);
        break;
      }
    }
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
  private aimArm = new THREE.Group();
  /** Where the revolver's grip sits while aiming (world position read by the game each frame). */
  handAnchor = new THREE.Object3D();
  private aimTarget: THREE.Vector3 | null = null;
  private aimAmount = 0;
  private recoilKick = 0;
  private restQuat = new THREE.Quaternion();

  /** A straight arm pivoting at the shoulder; its +Z axis points along the arm toward the hand. */
  private buildAimArm(shoulder: THREE.Vector3, wrist: THREE.Vector3, coat: THREE.Material, skin: THREE.Material) {
    this.aimArm.position.copy(shoulder);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.3), coat);
    upper.position.z = 0.14;
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.28), coat);
    fore.position.z = 0.41;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.09), skin);
    hand.position.z = 0.58;
    this.handAnchor.position.set(0, 0.0, 0.6);
    // Index finger, shown only when pointing (not when holding the gun).
    this.finger = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.024, 0.1), skin);
    this.finger.position.set(0, 0.02, 0.66);
    this.aimArm.add(upper, fore, hand, this.finger, this.handAnchor);
    for (const m of [upper, fore, hand]) m.castShadow = true;
    this.aimArm.visible = false;
    // Resting orientation: pointing from the shoulder down toward the hand on the table.
    const m = new THREE.Matrix4().lookAt(wrist, shoulder, new THREE.Vector3(0, 1, 0));
    this.restQuat.setFromRotationMatrix(m);
    this.aimArm.quaternion.copy(this.restQuat);
    this.body.add(this.aimArm);
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

  recoil() {
    this.recoilKick = 1;
  }

  private updateAim(dt: number) {
    const k = 1 - Math.exp(-5 * dt);
    this.aimAmount += ((this.aimTarget && !this.dead ? 1 : 0) - this.aimAmount) * k;
    this.recoilKick = Math.max(0, this.recoilKick - dt * 4);
    const aiming = this.aimAmount > 0.02;
    this.aimArm.visible = aiming;
    this.finger.visible = this.aimMode === 'point';
    for (const m of this.restArm) m.visible = !aiming;
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

  setTeamGlow(on: boolean) {
    this.glowTarget = on ? 1 : 0;
  }

  update(dt: number, now: number) {
    const t = now + this.phase;
    this.updateAim(dt);
    // Idle: breathing and a slow sway.
    const k = 1 - Math.exp(-4 * dt);
    this.slump += ((this.dead ? 1 : 0) - this.slump) * (1 - Math.exp(-3 * dt));
    this.body.position.y = Math.sin(t * 1.6) * 0.006 * (1 - this.slump) - this.slump * 0.12;
    this.body.rotation.z = Math.sin(t * 0.5) * 0.02 * (1 - this.slump) + this.slump * 0.18;
    this.body.rotation.x = this.slump * 0.75;
    this.body.position.z = this.slump * 0.18;

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
      yaw = 0.3;
      pitch = 0.9;
    }
    this.headYaw += (yaw - this.headYaw) * k;
    this.headPitch += (pitch - this.headPitch) * k;
    this.head.rotation.set(this.headPitch, this.headYaw, 0, 'YXZ');

    // Highlight / death tint.
    this.highlight += (this.highlightTarget - this.highlight) * (1 - Math.exp(-12 * dt));
    this.mats.forEach((m, i) => {
      m.color.copy(this.baseColors[i]).multiplyScalar(1 - this.slump * 0.55);
      m.emissive.setRGB(this.highlight * 0.35, this.highlight * 0.25, this.highlight * 0.08);
    });
    this.glow.intensity += (this.glowTarget * 4 - this.glow.intensity) * k;
    (this.tag.material as THREE.SpriteMaterial).opacity = this.dead ? 0.5 : 1;

    if (this.bubble) {
      const left = this.bubbleUntil - now;
      this.bubble.material.opacity = Math.max(0, Math.min(1, left));
      if (left <= 0) {
        this.group.remove(this.bubble);
        this.bubble.material.map?.dispose();
        this.bubble = null;
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.tag.material.map?.dispose();
  }
}
