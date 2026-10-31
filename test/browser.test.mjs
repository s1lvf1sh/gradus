// Drives the real page in headless Firefox over WebDriver BiDi (built into Firefox,
// spoken here with Node's own WebSocket): real clicks, real key presses, real audio
// rendering. Needs Firefox on the PATH. Run with `npm run test:browser`.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8197;
const BIDI = 9337;
const profile = mkdtempSync(join(tmpdir(), 'gradus-ff-'));
const server = spawn(process.execPath, ['serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const firefox = spawn('firefox', ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${BIDI}`], { stdio: 'ignore' });
const cleanup = () => {
  firefox.kill();
  server.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 40 && !ws; i++) {
  await sleep(250);
  try {
    const s = new WebSocket(`ws://127.0.0.1:${BIDI}/session`);
    await new Promise((res, rej) => { s.onopen = res; s.onerror = rej; });
    ws = s;
  } catch {}
}
if (!ws) { console.log('FAIL  could not reach Firefox over WebDriver BiDi'); process.exit(1); }
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => m.type === 'error' ? rej(new Error(m.error + ': ' + m.message)) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
await send('session.new', { capabilities: {} });
const { context } = await send('browsingContext.create', { type: 'tab' });
await send('browsingContext.setViewport', { context, viewport: { width: 1440, height: 1400 } });
const evaluate = async (expression) => (await send('script.evaluate', { expression, target: { context }, awaitPromise: true })).result;
const val = (r) => r.value;
const click = async (x, y) => send('input.performActions', { context, actions: [{ type: 'pointer', id: 'm', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
const key = async (k) => send('input.performActions', { context, actions: [{ type: 'key', id: 'k', actions: [{ type: 'keyDown', value: k }, { type: 'keyUp', value: k }] }] });
const centre = async (sel) => JSON.parse(val(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]); })()`)));
const results = [];
const ok = (name, cond, detail = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

await send('browsingContext.navigate', { context, url: `http://localhost:${PORT}/#mode=dorian&species=1&above=1&seed=7`, wait: 'complete' });
await sleep(800);
const errs = val(await evaluate(`document.querySelectorAll('.remark.error').length`));
ok('page loads a faultless piece', errs === 0);

// Click the 4th counterpoint note.
let [x, y] = await centre('.note[data-voice="cp"][data-index="3"] .hit');
await click(x, y); await sleep(300);
const why = val(await evaluate(`document.querySelectorAll('#why tr').length`));
const sel = val(await evaluate(`document.querySelector('.note.selected')?.dataset.index ?? 'none'`));
ok('clicking a note selects it and explains it', sel === '3' && why > 5, `selected ${sel}, ${why} rows`);

// Arrow keys move it; the critic reacts.
const before = val(await evaluate(`document.querySelector('#why tr.chosen td.name').textContent`));
await key(''); await sleep(300); // ArrowUp
const after = val(await evaluate(`document.querySelector('#why tr.chosen td.name').textContent`));
const finishEnabled = val(await evaluate(`!document.getElementById('finish').disabled`));
ok('the up arrow raises the note and enables "Finish it for me"', before !== after && finishEnabled, `${before} -> ${after}`);
await key(''); await key(''); await sleep(300);
const faults = val(await evaluate(`document.querySelectorAll('.remark').length`));

// Finish it for me.
[x, y] = await centre('#finish'); await click(x, y); await sleep(1500);
const notice = val(await evaluate(`document.querySelector('#remarks .notice')?.textContent ?? ''`));
const errsAfter = val(await evaluate(`document.querySelectorAll('.remark.error').length`));
ok('"Finish it for me" keeps the edit or explains why not', /kept your|No counterpoint|could not/.test(notice), `${faults} remarks before; after: ${errsAfter} errors; "${notice.slice(0, 70)}..."`);

// A row in the "why" table applies that pitch.
[x, y] = await centre('#why tr:last-child'); await click(x, y); await sleep(300);
ok('clicking a row in the table tries that pitch', val(await evaluate(`document.querySelector('#why tr.chosen') === document.querySelector('#why tr:last-child')`)));

// Undo.
[x, y] = await centre('#revert'); await click(x, y); await sleep(300);
ok('"Undo my changes" restores a faultless piece', val(await evaluate(`document.querySelectorAll('.remark.error').length === 0 && document.getElementById('finish').disabled`)));

// Species buttons, position and recompose, with the hash following.
[x, y] = await centre('#species button[data-species="4"]'); await click(x, y); await sleep(1200);
[x, y] = await centre('#position button[data-above="0"]'); await click(x, y); await sleep(1200);
const hash = val(await evaluate('location.hash'));
ok('species and position buttons recompose and update the link', hash.includes('species=4') && hash.includes('above=0'), hash);
const cpBefore = val(await evaluate(`[...document.querySelectorAll('.note[data-voice=cp]')].length + ':' + document.querySelector('.voice.cp').innerHTML.length`));
[x, y] = await centre('#recompose'); await click(x, y); await sleep(1500);
const cpAfter = val(await evaluate(`[...document.querySelectorAll('.note[data-voice=cp]')].length + ':' + document.querySelector('.voice.cp').innerHTML.length`));
ok('Recompose writes a different counterpoint', cpBefore !== cpAfter && val(await evaluate('location.hash')).includes('v='));

// Play: rendering happens, the cursor moves.
[x, y] = await centre('#play'); await click(x, y); await sleep(3500);
const label = val(await evaluate(`document.getElementById('play').textContent`));
const cx = val(await evaluate(`Number(document.querySelector('.cursor').getAttribute('x1'))`));
const playing = val(await evaluate(`document.querySelectorAll('.note.playing').length`));
ok('Play renders audio and the cursor follows', label.includes('Stop') && cx > 60 && playing >= 1, `button "${label}", cursor x ${cx.toFixed?.(0) ?? cx}, ${playing} notes lit`);
[x, y] = await centre('#play'); await click(x, y); await sleep(200);
ok('Stop stops', val(await evaluate(`document.getElementById('play').textContent`)).includes('Play'));

// Keyboard navigation with nothing selected.
await evaluate(`document.getElementById('score').focus()`);
await key(''); await sleep(300); // ArrowRight
ok('right arrow selects the first note', val(await evaluate(`document.querySelector('.note.selected')?.dataset.index`)) === '0');

console.log(results.join('\n'));
await send('session.end').catch(() => {});
ws.close();
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${failed ? `${failed} check(s) failed` : 'All browser checks passed'}`);
process.exit(failed ? 1 : 0);
