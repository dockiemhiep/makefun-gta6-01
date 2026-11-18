// audio.js: a tiny procedural WebAudio synth for NEON TIDE. No audio files: one-shots, the player's
// engine hum and the police siren are all built from oscillators and noise. The AudioContext is
// created lazily on the first user gesture; every call is a silent no-op until then.
import { world, on } from './world.js';

const MUTE_KEY = 'neontide.mute';
const MASTER_VOLUME = 0.5;

let ctx = null;
let master = null;
let noiseBuffer = null;
let initialised = false;
let muted = readStoredMute();
let engine = null;
let siren = null;
let sirenWanted = false;

function readStoredMute() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function storeMute() {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch (e) {
    /* storage unavailable: mute just will not persist */
  }
}

export function initAudio() {
  if (initialised) return;
  initialised = true;
  world.sfx = playSound;
  on('wantedChanged', (e) => {
    sirenWanted = !!e && e.level > 0;
    setSiren(sirenWanted);
  });
  on('missionComplete', () => playSound('missionSting'));
  on('missionFailed', () => playSound('fail'));
  on('pickup', () => playSound('pickup'));
  on('busted', () => playSound('fail'));
  on('wasted', () => playSound('fail'));
}

export function unlockAudio() {
  try {
    if (!ctx) {
      const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!Ctor) return;
      ctx = new Ctor();
      buildMasterChain();
      buildNoiseBuffer();
      buildEngine();
      buildSiren();
      setSiren(sirenWanted);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) {
    ctx = null;
    master = null;
  }
}

function buildMasterChain() {
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_VOLUME;
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor);
  compressor.connect(ctx.destination);
}

function buildNoiseBuffer() {
  const length = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
}

export function toggleMute() {
  muted = !muted;
  storeMute();
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
  return muted;
}

export const isMuted = () => muted;

// ---- Building blocks -------------------------------------------------------------------------
/** A gain node that rises instantly to `peak` and decays to silence over `dur` seconds. */
function envelope(t, peak, dur, attack = 0.005) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(master);
  return g;
}

/** A filtered noise burst. */
function noiseBurst(t, dur, volume, filterType, freq, freqEnd = freq) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  src.connect(filter);
  filter.connect(envelope(t, volume, dur));
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

/** A tone whose pitch glides from `freq` to `freqEnd`. */
function tone(t, type, freq, freqEnd, dur, volume, attack = 0.005) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  osc.connect(envelope(t, volume, dur, attack));
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** A run of notes: each is [frequency, startOffset, duration]. */
function melody(t, type, notes, volume) {
  for (const [freq, offset, dur] of notes) tone(t + offset, type, freq, freq, dur, volume);
}

// ---- One-shot sounds ---------------------------------------------------------------------------
const SOUNDS = {
  gunshot: (t, v) => {
    noiseBurst(t, 0.18, 0.9 * v, 'lowpass', 6000, 400);
    tone(t, 'sine', 140, 40, 0.14, 0.9 * v);
  },
  punch: (t, v) => {
    noiseBurst(t, 0.07, 0.5 * v, 'bandpass', 900, 300);
    tone(t, 'sine', 120, 50, 0.1, 0.8 * v);
  },
  crash: (t, v) => {
    noiseBurst(t, 0.6, 0.9 * v, 'lowpass', 3000, 200);
    tone(t, 'sine', 90, 30, 0.35, 1 * v);
    noiseBurst(t + 0.03, 0.12, 0.5 * v, 'highpass', 2500, 2500);
  },
  pickup: (t, v) => melody(t, 'square', [[659, 0, 0.08], [988, 0.08, 0.14]], 0.25 * v),
  missionSting: (t, v) => {
    const notes = [[392, 0, 0.14], [494, 0.12, 0.14], [587, 0.24, 0.14], [784, 0.36, 0.5]];
    melody(t, 'sawtooth', notes, 0.22 * v);
    melody(t, 'square', notes.map(([f, o, d]) => [f / 2, o, d]), 0.12 * v);
  },
  fail: (t, v) => {
    tone(t, 'sawtooth', 440, 220, 0.4, 0.25 * v);
    tone(t + 0.3, 'sawtooth', 294, 110, 0.6, 0.25 * v);
  },
  uiClick: (t, v) => tone(t, 'square', 1200, 800, 0.04, 0.15 * v),
  carDoor: (t, v) => {
    noiseBurst(t, 0.08, 0.5 * v, 'bandpass', 700, 400);
    tone(t + 0.02, 'sine', 180, 80, 0.08, 0.5 * v);
  },
  horn: (t, v) => {
    tone(t, 'square', 392, 392, 0.4, 0.18 * v, 0.02);
    tone(t, 'square', 494, 494, 0.4, 0.18 * v, 0.02);
  },
  starUp: (t, v) => {
    melody(t, 'square', [[880, 0, 0.1], [660, 0.12, 0.1], [880, 0.24, 0.18]], 0.22 * v);
  },
  tireScreech: (t, v) => {
    noiseBurst(t, 0.4, 0.3 * v, 'bandpass', 2200, 1600);
  },
};

export function playSound(name, opts = {}) {
  try {
    const play = SOUNDS[name];
    if (!play || !ctx || !master || ctx.state !== 'running') return;
    const volume = Math.max(0, Math.min(1, opts && opts.volume !== undefined ? opts.volume : 1));
    if (volume > 0) play(ctx.currentTime, volume);
  } catch (e) {
    /* audio must never break the game */
  }
}

// ---- Continuous voices ------------------------------------------------------------------------
function buildEngine() {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 300;
  filter.connect(gain);
  gain.connect(master);
  const oscs = [['sawtooth', 0], ['square', 7], ['sawtooth', -9]].map(([type, detune]) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.value = 50;
    osc.connect(filter);
    osc.start();
    return osc;
  });
  engine = { gain, filter, oscs };
}

export function setEngine(active, speed01 = 0, throttle01 = 0) {
  if (!ctx || !engine) return;
  try {
    const t = ctx.currentTime;
    const speed = Math.max(0, Math.min(1, speed01));
    const throttle = Math.max(0, Math.min(1, throttle01));
    const pitch = 45 + speed * 110 + throttle * 12;
    for (const osc of engine.oscs) osc.frequency.setTargetAtTime(pitch, t, 0.08);
    engine.filter.frequency.setTargetAtTime(250 + speed * 900 + throttle * 500, t, 0.1);
    engine.gain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.08 : 0, t, 0.1);
  } catch (e) {
    /* ignore */
  }
}

function buildSiren() {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 700;
  // the wail: a slow LFO sweeps the pitch between two tones
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 1.4;
  const depth = ctx.createGain();
  depth.gain.value = 180;
  lfo.connect(depth);
  depth.connect(osc.frequency);
  osc.connect(gain);
  osc.start();
  lfo.start();
  siren = { gain };
}

export function setSiren(active) {
  sirenWanted = !!active;
  if (!ctx || !siren) return;
  try {
    siren.gain.gain.setTargetAtTime(active ? 0.05 : 0, ctx.currentTime, 0.15);
  } catch (e) {
    /* ignore */
  }
}

/** Optional per-frame hook; the synth has nothing to advance, but main.js may call it. */
export function updateAudio(dt) {
  void dt;
}
