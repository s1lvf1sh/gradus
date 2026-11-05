# Gradus

**A composer of strict counterpoint that can tell you why it wrote every note.**

Gradus writes two-voice counterpoint by the rules that Johann Joseph Fux set out in *Gradus ad Parnassum* (1725), the book that taught Haydn, Mozart and Beethoven. It draws the score, sings it with a synthesised choir, and explains itself. Click any note to see every pitch that could have gone there and the rule each alternative would break. Change notes yourself and the same rules judge your version. If you get stuck, it will finish the line around the notes you wrote, or prove that no correct finish exists.

**[Try it live](https://s1lvf1sh.github.io/gradus/)**

Runs in the browser. No dependencies, no build step and no samples: the notation is drawn as SVG paths, and the voices are synthesised sample by sample.

```
npm start            # http://localhost:8080
npm test             # 36 checks: composer, critic, synthesiser, engraver (~15 s)
npm run test:browser # 11 checks driving the real page in headless Firefox
```

Every piece is reproducible from its link, for example `#mode=dorian&species=4&above=1&seed=3`.

## What it does

- **Five modes** (Dorian, Phrygian, Mixolydian, Aeolian, Ionian) and **four species**: note against note, two against one, four against one, and syncopation with suspensions. The counterpoint can sit above or below the cantus.
- **A cantus firmus** is composed first, under the cantus rules: start and end on the final, approach the final from the step above, keep a single climax, recover from leaps, avoid tritones and stay within a tenth.
- **The counterpoint** is found by a beam search. Each partial line is extended by every pitch the rules allow, scored on taste, and the best few dozen survive each step. Taste means contrary motion, imperfect consonances, few leaps, and real dissonant suspensions in the fourth species. The beam keeps a variety of endings so that it doesn't arrive at the cadence with lines that all fail. If it still fails, a depth-first search with memoised dead ends takes over. Hard rules look back at most four notes (plus the overall range), so that search either finds a line or **proves none exists**.
- **The critic** shares one rules module with the composer: `checkNote(ctx, k)` reports every violation that note *k* completes, looking only backwards. The composer calls it while writing and the critic calls it afterwards, so their judgements cannot differ.
- **Musica ficta**: the leading tone is raised at the cadence, C♯ in Dorian for example. In Aeolian the sixth is raised too (F♯ G♯ A), which avoids the augmented second.
- **Singing**: additive voices whose harmonics are weighted by vowel formants ("ah" for the upper voice, "oh" for the lower), with vibrato that blooms after each attack, legato glides, and a Freeverb-style room. The tuning is **quarter-comma meantone**, the tuning of a sixteenth-century organ, where major thirds are exactly 5:4. Equal temperament is an option. Download any performance as a WAV file.

## How it is checked

I can't listen to the output, so the tests do the listening:

- 240 pieces (every mode, species and voice position) compose with **zero rule violations** and a correct cadence. One cantus out of the 240 had no possible counterpoint and was replaced, as the design intends.
- The critic accepts a sound textbook exercise and catches parallel fifths, hidden octaves, dissonant downbeats, forbidden leaps, crossed voices, untreated dissonances and unresolved suspensions.
- *Why this note?* agrees with the critic. At the cadence only the leading tone is allowed.
- The composer finishes a line around a student's fixed note, and proves an impossible request impossible.
- **Every sung note is pitch-tracked** with the YIN algorithm and lies within 5 cents of its target. The worst measured is under 1 cent.
- Meantone thirds are pure (5:4), and fifths are the fourth root of 5.
- The SVG score contains every note, tie and sharp, and its groups are balanced.
- In a real browser, clicking, arrow-key editing, *Finish it for me*, *Undo*, the species buttons, *Recompose* and playback with the moving cursor all work. The harness drives Firefox over WebDriver BiDi using Node's built-in WebSocket.

## Files

| File | What it holds |
|---|---|
| `src/pitch.js` | Diatonic pitch arithmetic, modes, intervals, meantone tuning |
| `src/rules.js` | Every rule of the species, the cantus rules, rhythm templates, ficta |
| `src/compose.js` | Cantus and counterpoint search, taste, *Why this note?* |
| `src/engrave.js` | SVG engraving: clefs, notes, ties, rests, accidentals, figures |
| `src/synth.js` | Formant voices, reverb, WAV export |
| `src/main.js` | The page: editing, remarks, playback |

The master's remarks paraphrase the traditional rules. They are not quotations from Fux.

MIT licensed.
