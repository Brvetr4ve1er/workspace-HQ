// node --test dashboard-v5/tools/cdp-phone-file.test.mjs
// The phone-file cdp scenarios need the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page snippet is valid
// JavaScript, that the placeholder rows are the real builder's and carry no full path, and that each scenario stops at a failed fresh(), reports a row
// that never shows, and leaves the fake as it found it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makePhoneFileScenarios, PAGE, ROWS, ROW_OFF, ROW_ON, PLACEHOLDER_FOLDER, PLACEHOLDER_PATH_RE } from './cdp-phone-file.mjs';

const NAMES = ['phone-file-off-by-default', 'phone-file-pick-and-clear'];

test('the factory returns exactly the two scenarios, each an async function of one argument', () => {
  const S = makePhoneFileScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S).sort(), NAMES.slice().sort());
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.section, PAGE.row, PAGE.hasRow, PAGE.rowText, PAGE.bodyText, PAGE.bodyHtml, PAGE.pageCalls, PAGE.reads, PAGE.open, PAGE.reset,
    PAGE.button('Pick folder'), PAGE.hasButton('Turn off'), PAGE.click('Pick folder'), PAGE.click('Turn off'), PAGE.calls('reach.briefFile'), PAGE.serve(ROWS)];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 80));
});

test('the placeholder rows come from the real builder: off says its step, on names the folder and the time, neither holds a path', () => {
  assert.equal(ROW_OFF.id, 'brief-file'); assert.equal(ROW_OFF.ok, false);
  assert.equal(ROW_OFF.step, 'Pick a folder you already sync to your phone');
  assert.deepEqual(ROW_OFF.actions.map((a) => a.label), ['Pick folder', 'Turn off']);
  assert.equal(ROW_ON.ok, true);
  assert.ok(ROW_ON.detail.includes('"' + PLACEHOLDER_FOLDER + '"'), ROW_ON.detail);
  assert.ok(ROW_ON.detail.includes('last written 09:41'), ROW_ON.detail);
  const re = new RegExp(PLACEHOLDER_PATH_RE);
  for (const r of [ROW_OFF, ROW_ON]) assert.ok(!re.test(JSON.stringify(r)), 'a path in ' + JSON.stringify(r));
  assert.ok(re.test('C:\\Users\\x'), 'the path check misses a drive-letter path');
  assert.ok(re.test('placeholder-sync-root'));
  assert.ok(!re.test('https://example.test/a'), 'the path check flags a URL');
  assert.ok(!re.test(PLACEHOLDER_FOLDER));
});

test('the served fake keeps the folder state in the page and answers like main (pick, clear, anything else refused)', () => {
  const win = { hqFake: { calls: [], sets: {}, set(m, v) { this.sets[m] = v; } } };
  vm.runInNewContext(PAGE.serve(ROWS), { window: win, hqFake: win.hqFake, Date });
  const read = win.hqFake.sets['reach.read'], brief = win.hqFake.sets['reach.briefFile'];
  const id = (r) => r.rows.find((x) => x.id === 'brief-file');
  assert.equal(id(read()).ok, false);
  const j = (x) => JSON.parse(JSON.stringify(x));   // the page is another realm
  assert.deepEqual(j(brief('pick')), { ok: true, folderName: PLACEHOLDER_FOLDER, written: true });
  assert.equal(id(read()).ok, true);
  assert.deepEqual(j(brief('clear')), { ok: true, folderName: null, fileLeft: true, note: 'Turned off.' });
  assert.equal(id(read()).ok, false);
  assert.deepEqual(j(brief('rm -rf')), { error: 'Unknown action' });
  assert.deepEqual(j(win.__pf.actions), ['pick', 'clear', 'rm -rf']);
  assert.equal(win.__pf.reads, 3);
});

test('each scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makePhoneFileScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  for (const name of NAMES) assert.deepEqual(await S[name](t), ['the app never mounted'], name);
  assert.equal(evals.length, 0);
});

test('a row that never shows is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makePhoneFileScenarios({ fresh: async () => null, sleep: async () => {} });
  for (const name of NAMES) {
    evals.length = 0;
    const out = await S[name](t);
    assert.ok(out.length > 0, name);
    assert.ok(out.some((m) => /phone file row/.test(m)), name + ': ' + out.join(' | '));
    assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), name + ' leaves the fake as it found it');
    assert.ok(evals.some((s) => s.includes('settingsOpen: false')), name + ' closes Settings');
  }
});

test('a scripted page that behaves passes both scenarios; one that leaks a path or calls briefFile early fails them', async () => {
  const S = makePhoneFileScenarios({ fresh: async () => null, sleep: async () => {} });
  const page = (over = {}) => {
    const st = { folder: false, actions: [], reads: 1, ...over };
    const t = {
      waitFor: async () => true, errors: () => [], clearErrors() {},
      async evaluate(s) {
        if (s === PAGE.rowText) return st.folder ? 'closed ' + ROW_ON.detail : 'closed ' + ROW_OFF.detail + ' Next: ' + ROW_OFF.step;
        if (s === PAGE.reads) return st.reads;
        if (s === PAGE.pageCalls) return st.actions;
        if (s === PAGE.bodyHtml) return st.leak ? '<p>C:\\Users\\x\\Sync</p>' : '<p>fine</p>';
        if (s === PAGE.calls('reach.briefFile')) return 0;
        if (s === PAGE.click('Pick folder')) { st.folder = true; st.actions.push('pick'); return true; }
        if (s === PAGE.click('Turn off')) { st.folder = false; st.actions.push('clear'); return true; }
        if (s === PAGE.hasButton('Turn off')) return true;
        return true;
      },
    };
    return { t, st };
  };
  for (const name of NAMES) { const { t } = page(); assert.deepEqual(await S[name](t), [], name); }
  const early = page({ actions: ['pick'] });
  assert.ok((await S['phone-file-off-by-default'](early.t)).some((m) => /briefFile was called just by looking/.test(m)));
  const leaky = page({ leak: true });
  assert.ok((await S['phone-file-pick-and-clear'](leaky.t)).some((m) => /full path reached the page/.test(m)));
});
