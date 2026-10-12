import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manSuitUrl from '../models/chars/man_suit.glb?url';
import manCasualUrl from '../models/chars/man_casual.glb?url';
import womanDressUrl from '../models/chars/woman_dress.glb?url';
import chairWoodUrl from '../models/props/chair_wood.glb?url';
import stoolWoodUrl from '../models/props/stool_wood.glb?url';
import lampPendantUrl from '../models/props/lamp_pendant.glb?url';
import bottleOldUrl from '../models/props/bottle_old.glb?url';
import bottleAUrl from '../models/props/bottle_a.glb?url';
import bottleBUrl from '../models/props/bottle_b.glb?url';
import bottleWineUrl from '../models/props/bottle_wine.glb?url';
import glassVodkaUrl from '../models/props/glass_vodka.glb?url';
import glassCognacUrl from '../models/props/glass_cognac.glb?url';
import glassWineUrl from '../models/props/glass_wine.glb?url';
import floorDiffUrl from '../models/tex/floor_planks_diff.webp?url';
import floorNorUrl from '../models/tex/floor_planks_nor.webp?url';
import floorRoughUrl from '../models/tex/floor_planks_rough.webp?url';
import wallDiffUrl from '../models/tex/wall_plaster_diff.webp?url';
import wallNorUrl from '../models/tex/wall_plaster_nor.webp?url';
import wallRoughUrl from '../models/tex/wall_plaster_rough.webp?url';
import counterDiffUrl from '../models/tex/counter_wood_diff.webp?url';
import counterNorUrl from '../models/tex/counter_wood_nor.webp?url';
import counterRoughUrl from '../models/tex/counter_wood_rough.webp?url';
import envUrl from '../models/env/warm_bar_1k.hdr?url';

// CC0 glTF assets (credits in client/models/CREDITS.md). Loading never rejects: null means "use the procedural scene".

export type Outfit = 'suit' | 'shirt' | 'dress';

export interface CharacterTemplate {
  outfit: Outfit;
  /** Unit-height wrapper around the glTF scene, feet at y 0. Callers scale. */
  root: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  /** Vertex range per material name, in the merged geometry's `color` attribute. */
  parts: Record<string, { start: number; count: number }>;
  /** Keyed by bare name: Sitting, Idle, Death... */
  clips: Record<string, THREE.AnimationClip>;
  bones: string[];
  height: number;
}

type TexSet = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };

export interface Assets {
  characters: Record<Outfit, CharacterTemplate>;
  props: Record<string, THREE.Group>;
  textures: Record<'floor' | 'wall' | 'counter', TexSet>;
  environment: THREE.DataTexture;
}

// Quantized (normalized int16) attributes become plain Float32 so mergeGeometries sees matching types.
function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.itemSize;
  const out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    out[i * n] = a.getX(i);
    if (n > 1) out[i * n + 1] = a.getY(i);
    if (n > 2) out[i * n + 2] = a.getZ(i);
    if (n > 3) out[i * n + 3] = a.getW(i);
  }
  return new THREE.BufferAttribute(out, n);
}

export function prepareCharacter(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }, outfit: Outfit): CharacterTemplate {
  const prims: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) prims.push(o as THREE.SkinnedMesh);
  });
  if (!prims.length) throw new Error(`no skinned mesh in ${outfit}`);
  const first = prims[0];
  const useUv = prims.every((p) => p.geometry.getAttribute('uv'));

  const parts: Record<string, { start: number; count: number }> = {};
  const geoms: THREE.BufferGeometry[] = [];
  let offset = 0;
  for (const p of prims) {
    const mat = p.material as THREE.MeshStandardMaterial;
    const src = p.geometry;
    const g = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'skinIndex', 'skinWeight', ...(useUv ? ['uv'] : [])]) {
      g.setAttribute(n, toFloat(src.getAttribute(n)));
    }
    if (src.index) g.setIndex(src.index.clone());
    const count = g.getAttribute('position').count;
    const color = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      color[i * 3] = mat.color.r;
      color[i * 3 + 1] = mat.color.g;
      color[i * 3 + 2] = mat.color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    parts[mat.name] = { start: offset, count };
    geoms.push(g);
    offset += count;
  }
  const merged = mergeGeometries(geoms, false);
  if (!merged) throw new Error(`could not merge ${outfit}`);
  geoms.forEach((g) => g.dispose());

  const mesh = new THREE.SkinnedMesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }));
  mesh.name = `char_${outfit}`;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  (first.parent ?? gltf.scene).add(mesh);
  mesh.bind(first.skeleton, first.bindMatrix);
  for (const p of prims) {
    p.removeFromParent();
    p.geometry.dispose();
  }

  const root = new THREE.Group();
  root.name = `template_${outfit}`;
  root.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene, true);
  const scale = 1 / (box.max.y - box.min.y);
  root.scale.setScalar(scale);
  root.position.y = -box.min.y * scale;

  const clips: Record<string, THREE.AnimationClip> = {};
  for (const c of gltf.animations) clips[c.name.slice(c.name.lastIndexOf('_') + 1)] = c;

  return { outfit, root, mesh, parts, clips, bones: mesh.skeleton.bones.map((b) => b.name), height: 1 };
}

let pending: Promise<Assets | null> | null = null;
let loaded: Assets | null = null;

export function loadAssets(): Promise<Assets | null> {
  pending ??= (async () => {
    try {
      const gltfs = new GLTFLoader();
      const texLoader = new THREE.TextureLoader();
      const loadTex = async (url: string, srgb: boolean) => {
        const t = await texLoader.loadAsync(url);
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        return t;
      };
      const texSet = async (d: string, n: string, r: string): Promise<TexSet> => {
        const [map, normalMap, roughnessMap] = await Promise.all([loadTex(d, true), loadTex(n, false), loadTex(r, false)]);
        return { map, normalMap, roughnessMap };
      };
      const outfits: [Outfit, string][] = [['suit', manSuitUrl], ['shirt', manCasualUrl], ['dress', womanDressUrl]];
      const propUrls: Record<string, string> = {
        chair_wood: chairWoodUrl, stool_wood: stoolWoodUrl, lamp_pendant: lampPendantUrl, bottle_old: bottleOldUrl,
        bottle_a: bottleAUrl, bottle_b: bottleBUrl, bottle_wine: bottleWineUrl,
        glass_vodka: glassVodkaUrl, glass_cognac: glassCognacUrl, glass_wine: glassWineUrl,
      };
      const [chars, props, floor, wall, counter, environment] = await Promise.all([
        Promise.all(outfits.map(async ([o, url]) => prepareCharacter(await gltfs.loadAsync(url), o))),
        Promise.all(Object.entries(propUrls).map(async ([k, url]) => [k, (await gltfs.loadAsync(url)).scene] as const)),
        texSet(floorDiffUrl, floorNorUrl, floorRoughUrl),
        texSet(wallDiffUrl, wallNorUrl, wallRoughUrl),
        texSet(counterDiffUrl, counterNorUrl, counterRoughUrl),
        new HDRLoader().loadAsync(envUrl),
      ]);
      environment.mapping = THREE.EquirectangularReflectionMapping;
      loaded = {
        characters: Object.fromEntries(chars.map((c) => [c.outfit, c])) as Record<Outfit, CharacterTemplate>,
        props: Object.fromEntries(props),
        textures: { floor, wall, counter },
        environment,
      };
      return loaded;
    } catch (err) {
      console.warn('[assets] failed, using procedural scene', err);
      return null;
    }
  })();
  return pending;
}

export function getAssets(): Assets | null {
  return loaded;
}
