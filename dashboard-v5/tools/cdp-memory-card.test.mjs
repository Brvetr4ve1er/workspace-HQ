// node --test dashboard-v5/tools/cdp-memory-card.test.mjs
// The Memory card cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that importing the file does nothing,
// that every in-page snippet is valid JavaScript, that the selectors are the template's own data attributes, that the words the scenarios expect are the
// invented answer's own (sized by the MAIN side's formatter, not the page's), that the pasted fake source is the real function, and that each scenario
// stops at a failed fresh(), reports a bad page and passes a healthy one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as mod from './cdp-memory-card.mjs';
import { inventedMemoryRead } from '../src/selftest-memory-card.mjs';
import tpl from '../src/tpl/memory-card.tpl.js';
import { humanBytes, humanAge, KINDS } from '../../dashboard/memory-card-core.mjs';

const { makeMemoryCardScenarios, MEMORY_SCENARIOS, PAGE, EXPECT, SNAPSHOT_EXPECT, FILL_EXPECT, KIND_ORDER, NO_FORGET, NO_TEXT, NO_NAMES, fakeMemorySource, FAKE_REGISTER_LINE } = mod;
const SRC = fs.readFileSync(new URL('./cdp-memory-card.mjs', import.meta.url), 'utf8');
const NAMES = ['memory-off-no-call', 'memory-render', 'memory-read-only', 'memory-no-bridge', 'memory-reduced-motion', 'memory-refresh'];

test('the factory returns exactly the six scenarios, each an async function of one argument', () => {
  const S = makeMemoryCardScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  assert.deepEqual([...MEMORY_SCENARIOS].sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) {
    assert.equal(fn.constructor.name, 'AsyncFunction', name);
    assert.equal(fn.length, 1, name);
  }
  assert.deepEqual(Object.keys(makeMemoryCardScenarios({ fresh: async () => null })).sort(), NAMES.slice().sort(), 'sleep is optional');
});

