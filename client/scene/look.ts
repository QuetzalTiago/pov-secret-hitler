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

/** Largest believable captured-mouse step per event (px); bigger ones are pointer-lock warp spikes. */
export const MAX_LOOK_STEP = 150;
/** Quiet time after pointer lock turns on or off during which mouse movement is ignored (s). */
export const LOCK_SETTLE = 0.15;

/** The captured-mouse movement to apply as a look, or null to drop it (a spike or too soon after a lock change). */
export function lookStep(dx: number, dy: number, sinceLockChange: number): { dx: number; dy: number } | null {
  if (sinceLockChange < LOCK_SETTLE) return null;
  if (Math.abs(dx) > MAX_LOOK_STEP || Math.abs(dy) > MAX_LOOK_STEP) return null;
  return { dx, dy };
}

const clamp =(v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
