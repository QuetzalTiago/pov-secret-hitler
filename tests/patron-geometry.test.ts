import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  aimArmGeometry,
  armGeometry,
  armbandGeometry,
  CIGARETTE_TIP,
  cigaretteGeometry,
  coatButtonsGeometry,
  collarGeometry,
  eyesGeometry,
  faceDetailGeometry,
  fingerGeometry,
  hatGeometry,
  headSkinGeometry,
  lapelGeometry,
  limbGeometry,
  mouthGeometry,
  neckGeometry,
  paintGeometry,
  peakedCapGeometry,
  shirtGeometry,
  tieGeometry,
  torsoFront,
  torsoGeometry,
  uniformGeometry,
  type FaceDetailOptions,
  type HatKind,
} from '../client/scene/patron';

function stats(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const size = new THREE.Vector3();
  g.boundingBox!.getSize(size);
  return { size, box: g.boundingBox!, tris: g.getAttribute('position').count / 3 };
}

function expectSmoothMesh(g: THREE.BufferGeometry) {
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.index).toBeNull();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  expect(pos).toBeDefined();
  expect(nor).toBeDefined();
  expect(nor.count).toBe(pos.count);
  for (let i = 0; i < pos.count * 3; i++) {
    expect(Number.isFinite(pos.array[i])).toBe(true);
    expect(Number.isFinite(nor.array[i])).toBe(true);
  }
}

describe('body geometry', () => {
  it('torso is a rounded coat spanning the old proportions', () => {
    const g = torsoGeometry();
    expectSmoothMesh(g);
    const { size, box, tris } = stats(g);
    expect(tris).toBeGreaterThan(200);
    expect(size.x).toBeGreaterThan(0.4);
    expect(size.x).toBeLessThan(0.7);
    expect(box.min.y).toBeGreaterThan(0.5);
    expect(box.max.y).toBeLessThan(1.25);
    expect(size.z).toBeLessThan(size.x);
  });

  it('torsoFront follows the coat surface', () => {
    expect(torsoFront(0.99)).toBeGreaterThan(0.15);
    expect(torsoFront(0.99)).toBeLessThan(0.25);
  });

  it('arms are smooth capsules between the joints', () => {
    for (const side of [-1, 1] as const) {
      const g = armGeometry(side);
      expectSmoothMesh(g);
      const { box, tris } = stats(g);
      expect(tris).toBeGreaterThan(200);
      expect(Math.sign(box.max.x + box.min.x)).toBe(side);
      expect(box.max.y).toBeGreaterThan(1.1);
      expect(box.min.y).toBeLessThan(0.85);
    }
    const aim = aimArmGeometry();
    expectSmoothMesh(aim);
    expect(stats(aim).box.max.z).toBeGreaterThan(0.55);
    expectSmoothMesh(fingerGeometry());
  });

  it('limbGeometry spans its endpoints with rounded ends', () => {
    const g = limbGeometry(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.5, 0), 0.05, 0.04);
    expectSmoothMesh(g);
    const { box } = stats(g);
    expect(box.min.y).toBeCloseTo(-0.05, 2);
    expect(box.max.y).toBeCloseTo(0.54, 2);
    expect(box.max.x).toBeCloseTo(0.05, 2);
  });

  it('neck, shirt and tie are small separate pieces', () => {
    for (const g of [neckGeometry(), shirtGeometry(), tieGeometry()]) {
      expectSmoothMesh(g);
      expect(stats(g).size.x).toBeLessThan(0.2);
    }
  });

  it('tie has a knot, a blade widening to a pointed tip, and lies in front of the coat', () => {
    const g = tieGeometry();
    expectSmoothMesh(g);
    const p = g.getAttribute('position');
    const { box } = stats(g);
    expect(box.max.y).toBeGreaterThan(1.12);
    expect(box.min.y).toBeLessThan(0.87);
    let tipX = 0;
    let lowest = Infinity;
    const widthIn = (lo: number, hi: number) => {
      let w = 0;
      for (let i = 0; i < p.count; i++) if (p.getY(i) >= lo && p.getY(i) <= hi) w = Math.max(w, Math.abs(p.getX(i)));
      return 2 * w;
    };
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < lowest) {
        lowest = p.getY(i);
        tipX = p.getX(i);
      }
      expect(p.getZ(i)).toBeGreaterThanOrEqual(torsoFront(p.getY(i)));
    }
    expect(Math.abs(tipX)).toBeLessThan(0.005);
    expect(widthIn(0.87, 0.92)).toBeGreaterThan(widthIn(1.095, 1.125) + 0.015);
  });

  it('collar, lapels and buttons are mirrored smooth pieces lying on the coat', () => {
    for (const g of [collarGeometry(), lapelGeometry(), coatButtonsGeometry()]) {
      expectSmoothMesh(g);
      const { box } = stats(g);
      expect(box.min.x).toBeCloseTo(-box.max.x, 3);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) expect(p.getZ(i)).toBeGreaterThanOrEqual(torsoFront(p.getY(i)));
    }
    const lapel = stats(lapelGeometry()).box;
    expect(lapel.max.y).toBeGreaterThan(1.1);
    expect(lapel.min.y).toBeLessThan(0.86);
  });

  it('paintGeometry adds a per-vertex colour', () => {
    const g = paintGeometry(neckGeometry(), 0xff0000);
    const c = g.getAttribute('color');
    expect(c.count).toBe(g.getAttribute('position').count);
    expect(c.getX(0)).toBeGreaterThan(0.9);
    expect(c.getY(0)).toBe(0);
  });
});

