// The rules of strict counterpoint, in one place, used by the composer and the critic alike.
//
// A piece is { mode, species, above, cf, cp }:
//   cf: one whole note per bar, [{ d, acc }]
//   cp: the counterpoint, [{ d, acc, start, dur }], times in quarter notes (a bar is 4)
//
// checkNote(ctx, k) returns every violation that note k completes, looking only at
// notes 0..k. The composer calls it as it places each note, and the critic calls it
// for every note in turn, so both enforce exactly the same rules.

import { MODES, harmonic, melodic, melodicName, intervalNumber, leadingStep, step, toMidi } from './pitch.js';

export const RULES = {
  crossing: ['error', 'Voices crossed', 'The voices have crossed. Keep the counterpoint on its own side of the cantus.'],
  spacing: ['error', 'Too far apart', 'The voices are more than a twelfth apart; they no longer sound as one texture.'],
  wide: ['advice', 'Wide spacing', 'The voices are more than a tenth apart. It is allowed, but they begin to sound separate.'],
  'dissonant-downbeat': ['error', 'Dissonance on the beat', 'A dissonance where the cantus moves. Every downbeat must be consonant.'],
  'dissonant-syncope': ['error', 'Struck dissonance', 'In the fourth species a note must be consonant when it is struck. Only the tied half may be dissonant.'],
  unison: ['error', 'Unison', 'A unison in the middle of the piece: the two voices become one. Save it for the first and last notes.'],
  'unison-weak': ['advice', 'Unison', 'A unison on a weak beat. It is permitted, but it thins the texture.'],
  begin: ['error', 'Weak opening', 'Begin on a perfect consonance. Above the cantus that means the unison, fifth or octave; below it, only the unison or octave, or the mode is obscured.'],
  end: ['error', 'Weak ending', 'End on the unison or the octave.'],
  cadence: ['error', 'No leading tone', 'Approach the final by step from below, from the leading tone.'],
  'cadence-suspension': ['advice', 'No cadential suspension', 'The fourth species should close with a suspension: hold the final over the second-last note of the cantus, then fall to the leading tone.'],
  'unprepared-dissonance': ['error', 'Untreated dissonance', 'This dissonance is neither a passing tone nor a neighbour note. Approach a dissonance by step and leave it by step.'],
  cambiata: ['error', 'Broken cambiata', 'After the cambiata leaps down a third from its dissonance, the line must rise by step.'],
  'suspension-resolution': ['error', 'Unresolved suspension', 'A suspended dissonance must resolve down by step.'],
  'suspension-unison': ['error', '2–1 suspension', 'The second resolving into a unison is avoided: the resolution swallows the voice.'],
  'suspension-below': ['error', 'Bad suspension below', 'Below the cantus only the 2–3 suspension (or its compound, 9–10) works. The 4–5 and 7–8 resolve into perfect consonances.'],
  'bad-suspension': ['error', 'Bad suspension', 'This suspension does not resolve to a consonance.'],
  'nine-eight': ['advice', '9–8 suspension', 'The 9–8 suspension is allowed but used sparingly, because it lands on a bare octave.'],
  'parallel-perfect': ['error', 'Consecutive perfects', 'Two {what} in a row. Consecutive perfect consonances destroy the independence of the voices, by contrary motion as much as by parallel.'],
  'direct-perfect': ['error', 'Hidden {what}', 'Both voices move the same way into a {what}. Approach perfect consonances by contrary or oblique motion.'],
  'parallel-downbeats': ['error', '{What} on the beat', '{What} on successive downbeats. The note between them does not hide them.'],
  'parallel-syncopes': ['error', 'Syncopated {what}', '{What} on successive struck notes. The syncopation does not hide them.'],
  'parallel-imperfect': ['advice', 'Parallel run', 'Four {what} in a row. Sweet, but the voices begin to move as one.'],
  'bad-leap': ['error', 'Forbidden leap', 'A leap of a {what}. Leap only by consonant intervals: never by a tritone, a seventh, a major sixth or more than an octave.'],
  repeated: ['error', 'Repeated note', 'A repeated note stalls the line.'],
  'repeated-soft': ['advice', 'Repeated note', 'A repeated note. It is allowed here, but it stalls the line.'],
  'leap-recovery': ['error', 'Leap not recovered', 'After a leap of a fifth or more, turn back in the other direction.'],
  'leap-recovery-soft': ['advice', 'Leap not recovered', 'After a leap, a line sounds best when it turns back by step.'],
  'too-many-leaps': ['error', 'Three leaps', 'Three leaps in a row: the line falls apart.'],
  'leaps-span': ['error', 'Leaps too wide', 'Two leaps in the same direction span more than an octave.'],
  'leaps-same-direction': ['advice', 'Leaps in one direction', 'Two leaps in the same direction. If you must, outline a triad.'],
  'leading-tone': ['error', 'Leading tone', 'The raised leading tone must rise to the final.'],
  'outline-tritone': ['advice', 'Outlined tritone', 'Between its turning points the line outlines a tritone.'],
  range: ['error', 'Range', 'The counterpoint spans more than a tenth.'],
  climax: ['advice', 'Repeated climax', 'The highest note comes more than once. A single climax gives a line its shape.'],
  'shared-climax': ['advice', 'Shared climax', 'Both voices reach their highest notes together. Stagger the peaks.'],
  hollow: ['advice', 'Hollow', 'Too many perfect consonances. Thirds and sixths give the music its warmth.'],
  'neighbour-strong': ['advice', 'Strong neighbour', 'A neighbour note on the third beat is accented. Prefer the second and fourth beats.'],
};

