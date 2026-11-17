// node --test tools/gates.test.mjs
// tools/gates-core.mjs against a FAKE io: no electron, no child process, no clock. Placeholder names only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SWEEP_SCENARIOS, buildCatalog, parseArgs, selectSteps, parseNodeTest, parseSelftest, parseCdpGate, failingLines,
  runStep, runGates, formatTable, budgetWarning, findingClass, compareSweeps, formatSweepLine, findingsFromCdp, runSweepCompare,
} from './gates-core.mjs';
import { main } from './gates.mjs';

// ---- fake outputs -------------------------------------------------------------------------------------------------------
const tap = (pass, fail = 0, skipped = 0, extra = '') => `TAP version 13\n${extra}1..${pass + fail}\n# tests ${pass + fail + skipped}\n# suites 0\n# pass ${pass}\n# fail ${fail}\n# cancelled 0\n# skipped ${skipped}\n# todo 0\n# duration_ms 12.5\n`;
const selftestOut = (o = {}) => `noise\n[selftest:detail] {"ms":9}\n[selftest] ${JSON.stringify({ combos: 3349, errors: 0, unresolved: 0, failures: 0, ...o })}\n[selftest] PASS\n`;
const cdpOut = (names, failing = {}, settle = '') => names.map((n) => (failing[n] ? `FAIL ${n} (1200 ms)\n  ${failing[n].join('\n  ')}` : `PASS ${n} (900 ms)`)).join('\n') + `\n${settle}[cdp-gate] ${names.length - Object.keys(failing).length}/${names.length} passed\n`;
const GLOB_TO_ID = { 'dashboard/*.test.mjs': 'main', 'dashboard/claude-hub/*.test.mjs': 'hub', 'dashboard/money/*.test.mjs': 'money', 'dashboard/cosmos/*.test.mjs': 'cosmos', 'dashboard-v5/src/*.test.mjs': 'renderer', 'tools/*.test.mjs': 'tools', 'browser-bridge/*.test.mjs': 'bridge' };

// a fake io that records everything and refuses any call outside the contract
function fakeIo(over = {}) {
  const rec = { runs: [], starts: [], stops: [], profiles: [], cleaned: [], ports: [], log: [], active: 0, maxActive: 0, order: [] };
  let clock = 0, portSeq = 9300, profSeq = 0;
  const script = over.script || ((spec) => {
    if (spec.cmd === 'node' && spec.args[0] === '--test') return { code: 0, out: tap(10) };
    if (spec.cmd === 'electron' && spec.args.includes('--selftest')) return { code: 0, out: selftestOut() };
    if (spec.cmd === 'node' && spec.args[0] === 'tools/cdp-gate.mjs') return { code: 0, out: cdpOut(['boot', 'button-sweep']) };
    if (spec.cmd === 'electron') return { code: 0, out: 'checks passed\n' };
    throw new Error('unscripted spec ' + JSON.stringify(spec));
  });
  const base = {
    now: () => clock,
    log: (l) => rec.log.push(l),
    async run(spec, { timeoutMs }) {
      rec.active++; rec.maxActive = Math.max(rec.maxActive, rec.active); rec.order.push(spec); rec.runs.push({ spec, timeoutMs });
      try {
        await new Promise((r) => setImmediate(r));
        clock += 1500;
        const r = await script(spec, rec);
        return { code: 0, out: '', timedOut: false, ms: 1500, ...r };
      } finally { rec.active--; }
    },
    async start(spec) {
      const child = { pid: 4000 + rec.starts.length, stop: async () => { rec.stops.push(child.pid); }, output: () => over.childOutput || '' };
      rec.starts.push({ spec, pid: child.pid });
      return child;
    },
    async freePort() { const p = ++portSeq; rec.ports.push(p); return p; },
    uniqueProfile(tag) { const n = 'hq-gates-' + tag + '-' + (++profSeq); rec.profiles.push(n); return n; },
    async cleanupProfile(name) { rec.cleaned.push(name); },
    async gateDataFile(profile) { return '/fake-tmp/' + profile + '/gate-data.js'; },
    async countFiles(pattern) { return over.files === undefined ? 3 : (typeof over.files === 'function' ? over.files(pattern) : over.files); },
  };
  // anything outside the contract (a kill-by-name, a process listing, ...) throws instead of being silently accepted
  const io = new Proxy(base, { get(target, prop) { if (prop in target) return target[prop]; if (prop === 'then') return undefined; throw new Error('io.' + String(prop) + ' is not part of the contract'); } });
  return { io, rec };
}

