// Renderer, bar environment, lighting, camera look/shake, and table layout math.
import * as THREE from 'three';
import {
  feltTexture, glowTexture, plankTexture, smokeTexture, textSprite, wallTexture, woodTexture,
} from './textures';

export const TABLE_Y = 0.78;
const EYE_Y = 1.27;

/** Seat geometry around an elliptical table. Your own seat is always nearest the camera. */
export class Layout {
  rx: number;
  rz: number;
  constructor(public n: number, public me: number) {
    this.rx = 1.25 + Math.max(n, 5) * 0.075;
    this.rz = this.rx * 0.68;
  }
  angle(seat: number): number {
    const r = (seat - this.me + this.n) % this.n;
    return Math.PI / 2 + (r * Math.PI * 2) / this.n;
  }
  /** Rotation about Y that makes an object's -Z face the table center from this seat. */
  yaw(seat: number): number {
    return Math.PI / 2 - this.angle(seat);
  }
  chair(seat: number): THREE.Vector3 {
    const a = this.angle(seat);
    return new THREE.Vector3((this.rx + 0.42) * Math.cos(a), 0, (this.rz + 0.42) * Math.sin(a));
  }
  /** A point on the table in front of a seat; `right` and `fwd` are in that player's frame. */
  front(seat: number, right = 0, fwd = 0, inset = 0.8): THREE.Vector3 {
    const a = this.angle(seat);
    const base = new THREE.Vector3(this.rx * inset * Math.cos(a), TABLE_Y + 0.004, this.rz * inset * Math.sin(a));
    const f = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
    const r = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    return base.addScaledVector(r, right).addScaledVector(f, fwd);
  }
  head(seat: number): THREE.Vector3 {
    return this.chair(seat).setY(1.32);
  }
  eye(): THREE.Vector3 {
    return new THREE.Vector3(0, EYE_Y, this.rz + 0.36);
  }
}

/** Smoothly drives an object toward a target transform every frame. */
export class Mover {
  pos = new THREE.Vector3();
  quat = new THREE.Quaternion();
  scale = 1;
  visible = true;
  speed = 9;
  hideOnArrive = false;
  constructor(public obj: THREE.Object3D) {
    this.pos.copy(obj.position);
    this.quat.copy(obj.quaternion);
  }
  set(pos: THREE.Vector3, quat?: THREE.Quaternion, speed?: number) {
    this.pos.copy(pos);
    if (quat) this.quat.copy(quat);
    if (speed !== undefined) this.speed = speed;
    return this;
  }
  snap() {
    this.obj.position.copy(this.pos);
    this.obj.quaternion.copy(this.quat);
    this.obj.scale.setScalar(this.scale);
  }
  update(dt: number) {
    const k = 1 - Math.exp(-this.speed * dt);
    this.obj.position.lerp(this.pos, k);
    this.obj.quaternion.slerp(this.quat, k);
    const s = this.obj.scale.x + (this.scale - this.obj.scale.x) * k;
    this.obj.scale.setScalar(s);
    if (this.hideOnArrive && this.obj.position.distanceTo(this.pos) < 0.02) this.obj.visible = false;
    else if (!this.hideOnArrive) this.obj.visible = this.visible;
  }
}

