// gates-core: the pure half of tools/gates.mjs, the one command that runs every gate step in order and prints one table.
// No process, file or clock is touched here: everything outside goes through the injected `io` (tools/gates.mjs supplies the
// real one; tools/gates.test.mjs supplies a fake with no Electron and no child process).
//
// Rules this module keeps (and the tests pin):
//   - steps run ONE AT A TIME, in catalog order (the working tree is shared, never parallel);
//   - every step has its own timeout; electron steps get their own HQ_*_PROFILE name and, for the cdp step, a free port;
//   - the cdp step starts ONE dev-main electron child it owns, and always stops that child (pass, fail, timeout or a throw);
//   - the only process ever stopped is a child this run started (io.start() handle .stop()). There is no kill-by-name,
//     no kill-by-image, no scan of the process table, and the app's own --user-data-dir instance is never a target;
//   - exit 0 only if every selected step passed (a step with no files to run is SKIP, which is not a failure);
//   - --budget only ever prints a warning line; it never changes the exit code.
//
// io contract (all async unless noted):
//   io.now()                      -> ms (sync)
//   io.log(line)                  progress line (sync)
//   io.run(spec, { timeoutMs })   -> { code, out, timedOut, ms }   spec = { cmd, args, cwd, env }; cmd 'node' | 'electron' are symbolic
//   io.start(spec)                -> { pid, stop(): Promise<void>, output(): string }
//   io.freePort()                 -> number
//   io.uniqueProfile(tag)         -> string (a throwaway userData folder NAME, never a path the owner uses)
//   io.cleanupProfile(name)       -> removes only that throwaway folder
//   io.gateDataFile(profile)      -> path of the invented window.DATA written inside that throwaway profile folder (the selftest and cdp steps
//                                    pass it as HQ_V5_DATA_FILE, so a scan landing in the owner's app never changes a gate run)
//   io.countFiles(pattern)        -> number of files a glob matches (used only by steps with requireFiles)

import { parseSettleLine } from '../dashboard-v5/tools/cdp-settle.mjs';

export const SWEEP_SCENARIOS = Object.freeze(['button-sweep', 'money-button-sweep', 'cosmos-button-sweep', 'delivery-check-button-sweep']);

const CHILD_OUTPUT_TAIL = 12;

// ---- the catalog ---------------------------------------------------------------------------------------------
const nodeTest = (id, title, globs, o = {}) => ({ id, kind: 'node-test', title, cmd: 'node', cwd: '.', args: ['--test', '--test-reporter=tap', ...globs], timeoutMs: o.timeoutMs || 300000, native: !!o.native, requireFiles: o.requireFiles || null });

// The same lines as README.md's gate section, in the same order, then the two electron steps, then the native checks.
export function buildCatalog() {
  return [
    nodeTest('main', 'dashboard tests', ['dashboard/*.test.mjs'], { timeoutMs: 900000 }),
    nodeTest('hub', 'Claude Hub tests', ['dashboard/claude-hub/*.test.mjs']),
    nodeTest('money', 'money tests', ['dashboard/money/*.test.mjs']),
    nodeTest('cosmos', 'Cosmos tests', ['dashboard/cosmos/*.test.mjs']),
    nodeTest('renderer', 'renderer tests', ['dashboard-v5/src/*.test.mjs', 'dashboard-v5/src/dc/*.test.mjs', 'dashboard-v5/src/live/*.test.mjs', 'dashboard-v5/src/logic/*.test.mjs', 'dashboard-v5/src/elements/*.test.mjs', 'dashboard-v5/src/vals/*.test.mjs', 'dashboard-v5/styles/*.test.mjs', 'dashboard-v5/tools/*.test.mjs'], { timeoutMs: 600000 }),
    nodeTest('tools', 'tools and MCP tests', ['tools/*.test.mjs', 'tools/trailer/*.test.mjs', 'mcp/workspacehq/*.test.mjs']),
    { id: 'selftest', kind: 'selftest', title: 'Electron selftest', cmd: 'electron', cwd: 'dashboard-v5', args: ['dev-main.js', '--preload=fake', '--hidden', '--selftest'], profileEnv: 'HQ_V5_PROFILE', timeoutMs: 330000, native: false },
    { id: 'cdp', kind: 'cdp', title: 'CDP gate', cwd: 'dashboard-v5', scenarios: 'all', timeoutMs: 1500000, native: false },
    // run only under --native
    nodeTest('bridge', 'browser-bridge tests', ['browser-bridge/*.test.mjs'], { native: true, requireFiles: 'browser-bridge/*.test.mjs' }),
    { id: 'cosmos-native', kind: 'native', title: 'Cosmos native check', cmd: 'electron', cwd: '.', args: ['dashboard/cosmos-native.check.js'], profileEnv: 'HQ_COSMOS_CHECK_PROFILE', timeoutMs: 120000, native: true },
    { id: 'delivery-native', kind: 'native', title: 'Delivery check native check', cmd: 'electron', cwd: '.', args: ['dashboard/delivery-check.native.check.js'], profileEnv: 'HQ_DCK_CHECK_PROFILE', timeoutMs: 120000, native: true },
  ];
}

