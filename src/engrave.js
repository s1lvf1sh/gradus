// Music engraving: draws a two-voice score as an SVG string. No fonts are needed for
// the notation itself; clefs, noteheads, rests and accidentals are all drawn as paths.

import { step } from './pitch.js';

const S = 10; // distance between staff lines
const INK = '#2b2118';
const PAPER = '#f7f1e3';
const BAR_WIDTH = { 1: 54, 2: 76, 3: 128, 4: 76 };
const LEFT = 64;
const CLEF = {
  treble: { top: 38, bottom: 30, middle: 34 }, // F5 .. E4, middle line B4
  bass: { top: 26, bottom: 18, middle: 22 }, // A3 .. G2, middle line D3
};

// The treble clef as one pen stroke, in staff units, origin on the G line.
const TREBLE = 'M2,3 C8,1 6,-8 0,-8 C-7,-8 -9,1 -5,7 C-1,12 9,11 11,4 C13,-3 7,-12 1,-17 C-5,-23 -4,-35 2,-41 C6,-45 9,-40 6,-34 C3,-28 -2,-22 -1,-12 C0,0 2,12 3,22 C3.5,27 -1,30 -4,28';
// The bass clef as a filled crescent, origin on the F line.
const BASS = 'M-2,-1 C1,-10 17,-11 18,1 C19,14 7,24 -7,30 C4,22 13,12 13,1 C13,-8 4,-8 1,-2 Z';

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// Whichever clef needs fewer ledger lines for this voice.
function chooseClef(notes) {
  const cost = (c) => notes.reduce((s, n) => s + Math.max(0, Math.floor((c.bottom - n.d) / 2), Math.floor((n.d - c.top) / 2)), 0);
  return cost(CLEF.treble) <= cost(CLEF.bass) ? 'treble' : 'bass';
}

export function layout(piece) {
  const barW = BAR_WIDTH[piece.species];
  const n = piece.cf.length;
  const upperNotes = piece.above ? piece.cp : piece.cf;
  const lowerNotes = piece.above ? piece.cf : piece.cp;
  const upper = { clef: chooseClef(upperNotes), top: 54 };
  const lower = { clef: chooseClef(lowerNotes), top: 54 + 4 * S + 92 };
  const width = LEFT + n * barW + 24;
  const height = lower.top + 4 * S + 58;
  // x of a time in quarter notes; notes sit a little after the bar line.
  const xAt = (t) => {
    const bar = Math.min(n - 1, Math.floor(t / 4));
    const pad = 16;
    return LEFT + bar * barW + pad + ((t - 4 * bar) / 4) * (barW - pad - 8);
  };
  return { barW, n, upper, lower, width, height, xAt };
}

const yOf = (staff, d) => staff.top + (CLEF[staff.clef].top - d) * (S / 2);

function staffLines(staff, x0, x1) {
  let s = '';
  for (let i = 0; i < 5; i++) s += `<line x1="${x0}" x2="${x1}" y1="${staff.top + i * S}" y2="${staff.top + i * S}" />`;
  return s;
}

function clefGlyph(staff, x) {
  if (staff.clef === 'treble') {
    const y = staff.top + 3 * S; // the G line
    return `<path d="${TREBLE}" transform="translate(${x},${y}) scale(0.95)" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" />` +
      `<circle cx="${x - 3.6}" cy="${y + 25.2}" r="2.6" fill="${INK}" />`;
  }
  const y = staff.top + S; // the F line
  return `<path d="${BASS}" transform="translate(${x - 4},${y}) scale(0.95)" fill="${INK}" />` +
    `<circle cx="${x - 4}" cy="${y}" r="3.6" fill="${INK}" />` +
    `<circle cx="${x + 16}" cy="${y - 5}" r="1.7" fill="${INK}" /><circle cx="${x + 16}" cy="${y + 5}" r="1.7" fill="${INK}" />`;
}

function ledgers(staff, d, x) {
  const c = CLEF[staff.clef];
  let s = '';
  for (let e = c.bottom - 2; e >= d; e -= 2) s += `<line x1="${x - 9}" x2="${x + 9}" y1="${yOf(staff, e)}" y2="${yOf(staff, e)}" />`;
  for (let e = c.top + 2; e <= d; e += 2) s += `<line x1="${x - 9}" x2="${x + 9}" y1="${yOf(staff, e)}" y2="${yOf(staff, e)}" />`;
  return s;
}

function sharp(x, y) {
  return `<g class="acc"><line x1="${x - 2}" x2="${x - 2}" y1="${y - 9}" y2="${y + 8}" /><line x1="${x + 2}" x2="${x + 2}" y1="${y - 8}" y2="${y + 9}" />` +
    `<path d="M${x - 5},${y - 2} L${x + 5},${y - 5} L${x + 5},${y - 3} L${x - 5},${y} Z M${x - 5},${y + 4} L${x + 5},${y + 1} L${x + 5},${y + 3} L${x - 5},${y + 6} Z" fill="currentColor" stroke="none" /></g>`;
}

