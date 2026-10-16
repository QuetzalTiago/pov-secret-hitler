// Tiny dependency-free tween/timeline helper, ticked once per frame from Game.update.

export type Ease = (t: number) => number;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

const C1 = 1.70158;
const C3 = C1 + 1;
const N1 = 7.5625;
const D1 = 2.75;

/** Standard easings.net curves; each returns exactly 0 at t=0 and exactly 1 at t=1. */
export const ease = {
  linear: (t: number) => clamp01(t),
  outQuad: (t: number) => {
    t = clamp01(t);
    return 1 - (1 - t) * (1 - t);
  },
  inCubic: (t: number) => {
    t = clamp01(t);
    return t * t * t;
  },
  inOutCubic: (t: number) => {
    t = clamp01(t);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },
  outBack: (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = t - 1;
    return 1 + C3 * u * u * u + C1 * u * u;
  },
  outBounce: (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < 1 / D1) return N1 * t * t;
    if (t < 2 / D1) return N1 * (t -= 1.5 / D1) * t + 0.75;
    if (t < 2.5 / D1) return N1 * (t -= 2.25 / D1) * t + 0.9375;
    return N1 * (t -= 2.625 / D1) * t + 0.984375;
  },
};

/** Anything with a counter that pauses its own motion while a tween owns it (see Mover). */
export interface Holdable { hold: number }

export interface TweenOpts {
  /** Seconds. */
  dur: number;
  /** Seconds before the tween starts; its start values are captured when it does. */
  delay?: number;
  ease?: Ease;
  onUpdate?: (k: number) => void;
  onDone?: () => void;
  hold?: Holdable;
  /** Take `hold` when the tween is created rather than when its delay ends, so the object stays put while it waits. */
  holdFromStart?: boolean;
}

export interface Tween {
  readonly done: boolean;
  /** Stop without calling onDone. */
  cancel(): void;
}

interface Vec3 { x: number; y: number; z: number }

/** Quadratic Bezier from a to b whose midpoint (k=0.5) is the straight-line midpoint raised by `height`. */
export function arcPoint(a: Vec3, b: Vec3, height: number, k: number, out: Vec3): Vec3 {
  const u = 1 - k;
  const cy = (a.y + b.y) / 2 + 2 * height;
  out.x = u * u * a.x + 2 * u * k * ((a.x + b.x) / 2) + k * k * b.x;
  out.y = u * u * a.y + 2 * u * k * cy + k * k * b.y;
  out.z = u * u * a.z + 2 * u * k * ((a.z + b.z) / 2) + k * k * b.z;
  return out;
}

/** One running animation; subclasses say what to capture at start and how to write a frame. */
abstract class Item implements Tween {
  done = false;
  /** Called once when the tween finishes normally (not on cancel); used by sequence. */
  after: (() => void) | null = null;
  private started = false;
  private delay: number;
  private elapsed = 0;
  private ease: Ease;

  constructor(readonly target: object, private opts: TweenOpts, private owner: Tweens) {
    this.delay = opts.delay ?? 0;
    this.ease = opts.ease ?? ease.outQuad;
    if (opts.hold && opts.holdFromStart) opts.hold.hold++;
  }

  protected abstract capture(): void;
  protected abstract apply(e: number): void;
  protected abstract finishProps(): void;

  /** Advance by dt seconds; returns nothing, check `done`. */
  step(dt: number) {
    if (!this.started) {
      this.delay -= dt;
      if (this.delay > 0) return;
      dt = -this.delay;
      this.started = true;
      this.capture();
      if (this.opts.hold && !this.opts.holdFromStart) this.opts.hold.hold++;
    }
    this.elapsed += dt;
    const { dur, onUpdate } = this.opts;
    if (dur > 0 && this.elapsed < dur) {
      const e = this.ease(this.elapsed / dur);
      this.apply(e);
      if (onUpdate) onUpdate(e);
      return;
    }
    this.finish();
  }

  private finish() {
    this.release();
    this.finishProps();
    this.opts.onUpdate?.(1);
    this.opts.onDone?.();
    this.after?.();
  }

  private release() {
    this.done = true;
    this.owner.count--;
    if (this.opts.hold && (this.started || this.opts.holdFromStart)) this.opts.hold.hold--;
  }

  cancel() {
    if (this.done) return;
    this.release();
  }
}

class PropTween extends Item {
  private keys: string[];
  private from: number[] = [];