// ---- arguments -----------------------------------------------------------------------------------------------
const VALUE_FLAGS = new Set(['only', 'skip', 'budget', 'scenario']);
const BOOL_FLAGS = new Set(['native', 'bail', 'settle', 'sweep-compare', 'list', 'help']);

export function parseArgs(argv) {
  const opts = { only: null, skip: [], native: false, bail: false, budget: null, settle: false, sweepCompare: false, list: false, help: false, scenario: 'all' };
  const a = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < a.length; i++) {
    const raw = String(a[i]);
    if (!raw.startsWith('--')) return { error: 'unexpected argument "' + raw + '"' };
    const eq = raw.indexOf('=');
    const name = (eq > 0 ? raw.slice(2, eq) : raw.slice(2));
    let val = eq > 0 ? raw.slice(eq + 1) : null;
    if (BOOL_FLAGS.has(name)) {
      if (val !== null) return { error: '--' + name + ' takes no value' };
      opts[name === 'sweep-compare' ? 'sweepCompare' : name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      if (val === null) { val = a[i + 1]; i++; }
      if (val === undefined || String(val).startsWith('--') || String(val) === '') return { error: '--' + name + ' needs a value' };
      if (name === 'budget') {
        const n = Number(val);
        if (!Number.isFinite(n) || n <= 0) return { error: '--budget needs a positive number of seconds, got "' + val + '"' };
        opts.budget = n;
      } else if (name === 'scenario') opts.scenario = String(val).trim();
      else {
        const ids = String(val).split(',').map((s) => s.trim()).filter(Boolean);
        if (!ids.length) return { error: '--' + name + ' needs at least one step id' };
        if (name === 'only') opts.only = ids; else opts.skip = opts.skip.concat(ids);
      }
    } else return { error: 'unknown flag --' + name };
  }
  return { opts };
}

export function selectSteps(catalog, opts) {
  const known = new Set(catalog.map((s) => s.id));
  const bad = [].concat(opts.only || [], opts.skip || []).filter((id) => !known.has(id));
  if (bad.length) return { error: 'unknown step id: ' + [...new Set(bad)].join(', ') + ' (known: ' + catalog.map((s) => s.id).join(', ') + ')' };
  let steps = opts.only ? catalog.filter((s) => opts.only.includes(s.id)) : catalog.filter((s) => !s.native || opts.native);
  if (opts.skip && opts.skip.length) steps = steps.filter((s) => !opts.skip.includes(s.id));
  return { steps };
}

export const USAGE = [
  'node tools/gates.mjs [--only a,b] [--skip a,b] [--native] [--bail] [--budget 360] [--settle] [--scenario list] [--sweep-compare] [--list]',
  '  runs every gate step in order, one at a time, and prints one summary table. Exit 0 only if every step passed.',
  '  --only/--skip  step ids (see --list)   --native  add the browser-bridge tests and the two real-Electron checks',
  '  --bail         stop after the first failed step   --budget N  warn (never fail) when the total passes N seconds',
  '  --settle       the cdp button sweeps wait for the page to settle instead of sleeping',
  '  --sweep-compare  run the four button sweeps old then settled, each on a fresh profile, and compare every finding',
].join('\n');

// ---- parsers -------------------------------------------------------------------------------------------------
const lastNumber = (text, key) => {
  const re = new RegExp('^(?:#|ℹ)\\s+' + key + '\\s+([\\d.]+)', 'gm');
  let m, v = null;
  while ((m = re.exec(text))) v = Number(m[1]);
  return v;
};