// One notehead (plus stem), coloured by the caller through `currentColor`.
function head(x, y, dur, stemUp) {
  if (dur >= 4) {
    return `<ellipse cx="${x}" cy="${y}" rx="6.6" ry="4.4" fill="currentColor" />` +
      `<ellipse cx="${x}" cy="${y}" rx="3.1" ry="2.3" transform="rotate(-50 ${x} ${y})" fill="${PAPER}" />`;
  }
  let s = `<ellipse cx="${x}" cy="${y}" rx="5.6" ry="3.9" transform="rotate(-22 ${x} ${y})" fill="currentColor" />`;
  if (dur === 2) s += `<ellipse cx="${x}" cy="${y}" rx="4.1" ry="1.7" transform="rotate(-28 ${x} ${y})" fill="${PAPER}" />`;
  const sx = stemUp ? x + 5 : x - 5;
  const sy = stemUp ? y - 1.5 : y + 1.5;
  s += `<line x1="${sx}" x2="${sx}" y1="${sy}" y2="${stemUp ? y - 34 : y + 34}" stroke="currentColor" stroke-width="1.3" />`;
  return s;
}

function rest(staff, x, dur) {
  const mid = staff.top + 2 * S;
  if (dur === 2) return `<rect x="${x - 6}" y="${mid - 5}" width="12" height="5" fill="${INK}" />`;
  // quarter rest
  const y = mid - 14;
  return `<path d="M${x - 2},${y} L${x + 4},${y + 8} Q${x},${y + 12} ${x + 3},${y + 17} L${x + 1},${y + 18} Q${x - 4},${y + 15} ${x - 2},${y + 21} Q${x - 9},${y + 16} ${x - 1},${y + 15} L${x - 3},${y + 10} Q${x + 1},${y + 6} ${x - 2},${y} Z" fill="${INK}" />`;
}

// Split notes at bar lines into tied noteheads, as engravers do.
function pieces(note) {
  const out = [];
  let t = note.start;
  const end = note.start + note.dur;
  while (t < end) {
    const barEnd = 4 * (Math.floor(t / 4) + 1);
    const e = Math.min(end, barEnd);
    out.push({ start: t, dur: e - t });
    t = e;
  }
  return out;
}

/**
 * Draw the score. Options:
 *   analysis  - from rules.analyse, to colour mistakes and print interval figures
 *   selected  - index of the selected counterpoint note
 *   figures   - whether to print intervals between the staves
 */
