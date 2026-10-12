import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { chairModel, chairSeat } from '../client/scene/roomprops';
import { prepareCharacter, type CharacterTemplate, type Outfit } from '../client/scene/assets';

const MODELS = path.resolve(__dirname, '../client/models');
const FILES: Record<Outfit, string> = { suit: 'man_suit', shirt: 'man_casual', dress: 'woman_dress' };

// Minimal fake canvas so textures.ts can run in node.
function fakeCtx() {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get(t, k: string) {
      if (k === 'measureText') return (s: string) => ({ width: String(s).length * 10 });
      if (k === 'getImageData')
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      if (k in t) return t[k];
      return () => ({ addColorStop() {} });
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
}

type Rigged = typeof import('../client/scene/rigged');
type Chars = typeof import('../client/scene/characters');
let RiggedCharacter: Rigged['RiggedCharacter'];
let SEAT: Rigged['SEAT'];
let BUTTOCK_DEPTH: Rigged['BUTTOCK_DEPTH'];
let chars: Chars;
const templates = {} as Record<Outfit, CharacterTemplate>;
// Template used for each style by the default (assets) lookup, replicated for the injected one.
const OUTFIT = (i: number, variant: 'normal' | 'hitler'): Outfit => (variant === 'hitler' ? 'suit' : i === 2 || i === 7 ? 'dress' : i === 5 || i === 8 ? 'shirt' : 'suit');

beforeAll(async () => {
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }),
  };
  ({ RiggedCharacter, SEAT, BUTTOCK_DEPTH } = await import('../client/scene/rigged'));
  chars = await import('../client/scene/characters');
  for (const o of Object.keys(FILES) as Outfit[]) {
    const buf = fs.readFileSync(path.join(MODELS, 'chars', `${FILES[o]}.glb`));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    templates[o] = prepareCharacter(await new GLTFLoader().parseAsync(ab, ''), o);
  }
});

const build = (i: number, variant: 'normal' | 'hitler' = 'normal') => new RiggedCharacter(i, i, variant, templates[OUTFIT(i, variant)]);

function measure(c: InstanceType<Rigged['RiggedCharacter']>) {
  let visible = 0;
  let tris = 0;
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let shown = true;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) shown = shown && p.visible;
    if (!shown) return;
    visible++;
    const pos = m.geometry.getAttribute('position');
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
  });
  return { visible, tris };
}

function boneY(c: InstanceType<Rigged['RiggedCharacter']>, name: string): number {
  let y = NaN;
  c.group.traverse((o) => {
    if (o.name === name && (o as THREE.Bone).isBone) y = o.getWorldPosition(new THREE.Vector3()).y;
  });
  return y;
}

type Rig = InstanceType<Rigged['RiggedCharacter']>;

function bonePos(c: Rig, name: string): THREE.Vector3 {
  const v = new THREE.Vector3();
  c.group.traverse((o) => {
    if (o.name === name && (o as THREE.Bone).isBone) o.getWorldPosition(v);
  });
  return v;
}

/** Steps `secs` at 60 fps from `t0`; returns the time reached. */
function run(c: Rig, secs: number, t0 = 0): number {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) c.update(1 / 60, t0 + i / 60);
  return t0 + n / 60;
}

/** Distance from `p` to the line through `a` and `b`. */
function lineDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const d = b.clone().sub(a).normalize();
  const v = p.clone().sub(a);
  return v.addScaledVector(d, -v.dot(d)).length();
}

/** Box (group space, current pose) of the vertices whose strongest skin weight is one of the named bones. */
function skinnedBox(c: Rig, names: string[], keep?: (p: THREE.Vector3) => boolean): THREE.Box3 {
  c.group.updateMatrixWorld(true);
  let mesh!: THREE.SkinnedMesh;
  c.group.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  const { bones, boneInverses } = mesh.skeleton;
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  // Skinning as the renderer does it: the bone's world matrix times its inverse bind matrix, for the strongest bone.
  const toWorld = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, boneInverses[i]).multiply(mesh.bindMatrix));
  const want = new Set(names.map((n) => bones.findIndex((b) => b.name === n)));
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    let top = -1;
    for (let k = 0; k < 4; k++) {
      if (sw.getComponent(i, k) > w) {
        w = sw.getComponent(i, k);
        top = si.getComponent(i, k);
      }
    }
    if (!want.has(top)) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(toWorld[top]);
    if (!keep || keep(v)) box.expandByPoint(v);
  }
  return box;
}

const cases: [string, number, 'normal' | 'hitler'][] = [
  ...[...Array(10).keys()].map((i) => [`normal ${i}`, i, 'normal'] as [string, number, 'normal']),
  ['hitler 0', 0, 'hitler'],
];

