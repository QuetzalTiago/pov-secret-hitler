import * as THREE from 'three';
import { isCachedTexture } from './textures';

// Frees GPU resources of a removed subtree. Cache-owned textures are shared, so they are never disposed here.
export function disposeObject(
  root: THREE.Object3D,
  opts: { keep?: Iterable<THREE.Material | THREE.BufferGeometry>; geometry?: boolean } = {},
) {
  const skip = new Set<unknown>(opts.keep);
  const done = new Set<unknown>();
  const free = (r: { dispose(): void }) => {
    if (skip.has(r) || done.has(r)) return;
    done.add(r);
    r.dispose();
  };
  root.traverse((o) => {
    const obj = o as THREE.Mesh;
    if (obj.geometry && opts.geometry !== false && !(o instanceof THREE.Sprite)) free(obj.geometry);
    if (!obj.material) return;
    for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (skip.has(m) || done.has(m)) continue;
      for (const v of Object.values(m)) if (v instanceof THREE.Texture && !isCachedTexture(v)) free(v);
      free(m);
    }
  });
}