const PERFECT_NAMES = { 0: ['octaves', 'Octaves'], 4: ['fifths', 'Fifths'] };
const IMPERFECT_NAMES = { 2: 'thirds', 5: 'sixths' };

function violation(rule, notes, cp, what = '') {
  const [severity, title, text] = RULES[rule];
  const cap = what.charAt(0).toUpperCase() + what.slice(1);
  const fill = (s) => s.replaceAll('{what}', what).replaceAll('{What}', cap);
  const bar = cp[notes[notes.length - 1]] ? Math.floor(cp[notes[notes.length - 1]].start / 4) + 1 : null;
  return { rule, severity, title: fill(title), text: fill(text), notes, bar };
}

// The rhythmic skeleton of each species for a cantus of n bars.
export function rhythm(species, n) {
  const r = [];
  const last = 4 * (n - 1);
  if (species === 1) {
    for (let b = 0; b < n; b++) r.push({ start: 4 * b, dur: 4 });
  } else if (species === 2) {
    r.push({ start: 2, dur: 2 }); // begins after a half rest
    for (let b = 1; b < n - 1; b++) r.push({ start: 4 * b, dur: 2 }, { start: 4 * b + 2, dur: 2 });
    r.push({ start: last, dur: 4 });
  } else if (species === 3) {
    r.push({ start: 1, dur: 1 }, { start: 2, dur: 1 }, { start: 3, dur: 1 }); // after a quarter rest
    for (let b = 1; b < n - 1; b++) for (let q = 0; q < 4; q++) r.push({ start: 4 * b + q, dur: 1 });
    r.push({ start: last, dur: 4 });
  } else {
    // Fourth species: every note is struck on the weak half and tied over the bar line.
    for (let b = 0; b < n - 2; b++) r.push({ start: 4 * b + 2, dur: 4 });
    r.push({ start: 4 * (n - 2) + 2, dur: 2 });
    r.push({ start: last, dur: 4 });
  }
  return r;
}

export function makeContext(piece) {
  const last = 4 * (piece.cf.length - 1);
  return {
    piece,
    cf: piece.cf,
    cp: piece.cp,
    species: piece.species,
    above: piece.above,
    mode: piece.mode,
    last, // when the final note is struck
    ti: leadingStep(piece.mode),
    final: MODES[piece.mode].final,
  };
}

const barOf = (note) => Math.floor(note.start / 4);
const vert = (ctx, cpNote, cfNote) => (ctx.above ? harmonic(cfNote, cpNote) : harmonic(cpNote, cfNote));
export const attackInterval = (ctx, k) => vert(ctx, ctx.cp[k], ctx.cf[barOf(ctx.cp[k])]);

// The interval a tied note makes against the next cantus note, if it is held over the bar line.
export function heldInterval(ctx, k) {
  const n = ctx.cp[k];
  const b = barOf(n);
  if (n.start % 4 === 0 || n.start + n.dur <= 4 * (b + 1)) return null;
  return vert(ctx, n, ctx.cf[b + 1]);
}

