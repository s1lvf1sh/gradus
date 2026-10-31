import { newPiece, composeCounterpoint, explain, registers } from './compose.js';
import { analyse, applyFicta } from './rules.js';
import { engrave } from './engrave.js';
import { renderPiece, encodeWav } from './synth.js';
import { Rng } from './rng.js';
import { MODES, noteName, melodic } from './pitch.js';

const $ = (id) => document.getElementById(id);
const SPECIES_NAMES = ['', 'First species', 'Second species', 'Third species', 'Fourth species'];
const INTERVALS = ['unison', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth'];
const FIGURES = {
  passing: 'a dissonant passing tone, approached and left by step in one direction',
  neighbour: 'a dissonant neighbour note, stepping away and back',
  cambiata: 'a cambiata: a dissonance left by a leap of a third down, then recovered by step',
  suspension: 'a suspension: consonant when struck, dissonant when the cantus moves beneath it, then resolving down by step',
};

const state = {
  mode: 'dorian',
  species: 1,
  above: true,
  seed: 1,
  variant: 0,
  piece: null,
  original: null,
  analysis: null,
  selected: -1,
  edited: new Set(),
  notice: '',
  figures: true,
  audio: null,
  playing: null,
  ctx: null,
  noteEls: [],
};

// --- state and URL ---

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (MODES[h.get('mode')]) state.mode = h.get('mode');
  const sp = Number(h.get('species'));
  if (sp >= 1 && sp <= 4) state.species = sp;
  if (h.has('above')) state.above = h.get('above') !== '0';
  state.seed = Number(h.get('seed')) >>> 0 || 1 + Math.floor(Math.random() * 9999);
  state.variant = Number(h.get('v')) >>> 0 || 0;
  state.initialSelection = h.has('sel') ? Number(h.get('sel')) : -1;
}

function writeHash() {
  const h = new URLSearchParams({ mode: state.mode, species: state.species, above: state.above ? 1 : 0, seed: state.seed });
  if (state.variant) h.set('v', state.variant);
  history.replaceState(null, '', `#${h}`);
}

function compose() {
  stop();
  const piece = newPiece({ mode: state.mode, species: state.species, above: state.above, seed: state.seed, variant: state.variant });
  state.piece = piece;
  state.original = piece;
  state.edited.clear();
  state.selected = -1;
  state.audio = null;
  state.notice = piece.skipped
    ? `The first cantus for this seed admits no ${SPECIES_NAMES[state.species].toLowerCase()} counterpoint ${state.above ? 'above' : 'below'} it under the strict rules (the search proved it), so the composer wrote another.`
    : '';
  writeHash();
  syncControls();
  draw();
}

// --- drawing ---

function draw() {
  const piece = state.piece;
  const drawable = piece.cp ? piece : { ...piece, cp: [] };
  state.analysis = piece.cp ? analyse(piece) : null;
  const ordinal = SPECIES_NAMES[piece.species];
  const title = `${MODES[piece.mode].name} · ${ordinal} · counterpoint ${piece.above ? 'above' : 'below'}`;
  $('piece-title').innerHTML = `${title}<span class="sub">cantus no. ${state.seed}${state.variant ? `, version ${state.variant + 1}` : ''}</span>`;
  const { svg, layout } = engrave(drawable, { analysis: state.analysis, selected: state.selected, figures: state.figures, title });
  $('score').innerHTML = svg;
  state.layout = layout;
  fitScore();
  state.noteEls = [...$('score').querySelectorAll('.note')].map((el) => {
    const i = Number(el.dataset.index);
    const isCf = el.dataset.voice === 'cf';
    const n = isCf ? { start: 4 * i, dur: 4 } : piece.cp[i];
    return { el, start: n.start, end: n.start + n.dur };
  });
  renderRemarks();
  renderWhy();
  $('finish').disabled = state.edited.size === 0;
  $('revert').disabled = state.edited.size === 0 && state.piece === state.original;
}

// Scale the score to the panel, up to 1.7 times its natural size.
function fitScore() {
  const svg = $('score').querySelector('svg');
  if (!svg) return;
  const natural = state.layout.width;
  const room = $('score').clientWidth - 12;
  const w = Math.max(natural, Math.min(room, natural * 1.7));
  svg.style.width = `${w}px`;
  svg.style.height = `${(w / natural) * state.layout.height}px`;
}
window.addEventListener('resize', () => state.layout && fitScore());