export function parseNodeTest(text) {
  const s = String(text || '');
  const tests = lastNumber(s, 'tests'), pass = lastNumber(s, 'pass'), fail = lastNumber(s, 'fail');
  return {
    found: tests !== null && pass !== null && fail !== null,
    tests, pass, fail,
    skipped: lastNumber(s, 'skipped') || 0, cancelled: lastNumber(s, 'cancelled') || 0, todo: lastNumber(s, 'todo') || 0,
    durationMs: lastNumber(s, 'duration_ms'),
  };
}

export function parseSelftest(text) {
  const s = String(text || '');
  let sum = null;
  for (const line of s.split(/\r?\n/)) {
    if (line.startsWith('[selftest] {')) { try { sum = JSON.parse(line.slice('[selftest] '.length)); } catch { /* unreadable line: not a summary */ } }
  }
  if (!sum) {
    const m = /combos=(\d+)\s+errors=(\d+)/.exec(s);
    if (m) sum = { combos: Number(m[1]), errors: Number(m[2]), unresolved: 0, failures: 0 };
  }
  return sum ? { found: true, combos: sum.combos, errors: sum.errors, unresolved: sum.unresolved, failures: sum.failures } : { found: false };
}

// cdp-gate prints "PASS name (N ms)" / "FAIL name (N ms)" + the failure lines indented two spaces, then "[cdp-gate] N/M passed".
// Only indented lines that directly follow a FAIL line belong to it (a sweep prints its own indented findings earlier, un-attributed).
export function parseCdpGate(text) {
  const scenarios = [];
  let cur = null, passed = null, total = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const head = /^(PASS|FAIL) (\S+) \((\d+) ms\)\s*$/.exec(line);
    if (head) { cur = { name: head[2], ok: head[1] === 'PASS', ms: Number(head[3]), lines: [] }; scenarios.push(cur); continue; }
    if (cur && !cur.ok && /^ {2}\S/.test(line)) { cur.lines.push(line.slice(2).replace(/\s+$/, '')); continue; }
    cur = null;
    const sum = /^\[cdp-gate\] (\d+)\/(\d+) passed\s*$/.exec(line);
    if (sum) { passed = Number(sum[1]); total = Number(sum[2]); }
  }
  return { found: passed !== null, passed, total, scenarios, settle: parseSettleLine(text) };
}

const uniq = (a) => [...new Set(a)];

export function failingLines(kind, text, limit = 8) {
  const lines = String(text || '').split(/\r?\n/);
  let out = [];
  if (kind === 'node-test') {
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*not ok\b/.test(lines[i])) continue;
      out.push(lines[i].trim());
      for (let j = i + 1, n = 0; j < lines.length && n < 4; j++, n++) {
        if (/^\s*(error|message|expected|actual|location|operator|code|failureType):/.test(lines[j])) out.push(lines[j].trim()); else if (/^\s*(not )?ok\b/.test(lines[j])) break;
      }
    }
  } else if (kind === 'cdp') {
    for (const sc of parseCdpGate(text).scenarios) if (!sc.ok) { out.push('FAIL ' + sc.name); for (const l of sc.lines.slice(0, 3)) out.push('  ' + l); }
  } else if (kind === 'selftest') {
    out = lines.filter((l) => l.startsWith('[selftest') && !l.startsWith('[selftest] {') && !l.startsWith('[selftest:detail]')).map((l) => l.trim());
  }
  out = uniq(out).slice(0, limit);
  if (!out.length) out = lines.map((l) => l.trim()).filter(Boolean).slice(-Math.min(limit, 6));
  return out.map((l) => (l.length > 200 ? l.slice(0, 197) + '...' : l));
}

// ---- running one step -----------------------------------------------------------------------------------------
const fmtSec = (ms) => Math.round(ms / 100) / 10;

function nodeTestResult(step, r) {
  const p = parseNodeTest(r.out);
  if (r.timedOut) return { result: 'TIMEOUT', counts: p.found ? `${p.pass} pass ${p.fail} fail (cut off)` : 'no summary', failLines: [`timed out after ${fmtSec(step.timeoutMs)} s`] };
  if (!p.found) return { result: 'FAIL', counts: 'no summary', failLines: ['no node --test summary in the output (exit ' + r.code + ')'].concat(failingLines('node-test', r.out, 5)) };
  const counts = `${p.pass} pass ${p.fail} fail${p.skipped ? ' ' + p.skipped + ' skip' : ''}${p.cancelled ? ' ' + p.cancelled + ' cancelled' : ''}`;
  const ok = r.code === 0 && p.fail === 0 && p.cancelled === 0 && p.tests > 0;
  return { result: ok ? 'PASS' : 'FAIL', counts, failLines: ok ? [] : failingLines('node-test', r.out), detail: p };
}

