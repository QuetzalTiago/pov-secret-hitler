import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { handGeometry } from '../client/scene/hands';
import { GUN_GRIP, GUN_SCALE } from '../client/scene/gun';
import { fistOnGun } from '../client/scene/gunhold';

const HAND = 1.2;
const BACK_FACE = 0.025; // the cylinder's back face, gun-local z

// Thumb vertices: the fingers and palm stay within |x| 0.04 of the fist's axis, only the thumb limb reaches past
// x 0.041 (its centreline is at 0.04 with radius ~0.0105), measured on the unrotated geometry; rotateY keeps vertex order.
const raw = handGeometry('fist', -1);
const rawPos = raw.getAttribute('position');
const thumb = new Set<number>();
for (let i = 0; i < rawPos.count; i++) if (rawPos.getX(i) > 0.041) thumb.add(i);
const fist = raw.clone().rotateY(Math.PI);
const pos = fist.getAttribute('position');

const gunPoses = [
  { name: 'level', pos: new THREE.Vector3(), q: new THREE.Quaternion() },
  { name: 'yawed', pos: new THREE.Vector3(0.3, -0.2, -0.5), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.7, 0)) },
  { name: 'pitched', pos: new THREE.Vector3(-0.1, 0.4, -0.6), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0)) },
];

describe('fistOnGun', () => {
  for (const g of gunPoses) {
    it(`wraps the grip with the thumb on top (${g.name})`, () => {
      const pose = fistOnGun(g.pos, g.q, HAND);
      const inv = g.q.clone().invert();
      const toGun = (w: THREE.Vector3) => w.sub(g.pos).applyQuaternion(inv).divideScalar(GUN_SCALE);
      const box = new THREE.Box3();
      const all = new THREE.Vector3();
      const th = new THREE.Vector3();
      const p = new THREE.Vector3();
      let minZ = Infinity;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).multiplyScalar(HAND).applyQuaternion(pose.quaternion).add(pose.position);
        toGun(p);
        box.expandByPoint(p);
        all.add(p);
        if (thumb.has(i)) th.add(p);
        minZ = Math.min(minZ, p.z);
      }
      all.divideScalar(pos.count);
      th.divideScalar(thumb.size);
      const wrist = toGun(pose.wrist.clone());
      expect(thumb.size).toBeGreaterThan(20);
      expect(box.containsPoint(GUN_GRIP)).toBe(true); // (a)
      expect(wrist.z).toBeGreaterThan(GUN_GRIP.z); // (b)
      expect(th.y).toBeGreaterThan(all.y); // (c)
      expect(minZ).toBeGreaterThan(BACK_FACE - 0.005); // (d)
    });
  }
});
