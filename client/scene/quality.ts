/**
 * Render quality. In 'auto' it watches frame times and steps quality down (never back up, so it can't
 * oscillate) when a machine can't keep up. Each step is a pixel ratio; the last one also drops shadows.
 * 'high' pins the top step and 'low' the bottom one.
 */
export type GraphicsMode = 'auto' | 'high' | 'low';
export const GRAPHICS_MODES: GraphicsMode[] = ['auto', 'high', 'low'];
const PREF_KEY = 'sh-graphics';

export function readGraphicsPref(): GraphicsMode {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return GRAPHICS_MODES.includes(v as GraphicsMode) ? (v as GraphicsMode) : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveGraphicsPref(mode: GraphicsMode) {
  try {
    localStorage.setItem(PREF_KEY, mode);
  } catch {
    /* ignore */
  }
}

export interface QualityStep {
  pixelRatio: number;
  shadows: boolean;
}

/** Frames slower than this are a hitch or a backgrounded tab, not the steady frame rate. */
const IGNORE_MS = 250;
/** Shaders compile and textures upload at first: judge only after this. */
const WARMUP_MS = 4000;
const WINDOW_MS = 2000;
/** Mean frame time that counts as slow (about 40 fps). */
const SLOW_MS = 25;
/** Slow windows in a row before stepping down. */
const STRIKES = 2;

export function qualitySteps(devicePixelRatio: number): QualityStep[] {
  const top = Math.min(devicePixelRatio, 1.5);
  const ratios = [top, ...[1, 0.75].filter((r) => r < top)];
  return [...ratios.map((pixelRatio) => ({ pixelRatio, shadows: true })), { pixelRatio: ratios.at(-1)!, shadows: false }];
}

export class AdaptiveQuality {
  readonly steps: QualityStep[];
  level = 0;
  mode: GraphicsMode = 'auto';
  private elapsed = 0;
  private windowMs = 0;
  private windowFrames = 0;
  private strikes = 0;

  constructor(devicePixelRatio: number, mode: GraphicsMode = 'auto') {
    this.steps = qualitySteps(devicePixelRatio);
    this.setMode(mode);
  }

  /** Switching to 'auto' starts over from the top step and re-judges the machine. */
  setMode(mode: GraphicsMode): QualityStep {
    this.mode = mode;
    this.level = mode === 'low' ? this.steps.length - 1 : 0;
    this.elapsed = this.windowMs = this.windowFrames = this.strikes = 0;
    return this.current;
  }

  get current(): QualityStep {
    return this.steps[this.level];
  }

  /** Feed one frame's duration; returns the new step when quality should drop, else null. */
  frame(ms: number): QualityStep | null {
    if (this.mode !== 'auto' || ms <= 0 || ms > IGNORE_MS || this.level === this.steps.length - 1) return null;
    this.elapsed += ms;
    if (this.elapsed < WARMUP_MS) return null;
    this.windowMs += ms;
    this.windowFrames++;
    if (this.windowMs < WINDOW_MS) return null;
    const mean = this.windowMs / this.windowFrames;
    this.windowMs = 0;
    this.windowFrames = 0;
    this.strikes = mean > SLOW_MS ? this.strikes + 1 : 0;
    if (this.strikes < STRIKES) return null;
    this.strikes = 0;
    this.level++;
    return this.current;
  }
}