function selftestResult(step, r) {
  const p = parseSelftest(r.out);
  if (r.timedOut) return { result: 'TIMEOUT', counts: p.found ? 'combos=' + p.combos : 'no summary', failLines: [`timed out after ${fmtSec(step.timeoutMs)} s`] };
  if (!p.found) return { result: 'FAIL', counts: 'no summary', failLines: ['no [selftest] summary in the output (exit ' + r.code + ')'].concat(failingLines('selftest', r.out, 5)) };
  const clean = r.code === 0 && p.errors === 0 && p.unresolved === 0 && p.failures === 0;
  return { result: clean ? 'PASS' : 'FAIL', counts: `combos=${p.combos} ${p.errors}/${p.unresolved}/${p.failures}`, failLines: clean ? [] : failingLines('selftest', r.out), detail: p };
}

function tailOf(text, n) { return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-n); }

function cdpResult(step, r, child) {
  const p = parseCdpGate(r.out);
  if (r.timedOut) return { result: 'TIMEOUT', counts: p.found ? `${p.passed}/${p.total} (cut off)` : 'no summary', failLines: [`timed out after ${fmtSec(step.timeoutMs)} s`], detail: p };
  if (!p.found) {
    const why = r.code === 2 ? 'cdp-gate could not connect or was misused (exit 2)' : 'no "N/M passed" line in the output (exit ' + r.code + ')';
    return { result: 'FAIL', counts: 'no summary', failLines: [why].concat(tailOf(r.out, 4), ['electron said:'], tailOf(child && child.output && child.output(), CHILD_OUTPUT_TAIL / 3)), detail: p };
  }
  const ok = r.code === 0 && p.total > 0 && p.passed === p.total;
  const counts = `${p.passed}/${p.total} passed` + (p.settle ? ` · ${p.settle.capHits} cap hit${p.settle.capHits === 1 ? '' : 's'}` : '');
  return { result: ok ? 'PASS' : 'FAIL', counts, failLines: ok ? [] : failingLines('cdp', r.out), detail: p };
}

function nativeResult(step, r) {
  const last = tailOf(r.out, 1)[0] || '';
  if (r.timedOut) return { result: 'TIMEOUT', counts: 'exit ?', failLines: [`timed out after ${fmtSec(step.timeoutMs)} s`] };
  const ok = r.code === 0;
  return { result: ok ? 'PASS' : 'FAIL', counts: 'exit ' + r.code, failLines: ok ? [] : tailOf(r.out, 6), note: last };
}

// Runs one step with the injected io. Never throws: a throw becomes a FAIL row with the message.
export async function runStep(step, io, opts = {}) {
  const t0 = io.now();
  const base = { id: step.id, title: step.title };
  let profile = null, child = null, body;
  try {
    if (step.requireFiles && (await io.countFiles(step.requireFiles)) === 0) {
      return { ...base, result: 'SKIP', counts: 'no test files', seconds: 0, failLines: [] };
    }
    const env = {};
    if (step.profileEnv || step.kind === 'cdp') { profile = io.uniqueProfile(step.id); }
    if (step.kind === 'node-test') {
      body = nodeTestResult(step, await io.run({ cmd: step.cmd, args: step.args, cwd: step.cwd, env }, { timeoutMs: step.timeoutMs }));
    } else if (step.kind === 'selftest' || step.kind === 'native') {
      env[step.profileEnv] = profile;
      if (step.kind === 'selftest') env.HQ_V5_DATA_FILE = await io.gateDataFile(profile);
      const r = await io.run({ cmd: step.cmd, args: step.args, cwd: step.cwd, env }, { timeoutMs: step.timeoutMs });
      body = step.kind === 'selftest' ? selftestResult(step, r) : nativeResult(step, r);
    } else if (step.kind === 'cdp') {
      const port = await io.freePort();
      const settle = step.settle !== undefined ? !!step.settle : !!opts.settle;
      // the ONE electron this step owns: its own profile, its own port, stopped in the finally below
      child = await io.start({ cmd: 'electron', cwd: step.cwd, args: ['dev-main.js', '--preload=fake', '--hidden', '--remote-debugging-port=' + port], env: { HQ_V5_PROFILE: profile, HQ_V5_DATA_FILE: await io.gateDataFile(profile) } });
      const scenario = step.scenarios === 'all' && opts.scenario ? opts.scenario : step.scenarios;
      const args = ['tools/cdp-gate.mjs', '--port', String(port), '--scenario', scenario, '--wait', '30000'].concat(settle ? ['--settle'] : []);
      const r = await io.run({ cmd: 'node', args, cwd: step.cwd, env: {} }, { timeoutMs: step.timeoutMs });
      body = cdpResult(step, r, child);
    } else body = { result: 'FAIL', counts: '', failLines: ['unknown step kind ' + step.kind] };
  } catch (e) {
    body = { result: 'FAIL', counts: 'threw', failLines: ['threw: ' + ((e && e.message) || e)] };
  } finally {
    if (child) { try { await child.stop(); } catch { /* a child that is already gone is stopped */ } }
    if (profile) { try { await io.cleanupProfile(profile); } catch { /* a leftover temp folder is not a gate failure */ } }
  }
  return { ...base, ...body, seconds: fmtSec(io.now() - t0) };
}

