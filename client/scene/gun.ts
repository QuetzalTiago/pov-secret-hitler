import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeParts } from './patron';

// Pure geometry for the revolver (no materials, no scene): two merged, non-indexed, smooth-normal geometries in
// the gun's local frame. Points along -Z, barrel axis at y 0.03, muzzle at z -0.185, cylinder centred on z 0,
// grip below/behind. The caller owns and disposes both.

const BARREL_Y = 0.03;
const CYL_Y = 0.0145; // the top chamber lines up with the bore
const CYL_R = 0.026;
const CYL_HALF = 0.025;

/** Weld seams and re-derive smooth normals. */
function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-5);
  g.dispose();
  m.computeVertexNormals();
  return m;
}

/** Revolve (radius, z) points about the gun's Z axis at height y. Traverse front to back, outer wall first. */
function lathe(points: [number, number][], segments: number, y: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(points.map(([r, z]) => new THREE.Vector2(r, z)), segments)
    .rotateX(Math.PI / 2)
    .translate(0, y, 0);
}

function box(w: number, h: number, d: number, y: number, z: number, r = 0.003): THREE.BufferGeometry {
  return smooth(new RoundedBoxGeometry(w, h, d, 3, r).translate(0, y, z));
}

/** Tube along a smooth path through (z, y) points on the centre plane. */
function tube(path: [number, number][], radius: number, tubular: number, radial: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(path.map(([z, y]) => new THREE.Vector3(0, y, z)), false, 'centripetal');
  return smooth(new THREE.TubeGeometry(curve, tubular, radius, radial, false));
}

/** Extrude a profile drawn in (z, y) into a bevelled plate centred on x = 0. */
function plate(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 12,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // shape x -> gun z, extrusion -> gun x
  return smooth(g);
}

/** Barrel with a recessed muzzle and front sight, plus the ejector-rod shroud underneath. */
function barrelGeometry(): THREE.BufferGeometry {
  const barrel: [number, number][] = [
    [0, -0.176], [0.006, -0.176], [0.006, -0.185], [0.0095, -0.185], [0.0112, -0.1835], [0.0112, -0.17],
    [0.0108, -0.1], [0.0115, -0.06], [0.0135, -0.045], [0.0135, -0.026], [0, -0.026],
  ];
  const shroud: [number, number][] = [
    [0, -0.152], [0.0045, -0.152], [0.0066, -0.149], [0.0066, -0.141], [0.0056, -0.139], [0.0056, -0.026], [0, -0.026],
  ];
  return mergeParts([
    smooth(lathe(barrel, 16, BARREL_Y)),
    box(0.003, 0.007, 0.01, BARREL_Y + 0.0138, -0.175, 0.0012),
    smooth(lathe(shroud, 14, BARREL_Y - 0.0165)),
  ]);
}

/** Fluted cylinder: a lathe whose wall is pushed in at six flutes between the chambers, plus chamber-mouth rings. */
function cylinderGeometry(): THREE.BufferGeometry {
  const profile: [number, number][] = [[0, -CYL_HALF], [0.0215, -CYL_HALF], [0.0245, -0.0235], [CYL_R, -0.021]];
  for (let z = -0.015; z <= 0.0151; z += 0.005) profile.push([CYL_R, z]);
  profile.push([CYL_R, 0.021], [0.0245, 0.0235], [0.0215, CYL_HALF], [0, CYL_HALF]);
  const body = lathe(profile, 60, CYL_Y);
  const pos = body.getAttribute('position');
  const step = Math.PI / 3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const yr = pos.getY(i) - CYL_Y;
    const r = Math.hypot(x, yr);
    if (r < 0.024) continue;
    const a = Math.atan2(x, yr) + Math.PI; // chambers sit at multiples of 60 deg, flutes halfway between
    const m = (((a - step / 2) % step) + step) % step;
    const flute = Math.min(m, step - m);
    const fade = THREE.MathUtils.smoothstep(0.02 - Math.abs(pos.getZ(i)), 0, 0.006);
    const k = 1 - (0.0042 * fade * Math.exp(-((flute / 0.2) ** 2))) / r;
    pos.setXY(i, x * k, CYL_Y + yr * k);
  }
  const parts = [smooth(body)];
  for (let c = 0; c < 6; c++) {
    const a = c * step;
    parts.push(smooth(lathe([[0.0055, -0.02], [0.0055, -0.0262], [0.0086, -0.0262], [0.0086, -0.024], [0, -0.024]], 12, 0)
      .translate(Math.sin(a) * 0.0155, CYL_Y + Math.cos(a) * 0.0155, 0)));
  }
  return mergeParts(parts);
}

/** Hammer with a spur at the back top, in (z, y). */
function hammerGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0.07, 0.046);
  s.quadraticCurveTo(0.072, 0.062, 0.084, 0.068);
  s.quadraticCurveTo(0.094, 0.071, 0.102, 0.064);
  s.quadraticCurveTo(0.094, 0.058, 0.09, 0.046);
  s.closePath();
  return plate(s, 0.005, 0.0012);
}

/** Plow-handle grip profile in (z, y); the butt angles back and flares. */
function gripShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.036, 0.025);
  s.quadraticCurveTo(0.046, -0.045, 0.064, -0.083);
  s.quadraticCurveTo(0.082, -0.092, 0.1, -0.08);
  s.bezierCurveTo(0.106, -0.05, 0.098, -0.005, 0.088, 0.032);
  s.closePath();
  return s;
}

export function revolverGeometry(): { metal: THREE.BufferGeometry; grip: THREE.BufferGeometry } {
  const backstrap = smooth(new THREE.TubeGeometry(
    new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, -0.079, 0.101), new THREE.Vector3(0, -0.05, 0.107),
      new THREE.Vector3(0, -0.005, 0.099), new THREE.Vector3(0, 0.032, 0.089),
    ), 16, 0.0042, 8, false));
  const heel = smooth(new THREE.SphereGeometry(0.0042, 8, 6).translate(0, -0.079, 0.101));
  const metal = mergeParts([
    barrelGeometry(),
    cylinderGeometry(),
    box(0.024, 0.046, 0.062, 0.03, 0.056), // frame body, its front face is the recoil shield
    box(0.014, 0.011, 0.052, 0.0465, 0.004, 0.0035), // top strap over the cylinder
    tube([[0.04, 0.014], [0.031, 0.004], [0.027, -0.009], [0.032, -0.022], [0.044, -0.029], [0.053, -0.026]], 0.0035, 32, 8), // trigger guard
    tube([[0.04, 0.008], [0.038, -0.004], [0.035, -0.014], [0.034, -0.02]], 0.0022, 8, 6), // trigger
    hammerGeometry(),
    backstrap,
    heel,
  ]);
  const grip = mergeParts([plate(gripShape(), 0.014, 0.004)]);
  return { metal, grip };
}