/** A box spanning two points (slightly overlapping the joints so limbs never show gaps). */
export function boxLimb(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b) + Math.min(w, d) * 0.8;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export function yawQuat(yaw: number, extraX = 0, extraZ = 0): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(extraX, yaw, extraZ, 'YXZ'));
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  layout = new Layout(5, 0);
  movers = new Set<Mover>();
  lamp: THREE.SpotLight;
  lampBulb: THREE.Mesh;
  fill: THREE.PointLight;
  ambient: THREE.HemisphereLight;
  redLight: THREE.PointLight;
  muzzle: THREE.PointLight;
  handLight: THREE.PointLight;
  private tableGroup = new THREE.Group();
  private sleeve = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.8 });
  private armband: THREE.Mesh | null = null;
  private hitlerOutfit = false;
  private smoke: { s: THREE.Sprite; v: THREE.Vector3; spin: number }[] = [];
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private shake = 0;
  night = 0;
  nightTarget = 0;
  tension = 0;
  danger = 0;
  private time = 0;
  mouse = new THREE.Vector2(0, 0);

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 60);
    this.scene.add(this.camera);
    this.scene.background = new THREE.Color(0x070504);
    this.scene.fog = new THREE.FogExp2(0x0d0907, 0.085);

    this.ambient = new THREE.HemisphereLight(0x8a6a50, 0x1a0f08, 0.55);
    this.scene.add(this.ambient);

    this.lamp = new THREE.SpotLight(0xffb46a, 60, 9, Math.PI / 3.2, 0.55, 1.6);
    this.lamp.position.set(0, 2.55, 0);
    this.lamp.target.position.set(0, TABLE_Y, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.bias = -0.0008;
    this.scene.add(this.lamp, this.lamp.target);

    this.fill = new THREE.PointLight(0xff8a4a, 6, 12, 1.6);
    this.fill.position.set(-3.2, 2.2, -3.4);
    this.scene.add(this.fill);

    this.redLight = new THREE.PointLight(0xff2010, 0, 6, 1.5);
    this.redLight.position.set(0, 2.0, 0);
    this.scene.add(this.redLight);

    // Soft light near the camera so cards held in hand stay readable.
    this.handLight = new THREE.PointLight(0xffe2b8, 0.9, 1.2, 1.5);
    this.handLight.position.set(0, 0.25, 0.1);
    this.camera.add(this.handLight);

    this.muzzle = new THREE.PointLight(0xffd8a0, 0, 8, 1.4);
    this.scene.add(this.muzzle);

    // Hanging lamp shade + bulb.
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.32, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1d3a26, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5 }),
    );
    shade.position.set(0, 2.62, 0);
    this.lampBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffc070, emissiveIntensity: 3 }),
    );
    this.lampBulb.position.set(0, 2.52, 0);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.2), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    cord.position.set(0, 3.38, 0);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
    glow.scale.setScalar(1.1);
    glow.position.set(0, 2.5, 0);
    this.scene.add(shade, this.lampBulb, cord, glow);

    this.buildRoom();
    this.scene.add(this.tableGroup);
    this.buildSmoke();
    this.setLayout(5, 0);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      if (this.locked) {
        // Captured mouse: relative look, clamped like a seated head turn.
        this.targetYaw = THREE.MathUtils.clamp(this.targetYaw - e.movementX * 0.0022, -1.35, 1.35);
        this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - e.movementY * 0.0022, -0.55, 0.5);
        return;
      }
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.freezeLook) return;
      this.targetYaw = -this.mouse.x * 0.7;
      this.targetPitch = this.mouse.y * 0.32;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.renderer.domElement;
      this.onLockChange(this.locked);
    });
  }

  /** True while the mouse is captured (cursor hidden, aiming with the centre crosshair). */
  locked = false;
  /** Disable capture with ?nolock (tests) or in browsers without pointer lock. */
  lockAllowed = !new URLSearchParams(location.search).has('nolock') && 'requestPointerLock' in HTMLElement.prototype;
  onLockChange: (locked: boolean) => void = () => {};
  /** Holds the view still while the free cursor picks a card. */
  freezeLook = false;

  requestLock() {
    if (!this.lockAllowed || this.locked) return;
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown;
      if (p instanceof Promise) p.catch(() => {});
    } catch {
      /* not allowed right now */
    }
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  /** Where the player is aiming, in normalised device coordinates. */
  aimNdc(): THREE.Vector2 {
    return this.locked ? new THREE.Vector2(0, 0) : this.mouse;
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private buildRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
    const room = new THREE.Group();
    const W = 10;
    const H = 3.6;
    for (let i = 0; i < 4; i++) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
      wall.position.set(Math.sin((i * Math.PI) / 2) * (W / 2), H / 2, Math.cos((i * Math.PI) / 2) * (W / 2));
      wall.rotation.y = (i * Math.PI) / 2 + Math.PI;
      room.add(wall);
    }
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshStandardMaterial({ color: 0x140c08, roughness: 1 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = H;
    room.add(ceiling);

    // Back bar: counter, shelves, bottles, neon sign.
    const counterWood = new THREE.MeshStandardMaterial({ map: woodTexture('#3b2210', '#1c0e05', 'counter', 2), roughness: 0.6 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.05, 0.7), counterWood);
    counter.position.set(0, 0.52, -4.2);
    counter.castShadow = counter.receiveShadow = true;
    room.add(counter);
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x24140a, roughness: 0.7 });
    const bottleColors = [0x3f6b2a, 0x7a3b12, 0x8c8f99, 0x5a1a14, 0x2d4b6b, 0xa2742a];
    for (let row = 0; row < 3; row++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.05, 0.3), shelfMat);
      shelf.position.set(0, 1.45 + row * 0.55, -4.85);
      room.add(shelf);
      for (let b = 0; b < 22; b++) {
        if ((b * 7 + row * 3) % 5 === 0) continue;
        const h = 0.22 + ((b * 13 + row) % 5) * 0.04;
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.045, h, 8),
          new THREE.MeshStandardMaterial({
            color: bottleColors[(b + row) % bottleColors.length],
            roughness: 0.15,
            metalness: 0.1,
            transparent: true,
            opacity: 0.85,
            emissive: bottleColors[(b + row) % bottleColors.length],
            emissiveIntensity: 0.15,
          }),
        );
        bottle.position.set(-2.6 + b * 0.25, 1.48 + row * 0.55 + h / 2, -4.85);
        room.add(bottle);
      }
    }
    const neon = textSprite('povsecrethitler.app', { color: '#ff6fae', size: 64 });
    const neonMat = new THREE.SpriteMaterial({ map: neon.texture, transparent: true, depthWrite: false });
    const sign = new THREE.Sprite(neonMat);
    sign.scale.set(2.2, 2.2 / neon.aspect, 1);
    sign.position.set(0, 2.95, -4.6);
    room.add(sign);
    const neonLight = new THREE.PointLight(0xff4f9a, 2.5, 5, 1.5);
    neonLight.position.set(0, 3.0, -4.5);
    room.add(neonLight);
    // A few empty stools and a dartboard-ish clock on the side wall.
    for (let i = 0; i < 5; i++) {
      const stool = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x5a1f18, roughness: 0.6 }));
      seat.position.y = 0.78;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.78, 6), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.4 }));
      leg.position.y = 0.39;
      stool.add(seat, leg);
      stool.position.set(-2.4 + i * 1.2, 0, -3.5);
      room.add(stool);
    }
    const clock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.05, 24),
      new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.6 }),
    );
    clock.rotation.z = Math.PI / 2;
    clock.position.set(4.95, 2.4, -1);
    room.add(clock);
    this.scene.add(room);
  }

  private buildSmoke() {
    const mat = new THREE.SpriteMaterial({ map: smokeTexture(), transparent: true, depthWrite: false, opacity: 0.12, color: 0xd8c8b0 });
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.scale.setScalar(1.2 + Math.random() * 1.8);
      s.position.set((Math.random() - 0.5) * 7, 1.4 + Math.random() * 1.8, (Math.random() - 0.5) * 7);
      s.material.rotation = Math.random() * Math.PI;
      this.scene.add(s);
      this.smoke.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.02 + Math.random() * 0.03, (Math.random() - 0.5) * 0.05), spin: (Math.random() - 0.5) * 0.1 });
    }
  }

  /** Rebuilds table and chairs for a player count, placing your seat nearest the camera. */
  setLayout(n: number, me: number) {
    const count = Math.max(n, 5);
    if (this.layout.n === count && this.layout.me === me && this.tableGroup.children.length) return;
    this.layout = new Layout(count, me);
    this.tableGroup.clear();
    const L = this.layout;
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(L.rx, L.rx, 0.07, 64), wood);
    top.scale.z = L.rz / L.rx;
    top.position.y = TABLE_Y - 0.035;
    top.receiveShadow = top.castShadow = true;
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(L.rx - 0.16, L.rx - 0.16, 0.012, 64),
      new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }),
    );
    felt.scale.z = (L.rz - 0.16) / (L.rx - 0.16);
    felt.position.y = TABLE_Y - 0.002;
    felt.receiveShadow = true;
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.5, TABLE_Y - 0.07, 16), wood);
    pedestal.position.y = (TABLE_Y - 0.07) / 2;
    pedestal.castShadow = true;
    this.tableGroup.add(top, felt, pedestal);

    // Ashtray with a smouldering cigar glow.
    const ash = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.075, 0.035, 14),
      new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.6, roughness: 0.3 }),
    );
    ash.position.set(L.rx * 0.62, TABLE_Y + 0.017, -L.rz * 0.15);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5a1a }));
    ember.position.set(L.rx * 0.62 + 0.05, TABLE_Y + 0.045, -L.rz * 0.15);
    this.tableGroup.add(ash, ember);

    const chairMat = new THREE.MeshStandardMaterial({ map: woodTexture('#3d2414', '#1d0e06', 'chair'), roughness: 0.7 });
    for (let s = 0; s < count; s++) {
      if (s === me) continue;
      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.48), chairMat);
      seat.position.y = 0.48;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.06), chairMat);
      back.position.set(0, 0.86, 0.24);
      chair.add(seat, back);
      for (const [x, z] of [[-0.21, -0.2], [0.21, -0.2], [-0.21, 0.2], [0.21, 0.2]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.05), chairMat);
        leg.position.set(x, 0.24, z);
        chair.add(leg);
      }
      chair.children.forEach((c) => (c.castShadow = true));
      chair.position.copy(L.chair(s));
      chair.rotation.y = L.yaw(s);
      this.tableGroup.add(chair);
    }
    // Your own hands resting on the table edge.
    const skin = new THREE.MeshStandardMaterial({ color: 0xc69476, roughness: 0.7 });
    const sleeve = this.sleeve;
    for (const side of [-1, 1]) {
      // Shoulder (just out of view) -> elbow (off the table edge) -> wrist resting on the table.
      const shoulder = new THREE.Vector3(side * 0.24, 1.0, L.rz + 0.42);
      const elbow = new THREE.Vector3(side * 0.44, 0.83, L.rz + 0.2);
      const wrist = new THREE.Vector3(side * 0.4, TABLE_Y + 0.03, L.rz - 0.07);
      const upper = boxLimb(shoulder, elbow, 0.1, 0.1, sleeve);
      const fore = boxLimb(elbow, wrist, 0.085, 0.075, sleeve);
      if (side === -1) {
        // Armband for when you are Hitler (hidden otherwise).
        const band = boxLimb(elbow.clone().lerp(wrist, 0.25), elbow.clone().lerp(wrist, 0.4), 0.095, 0.085, new THREE.MeshStandardMaterial({ color: 0xa01818, roughness: 0.5 }));
        band.visible = this.hitlerOutfit;
        this.armband = band;
        this.tableGroup.add(band);
      }
      const dir = wrist.clone().sub(elbow).setY(0).normalize();
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.032, 0.11), skin);
      hand.position.copy(wrist).addScaledVector(dir, 0.05).setY(TABLE_Y + 0.017);
      hand.rotation.y = Math.atan2(dir.x, dir.z);
      for (const m of [upper, fore, hand]) {
        m.castShadow = true;
        this.tableGroup.add(m);
      }
      if (side === 1) this.restRightArm = [upper, fore, hand]; // your right (+X): the gun hand
    }
    this.camera.position.copy(L.eye());
  }

  private restRightArm: THREE.Mesh[] = [];
  private ownArm: { fore: THREE.Mesh; hand: THREE.Mesh; finger: THREE.Mesh } | null = null;

  /**
   * Raises your right arm from below the view: onto the revolver's grip (`gun`), or pointing at a
   * world position (`point`). Null puts the arm back on the table.
   */
  setOwnArm(pose: { gun: THREE.Object3D } | { point: THREE.Vector3 } | null) {
    if (!this.ownArm) {
      const skin = new THREE.MeshStandardMaterial({ color: 0xc69476, roughness: 0.7 });
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.085, 1, 0.08), this.sleeve);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.09), skin);
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.022, 0.08), skin);
      finger.position.set(0, 0.02, -0.08); // the hand looks down -Z, so the finger sticks out in front
      hand.add(finger);
      fore.visible = hand.visible = false;
      this.scene.add(fore, hand);
      this.ownArm = { fore, hand, finger };
    }
    const { fore, hand, finger } = this.ownArm;
    fore.visible = hand.visible = !!pose;
    for (const m of this.restRightArm) m.visible = !pose;
    if (!pose) return;
    let grip: THREE.Vector3;
    if ('gun' in pose) {
      pose.gun.updateMatrixWorld();
      grip = pose.gun.localToWorld(new THREE.Vector3(0, -0.03, 0.08));
      hand.quaternion.copy(pose.gun.getWorldQuaternion(new THREE.Quaternion()));
      finger.visible = false;
    } else {
      this.camera.updateMatrixWorld();
      grip = this.camera.localToWorld(new THREE.Vector3(0.15, -0.1, -0.45)); // above the prompt banner
      // Hand faces the target (its -Z axis points at it) with the index finger extended.
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion); // no roll as you look around
      hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(grip, pose.point, camUp));
      finger.visible = true;
    }
    const elbowLocal = new THREE.Vector3(0.34, -0.5, 0.05);
    const elbow = this.camera.localToWorld(elbowLocal.clone());
    const len = elbow.distanceTo(grip);
    fore.position.copy(elbow).add(grip).multiplyScalar(0.5);
    // Orient in camera space, then apply the camera's rotation: the arm turns with your view instead of
    // rolling around its own length (a world-space shortest-arc rotation twists as the camera yaws).
    const dirLocal = this.camera.worldToLocal(grip.clone()).sub(elbowLocal).normalize();
    fore.quaternion.copy(this.camera.quaternion).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirLocal));
    fore.scale.set(1, len + 0.04, 1);
    hand.position.copy(grip);
  }

  /** True once the camera has caught up with the cursor (used by tests before clicking). */
  settled(): boolean {
    return Math.abs(this.targetYaw - this.yaw) < 0.002 && Math.abs(this.targetPitch - this.pitch) < 0.002;
  }

  /** Your own first-person sleeves: uniform and armband when you are Hitler (only your client knows). */
  setOwnOutfit(hitler: boolean) {
    if (hitler === this.hitlerOutfit) return;
    this.hitlerOutfit = hitler;
    this.sleeve.color.set(hitler ? 0x7a6844 : 0x2a2a33);
    if (this.armband) this.armband.visible = hitler;
  }

  setNight(on: boolean) {
    this.nightTarget = on ? 1 : 0;
  }

  addShake(amount: number) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  flash(at: THREE.Vector3) {
    this.muzzle.position.copy(at);
    this.muzzle.intensity = 60;
  }

  track(m: Mover) {
    this.movers.add(m);
    return m;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    // Camera look with clamped yaw/pitch, plus shake.
    const k = 1 - Math.exp(-6 * dt);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    const eye = this.layout.eye();
    const baseYaw = 0;
    const basePitch = -0.36;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 0.06;
    this.camera.position.set(eye.x + (Math.random() - 0.5) * sh, eye.y + Math.sin(t * 0.9) * 0.004 + (Math.random() - 0.5) * sh, eye.z);
    this.camera.rotation.set(
      basePitch + this.pitch + (Math.random() - 0.5) * sh * 0.8,
      baseYaw + this.yaw + (Math.random() - 0.5) * sh * 0.8,
      (Math.random() - 0.5) * sh * 0.4,
      'YXZ',
    );

    // Lighting: night drop, tension, flicker.
    this.night += (this.nightTarget - this.night) * (1 - Math.exp(-2.5 * dt));
    const flicker = 1 - (Math.sin(t * 13.7) * Math.sin(t * 7.3) > 0.93 ? 0.35 : 0) * (0.3 + this.danger) - Math.random() * 0.03 * (1 + this.danger * 4);
    const lit = 1 - this.night * 0.93;
    this.lamp.intensity = 60 * lit * flicker;
    this.fill.intensity = 6 * lit;
    this.ambient.intensity = 0.55 * (1 - this.night * 0.85);
    this.handLight.intensity = 0.9 * (1 - this.night * 0.6);
    const warm = new THREE.Color(0xffb46a);
    this.lamp.color.copy(warm.lerp(new THREE.Color(0xff5a3a), Math.min(1, this.tension * 0.6 + this.danger * 0.3)));
    (this.lampBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 3 * lit * flicker;
    this.redLight.intensity = this.danger * (3 + Math.sin(t * 3) * 1.5) + this.night * 0;
    this.muzzle.intensity *= Math.exp(-dt * 14);

    for (const p of this.smoke) {
      p.s.position.addScaledVector(p.v, dt);
      p.s.material.rotation += p.spin * dt;
      if (p.s.position.y > 3.4) p.s.position.y = 1.3;
      if (Math.abs(p.s.position.x) > 4) p.v.x *= -1;
      if (Math.abs(p.s.position.z) > 4) p.v.z *= -1;
    }
    for (const m of this.movers) m.update(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
