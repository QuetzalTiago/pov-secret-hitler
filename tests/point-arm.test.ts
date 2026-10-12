import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pointingArm } from '../client/scene/pointarm';

const FOV = 68;
const deg = (r: number) => (r * 180) / Math.PI;

/** Camera-space point 3 m along the ray through NDC (x, y). */
function target(cam: THREE.PerspectiveCamera, x: number, y: number) {
  const ray = new THREE.Vector3(x, y, 0.5).unproject(cam).normalize();
  return ray.multiplyScalar(3);
}

describe('pointingArm', () => {
  for (const aspect of [16 / 9, 4 / 3]) {
    const cam = new THREE.PerspectiveCamera(FOV, aspect, 0.05, 60);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    it(`keeps the wrist straight and the hand in view at aspect ${aspect.toFixed(2)}`, () => {
      for (let nx = -0.9; nx <= 0.901; nx += 0.15) {
        for (let ny = -0.9; ny <= 0.901; ny += 0.15) {
          const t = target(cam, nx, ny);
          const { elbow, grip, dir } = pointingArm(t);
          const wrist = deg(dir.angleTo(t.clone().sub(grip).normalize()));
          const ndc = grip.clone().project(cam);
          const at = `target ndc (${nx.toFixed(2)}, ${ny.toFixed(2)})`;
          // Aiming straight down at the screen edge, the forearm cannot dip as steeply as the view ray (31 degrees):
          // the hand must stay in view with the elbow below it.
          expect(wrist, at).toBeLessThanOrEqual(32);
          expect(Math.abs(ndc.x), at).toBeLessThan(0.95);
          expect(Math.abs(ndc.y), at).toBeLessThan(0.95);
          expect(elbow.y, at).toBeLessThan(grip.y);
          expect(elbow.z, at).toBeGreaterThan(grip.z);
          expect(dir.length()).toBeCloseTo(1, 5);
        }
      }
    });
  }

  it('puts the right hand on the right when pointing straight ahead', () => {
    expect(pointingArm(new THREE.Vector3(0, 0, -3)).grip.x).toBeGreaterThan(0);
  });

  it('the old fixed elbow bent the wrist far past 25 degrees for a low-left target', () => {
    const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 60);
    cam.updateMatrixWorld();
    const t = target(cam, -0.8, -0.6);
    const grip = new THREE.Vector3(0.15, -0.1, -0.45);
    const fore = grip.clone().sub(new THREE.Vector3(0.34, -0.5, 0.05)).normalize();
    expect(deg(fore.angleTo(t.clone().sub(grip).normalize()))).toBeGreaterThan(40);
  });
});