function syncControls() {
  $('mode').value = state.mode;
  for (const b of $('species').querySelectorAll('button')) b.setAttribute('aria-checked', String(Number(b.dataset.species) === state.species));
  for (const b of $('position').querySelectorAll('button')) b.setAttribute('aria-checked', String((b.dataset.above === '1') === state.above));
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

function summarise(piece, a) {
  const cp = piece.cp;
  let contrary = 0;
  let moves = 0;
  for (let k = 1; k < cp.length; k++) {
    if (cp[k].start % 4 !== 0) continue;
    const b = cp[k].start / 4;
    const cpDir = Math.sign(cp[k].d - cp[k - 1].d);
    const cfDir = Math.sign(piece.cf[b].d - piece.cf[b - 1].d);
    moves++;
    if (cpDir && cfDir && cpDir !== cfDir) contrary++;
  }
  const inner = a.notes.slice(1, -1).filter((n) => n.attack.consonant);
  const imperfect = inner.filter((n) => !n.attack.perfect).length;
  const leaps = cp.slice(1).filter((n, i) => melodic(cp[i], n).leap).length;
  const ds = cp.map((n) => n.d);
  const span = Math.max(...ds) - Math.min(...ds);
  const count = (f) => a.notes.filter((n) => n.figure === f).length;
  const stats = [];
  if (moves && piece.species !== 4) stats.push([`${Math.round((100 * contrary) / moves)}%`, 'contrary motion at bar lines']);
  if (inner.length) stats.push([`${Math.round((100 * imperfect) / inner.length)}%`, 'thirds and sixths']);
  stats.push([String(leaps), leaps === 1 ? 'leap' : 'leaps']);
  stats.push([INTERVALS[span] || `${span + 1}th`, 'range']);
  if (piece.species === 2 || piece.species === 3) stats.push([String(count('passing') + count('neighbour') + count('cambiata')), 'treated dissonances']);
  if (piece.species === 4) stats.push([String(count('suspension')), 'suspensions']);
  return stats;
}

function renderRemarks() {
  const el = $('remarks');
  const piece = state.piece;
  let html = state.notice ? `<p class="notice">${esc(state.notice)}</p>` : '';
  if (!piece.cp) {
    el.innerHTML = html + '<p class="verdict">No counterpoint could be written for this cantus.</p>';
    return;
  }
  const a = state.analysis;
  const e = a.errors.length;
  const adv = a.advice.length;
  const edited = state.edited.size > 0;
  let verdict;
  if (e) verdict = `${e} ${e === 1 ? 'fault' : 'faults'}${adv ? ` and ${adv} ${adv === 1 ? 'suggestion' : 'suggestions'}` : ''}. Correct the red notes before going on.`;
  else if (adv) verdict = `No faults${edited ? ' in your version' : ''}, but ${adv === 1 ? 'one thing' : `${adv} things`} to consider.`;
  else verdict = edited ? 'No faults, and nothing to criticise. Well done.' : 'No faults, and nothing to criticise.';
  html += `<p class="verdict">${verdict}</p>`;
  html += `<div class="stats">${summarise(piece, a).map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
  const list = [...a.errors, ...a.advice].sort((x, y) => (x.bar ?? 99) - (y.bar ?? 99));
  html += list
    .map((v, i) => `<div class="remark ${v.severity}" data-i="${i}"><span class="bar">${v.bar ? `bar ${v.bar}` : ''}</span><span class="title">${esc(v.title)}</span><span class="text">${esc(v.text)}</span></div>`)
    .join('');
  el.innerHTML = html;
  el.querySelectorAll('.remark').forEach((r) => {
    r.addEventListener('click', () => {
      const v = list[Number(r.dataset.i)];
      if (v.notes.length) select(v.notes[v.notes.length - 1]);
    });
  });
}

function renderWhy() {
  const el = $('why');
  const k = state.selected;
  const piece = state.piece;
  if (k < 0 || !piece.cp) {
    el.innerHTML = '<p class="muted">Select a note of the counterpoint. Every pitch the composer could have written there is listed, with what the rules say about it.</p>';
    return;
  }
  const note = piece.cp[k];
  const info = state.analysis.notes[k];
  const bar = Math.floor(note.start / 4) + 1;
  const beat = (note.start % 4) + 1;
  const where = piece.species === 1 ? `Bar ${bar}` : `Bar ${bar}, beat ${beat}`;
  const iv = INTERVALS[Math.abs(info.attack.d)] || `${Math.abs(info.attack.d) + 1}th`;
  let desc = `${noteName(note)}, a ${iv} ${piece.above ? 'above' : 'below'} the cantus`;
  desc += FIGURES[info.figure] ? `: ${FIGURES[info.figure]}.` : info.attack.consonant ? ', a consonance.' : ', a dissonance.';
  if (note.acc > 0) desc += ' The sharp is musica ficta: the leading tone is raised to lean into the final.';
  const rows = explain(piece, k);
  const allowed = rows.filter((r) => !r.errors.length).length;
  let html = `<p class="why-head"><strong>${where}.</strong> ${esc(desc)}</p>`;
  html += `<p class="muted">${allowed === 1 ? 'Only this pitch is allowed here.' : `${allowed} of ${rows.length} pitches are allowed here.`} Click a row to try it.</p>`;
  html += '<table class="why"><tbody>';
  for (const r of rows) {
    let verdict;
    if (r.errors.length) {
      const seen = new Set();
      const reasons = r.errors.filter((v) => !seen.has(v.title) && seen.add(v.title)).map((v) => `${esc(v.title)}${v.bar ? ` (bar ${v.bar})` : ''}`);
      verdict = `<span class="no">Forbidden:</span> ${reasons.join(' · ')}`;
    } else if (r.chosen) {
      verdict = `<span class="ok">${state.edited.size ? 'Current note' : 'Chosen'}.</span>${r.advice.length ? ` <span class="meh">${esc(r.advice.map((v) => v.title).join(' · '))}</span>` : ''}`;
    } else {
      const delta = r.cost;
      const taste = delta > 0.05 ? `allowed, but the composer liked it less (+${delta.toFixed(1)})` : delta < -0.05 ? `allowed, and by the composer's own measure better here (${delta.toFixed(1)})${state.edited.size ? '' : '; its search adds a little chance, for variety'}` : 'allowed, and just as good';
      verdict = `<span class="ok">${taste[0].toUpperCase() + taste.slice(1)}.</span>${r.advice.length ? ` <span class="meh">${esc(r.advice.map((v) => v.title).join(' · '))}</span>` : ''}`;
    }
    html += `<tr class="${r.chosen ? 'chosen' : ''}" data-d="${r.d}"><td class="name">${r.name}</td><td>${verdict}</td></tr>`;
  }
  html += '</tbody></table>';
  el.innerHTML = html;
  el.querySelectorAll('tr').forEach((tr) => tr.addEventListener('click', () => setPitch(k, Number(tr.dataset.d))));
}