describe('uniform geometry', () => {
  it('belt, strap, brass and armband', () => {
    const u = uniformGeometry();
    expectSmoothMesh(u.dark);
    expectSmoothMesh(u.brass);
    expect(stats(u.dark).box.min.y).toBeGreaterThan(0.6);
    const a = armbandGeometry();
    expectSmoothMesh(a.band);
    expectSmoothMesh(a.disc);
  });
});

describe('head geometry', () => {
  it('skull is a dense sphere of radius ~0.15 with ears and a nose', () => {
    const g = headSkinGeometry();
    expectSmoothMesh(g);
    const { size, box, tris } = stats(g);
    expect(tris).toBeGreaterThan(600);
    expect(size.x).toBeGreaterThan(0.29);
    expect(size.x).toBeLessThan(0.36);
    expect(box.max.y).toBeCloseTo(0.168, 2);
    expect(box.min.y).toBeCloseTo(-0.168, 2);
    expect(box.max.z).toBeGreaterThan(0.18); // nose tip
    expect(box.max.z).toBeLessThan(0.22);
  });

  it('eyes are both in one geometry centred at y 0', () => {
    const g = eyesGeometry();
    expectSmoothMesh(g);
    const { size, box } = stats(g);
    expect(size.x).toBeGreaterThan(0.11);
    expect(size.x).toBeLessThan(0.16);
    expect(box.min.y).toBeCloseTo(-box.max.y, 4);
  });

  it('mouth is a small flat capsule', () => {
    const g = mouthGeometry();
    expectSmoothMesh(g);
    const { size } = stats(g);
    expect(size.x).toBeCloseTo(0.07, 2);
    expect(size.y).toBeLessThan(0.02);
  });

  it('face details grow with the variant options', () => {
    const base: FaceDetailOptions = { browTilt: 0.25, mustache: 'none', beard: false, hair: false, fringe: false };
    const brows = faceDetailGeometry(base);
    expectSmoothMesh(brows);
    const trisOf = (o: Partial<FaceDetailOptions>) => stats(faceDetailGeometry({ ...base, ...o })).tris;
    expect(trisOf({ mustache: 'wide' })).toBeGreaterThan(stats(brows).tris);
    expect(trisOf({ mustache: 'toothbrush' })).toBeGreaterThan(stats(brows).tris);
    expect(trisOf({ beard: true })).toBeGreaterThan(stats(brows).tris);
    expect(trisOf({ hair: true })).toBeGreaterThan(stats(brows).tris);
    expect(trisOf({ fringe: true })).toBeGreaterThan(stats(brows).tris);
  });
});

describe('hats', () => {
  const kinds: HatKind[] = ['fedora', 'tophat', 'bowler', 'cap', 'beret'];
  for (const kind of kinds) {
    it(`${kind} sits on top of the head`, () => {
      const g = hatGeometry(kind);
      expectSmoothMesh(g);
      const { box, tris, size } = stats(g);
      expect(tris).toBeGreaterThan(200);
      expect(box.min.y).toBeGreaterThan(0.05);
      expect(box.max.y).toBeGreaterThan(0.18);
      expect(box.max.y).toBeLessThan(0.45);
      expect(size.x).toBeGreaterThan(0.3);
      expect(size.x).toBeLessThan(0.55);
    });
  }

  it('peaked cap splits into cloth, trim and badge', () => {
    const c = peakedCapGeometry();
    for (const g of [c.cloth, c.trim, c.badge]) expectSmoothMesh(g);
    expect(stats(c.cloth).box.max.y).toBeGreaterThan(0.2);
    expect(stats(c.trim).box.max.z).toBeGreaterThan(0.15); // visor sticks out front
  });
});

describe('cigaretteGeometry', () => {
  it('is a thin vertex-coloured stick along +Z ending at the tip offset', () => {
    const g = cigaretteGeometry();
    const { size, box } = stats(g);
    expect(g.getAttribute('color')).toBeDefined();
    expect(size.z).toBeCloseTo(CIGARETTE_TIP, 3);
    expect(box.min.z).toBeCloseTo(0, 3);
    expect(box.max.z).toBeCloseTo(CIGARETTE_TIP, 3);
    expect(size.x).toBeGreaterThan(0.011);
    expect(size.y).toBeLessThanOrEqual(0.0121);
  });
});

describe('fresh geometry per call', () => {
  it('never shares a geometry between calls', () => {
    expect(torsoGeometry()).not.toBe(torsoGeometry());
    expect(headSkinGeometry()).not.toBe(headSkinGeometry());
    expect(hatGeometry('fedora')).not.toBe(hatGeometry('fedora'));
    expect(eyesGeometry()).not.toBe(eyesGeometry());
  });
});
