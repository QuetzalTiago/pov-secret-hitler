// Cigarette smoke: one fixed-capacity particle pool drawn as a single THREE.Points (one draw call).
import * as THREE from 'three';
import { smokeTexture } from './textures';

export const PEAK_ALPHA = 0.7;
const GROWTH = 2.5; // size ends at (1 + GROWTH) * size0
const DAMP = 1.2;
const BUOYANCY = 0.12;
const CURL = 0.06;

/** Pure particle simulation on typed arrays (no three), so it is node-testable. */
export class SmokePool {
  readonly position: Float32Array;
  readonly velocity: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly alpha: Float32Array;
  readonly size: Float32Array;
  alive = 0;

  constructor(readonly capacity: number) {
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity); // life 0 + age 0 reads as dead
    this.size0 = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
  }

  /** Reuses a dead slot, else overwrites the oldest particle. Returns the slot used. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number): number {
    let slot = -1;
    let oldest = -1;
    for (let i = 0; i < this.capacity; i++) {
      if (this.age[i] >= this.life[i]) {
        slot = i;
        break;
      }
      const frac = this.age[i] / this.life[i];
      if (frac > oldest) {
        oldest = frac;
        slot = i;
      }
    }
    const i = slot;
    this.position.set([x, y, z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * 0.8;
    this.alpha[i] = 0; // first update fades it in
    this.size[i] = size;
    return i;
  }

  update(dt: number) {
    const damp = Math.exp(-DAMP * dt);
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      alive++;
      const k = a / this.life[i];
      const p = i * 3;
      // Damped drift, gentle buoyancy, small deterministic sideways curl.
      this.velocity[p] = this.velocity[p] * damp + Math.sin(a * 1.9 + i * 1.7) * CURL * dt;
      this.velocity[p + 1] = this.velocity[p + 1] * damp + BUOYANCY * dt;
      this.velocity[p + 2] = this.velocity[p + 2] * damp + Math.sin(a * 1.5 + i * 2.3 + 1.3) * CURL * dt;
      this.position[p] += this.velocity[p] * dt;
      this.position[p + 1] += this.velocity[p + 1] * dt;
      this.position[p + 2] += this.velocity[p + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      this.size[i] = this.size0[i] * (1 + GROWTH * (1 - (1 - k) * (1 - k)));
      const fadeIn = Math.min(1, k / 0.1);
      this.alpha[i] = PEAK_ALPHA * fadeIn * Math.pow(1 - k, 1.5);
    }
    this.alive = alive;
  }
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aRot;
uniform float uScale;
varying float vAlpha;
varying float vRot;
#include <fog_pars_vertex>
void main() {
  vAlpha = aAlpha;
  vRot = aRot;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / max(0.05, -mvPosition.z);
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 color;
varying float vAlpha;
varying float vRot;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot);
  float co = cos(vRot);
  vec2 uv = vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;
  float a = texture2D(map, uv).a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(color, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class CigaretteSmoke {
  readonly pool: SmokePool;
  readonly points: THREE.Points;
  /** Emission multiplier (1 normally; lowered on the low-quality step). */
  rate = 1;
  private material: THREE.ShaderMaterial;
  private dirV = new THREE.Vector3();
  private acc = new Map<number, number>();

  constructor(capacity = 192) {
    this.pool = new SmokePool(capacity);
    const geo = new THREE.BufferGeometry();
    const attr = (arr: Float32Array, n: number) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr(this.pool.position, 3));
    geo.setAttribute('aSize', attr(this.pool.size, 1));
    geo.setAttribute('aAlpha', attr(this.pool.alpha, 1));
    geo.setAttribute('aRot', attr(this.pool.rot, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { map: { value: smokeTexture() }, color: { value: new THREE.Color(0xd8ccbc) }, uScale: { value: 600 } },
      ]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life: number) {
    this.pool.emit(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, size, life);
  }

  update(dt: number) {
    this.pool.update(dt);
    const g = this.points.geometry;
    for (const name of ['position', 'aSize', 'aAlpha', 'aRot']) g.getAttribute(name).needsUpdate = true;
  }

  /** `heightPx` is the drawing-buffer height in device pixels (CSS height * pixel ratio). */
  setViewport(heightPx: number, fovDeg: number) {
    this.material.uniforms.uScale.value = (heightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  }

  /** Thin continuous wisp from a burning tip; `id` keys the per-source emission accumulator. */
  wisp(id: number, tip: THREE.Vector3, dt: number) {
    const n = this.take(id, 6 * this.rate * dt);
    for (let i = 0; i < n; i++) {
      const j = () => (Math.random() - 0.5) * 0.02;
      this.pool.emit(tip.x, tip.y, tip.z, j(), 0.06 + Math.random() * 0.04, j(), 0.04, 2.5 + Math.random());
    }
  }

  /** Exhaled smoke from the mouth along `dir` while `amount` > 0. */
  exhale(id: number, mouth: THREE.Vector3, dir: THREE.Vector3, amount: number, dt: number) {
    if (amount <= 0) {
      this.acc.delete(id);
      return;
    }
    const n = this.take(id, 30 * amount * this.rate * dt);
    const d = this.dirV.copy(dir).normalize();
    const speed = 0.35 * amount;
    for (let i = 0; i < n; i++) {
      const j = () => (Math.random() - 0.5) * 0.08;
      this.pool.emit(
        mouth.x, mouth.y, mouth.z,
        d.x * speed + j(), d.y * speed + 0.05 + j(), d.z * speed + j(),
        0.08, 1.8 + Math.random() * 0.8,
      );
    }
  }

  /** Adds `amount` to the id's accumulator and returns the whole particles due. */
  private take(id: number, amount: number): number {
    const total = (this.acc.get(id) ?? 0) + amount;
    const n = Math.floor(total);
    this.acc.set(id, total - n);
    return n;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