// --- editing ---

function select(k) {
  state.selected = k;
  draw();
  $('score').focus({ preventScroll: true });
}

function setPitch(k, d) {
  const { cpFinal } = registers(state.piece);
  if (d < cpFinal - 7 || d > cpFinal + 11) return;
  stop();
  const cp = state.piece.cp.map((n) => ({ ...n }));
  cp[k].d = d;
  state.piece = applyFicta({ ...state.piece, cp });
  state.edited.add(cp[k].start);
  state.audio = null;
  state.notice = '';
  draw();
}

function finish() {
  stop();
  const locked = new Map();
  for (const n of state.piece.cp) if (state.edited.has(n.start)) locked.set(n.start, n.d);
  const result = composeCounterpoint(state.piece, new Rng((Math.random() * 2 ** 32) >>> 0), { locked });
  if (result.cp) {
    state.piece = result;
    state.notice = `The composer kept your ${locked.size === 1 ? 'note' : `${locked.size} notes`} and rewrote the rest around ${locked.size === 1 ? 'it' : 'them'}.`;
  } else {
    state.notice = result.proven
      ? 'No counterpoint that keeps your notes can obey every rule. The search tried every possibility. Change one of them and ask again.'
      : 'The composer could not find a way to keep your notes. Try changing one of them.';
  }
  state.audio = null;
  draw();
}

function revert() {
  stop();
  state.piece = state.original;
  state.edited.clear();
  state.notice = '';
  state.audio = null;
  draw();
}

