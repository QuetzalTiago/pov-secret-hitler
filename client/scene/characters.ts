// Procedural low-poly patrons. Original designs: coats, faces and hats vary by seat.
import * as THREE from 'three';
import { textSprite } from './textures';

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

  constructor(public seat: number, styleIndex: number) {
    const coat = mat(COATS[styleIndex % COATS.length]);
    const skin = mat(SKINS[(styleIndex * 3) % SKINS.length], 0.6);
    const dark = mat(0x1a1410, 0.6);
    const shirt = mat(0xd8d0c0);
    this.mats.push(coat, skin, dark, shirt);

    // Torso: tapered coat with a shirt V and lapels.
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.62, 7), coat);
    torso.position.y = 0.86;
    const chest = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 3), shirt);
    chest.position.set(0, 0.98, 0.2);
    chest.rotation.set(-0.12 + Math.PI, 0, 0);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.17, 0.02), mat(styleIndex % 2 ? 0x8a1a1a : 0x1a2a4a));
    tie.position.set(0, 0.99, 0.235);
    tie.rotation.x = -0.12;
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.26), coat);
    shoulders.position.y = 1.13;
    // Arms reaching to the table.
    for (const side of [-1, 1]) {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.34, 0.12), coat);
      upper.position.set(side * 0.3, 0.98, 0.08);
      upper.rotation.x = -0.6;
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.34), coat);
      fore.position.set(side * 0.27, 0.84, 0.32);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.11), skin);
      hand.position.set(side * 0.24, 0.81, 0.52);
      this.body.add(upper, fore, hand);
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), skin);
    neck.position.y = 1.22;
    this.body.add(torso, chest, tie, shoulders, neck);

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
    if (styleIndex % 4 === 1) {
      const stache = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.02), dark);
      stache.position.set(0, -0.042, 0.145);
      this.head.add(stache);
    }
    if (styleIndex % 5 === 2) {
      const beard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.1), dark);
      beard.position.set(0, -0.11, 0.08);
      this.head.add(beard);
    }
    this.addHat(HATS[styleIndex % HATS.length], styleIndex);
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

  setTeamGlow(on: boolean) {
    this.glowTarget = on ? 1 : 0;
  }

  update(dt: number, now: number) {
    const t = now + this.phase;
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
