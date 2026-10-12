import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HAND_LAYER, fanLayer } from '../client/scene/handfan';

const CARD_THICKNESS = 0.003;

describe('fanLayer', () => {
  it('is centred and steps by HAND_LAYER', () => {
    for (const k of [2, 3]) {
      let sum = 0;
      for (let i = 0; i < k; i++) sum += fanLayer(i, k);
      expect(sum).toBeCloseTo(0, 12);
      for (let i = 1; i < k; i++) expect(fanLayer(i, k) - fanLayer(i - 1, k)).toBeCloseTo(HAND_LAYER, 12);
    }
    expect(fanLayer(0, 1)).toBe(0);
  });

  it('clears the card thickness with margin', () => {
    expect(HAND_LAYER).toBeGreaterThanOrEqual(2 * CARD_THICKNESS);
  });

  it('separates the own-hand fan along the normal, newest card nearest the camera', () => {
    const k = 3;
    const cards = [0, 1, 2].map((i) => {
      const off = i - (k - 1) / 2;
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 - 0.12)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -off * 0.08));
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const pos = new THREE.Vector3(off * 0.125, -Math.abs(off) * 0.01, -0.42).addScaledVector(normal, fanLayer(i, k));
      return { pos, normal };
    });
    for (let i = 1; i < k; i++) {
      const d = cards[i].pos.clone().sub(cards[i - 1].pos);
      expect(d.dot(cards[i].normal)).toBeGreaterThan(CARD_THICKNESS);
    }
    // Camera at the origin looks down -z, so a larger z is nearer.
    expect(cards[k - 1].pos.z).toBeGreaterThan(cards[0].pos.z);
  });
});