// --- sound ---

function stop() {
  if (state.playing) {
    state.playing.src.onended = null;
    state.playing.src.stop();
    state.playing = null;
  }
  $('play').textContent = '▶ Play';
  for (const n of state.noteEls) n.el.classList.remove('playing');
  const cursor = $('score').querySelector('.cursor');
  if (cursor) cursor.setAttribute('x1', -10), cursor.setAttribute('x2', -10);
}

function settings() {
  return { tempo: Number($('tempo').value), tuning: $('tuning').value };
}

async function render() {
  if (!state.audio) {
    $('play').textContent = 'Rendering…';
    await new Promise((r) => setTimeout(r, 30));
    state.audio = renderPiece(state.piece, settings());
  }
  return state.audio;
}

async function play() {
  if (state.playing) return stop();
  if (!state.piece.cp) return;
  state.ctx ??= new AudioContext();
  await state.ctx.resume();
  const audio = await render();
  const ctx = state.ctx;
  const buf = ctx.createBuffer(2, audio.left.length, audio.sampleRate);
  buf.copyToChannel(audio.left, 0);
  buf.copyToChannel(audio.right, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  src.start(t0);
  src.onended = stop;
  state.playing = { src, t0 };
  $('play').textContent = '■ Stop';
  const q = 60 / settings().tempo;
  const total = 4 * state.piece.cf.length;
  const cursor = $('score').querySelector('.cursor');
  const tick = () => {
    if (!state.playing || state.playing.src !== src) return;
    const t = Math.max(0, (ctx.currentTime - t0) / q);
    if (t < total) {
      const x = state.layout.xAt(t);
      cursor.setAttribute('x1', x);
      cursor.setAttribute('x2', x);
    }
    for (const n of state.noteEls) n.el.classList.toggle('playing', t >= n.start && t < n.end);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function download() {
  const audio = state.audio ?? renderPiece(state.piece, settings());
  state.audio = audio;
  const blob = new Blob([encodeWav(audio)], { type: 'audio/wav' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gradus-${state.mode}-species${state.species}-${state.above ? 'above' : 'below'}-${state.seed}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// --- wiring ---

$('mode').addEventListener('change', (e) => {
  state.mode = e.target.value;
  state.variant = 0;
  compose();
});
$('species').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.species = Number(b.dataset.species);
  state.variant = 0;
  compose();
});
$('position').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.above = b.dataset.above === '1';
  state.variant = 0;
  compose();
});
$('new-cantus').addEventListener('click', () => {
  state.seed = 1 + Math.floor(Math.random() * 9999);
  state.variant = 0;
  compose();
});
$('recompose').addEventListener('click', () => {
  const before = JSON.stringify(state.original.cp);
  // A short cantus in the first species may have few good answers; skip repeats.
  for (let tries = 0; tries < 6; tries++) {
    state.variant++;
    compose();
    if (JSON.stringify(state.original.cp) !== before) break;
  }
});
$('play').addEventListener('click', play);
$('download').addEventListener('click', download);
$('finish').addEventListener('click', finish);
$('revert').addEventListener('click', revert);
$('tempo').addEventListener('input', (e) => {
  $('tempo-value').textContent = e.target.value;
  stop();
  state.audio = null;
});
$('tuning').addEventListener('change', () => {
  stop();
  state.audio = null;
});
$('figures').addEventListener('change', (e) => {
  state.figures = e.target.checked;
  draw();
});
$('score').addEventListener('click', (e) => {
  const g = e.target.closest('.note[data-voice="cp"]');
  if (g) select(Number(g.dataset.index));
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('select, input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = state.selected;
  const cp = state.piece.cp;
  if (e.key === ' ' && !e.target.closest('button')) {
    e.preventDefault();
    play();
  } else if (k >= 0 && cp && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    setPitch(k, cp[k].d + (e.key === 'ArrowUp' ? 1 : -1));
  } else if (cp && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const next = k < 0 ? 0 : k + (e.key === 'ArrowRight' ? 1 : -1);
    if (next >= 0 && next < cp.length) select(next);
  } else if (e.key === 'Escape' && k >= 0) {
    select(-1);
  }
});

readHash();
compose();
if (state.initialSelection >= 0 && state.piece.cp && state.initialSelection < state.piece.cp.length) select(state.initialSelection);
