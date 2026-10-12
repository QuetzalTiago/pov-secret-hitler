// Renderer, bar environment, lighting, camera look/shake, and table layout math.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Assets } from './assets';
import { disposeObject } from './dispose';
import { bottlesGeometry, buntingGeometry, hallGlowGeometry, hallPropsGeometry, posterGeometry } from './beerhall';
import { handGeometry } from './hands';
import { riggedHandGeometry } from './ownhands';
import { cuffGeometry, pointingFingerGeometry, sleeveGeometry, unitSleeveGeometry } from './ownbody';
import { cylinderBetween, limbGeometry, mergeParts } from './patron';
import { seatColors } from './palette';
import { AdaptiveQuality, readGraphicsPref, type GraphicsMode, type QualityStep } from './quality';
import { buildBackBar, chairModel, lampModel, stoolModel } from './roomprops';
import { CigaretteSmoke } from './smoke';
import { WAITER_SPOT, Waiter } from './waiter';
import { ease } from './tween';
import { BASE_PITCH, PITCH_MAX, PITCH_MIN, YAW_LIMIT, lookAngles } from './look';
import {
  feltTexture, glowTexture, markSharedTexture, plankTexture, posterAtlas, signTexture, smokeTexture, wallTexture, woodTexture,
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
/** Strength of the HDRI image-based light: kept faint so the bar stays dark and the pendant lamp is the key light. */
const ENV_INTENSITY = 0.06;
/** Strength of the hemisphere ambient light before the night dimming. */
const AMBIENT_INTENSITY = 0.12;
/** Strength of the warm fill point light before the lit factor. */
const FILL_INTENSITY = 1.5;
const EYE_Y = 1.27;
/** Your own hands read small up close next to the patrons' at a distance; scale them up a little. */
const OWN_HAND_SCALE = 1.2;
/** Sleeve radii of your own arms: shoulder, elbow, wrist. */
const SLEEVE_R = { shoulder: 0.055, elbow: 0.05, wrist: 0.04 };
/** With a free cursor the view turns toward it: yaw/pitch (rad) at the screen edge, around this resting pitch. */
const FOLLOW_YAW = 1.05;
const FOLLOW_PITCH = 0.32;
/** Captured mouse: radians turned per pixel of movement (the clamped range lives in look.ts). */
const LOOK_SENS = 0.0022;
/** Keyboard look speed (rad/s). */
const KEY_LOOK = 1.6;
const clampLook = THREE.MathUtils.clamp;

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
  private room = new THREE.Group();
  private assets: Assets | null = null;
  /** The ambient bartender behind the back bar; null in the procedural fallback room. */
  private waiter: Waiter | null = null;
  /** One shared chair mesh (asset mode); cloned per seat. */
  private chairProto: THREE.Group | null = null;
  private lampParts: { shade: THREE.Mesh; cord: THREE.Mesh; model: THREE.Group | null };
  private ember: THREE.MeshStandardMaterial | null = null;
  /** One skin material for all your hands, tinted to your seat. */
  private skinMat = new THREE.MeshStandardMaterial({ color: 0xc69476, roughness: 0.7 });
  private sleeve = new THREE.MeshStandardMaterial({ color: 0x2a2a33, roughness: 0.8 });
  /** Shirt cuffs at the end of your sleeves (shared by every arm mesh). */
  private cuff = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.8 });
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
  private flashSprite: THREE.Sprite;
  private flashLife = 0;
  private flashAge = 0;
  private puffs: { s: THREE.Sprite; v: THREE.Vector3; spin: number; life: number; age: number; seq: number }[] = [];
  private puffSeq = 0;
  private time = 0;
  private quality = new AdaptiveQuality(window.devicePixelRatio, readGraphicsPref());
  mouse = new THREE.Vector2(0, 0);
  /** All cigarette smoke: one Points draw call. */
  readonly cigaretteSmoke = new CigaretteSmoke();

  constructor(container: HTMLElement) {
    // No preserveDrawingBuffer: nothing reads the canvas back, and keeping it forces an extra copy per frame.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality.current.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = this.quality.current.shadows;
    // Plain PCF: PCFSoft samples the shadow map many more times on every shadowed pixel.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.75;
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
    this.scene.fog = new THREE.FogExp2(0x100a06, 0.085);

    this.ambient = new THREE.HemisphereLight(0x9a6848, 0x1c0e06, AMBIENT_INTENSITY);
    this.scene.add(this.ambient);

    this.lamp = new THREE.SpotLight(0xffa65a, 60, 6, Math.PI / 3.2, 0.55, 1.6);
    this.lamp.position.set(0, 2.55, 0);
    this.lamp.target.position.set(0, TABLE_Y, 0);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.bias = -0.0008;
    this.scene.add(this.lamp, this.lamp.target);

    this.fill = new THREE.PointLight(0xff7a3a, FILL_INTENSITY, 12, 1.6);
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
    this.lampParts = { shade, cord, model: null };
    this.scene.add(shade, this.lampBulb, cord, glow);

    this.buildRoom();
    this.scene.add(this.tableGroup);
    this.buildSmoke();
    this.scene.add(this.cigaretteSmoke.points);
    this.cigaretteSmoke.rate = this.quality.current.shadows ? 1 : 0.5;
    this.updateSmokeViewport();
    this.setLayout(5, 0);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      // A glance survives the small drift after a click (e.g. on a roster row); a deliberate move takes the view back.
      this.glanceMoved += Math.abs(e.movementX) + Math.abs(e.movementY) || Math.hypot(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const real = this.glanceMoved > 60;
      if (this.locked) {
        if (real) this.cancelGlance();
        // Captured mouse: relative look, clamped like a seated head turn.
        this.targetYaw = clampLook(this.targetYaw - e.movementX * LOOK_SENS, -YAW_LIMIT, YAW_LIMIT);
        this.targetPitch = clampLook(this.targetPitch - e.movementY * LOOK_SENS, PITCH_MIN, PITCH_MAX);
        return;
      }
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (real) this.cancelGlance();
      if (this.freezeLook || this.stillView || this.glanceUntil > 0) return;
      this.targetYaw = -this.mouse.x * FOLLOW_YAW;
      this.targetPitch = this.mouse.y * FOLLOW_PITCH;
    });
    window.addEventListener('keydown', (e) => {
      const k = this.lookKey(e);
      if (!k || this.freezeLook || this.stillView) return;
      if (k.startsWith('Arrow')) e.preventDefault();
      this.keys.add(k);
      this.cancelGlance();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.renderer.domElement;
      this.onLockChange(this.locked);
    });
  }

  private keys = new Set<string>();
  private lastX = 0;
  private lastY = 0;
  private glanceUntil = 0;
  /** Mouse travel (px) since the current glance began. */
  private glanceMoved = 0;
  private glancePrev = { yaw: 0, pitch: 0 };

  /** The normalised look key for `e` (A/D/W/S/arrows), or null when it is not one or typing elsewhere. */
  private lookKey(e: KeyboardEvent): string | null {
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return null;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    return ['a', 'd', 'w', 's', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k) ? k : null;
  }

  /** Briefly turns the view toward `p`, then back; any mouse movement or look key cancels it. */
  glanceAt(p: THREE.Vector3, secs = 2.2) {
    if (this.freezeLook || this.stillView) return;
    if (this.glanceUntil <= 0) this.glancePrev = { yaw: this.targetYaw, pitch: this.targetPitch };
    const a = lookAngles(this.camera.position, p);
    this.targetYaw = a.yaw;
    this.targetPitch = a.pitch;
    this.glanceUntil = this.time + secs;
    this.glanceMoved = 0;
  }

  private cancelGlance() {
    this.glanceUntil = 0;
  }

  /** True while the mouse is captured (cursor hidden, aiming with the centre crosshair). */
  locked = false;
  /** Disable capture with ?nolock (tests) or in browsers without pointer lock. */
  lockAllowed = !new URLSearchParams(location.search).has('nolock') && 'requestPointerLock' in HTMLElement.prototype;
  onLockChange: (locked: boolean) => void = () => {};
  /** Holds the view completely still (no cursor follow, look keys, glances or head bob) while a card is picked. */
  freezeLook = false;
  /** Holds the view at rest, centred (no cursor follow, look keys or glances), on the home screen and in the lobby. */
  stillView = true;

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
    return !this.locked && !this.freezeLook && !this.stillView;
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
    const { yaw, pitch } = lookAngles(this.camera.position, p);
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
    this.updateSmokeViewport();
  }

  /** Point sprites are sized in device pixels. */
  private updateSmokeViewport() {
    this.cigaretteSmoke.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.camera.fov);
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
        uniforms: { tDiffuse: { value: null }, darkness: { value: 0.6 }, offset: { value: 1.0 } },
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

  /** Rebuilds the room from the CC0 assets (PBR textures, HDRI light, model chairs, stools, lamp and back bar). */
  useAssets(a: Assets) {
    this.assets = a;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // Image-based light for everything lit; props keep the RoomEnvironment propEnv via glossy().
    this.scene.environment = markSharedTexture(pmrem.fromEquirectangular(a.environment).texture);
    this.scene.environmentIntensity = ENV_INTENSITY;
    pmrem.dispose();

    this.refreshOwnHands();
    this.chairProto = chairModel(a.props);
    const lamp = lampModel(a.props);
    lamp.position.y = 2.42; // the spot light and bulb sit inside the glass
    this.lampBulb.position.y = 2.57;
    this.lampParts.shade.visible = this.lampParts.cord.visible = false;
    this.lampParts.model = lamp;
    this.scene.add(lamp);

    this.scene.remove(this.room);
    disposeObject(this.room);
    this.buildRoom();
    this.setLayout(this.layout.n, this.layout.me, true);
  }

  /** `set.map` etc. cloned with their own repeat, so each surface can tile differently. */
  private tiled(set: Assets['textures']['floor'], rx: number, ry: number) {
    const t = (src: THREE.Texture) => {
      const c = src.clone();
      c.repeat.set(rx, ry);
      return c;
    };
    return { map: t(set.map), normalMap: t(set.normalMap), roughnessMap: t(set.roughnessMap) };
  }

  private buildRoom() {
    const a = this.assets;
    const room = new THREE.Group();
    this.room = room;
    const floorMat = a
      ? new THREE.MeshStandardMaterial({ ...this.tiled(a.textures.floor, 6, 6), roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    room.add(floor);

    const wallMat = a
      ? new THREE.MeshStandardMaterial({ ...this.tiled(a.textures.wall, 4, 1.5), roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
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

    // Back bar: counter, shelves, bottles, painted sign.
    const counterWood = a
      ? new THREE.MeshStandardMaterial({ ...this.tiled(a.textures.counter, 3, 1), roughness: 1 })
      : glossy(new THREE.MeshStandardMaterial({ map: woodTexture('#3b2210', '#1c0e05', 'counter', 2), roughness: 0.6 }), 0.15);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.05, 0.7), counterWood);
    counter.position.set(0, 0.52, -4.2);
    counter.castShadow = counter.receiveShadow = true;
    room.add(counter);
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x24140a, roughness: 0.7 });
    for (let row = 0; row < 3; row++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.05, 0.3), shelfMat);
      shelf.position.set(0, 1.45 + row * 0.55, -4.85);
      room.add(shelf);
    }
    // Model bottles and glasses with assets; the merged procedural bottles otherwise.
    this.waiter = null;
    if (a) {
      room.add(buildBackBar(a.props));
      this.waiter = new Waiter(a.characters.shirt, a.props.glass_wine ?? null);
      this.waiter.group.position.set(WAITER_SPOT.x, 0, WAITER_SPOT.z);
      room.add(this.waiter.group);
      // A dim bare bulb on a cord over the waiter, so he reads in the dark behind the counter. No shadow: one is enough.
      const waiterLight = new THREE.SpotLight(0xffc080, 8, 3.6, Math.PI / 4.5, 0.8, 1.6);
      waiterLight.position.set(WAITER_SPOT.x, 3.2, WAITER_SPOT.z + 0.15);
      waiterLight.target.position.set(WAITER_SPOT.x, 1.1, WAITER_SPOT.z + 0.1);
      const waiterBulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffb060, emissiveIntensity: 1.2 }),
      );
      waiterBulb.position.copy(waiterLight.position);
      const waiterCord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 5), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      waiterCord.position.set(WAITER_SPOT.x, 3.4, WAITER_SPOT.z + 0.15);
      room.add(waiterLight, waiterLight.target, waiterBulb, waiterCord);
    } else room.add(new THREE.Mesh(
      bottlesGeometry(),
      glossy(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }), 0.35),
    ));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.45, metalness: 0.2 }));
    sign.position.set(0, 2.95, -4.97 + 0.02);
    room.add(sign);
    const neonLight = new THREE.PointLight(0xffb060, 0.6, 5, 1.5);
    neonLight.position.set(0, 3.0, -4.5);
    room.add(neonLight);
    // A few empty stools and a dartboard-ish clock on the side wall.
    const stoolProto = a ? stoolModel(a.props) : null;
    for (let i = 0; i < 5; i++) {
      if (stoolProto) {
        const stool = stoolProto.clone();
        stool.position.set(-2.4 + i * 1.2, 0, -3.5);
        room.add(stool);
        continue;
      }
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
    this.addBeerHall(room);
    this.scene.add(room);
  }

  /** 1930s beer-hall dressing: four merged meshes, no extra lights. */
  private addBeerHall(room: THREE.Group) {
    const props = new THREE.Mesh(
      hallPropsGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide }),
    );
    props.castShadow = false;
    props.receiveShadow = true;
    const glow = new THREE.Mesh(hallGlowGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.2), toneMapped: false }));
    const posters = new THREE.Mesh(posterGeometry(), new THREE.MeshStandardMaterial({ map: posterAtlas(), roughness: 0.9 }));
    posters.receiveShadow = true;
    const bunting = new THREE.Mesh(buntingGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    room.add(props, glow, posters, bunting);
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
  setLayout(n: number, me: number, force = false) {
    const count = Math.max(n, 5);
    if (!force && this.layout.n === count && this.layout.me === me && this.tableGroup.children.length) return;
    this.layout = new Layout(count, me);
    const shared = this.chairProto ? this.chairProto.children.flatMap((m) => [(m as THREE.Mesh).geometry, (m as THREE.Mesh).material as THREE.Material]) : [];
    disposeObject(this.tableGroup, { keep: [this.sleeve, this.cuff, this.skinMat, ...shared] });
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

    const chairMat = this.chairProto ? null : new THREE.MeshStandardMaterial({ map: woodTexture('#3d2414', '#1d0e06', 'chair'), roughness: 0.7 });
    for (let s = 0; s < count; s++) {
      if (s === me) continue;
      const chair = this.chairProto ? this.chairProto.clone() : new THREE.Group();
      if (chairMat) {
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
      }
      chair.position.copy(L.chair(s));
      chair.rotation.y = L.yaw(s);
      this.tableGroup.add(chair);
      this.chairs.set(s, chair);
    }
    // Your own hands resting on the table edge.
    const skin = this.skinMat;
    const sleeve = this.sleeve;
    for (const side of [-1, 1]) {
      // Shoulder (just out of view) -> elbow (off the table edge) -> wrist resting on the table.
      const shoulder = new THREE.Vector3(side * 0.24, 1.0, L.rz + 0.42);
      const elbow = new THREE.Vector3(side * 0.44, 0.83, L.rz + 0.2);
      const wrist = new THREE.Vector3(side * 0.4, TABLE_Y + 0.03, L.rz - 0.07);
      const sleeveMesh = new THREE.Mesh(mergeParts([limbGeometry(shoulder, elbow, SLEEVE_R.shoulder, SLEEVE_R.elbow), sleeveGeometry(elbow, wrist, SLEEVE_R.elbow, SLEEVE_R.wrist)]), sleeve);
      const cuff = new THREE.Mesh(cuffGeometry(wrist, wrist.clone().sub(elbow), SLEEVE_R.wrist * 0.95), this.cuff);
      if (side === -1) {
        // Armband for when you are Hitler (hidden otherwise): a ring around the forearm.
        const bandR = SLEEVE_R.elbow + (SLEEVE_R.wrist - SLEEVE_R.elbow) * 0.33 + 0.006;
        const band = new THREE.Mesh(cylinderBetween(elbow.clone().lerp(wrist, 0.25), elbow.clone().lerp(wrist, 0.4), bandR, bandR, 20, true), new THREE.MeshStandardMaterial({ color: 0xa01818, roughness: 0.5, side: THREE.DoubleSide }));
        band.visible = this.hitlerOutfit;
        this.armband = band;
        this.tableGroup.add(band);
      }
      const dir = wrist.clone().sub(elbow).setY(0).normalize();
      // The camera looks toward -Z, so the yaw below mirrors local X: flip the side to keep the thumb on the inner side.
      const hand = new THREE.Mesh(this.ownHandGeometry('flat', -side as 1 | -1), skin);
      hand.scale.setScalar(OWN_HAND_SCALE);
      hand.position.copy(wrist).addScaledVector(dir, 0.05).setY(TABLE_Y + 0.02 * OWN_HAND_SCALE); // palm bottom on the table
      hand.rotation.y = Math.atan2(dir.x, dir.z);
      for (const m of [sleeveMesh, cuff, hand]) {
        m.castShadow = true;
        this.tableGroup.add(m);
      }
      if (side === 1) this.restRightArm = [sleeveMesh, cuff, hand]; // your right (+X): the gun hand
      else this.restLeftArm = [sleeveMesh, cuff, hand];
    }
    this.applyOwnColors();
    this.camera.position.copy(L.eye());
  }

  private restRightArm: THREE.Mesh[] = [];
  private restLeftArm: THREE.Mesh[] = [];
  private handsUpTarget = 0;
  private handsUpAmount = 0;
  private handsUp: { fore: THREE.Mesh; cuff: THREE.Mesh; hand: THREE.Mesh; side: 1 | -1 }[] | null = null;
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
  private ownArm: { fore: THREE.Mesh; cuff: THREE.Mesh; hand: THREE.Mesh; finger: THREE.Mesh; fist: THREE.BufferGeometry; point: THREE.BufferGeometry | null } | null = null;
  /** The patron model's mitten hand once the assets are loaded, else the procedural one. */
  private ownHandGeometry(kind: 'flat' | 'fist', side: 1 | -1): THREE.BufferGeometry {
    return this.assets ? riggedHandGeometry(this.assets.characters.suit, side, kind) : handGeometry(kind, side);
  }
  /** The raised right hand's geometries: a fist (the gun grip), and with the mitten a flat hand to point with. */
  private ownArmHands(): { fist: THREE.BufferGeometry; point: THREE.BufferGeometry | null } {
    const fist = this.ownHandGeometry('fist', -1); // a right fist, knuckles at +Z; turned to look down -Z
    fist.rotateY(Math.PI);
    // The mitten has no index finger to add, so it points with straight fingers; the procedural fist gets its finger instead.
    const point = this.assets ? this.ownHandGeometry('flat', -1) : null;
    point?.rotateY(Math.PI);
    return { fist, point };
  }
  /** Swaps the already-built raised hands over to the mitten when the assets arrive. */
  private refreshOwnHands() {
    if (this.ownArm) {
      this.ownArm.fist.dispose();
      this.ownArm.point?.dispose();
      Object.assign(this.ownArm, this.ownArmHands());
      this.ownArm.hand.geometry = this.ownArm.fist;
    }
    for (const a of this.handsUp ?? []) {
      a.hand.geometry.dispose();
      a.hand.geometry = this.ownHandGeometry('flat', -a.side as 1 | -1);
    }
  }
  /** Forearm sleeve (y 0..1 from the elbow, stretched to length) and its wrist cuff, shared by the raised arms. */
  private raisedArm(): { fore: THREE.Mesh; cuff: THREE.Mesh } {
    const fore = new THREE.Mesh(unitSleeveGeometry(SLEEVE_R.elbow, SLEEVE_R.wrist), this.sleeve);
    const cuff = new THREE.Mesh(cuffGeometry(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), SLEEVE_R.wrist * 0.95), this.cuff);
    return { fore, cuff };
  }
  /** Places the forearm from `elbow` to `grip` (world); `quat` is the arm's orientation, `len` its length. */
  private poseForearm(fore: THREE.Mesh, cuff: THREE.Mesh, elbow: THREE.Vector3, grip: THREE.Vector3, quat: THREE.Quaternion, len: number) {
    fore.position.copy(elbow);
    fore.quaternion.copy(quat);
    fore.scale.set(1, len, 1);
    cuff.position.copy(grip);
    cuff.quaternion.copy(quat);
  }

  /**
   * Raises your right arm from below the view: onto the revolver's grip (`gun`), or pointing at a
   * world position (`point`). Null puts the arm back on the table.
   */
  setOwnArm(pose: { gun: THREE.Object3D } | { point: THREE.Vector3 } | null) {
    if (!this.ownArm) {
      const skin = this.skinMat;
      const { fore, cuff } = this.raisedArm();
      const geos = this.ownArmHands();
      const hand = new THREE.Mesh(geos.fist, skin);
      hand.scale.setScalar(OWN_HAND_SCALE); // the finger is a child, so it scales along
      const finger = new THREE.Mesh(pointingFingerGeometry(), skin);
      finger.position.set(0, 0.02, -0.08); // the hand looks down -Z, so the finger sticks out in front
      hand.add(finger);
      fore.visible = cuff.visible = hand.visible = false;
      this.scene.add(fore, cuff, hand);
      this.ownArm = { fore, cuff, hand, finger, ...geos };
    }
    const { fore, cuff, hand, finger, fist, point } = this.ownArm;
    fore.visible = cuff.visible = hand.visible = !!pose;
    for (const m of this.restRightArm) m.visible = !pose;
    if (!pose) return;
    let grip: THREE.Vector3;
    if ('gun' in pose) {
      pose.gun.updateMatrixWorld();
      grip = pose.gun.localToWorld(new THREE.Vector3(0, -0.03, 0.08));
      hand.quaternion.copy(pose.gun.getWorldQuaternion(new THREE.Quaternion()));
      hand.geometry = fist;
      finger.visible = false;
    } else {
      this.camera.updateMatrixWorld();
      grip = this.camera.localToWorld(new THREE.Vector3(0.15, -0.1, -0.45)); // above the prompt banner
      // Hand faces the target (its -Z axis points at it) with the index finger extended.
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion); // no roll as you look around
      hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(grip, pose.point, camUp));
      hand.geometry = point ?? fist;
      finger.visible = !point;
    }
    const elbowLocal = new THREE.Vector3(0.34, -0.5, 0.05);
    const elbow = this.camera.localToWorld(elbowLocal.clone());
    const len = elbow.distanceTo(grip);
    // Orient in camera space, then apply the camera's rotation: the arm turns with your view instead of
    // rolling around its own length (a world-space shortest-arc rotation twists as the camera yaws).
    const dirLocal = this.camera.worldToLocal(grip.clone()).sub(elbowLocal).normalize();
    const quat = this.camera.quaternion.clone().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirLocal));
    this.poseForearm(fore, cuff, elbow, grip, quat, len);
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
    if (this.handsUp) for (const a of this.handsUp) a.fore.visible = a.cuff.visible = a.hand.visible = up;
  }

  private updateOwnHandsUp(dt: number) {
    this.handsUpAmount += (this.handsUpTarget - this.handsUpAmount) * (1 - Math.exp(-7 * dt));
    if (this.handsUpAmount > 0.02 && !this.handsUp) {
      const skin = this.skinMat;
      this.handsUp = ([-1, 1] as const).map((side) => {
        const { fore, cuff } = this.raisedArm();
        const hand = new THREE.Mesh(this.ownHandGeometry('flat', -side as 1 | -1), skin); // thumb toward the midline once turned palm-out
        hand.scale.setScalar(OWN_HAND_SCALE);
        this.scene.add(fore, cuff, hand);
        return { fore, cuff, hand, side };
      });
    }
    this.applyHandsUpVisibility();
    if (!this.handsUp || this.handsUpAmount <= 0.02) return;
    const { elbow, grip, elbowW, gripW, dir, up, q, handQ } = this.hu;
    const a = this.handsUpAmount;
    const e = a * a * (3 - 2 * a);
    this.camera.updateMatrixWorld();
    for (const { fore, cuff, hand, side } of this.handsUp) {
      // Camera space; lowered, both joints sit below the view.
      elbow.set(side * 0.32, -1.0 + 0.45 * e, -0.3);
      grip.set(side * 0.26, -1.0 + 0.82 * e, -0.5);
      elbowW.copy(elbow).applyMatrix4(this.camera.matrixWorld);
      gripW.copy(grip).applyMatrix4(this.camera.matrixWorld);
      // As setOwnArm: orient in camera space, then apply the camera rotation so the arm turns with your view.
      dir.copy(grip).sub(elbow);
      const len = dir.length();
      q.setFromUnitVectors(up, dir.divideScalar(len)).premultiply(this.camera.quaternion);
      this.poseForearm(fore, cuff, elbowW, gripW, q, len);
      hand.position.copy(gripW);
      hand.quaternion.copy(this.camera.quaternion).multiply(handQ);
    }
  }

  /** True once the camera has caught up with the cursor (used by tests before clicking). */
  settled(): boolean {
    return this.glanceUntil <= 0 && Math.abs(this.targetYaw - this.yaw) < 0.002 && Math.abs(this.targetPitch - this.pitch) < 0.002;
  }

  /** Your own first-person sleeves: uniform and armband when you are Hitler (only your client knows). */
  setOwnOutfit(hitler: boolean) {
    if (hitler === this.hitlerOutfit) return;
    this.hitlerOutfit = hitler;
    this.applyOwnColors();
    if (this.armband) this.armband.visible = hitler;
  }

  /** Sleeves and hands match the patron other players see in your seat. */
  private applyOwnColors() {
    const { coat, skin } = seatColors(this.layout.me, this.hitlerOutfit);
    this.sleeve.color.set(coat);
    this.skinMat.color.set(skin);
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

  track(m: Mover) {
    this.movers.add(m);
    return m;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    if (this.freezeLook) {
      this.glanceUntil = 0;
      this.targetYaw = this.yaw;
      this.targetPitch = this.pitch;
    }
    if (this.stillView) {
      this.glanceUntil = 0;
      this.targetYaw = 0;
      this.targetPitch = 0;
    }
    if (this.glanceUntil > 0 && t >= this.glanceUntil) {
      this.glanceUntil = 0;
      this.targetYaw = this.glancePrev.yaw;
      this.targetPitch = this.glancePrev.pitch;
    }
    const frozen = this.freezeLook || this.stillView;
    const h = frozen ? 0 : (+this.keys.has('a') || +this.keys.has('ArrowLeft')) - (+this.keys.has('d') || +this.keys.has('ArrowRight'));
    const v = frozen ? 0 : (+this.keys.has('w') || +this.keys.has('ArrowUp')) - (+this.keys.has('s') || +this.keys.has('ArrowDown'));
    if (h) this.targetYaw = clampLook(this.targetYaw + h * KEY_LOOK * dt, -YAW_LIMIT, YAW_LIMIT);
    if (v) this.targetPitch = clampLook(this.targetPitch + v * KEY_LOOK * dt, PITCH_MIN, PITCH_MAX);
    // Camera look with clamped yaw/pitch, plus shake.
    const k = 1 - Math.exp(-6 * dt);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    const eye = this.layout.eye();
    const baseYaw = 0;
    const basePitch = BASE_PITCH;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 0.06;
    const camX = eye.x;
    const camY = eye.y + (frozen ? 0 : Math.sin(t * 0.9) * 0.004);
    const camZ = eye.z;
    const camPitch = basePitch + this.pitch;
    const camYaw = baseYaw + this.yaw;
    const fov = 68;
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
    this.fill.intensity = FILL_INTENSITY * lit;
    this.ambient.intensity = AMBIENT_INTENSITY * (1 - this.night * 0.85);
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
    this.cigaretteSmoke.update(dt);
    for (const m of this.movers) m.update(dt);
    this.waiter?.update(dt);
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
    this.updateSmokeViewport();
    this.cigaretteSmoke.rate = step.shadows ? 1 : 0.5;
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