  constructor(target: object, private to: Record<string, number>, opts: TweenOpts, owner: Tweens) {
    super(target, opts, owner);
    this.keys = Object.keys(to);
  }
  protected capture() {
    const t = this.target as Record<string, number>;
    for (let i = 0; i < this.keys.length; i++) this.from[i] = t[this.keys[i]];
  }
  protected apply(e: number) {
    const t = this.target as Record<string, number>;
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[i];
      t[k] = this.from[i] + (this.to[k] - this.from[i]) * e;
    }
  }
  protected finishProps() {
    const t = this.target as Record<string, number>;
    for (const k of this.keys) t[k] = this.to[k];
  }
}

class ArcTween extends Item {
  private from: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(private pos: Vec3, private to: Vec3, private height: number, opts: TweenOpts, owner: Tweens) {
    super(pos, opts, owner);
  }
  protected capture() {
    this.from.x = this.pos.x;
    this.from.y = this.pos.y;
    this.from.z = this.pos.z;
  }
  protected apply(e: number) {
    arcPoint(this.from, this.to, this.height, e, this.pos);
  }
  protected finishProps() {
    this.pos.x = this.to.x;
    this.pos.y = this.to.y;
    this.pos.z = this.to.z;
  }
}

/** Handle for a chain of tweens run one after another. */
class SequenceHandle implements Tween {
  done = false;
  private cur: Tween | null = null;
  private i = 0;

  constructor(private steps: Array<() => Tween>) {}

  run() {
    while (!this.done) {
      if (this.i >= this.steps.length) {
        this.done = true;
        return;
      }
      const t = this.steps[this.i++]();
      if (t.done) continue;
      this.cur = t;
      (t as Item).after = () => this.run();
      return;
    }
  }

  cancel() {
    if (this.done) return;
    this.done = true;
    this.cur?.cancel();
  }
}

/** A set of running tweens, advanced by update(dt). */
export class Tweens {
  private list: Item[] = [];
  /** Number of running tweens (maintained by Item). */
  count = 0;

  get active(): number {
    return this.count;
  }

  private add<T extends Item>(item: T): T {
    this.count++;
    this.list.push(item);
    return item;
  }

  /** Animate numeric props of target (read when the tween starts) to the `to` values. */
  tween<T extends object>(target: T, to: Partial<Record<keyof T, number>>, opts: TweenOpts): Tween {
    return this.add(new PropTween(target, to as Record<string, number>, opts, this));
  }

  /** Move target along a Bezier arc whose midpoint is lifted by `height`. */
  arc(target: Vec3, to: Vec3, height: number, opts: TweenOpts): Tween {
    return this.add(new ArcTween(target, to, height, opts, this));
  }

  /** Run each factory only after the previous tween is done. */
  sequence(steps: Array<() => Tween>): Tween {
    const seq = new SequenceHandle(steps);
    seq.run();
    return seq;
  }

  /** Start one tween per item with delay i*gap; the caller passes the delay into its tween opts. */
  stagger<I>(items: I[], gap: number, start: (item: I, i: number, delay: number) => Tween): Tween[] {
    return items.map((item, i) => start(item, i, i * gap));
  }

  cancelTarget(target: object) {
    for (const item of this.list) if (item.target === target) item.cancel();
  }

  update(dt: number) {
    const list = this.list;
    // Tweens started from callbacks are appended past n and wait for the next update.
    const n = list.length;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const item = list[i];
      if (!item.done) item.step(dt);
      if (!item.done) list[w++] = item;
    }
    for (let i = n; i < list.length; i++) list[w++] = list[i];
    list.length = w;
  }
}

/** Client-only slow-motion factor, t = real seconds since the shot: hold 0.3 for 0.25 s, ease back to 1 by 0.85 s. */
export function slowmoScale(t: number): number {
  if (t < 0 || t >= 0.85) return 1;
  if (t <= 0.25) return 0.3;
  return 0.3 + 0.7 * ease.inOutCubic((t - 0.25) / 0.6);
}

export const tweens = new Tweens();

export function tween<T extends object>(target: T, to: Partial<Record<keyof T, number>>, opts: TweenOpts): Tween {
  return tweens.tween(target, to, opts);
}
export function arc(target: Vec3, to: Vec3, height: number, opts: TweenOpts): Tween {
  return tweens.arc(target, to, height, opts);
}
export function sequence(steps: Array<() => Tween>): Tween {
  return tweens.sequence(steps);
}
export function stagger<I>(items: I[], gap: number, start: (item: I, i: number, delay: number) => Tween): Tween[] {
  return tweens.stagger(items, gap, start);
}