describe.each(cases)('RiggedCharacter %s', (_key, style, variant) => {
  it('stays within the draw-call and triangle budget', () => {
    const { visible, tris } = measure(build(style, variant));
    expect(visible).toBeLessThanOrEqual(3);
    expect(tris).toBeLessThanOrEqual(6000);
  });

  it('sits with the head above the hips', () => {
    const c = build(style, variant);
    c.update(0.016, 0);
    c.group.updateMatrixWorld(true);
    const head = boneY(c, 'Head');
    const hips = boneY(c, 'Hips');
    expect(head).toBeGreaterThanOrEqual(1.1);
    expect(head).toBeLessThanOrEqual(1.5);
    // The hips bone sits in the pelvis, just above the seat top.
    expect(hips).toBeGreaterThanOrEqual(0.4);
    expect(hips).toBeLessThanOrEqual(0.55);
  });

  it('rests on the seat', () => {
    const c = build(style, variant);
    c.update(0.016, 0);
    const pelvisAndThighs = ['Body', 'Hips', 'UpperLegL', 'UpperLegR'];
    const all = skinnedBox(c, pelvisAndThighs);
    // The buttocks are the rear of the pelvis and thighs; the thighs slope down toward the knees.
    const buttocks = skinnedBox(c, pelvisAndThighs, (p) => p.z <= all.min.z + BUTTOCK_DEPTH);
    expect(Math.abs(buttocks.min.y - SEAT.top)).toBeLessThan(0.025);
    // Just in front of the backrest, not through it.
    expect(all.min.z).toBeGreaterThan(-SEAT.back - 0.005);
    expect(all.min.z).toBeLessThan(-SEAT.back + 0.05);
    // The thighs may sag toward the knees, but not far into the seat.
    expect(all.min.y).toBeGreaterThan(SEAT.top - 0.1);
  });

  it('puts its feet on the floor', () => {
    const c = build(style, variant);
    c.update(0.016, 0);
    const feet = skinnedBox(c, ['FootL', 'FootR']);
    expect(feet.min.y).toBeGreaterThan(-0.01);
    expect(feet.min.y).toBeLessThan(0.04);
  });

  it('has no hats or face details, only the cigarette and the armband besides the body', () => {
    const c = build(style, variant);
    let extra = 0;
    c.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) extra++;
    });
    expect(extra).toBe((c.smoker ? 1 : 0) + (variant === 'hitler' ? 1 : 0));
  });

  it('has the Patron members the game uses', () => {
    const c = build(style, variant);
    expect(c.hitMeshes).toHaveLength(1);
    expect(c.smoker).toBe(variant !== 'hitler' && style % 3 === 0);
    if (!c.smoker) expect(c.smokeEmit(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3())).toBe(-1);
    c.setLabel('Seat', '#fff');
    c.say('hello', 0);
    c.setHighlight(1);
    c.setTeamGlow(true);
    c.lookAt(new THREE.Vector3(0, 1, 2));
    c.setAim(new THREE.Vector3(1, 1, 1));
    c.setHandsUp(true);
    c.react('nod');
    c.recoil();
    for (let i = 0; i < 10; i++) c.update(0.05, i * 0.05);
    c.group.updateMatrixWorld(true);
    expect(c.gunPose().pos.y).toBeGreaterThan(0);
    c.die();
    for (let i = 0; i < 30; i++) c.update(0.1, 1 + i * 0.1);
    expect(c.dead).toBe(true);
    expect(() => c.dispose()).not.toThrow();
  });
});

describe('RiggedCharacter styles and disposal', () => {
  it('styles get different coat colours', () => {
    const colorAt = (c: InstanceType<Rigged['RiggedCharacter']>, t: CharacterTemplate, part: string) => {
      const mesh = c.hitMeshes[0] as THREE.SkinnedMesh;
      const a = mesh.geometry.getAttribute('color');
      const i = t.parts[part].start;
      return [a.getX(i), a.getY(i), a.getZ(i)];
    };
    const a = build(0);
    const b = build(1);
    expect(colorAt(a, templates.suit, 'Shirt')).not.toEqual(colorAt(b, templates.suit, 'Shirt'));
    expect(colorAt(a, templates.suit, 'Skin')).not.toEqual(colorAt(b, templates.suit, 'Skin'));
    // And the template keeps its own colours.
    const tc = templates.suit.mesh.geometry.getAttribute('color');
    expect([tc.getX(0), tc.getY(0), tc.getZ(0)]).not.toEqual(colorAt(a, templates.suit, 'Shirt'));
    const dress = build(2);
    const dress2 = build(7);
    expect(colorAt(dress, templates.dress, 'Dress')).not.toEqual(colorAt(dress2, templates.dress, 'Dress'));
  });

  it('dispose leaves the template geometry intact', () => {
    const g = templates.suit.mesh.geometry;
    const before = g.getAttribute('position').array.length;
    const c = build(0);
    expect((c.hitMeshes[0] as THREE.Mesh).geometry).not.toBe(g);
    c.dispose();
    expect(g.getAttribute('position').array.length).toBe(before);
    expect(g.getAttribute('skinWeight').array.length).toBeGreaterThan(0);
    expect(() => build(3)).not.toThrow();
  });

  it('createCharacter falls back to the procedural patron without assets', () => {
    const p = chars.createCharacter(0, 0, 'normal');
    expect(p).toBeInstanceOf(chars.Character);
    p.dispose();
  });
});

