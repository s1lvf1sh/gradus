// The composer: a beam search over notes. Each partial line is extended by every
// pitch the rules allow, scored by taste (style) plus the master's advice, and only
// the best few dozen lines survive each step. The rules themselves live in rules.js.

import { Rng } from './rng.js';
import { MODES, finals, melodic, noteName } from './pitch.js';
import { rhythm, makeContext, checkNote, checkWhole, checkCantus, attackInterval, heldInterval, analyse, applyFicta, accidentalFor } from './rules.js';

const ADVICE_COST = 4;

function beam(len, width, rng, temperature, expand) {
  let states = [{ line: [], cost: 0 }];
  let reached = 0;
  for (let k = 0; k < len; k++) {
    const next = [];
    for (const s of states) {
      for (const option of expand(s.line, k)) {
        next.push({ line: option.line, cost: s.cost + option.cost + temperature * rng.next() });
      }
    }
    if (next.length === 0) return { best: null, reached };
    next.sort((a, b) => a.cost - b.cost);
    states = diverse(next, width);
    reached = k + 1;
  }
  return { best: states[0], reached };
}

// Keep the cheapest lines, but no more than a few that end on the same two notes.
// Whether a line can still reach the cadence depends mostly on where it ends, so a
// beam of near-identical endings tends to die together.
function diverse(sorted, width) {
  const cap = Math.max(2, Math.ceil(width / 12));
  const seen = new Map();
  const kept = [];
  const spare = [];
  for (const s of sorted) {
    const n = s.line.length;
    const key = n >= 2 ? s.line[n - 1].d * 100 + s.line[n - 2].d : n ? s.line[n - 1].d : 0;
    const c = seen.get(key) || 0;
    if (c < cap) {
      seen.set(key, c + 1);
      kept.push(s);
      if (kept.length === width) return kept;
    } else if (spare.length < width) spare.push(s);
  }
  return kept.concat(spare.slice(0, width - kept.length));
}

// --- cantus firmus ---

const CF_LEAP = [0, 0, 0.7, 1.3, 1.7, 2.6, 9, 3];

export function composeCantus(mode, rng, length = 9 + rng.int(4)) {
  const final = MODES[mode].final;
  const base = finals(mode).lower;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { best } = beam(length, 40 << Math.min(attempt, 3), rng, 2.2, (line, k) => {
      const options = [];
      const lo = k === 0 || k === length - 1 ? base : base - 2;
      const hi = k === 0 || k === length - 1 ? base : base + 8;
      for (let d = lo; d <= hi; d++) {
        const next = line.concat({ d, acc: 0 });
        const v = checkCantus(next, k, length, final);
        if (v.some((x) => x.severity === 'error')) continue;
        let cost = ADVICE_COST * v.length;
        if (k >= 1) cost += CF_LEAP[Math.min(melodic(next[k - 1], next[k]).dd, 7)];
        if (k >= 2 && next[k].d === next[k - 2].d) cost += 1; // avoid oscillating
        if (k === length - 1) {
          const leaps = next.slice(1).filter((p, i) => melodic(next[i], p).leap).length;
          if (leaps < 2) cost += 6;
          if (leaps > 4) cost += 3 * (leaps - 4);
        }
        options.push({ line: next, cost });
      }
      return options;
    });
    if (best) return best.line;
  }
  throw new Error(`no cantus firmus found in ${mode}`);
}

// --- counterpoint ---

// Where the counterpoint may go. The final and the leading tone are fixed by the cadence.
export function candidateRange(piece, start, dur) {
  const { cpFinal } = registers(piece);
  const last = 4 * (piece.cf.length - 1);
  if (start === last) return [cpFinal, cpFinal];
  if (start + dur === last) return [cpFinal - 1, cpFinal - 1];
  return [cpFinal - 4, cpFinal + 8];
}

export function registers(piece) {
  const f = finals(piece.mode);
  return piece.above ? { cfFinal: f.lower, cpFinal: f.upper } : { cfFinal: f.upper, cpFinal: f.lower };
}

const LEAP = [0, 0, 0.5, 1.2, 1.8, 2.6, 9, 2.4];
const LEAP_SCALE = { 1: 1, 2: 1.2, 3: 2, 4: 1 };