// Musica ficta: raise the leading tone at the cadence, and in a mode where the step
// below it would then be an augmented second away (Aeolian F to G sharp), raise that too.
export function accidentalFor(piece, d, start, dur, nextIsLeading) {
  const mode = MODES[piece.mode];
  if (!mode.raise) return 0;
  const ti = leadingStep(piece.mode);
  const last = 4 * (piece.cf.length - 1);
  if (start + dur === last && step(d) === ti) return 1;
  if (nextIsLeading && step(d + 1) === ti) {
    const gap = toMidi({ d: d + 1, acc: 1 }) - toMidi({ d, acc: 0 });
    if (gap === 3) return 1;
  }
  return 0;
}

export function applyFicta(piece) {
  const last = 4 * (piece.cf.length - 1);
  const ti = leadingStep(piece.mode);
  const cp = piece.cp;
  for (let k = 0; k < cp.length; k++) {
    const next = cp[k + 1];
    const nextIsLeading = !!next && next.start + next.dur === last && step(next.d) === ti && next.d === cp[k].d + 1;
    cp[k].acc = accidentalFor(piece, cp[k].d, cp[k].start, cp[k].dur, nextIsLeading);
  }
  return piece;
}

// How a dissonant weak-beat note in the second or third species is treated, given
// the notes either side of it. Returns null if it is not a recognised figure.
function dissonanceFigure(ctx, j, k) {
  const cp = ctx.cp;
  if (j < 1) return null;
  const inn = melodic(cp[j - 1], cp[j]);
  const out = melodic(cp[j], cp[k]);
  if (inn.dd === 1 && out.dd === 1 && inn.dir === out.dir) return 'passing';
  if (ctx.species === 3) {
    if (inn.dd === 1 && out.dd === 1 && inn.dir === -out.dir) return 'neighbour';
    if (cp[j].start % 4 === 1 && inn.dd === 1 && inn.dir < 0 && out.d === -2) return 'cambiata';
  }
  return null;
}

// --- melodic rules, shared by the cantus firmus and the counterpoint ---

export function melodicRules(line, k, opts, out, cpRef) {
  if (k < 1) return;
  const m = melodic(line[k - 1], line[k]);
  const add = (rule, notes, what) => out.push(violation(rule, notes, cpRef, what));
  if (!m.ok) add('bad-leap', [k - 1, k], melodicName(m));
  if (m.dd === 0) add(opts.repeat === 'advice' ? 'repeated-soft' : 'repeated', [k - 1, k]);
  if (line[k - 1].acc > 0 && m.d !== 1) add('leading-tone', [k - 1, k]);
  if (k < 2) return;
  const p = melodic(line[k - 2], line[k - 1]);
  if (p.dd >= 4) {
    if (m.dir === p.dir || m.dir === 0) add('leap-recovery', [k - 2, k - 1, k]);
    else if (m.dd > 1) add('leap-recovery-soft', [k - 2, k - 1, k]);
  } else if (p.dd === 3 && m.dir === p.dir) {
    add('leap-recovery-soft', [k - 2, k - 1, k]);
  }
  if (p.leap && m.leap && p.dir === m.dir) {
    const total = p.dd + m.dd;
    if (total > 7) add('leaps-span', [k - 2, k - 1, k]);
    else if (!(p.dd <= 3 && m.dd <= 3 && total <= 5)) add('leaps-same-direction', [k - 2, k - 1, k]);
  }
  if (k >= 3 && p.leap && m.leap && melodic(line[k - 3], line[k - 2]).leap) add('too-many-leaps', [k - 3, k - 2, k - 1, k]);
  // A turning point at k-1: check the span of the run that ended there.
  if (p.dir !== 0 && m.dir !== 0 && p.dir !== m.dir) {
    let s = k - 1;
    while (s > 0 && Math.sign(line[s].d - line[s - 1].d) === p.dir) s--;
    const span = harmonic(line[s].d < line[k - 1].d ? line[s] : line[k - 1], line[s].d < line[k - 1].d ? line[k - 1] : line[s]);
    if (Math.abs(span.semis) === 6) add('outline-tritone', [s, k - 1]);
  }
}

// --- the counterpoint rules ---

