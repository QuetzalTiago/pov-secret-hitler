/** Resting pitch of the view and the clamped yaw/pitch range of a seated head turn (rad). */
export const BASE_PITCH = -0.36;
export const YAW_LIMIT = 1.9;
export const PITCH_MIN = -0.55;
export const PITCH_MAX = 0.5;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** View-relative yaw/pitch (rad, camera looks down -Z at 0, yaw turns toward -X) that puts `to` in the centre when seen from `from`. */
export function lookAngles(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return {
    yaw: clamp(Math.atan2(-dx, -dz), -YAW_LIMIT, YAW_LIMIT),
    pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz)) - BASE_PITCH, PITCH_MIN, PITCH_MAX),
  };
}
