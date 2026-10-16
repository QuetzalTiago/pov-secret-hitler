import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeParts } from './patron';

// Pure geometry for the Mauser C96 "Broomhandle" pistol (no materials, no scene): two merged, non-indexed,
// smooth-normal geometries in the gun's local frame. Points along -Z, barrel axis at y 0.03, muzzle at z -0.185,
// box magazine ahead of the trigger guard, ring hammer at the back, grooved wooden broomhandle grip below/behind.
// The caller owns and disposes both.

const BARREL_Y = 0.03;
/** The pistol's scale in the scene (props.ts pistol()); the points below are unscaled, gun-local. */
export const GUN_SCALE = 1.4;
/** Where the closed hand holds the grip: inside the broomhandle, below the receiver and behind the trigger guard. */
export const GUN_GRIP = new THREE.Vector3(0, -0.025, 0.072);
/** The muzzle, on the bore axis at the barrel's front face. */
export const GUN_MUZZLE = new THREE.Vector3(0, BARREL_Y, -0.185);

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

/** Thin round barrel with a recessed muzzle and a wider chamber section, plus the front sight blade. */
function barrelGeometry(): THREE.BufferGeometry {
  const barrel: [number, number][] = [
    [0, -0.176], [0.004, -0.176], [0.004, -0.185], [0.0075, -0.185], [0.0075, -0.07], [0.0095, -0.07], [0.0095, -0.04], [0, -0.04],
  ];
  return mergeParts([
    smooth(lathe(barrel, 16, BARREL_Y)),
    box(0.003, 0.007, 0.01, BARREL_Y + 0.0105, -0.178, 0.001),
  ]);
}

/** The box magazine ahead of the trigger guard: body, floorplate and a raised milled panel on each side. */
function magazineGeometry(): THREE.BufferGeometry {
  return mergeParts([
    box(0.026, 0.049, 0.048, -0.0105, -0.028),
    box(0.028, 0.006, 0.052, -0.036, -0.028, 0.002),
    box(0.002, 0.03, 0.034, -0.012, -0.028, 0.0008).translate(0.0135, 0, 0),
    box(0.002, 0.03, 0.034, -0.012, -0.028, 0.0008).translate(-0.0135, 0, 0),
  ]);
}

/** Ring hammer at the back of the receiver: a torus whose ring lies in the y-z plane. */
function ring(radius: number, tube: number, y: number, z: number): THREE.BufferGeometry {
  return smooth(new THREE.TorusGeometry(radius, tube, 8, 20).rotateY(Math.PI / 2).translate(0, y, z));
}

/** Broomhandle grip profile in (z, y): slim, sloping back to a rounded butt. */
function gripShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.045, 0.012);
  s.lineTo(0.09, 0.012);
  s.bezierCurveTo(0.098, -0.02, 0.106, -0.055, 0.112, -0.074);
  s.quadraticCurveTo(0.114, -0.085, 0.104, -0.085);
  s.lineTo(0.076, -0.085);
  s.quadraticCurveTo(0.066, -0.085, 0.066, -0.074);
  s.bezierCurveTo(0.058, -0.05, 0.05, -0.02, 0.045, 0.012);
  return s;
}

/** The wooden grip with horizontal grooves cut into its flanks (x pulled inward on a cosine in y). */
function gripGeometry(): THREE.BufferGeometry {
  const half = 0.011;
  const g = plate(new THREE.Shape(gripShape().getSpacedPoints(96)), 0.014, 0.004);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    if (Math.abs(x) <= half * 0.6 || y < -0.075 || y > 0) continue;
    const edge = THREE.MathUtils.smoothstep(Math.min(y + 0.075, -y), 0, 0.004);
    const cut = 0.05 * edge * (0.5 - 0.5 * Math.cos((y * Math.PI * 2) / 0.009));
    pos.setX(i, x * (1 - cut));
  }
  g.computeVertexNormals();
  return mergeParts([g]);
}

export function pistolGeometry(): { metal: THREE.BufferGeometry; grip: THREE.BufferGeometry } {
  const metal = mergeParts([
    barrelGeometry(),
    box(0.022, 0.034, 0.135, 0.029, 0.0225), // receiver, z -0.045..0.09: covers the whole grip top
    box(0.012, 0.007, 0.037, 0.049, 0.0535, 0.002), // bolt
    box(0.014, 0.007, 0.03, 0.0495, -0.03, 0.002), // tangent rear sight block
    magazineGeometry(),
    tube([[-0.002, 0.012], [0.004, -0.016], [0.02, -0.026], [0.038, -0.02], [0.045, 0.0], [0.046, 0.012]], 0.0032, 32, 8), // trigger guard
    tube([[0.014, 0.01], [0.016, -0.001], [0.018, -0.012]], 0.0018, 8, 6), // trigger
    ring(0.008, 0.0025, 0.05, 0.094), // hammer, cocked behind the receiver's back face
    ring(0.006, 0.0016, -0.092, 0.104), // lanyard ring
  ]);
  return { metal, grip: gripGeometry() };
}