const stepOf = (spec) => (spec.cmd === 'node' && spec.args[0] === '--test') ? GLOB_TO_ID[spec.args[2]] : spec.cmd;

// ---- arguments and selection ----------------------------------------------------------------------------------------------
test('parseArgs: defaults, both flag forms, and every error is an error value', () => {
  assert.deepEqual(parseArgs([]).opts, { only: null, skip: [], native: false, bail: false, budget: null, settle: false, sweepCompare: false, list: false, help: false, scenario: 'all' });
  const o = parseArgs(['--only', 'main,tools', '--skip=hub', '--native', '--bail', '--budget', '360', '--settle', '--scenario=boot,brief-render']).opts;
  assert.deepEqual(o.only, ['main', 'tools']);
  assert.deepEqual(o.skip, ['hub']);
  assert.equal(o.native && o.bail && o.settle, true);
  assert.equal(o.budget, 360);
  assert.equal(o.scenario, 'boot,brief-render');
  assert.equal(parseArgs(['--sweep-compare']).opts.sweepCompare, true);
  for (const bad of [['--nope'], ['loose'], ['--only'], ['--only', '--bail'], ['--budget', '0'], ['--budget', 'abc'], ['--native=1'], ['--skip', ',']]) {
    assert.ok(parseArgs(bad).error, JSON.stringify(bad));
  }
  assert.ok(parseArgs(null).opts, 'no argv is fine');
});

test('the catalog follows README order and keeps electron and native steps apart', () => {
  const c = buildCatalog();
  assert.deepEqual(c.map((s) => s.id), ['main', 'hub', 'money', 'cosmos', 'renderer', 'tools', 'selftest', 'cdp', 'bridge', 'cosmos-native', 'delivery-native']);
  assert.deepEqual(c.filter((s) => s.native).map((s) => s.id), ['bridge', 'cosmos-native', 'delivery-native']);
  const main = c.find((s) => s.id === 'main');
  assert.deepEqual(main.args, ['--test', '--test-reporter=tap', 'dashboard/*.test.mjs']);
  assert.deepEqual(c.find((s) => s.id === 'tools').args.slice(2), ['tools/*.test.mjs', 'tools/trailer/*.test.mjs', 'mcp/workspacehq/*.test.mjs']);
  assert.equal(c.find((s) => s.id === 'renderer').args.length, 2 + 8);
  assert.deepEqual(c.find((s) => s.id === 'selftest').args, ['dev-main.js', '--preload=fake', '--hidden', '--selftest']);
  assert.equal(c.find((s) => s.id === 'selftest').cwd, 'dashboard-v5');
  for (const s of c) assert.ok(s.timeoutMs > 0, s.id + ' has its own timeout');
});

test('selectSteps: default is the non-native steps; --native adds; --only/--skip pick; unknown ids refuse', () => {
  const c = buildCatalog();
  assert.deepEqual(selectSteps(c, parseArgs([]).opts).steps.map((s) => s.id), ['main', 'hub', 'money', 'cosmos', 'renderer', 'tools', 'selftest', 'cdp']);
  assert.equal(selectSteps(c, parseArgs(['--native']).opts).steps.length, 11);
  assert.deepEqual(selectSteps(c, parseArgs(['--only', 'tools,main']).opts).steps.map((s) => s.id), ['main', 'tools'], 'catalog order, not the order typed');
  assert.deepEqual(selectSteps(c, parseArgs(['--skip', 'cdp,selftest']).opts).steps.map((s) => s.id), ['main', 'hub', 'money', 'cosmos', 'renderer', 'tools']);
  assert.deepEqual(selectSteps(c, parseArgs(['--only', 'cosmos-native']).opts).steps.map((s) => s.id), ['cosmos-native']);
  assert.match(selectSteps(c, parseArgs(['--only', 'main,zzz']).opts).error, /unknown step id: zzz/);
});