export function engrave(piece, { analysis = null, selected = -1, figures = true, title = '' } = {}) {
  const L = layout(piece);
  const { upper, lower, xAt, width, height, n, barW } = L;
  const cpStaff = piece.above ? upper : lower;
  const cfStaff = piece.above ? lower : upper;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="score" role="img" aria-label="${esc(title || 'Score')}">`);
  parts.push(`<rect width="${width}" height="${height}" fill="${PAPER}" />`);
  const x1 = LEFT + n * barW;
  parts.push(`<g stroke="${INK}" stroke-width="0.9">${staffLines(upper, 14, x1)}${staffLines(lower, 14, x1)}</g>`);
  // System bracket, bar lines and the final double bar.
  parts.push(`<g stroke="${INK}">`);
  parts.push(`<line x1="14" x2="14" y1="${upper.top}" y2="${lower.top + 4 * S}" stroke-width="1.2" />`);
  parts.push(`<path d="M9,${upper.top - 8} L9,${lower.top + 4 * S + 8}" stroke-width="3.2" /><path d="M9,${upper.top - 8} q4,-1 9,-6 M9,${lower.top + 4 * S + 8} q4,1 9,6" fill="none" stroke-width="1.6" />`);
  for (let b = 1; b < n; b++) {
    const x = LEFT + b * barW;
    for (const st of [upper, lower]) parts.push(`<line x1="${x}" x2="${x}" y1="${st.top}" y2="${st.top + 4 * S}" stroke-width="1" />`);
  }
  for (const st of [upper, lower]) {
    parts.push(`<line x1="${x1 - 5}" x2="${x1 - 5}" y1="${st.top}" y2="${st.top + 4 * S}" stroke-width="1" />`);
    parts.push(`<line x1="${x1 - 1}" x2="${x1 - 1}" y1="${st.top}" y2="${st.top + 4 * S}" stroke-width="3.4" />`);
  }
  parts.push('</g>');
  parts.push(clefGlyph(upper, 30), clefGlyph(lower, 30));
  // Bar numbers and voice labels.
  parts.push(`<g class="label" font-size="10" fill="#7a6a55">`);
  for (let b = 0; b < n; b++) parts.push(`<text x="${LEFT + b * barW + 3}" y="${upper.top - 22}">${b + 1}</text>`);
  parts.push(`<text x="18" y="${upper.top - 34}" font-style="italic" font-size="12">${piece.above ? 'Counterpoint' : 'Cantus firmus'}</text>`);
  parts.push(`<text x="18" y="${lower.top - 26}" font-style="italic" font-size="12">${piece.above ? 'Cantus firmus' : 'Counterpoint'}</text>`);
  parts.push('</g>');

  // Status of each counterpoint note: an error or advice beats a plain note.
  const status = new Map();
  if (analysis) {
    for (const v of analysis.violations) {
      for (const i of v.notes) if (v.severity === 'error' || !status.has(i)) status.set(i, v.severity);
    }
  }

  // The cantus firmus.
  parts.push(`<g class="voice cf" stroke="${INK}" stroke-width="0.9">`);
  piece.cf.forEach((p, i) => {
    const x = xAt(4 * i) + 6;
    const y = yOf(cfStaff, p.d);
    parts.push(`<g class="note" data-voice="cf" data-index="${i}" color="${INK}">${ledgers(cfStaff, p.d, x)}${head(x, y, 4, false)}</g>`);
  });
  parts.push('</g>');

  // The counterpoint, with rests, ties and accidentals.
  parts.push(`<g class="voice cp" stroke="${INK}" stroke-width="0.9">`);
  const first = piece.cp[0];
  if (first && first.start > 0) {
    if (first.start === 2) parts.push(rest(cpStaff, xAt(0), 2));
    else parts.push(rest(cpStaff, xAt(0), 1));
  }
  piece.cp.forEach((p, i) => {
    const color = i === selected ? '#1d5fa8' : status.get(i) === 'error' ? '#b3261e' : status.get(i) === 'advice' ? '#a86a12' : INK;
    const y = yOf(cpStaff, p.d);
    const stemUp = p.d < CLEF[cpStaff.clef].middle;
    const segs = pieces(p);
    let g = `<g class="note${i === selected ? ' selected' : ''}" data-voice="cp" data-index="${i}" color="${color}">`;
    segs.forEach((seg, j) => {
      const x = xAt(seg.start) + (seg.dur >= 4 ? 6 : 0);
      if (i === selected && j === 0) g += `<circle cx="${x}" cy="${y}" r="12" fill="#1d5fa8" fill-opacity="0.13" stroke="none" />`;
      g += ledgers(cpStaff, p.d, x);
      if (j === 0 && p.acc > 0) g += sharp(x - 13, y);
      g += head(x, y, seg.dur, stemUp);
      if (j > 0) {
        const xp = xAt(segs[j - 1].start) + (segs[j - 1].dur >= 4 ? 6 : 0);
        const dy = stemUp ? 7 : -7;
        g += `<path class="tie" d="M${xp + 6},${y + dy * 0.6} Q${(xp + x) / 2},${y + dy * 1.9} ${x - 6},${y + dy * 0.6}" fill="none" stroke="currentColor" stroke-width="1.4" />`;
      }
    });
    // A generous invisible hit area, so notes are easy to click.
    const xs = xAt(p.start);
    g += `<rect x="${xs - 10}" y="${y - 12}" width="${Math.max(22, xAt(p.start + p.dur - 0.01) - xs + 18)}" height="24" fill="transparent" stroke="none" class="hit" />`;
    g += '</g>';
    parts.push(g);
  });
  parts.push('</g>');

  // Interval figures between the staves, as a teacher pencils them in.
  if (figures && analysis) {
    const yFig = upper.top + 4 * S + 48;
    parts.push(`<g class="figures" font-size="11" text-anchor="middle">`);
    piece.cp.forEach((p, i) => {
      const a = analysis.notes[i];
      const fig = { passing: 'p', neighbour: 'n', cambiata: 'c', suspension: '' }[a.figure] ?? '';
      const diss = !a.attack.consonant;
      parts.push(`<text x="${xAt(p.start)}" y="${yFig}" fill="${diss ? '#8a3b12' : '#5c4f3d'}">${a.label}</text>`);
      if (fig && diss) parts.push(`<text x="${xAt(p.start)}" y="${yFig + 12}" font-size="9" font-style="italic" fill="#8a3b12">${fig}</text>`);
      if (a.held) {
        const x = xAt(4 * Math.floor(p.start / 4) + 4) + 0;
        const hd = !a.held.consonant;
        parts.push(`<text x="${x}" y="${yFig}" fill="${hd ? '#8a3b12' : '#5c4f3d'}">${Math.abs(a.held.d) + 1}</text>`);
        if (hd) parts.push(`<text x="${x}" y="${yFig + 12}" font-size="9" font-style="italic" fill="#8a3b12">s</text>`);
      }
    });
    parts.push('</g>');
  }
  parts.push(`<line class="cursor" x1="-10" x2="-10" y1="${upper.top - 14}" y2="${lower.top + 4 * S + 14}" stroke="#1d5fa8" stroke-width="1.5" stroke-opacity="0.55" />`);
  parts.push('</svg>');
  return { svg: parts.join(''), layout: L };
}

export const _test = { yOf, CLEF, step };