export function checkNote(ctx, k) {
  const out = [];
  const { cp, cf, species, last } = ctx;
  const note = cp[k];
  const add = (rule, notes, what) => out.push(violation(rule, notes, cp, what));
  const v = attackInterval(ctx, k);
  const down = note.start % 4 === 0;
  const isFirst = k === 0;
  const isLast = note.start === last;

  // Vertical: the interval when this note is struck.
  if (v.d < 0) add('crossing', [k]);
  else if (v.d > 11) add('spacing', [k]);
  else if (v.d > 9) add('wide', [k]);
  if (!v.consonant) {
    if (down) add('dissonant-downbeat', [k]);
    else if (species === 4) add('dissonant-syncope', [k]);
  }
  if (v.d === 0 && !isFirst && !isLast) {
    if (species === 1 || down) add('unison', [k]);
    else add('unison-weak', [k]);
  }
  if (isFirst && !(v.perfect && (ctx.above || v.cls === 0))) add('begin', [k]);
  if (isLast && !(v.consonant && v.cls === 0)) add('end', [k]);
  if (note.start + note.dur === last && step(note.d) !== ctx.ti) add('cadence', [k]);
  if (species === 4 && note.start + note.dur === last - 2 && step(note.d) !== ctx.final) add('cadence-suspension', [k]);

  // Weak-beat dissonance in the second and third species, judged now that the next note is known.
  if ((species === 2 || species === 3) && k >= 1) {
    const j = k - 1;
    const vj = attackInterval(ctx, j);
    if (!vj.consonant && cp[j].start % 4 !== 0) {
      const fig = dissonanceFigure(ctx, j, k);
      if (!fig) add('unprepared-dissonance', [j]);
      else if (fig === 'neighbour' && cp[j].start % 4 === 2) add('neighbour-strong', [j]);
    }
    // Cambiata: the note after the leap must be consonant and then rise by step.
    if (species === 3 && k >= 2) {
      const i = k - 2;
      const vi = attackInterval(ctx, i);
      if (!vi.consonant && cp[i].start % 4 !== 0 && dissonanceFigure(ctx, i, k - 1) === 'cambiata') {
        if (!vj.consonant || melodic(cp[j], cp[k]).d !== 1) add('cambiata', [i, j, k]);
      }
    }
  }

  // Suspensions in the fourth species: the tied half of note k-1 against the new cantus note.
  if (species === 4 && k >= 1) {
    const j = k - 1;
    const h = heldInterval(ctx, j);
    if (h && !h.consonant) {
      if (melodic(cp[j], cp[k]).d !== -1) add('suspension-resolution', [j, k]);
      else if (ctx.above) {
        if (h.cls === 1 && Math.abs(h.d) === 1) add('suspension-unison', [j, k]);
        else if (h.cls === 1) add('nine-eight', [j, k]);
        else if (h.cls !== 6 && h.cls !== 3) add('bad-suspension', [j, k]);
      } else if (h.cls === 3 || h.cls === 6) add('suspension-below', [j, k]);
      else if (h.cls !== 1) add('bad-suspension', [j, k]);
    }
    // Perfect consonances on successive struck notes.
    const vp = attackInterval(ctx, j);
    const struckWeak = cp[j].start % 4 === 2 && note.start % 4 === 2;
    if (struckWeak && vp.perfect && v.perfect && vp.cls === v.cls && cp[j].d !== note.d) {
      add('parallel-syncopes', [j, k], PERFECT_NAMES[v.cls][0]);
    }
  }

  // Motion across the bar line, where both voices move at once.
  if (down && k >= 1 && note.start > 0) {
    const prev = cp[k - 1];
    const prevCf = cf[barOf(note) - 1];
    const vp = vert(ctx, prev, prevCf);
    const cpDir = Math.sign(note.d - prev.d);
    const cfDir = Math.sign(cf[barOf(note)].d - prevCf.d);
    if (cpDir !== 0 && cfDir !== 0) {
      if (vp.perfect && v.perfect && vp.cls === v.cls) add('parallel-perfect', [k - 1, k], PERFECT_NAMES[v.cls][0]);
      else if (v.perfect && cpDir === cfDir) add('direct-perfect', [k - 1, k], v.cls === 0 ? (v.d === 0 ? 'unison' : 'octave') : 'fifth');
    }
    // Perfect consonances on successive downbeats, with notes between.
    if (species === 2 || species === 3) {
      const j = cp.findIndex((n) => n.start === note.start - 4);
      if (j >= 0) {
        const vj = attackInterval(ctx, j);
        if (vj.perfect && v.perfect && vj.cls === v.cls && cp[j].d !== note.d) {
          const r = violation('parallel-downbeats', [j, k], cp, PERFECT_NAMES[v.cls][0]);
          if (species === 3) r.severity = 'advice'; // looser when three notes stand between
          out.push(r);
        }
      }
    }
    // Runs of parallel thirds or sixths in the first species.
    if (species === 1 && !v.perfect && v.consonant && k >= 3) {
      let run = 1;
      for (let i = k - 1; i >= 0; i--) {
        const vi = attackInterval(ctx, i);
        const moved = cp[i + 1].d !== cp[i].d;
        if (vi.cls === v.cls && vi.consonant && moved) run++;
        else break;
      }
      if (run === 4) add('parallel-imperfect', [k - 3, k - 2, k - 1, k], IMPERFECT_NAMES[v.cls]);
    }
  }

  melodicRules(cp, k, { repeat: species === 1 ? 'advice' : 'error' }, out, cp);
  return out;
}

