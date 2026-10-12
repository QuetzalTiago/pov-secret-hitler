import { describe, expect, it } from 'vitest';
import { BASE_PITCH, PITCH_MAX, YAW_LIMIT, lookAngles } from '../client/scene/look';

const eye = { x: 0, y: 1.27, z: 2 };

describe('lookAngles', () => {
  it('straight ahead gives zero yaw', () => {
    expect(lookAngles(eye, { x: 0, y: 1.27, z: -3 }).yaw).toBeCloseTo(0);
  });
  it('a target on the left (-X) gives positive yaw', () => {
    expect(lookAngles(eye, { x: -2, y: 1.27, z: 0 }).yaw).toBeGreaterThan(0.5);
  });
  it('far behind-left clamps to the yaw limit', () => {
    expect(lookAngles(eye, { x: -3, y: 1.27, z: 5 }).yaw).toBe(YAW_LIMIT);
  });
  it('a high target clamps pitch to the maximum', () => {
    expect(lookAngles(eye, { x: 0, y: 9, z: 1.5 }).pitch).toBe(PITCH_MAX);
  });
  it('a target at eye height ahead gives -BASE_PITCH', () => {
    expect(lookAngles(eye, { x: 0, y: 1.27, z: -3 }).pitch).toBeCloseTo(-BASE_PITCH);
  });
});