// ---- the run + the table ----------------------------------------------------------------------------------------
const pad = (s, n) => (String(s).length >= n ? String(s) : String(s) + ' '.repeat(n - String(s).length));
const padL = (s, n) => (String(s).length >= n ? String(s) : ' '.repeat(n - String(s).length) + String(s));

export function formatTable(results, totalSeconds, budgetWarning) {
  const w = Math.max(14, ...results.map((r) => r.id.length)) + 2;
  const cw = Math.max(8, ...results.map((r) => String(r.counts || '').length)) + 2;
  const lines = [pad('step', w) + pad('result', 9) + pad('counts', cw) + padL('seconds', 8)];
  lines.push('-'.repeat(w + 9 + cw + 8));
  for (const r of results) lines.push(pad(r.id, w) + pad(r.result, 9) + pad(r.counts || '', cw) + padL(r.seconds === undefined ? '-' : r.seconds.toFixed(1), 8));
  lines.push('-'.repeat(w + 9 + cw + 8));
  lines.push(pad('total', w) + pad('', 9) + pad('', cw) + padL(totalSeconds.toFixed(1), 8));
  if (budgetWarning) lines.push(budgetWarning);
  for (const r of results) {
    if ((r.result === 'FAIL' || r.result === 'TIMEOUT') && r.failLines && r.failLines.length) {
      lines.push('', '-- ' + r.id + ' (' + r.result + '), first failing lines:');
      for (const l of r.failLines) lines.push('   ' + l);
    }
  }
  return lines.join('\n');
}

export function budgetWarning(totalSeconds, budget) {
  if (budget == null || totalSeconds <= budget) return '';
  return `BUDGET: the run took ${totalSeconds.toFixed(1)} s, over the ${budget} s budget (a warning only; the result above stands)`;
}

export async function runGates({ catalog, opts, io }) {
  const sel = selectSteps(catalog, opts);
  if (sel.error) return { error: sel.error, exitCode: 2, text: sel.error };
  const t0 = io.now();
  const results = [];
  let stop = false;
  for (const step of sel.steps) {
    if (stop) { results.push({ id: step.id, title: step.title, result: 'NOT RUN', counts: 'after --bail', seconds: undefined, failLines: [] }); continue; }
    io.log('[gates] ' + step.id + ' ...');
    const r = await runStep(step, io, opts);   // awaited: never two steps at once
    io.log('[gates] ' + step.id + ' ' + r.result + ' in ' + r.seconds.toFixed(1) + ' s');
    results.push(r);
    if (opts.bail && r.result !== 'PASS' && r.result !== 'SKIP') stop = true;
  }
  const totalSeconds = fmtSec(io.now() - t0);
  const bad = results.filter((r) => r.result !== 'PASS' && r.result !== 'SKIP');
  const text = formatTable(results, totalSeconds, budgetWarning(totalSeconds, opts.budget));
  return { results, totalSeconds, exitCode: results.length && !bad.length ? 0 : 1, text };
}

// ---- --sweep-compare ---------------------------------------------------------------------------------------------
export function findingClass(line) {
  const m = /^(error|not-wired|dead|vanished)\b/.exec(String(line || '').trim());
  if (m) return m[1];
  if (/^threw:/.test(String(line || '').trim())) return 'threw';
  return 'other';
}