// ---- parsers --------------------------------------------------------------------------------------------------------------
test('parseNodeTest reads TAP and spec-reporter summaries, and says when there is none', () => {
  assert.deepEqual({ ...parseNodeTest(tap(2505, 0, 1)) }, { found: true, tests: 2506, pass: 2505, fail: 0, skipped: 1, cancelled: 0, todo: 0, durationMs: 12.5 });
  const spec = 'ℹ tests 12\nℹ suites 3\nℹ pass 10\nℹ fail 2\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 99.9\n';
  const p = parseNodeTest(spec);
  assert.equal(p.pass, 10); assert.equal(p.fail, 2); assert.equal(p.found, true);
  assert.equal(parseNodeTest('no summary here').found, false);
  assert.equal(parseNodeTest(undefined).found, false);
});

test('parseSelftest reads the JSON summary line and the combos=N errors=0 form', () => {
  assert.deepEqual({ ...parseSelftest(selftestOut()) }, { found: true, combos: 3349, errors: 0, unresolved: 0, failures: 0 });
  assert.equal(parseSelftest('combos=77 errors=0').combos, 77);
  assert.equal(parseSelftest('[selftest] {broken').found, false);
  assert.equal(parseSelftest('').found, false);
});

test('parseCdpGate attaches only the indented lines that follow a FAIL line, and reads N/M passed and the settle line', () => {
  const text = '[cdp-gate] file:///x/index.html\nPASS boot (1000 ms)\n[button-sweep] 40 buttons clicked\n  dead      home  Some button\nFAIL button-sweep (5000 ms)\n  dead      home  Some button\n  error     tab/sub  Another\nPASS next (5 ms)\n[settle] waits=12 cap-hits=1 quiet=100ms cap=800ms\n[cdp-gate] 2/3 passed\n';
  const p = parseCdpGate(text);
  assert.equal(p.passed, 2); assert.equal(p.total, 3);
  assert.deepEqual(p.scenarios.map((s) => [s.name, s.ok]), [['boot', true], ['button-sweep', false], ['next', true]]);
  assert.deepEqual(p.scenarios[1].lines, ['dead      home  Some button', 'error     tab/sub  Another']);
  assert.deepEqual(p.scenarios[0].lines, []);
  assert.deepEqual({ ...p.settle }, { waits: 12, capHits: 1, quietMs: 100, capMs: 800 });
  assert.equal(parseCdpGate('nothing').found, false);
});

test('failingLines: node --test shows the not ok line and its error lines, cdp shows FAIL blocks, and a tail is the fallback', () => {
  const out = tap(3, 1, 0, 'ok 1 - fine\nnot ok 2 - the thing breaks\n  ---\n  error: \'boom\'\n  expected: 1\n  actual: 2\n  stack: |-\n    at x\n  ...\n');
  const l = failingLines('node-test', out);
  assert.equal(l[0], 'not ok 2 - the thing breaks');
  assert.ok(l.includes("error: 'boom'") && l.includes('expected: 1'));
  assert.deepEqual(failingLines('cdp', cdpOut(['a', 'b'], { b: ['one', 'two'] })), ['FAIL b', '  one', '  two']);
  assert.deepEqual(failingLines('node-test', 'line a\nline b\n'), ['line a', 'line b']);
  assert.ok(failingLines('node-test', 'x'.repeat(500))[0].length <= 200);
  assert.equal(failingLines('node-test', out, 1).length, 1);
});

// ---- running steps ---------------------------------------------------------------------------------------------------------
test('every step runs in order and one at a time, and a clean run exits 0 with one table', async () => {
  const { io, rec } = fakeIo();
  const res = await runGates({ catalog: buildCatalog(), opts: parseArgs([]).opts, io });
  assert.equal(res.exitCode, 0);
  assert.equal(rec.maxActive, 1, 'never two steps at once');
  assert.deepEqual(res.results.map((r) => r.id), ['main', 'hub', 'money', 'cosmos', 'renderer', 'tools', 'selftest', 'cdp']);
  assert.ok(res.results.every((r) => r.result === 'PASS'));
  assert.deepEqual(rec.order.map(stepOf).slice(0, 6), ['main', 'hub', 'money', 'cosmos', 'renderer', 'tools']);
  const lines = res.text.split('\n');
  assert.match(lines[0], /^step\s+result\s+counts\s+seconds$/);
  assert.equal(lines.filter((l) => /^total/.test(l)).length, 1);
  assert.match(res.text, /main\s+PASS\s+10 pass 0 fail/);
  assert.match(res.text, /selftest\s+PASS\s+combos=3349 0\/0\/0/);
  assert.match(res.text, /cdp\s+PASS\s+2\/2 passed/);
  assert.equal(res.totalSeconds, 1.5 * rec.runs.length);
  for (const r of rec.runs) assert.ok(r.timeoutMs > 0);
});

