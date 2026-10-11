import { describe, expect, it } from 'vitest';
import { REACTION_DUR, blinkScale, mouthOpen, nextBlinkDelay, reactionPose, type Reaction, type ReactionPose } from '../client/scene/life';

const kinds = Object.keys(REACTION_DUR) as Reaction[];
const pose = (): ReactionPose => ({ pitch: 9, yaw: 9, lean: 9, armLift: 9 });
const sweep = (k: Reaction) => Array.from({ length: 201 }, (_, i) => ({ ...reactionPose(k, (i / 200) * REACTION_DUR[k], pose()) }));

describe('reactionPose', () => {
  it('is zero at start and end', () => {
    for (const k of kinds) {
      for (const t of [0, REACTION_DUR[k], -1, 99]) {
        expect(reactionPose(k, t, pose())).toEqual({ pitch: 0, yaw: 0, lean: 0, armLift: 0 });
      }
    }
  });
  it('nod pitches down without yaw', () => {
    const s = sweep('nod');
    expect(Math.max(...s.map((p) => p.pitch))).toBeGreaterThan(0.1);
    expect(s.every((p) => p.yaw === 0 && p.pitch >= 0)).toBe(true);
  });
  it('shake yaws both ways', () => {
    const s = sweep('shake');
    expect(Math.max(...s.map((p) => Math.abs(p.yaw)))).toBeGreaterThan(0.2);
    expect(s.some((p) => p.yaw > 0.1) && s.some((p) => p.yaw < -0.1)).toBe(true);
  });
  it('recoil leans back fast', () => {
    expect(reactionPose('recoil', 0.15 * REACTION_DUR.recoil, pose()).lean).toBeLessThan(-0.15);
  });
  it('fist raises then slams', () => {
    expect(reactionPose('fist', 0.5 * REACTION_DUR.fist, pose()).armLift).toBeGreaterThan(0.6);
    expect(reactionPose('fist', 0.65 * REACTION_DUR.fist, pose()).armLift).toBeLessThan(0.05);
  });
  it('returns the same object', () => {
    const o = pose();
    expect(reactionPose('nod', 0.3, o)).toBe(o);
  });
});

describe('blink and mouth', () => {
  it('blinkScale shape', () => {
    expect(blinkScale(0)).toBe(1);
    expect(blinkScale(0.07)).toBeCloseTo(0.1, 5);
    expect(blinkScale(0.14)).toBe(1);
  });
  it('nextBlinkDelay in [2,6]', () => {
    expect(nextBlinkDelay(0)).toBe(2);
    expect(nextBlinkDelay(1)).toBe(6);
  });
  it('mouthOpen stays in [0,1]', () => {
    for (let t = 0; t < 60; t += 0.013) {
      const m = mouthOpen(t);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});