test('importing the file has no side effects: no socket, no timer, no process hook, nothing from cdp-gate', () => {
  for (const re of [/\bWebSocket\b/, /\bfetch\(/, /process\.(exit|on|argv|stdin)/, /createServer|\.listen\(/, /cdp-gate/, /\brequire\(/, /setInterval/, /from 'node:(net|http|child_process)/]) {
    assert.ok(!re.test(SRC.replace(/^\/\/.*$/gm, '')), 'source mentions ' + re);
  }
});

const SAMPLES = { big: ['scans'], small: ['cosmos'], aria: ['logs'], fillW: ['snapshot'], open: [true, false], setAnswer: [inventedMemoryRead({ fresher: true })] };
function everySnippet() {
  const out = [];
  for (const [k, v] of Object.entries(PAGE)) {
    if (typeof v === 'string') out.push([k, v]);
    else for (const args of (SAMPLES[k] ? (k === 'open' ? [[true], [false]] : [SAMPLES[k]]) : [[]])) out.push([k, v(...args)]);
  }
  return out;
}

test('every in-page snippet is valid JavaScript (and every builder is covered by a sample)', () => {
  const snippets = everySnippet();
  assert.ok(snippets.length >= 30);
  for (const [k, s] of snippets) assert.doesNotThrow(() => new vm.Script(s), k + ': ' + s.slice(0, 80));
  for (const [k, v] of Object.entries(PAGE)) if (typeof v === 'function') assert.ok(k in SAMPLES, k + ' needs a sample');
});

test('the selectors are the template’s own data attributes, and the only control the page snippets look for is Refresh', () => {
  for (const a of ['data-mcd="section"', 'data-mcd="slot"', 'data-mcd-kind="{{ b.kind }}"', 'data-mcd="big"', 'data-mcd="small"', 'data-mcd="fill"', 'data-mcd="twin"', 'data-mcd="summary"', 'data-mcd="note"', 'data-mcd="empty-slot"', 'data-mcd="codes-slot"', 'data-mcd="refresh"', 'aria-label="Memory card: what the app keeps on this PC"']) {
    assert.ok(tpl.includes(a), a);
  }
  assert.ok(PAGE.section.includes('section[data-mcd="section"]'));
  assert.ok(PAGE.dialog.includes('aria-label="Settings"'));
});

test('EXPECT is the invented answer in words, sized and aged by the MAIN side formatter: ten kinds in the engine order, a snapshot, hand-checked bars', () => {
  const a = inventedMemoryRead();
  assert.deepEqual(EXPECT.map((e) => e.kind), KINDS.map((k) => k.id));
  assert.deepEqual([...KIND_ORDER], [...KINDS.map((k) => k.id), 'snapshot']);
  const at = Date.parse(a.at);
  for (const e of EXPECT) {
    const s = a.slots.find((x) => x.kind === e.kind);
    assert.equal(e.size, humanBytes(s.bytes), e.kind + ' size');
    const files = s.files === 0 ? 'empty' : s.files + (s.files === 1 ? ' file' : ' files') + ' · ' + humanAge(s.newestMs, at);
    assert.equal(e.small, files, e.kind + ' small');
  }
  assert.deepEqual({ ...SNAPSHOT_EXPECT }, { big: humanAge(a.snapshot.newestMs, at), small: a.snapshot.kept + ' of ' + a.snapshot.max + ' kept' });
  const max = Math.max(...a.slots.map((s) => s.bytes));
  for (const [kind, w] of Object.entries(FILL_EXPECT)) assert.ok(Math.abs(a.slots.find((s) => s.kind === kind).bytes / max * 140 - w) < 0.05, kind + ' bar');
});

test('the word lists catch what they should: forget-like labels, unresolved bindings and file-name look-alikes', () => {
  for (const bad of ['Forget all', 'Delete', 'Clear history', 'Erase card', 'Export card', 'Reset']) assert.match(bad, NO_FORGET);
  for (const ok of ['Refresh', 'Refresh the memory card', 'Reading…']) assert.doesNotMatch(ok, NO_FORGET);
  for (const bad of ['undefined', '[object Object]', 'NaN GB']) assert.match(bad, NO_TEXT);
  for (const bad of ['latest.json', 'x.sqlite', 'run.log', 'a.kdbx']) assert.match(bad, NO_NAMES);
  assert.doesNotMatch('12 MB 34 files · 3 h ago Read-only: this only counts what the app keeps (by kind, never by name).', NO_NAMES);
});

test('the pasted fake: its source is the real function, runs alone, and answers what the selftest answers', () => {
  const src = fakeMemorySource();
  assert.ok(src.startsWith('const inventedMemoryRead = function inventedMemoryRead(opts)'));
  const fn = vm.runInNewContext('(() => {' + src + '; return inventedMemoryRead; })()', {});   // no outer names: a bare context is enough
  for (const o of [undefined, {}, { fresher: true }, { empty: true }, { partial: true }, { huge: true }, { noSnapshot: true }]) assert.deepEqual(JSON.parse(JSON.stringify(fn(o))), JSON.parse(JSON.stringify(inventedMemoryRead(o))));
  assert.equal(FAKE_REGISTER_LINE, `['memory.read', () => inventedMemoryRead()],`);
  assert.ok(!/\b(window|document|require|import|process|WHQ|hqFake)\b/.test(src), 'a plain script can run it');
  assert.ok(!src.includes('\n\n\n'));
});

test('fake-preload.js carries the pasted source and the registration (skipped LOUDLY until the integrator pastes them)', (t) => {
  const fp = fs.readFileSync(new URL('./fake-preload.js', import.meta.url), 'utf8');
  if (!fp.includes('inventedMemoryRead')) {
    const m = 'SKIPPED LOUDLY (cdp-memory-card): the memory fake is not in tools/fake-preload.js yet';
    process.stderr.write('\n' + m + '\n');
    return t.skip(m);
  }
  const norm = (s) => s.replace(/\s+/g, ' ');
  assert.ok(norm(fp).includes(norm(fakeMemorySource())), 'the pasted copy drifted from selftest-memory-card.mjs: re-paste fakeMemorySource()');
  assert.ok(fp.includes(FAKE_REGISTER_LINE));
});

// ---- a stub page --------------------------------------------------------------------------------------------------------------------
function stub(map, o = {}) {
  const evals = [], sent = [];
  const t = {
    evaluate: async (s) => {
      evals.push(s);
      if (!Object.prototype.hasOwnProperty.call(map, s)) return null;
      const v = map[s];
      return typeof v === 'function' ? v(s) : v;
    },
    waitFor: async (expr) => (o.waitFor ? o.waitFor(expr) : true),
    send: async (m, p) => { sent.push([m, p]); },
    errors: () => o.errors || [],
  };
  return { t, evals, sent };
}
const make = () => makeMemoryCardScenarios({ fresh: async () => null, sleep: async () => {} });
const key = (s) => s;

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const { t, evals, sent } = stub({});
  const S = makeMemoryCardScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length + sent.length, 0);
});

test('a Settings that never shows the card is reported, and the page is reset every time', async () => {
  for (const name of NAMES) {
    const { t, evals } = stub({}, { waitFor: async () => false });
    const out = await make()[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(evals.includes(PAGE.reset), name + ' puts the layer, motion, bridge and fake back');
  }
});

const calls = (n) => ({ [PAGE.calls]: n });
test('off-no-call: a healthy page reports nothing; a section with the layer off, or a read, is reported', async () => {
  const healthy = { [`!!${PAGE.dialog}`]: true, [`!!${PAGE.section}`]: false, [PAGE.dialogText]: 'Settings Appearance Theme', ...calls(0) };
  assert.deepEqual(await make()['memory-off-no-call'](stub(healthy).t), []);
  const bad = await make()['memory-off-no-call'](stub({ ...healthy, [`!!${PAGE.section}`]: true, ...calls(3) }).t);
  assert.ok(bad.some((m) => /exists while the Console layer is off/.test(m)));
  assert.ok(bad.some((m) => /called 3 time/.test(m)));
  const first = stub(healthy);
  await make()['memory-off-no-call'](first.t);
  assert.ok(first.evals.includes(PAGE.open(false)) && first.evals.includes(PAGE.layerOnClosed), 'both ways of not reading are driven');
});

test('read-only: one Refresh button passes; a forget-like control, a second control or another call is reported', async () => {
  const healthy = { [PAGE.buttons]: ['Refresh the memory card'], [PAGE.refreshText]: 'Refresh', [PAGE.memoryCalls]: ['memory.read'] };
  assert.deepEqual(await make()['memory-read-only'](stub(healthy).t), []);
  const bad = await make()['memory-read-only'](stub({ ...healthy, [PAGE.buttons]: ['Refresh the memory card', 'Forget everything'], [PAGE.memoryCalls]: ['memory.read', 'memory.forget'] }).t);
  assert.ok(bad.some((m) => /want exactly one/.test(m)));
  assert.ok(bad.some((m) => /Forget everything/.test(m)));
  assert.ok(bad.some((m) => /other than memory\.read/.test(m)));
  const odd = await make()['memory-read-only'](stub({ ...healthy, [PAGE.refreshText]: 'Wipe' }).t);
  assert.ok(odd.some((m) => /not Refresh/.test(m)));
});

test('no-bridge: only the one sentence passes; extra words, a control, or a recorded read are reported', async () => {
  const healthy = { [`!!${PAGE.section}`]: true, [PAGE.text]: 'The memory card needs the desktop app', [PAGE.buttons]: [], ...calls(0) };
  assert.deepEqual(await make()['memory-no-bridge'](stub(healthy).t), []);
  const bad = await make()['memory-no-bridge'](stub({ ...healthy, [PAGE.text]: 'The memory card needs the desktop app Refresh', [PAGE.buttons]: ['Refresh'], ...calls(1) }).t);
  assert.equal(bad.filter((m) => /without (the|a) bridge|a read was recorded/.test(m)).length, 3);
  const s = stub(healthy);
  await make()['memory-no-bridge'](s.t);
  assert.ok(s.evals.includes(PAGE.noBridge) && s.evals.indexOf(PAGE.noBridge) < s.evals.indexOf(PAGE.open(true)), 'the bridge goes before Settings opens');
});

test('reduced-motion: emulates the media query, restores it, and reports an animating element, a running animation or a media query that did not apply', async () => {
  const ready = { [`${PAGE.slots}.length === 11`]: true };
  const ok = { elements: 50, bad: [], running: 0, media: true };
  const a = stub({ [PAGE.motion]: ok });
  assert.deepEqual(await make()['memory-reduced-motion'](a.t), []);
  assert.deepEqual(a.sent[0], ['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }]);
  assert.deepEqual(a.sent[a.sent.length - 1], ['Emulation.setEmulatedMedia', { features: [] }], 'the media emulation is cleared');
  const b = await make()['memory-reduced-motion'](stub({ ...ready, [PAGE.motion]: { elements: 50, bad: ['svg', 'button'], running: 2, media: false } }).t);
  assert.equal(b.length, 3);
  assert.ok(b.some((m) => /svg, button/.test(m)) && b.some((m) => /2 animation/.test(m)) && b.some((m) => /did not apply/.test(m)));
});

test('refresh: a healthy page passes (one arrival read, one more after the click); a stuck age or a double read is reported', async () => {
  let clicked = false;
  const mk = (over) => {
    clicked = false;
    return {
      [PAGE.small('scans')]: '34 files · 3 h ago',
      [PAGE.calls]: () => (clicked ? 2 : 1),
      [`${PAGE.refresh}.click()`]: () => { clicked = true; return true; },
      ...(over || {}),
    };
  };
  assert.deepEqual(await make()['memory-refresh'](stub(mk()).t), []);
  clicked = false;
  const twice = await make()['memory-refresh'](stub(mk({ [`${PAGE.refresh}.click()`]: () => { clicked = true; return true; }, [PAGE.calls]: () => (clicked ? 3 : 1) })).t);
  assert.ok(twice.some((m) => /want 2/.test(m)));
  const stuck = await make()['memory-refresh'](stub(mk(), { waitFor: async (e) => !/1 min ago/.test(e) }).t);
  assert.ok(stuck.some((m) => /did not update the age/.test(m)));
});

test('render: a healthy page passes; a wrong size, a missing bar scale, a name look-alike and a double read are each reported', async () => {
  let reopened = false;
  const healthy = () => {
    reopened = false;
    const m = {
      [PAGE.kinds]: [...KIND_ORDER],
      [PAGE.big('snapshot')]: SNAPSHOT_EXPECT.big, [PAGE.small('snapshot')]: SNAPSHOT_EXPECT.small,
      [PAGE.fillW('snapshot')]: null,
      [PAGE.twinCount]: 11,
      [PAGE.note]: 'Read-only: this only counts what the app keeps (by kind, never by name). Nothing here can erase or export anything.',
      [PAGE.summary]: '10 kinds · read 12:00',
      [PAGE.emptySlot]: 'Empty slot', [PAGE.codesSlot]: '0|',
      [PAGE.text]: 'Memory card · what the app keeps on this PC Scans and history 12 MB 34 files · 3 h ago',
      [PAGE.calls]: () => (reopened ? 2 : 1),
      [PAGE.reopen]: () => { reopened = true; return true; },
    };
    for (const e of EXPECT) { m[PAGE.big(e.kind)] = e.size; m[PAGE.small(e.kind)] = e.small; m[PAGE.aria(e.kind)] = 'img|' + e.kind + ': a sentence'; }
    const max = 5100000000;
    for (const [kind, w] of Object.entries(FILL_EXPECT)) m[PAGE.fillW(kind)] = w;
    void max;
    return m;
  };
  assert.deepEqual(await make()['memory-render'](stub(healthy()).t), []);
  const bad = healthy();
  bad[PAGE.big('cosmos')] = '4.8 GB';
  bad[PAGE.fillW('cosmos')] = 70;
  bad[PAGE.text] = 'Scans and history latest.json 12 MB';
  bad[PAGE.codesSlot] = null;
  const out = await make()['memory-render'](stub(bad).t);
  assert.ok(out.some((m) => /cosmos size reads "4\.8 GB"/.test(m)));
  assert.ok(out.some((m) => /cosmos bar is 70/.test(m)));
  assert.ok(out.some((m) => /file name/.test(m)));
  assert.ok(out.some((m) => /codes slot hook/.test(m)));
  const dbl = healthy();
  dbl[PAGE.calls] = () => 2;
  assert.ok((await make()['memory-render'](stub(dbl).t)).some((m) => /exactly 1/.test(m)));
});

test('the page errors the harness collected are appended to every scenario’s report', async () => {
  const healthy = { [`!!${PAGE.dialog}`]: true, [`!!${PAGE.section}`]: false, [PAGE.dialogText]: 'Settings', ...calls(0) };
  const out = await make()['memory-off-no-call'](stub(healthy, { errors: ['console.error: boom'] }).t);
  assert.deepEqual(out, ['console.error: boom']);
  void key;
});
