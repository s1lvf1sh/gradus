// Headless checks for Gradus: the composer, the critic, the synthesiser and the engraver.
// Run with `npm test`.

import { MODES, frequency, melodic, harmonic, toMidi, leadingStep, step } from '../src/pitch.js';
import { analyse, applyFicta, checkCantus, rhythm } from '../src/rules.js';
import { newPiece, composeCounterpoint, explain, registers } from '../src/compose.js';
import { renderVoice, renderPiece, timeline, encodeWav } from '../src/synth.js';
import { engrave } from '../src/engrave.js';
import { Rng } from '../src/rng.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

const MODE_IDS = Object.keys(MODES);
const t0 = Date.now();

// 1. Every combination composes, obeys every rule, and cadences properly.
{
  let pieces = 0;
  let missing = 0;
  let errors = 0;
  let badCadence = 0;
  let badCantus = 0;
  let skipped = 0;
  let advice = 0;
  const slowest = { ms: 0 };
  for (const mode of MODE_IDS) {
    for (const species of [1, 2, 3, 4]) {
      for (const above of [true, false]) {
        for (let seed = 1; seed <= 6; seed++) {
          const s = Date.now();
          const p = newPiece({ mode, species, above, seed });
          const ms = Date.now() - s;
          if (ms > slowest.ms) Object.assign(slowest, { ms, mode, species, above, seed });
          pieces++;
          skipped += p.skipped;
          if (!p.cp) {
            missing++;
            continue;
          }
          const a = analyse(p);
          errors += a.errors.length;
          advice += a.advice.length;
          const { cpFinal } = registers(p);
          const last = p.cp[p.cp.length - 1];
          const ti = p.cp[p.cp.length - 2];
          const raised = MODES[mode].raise ? 1 : 0;
          if (last.d !== cpFinal || ti.d !== cpFinal - 1 || ti.acc !== raised || step(ti.d) !== leadingStep(mode)) badCadence++;
          const cantus = p.cantus;
          for (let k = 0; k < cantus.length; k++) if (checkCantus(cantus, k, cantus.length, MODES[mode].final).some((v) => v.severity === 'error')) badCantus++;
        }
      }
    }
  }
  check(`all ${pieces} pieces compose`, missing === 0, `${missing} missing, ${skipped} cantus set aside as unsolvable`);
  check('no composed piece breaks a rule', errors === 0, `${errors} errors, ${(advice / pieces).toFixed(2)} pieces of advice per piece`);
  check('every piece ends leading tone to final', badCadence === 0, `${badCadence} bad`);
  check('every cantus firmus obeys the cantus rules', badCantus === 0, `${badCantus} violations`);
  check('composition is quick', slowest.ms < 3000, `slowest ${slowest.ms} ms (${slowest.mode} ${slowest.species} ${slowest.above ? 'above' : 'below'} ${slowest.seed}), all in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// 2. Reproducible, and the cantus survives a change of species or voice.
{
  const a = newPiece({ mode: 'dorian', species: 2, above: true, seed: 42 });
  const b = newPiece({ mode: 'dorian', species: 2, above: true, seed: 42 });
  check('same seed, same piece', JSON.stringify(a.cp) === JSON.stringify(b.cp) && JSON.stringify(a.cf) === JSON.stringify(b.cf));
  let same = 0;
  let total = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const ref = newPiece({ mode: 'mixolydian', species: 1, above: true, seed });
    for (const species of [2, 3, 4]) {
      for (const above of [true, false]) {
        const p = newPiece({ mode: 'mixolydian', species, above, seed });
        total++;
        if (!p.skipped && !ref.skipped && JSON.stringify(p.cantus) === JSON.stringify(ref.cantus)) same++;
        else if (p.skipped || ref.skipped) total--;
      }
    }
  }
  check('the cantus stays the same across species and voices', same === total, `${same}/${total}`);
  const v1 = newPiece({ mode: 'dorian', species: 1, above: true, seed: 42, variant: 1 });
  const v0 = newPiece({ mode: 'dorian', species: 1, above: true, seed: 42 });
  check('a new version keeps the cantus but changes the counterpoint', JSON.stringify(v0.cf) === JSON.stringify(v1.cf) && JSON.stringify(v0.cp) !== JSON.stringify(v1.cp));
}

// 3. The critic recognises a sound textbook exercise, and catches classic faults.
const FUX_DORIAN = [29 - 7, 31 - 7, 30 - 7, 29 - 7, 32 - 7, 31 - 7, 33 - 7, 32 - 7, 31 - 7, 30 - 7, 29 - 7]; // D3 F3 E3 D3 G3 F3 A3 G3 F3 E3 D3
const cf = FUX_DORIAN.map((d) => ({ d, acc: 0 }));
const firstSpecies = (ds, above = true, mode = 'dorian') => applyFicta({ mode, species: 1, above, cf, cp: ds.map((d, i) => ({ d, acc: 0, start: 4 * i, dur: 4 })) });
const rulesOf = (p) => new Set(analyse(p).violations.map((v) => v.rule));
{
  // A3 A3 G3 A3 B3 C4 C4 B3 D4 C#4 D4 over Fux's Dorian cantus.
  const good = firstSpecies([26, 26, 25, 26, 27, 28, 28, 27, 29, 28, 29]);
  const a = analyse(good);
  check('a sound first-species exercise has no faults', a.errors.length === 0, a.errors.map((e) => e.rule).join(', ') || `advice only: ${a.advice.map((v) => v.rule).join(', ')}`);
  check('the leading tone is raised by musica ficta', good.cp[9].acc === 1);

  const fifths = firstSpecies([26, 28, 27, 26, 27, 28, 28, 27, 29, 28, 29]); // D-A then F-C: parallel fifths
  check('parallel fifths are caught', rulesOf(fifths).has('parallel-perfect'));
  const hidden = firstSpecies([26, 26, 25, 27, 29, 26, 28, 27, 29, 28, 29]); // B3 to D4 while the cantus rises D3 to G3
  check('hidden octaves are caught', rulesOf(hidden).has('direct-perfect'));
  const seventh = firstSpecies([26, 32, 25, 26, 27, 28, 28, 27, 29, 28, 29]); // A3 up to G4
  check('a dissonant downbeat is caught', rulesOf(firstSpecies([26, 26, 26, 26, 27, 28, 28, 27, 29, 28, 29])).has('dissonant-downbeat'));
  check('a leap of a seventh is caught', rulesOf(seventh).has('bad-leap'));
  const noCadence = firstSpecies([26, 26, 25, 26, 27, 28, 28, 27, 29, 26, 29]);
  check('a missing leading tone is caught', rulesOf(noCadence).has('cadence'));
  const crossed = firstSpecies([26, 26, 25, 21, 27, 28, 28, 27, 29, 28, 29]);
  check('crossed voices are caught', rulesOf(crossed).has('crossing'));

  // Second species: a dissonant weak beat that leaps away.
  const s2 = newPiece({ mode: 'dorian', species: 2, above: true, seed: 5 });
  const bad2 = { ...s2, cp: s2.cp.map((n) => ({ ...n })) };
  const j = bad2.cp.findIndex((n, i) => i > 2 && n.start % 4 === 2 && i < bad2.cp.length - 4);
  let caught2 = false;
  for (let d = bad2.cp[j].d - 6; d <= bad2.cp[j].d + 6 && !caught2; d++) {
    const t = { ...bad2, cp: bad2.cp.map((n, i) => (i === j ? { ...n, d } : n)) };
    const v = harmonic(t.cf[Math.floor(t.cp[j].start / 4)], t.cp[j]);
    const step1 = Math.abs(t.cp[j].d - t.cp[j - 1].d) === 1 && Math.abs(t.cp[j + 1].d - t.cp[j].d) === 1;
    if (!v.consonant && !step1) caught2 = rulesOf(t).has('unprepared-dissonance');
  }
  check('an untreated dissonance in the second species is caught', caught2);

  // Fourth species: break a suspension's resolution.
  const s4 = newPiece({ mode: 'dorian', species: 4, above: true, seed: 3 });
  const an4 = analyse(s4);
  const susp = an4.notes.findIndex((n) => n.figure === 'suspension');
  const bad4 = { ...s4, cp: s4.cp.map((n, i) => (i === susp + 1 ? { ...n, d: n.d + 2 } : { ...n })) };
  check('an unresolved suspension is caught', susp >= 0 && rulesOf(bad4).has('suspension-resolution'));
}

// 4. "Why this note?" agrees with the critic.
{
  const p = newPiece({ mode: 'phrygian', species: 1, above: true, seed: 9 });
  let chosenClean = true;
  let someForbidden = true;
  for (let k = 0; k < p.cp.length; k++) {
    const rows = explain(p, k);
    if (rows.find((r) => r.chosen).errors.length) chosenClean = false;
    if (!rows.some((r) => r.errors.length)) someForbidden = false;
  }
  check('every chosen note is allowed, and every note had forbidden alternatives', chosenClean && someForbidden);
  const rows = explain(p, p.cp.length - 2);
  const allowed = rows.filter((r) => !r.errors.length);
  check('at the cadence only the leading tone is allowed', allowed.length === 1 && allowed[0].chosen, rows.map((r) => `${r.name}:${r.errors.length}`).join(' '));
}

// 5. Finishing a student's line around fixed notes, and proving when it cannot be done.
{
  const base = newPiece({ mode: 'aeolian', species: 2, above: false, seed: 4 });
  const other = newPiece({ mode: 'aeolian', species: 2, above: false, seed: 4, variant: 3 });
  const k = 6;
  const locked = new Map([[other.cp[k].start, other.cp[k].d]]);
  const done = composeCounterpoint(base, new Rng(1), { locked });
  const kept = done.cp && done.cp.find((n) => n.start === other.cp[k].start).d === other.cp[k].d;
  check('the composer finishes a line around a student\'s note', kept && analyse(done).errors.length === 0);
  const ti = base.cp[base.cp.length - 2];
  const impossible = composeCounterpoint(base, new Rng(1), { locked: new Map([[ti.start, ti.d + 1]]) });
  check('an impossible request is proven impossible', impossible.cp === null && impossible.proven === true);
}

// 6. Pitch, intervals and tuning.
{
  const C4 = { d: 28, acc: 0 };
  const E4 = { d: 30, acc: 0 };
  const G4 = { d: 32, acc: 0 };
  check('A4 is 440 Hz in both tunings', Math.abs(frequency({ d: 33, acc: 0 }) - 440) < 1e-9 && Math.abs(frequency({ d: 33, acc: 0 }, 'equal') - 440) < 1e-9);
  check('meantone major thirds are pure (5:4)', Math.abs(frequency(E4) / frequency(C4) - 1.25) < 1e-12);
  check('meantone fifths are narrowed to the fourth root of 5', Math.abs(frequency(G4) / frequency(C4) - Math.pow(5, 0.25)) < 1e-12);
  check('equal temperament matches MIDI', Math.abs(frequency(E4, 'equal') - 440 * Math.pow(2, (toMidi(E4) - 69) / 12)) < 1e-9);
  check('F up to B is a forbidden tritone', !melodic({ d: 31, acc: 0 }, { d: 34, acc: 0 }).ok);
  check('a minor sixth is allowed up but not down', melodic({ d: 30, acc: 0 }, { d: 35, acc: 0 }).ok && !melodic({ d: 35, acc: 0 }, { d: 30, acc: 0 }).ok);
  check('F to G sharp (augmented second) is forbidden', !melodic({ d: 31, acc: 0 }, { d: 32, acc: 1 }).ok);
  check('B against F is a dissonant diminished fifth', !harmonic({ d: 27, acc: 0 }, { d: 31, acc: 0 }).consonant);
  check('musica ficta is applied only at the cadence', (() => {
    const p = newPiece({ mode: 'aeolian', species: 3, above: true, seed: 2 });
    return p.cp.every((n, i) => n.acc === 0 || i >= p.cp.length - 3);
  })());
}

// 7. The synthesiser sings the right pitches.
// YIN pitch detection (de Cheveigné and Kawahara, 2002): the first dip of the
// cumulative-mean-normalised difference function below a threshold.
function pitchOf(x, a, b, sr) {
  const seg = x.subarray(a, b);
  const maxLag = Math.floor(sr / 50);
  const W = seg.length - maxLag;
  const d = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const v = seg[i] - seg[i + lag];
      s += v * v;
    }
    d[lag] = s;
  }
  let running = 0;
  const cmnd = new Float64Array(maxLag + 1).fill(1);
  for (let lag = 1; lag <= maxLag; lag++) {
    running += d[lag];
    cmnd[lag] = (d[lag] * lag) / running;
  }
  for (let lag = 2; lag < maxLag; lag++) {
    if (cmnd[lag] < 0.12) {
      while (lag + 1 < maxLag && cmnd[lag + 1] < cmnd[lag]) lag++;
      const p = (cmnd[lag - 1] - cmnd[lag + 1]) / (2 * (cmnd[lag - 1] - 2 * cmnd[lag] + cmnd[lag + 1]));
      return sr / (lag + p);
    }
  }
  return 0;
}
{
  const sr = 22050;
  let worst = 0;
  let notes = 0;
  for (const [mode, species, tuning] of [['dorian', 1, 'meantone'], ['mixolydian', 3, 'equal'], ['aeolian', 4, 'meantone']]) {
    const p = newPiece({ mode, species, above: true, seed: 11 });
    const tl = timeline(p, { tempo: 120, tuning });
    for (const [voice, vowel] of [[tl.cp, 'ah'], [tl.cf, 'oh']]) {
      const x = renderVoice(voice, { vowel, sampleRate: sr });
      for (const n of voice) {
        const a = Math.round((n.t0 + 0.12) * sr);
        const b = Math.min(Math.round((n.t1 - 0.03) * sr), a + 4096 + Math.floor(sr / 50));
        const f = pitchOf(x, a, b, sr);
        worst = Math.max(worst, Math.abs(1200 * Math.log2(f / n.freq)));
        notes++;
      }
    }
  }
  check('every sung note is within 5 cents of its target', worst < 5, `${notes} notes, worst ${worst.toFixed(2)} cents`);
  const p = newPiece({ mode: 'ionian', species: 2, above: false, seed: 3 });
  const s = Date.now();
  const audio = renderPiece(p, { sampleRate: sr });
  const ms = Date.now() - s;
  let peak = 0;
  let finite = true;
  for (let i = 0; i < audio.left.length; i++) {
    peak = Math.max(peak, Math.abs(audio.left[i]), Math.abs(audio.right[i]));
    if (!Number.isFinite(audio.left[i]) || !Number.isFinite(audio.right[i])) finite = false;
  }
  check('the mix is finite and does not clip', finite && peak <= 0.9 && peak > 0.5, `peak ${peak.toFixed(3)}, rendered in ${ms} ms`);
  const wav = new DataView(encodeWav(audio));
  const tag = (o) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(o + i)));
  check('the WAV file is well formed', tag(0) === 'RIFF' && tag(8) === 'WAVE' && wav.getUint32(24, true) === sr && wav.getUint32(40, true) === audio.left.length * 4 && wav.byteLength === 44 + audio.left.length * 4);
}

// 8. The engraver draws every note, tie and accidental.
{
  let ok = true;
  const problems = [];
  for (const species of [1, 2, 3, 4]) {
    for (const above of [true, false]) {
      const p = newPiece({ mode: 'dorian', species, above, seed: 8 });
      const { svg } = engrave(p, { analysis: analyse(p) });
      const notes = (svg.match(/class="note[^"]*" data-voice/g) || []).length;
      const ties = (svg.match(/class="tie"/g) || []).length;
      const sharps = (svg.match(/class="acc"/g) || []).length;
      const crossing = p.cp.filter((n) => Math.floor(n.start / 4) !== Math.floor((n.start + n.dur - 1) / 4)).length;
      const accs = p.cp.filter((n) => n.acc > 0).length;
      const opens = (svg.match(/<g[ >]/g) || []).length;
      const closes = (svg.match(/<\/g>/g) || []).length;
      if (notes !== p.cf.length + p.cp.length || ties !== crossing || sharps !== accs || opens !== closes || !svg.startsWith('<svg')) {
        ok = false;
        problems.push(`species ${species}: ${notes} notes, ${ties}/${crossing} ties, ${sharps}/${accs} sharps, ${opens}/${closes} groups`);
      }
    }
  }
  check('the score shows every note, tie and sharp', ok, problems.join('; '));
}

// 9. The rhythmic skeletons add up.
{
  let ok = true;
  for (const species of [1, 2, 3, 4]) {
    for (const n of [9, 12]) {
      const r = rhythm(species, n);
      const end = r[r.length - 1].start + r[r.length - 1].dur;
      for (let i = 1; i < r.length; i++) if (r[i].start !== r[i - 1].start + r[i - 1].dur) ok = false;
      if (end !== 4 * n) ok = false;
    }
  }
  check('each species fills the cantus exactly, without gaps', ok);
}

console.log(`\n${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
