import { describe, expect, it } from 'vitest';
import { BASE_PITCH, LOCK_SETTLE, MAX_LOOK_STEP, PITCH_MAX, YAW_LIMIT, lookAngles, lookStep } from '../client/scene/look';

describe('lookStep', () => {
  const settled = LOCK_SETTLE + 1;
  it('passes a normal small movement through unchanged', () => {
    expect(lookStep(12, -7, settled)).toEqual({ dx: 12, dy: -7 });
  });
  it('drops a spike above the maximum on either axis', () => {
    expect(lookStep(MAX_LOOK_STEP + 1, 0, settled)).toBeNull();
    expect(lookStep(0, -(MAX_LOOK_STEP + 1), settled)).toBeNull();
  });
  it('drops movement right after a lock change and passes it once settled', () => {
    expect(lookStep(5, 5, LOCK_SETTLE - 0.01)).toBeNull();
    expect(lookStep(5, 5, LOCK_SETTLE + 0.01)).toEqual({ dx: 5, dy: 5 });
  });
});

const eye ={ x: 0, y: 1.27, z: 2 };

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