// Taste, not law: what the composer prefers among the notes the rules allow.
export function styleCost(ctx, k) {
  const { cp, cf, species, last } = ctx;
  const note = cp[k];
  const v = attackInterval(ctx, k);
  const down = note.start % 4 === 0;
  let c = 0;
  if (k >= 1) c += LEAP[Math.min(melodic(cp[k - 1], note).dd, 7)] * LEAP_SCALE[species];
  if (k > 0 && note.start !== last && v.perfect && (down || species === 4)) c += 1.4;
  if (down && k >= 1 && note.start > 0) {
    const b = Math.floor(note.start / 4);
    const cpDir = Math.sign(note.d - cp[k - 1].d);
    const cfDir = Math.sign(cf[b].d - cf[b - 1].d);
    c += cpDir === 0 ? 0.4 : cpDir === cfDir ? 0.6 : -0.4;
  }
  if (species === 4 && k >= 1) {
    const h = heldInterval(ctx, k - 1);
    if (h) c += h.consonant ? 1.2 : -2.2; // suspensions are the point of the species
  }
  if ((species === 2 || species === 3) && k >= 1) {
    const vj = attackInterval(ctx, k - 1);
    if (!vj.consonant) c -= 0.3;
  }
  const { cpFinal } = registers(ctx.piece);
  const centre = cpFinal + 2;
  c += 0.2 * Math.max(0, Math.abs(note.d - centre) - 4);
  return c;
}

// The whole piece's score: taste plus the master's advice, ignoring outright faults.
// Lower is better.
export function pieceCost(piece, a = analyse(piece)) {
  const ctx = makeContext(piece);
  let c = 0;
  for (let k = 0; k < piece.cp.length; k++) c += styleCost(ctx, k);
  return c + ADVICE_COST * a.advice.length;
}

const BREAK_COST = 4;

// Compose a counterpoint for piece.cf. `locked` maps a note's start time to a fixed
// pitch, which lets a student write some notes and ask the composer to finish the rest.
//
// The search steps through the rhythmic slots of the species. In the fourth species a
// slot may also "break the species": the tie is dropped and a fresh note is struck on
// the downbeat, which the old masters allowed when no suspension would work.
export function composeCounterpoint(piece, rng, { locked = new Map(), width = 48, temperature = 1.6, trace = null } = {}) {
  const n = piece.cf.length;
  const shape = rhythm(piece.species, n);
  const ctx = makeContext({ ...piece, cp: [] });

  const tryNote = (line, start, dur, nextIsLeading, out) => {
    const k = line.length;
    const [lo, hi] = locked.has(start) ? [locked.get(start), locked.get(start)] : candidateRange(piece, start, dur);
    for (let d = lo; d <= hi; d++) {
      const acc = accidentalFor(piece, d, start, dur, nextIsLeading);
      const cp = line.concat({ d, acc, start, dur });
      ctx.cp = cp;
      const v = checkNote(ctx, k);
      if (start === ctx.last) v.push(...checkWhole(ctx));
      if (v.some((x) => x.severity === 'error')) {
        if (trace) for (const x of v) if (x.severity === 'error') trace(start, x.rule);
        continue;
      }
      out.push({ line: cp, cost: styleCost(ctx, k) + ADVICE_COST * v.length });
    }
  };

  const expand = (line, s) => {
    const { start, dur } = shape[s];
    const end = line.length ? line[line.length - 1].start + line[line.length - 1].dur : 0;
    if (end > start) return [{ line, cost: 0 }]; // this slot was covered by a longer note
    const nextIsLeading = s + 1 < shape.length && shape[s + 1].start + shape[s + 1].dur === ctx.last;
    const options = [];
    tryNote(line, start, dur, nextIsLeading, options);
    if (piece.species === 4 && s < n - 3) {
      const halves = [];
      tryNote(line, start, 2, false, halves);
      for (const h of halves) {
        const before = options.length;
        tryNote(h.line, start + 2, 2, false, options);
        for (let i = before; i < options.length; i++) options[i].cost += h.cost + BREAK_COST;
      }
    }
    // In the second species the second-last bar may be a single whole note.
    if (piece.species === 2 && start === ctx.last - 4) {
      const before = options.length;
      tryNote(line, start, 4, false, options);
      for (let i = before; i < options.length; i++) options[i].cost += 1;
    }
    return options;
  };

  let furthest = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { best, reached } = beam(shape.length, width << attempt, rng, temperature, expand);
    furthest = Math.max(furthest, reached);
    if (best) return { ...piece, cp: best.line };
  }
  const { line, proven } = exhaustive(shape.length, rng, expand);
  if (line) return { ...piece, cp: line };
  // proven: the search covered every possibility, so no counterpoint exists at all.
  return { ...piece, cp: null, failedAt: furthest, proven };
}