describe('RiggedCharacter motion', () => {
  const TARGET = new THREE.Vector3(0.3, 1.25, 2);

  it.each(['gun', 'point'] as const)('extends the right arm toward the target and points the revolver along it (%s)', (mode) => {
    const c = build(1);
    c.update(1 / 60, 0);
    const rest = bonePos(c, 'PalmR');
    c.setAim(TARGET, mode);
    const t = run(c, 1);
    expect(lineDistance(bonePos(c, 'PalmR'), bonePos(c, 'ShoulderR'), TARGET)).toBeLessThan(0.12);
    const { pos, quat } = c.gunPose();
    const barrel = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    expect(barrel.dot(TARGET.clone().sub(pos).normalize())).toBeGreaterThanOrEqual(0.9);
    // The top of the revolver stays up.
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(quat).y).toBeGreaterThan(0.8);
    c.setAim(null);
    run(c, 1.5, t);
    c.update(1 / 60, 0);
    expect(bonePos(c, 'PalmR').distanceTo(rest)).toBeLessThan(0.03);
  });

  it('kicks the aim arm up on recoil and settles back', () => {
    const c = build(1);
    c.setAim(TARGET);
    const t = run(c, 1.5);
    const dirY = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, -1).applyQuaternion(q).y;
    const level = dirY(c.gunPose().quat);
    c.recoil();
    c.update(1 / 60, t);
    expect(dirY(c.gunPose().quat)).toBeGreaterThan(level + 0.2);
    run(c, 0.5, t);
    expect(dirY(c.gunPose().quat)).toBeCloseTo(level, 1);
  });

  it('raises both hands above the head when aimed at, and lowers them again', () => {
    const c = build(1);
    c.update(1 / 60, 0);
    const restL = bonePos(c, 'PalmL');
    const restR = bonePos(c, 'PalmR');
    c.setHandsUp(true);
    const t = run(c, 1);
    const head = bonePos(c, 'Head').y;
    expect(bonePos(c, 'PalmL').y).toBeGreaterThan(head - 0.05);
    expect(bonePos(c, 'PalmR').y).toBeGreaterThan(head - 0.05);
    // Palms face forward.
    const palm = c.group.getObjectByName('PalmL')!.getWorldQuaternion(new THREE.Quaternion());
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(palm).z).toBeGreaterThan(0.7);
    c.setHandsUp(false);
    run(c, 1.5, t);
    c.update(1 / 60, 0);
    expect(bonePos(c, 'PalmL').distanceTo(restL)).toBeLessThan(0.03);
    expect(bonePos(c, 'PalmR').distanceTo(restR)).toBeLessThan(0.03);
  });

  it('smokers lift the cigarette to the mouth on a drag and lower it again', () => {
    const c = build(0);
    c.update(1 / 60, 0);
    const rest = bonePos(c, 'PalmL');
    const tip = new THREE.Vector3();
    const mouth = new THREE.Vector3();
    const dir = new THREE.Vector3();
    expect(c.smokeEmit(tip, mouth, dir)).toBe(0);
    c.startDrag();
    // Peak: the arm has arrived and holds.
    const t = run(c, 1.1);
    expect(c.smokeEmit(tip, mouth, dir)).toBeGreaterThanOrEqual(0);
    expect(tip.distanceTo(mouth)).toBeLessThan(0.1);
    expect(dir.z).toBeGreaterThan(0.8);
    expect(bonePos(c, 'PalmL').distanceTo(rest)).toBeGreaterThan(0.3);
    // The exhale shows up while the arm is lowering, then the hand is back.
    let exhaled = 0;
    let now = t;
    for (let i = 0; i < 150; i++, now += 1 / 60) {
      c.update(1 / 60, now);
      exhaled = Math.max(exhaled, c.smokeEmit(tip, mouth, dir));
    }
    expect(exhaled).toBeGreaterThan(0.5);
    c.update(1 / 60, 0);
    expect(bonePos(c, 'PalmL').distanceTo(rest)).toBeLessThan(0.03);
  });

  it('smokeEmit has nothing to emit for non-smokers, the dead and raised hands', () => {
    const emit = (c: Rig) => c.smokeEmit(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
    const other = build(1);
    run(other, 0.2);
    expect(emit(other)).toBe(-1);
    const dead = build(0);
    dead.dead = true;
    run(dead, 0.2);
    expect(emit(dead)).toBe(-1);
    const up = build(0);
    up.setHandsUp(true);
    run(up, 1);
    expect(emit(up)).toBe(-1);
    up.setHandsUp(false);
    run(up, 1.5, 1);
    expect(emit(up)).toBeGreaterThanOrEqual(0);
  });

  it('the cigarette hides while the hands are up', () => {
    const c = build(0);
    expect(measure(c).visible).toBe(2);
    c.setHandsUp(true);
    run(c, 1);
    expect(measure(c).visible).toBe(1);
  });

  it('dies into a slump, and a patron that is already dead starts in it', () => {
    const alive = build(1);
    alive.update(1 / 60, 0);
    const aliveY = bonePos(alive, 'Head').y;
    const shot = build(1);
    shot.die();
    run(shot, 1.4 + 0.2);
    const shotY = bonePos(shot, 'Head').y;
    expect(shotY).toBeLessThan(aliveY - 0.1);
    const snapped = build(1);
    snapped.dead = true;
    snapped.update(1 / 60, 0);
    expect(Math.abs(bonePos(snapped, 'Head').y - shotY)).toBeLessThan(0.02);
  });

  it('tips the chair while dying', () => {
    const chair = new THREE.Object3D();
    const c = build(1);
    c.chair = chair;
    c.update(1 / 60, 0);
    expect(chair.rotation.x).toBe(0);
    c.die();
    run(c, 0.2, 1);
    expect(chair.rotation.x).toBeGreaterThan(0.1);
  });

  it('turns the head toward what it looks at', () => {
    const c = build(1);
    const forward = () => new THREE.Vector3(0, 0, 1).applyQuaternion(c.group.getObjectByName('Head')!.getWorldQuaternion(new THREE.Quaternion()));
    c.lookAt(new THREE.Vector3(2, 1.4, 1)); // the patron's left is +x
    run(c, 1.5);
    expect(forward().x).toBeGreaterThan(0.5);
    c.lookAt(new THREE.Vector3(-2, 1.4, 1));
    run(c, 1.5, 2);
    expect(forward().x).toBeLessThan(-0.5);
    c.lookAt(new THREE.Vector3(0, 3, 1)); // above: the head tips up
    run(c, 1.5, 4);
    expect(forward().y).toBeGreaterThan(0.2);
  });

  it('reactions move the head and the fist reaction lifts the right hand', () => {
    const c = build(1);
    c.update(1 / 60, 0);
    const rest = bonePos(c, 'PalmR');
    c.react('fist');
    run(c, 0.3);
    expect(bonePos(c, 'PalmR').y).toBeGreaterThan(rest.y + 0.05);
    const s = build(1);
    const forwardX = () => new THREE.Vector3(0, 0, 1).applyQuaternion(s.group.getObjectByName('Head')!.getWorldQuaternion(new THREE.Quaternion())).x;
    s.react('shake');
    let widest = 0;
    for (let i = 0; i < 60; i++) {
      s.update(1 / 60, i / 60);
      widest = Math.max(widest, Math.abs(forwardX()));
    }
    expect(widest).toBeGreaterThan(0.15);
  });
});

describe('seat constants', () => {
  it('match the seat measured on the real chair', async () => {
    (globalThis as any).self ??= globalThis;
    (globalThis as any).createImageBitmap ??= async () => ({ width: 4, height: 4, close() {} });
    const buf = fs.readFileSync(path.join(MODELS, 'props', 'chair_wood.glb'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const chair = chairModel({ chair_wood: (await new GLTFLoader().parseAsync(ab, '')).scene });
    const seat = chairSeat(chair);
    expect(Math.abs(SEAT.top - seat.top)).toBeLessThan(0.01);
    expect(Math.abs(SEAT.front - seat.front)).toBeLessThan(0.01);
    expect(Math.abs(SEAT.back - seat.back)).toBeLessThan(0.01);
  });
});
