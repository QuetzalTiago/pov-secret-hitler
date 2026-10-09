// All sounds are synthesized with WebAudio. No audio files.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

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
    // Shared room reverb: a synthesized impulse response (decaying stereo noise), no audio files.
    reverb = ctx.createConvolver();
    reverb.buffer = impulse(2.4, 2.6);
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.9;
    reverbSend.connect(reverb).connect(master);
    void loadSamples();
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

let reverb: ConvolverNode | null = null;
let reverbSend: GainNode | null = null;

function impulse(seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx!.sampleRate * seconds);
  const buf = ctx!.createBuffer(2, len, ctx!.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Routes a node to the speakers, plus some of it into the room reverb. */
function out(node: AudioNode, wet = 0) {
  node.connect(master!);
  if (wet > 0 && reverbSend && ctx) {
    const w = ctx.createGain();
    w.gain.value = wet;
    node.connect(w).connect(reverbSend);
  }
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

// One shared white-noise buffer per AudioContext; grown only if a longer sound is requested.
let cachedNoise: { ctx: AudioContext; buf: AudioBuffer; seconds: number } | null = null;

function whiteNoise(seconds: number): AudioBuffer | null {
  if (!ctx) return null;
  if (!cachedNoise || cachedNoise.ctx !== ctx || cachedNoise.seconds < seconds) {
    const len = Math.max(seconds, 2.5);
    cachedNoise = { ctx, buf: noiseBuffer(len)!, seconds: len };
  }
  return cachedNoise.buf;
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
  wet?: number;
}) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + (opts.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise(opts.dur + 0.05);
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
  src.connect(f).connect(g);
  out(g, opts.wet);
  src.start(t);
  src.stop(t + opts.dur + 0.05);
}

function tone(opts: { freq: number; dur: number; type?: OscillatorType; gain?: number; slideTo?: number; delay?: number; wet?: number }) {
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
  o.connect(g);
  out(g, opts.wet);
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
  /** Revolver shot: supersonic crack, chest-thumping boom, the room ringing, then the brass casing. */
  gunshot() {
    noise({ dur: 0.05, freq: 5000, type: 'highpass', gain: 2.2, attack: 0.0008, wet: 0.6 }); // crack
    noise({ dur: 0.7, freq: 2400, type: 'lowpass', sweepTo: 140, gain: 1.8, attack: 0.002, wet: 1.0 }); // blast
    tone({ freq: 110, dur: 0.5, gain: 1.4, slideTo: 32, wet: 0.5 }); // boom
    tone({ freq: 58, dur: 0.9, gain: 0.9, slideTo: 28, type: 'triangle' }); // sub thump
    noise({ dur: 2.2, freq: 380, type: 'lowpass', gain: 0.3, delay: 0.08, attack: 0.05, wet: 1.2 }); // rumble tail
    // Ears ringing.
    tone({ freq: 3900, dur: 2.4, gain: 0.025, delay: 0.12, type: 'sine' });
    // Spent casing bouncing on the floor.
    [0.55, 0.72, 0.84, 0.92].forEach((d, i) => tone({ freq: 3200 + i * 240, dur: 0.18, gain: 0.07 / (i + 1), type: 'triangle', delay: d, wet: 0.4 }));
  },
  /** A body slumping onto the table: a falling groan, a heavy thud, rattling glasses. */
  death() {
    if (!ctx || !master) return;
    const t = ctx.currentTime + 0.25;
    // Groan: a buzzy voice through a vowel-ish formant, pitch sinking as it fades.
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(62, t + 1.1);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 4;
    vib.connect(vibGain).connect(o.frequency);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.setValueAtTime(700, t);
    formant.frequency.exponentialRampToValueAtTime(380, t + 1.1);
    formant.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(formant).connect(g);
    out(g, 0.5);
    o.start(t);
    vib.start(t);
    o.stop(t + 1.3);
    vib.stop(t + 1.3);
    // Body hits the table, then glasses rattle.
    tone({ freq: 75, dur: 0.45, gain: 1.1, slideTo: 38, delay: 0.95, wet: 0.4 });
    noise({ dur: 0.3, freq: 600, type: 'lowpass', gain: 0.8, delay: 0.95, wet: 0.4 });
    [1.05, 1.12, 1.2].forEach((d, i) => tone({ freq: 2100 + i * 380, dur: 0.35, gain: 0.05, type: 'sine', delay: d, wet: 0.6 }));
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
};


// ---------- recorded samples (see client/sfx/CREDITS.md for sources and licenses) ----------

import deathUrl1 from './sfx/death-1.mp3';
import deathUrl2 from './sfx/death-2.mp3';
import deathUrl3 from './sfx/death-3.mp3';
import gunshotUrl from './sfx/gunshot.mp3';
import jaUrl from './sfx/ja.mp3';
import neinUrl from './sfx/nein.mp3';

const SAMPLE_URLS = { gunshot: gunshotUrl, ja: jaUrl, nein: neinUrl, death1: deathUrl1, death2: deathUrl2, death3: deathUrl3 };
type SampleName = keyof typeof SAMPLE_URLS;
const samples = new Map<SampleName, AudioBuffer>();

async function loadSamples() {
  await Promise.all(
    (Object.entries(SAMPLE_URLS) as [SampleName, string][]).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        samples.set(name, await ctx!.decodeAudioData(await res.arrayBuffer()));
      } catch {
        /* missing or undecodable: the synthesized fallback plays instead */
      }
    }),
  );
}