// Rules about the line as a whole, checked once it is complete.
export function checkWhole(ctx) {
  const out = [];
  const { cp, cf } = ctx;
  const ds = cp.map((n) => n.d);
  const hi = Math.max(...ds);
  const lo = Math.min(...ds);
  if (hi - lo > 9) out.push(violation('range', [ds.indexOf(lo), ds.indexOf(hi)], cp));
  if (ctx.species !== 3) {
    const peaks = ds.map((d, i) => (d === hi ? i : -1)).filter((i) => i >= 0);
    if (peaks.length > 1) out.push(violation('climax', peaks, cp));
  }
  if (ctx.species === 1) {
    const cfHi = Math.max(...cf.map((n) => n.d));
    const k = ds.indexOf(hi);
    if (peaksOnce(ds, hi) && cf[barOf(cp[k])].d === cfHi) out.push(violation('shared-climax', [k], cp));
    let perfect = 0;
    for (let i = 1; i < cp.length - 1; i++) if (attackInterval(ctx, i).perfect) perfect++;
    if (perfect > (cp.length - 2) / 3) out.push(violation('hollow', [], cp));
  }
  return out;
}

const peaksOnce = (ds, hi) => ds.filter((d) => d === hi).length === 1;

// Full analysis: every violation, plus the interval and figure of every note.
export function analyse(piece) {
  const ctx = makeContext(piece);
  const violations = [];
  for (let k = 0; k < piece.cp.length; k++) violations.push(...checkNote(ctx, k));
  violations.push(...checkWhole(ctx));
  const notes = piece.cp.map((n, k) => {
    const v = attackInterval(ctx, k);
    const h = heldInterval(ctx, k);
    let figure = v.consonant ? 'consonance' : 'dissonance';
    if (!v.consonant && k + 1 < piece.cp.length) figure = dissonanceFigure(ctx, k, k + 1) || 'dissonance';
    if (h && !h.consonant) figure = 'suspension';
    return { attack: v, held: h, figure, label: intervalNumber(v.d) };
  });
  return {
    violations,
    errors: violations.filter((v) => v.severity === 'error'),
    advice: violations.filter((v) => v.severity === 'advice'),
    notes,
  };
}

// --- the cantus firmus ---

// Rules for a cantus firmus of a known length, checked note by note.
export function checkCantus(line, k, n, final) {
  const out = [];
  melodicRules(line, k, { repeat: 'error' }, out, []);
  const rel = line[k].d - line[0].d;
  if (k === 0 && step(line[k].d) !== final) out.push({ rule: 'cf-start', severity: 'error' });
  if (k === n - 2 && rel !== 1) out.push({ rule: 'cf-penult', severity: 'error' });
  if (k === n - 1 && rel !== 0) out.push({ rule: 'cf-end', severity: 'error' });
  if (rel < -2 || rel > 8) out.push({ rule: 'cf-range', severity: 'error' });
  // A single climax, which must not be the first note or in the cadence.
  if (k === n - 1) {
    const ds = line.map((p) => p.d);
    const hi = Math.max(...ds);
    const at = ds.map((d, i) => (d === hi ? i : -1)).filter((i) => i >= 0);
    if (at.length !== 1 || at[0] < 2 || at[0] > n - 3) out.push({ rule: 'cf-climax', severity: 'error' });
    if (hi - Math.min(...ds) < 4) out.push({ rule: 'cf-narrow', severity: 'error' });
  }
  return out;
}