test('a failing step gives exit 1 and its first failing lines in the table, and later steps still run', async () => {
  const { io, rec } = fakeIo({ script: (spec) => (stepOf(spec) === 'hub' ? { code: 1, out: tap(5, 1, 0, 'not ok 3 - hub thing\n  ---\n  error: \'bad\'\n  ...\n') } : (spec.cmd === 'node' && spec.args[0] === '--test') ? { code: 0, out: tap(4) } : spec.cmd === 'node' ? { code: 0, out: cdpOut(['boot']) } : { code: 0, out: selftestOut() }) });
  const res = await runGates({ catalog: buildCatalog(), opts: parseArgs([]).opts, io });
  assert.equal(res.exitCode, 1);
  assert.equal(res.results.find((r) => r.id === 'hub').result, 'FAIL');
  assert.deepEqual(res.results.slice(2).map((r) => r.result), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS'], 'the rest still ran');
  assert.match(res.text, /-- hub \(FAIL\), first failing lines:\n {3}not ok 3 - hub thing\n {3}error: 'bad'/);
  assert.equal(rec.runs.length, 8, 'six node test runs, the selftest and the cdp gate run');
});

test('--bail stops after the first failed step and marks the rest NOT RUN (still exit 1)', async () => {
  const { io, rec } = fakeIo({ script: (spec) => (stepOf(spec) === 'money' ? { code: 1, out: tap(0, 2) } : { code: 0, out: tap(1) }) });
  const res = await runGates({ catalog: buildCatalog(), opts: parseArgs(['--bail', '--only', 'main,hub,money,cosmos,tools']).opts, io });
  assert.equal(res.exitCode, 1);
  assert.deepEqual(res.results.map((r) => r.result), ['PASS', 'PASS', 'FAIL', 'NOT RUN', 'NOT RUN']);
  assert.equal(rec.runs.length, 3);
});

test('--only and --skip select which steps run; an unknown id is exit 2 and nothing runs', async () => {
  const a = fakeIo();
  const r1 = await runGates({ catalog: buildCatalog(), opts: parseArgs(['--only', 'tools,main']).opts, io: a.io });
  assert.deepEqual(r1.results.map((r) => r.id), ['main', 'tools']);
  assert.equal(a.rec.runs.length, 2);
  const b = fakeIo();
  const r2 = await runGates({ catalog: buildCatalog(), opts: parseArgs(['--skip', 'selftest,cdp,renderer']).opts, io: b.io });
  assert.equal(r2.results.length, 5);
  assert.equal(b.rec.starts.length, 0, 'no electron when the cdp step is skipped');
  const c = fakeIo();
  const r3 = await runGates({ catalog: buildCatalog(), opts: parseArgs(['--only', 'nope']).opts, io: c.io });
  assert.equal(r3.exitCode, 2);
  assert.equal(c.rec.runs.length, 0);
});

test('the cdp step starts one electron with its own profile and a free port, points cdp-gate at it, and stops it', async () => {
  const { io, rec } = fakeIo();
  const res = await runGates({ catalog: buildCatalog(), opts: parseArgs(['--only', 'selftest,cdp']).opts, io });
  assert.equal(res.exitCode, 0);
  assert.equal(rec.starts.length, 1, 'one electron child, only for cdp');
  const st = rec.starts[0];
  assert.equal(st.spec.cmd, 'electron');
  assert.equal(st.spec.cwd, 'dashboard-v5');
  const port = rec.ports[0];
  assert.deepEqual(st.spec.args, ['dev-main.js', '--preload=fake', '--hidden', '--remote-debugging-port=' + port]);
  assert.match(st.spec.env.HQ_V5_PROFILE, /^hq-gates-cdp-\d+$/);
  const gate = rec.runs.find((r) => r.spec.args[0] === 'tools/cdp-gate.mjs').spec;
  assert.equal(gate.args[gate.args.indexOf('--port') + 1], String(port));
  assert.equal(gate.args[gate.args.indexOf('--scenario') + 1], 'all');
  assert.ok(!gate.args.includes('--settle'), 'old sweep by default');
  assert.deepEqual(rec.stops, [st.pid], 'the child it started, and nothing else, was stopped');
  const self = rec.runs.find((r) => r.spec.args.includes('--selftest')).spec;
  assert.match(self.env.HQ_V5_PROFILE, /^hq-gates-selftest-\d+$/);
  assert.notEqual(self.env.HQ_V5_PROFILE, st.spec.env.HQ_V5_PROFILE, 'each electron step has its own profile');
  assert.deepEqual(rec.cleaned.sort(), rec.profiles.slice().sort(), 'every throwaway profile is cleaned');
});

test('--settle and --scenario reach cdp-gate', async () => {
  const { io, rec } = fakeIo();
  await runGates({ catalog: buildCatalog(), opts: parseArgs(['--only', 'cdp', '--settle', '--scenario', 'boot,brief-render']).opts, io });
  const gate = rec.runs.find((r) => r.spec.args[0] === 'tools/cdp-gate.mjs').spec;
  assert.ok(gate.args.includes('--settle'));
  assert.equal(gate.args[gate.args.indexOf('--scenario') + 1], 'boot,brief-render');
});

test('the electron child is stopped and the profile cleaned after a failing gate, a timeout, and a throw', async () => {
  const cases = [
    { name: 'failure', script: () => ({ code: 1, out: cdpOut(['boot', 'x'], { x: ['bad thing'] }) }), result: 'FAIL', want: /FAIL x/ },
    { name: 'timeout', script: () => ({ code: null, out: '[cdp-gate] file:///x\nPASS boot (9 ms)\n', timedOut: true }), result: 'TIMEOUT', want: /timed out after/ },
    { name: 'throw', script: () => { throw new Error('spawn failed'); }, result: 'FAIL', want: /threw: spawn failed/ },
    { name: 'no summary (electron died)', script: () => ({ code: 2, out: '[cdp-gate] no target on port 1' }), result: 'FAIL', want: /exit 2/, childOutput: 'electron crashed at start' },
  ];
  for (const c of cases) {
    const { io, rec } = fakeIo({ script: c.script, childOutput: c.childOutput });
    const r = await runStep(buildCatalog().find((s) => s.id === 'cdp'), io, {});
    assert.equal(r.result, c.result, c.name);
    assert.match(r.failLines.join('\n'), c.want, c.name);
    assert.equal(rec.starts.length, 1, c.name);
    assert.deepEqual(rec.stops, [rec.starts[0].pid], c.name + ': the electron it started is stopped');
    assert.deepEqual(rec.cleaned, rec.profiles, c.name + ': profile cleaned');
    if (c.childOutput) assert.match(r.failLines.join('\n'), /electron crashed/, 'the child output is shown when cdp-gate could not connect');
  }
  // the electron fails to start at all: nothing to stop, still a row, not a crash
  const { io } = fakeIo();
  const broken = new Proxy(io, { get: (t, p) => (p === 'start' ? async () => { throw new Error('electron not found'); } : t[p]) });
  const r = await runStep(buildCatalog().find((s) => s.id === 'cdp'), broken, {});
  assert.equal(r.result, 'FAIL');
  assert.match(r.failLines[0], /electron not found/);
});

test('no step ever targets a process it did not start: the io has no kill-by-name or process-list call, and the sources use none', async () => {
  const { io, rec } = fakeIo();
  await runGates({ catalog: buildCatalog(), opts: parseArgs(['--native']).opts, io });   // the Proxy throws on any call outside the contract
  assert.equal(rec.starts.length, 1);
  assert.deepEqual(rec.stops, [rec.starts[0].pid]);
  for (const f of ['./gates-core.mjs', './gates.mjs']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const bad of [/\/IM\b/i, /Stop-Process/i, /Get-Process/i, /\bpkill\b/, /\bkillall\b/, /\bwmic\b/i, /\btasklist\b/i, /user-data-dir/]) {
      const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      assert.ok(!bad.test(code), f + ' mentions ' + bad);
    }
  }
  const real = fs.readFileSync(new URL('./gates.mjs', import.meta.url), 'utf8');
  const tk = [...real.matchAll(/'taskkill', \[([^\]]*)\]/g)];
  assert.equal(tk.length, 1);
  assert.match(tk[0][1], /'\/PID', String\(child\.pid\)/);
});

