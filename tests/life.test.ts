import { describe, expect, it } from 'vitest';
import { DEATH_DUR, REACTION_DUR, SMOKE_CYCLE, SMOKE_DUR, blinkScale, deathPose, isSmoker, mouthOpen, nextBlinkDelay, nextDragDelay, reactionPose, smokePose, type Reaction, type ReactionPose, type SmokePose } from '../client/scene/life';

const kinds = Object.keys(REACTION_DUR) as Reaction[];
const pose = (): ReactionPose => ({ pitch: 9, yaw: 9, lean: 9, armLift: 9, thumb: 9 });
const sweep = (k: Reaction) => Array.from({ length: 201 }, (_, i) => ({ ...reactionPose(k, (i / 200) * REACTION_DUR[k], pose()) }));

describe('reactionPose', () => {
  it('is zero at start and end', () => {
    for (const k of kinds) {
      for (const t of [0, REACTION_DUR[k], -1, 99]) {
        expect(reactionPose(k, t, pose())).toEqual({ pitch: 0, yaw: 0, lean: 0, armLift: 0, thumb: 0 });
      }
    }
  });
  it.each([['thumbsUp', 1], ['thumbsDown', -1]] as const)('%s holds the thumb without yawing', (k, sign) => {
    const dur = REACTION_DUR[k];
    expect(reactionPose(k, 0.5 * dur, pose()).thumb * sign).toBeGreaterThan(0.99);
    expect(Math.abs(reactionPose(k, 0.02 * dur, pose()).thumb)).toBeLessThan(0.1);
    expect(Math.abs(reactionPose(k, 0.98 * dur, pose()).thumb)).toBeLessThan(0.1);
    const s = sweep(k);
    expect(s.every((p) => p.yaw === 0 && p.thumb * sign >= 0 && p.pitch >= 0 && p.pitch < 0.1)).toBe(true);
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
    expect(reactionPose('thumbsUp', 0.3, o)).toBe(o);
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

describe('deathPose', () => {
  const dp = (t: number) => deathPose(t, { lean: 9, drop: 9, push: 9, roll: 9, headPitch: 9, chairTip: 9, chairYaw: 9 });
  it('starts at rest', () => {
    expect(dp(0)).toEqual({ lean: 0, drop: 0, push: 0, roll: 0, headPitch: 0, chairTip: 0, chairYaw: 0 });
  });
  it('jerks back with the chair tipped', () => {
    const p = dp(0.1);
    expect(p.lean).toBeLessThan(-0.3);
    expect(p.chairTip).toBeGreaterThan(0.25);
  });
  it('ends exactly at the slumped pose', () => {
    const final = { lean: 0.75, drop: 0.12, push: 0.18, roll: 0.18, headPitch: 0.9, chairTip: 0.06, chairYaw: 0.12 };
    expect(dp(DEATH_DUR)).toEqual(final);
    expect(dp(99)).toEqual(final);
  });
  it('falls forward monotonically', () => {
    const lean = Array.from({ length: 10 }, (_, i) => dp(0.22 + (i / 9) * 0.73).lean);
    for (let i = 1; i < lean.length; i++) expect(lean[i]).toBeGreaterThan(lean[i - 1]);
  });
});

describe('isSmoker and nextDragDelay', () => {
  it('every third normal style smokes', () => {
    const ids = Array.from({ length: 10 }, (_, i) => i).filter((i) => isSmoker(i, 'normal'));
    expect(ids).toEqual([0, 3, 6, 9]);
  });
  it('hitler never smokes', () => {
    for (let i = 0; i < 10; i++) expect(isSmoker(i, 'hitler')).toBe(false);
  });
  it('nextDragDelay in [8,15)', () => {
    expect(nextDragDelay(0)).toBe(8);
    expect(nextDragDelay(0.999)).toBeCloseTo(14.993, 5);
    expect(nextDragDelay(0.999)).toBeLessThan(15);
  });
});

describe('smokePose', () => {
  const sp = (t: number) => smokePose(t, { reach: 9, ember: 9, exhale: 9 } as SmokePose);
  const { raise, hold } = SMOKE_CYCLE;
  const mid = raise + hold / 2;
  const sweep = Array.from({ length: 1001 }, (_, i) => ({ ...sp((i / 1000) * 1.1 * SMOKE_DUR) }));
  it('rests at the ends', () => {
    for (const t of [0, -1, SMOKE_DUR, SMOKE_DUR + 5]) expect(sp(t)).toEqual({ reach: 0, ember: 0.35, exhale: 0 });
  });
  it('holds the cigarette at the mouth mid-drag', () => {
    expect(sp(mid).reach).toBe(1);
    expect(sp(mid).ember).toBe(1);
  });
  it('reach rises monotonically through the raise', () => {
    const r = Array.from({ length: 50 }, (_, i) => sp((i / 49) * raise).reach);
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]);
  });
  it('exhales only once lowering begins', () => {
    expect(sp(raise * 0.5).exhale).toBe(0);
    expect(sp(mid).exhale).toBe(0);
    expect(sp(raise + hold + 0.3).exhale).toBeGreaterThan(0.5);
    expect(sp(SMOKE_DUR).exhale).toBe(0);
  });
  it('ember never dims below idle and everything stays in [0,1]', () => {
    for (const p of sweep) {
      expect(p.ember).toBeGreaterThanOrEqual(0.35);
      for (const v of [p.reach, p.ember, p.exhale]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
