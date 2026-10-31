// A small offline synthesiser for two singers, written as plain DSP so it runs the
// same in the browser and in Node (where the tests listen to it).
//
// Each voice is additive: harmonics of the sung pitch, weighted by a vowel's formants,
// with vibrato that blooms after each attack and a soft re-articulation between notes.
// The harmonics come from one phase via the recurrence sin((h+1)x) = 2cos(x)sin(hx) - sin((h-1)x),
// so a sample costs a multiply-add per harmonic instead of a call to sin().

import { frequency } from './pitch.js';

export const SAMPLE_RATE = 44100;

const VOWELS = {
  ah: [[800, 1, 90], [1150, 0.5, 100], [2900, 0.25, 140], [3900, 0.1, 200]],
  oh: [[450, 1, 80], [800, 0.45, 90], [2830, 0.15, 140], [3500, 0.08, 180]],
};

const ATTACK = 0.06;
const RELEASE = 0.09;
const GLIDE = 0.04;

function harmonicWeights(f, vowel, out) {
  const H = out.length;
  for (let h = 1; h <= H; h++) {
    const hf = h * f;
    if (hf > 5000) {
      out[h - 1] = 0;
      continue;
    }
    let g = 0.3; // the glottal source: formants shape it, they do not replace it
    for (const [F, gain, bw] of vowel) {
      const w = Math.max(bw, 0.6 * f);
      g += gain * Math.exp(-(((hf - F) / w) ** 2));
    }
    out[h - 1] = g / Math.pow(h, 0.7);
  }
}

// notes: [{ t0, t1, freq }] in seconds, monophonic and in order.
export function renderVoice(notes, { vowel = 'ah', sampleRate = SAMPLE_RATE, vibrato = 0.004 } = {}) {
  const end = notes.length ? notes[notes.length - 1].t1 + RELEASE + 0.05 : 0;
  const N = Math.ceil(end * sampleRate);
  const out = new Float32Array(N);
  const formants = VOWELS[vowel];
  const H = 40;
  const weights = new Float64Array(H);
  let theta = 0;
  let note = 0;
  for (let i = 0; i < N; i++) {
    const t = i / sampleRate;
    while (note < notes.length - 1 && t >= notes[note + 1].t0) note++;
    const n = notes[note];
    // Pitch: glide from the previous note when the two are joined, then vibrato.
    let f = n.freq;
    const prev = notes[note - 1];
    if (prev && Math.abs(prev.t1 - n.t0) < 1e-6 && t - n.t0 < GLIDE) {
      const x = (t - n.t0) / GLIDE;
      const s = x * x * (3 - 2 * x);
      f = Math.exp(Math.log(prev.freq) * (1 - s) + Math.log(n.freq) * s);
    }
    const since = t - n.t0;
    const depth = vibrato * Math.min(1, Math.max(0, (since - 0.15) / 0.35));
    f *= 1 + depth * Math.sin(2 * Math.PI * 5.2 * t + note);
    // Amplitude: the sum of each note's envelope, so joined notes cross-fade.
    let amp = 0;
    for (let j = Math.max(0, note - 1); j <= Math.min(notes.length - 1, note + 1); j++) amp += envelope(notes[j], t);
    if (amp <= 0) {
      theta += (2 * Math.PI * f) / sampleRate;
      continue;
    }
    if ((i & 127) === 0) harmonicWeights(f, formants, weights);
    theta += (2 * Math.PI * f) / sampleRate;
    if (theta > 2 * Math.PI) theta -= 2 * Math.PI;
    const c2 = 2 * Math.cos(theta);
    let s0 = 0;
    let s1 = Math.sin(theta);
    let sum = 0;
    for (let h = 0; h < H; h++) {
      sum += weights[h] * s1;
      const s2 = c2 * s1 - s0;
      s0 = s1;
      s1 = s2;
    }
    out[i] = sum * amp;
  }
  return out;
}

function envelope(n, t) {
  if (t < n.t0 || t > n.t1 + RELEASE) return 0;
  const len = n.t1 - n.t0;
  if (t < n.t0 + ATTACK) return 0.5 - 0.5 * Math.cos((Math.PI * (t - n.t0)) / ATTACK);
  if (t <= n.t1) return 1 - 0.18 * ((t - n.t0) / len);
  return 0.82 * (0.5 + 0.5 * Math.cos((Math.PI * (t - n.t1)) / RELEASE));
}

// A Freeverb-style reverb: parallel damped combs into series allpasses.
function reverb(input, sampleRate, spread) {
  const scale = sampleRate / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((l) => ({
    buf: new Float32Array(Math.round((l + spread) * scale)),
    i: 0,
    store: 0,
  }));
  const alls = [556, 441, 341, 225].map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0 }));
  const out = new Float32Array(input.length);
  const feedback = 0.86;
  const damp = 0.25;
  for (let n = 0; n < input.length; n++) {
    const x = input[n] * 0.015;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.store = o * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const a of alls) {
      const b = a.buf[a.i];
      a.buf[a.i] = y + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      y = b - y;
    }
    out[n] = y;
  }
  return out;
}

// Timeline of a piece: when each note of each voice sounds, in seconds.
export function timeline(piece, { tempo = 120, tuning = 'meantone' } = {}) {
  const q = 60 / tempo;
  const cf = piece.cf.map((p, i) => ({ voice: 'cf', index: i, t0: 4 * i * q, t1: 4 * (i + 1) * q, freq: frequency(p, tuning) }));
  const cp = piece.cp.map((p, i) => ({ voice: 'cp', index: i, t0: p.start * q, t1: (p.start + p.dur) * q, freq: frequency(p, tuning) }));
  return { cf, cp, duration: 4 * piece.cf.length * q };
}

// Render the whole piece to stereo. The upper voice sings "ah" a little to the right,
// the lower "oh" a little to the left, in a modest stone room.
export function renderPiece(piece, opts = {}) {
  const sampleRate = opts.sampleRate || SAMPLE_RATE;
  const tl = timeline(piece, opts);
  const upper = piece.above ? tl.cp : tl.cf;
  const lower = piece.above ? tl.cf : tl.cp;
  const hi = normalise(renderVoice(upper, { vowel: 'ah', sampleRate }));
  const lo = normalise(renderVoice(lower, { vowel: 'oh', sampleRate }));
  const tail = Math.round(2.2 * sampleRate);
  const N = Math.max(hi.length, lo.length) + tail;
  const mono = new Float32Array(N);
  for (let i = 0; i < hi.length; i++) mono[i] += hi[i];
  for (let i = 0; i < lo.length; i++) mono[i] += lo[i];
  const wetL = reverb(mono, sampleRate, 0);
  const wetR = reverb(mono, sampleRate, 23);
  const left = new Float32Array(N);
  const right = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const h = hi[i] || 0;
    const l = lo[i] || 0;
    left[i] = 0.42 * h + 0.58 * l + 0.9 * wetL[i];
    right[i] = 0.58 * h + 0.42 * l + 0.9 * wetR[i];
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < N; i++) {
    left[i] *= g;
    right[i] *= g;
  }
  return { left, right, sampleRate, timeline: tl };
}

function normalise(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / Math.max(1, x.length));
  if (rms > 0) for (let i = 0; i < x.length; i++) x[i] *= 0.18 / rms;
  return x;
}

// 16-bit stereo PCM WAV.
export function encodeWav({ left, right, sampleRate }) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return buf;
}