test('an unclean selftest, a missing summary and a timeout are each a failing row', async () => {
  const sel = (over) => runStep(buildCatalog().find((s) => s.id === 'selftest'), fakeIo({ script: () => over }).io, {});
  const bad = await sel({ code: 1, out: selftestOut({ errors: 2 }) + '[selftest] 2 error-level console message(s):\n[selftest] FAIL\n' });
  assert.equal(bad.result, 'FAIL'); assert.match(bad.counts, /combos=3349 2\/0\/0/);
  assert.ok(bad.failLines.some((l) => /error-level/.test(l)));
  const none = await sel({ code: 1, out: 'nothing useful\n' });
  assert.equal(none.result, 'FAIL'); assert.equal(none.counts, 'no summary');
  const slow = await sel({ code: null, out: '', timedOut: true });
  assert.equal(slow.result, 'TIMEOUT');
  const exitBad = await sel({ code: 1, out: selftestOut() });
  assert.equal(exitBad.result, 'FAIL', 'a clean summary with a non-zero exit is not a pass');
});

test('node --test steps: exit code, a missing summary and a timeout are each reported honestly', async () => {
  const step = buildCatalog().find((s) => s.id === 'main');
  const run = (r) => runStep(step, fakeIo({ script: () => r }).io, {});
  assert.equal((await run({ code: 0, out: tap(5) })).result, 'PASS');
  assert.equal((await run({ code: 1, out: tap(5, 1) })).result, 'FAIL');
  assert.equal((await run({ code: 0, out: tap(5, 1) })).result, 'FAIL', 'a failing count fails even with exit 0');
  assert.equal((await run({ code: 0, out: 'no tap at all' })).result, 'FAIL');
  assert.equal((await run({ code: 0, out: tap(0) })).result, 'FAIL', 'zero tests is not a pass');
  assert.equal((await run({ code: null, out: '', timedOut: true })).result, 'TIMEOUT');
  const skip = await run({ code: 0, out: tap(5, 0, 2) });
  assert.match(skip.counts, /5 pass 0 fail 2 skip/);
});

