// Renderer, bar environment, lighting, camera look/shake, and table layout math.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { disposeObject } from './dispose';
import { handGeometry } from './hands';
import { AdaptiveQuality, readGraphicsPref, type GraphicsMode, type QualityStep } from './quality';
import { ease, sequence, tween, type Tween } from './tween';
import {
  feltTexture, glowTexture, markSharedTexture, plankTexture, smokeTexture, textSprite, wallTexture, woodTexture,
} from './textures';

export const TABLE_Y = 0.78;
const LAMP_WARM = new THREE.Color(0xffa65a);
const LAMP_HOT = new THREE.Color(0xff5a3a);
/** Bloom threshold (linear radiance): lit white cards under the lamp reach ~7, so only emissives above that (the bulb) bloom. */
const BLOOM_THRESHOLD = 9;
/** Lamp bulb emissive intensity; boosted 6x with fx on so it still clears the bloom threshold. */
const BULB_GLOW = 4;

let propEnv: THREE.Texture | null = null;

// Low-intensity reflections for metal/glossy props only; we do NOT set scene.environment because it would flat-light the whole dark bar.
export function glossy<T extends THREE.MeshStandardMaterial>(m: T, intensity = 0.3): T {
  if (propEnv) {
    m.envMap = propEnv;
    m.envMapIntensity = intensity;
  }
  return m;
}
const EYE_Y = 1.27;
/** Your own hands read small up close next to the patrons' at a distance; scale them up a little. */
const OWN_HAND_SCALE = 1.2;
/** With a free cursor the view turns toward it: yaw/pitch (rad) at the screen edge, around this resting pitch. */
const FOLLOW_YAW = 0.7;
const FOLLOW_PITCH = 0.32;
const BASE_PITCH = -0.36;
/** Captured mouse: radians turned per pixel of movement, and the clamped yaw/pitch range. */
const LOOK_SENS = 0.0022;
const YAW_LIMIT = 1.35;
const PITCH_MIN = -0.55;
const PITCH_MAX = 0.5;

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
  /** Held (> 0) while a tween owns the object; see tween.ts. */
  hold = 0;
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
    if (this.hold > 0) return; // a running tween owns the object
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
  /** Post-processing on (bloom + vignette); off with ?fx=0 or ?perf=low. */
  readonly fx: boolean;
  private readonly bulbGlow: number;
  private composer?: EffectComposer;
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
  private chairs = new Map<number, THREE.Group>();
  private ember: THREE.MeshStandardMaterial | null = null;
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
  private dangerLevel = 0;
  private dangerPhase = 0;
  punch = 0;
  private punchAt = new THREE.Vector3();
  private punchSeq: Tween | null = null;
  private flashSprite: THREE.Sprite;
  private flashLife = 0;
  private flashAge = 0;
  private puffs: { s: THREE.Sprite; v: THREE.Vector3; spin: number; life: number; age: number; seq: number }[] = [];
  private puffSeq = 0;
  private time = 0;
  private quality = new AdaptiveQuality(window.devicePixelRatio, readGraphicsPref());
  mouse = new THREE.Vector2(0, 0);

  constructor(container: HTMLElement) {
    // No preserveDrawingBuffer: nothing reads the canvas back, and keeping it forces an extra copy per frame.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality.current.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = this.quality.current.shadows;
    // Plain PCF: PCFSoft samples the shadow map many more times on every shadowed pixel.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // Keep renderer.info covering the whole frame (scene + post passes); render() resets it.
    this.renderer.info.autoReset = false;
    const q = new URLSearchParams(location.search);
    // Software GL (SwiftShader, llvmpipe) can't afford the bloom chain: seconds per frame.
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const glName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    const software = /swiftshader|llvmpipe|software/i.test(glName);
    this.fx = q.get('fx') !== '0' && q.get('perf') !== 'low' && (q.get('fx') === '1' || !software);
    this.bulbGlow = this.fx ? BULB_GLOW * 6 : BULB_GLOW;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    propEnv = markSharedTexture(pmrem.fromScene(env, 0.04).texture);
    env.dispose();
    pmrem.dispose();
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 60);
    this.scene.add(this.camera);
    if (this.fx) this.composer = this.buildComposer();
    this.scene.background = new THREE.Color(0x070504);
    this.scene.fog = new THREE.FogExp2(0x0d0907, 0.085);

    this.ambient = new THREE.HemisphereLight(0x9a6848, 0x1c0e06, 0.55);
    this.scene.add(this.ambient);

    this.lamp = new THREE.SpotLight(0xffa65a, 60, 9, Math.PI / 3.2, 0.55, 1.6);
    this.lamp.position.set(0, 2.55, 0);
    this.lamp.target.position.set(0, TABLE_Y, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.bias = -0.0008;
    this.scene.add(this.lamp, this.lamp.target);

    this.fill = new THREE.PointLight(0xff7a3a, 7, 12, 1.6);
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

    // Pooled shot sprites, hidden (no draw call) until flash().
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,220,160'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.flashSprite.visible = false;
    this.scene.add(this.flashSprite);
    const puffMat = new THREE.SpriteMaterial({ map: smokeTexture(), transparent: true, depthWrite: false, color: 0xcfc4b4 });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(puffMat.clone());
      s.visible = false;
      this.scene.add(s);
      this.puffs.push({ s, v: new THREE.Vector3(), spin: 0, life: 0, age: 0, seq: 0 });
    }

    // Hanging lamp shade + bulb.
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.32, 18, 1, true),
      glossy(new THREE.MeshStandardMaterial({ color: 0x1d3a26, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5 }), 0.4),
    );
    shade.position.set(0, 2.62, 0);
    this.lampBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffb060, emissiveIntensity: this.bulbGlow }),
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
        this.targetYaw = THREE.MathUtils.clamp(this.targetYaw - e.movementX * LOOK_SENS, -YAW_LIMIT, YAW_LIMIT);
        this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - e.movementY * LOOK_SENS, PITCH_MIN, PITCH_MAX);
        return;
      }
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.freezeLook) return;
      this.targetYaw = -this.mouse.x * FOLLOW_YAW;
      this.targetPitch = this.mouse.y * FOLLOW_PITCH;
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

  /** True while the view turns toward a free cursor, so where an object appears depends on where the cursor is. */
  get followsCursor(): boolean {
    return !this.locked && !this.freezeLook;
  }

  private probeCam = new THREE.PerspectiveCamera();

  /** Projects `p` into `out` (NDC) as seen once the view has settled on a free cursor at `ndc`; no shake. */
  projectFollowing(p: THREE.Vector3, ndc: THREE.Vector2, out: THREE.Vector3): THREE.Vector3 {
    const cam = this.probeCam;
    cam.projectionMatrix.copy(this.camera.projectionMatrix);
    cam.position.copy(this.camera.position);
    cam.rotation.set(BASE_PITCH + ndc.y * FOLLOW_PITCH, -ndc.x * FOLLOW_YAW, 0, 'YXZ');
    cam.updateMatrixWorld();
    return out.copy(p).project(cam);
  }

  /** Mouse movement (px) that, while the mouse is captured, turns the view until `p` is under the crosshair. */
  lookMovementTo(p: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    const d = p.clone().sub(this.camera.position);
    const yaw = THREE.MathUtils.clamp(Math.atan2(-d.x, -d.z), -YAW_LIMIT, YAW_LIMIT);
    const pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)) - BASE_PITCH, PITCH_MIN, PITCH_MAX);
    return out.set((this.targetYaw - yaw) / LOOK_SENS, (this.targetPitch - pitch) / LOOK_SENS);
  }

  /** Where the player is aiming, in normalised device coordinates. */
  aimNdc(): THREE.Vector2 {
    return this.locked ? new THREE.Vector2(0, 0) : this.mouse;
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }

  private buildComposer() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // MSAA target: the canvas antialias no longer applies once we render offscreen.
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Threshold is in linear HDR radiance, set above lamp-lit surfaces so only the bulb blooms.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, BLOOM_THRESHOLD));
    composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null }, darkness: { value: 0.45 }, offset: { value: 1.0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float darkness; uniform float offset; varying vec2 vUv;
          void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            float d = length((vUv - 0.5) * vec2(offset));
            c.rgb *= 1.0 - darkness * smoothstep(0.35, 0.85, d);
            gl_FragColor = c;
          }`,
      }),
    );
    composer.addPass(new OutputPass());
    return composer;
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
      wall.receiveShadow = true;
      room.add(wall);
    }
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshStandardMaterial({ color: 0x140c08, roughness: 1 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = H;
    room.add(ceiling);

    // Back bar: counter, shelves, bottles, neon sign.
    const counterWood = glossy(new THREE.MeshStandardMaterial({ map: woodTexture('#3b2210', '#1c0e05', 'counter', 2), roughness: 0.6 }), 0.15);
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
          glossy(new THREE.MeshStandardMaterial({
            color: bottleColors[(b + row) % bottleColors.length],
            roughness: 0.15,
            metalness: 0.1,
            transparent: true,
            opacity: 0.85,
            emissive: bottleColors[(b + row) % bottleColors.length],
            emissiveIntensity: 0.15,
          }), 0.35),
        );
        bottle.position.set(-2.6 + b * 0.25, 1.48 + row * 0.55 + h / 2, -4.85);
        room.add(bottle);
      }
    }
    const neon = textSprite('povsecrethitler.app', { color: '#ff6fae', size: 64 });
    const neonMat = new THREE.SpriteMaterial({ map: neon.texture, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true, depthWrite: false });
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
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.78, 6), glossy(new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.4 }), 0.5));
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

  chairObject(seat: number): THREE.Group | null {
    return this.chairs.get(seat) ?? null;
  }

  /** Rebuilds table and chairs for a player count, placing your seat nearest the camera. */
  setLayout(n: number, me: number) {
    const count = Math.max(n, 5);
    if (this.layout.n === count && this.layout.me === me && this.tableGroup.children.length) return;
    this.layout = new Layout(count, me);
    disposeObject(this.tableGroup, { keep: [this.sleeve] });
    this.tableGroup.clear();
    this.chairs.clear();
    const L = this.layout;
    const wood = glossy(new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 }), 0.15);
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
      glossy(new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.6, roughness: 0.3 }), 0.5),
    );
    ash.position.set(L.rx * 0.62, TABLE_Y + 0.017, -L.rz * 0.15);
    this.ember = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a1a, emissiveIntensity: 2.5 });
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), this.ember);
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
      this.chairs.set(s, chair);
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
      // The camera looks toward -Z, so the yaw below mirrors local X: flip the side to keep the thumb on the inner side.
      const hand = new THREE.Mesh(handGeometry('flat', -side as 1 | -1), skin);
      hand.scale.setScalar(OWN_HAND_SCALE);
      hand.position.copy(wrist).addScaledVector(dir, 0.05).setY(TABLE_Y + 0.02 * OWN_HAND_SCALE); // palm bottom on the table
      hand.rotation.y = Math.atan2(dir.x, dir.z);
      for (const m of [upper, fore, hand]) {
        m.castShadow = true;
        this.tableGroup.add(m);
      }
      if (side === 1) this.restRightArm = [upper, fore, hand]; // your right (+X): the gun hand
      else this.restLeftArm = [upper, fore, hand];
    }
    this.camera.position.copy(L.eye());
  }

  private restRightArm: THREE.Mesh[] = [];
  private restLeftArm: THREE.Mesh[] = [];
  private handsUpTarget = 0;
  private handsUpAmount = 0;
  private handsUp: { fore: THREE.Mesh; hand: THREE.Mesh; side: 1 | -1 }[] | null = null;
  private readonly hu = {
    elbow: new THREE.Vector3(),
    grip: new THREE.Vector3(),
    elbowW: new THREE.Vector3(),
    gripW: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    q: new THREE.Quaternion(),
    // Flat hand (fingers +Z, palm down) -> fingers up, palm facing away from the camera.
    handQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)),
  };
  private ownArm: { fore: THREE.Mesh; hand: THREE.Mesh; finger: THREE.Mesh } | null = null;

  /**
   * Raises your right arm from below the view: onto the revolver's grip (`gun`), or pointing at a
   * world position (`point`). Null puts the arm back on the table.
   */
  setOwnArm(pose: { gun: THREE.Object3D } | { point: THREE.Vector3 } | null) {
    if (!this.ownArm) {
      const skin = new THREE.MeshStandardMaterial({ color: 0xc69476, roughness: 0.7 });
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.085, 1, 0.08), this.sleeve);
      const handGeo = handGeometry('fist', -1); // a right fist, knuckles at +Z; turned to look down -Z
      handGeo.rotateY(Math.PI);
      const hand = new THREE.Mesh(handGeo, skin);
      hand.scale.setScalar(OWN_HAND_SCALE); // the finger is a child, so it scales along
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.06, 2, 6).rotateX(Math.PI / 2), skin);
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

  /** Surrender: both hands rise into view, palms forward (the revolver is aimed at you). Call after setOwnArm. */
  setOwnHandsUp(on: boolean) {
    this.handsUpTarget = on ? 1 : 0;
    this.applyHandsUpVisibility();
  }

  /** While the hands are up the table arms are hidden; once down, the left one is back (setOwnArm owns the right). */
  private applyHandsUpVisibility() {
    const up = this.handsUpAmount > 0.02;
    if (up) for (const m of this.restRightArm) m.visible = false;
    for (const m of this.restLeftArm) m.visible = !up;
    if (this.handsUp) for (const a of this.handsUp) a.fore.visible = a.hand.visible = up;
  }

  private updateOwnHandsUp(dt: number) {
    this.handsUpAmount += (this.handsUpTarget - this.handsUpAmount) * (1 - Math.exp(-7 * dt));
    if (this.handsUpAmount > 0.02 && !this.handsUp) {
      const skin = new THREE.MeshStandardMaterial({ color: 0xc69476, roughness: 0.7 });
      this.handsUp = ([-1, 1] as const).map((side) => {
        const fore = new THREE.Mesh(new THREE.BoxGeometry(0.085, 1, 0.08), this.sleeve);
        const hand = new THREE.Mesh(handGeometry('flat', -side as 1 | -1), skin); // thumb toward the midline once turned palm-out
        hand.scale.setScalar(OWN_HAND_SCALE);
        this.scene.add(fore, hand);
        return { fore, hand, side };
      });
    }
    this.applyHandsUpVisibility();
    if (!this.handsUp || this.handsUpAmount <= 0.02) return;
    const { elbow, grip, elbowW, gripW, dir, up, q, handQ } = this.hu;
    const a = this.handsUpAmount;
    const e = a * a * (3 - 2 * a);
    this.camera.updateMatrixWorld();
    for (const { fore, hand, side } of this.handsUp) {
      // Camera space; lowered, both joints sit below the view.
      elbow.set(side * 0.32, -1.0 + 0.45 * e, -0.3);
      grip.set(side * 0.26, -1.0 + 0.82 * e, -0.5);
      elbowW.copy(elbow).applyMatrix4(this.camera.matrixWorld);
      gripW.copy(grip).applyMatrix4(this.camera.matrixWorld);
      fore.position.copy(elbowW).add(gripW).multiplyScalar(0.5);
      // As setOwnArm: orient in camera space, then apply the camera rotation so the arm turns with your view.
      dir.copy(grip).sub(elbow);
      const len = dir.length();
      fore.quaternion.copy(this.camera.quaternion).multiply(q.setFromUnitVectors(up, dir.divideScalar(len)));
      fore.scale.set(1, len + 0.04, 1);
      hand.position.copy(gripW);
      hand.quaternion.copy(this.camera.quaternion).multiply(handQ);
    }
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

  flash(at: THREE.Vector3, dir?: THREE.Vector3) {
    this.muzzle.position.copy(at);
    this.muzzle.intensity = 60;
    this.flashSprite.position.copy(at);
    this.flashSprite.scale.setScalar(0.45);
    this.flashSprite.material.rotation = Math.random() * Math.PI * 2;
    this.flashSprite.material.opacity = 1;
    this.flashSprite.visible = true;
    this.flashLife = 0.07;
    this.flashAge = 0;
    for (let i = 0; i < 4; i++) {
      // Reuse a free puff, else the oldest.
      let p = this.puffs[0];
      for (const q of this.puffs) if (q.age >= q.life ? p.age < p.life || q.seq < p.seq : p.age < p.life && q.seq < p.seq) p = q;
      const sp = 0.35 + Math.random() * 0.25;
      if (dir) p.v.copy(dir).multiplyScalar(sp);
      else p.v.set(0, 0, 0);
      p.v.x += (Math.random() - 0.5) * 0.1;
      p.v.y += 0.08 + Math.random() * 0.07;
      p.v.z += (Math.random() - 0.5) * 0.1;
      p.s.position.copy(at);
      p.s.scale.setScalar(0.08);
      p.s.material.rotation = Math.random() * Math.PI * 2;
      p.s.material.opacity = 0.55;
      p.s.visible = true;
      p.spin = (Math.random() - 0.5) * 0.8;
      p.life = 1.1 + Math.random() * 0.4;
      p.age = 0;
      p.seq = ++this.puffSeq;
    }
  }

  /** Brief camera push toward a point (the victim) and back. */
  punchIn(at: THREE.Vector3) {
    this.punchAt.copy(at);
    this.punchSeq?.cancel();
    this.punchSeq = sequence([
      () => tween<World>(this, { punch: 1 }, { dur: 0.12, ease: ease.outQuad }),
      () => tween<World>(this, { punch: 1 }, { dur: 0.35 }),
      () => tween<World>(this, { punch: 0 }, { dur: 0.7, ease: ease.inOutCubic }),
    ]);
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
    const basePitch = BASE_PITCH;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 0.06;
    let camX = eye.x;
    let camY = eye.y + Math.sin(t * 0.9) * 0.004;
    let camZ = eye.z;
    let camPitch = basePitch + this.pitch;
    let camYaw = baseYaw + this.yaw;
    let fov = 68;
    if (this.punch > 0) {
      const dx = this.punchAt.x - camX;
      const dy = this.punchAt.y - camY;
      const dz = this.punchAt.z - camZ;
      const flat = Math.hypot(dx, dz);
      const dist = Math.hypot(flat, dy) || 1;
      const step = (0.22 * this.punch) / dist;
      camX += dx * step;
      camY += dy * step;
      camZ += dz * step;
      // Camera looks down -Z at yaw 0 and yaw turns it toward -X.
      let dyaw = Math.atan2(-dx, -dz) - camYaw;
      dyaw -= Math.PI * 2 * Math.round(dyaw / (Math.PI * 2));
      camYaw += dyaw * 0.6 * this.punch;
      camPitch += (Math.atan2(dy, flat) - camPitch) * 0.6 * this.punch;
      fov = 68 - 14 * this.punch;
    }
    if (fov !== this.camera.fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(camX + (Math.random() - 0.5) * sh, camY + (Math.random() - 0.5) * sh, camZ);
    this.camera.rotation.set(
      camPitch + (Math.random() - 0.5) * sh * 0.8,
      camYaw + (Math.random() - 0.5) * sh * 0.8,
      (Math.random() - 0.5) * sh * 0.4,
      'YXZ',
    );

    // Lighting: night drop, tension, flicker.
    this.night += (this.nightTarget - this.night) * (1 - Math.exp(-2.5 * dt));
    this.dangerLevel += (this.danger - this.dangerLevel) * (1 - Math.exp(-2 * dt));
    this.dangerPhase += dt * (2 + 5 * this.dangerLevel);
    const danger = this.dangerLevel;
    const flicker = 1 - (Math.sin(t * 13.7) * Math.sin(t * 7.3) > 0.93 ? 0.35 : 0) * (0.3 + danger) - Math.random() * 0.03 * (1 + danger * 4);
    const lit = 1 - this.night * 0.93;
    this.lamp.intensity = 60 * lit * flicker;
    this.fill.intensity = 7 * lit;
    this.ambient.intensity = 0.55 * (1 - this.night * 0.85);
    this.handLight.intensity = 0.9 * (1 - this.night * 0.6);
    this.lamp.color.copy(LAMP_WARM).lerp(LAMP_HOT, Math.min(1, this.tension * 0.6 + danger * 0.3));
    // Boost only while the bloom pass runs (render() skips the composer on steps without shadows).
    const glow = this.composer && this.quality.current.shadows ? this.bulbGlow : BULB_GLOW;
    (this.lampBulb.material as THREE.MeshStandardMaterial).emissiveIntensity = glow * lit * flicker;
    if (this.ember) this.ember.emissiveIntensity = 2.2 + Math.sin(t * 2.3) * 0.5 + Math.sin(t * 5.1) * 0.25;
    this.redLight.intensity = danger * (3 + Math.sin(this.dangerPhase) * 1.5) + this.night * 0;
    this.muzzle.intensity *= Math.exp(-dt * 14);

    if (this.flashSprite.visible) {
      this.flashAge += dt;
      const k = this.flashAge / this.flashLife;
      if (k >= 1) this.flashSprite.visible = false;
      else {
        this.flashSprite.scale.setScalar(0.45 + 0.15 * k);
        this.flashSprite.material.opacity = 1 - k;
      }
    }
    for (const p of this.puffs) {
      if (!p.s.visible) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.s.visible = false;
        continue;
      }
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(0.08 + 0.37 * ease.outQuad(k));
      p.s.material.rotation += p.spin * dt;
      p.s.material.opacity = 0.55 * (1 - k);
    }

    for (const p of this.smoke) {
      p.s.position.addScaledVector(p.v, dt);
      p.s.material.rotation += p.spin * dt;
      if (p.s.position.y > 3.4) p.s.position.y = 1.3;
      if (Math.abs(p.s.position.x) > 4) p.v.x *= -1;
      if (Math.abs(p.s.position.z) > 4) p.v.z *= -1;
    }
    this.updateOwnHandsUp(dt);
    for (const m of this.movers) m.update(dt);
  }

  get graphicsMode(): GraphicsMode {
    return this.quality.mode;
  }

  setGraphicsMode(mode: GraphicsMode) {
    this.applyQuality(this.quality.setMode(mode));
  }

  private applyQuality(step: QualityStep) {
    this.renderer.setPixelRatio(step.pixelRatio);
    this.composer?.setPixelRatio(step.pixelRatio);
    // Turning the light's shadow off changes the light state, so lit materials recompile without it.
    this.lamp.castShadow = step.shadows;
    this.renderer.shadowMap.enabled = step.shadows;
  }

  /** `frameMs` is the wall time since the last frame; in auto mode slow machines get a lower render scale. */
  render(frameMs = 0) {
    this.renderer.info.reset();
    const step = this.quality.frame(frameMs);
    if (step) {
      console.info(`[render] steady frames are slow; dropping to pixel ratio ${step.pixelRatio}${step.shadows ? '' : ', no shadows'}`);
      this.applyQuality(step);
    }
    // The lowest step (no shadows) also skips post-processing.
    if (this.composer && this.quality.current.shadows) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
