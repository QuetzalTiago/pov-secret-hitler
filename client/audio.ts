// All sounds are synthesized with WebAudio. No audio files.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let ambience: { stop(): void } | null = null;

export function initAudio() {
  if (ctx) {
    void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}

export function isMuted() {
  return muted;
}

function noiseBuffer(seconds: number, brown = false): AudioBuffer | null {
  if (!ctx) return null;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = white;
  }
  return buf;
}

function noise(opts: {
  dur: number;
  freq: number;
  q?: number;
  type?: BiquadFilterType;
  gain?: number;
  attack?: number;
  sweepTo?: number;
  delay?: number;
}) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + (opts.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(opts.dur + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.setValueAtTime(opts.freq, t);
  if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + opts.dur);
  f.Q.value = opts.q ?? 1;
  const g = ctx.createGain();
  const peak = opts.gain ?? 0.5;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + (opts.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + opts.dur + 0.05);
}

function tone(opts: { freq: number; dur: number; type?: OscillatorType; gain?: number; slideTo?: number; delay?: number }) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + (opts.delay ?? 0);
  const o = ctx.createOscillator();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(opts.freq, t);
  if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + opts.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + opts.dur + 0.05);
}

export const sfx = {
  slap() {
    noise({ dur: 0.18, freq: 1800, q: 0.7, gain: 0.9, type: 'lowpass' });
    tone({ freq: 140, dur: 0.15, gain: 0.5, slideTo: 60 });
  },
  slide() {
    noise({ dur: 0.45, freq: 900, sweepTo: 2400, q: 0.8, gain: 0.18, attack: 0.08 });
  },
  flip() {
    noise({ dur: 0.08, freq: 3000, q: 2, gain: 0.35 });
    noise({ dur: 0.06, freq: 2000, q: 2, gain: 0.25, delay: 0.07 });
  },
  draw() {
    for (let i = 0; i < 3; i++) noise({ dur: 0.12, freq: 2600, q: 1.5, gain: 0.2, delay: i * 0.12 });
  },
  toss() {
    noise({ dur: 0.3, freq: 2000, sweepTo: 600, q: 1, gain: 0.2 });
    noise({ dur: 0.1, freq: 1200, q: 1, gain: 0.25, delay: 0.3 });
  },
  thud() {
    tone({ freq: 90, dur: 0.35, gain: 0.7, slideTo: 40 });
    noise({ dur: 0.2, freq: 400, type: 'lowpass', gain: 0.5 });
  },
  click() {
    noise({ dur: 0.04, freq: 4000, q: 4, gain: 0.25 });
  },
  hover() {
    tone({ freq: 880, dur: 0.05, gain: 0.03, type: 'triangle' });
  },
  tick() {
    tone({ freq: 1400, dur: 0.04, gain: 0.08, type: 'square' });
  },
  cock() {
    noise({ dur: 0.05, freq: 3500, q: 6, gain: 0.5 });
    noise({ dur: 0.07, freq: 1800, q: 5, gain: 0.5, delay: 0.12 });
  },
  gunshot() {
    noise({ dur: 0.9, freq: 3000, type: 'lowpass', sweepTo: 200, gain: 1.6, attack: 0.002 });
    tone({ freq: 160, dur: 0.6, gain: 1.0, slideTo: 30 });
    noise({ dur: 1.6, freq: 500, type: 'lowpass', gain: 0.25, delay: 0.15 }); // room tail
  },
  envelope() {
    noise({ dur: 0.35, freq: 2500, sweepTo: 5000, q: 0.6, gain: 0.2 });
  },
  stamp() {
    tone({ freq: 70, dur: 0.25, gain: 0.8, slideTo: 40 });
    noise({ dur: 0.12, freq: 900, type: 'lowpass', gain: 0.6 });
  },
  chime(good: boolean) {
    const notes = good ? [523, 659, 784, 1047] : [392, 370, 311, 247];
    notes.forEach((f, i) => tone({ freq: f, dur: 0.6, gain: 0.18, type: 'triangle', delay: i * 0.16 }));
  },
  night() {
    tone({ freq: 110, dur: 2.5, gain: 0.2, type: 'sawtooth', slideTo: 55 });
    noise({ dur: 2, freq: 300, type: 'lowpass', gain: 0.2 });
  },
  heartbeat() {
    tone({ freq: 60, dur: 0.18, gain: 0.6 });
    tone({ freq: 55, dur: 0.18, gain: 0.45, delay: 0.25 });
  },
  chat() {
    tone({ freq: 660, dur: 0.08, gain: 0.06, type: 'triangle' });
  },
  glass() {
    tone({ freq: 2400 + Math.random() * 800, dur: 0.5, gain: 0.03, type: 'sine' });
  },
};

/** Low room tone: brown noise murmur plus a mains hum. */
export function startAmbience() {
  if (!ctx || !master || ambience) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(4, true);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.value = 0.12;
  src.connect(f).connect(g).connect(master);
  src.start();
  const hum = ctx.createOscillator();
  hum.frequency.value = 50;
  const hg = ctx.createGain();
  hg.gain.value = 0.015;
  hum.connect(hg).connect(master);
  hum.start();
  const clink = setInterval(() => Math.random() < 0.3 && sfx.glass(), 4000);
  ambience = {
    stop() {
      src.stop();
      hum.stop();
      clearInterval(clink);
    },
  };
}