test('--native adds the bridge tests and two electron checks; no test files is SKIP, not a failure; each check gets its own profile var', async () => {
  const { io, rec } = fakeIo({ files: 0 });
  const res = await runGates({ catalog: buildCatalog(), opts: parseArgs(['--native', '--only', 'bridge,cosmos-native,delivery-native']).opts, io });
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.results.map((r) => r.result), ['SKIP', 'PASS', 'PASS']);
  assert.equal(rec.runs.length, 2, 'the bridge step ran nothing');
  const [c1, c2] = rec.runs.map((r) => r.spec);
  assert.match(c1.env.HQ_COSMOS_CHECK_PROFILE, /^hq-gates-cosmos-native-/);
  assert.match(c2.env.HQ_DCK_CHECK_PROFILE, /^hq-gates-delivery-native-/);
  assert.deepEqual(c1.args, ['dashboard/cosmos-native.check.js']);
  const failing = fakeIo({ script: () => ({ code: 1, out: 'a\nb\ncheck 3 failed\n' }) });
  const r = await runStep(buildCatalog().find((s) => s.id === 'delivery-native'), failing.io, {});
  assert.equal(r.result, 'FAIL'); assert.equal(r.counts, 'exit 1'); assert.ok(r.failLines.includes('check 3 failed'));
});