/** Plays a recorded sample; returns false if it is not available (caller falls back to synthesis). */
function sample(name: SampleName, opts: { gain?: number; wet?: number; delay?: number; rate?: number } = {}): boolean {
  const buf = samples.get(name);
  if (!ctx || !master || !buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.rate ?? 1;
  const g = ctx.createGain();
  g.gain.value = opts.gain ?? 1;
  src.connect(g);
  out(g, opts.wet);
  src.start(ctx.currentTime + (opts.delay ?? 0));
  return true;
}

/** Recorded sounds, each with a synthesized fallback. */
export const voice = {
  /** One shout for the whole table once the ballots flip: JA! if the government passed, NEIN! if not. */
  vote(passed: boolean) {
    if (!sample(passed ? 'ja' : 'nein', { gain: 1.1, wet: 0.35 })) sfx.chime(passed);
  },
  gunshot() {
    if (!sample('gunshot', { gain: 1.2, wet: 0.35, rate: 0.97 + Math.random() * 0.06 })) return sfx.gunshot();
    // Spent casing pinging on the floor afterwards.
    [0.6, 0.77, 0.89, 0.97].forEach((d, i) => tone({ freq: 3200 + i * 240, dur: 0.18, gain: 0.06 / (i + 1), type: 'triangle', delay: d, wet: 0.4 }));
  },
  death() {
    const pick = (['death1', 'death2', 'death3'] as const)[Math.floor(Math.random() * 3)];
    if (!sample(pick, { gain: 1.0, wet: 0.3, delay: 0.2 })) return sfx.death();
    // The body hits the table and the glasses rattle.
    tone({ freq: 75, dur: 0.45, gain: 1.0, slideTo: 38, delay: 1.0, wet: 0.4 });
    noise({ dur: 0.3, freq: 600, type: 'lowpass', gain: 0.7, delay: 1.0, wet: 0.4 });
    [1.1, 1.17, 1.25].forEach((d, i) => tone({ freq: 2100 + i * 380, dur: 0.35, gain: 0.05, type: 'sine', delay: d, wet: 0.6 }));
  },
};

// ---------- background music (see client/music/CREDITS.md) ----------

import bassWalkerUrl from './music/bass-walker.mp3';

const MUSIC_VOLUME = 0.35;
let musicOn = readMusicPref();
let musicEl: HTMLAudioElement | null = null;
let musicGain: GainNode | null = null;
let musicFilter: BiquadFilterNode | null = null;
let mood = '';

function readMusicPref(): boolean {
  try {
    return localStorage.getItem('sh-music') !== 'off';
  } catch {
    return true;
  }
}

export function isMusicOn() {
  return musicOn;
}

/** Starts the jukebox (needs a user gesture first, like all browser audio). */
export function startMusic() {
  if (!ctx || musicEl) return;
  musicEl = new Audio(bassWalkerUrl); // one track, looping
  musicEl.preload = 'auto';
  musicEl.loop = true;
  // Own gain node (not the SFX master) so music and effects mute independently; a gentle low-pass
  // makes it sound like the bar's jukebox rather than headphones.
  const src = ctx.createMediaElementSource(musicEl);
  musicFilter = ctx.createBiquadFilter();
  musicFilter.type = 'lowpass';
  musicFilter.frequency.value = 7000;
  musicGain = ctx.createGain();
  musicGain.gain.value = musicOn ? MUSIC_VOLUME : 0;
  src.connect(musicFilter).connect(musicGain).connect(ctx.destination);
  if (musicOn) void musicEl.play().catch(() => {});
}

export function setMusicOn(on: boolean) {
  musicOn = on;
  try {
    localStorage.setItem('sh-music', on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  if (!musicEl || !musicGain || !ctx) return;
  if (on) {
    void musicEl.play().catch(() => {});
    mood = ''; // re-apply the current mood's volume
  } else {
    musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => !musicOn && musicEl?.pause(), 600);
  }
}

/** Night dims the music; a drawn revolver muffles and quiets it. */
export function setMusicMood(night: boolean, danger: boolean) {
  if (!ctx || !musicGain || !musicFilter || !musicOn) return;
  const key = `${night}:${danger}`;
  if (key === mood) return;
  mood = key;
  const t = ctx.currentTime;
  musicGain.gain.setTargetAtTime(MUSIC_VOLUME * (danger ? 0.55 : night ? 0.5 : 1), t, 0.6);
  musicFilter.frequency.setTargetAtTime(danger ? 900 : night ? 2500 : 7000, t, 0.6);
}
