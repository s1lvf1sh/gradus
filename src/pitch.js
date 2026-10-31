// Pitches are diatonic numbers: d = octave * 7 + step, where step 0..6 is C..B.
// So C4 = 28 and D4 = 29. A separate `acc` (-1, 0, +1) carries musica ficta.
// Working diatonically makes "a step", "a third" and "a fifth" plain subtraction,
// while semitone counts (needed to tell a perfect fifth from a diminished one)
// come from toMidi.

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// Position of each white note on the circle of fifths, relative to C.
const FIFTHS = [0, 2, 4, -1, 1, 3, 5];

// The church modes as Fux taught them, all on white keys. `raise` says whether the
// leading tone (the step below the final) is sharpened at the cadence.
export const MODES = {
  dorian: { name: 'Dorian', final: 1, raise: true },
  phrygian: { name: 'Phrygian', final: 2, raise: false },
  mixolydian: { name: 'Mixolydian', final: 4, raise: true },
  aeolian: { name: 'Aeolian', final: 5, raise: true },
  ionian: { name: 'Ionian', final: 0, raise: false },
};

export const step = (d) => ((d % 7) + 7) % 7;
export const octave = (d) => Math.floor(d / 7);

export function toMidi(p) {
  return 12 * (octave(p.d) + 1) + WHITE[step(p.d)] + (p.acc || 0);
}

export function noteName(p) {
  const acc = p.acc > 0 ? '♯' : p.acc < 0 ? '♭' : '';
  return LETTERS[step(p.d)] + acc + octave(p.d);
}

// Frequency in Hz. 'meantone' is quarter-comma meantone (pure major thirds),
// the tuning of a sixteenth-century organ; 'equal' is modern equal temperament.
export function frequency(p, tuning = 'meantone') {
  const fifth = tuning === 'meantone' ? Math.pow(5, 0.25) : Math.pow(2, 7 / 12);
  const k = FIFTHS[step(p.d)] + 7 * (p.acc || 0) - 3; // fifths away from A
  const n = toMidi(p) - 69; // semitones away from A4
  const octaves = (7 * k - n) / 12; // always an integer
  return 440 * Math.pow(fifth, k) / Math.pow(2, octaves);
}

// Harmonic interval between a lower and an upper pitch.
// d is in diatonic steps (0 unison, 2 third, 4 fifth, 7 octave); negative means crossed.
export function harmonic(lower, upper) {
  const d = upper.d - lower.d;
  const semis = toMidi(upper) - toMidi(lower);
  const cls = step(Math.abs(d));
  const s = ((Math.abs(semis) % 12) + 12) % 12;
  let consonant = false;
  if (cls === 0) consonant = s === 0;
  else if (cls === 2) consonant = s === 3 || s === 4;
  else if (cls === 4) consonant = s === 7;
  else if (cls === 5) consonant = s === 8 || s === 9;
  const perfect = consonant && (cls === 0 || cls === 4);
  return { d, semis, cls, consonant, perfect };
}

// Interval number as a musician writes it: unison 1, third 3, octave 8, tenth 10.
export const intervalNumber = (d) => Math.abs(d) + 1;

// Melodic interval from a to b, with its legality in strict style.
const MELODIC_OK = { 0: [0], 1: [1, 2], 2: [3, 4], 3: [5], 4: [7], 7: [12] };
export function melodic(a, b) {
  const d = b.d - a.d;
  const semis = toMidi(b) - toMidi(a);
  const dd = Math.abs(d);
  const ss = Math.abs(semis);
  let ok = (MELODIC_OK[dd] || []).includes(ss);
  // The minor sixth is allowed, but only upward.
  if (dd === 5 && ss === 8 && d > 0) ok = true;
  return { d, dd, semis, ok, dir: Math.sign(d), leap: dd >= 2 };
}

export function melodicName(m) {
  const names = ['unison', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave'];
  const base = m.dd <= 7 ? names[m.dd] : `${m.dd + 1}th`;
  if (m.dd === 3 && m.semis !== 5 && Math.abs(m.semis) === 6) return 'augmented fourth (tritone)';
  if (m.dd === 4 && Math.abs(m.semis) === 6) return 'diminished fifth';
  if (m.dd === 1 && Math.abs(m.semis) === 3) return 'augmented second';
  if (m.dd === 5 && Math.abs(m.semis) === 9) return 'major sixth';
  if (m.dd === 5 && m.d < 0) return 'descending sixth';
  return base;
}

// The register a voice sits in. The lower voice's final is in octave 3 (C3 to E3) or
// octave 2 (G2, A2) so both voices fit a grand staff; the upper voice is an octave higher.
export function finals(mode) {
  const f = MODES[mode].final;
  const lower = (f <= 2 ? 3 : 2) * 7 + f;
  return { lower, upper: lower + 7 };
}

export const leadingStep = (mode) => step(MODES[mode].final - 1);