test('--budget warns when the total is over and still exits 0; no warning under budget or without one', async () => {
  const a = fakeIo();
  const over = await runGates({ catalog: buildCatalog(), opts: parseArgs(['--only', 'main,hub,money', '--budget', '3']).opts, io: a.io });
  assert.equal(over.exitCode, 0);
  assert.match(over.text, /^BUDGET: the run took 4\.5 s, over the 3 s budget \(a warning only/m);
  const b = fakeIo();
  const under = await runGates({ catalog: buildCatalog(), opts: parseArgs(['--only', 'main', '--budget', '360']).opts, io: b.io });
  assert.ok(!/BUDGET/.test(under.text));
  assert.equal(budgetWarning(10, null), '');
  assert.equal(budgetWarning(10, 10), '');
  assert.ok(budgetWarning(10.1, 10));
});

test('formatTable lines up, shows - for a step that did not run, and lists first failing lines only for failed steps', () => {
  const rows = [
    { id: 'main', result: 'PASS', counts: '10 pass 0 fail', seconds: 12.34, failLines: [] },
    { id: 'tools', result: 'FAIL', counts: '3 pass 1 fail', seconds: 5, failLines: ['not ok 1 - x'] },
    { id: 'cdp', result: 'NOT RUN', counts: 'after --bail', seconds: undefined, failLines: [] },
  ];
  const t = formatTable(rows, 17.3, '');
  assert.match(t, /main\s+PASS\s+10 pass 0 fail\s+12\.3/);
  assert.match(t, /cdp\s+NOT RUN\s+after --bail\s+-$/m);
  assert.match(t, /total\s+17\.3$/m);
  assert.match(t, /-- tools \(FAIL\), first failing lines:\n {3}not ok 1 - x/);
  assert.ok(!/-- main/.test(t));
});

// ---- --sweep-compare ---------------------------------------------------------------------------------------------------------
test('findingClass and compareSweeps compare full finding sets, not counts', () => {
  assert.equal(findingClass('dead      home  Save'), 'dead');
  assert.equal(findingClass('error     x  y'), 'error');
  assert.equal(findingClass('not-wired  x'), 'not-wired');
  assert.equal(findingClass('threw: scenario x timed out after 90 ms'), 'threw');
  assert.equal(findingClass('button #2 vanished'), 'other');
  const old = { 'button-sweep': ['dead home A', 'error home B'], 'money-button-sweep': [] };
  const same = compareSweeps(old, { 'money-button-sweep': [], 'button-sweep': ['error home B', 'dead home A'] });
  assert.equal(same.same, true); assert.equal(same.oldN, 2); assert.equal(same.settledN, 2); assert.equal(same.fewerClasses, false);
  assert.equal(formatSweepLine(same), 'SWEEP old=2 settled=2 same=true');
  // equal counts, different content: not the same
  const swapped = compareSweeps(old, { 'button-sweep': ['dead home A', 'dead home C'] });
  assert.equal(swapped.same, false);
  assert.deepEqual(swapped.onlyOld, ['button-sweep :: error home B']);
  assert.deepEqual(swapped.onlySettled, ['button-sweep :: dead home C']);
  assert.equal(swapped.oldN, swapped.settledN);
  assert.equal(formatSweepLine(swapped), 'SWEEP old=2 settled=2 same=false');
  // the same line under another scenario is a different finding
  assert.equal(compareSweeps({ a: ['dead x'] }, { b: ['dead x'] }).same, false);
  // the settled sweep loses a whole class: fewer classes
  const lost = compareSweeps(old, { 'button-sweep': ['dead home A'] });
  assert.equal(lost.fewerClasses, true);
  assert.deepEqual(lost.missingClasses, ['error']);
  assert.equal(compareSweeps({}, {}).same, true);
  assert.equal(compareSweeps(undefined, undefined).oldN, 0);
});

const SWEEP_OK = (settle) => cdpOut(SWEEP_SCENARIOS, {}, settle);
const SWEEP_ONE_DEAD = (settle) => cdpOut(SWEEP_SCENARIOS, { 'button-sweep': ['dead      home  Some button'] }, settle);

test('runSweepCompare runs old then settled, each with its own electron, profile and port, and prints SWEEP old= settled= same=', async () => {
  let n = 0;
  const { io, rec } = fakeIo({ script: (spec) => (spec.cmd === 'node' ? { code: 0, out: (++n === 1 ? SWEEP_OK('') : SWEEP_OK('[settle] waits=500 cap-hits=2 quiet=100ms cap=800ms\n')) } : { code: 0, out: '' }) });
  const res = await runSweepCompare({ io, opts: {} });
  assert.equal(res.exitCode, 0);
  assert.match(res.text, /^SWEEP old=0 settled=0 same=true$/m);
  assert.match(res.text, /settled waits=500 cap-hits=2/);
  assert.equal(rec.starts.length, 2);
  assert.notEqual(rec.starts[0].spec.env.HQ_V5_PROFILE, rec.starts[1].spec.env.HQ_V5_PROFILE);
  assert.notEqual(rec.ports[0], rec.ports[1]);
  assert.deepEqual(rec.stops.sort(), rec.starts.map((s) => s.pid).sort());
  const gates = rec.runs.map((r) => r.spec).filter((s) => s.cmd === 'node');
  assert.ok(!gates[0].args.includes('--settle'));
  assert.ok(gates[1].args.includes('--settle'));
  for (const g of gates) assert.equal(g.args[g.args.indexOf('--scenario') + 1], SWEEP_SCENARIOS.join(','));
  assert.equal(rec.maxActive, 1);
});

test('runSweepCompare: the same finding in both is same=true with its count; a different one is same=false and listed', async () => {
  const both = fakeIo({ script: (spec) => (spec.cmd === 'node' ? { code: 1, out: SWEEP_ONE_DEAD('[settle] waits=1 cap-hits=0\n') } : { code: 0, out: '' }) });
  const r1 = await runSweepCompare({ io: both.io, opts: {} });
  assert.match(r1.text, /^SWEEP old=1 settled=1 same=true$/m);
  assert.equal(r1.exitCode, 0);
  let n = 0;
  const diff = fakeIo({ script: (spec) => (spec.cmd === 'node' ? { code: 1, out: (++n === 1 ? SWEEP_ONE_DEAD('') : cdpOut(SWEEP_SCENARIOS, { 'button-sweep': ['dead      home  Another button'] }, '[settle] waits=1 cap-hits=0\n')) } : { code: 0, out: '' }) });
  const r2 = await runSweepCompare({ io: diff.io, opts: {} });
  assert.match(r2.text, /^SWEEP old=1 settled=1 same=false$/m);
  assert.match(r2.text, /only in old: +button-sweep :: dead {6}home {2}Some button/);
  assert.match(r2.text, /only in settled: +button-sweep :: dead {6}home {2}Another button/);
  assert.equal(r2.exitCode, 1);
});

test('runSweepCompare fails when the settled mode reports fewer finding classes, and says so', async () => {
  let n = 0;
  const { io } = fakeIo({ script: (spec) => (spec.cmd === 'node' ? { code: 1, out: (++n === 1 ? cdpOut(SWEEP_SCENARIOS, { 'button-sweep': ['dead      a  b', 'error     c  d'] }, '') : cdpOut(SWEEP_SCENARIOS, { 'button-sweep': ['dead      a  b'] }, '[settle] waits=1 cap-hits=0\n')) } : { code: 0, out: '' }) });
  const res = await runSweepCompare({ io, opts: {} });
  assert.equal(res.cmp.fewerClasses, true);
  assert.equal(res.exitCode, 1);
  assert.match(res.text, /fewer finding classes than the old/);
  assert.match(res.text, /^SWEEP old=2 settled=1 same=false$/m);
});

test('runSweepCompare says "incomplete" (no SWEEP same= line) when a run produced no result for a scenario', async () => {
  const { io } = fakeIo({ script: (spec) => (spec.cmd === 'node' ? { code: 2, out: '[cdp-gate] no target on port 1' } : { code: 0, out: '' }) });
  const res = await runSweepCompare({ io, opts: {} });
  assert.equal(res.exitCode, 1);
  assert.match(res.text, /^SWEEP incomplete: old run: no result for button-sweep/m);
  assert.ok(!/same=/.test(res.text));
  const f = findingsFromCdp(cdpOut(['button-sweep'], {}), SWEEP_SCENARIOS);
  assert.deepEqual(f.missing, ['money-button-sweep', 'cosmos-button-sweep', 'delivery-check-button-sweep']);
});

test('runSweepCompare warns about a missing [settle] line (the flag is not wired into cdp-gate yet)', async () => {
  const { io } = fakeIo({ script: (spec) => (spec.cmd === 'node' ? { code: 0, out: SWEEP_OK('') } : { code: 0, out: '' }) });
  const res = await runSweepCompare({ io, opts: {} });
  assert.match(res.text, /no \[settle\] line in the settled run/);
});

// ---- the command itself --------------------------------------------------------------------------------------------------------
test('main: bad arguments are exit 2 and run nothing; --list and --help are exit 0; --only runs through the injected io', async () => {
  const log = console.log, err = console.error, lines = [];
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  try {
    const a = fakeIo();
    assert.equal(await main(['--bogus'], a.io), 2);
    assert.equal(a.rec.runs.length, 0);
    assert.equal(await main(['--only', 'zzz'], a.io), 2);
    assert.equal(await main(['--list'], a.io), 0);
    assert.equal(await main(['--help'], a.io), 0);
    const b = fakeIo();
    assert.equal(await main(['--only', 'main'], b.io), 0);
    assert.equal(b.rec.runs.length, 1);
    assert.ok(lines.some((l) => /^total/m.test(l)), 'the table was printed');
    const c = fakeIo({ script: () => ({ code: 1, out: tap(1, 1) }) });
    assert.equal(await main(['--only', 'main'], c.io), 1);
  } finally { console.log = log; console.error = err; }
});