// Fallback when the beam's greedy pruning walks into a dead end: depth-first search,
// remembering dead ends. Hard rules look back at most four notes (plus the overall
// range), so a dead end is identified by its slot, its last four notes and its range.
function exhaustive(slots, rng, expand, budget = 400000) {
  const dead = new Set();
  let nodes = 0;
  const key = (line, s) => {
    const tail = line.slice(-4).map((n) => `${n.d}.${n.start}.${n.dur}`).join(',');
    const ds = line.map((n) => n.d);
    return `${s}|${tail}|${Math.min(...ds)}|${Math.max(...ds)}`;
  };
  const go = (line, s) => {
    if (s === slots) return line;
    if (++nodes > budget) return null;
    const k = key(line, s);
    if (dead.has(k)) return null;
    const options = expand(line, s).map((o) => ({ ...o, cost: o.cost + rng.next() }));
    options.sort((a, b) => a.cost - b.cost);
    for (const o of options) {
      const found = go(o.line, s + 1);
      if (found) return found;
      if (nodes > budget) return null;
    }
    dead.add(k);
    return null;
  };
  const line = go([], 0);
  return { line, proven: !line && nodes <= budget };
}

// A new cantus and counterpoint, reproducible from (mode, seed). The cantus depends only
// on the mode and seed, so switching species or voice keeps the same melody; `variant`
// asks for a different counterpoint to the same cantus. A few cantus melodies admit no
// counterpoint in a given species; then, as a teacher would, the composer writes another
// cantus, and `skipped` says how many were set aside.
export function newPiece({ mode, species, above, seed, variant = 0 }) {
  const cfRng = new Rng(seed);
  for (let skipped = 0; ; skipped++) {
    const cantus = composeCantus(mode, cfRng);
    const mix = seed ^ Math.imul(species * 2 + (above ? 1 : 0) + 1, 0x9e3779b1) ^ Math.imul(variant + 1, 0x85ebca6b);
    // Later versions are composed with more chance in the choices, so they differ more.
    const temperature = 1.6 + 1.2 * Math.min(variant, 3);
    const piece = withCantus({ mode, species, above, temperature }, cantus, new Rng(mix >>> 0));
    if (piece.cp || skipped === 4) return { ...piece, seed, variant, skipped };
  }
}

// Place a cantus (given in the lower register) against a counterpoint above or below.
export function withCantus(opts, cantus, rng) {
  const shift = opts.above ? 0 : 7;
  const cf = cantus.map((p) => ({ d: p.d + shift, acc: 0 }));
  const piece = { mode: opts.mode, species: opts.species, above: opts.above, cf, cantus };
  return composeCounterpoint(piece, rng, { temperature: opts.temperature });
}

// Why this note? Try every pitch the composer could have put at note k, keeping the
// rest of the piece, and report what the master would say about each one.
export function explain(piece, k) {
  const note = piece.cp[k];
  const [lo, hi] = candidateRange(piece, note.start, note.dur);
  const [wlo, whi] = lo === hi ? [lo - 3, hi + 3] : [lo, hi];
  const chosen = piece.cp[k].d;
  const base = analyse(piece);
  const baseCost = pieceCost(piece, base);
  const key = (v) => `${v.rule}:${v.notes.join(',')}`;
  const before = new Set(base.violations.map(key));
  // What this pitch is responsible for: remarks about note k itself, and any remark
  // elsewhere that putting this pitch here would newly cause.
  const mine = (v) => v.notes.includes(k) || !before.has(key(v));
  const rows = [];
  for (let d = whi; d >= wlo; d--) {
    const trial = { ...piece, cp: piece.cp.map((n, i) => (i === k ? { ...n, d } : { ...n })) };
    applyFicta(trial);
    const a = analyse(trial);
    rows.push({
      d,
      name: noteName(trial.cp[k]),
      chosen: d === chosen,
      errors: a.errors.filter(mine),
      advice: a.advice.filter(mine),
      cost: pieceCost(trial, a) - baseCost,
    });
  }
  return rows;
}
