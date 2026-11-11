// node --test dashboard-v5/tools/cdp-vault-template.test.mjs
// The vault-template cdp scenario needs the Electron harness, so this pins what plain Node can: the factory's shape, that every in-page
// snippet is valid JavaScript, what the fake preview answers when evaluated, and that each scenario stops at a failed fresh() and touches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeVaultTemplateScenarios, PAGE, TEMPLATE_PREVIEW, WANT_BANNER, REDRAFT_LABEL } from './cdp-vault-template.mjs';

const NAMES = ['vault-template-preview'];

test('the factory returns exactly the one scenario, an async function of one argument', () => {
  const S = makeVaultTemplateScenarios({ fresh: async () => null, sleep: async () => {} });
  assert.deepEqual(Object.keys(S), NAMES);
  for (const [name, fn] of Object.entries(S)) { assert.equal(typeof fn, 'function', name); assert.equal(fn.length, 1, name); }
});

test('every in-page snippet is valid JavaScript', () => {
  const snippets = [PAGE.dialog, PAGE.banner, PAGE.redraft, PAGE.bannerText, PAGE.dialogText, PAGE.draft, PAGE.previews, PAGE.saves, PAGE.stub, PAGE.openThread, PAGE.reset, PAGE.click('[data-vault="save"]'), TEMPLATE_PREVIEW];
  for (const s of snippets) assert.doesNotThrow(() => new vm.Script(s), s.slice(0, 60));
});

test('the fake preview answers what main answers with no model: a template draft whose frontmatter keeps conversation: and names a template', () => {
  const fn = vm.runInNewContext(TEMPLATE_PREVIEW);
  const r = fn('code:fake-1');
  assert.equal(r.drafted, 'template');
  assert.equal(r.model, null);
  assert.equal(r.modelUnavailable, true);
  assert.equal(r.exists, false);
  assert.equal(r.basis, 4);
  assert.ok(r.markdown.startsWith('---\nsource: claude-code\nconversation: "code:fake-1"\n'));
  assert.ok(r.markdown.includes('drafted_by: "a template, no model, from 4 chat messages"'));
  assert.ok(r.markdown.includes('## Opening request\n\n> ') && r.markdown.includes('## Where it ended\n\n> '));
  assert.equal(r.path, 'C:\\fake-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Fake release planning.md');
  assert.equal(r.rel, '30_Areas/Claude/project-a/2026-10-01 Fake release planning.md');
});

test('the banner wording is the spec’s, and the renderer (once it has the banner) carries it letter for letter', () => {
  assert.equal(WANT_BANNER, 'Drafted from a template: no local model was running. Edit it, then Save.');
  assert.equal(REDRAFT_LABEL, 'Draft again with the model');
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  for (const f of ['vals/claude-vault.js', 'logic/claude-vault.js', 'tpl/extras.tpl.js', 'tpl/claude.tpl.js']) {
    let src = ''; try { src = fs.readFileSync(dir + f, 'utf8'); } catch { continue; }
    if (/Drafted from a template/.test(src)) assert.ok(src.includes(WANT_BANNER), f + ' words the banner differently from the scenario');
    if (/Draft again with the model/.test(src)) assert.ok(src.includes(REDRAFT_LABEL), f + ' words the redraft button differently');
  }
});

test('the scenario returns the failed fresh() answer and touches nothing', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return null; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeVaultTemplateScenarios({ fresh: async () => ['the app never mounted'], sleep: async () => {} });
  assert.deepEqual(await S[NAMES[0]](t), ['the app never mounted']);
  assert.equal(evals.length, 0);
});

test('a thread view with no Save to vault button is reported, and the page is reset', async () => {
  const evals = [];
  const t = { evaluate: async (s) => { evals.push(s); return ''; }, waitFor: async () => false, errors: () => [], clearErrors() {} };
  const S = makeVaultTemplateScenarios({ fresh: async () => null, sleep: async () => {} });
  const out = await S[NAMES[0]](t);
  assert.ok(out.length > 0 && /Save to vault/.test(out[0]));
  assert.ok(evals.some((s) => s.includes('hqFake.reset(true)')), 'the fake is left as it was found');
  assert.ok(evals.some((s) => s.includes('closeVault()')));
});

test('a scripted happy path passes with no findings, and each way the page can be wrong is named', async () => {
  const ID = 'code:fake-1';
  const draft = vm.runInNewContext(TEMPLATE_PREVIEW)(ID).markdown;
  const run = async (over = {}) => {
    const st = { saves: [], previews: [[ID]], banner: WANT_BANNER, redraft: false, dialogText: 'Save to vault VEEMO CORTEX / 30_Areas/Claude/project-a/2026-10-01 Fake release planning.md', draft, ...over };
    const t = {
      errors: () => [], clearErrors() {},
      waitFor: async (expr) => !/Saved to VEEMO CORTEX/.test(expr) || st.saved !== false,
      evaluate: async (s) => {
        if (s === PAGE.bannerText) return st.banner;
        if (s === PAGE.dialogText) return st.dialogText;
        if (s === PAGE.draft) return st.draft;
        if (s === PAGE.previews) return st.previews;
        if (s === PAGE.saves) return st.saves.length ? st.saves : (st.afterSave || []);
        if (s.includes('data-vault="redraft"')) return st.redraft;
        if (/data-vault=\\?"save/.test(s)) { st.afterSave = [{ path: 'C:\\fake-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Fake release planning.md', markdown: st.draft }]; return true; }
        return true;
      },
    };
    return makeVaultTemplateScenarios({ fresh: async () => null, sleep: async () => {} })[NAMES[0]](t);
  };
  assert.deepEqual(await run(), []);
  assert.match((await run({ banner: null })).join('|'), /no template banner/);
  assert.match((await run({ banner: 'Drafted by a template.' })).join('|'), /banner says/);
  assert.match((await run({ redraft: true })).join('|'), /Draft again with the model/);
  assert.match((await run({ dialogText: 'Drafted by the local model (x) from 4 chat messages VEEMO CORTEX / 30_Areas/Claude/project-a/2026-10-01 Fake release planning.md' })).join('|'), /still claims a local model/);
  assert.match((await run({ previews: [[ID], [ID]] })).join('|'), /preview was asked as/);
  assert.match((await run({ draft: draft.replace('a template, no model', 'local model x') })).join('|'), /does not name a template/);
});
