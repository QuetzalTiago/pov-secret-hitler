import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Pure builders that turn the raw glTF prop scenes (client/scene/assets.ts) into few-draw-call room pieces.
// No renderer needed, so they run in node tests.

type Props = Record<string, THREE.Object3D>;

export const CHAIR_HEIGHT = 0.96;
export const STOOL_HEIGHT = 0.78;
export const LAMP_WIDTH = 0.45;
/** Top of the back-bar counter. */
const COUNTER_TOP = 1.045;

// Quantized (normalized int16) attributes become plain Float32 so transforms and merging are exact.
function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.itemSize;
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    out[i * n] = a.getX(i);
    if (n > 1) out[i * n + 1] = a.getY(i);
    if (n > 2) out[i * n + 2] = a.getZ(i);
  }
  return new THREE.BufferAttribute(out, n);
}

/** Clone of `src` scaled uniformly to `height`, feet at y 0, centred in x/z. */
export function normalizeProp(src: THREE.Object3D, height: number): THREE.Group {
  const holder = new THREE.Group();
  holder.add(src.clone(true));
  const wrap = new THREE.Group();
  wrap.add(holder);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap, true);
  const s = height / (box.max.y - box.min.y || 1);
  holder.scale.setScalar(s);
  holder.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
  wrap.updateMatrixWorld(true);
  return wrap;
}

/**
 * Bakes every mesh under `root` (in root space) into as few meshes as possible. Plain-colour materials
 * have their colour written to a vertex `color` attribute and share one mesh (`plain`); textured
 * materials keep themselves and get one mesh each.
 */
export function mergeProp(
  root: THREE.Object3D,
  plain: THREE.Material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.1 }),
): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const plainGeoms: THREE.BufferGeometry[] = [];
  const textured = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    const isTextured = !!mat.map;
    const src = m.geometry;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', toFloat(src.getAttribute('position')));
    const normal = src.getAttribute('normal');
    if (normal) g.setAttribute('normal', toFloat(normal));
    if (isTextured) g.setAttribute('uv', toFloat(src.getAttribute('uv')));
    if (src.index) g.setIndex(src.index.clone());
    else g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
    if (!normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
    if (isTextured) {
      const list = textured.get(mat) ?? [];
      list.push(g);
      textured.set(mat, list);
      return;
    }
    const count = g.getAttribute('position').count;
    const color = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      color[i * 3] = mat.color.r;
      color[i * 3 + 1] = mat.color.g;
      color[i * 3 + 2] = mat.color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    plainGeoms.push(g);
  });
  const out: THREE.Mesh[] = [];
  const emit = (geoms: THREE.BufferGeometry[], mat: THREE.Material) => {
    const merged = mergeGeometries(geoms, false);
    if (!merged) throw new Error('could not merge prop geometry');
    geoms.forEach((g) => g.dispose());
    out.push(new THREE.Mesh(merged, mat));
  };
  if (plainGeoms.length) emit(plainGeoms, plain);
  for (const [mat, geoms] of textured) emit(geoms, mat);
  return out;
}

function group(name: string, meshes: THREE.Mesh[], castShadow: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  for (const m of meshes) {
    m.castShadow = castShadow;
    g.add(m);
  }
  return g;
}

/** Dining chair as one mesh, 0.96 m tall, backrest on local +Z (like the procedural chair it replaces). */
export function chairModel(props: Props): THREE.Group {
  const meshes = mergeProp(normalizeProp(props.chair_wood, CHAIR_HEIGHT));
  // Backrest side: where the vertices in the top 40% sit along z.
  let sumZ = 0;
  for (const m of meshes) {
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getY(i) > CHAIR_HEIGHT * 0.6) sumZ += p.getZ(i);
  }
  if (sumZ < 0) for (const m of meshes) m.geometry.rotateY(Math.PI);
  return group('chair', meshes, true);
}

/** Bar stool as one mesh with the seat at 0.78 m. */
export function stoolModel(props: Props): THREE.Group {
  return group('stool', mergeProp(normalizeProp(props.stool_wood, STOOL_HEIGHT)), true);
}

/** Pendant lamp (feet = lowest point of the shade) with an emissive glass instead of a transmissive one. */
export function lampModel(props: Props): THREE.Group {
  const probe = normalizeProp(props.lamp_pendant, 1);
  const size = new THREE.Box3().setFromObject(probe, true).getSize(new THREE.Vector3());
  const lamp = normalizeProp(props.lamp_pendant, LAMP_WIDTH / Math.max(size.x, size.z));
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffe0a8, emissive: 0xffb060, emissiveIntensity: 1, transparent: true, opacity: 0.6, depthWrite: false,
  });
  lamp.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && ((m.material as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0) m.material = glass;
  });
  lamp.name = 'lamp';
  return lamp;
}

const GLASS_TINT: Record<string, { color: number; height: number }> = {
  glass_vodka: { color: 0xcfe3ea, height: 0.09 },
  glass_cognac: { color: 0xd49a4c, height: 0.1 },
  glass_wine: { color: 0xd8e6e0, height: 0.16 },
};
const BOTTLES = ['bottle_a', 'bottle_b', 'bottle_wine', 'bottle_old'];

/** Three shelves of bottles and a few glasses on the counter, in at most three draw calls. */
export function buildBackBar(props: Props): THREE.Group {
  const kinds = BOTTLES.filter((k) => props[k]);
  const bottles = new THREE.Group();
  let count = 0;
  for (let row = 0; row < 3; row++) {
    for (let b = 0; b < 22; b++) {
      if ((b * 7 + row * 3) % 5 === 0) continue;
      const kind = kinds[(b + row * 2) % kinds.length];
      const h = 0.22 + ((b * 13 + row) % 5) * 0.04;
      const bottle = normalizeProp(props[kind], h);
      // The old flask is wide: keep its broad side to the room; round bottles can face any way.
      bottle.rotation.y = kind === 'bottle_old' ? ((b + row) % 3 - 1) * 0.25 : ((b * 37 + row * 11) % 7) * 0.9;
      bottle.position.set(-2.6 + b * 0.25, 1.475 + row * 0.55, -4.85);
      bottles.add(bottle);
      count++;
    }
  }
  const glasses = new THREE.Group();
  const glassKinds = Object.keys(GLASS_TINT).filter((k) => props[k]);
  const xs = [-2.3, -1.3, -0.4, 0.6, 1.5, 2.4];
  const tints = new Map(glassKinds.map((k) => [k, new THREE.MeshStandardMaterial({ color: GLASS_TINT[k].color })]));
  if (glassKinds.length) {
    xs.forEach((x, i) => {
      const kind = glassKinds[i % glassKinds.length];
      const g = normalizeProp(props[kind], GLASS_TINT[kind].height);
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = tints.get(kind)!;
      });
      g.position.set(x, COUNTER_TOP, -4.2 + ((i * 5) % 3 - 1) * 0.12);
      glasses.add(g);
    });
  }

  const out = new THREE.Group();
  out.name = 'backbar';
  out.userData.bottles = count;
  for (const m of mergeProp(bottles)) out.add(m);
  if (glasses.children.length) {
    const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
    for (const m of mergeProp(glasses, glassMat)) out.add(m);
  }
  return out;
}