// Compare the FULL sets of findings (scenario + line), not just counts. `old` and `settled` are { scenario: [line, ...] }.
export function compareSweeps(oldF, settledF) {
  const flat = (f) => { const s = new Set(); for (const [sc, lines] of Object.entries(f || {})) for (const l of lines || []) s.add(sc + ' :: ' + l); return s; };
  const a = flat(oldF), b = flat(settledF);
  const onlyOld = [...a].filter((x) => !b.has(x)), onlySettled = [...b].filter((x) => !a.has(x));
  const classes = (set) => new Set([...set].map((x) => findingClass(x.slice(x.indexOf(' :: ') + 4))));
  const ca = classes(a), cb = classes(b);
  const missingClasses = [...ca].filter((c) => !cb.has(c));
  return {
    oldN: a.size, settledN: b.size, same: !onlyOld.length && !onlySettled.length,
    onlyOld, onlySettled, oldClasses: [...ca].sort(), settledClasses: [...cb].sort(), missingClasses,
    fewerClasses: cb.size < ca.size || missingClasses.length > 0,
  };
}

export function formatSweepLine(c) {
  return `SWEEP old=${c.oldN} settled=${c.settledN} same=${c.same}`;
}

// Findings per scenario from a cdp-gate run; also reports whether every wanted scenario produced a PASS/FAIL line.
export function findingsFromCdp(text, wanted) {
  const p = parseCdpGate(text), by = {};
  for (const name of wanted) by[name] = null;
  for (const sc of p.scenarios) if (wanted.includes(sc.name)) by[sc.name] = sc.ok ? [] : sc.lines;
  const missing = wanted.filter((n) => by[n] === null);
  for (const n of missing) by[n] = [];
  return { findings: by, missing, parsed: p };
}

export async function runSweepCompare({ io, opts = {} }) {
  const scenarios = SWEEP_SCENARIOS.join(',');
  const mk = (id, settle) => ({ id, kind: 'cdp', title: 'sweeps ' + id, cwd: 'dashboard-v5', scenarios, settle, timeoutMs: 1500000, native: false });
  const t0 = io.now();
  const runs = [];
  for (const [id, settle] of [['sweep-old', false], ['sweep-settled', true]]) {
    io.log('[gates] ' + id + ' ...');
    // run through the same cdp path (own electron, own profile, own port, always stopped), capturing the raw output
    let captured = '';
    const spy = { ...io, run: async (spec, o) => { const r = await io.run(spec, o); if (spec.cmd === 'node') captured = r.out; return r; } };
    const r = await runStep(mk(id, settle), spy, { ...opts, scenario: scenarios });
    const f = findingsFromCdp(captured, SWEEP_SCENARIOS);
    runs.push({ id, step: r, ...f });
    io.log('[gates] ' + id + ' ' + r.result + ' in ' + r.seconds.toFixed(1) + ' s');
  }
  const [o, s] = runs;
  const incomplete = [].concat(o.missing.map((n) => 'old run: no result for ' + n), s.missing.map((n) => 'settled run: no result for ' + n));
  const cmp = compareSweeps(o.findings, s.findings);
  const lines = [];
  const settleInfo = s.parsed.settle;
  if (incomplete.length) {
    lines.push('SWEEP incomplete: ' + incomplete.join('; '));
    for (const run of runs) for (const l of run.step.failLines || []) lines.push('   ' + run.id + ': ' + l);
  } else {
    lines.push(formatSweepLine(cmp));
    for (const x of cmp.onlyOld.slice(0, 10)) lines.push('   only in old:     ' + x);
    for (const x of cmp.onlySettled.slice(0, 10)) lines.push('   only in settled: ' + x);
    if (cmp.fewerClasses) lines.push('   the settled sweep reports fewer finding classes than the old (' + cmp.settledClasses.join(',') + ' vs ' + cmp.oldClasses.join(',') + '): a wait is hiding something');
  }
  lines.push(`seconds: old ${o.step.seconds.toFixed(1)}, settled ${s.step.seconds.toFixed(1)}` + (settleInfo ? `; settled waits=${settleInfo.waits} cap-hits=${settleInfo.capHits}` : '; no [settle] line in the settled run (is --settle wired into cdp-gate?)'));
  const totalSeconds = fmtSec(io.now() - t0);
  const warn = budgetWarning(totalSeconds, opts.budget);
  if (warn) lines.push(warn);
  return { cmp, incomplete, runs, totalSeconds, exitCode: !incomplete.length && cmp.same && !cmp.fewerClasses ? 0 : 1, text: lines.join('\n') };
}
