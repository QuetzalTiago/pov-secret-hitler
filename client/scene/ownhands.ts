import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterTemplate } from './assets';
import { handGeometry } from './hands';

/** The bones of one hand: palm, mid-hand, the one bone for all four fingers, and the two thumb joints. */
const HAND_BONES = ['Palm', 'MiddleHand', 'Fingers', 'Thumb1', 'Thumb2'];
/** How far the fingers close for a fist (about their joint, across the hand), radians. */
const FIST_CURL = 1.3;

/**
 * The patron model's low-poly mitten hand, in the local frame of handGeometry(kind, side) so the first-person hand code can
 * swap one for the other: 'flat' is palm down with the fingers along +Z, 'fist' has the fingers closed into the palm (arm axis +Z,
 * knuckles at +Z). `side` is the hand's side of the body (1 = the figure's left, +X; -1 = the right), thumb toward the midline.
 * It is scaled to the length of the procedural hand. Position + normal only, so the caller's skin material colours it.
 * Builds a new geometry each call: the caller disposes.
 */
export function riggedHandGeometry(tpl: CharacterTemplate, side: 1 | -1, kind: 'flat' | 'fist'): THREE.BufferGeometry {
  const mesh = tpl.mesh;
  const { bones, boneInverses } = mesh.skeleton;
  tpl.root.updateMatrixWorld(true);
  const suffix = side === 1 ? 'L' : 'R';
  const boneIndex = (name: string) => bones.findIndex((b) => b.name === name + suffix);
  const handIdx = new Set(HAND_BONES.map(boneIndex));
  const fingersIdx = boneIndex('Fingers');
  const thumbIdx = new Set([boneIndex('Thumb1'), boneIndex('Thumb2')]);

  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const skin = tpl.parts.Skin;
  const dominant = (i: number) => {
    let w = 0;
    let top = -1;
    for (let k = 0; k < 4; k++) {
      if (sw.getComponent(i, k) > w) {
        w = sw.getComponent(i, k);
        top = si.getComponent(i, k);
      }
    }
    return top;
  };
  const inHand = (i: number) => i >= skin.start && i < skin.start + skin.count && handIdx.has(dominant(i));

  // Triangles whose three vertices all belong to the hand, welded into their own vertex list.
  const index = g.index!;
  const remap = new Map<number, number>();
  const source: number[] = [];
  const tris: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (!tri.every(inHand)) continue;
    for (const v of tri) {
      if (!remap.has(v)) {
        remap.set(v, source.length);
        source.push(v);
      }
      tris.push(remap.get(v)!);
    }
  }

  // The rest pose, skinned as the renderer does: the bone's world matrix times its inverse bind matrix, blended by weight.
  const skinMats = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, boneInverses[i]).multiply(mesh.bindMatrix));
  const rest = source.map((v) => {
    const out = new THREE.Vector3();
    const p = new THREE.Vector3();
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      out.addScaledVector(p.fromBufferAttribute(pos, v).applyMatrix4(skinMats[si.getComponent(v, k)]), w);
      total += w;
    }
    return out.divideScalar(total || 1);
  });
  const fingerWeight = source.map((v) => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === fingersIdx) w += sw.getComponent(v, k);
    return w;
  });

  // The hand's frame from the bones: fingers along Palm -> Fingers, the thumb across (its side of the mitten body).
  const bonePos = (i: number) => new THREE.Vector3().setFromMatrixPosition(bones[i].matrixWorld);
  const wrist = bonePos(boneIndex('Palm'));
  const pivot = bonePos(fingersIdx);
  const along = pivot.clone().sub(wrist).normalize();
  const body = new THREE.Vector3();
  const thumb = new THREE.Vector3();
  let nBody = 0;
  let nThumb = 0;
  source.forEach((v, n) => (thumbIdx.has(dominant(v)) ? (thumb.add(rest[n]), nThumb++) : (body.add(rest[n]), nBody++)));
  const across = thumb.divideScalar(nThumb).sub(body.divideScalar(nBody));
  across.addScaledVector(along, -across.dot(along)).normalize();
  const palm = new THREE.Vector3().crossVectors(along, across);
  // Source (along, across, palm) -> target (+Z, thumb toward the midline = -side X, palm down).
  const toTarget = new THREE.Matrix4()
    .makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-side, 0, 0), new THREE.Vector3(0, -side, 0))
    .multiply(new THREE.Matrix4().makeBasis(along, across, palm).transpose());

  /** The vertices in the target frame, at wrist origin and mitten scale 1; the fingers closed by `curl` radians. */
  const posed = (curl: number): THREE.Vector3[] => {
    const axis = across.clone().multiplyScalar(-side);
    return rest.map((p, n) => {
      const q = p.clone();
      if (curl) q.sub(pivot).applyAxisAngle(axis, curl * fingerWeight[n]).add(pivot);
      return q.sub(wrist).applyMatrix4(toTarget);
    });
  };
  const boxOf = (pts: THREE.Vector3[]) => new THREE.Box3().setFromPoints(pts);
  const refBox = (k: 'flat' | 'fist') => {
    const geo = handGeometry(k, side);
    geo.computeBoundingBox();
    const b = geo.boundingBox!.clone();
    geo.dispose();
    return b;
  };

  // Scale so the flat hand is as long as the procedural one; the fist uses the same scale.
  const flat = posed(0);
  const scale = (refBox('flat').max.z - refBox('flat').min.z) / (boxOf(flat).max.z - boxOf(flat).min.z);
  const pts = kind === 'flat' ? flat : posed(FIST_CURL);
  const box = boxOf(pts);
  const ref = refBox(kind);
  const centre = new THREE.Vector3();
  // Wrist end at the procedural wrist, centred across; flat rests on the table, the fist is centred in height.
  centre.set((ref.min.x + ref.max.x) / 2 - ((box.min.x + box.max.x) / 2) * scale, 0, ref.min.z - box.min.z * scale);
  centre.y = kind === 'flat' ? ref.min.y - box.min.y * scale : (ref.min.y + ref.max.y) / 2 - ((box.min.y + box.max.y) / 2) * scale;

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => p.multiplyScalar(scale).add(centre).toArray()), 3));
  out.setIndex(tris);
  const welded = mergeVertices(out, 1e-5);
  out.dispose();
  welded.computeVertexNormals();
  return welded;
}
