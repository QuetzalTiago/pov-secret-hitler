// Pure math for patron liveliness (blink, mouth flap, one-shot reactions). No three.js so it runs in node tests.
import { ease } from './tween';

export type Reaction = 'nod' | 'shake' | 'recoil' | 'fist';

export const REACTION_DUR: Record<Reaction, number> = { nod: 0.9, shake: 1.0, recoil: 0.8, fist: 0.9 };

/** Radians. lean is extra body.rotation.x (negative = back); armLift raises the right arm above rest. */
export interface ReactionPose {
  pitch: number;
  yaw: number;
  lean: number;
  armLift: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number) => a * a * (3 - 2 * a);

export function reactionPose(kind: Reaction, t: number, out: ReactionPose): ReactionPose {
  out.pitch = out.yaw = out.lean = out.armLift = 0;
  const dur = REACTION_DUR[kind];
  if (t <= 0 || t >= dur) return out;
  const u = t / dur;
  const env = Math.sin(Math.PI * u);
  switch (kind) {
    case 'nod':
      out.pitch = 0.25 * env * (0.5 - 0.5 * Math.cos(2 * Math.PI * 2 * u));
      break;
    case 'shake':
      out.yaw = 0.35 * env * Math.sin(2 * Math.PI * 3 * u);
      break;
    case 'recoil': {
      // Quick out, slow back.
      const a = smooth(u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85);
      out.lean = -0.22 * a;
      out.pitch = -0.18 * a;
      break;
    }
    case 'fist':
      if (u < 0.5) out.armLift = 0.7 * (1 - (1 - u / 0.5) ** 2);
      else if (u < 0.62) out.armLift = 0.7 * (1 - smooth((u - 0.5) / 0.12));
      if (u > 0.55 && u < 0.75) out.lean = 0.08 * Math.sin(Math.PI * ((u - 0.55) / 0.2));
      break;
  }
  return out;
}

export function nextBlinkDelay(rand: number): number {
  return 2 + rand * 4;
}

export const BLINK_DUR = 0.14;

/** Eye Y scale t seconds after a blink starts: 1 -> 0.1 at the midpoint -> 1. */
export function blinkScale(t: number): number {
  if (t <= 0 || t >= BLINK_DUR) return 1;
  return 1 - 0.9 * Math.sin((Math.PI * t) / BLINK_DUR);
}

/** Uneven talking flap, 0..1. */
export function mouthOpen(t: number): number {
  return clamp01(Math.abs(Math.sin(t * 17) * Math.sin(t * 5.3 + 1)) * 1.3 + 0.1 * Math.sin(t * 9) ** 2);
}

export const DEATH_DUR = 1.4;

/** Execution pose. lean = body.rotation.x (negative = back), drop/push in metres, chairTip = radians tipped backward. */
export interface DeathPose {
  lean: number;
  drop: number;
  push: number;
  roll: number;
  headPitch: number;
  chairTip: number;
  chairYaw: number;
}

const JERK = 0.1;
const HANG = 0.22;
const FALL = 0.95;

/** t seconds since the shot: sharp jerk back, brief hang, fall onto the table while the chair slams down, settle. */
export function deathPose(t: number, out: DeathPose): DeathPose {
  out.lean = out.drop = out.push = out.roll = out.headPitch = out.chairTip = out.chairYaw = 0;
  if (t <= 0) return out;
  if (t >= DEATH_DUR) {
    out.lean = 0.75;
    out.drop = 0.12;
    out.push = 0.18;
    out.roll = 0.18;
    out.headPitch = 0.9;
    out.chairTip = 0.06;
    out.chairYaw = 0.12;
    return out;
  }
  const j = ease.outQuad(t / JERK);
  const f = ease.inOutCubic((t - HANG) / (FALL - HANG));
  out.lean = -0.38 * j + 1.13 * f;
  out.push = -0.06 * j + 0.24 * f;
  out.headPitch = -0.55 * j + 1.45 * f;
  out.drop = 0.12 * f;
  out.roll = 0.18 * f;
  out.chairTip = 0.32 * j;
  if (t > HANG) out.chairTip = 0.32 * (1 - ease.outBounce((t - HANG) / 0.63));
  if (t > FALL) {
    const s = ease.outQuad((t - FALL) / (DEATH_DUR - FALL));
    out.chairTip = 0.06 * s;
    out.chairYaw = 0.12 * s;
  }
  return out;
}
