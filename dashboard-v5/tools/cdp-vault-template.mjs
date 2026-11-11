// CDP scenario for Save to vault with no local model (batch 3, dish vault-template). cdp-gate.mjs merges it:
//   Object.assign(SCENARIOS, makeVaultTemplateScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario vault-template-preview     (needs --preload=fake)
//
//   vault-template-preview   the fake Hub answers the preview the way main answers on a machine with no model running
//                            ({ drafted:'template', model:null, modelUnavailable:true }); the thread view's "Save to vault" opens a
//                            draft that (1) says it is a template in one banner line, not a model, (2) shows no "Draft again with
//                            the model" button, (3) was asked for once, with the plain chat id (the model is always tried first),
//                            (4) wrote nothing before Save, (5) lands as exactly one save of exactly the draft, without replace.
//
// DOM contract this scenario asks of the renderer (tpl/extras.tpl.js, inside the Save to vault dialog, next to the existing [data-vault="save"]):
//   [data-vault="template-banner"]  shown while state.vault.drafted === 'template'; its text is WANT_BANNER
//   [data-vault="redraft"]          "Draft again with the model"; present only when state.vault.drafted === 'template' && !state.vault.modelUnavailable

export const WANT_BANNER = 'Drafted from a template: no local model was running. Edit it, then Save.';
export const REDRAFT_LABEL = 'Draft again with the model';
const ID = 'code:fake-1';
const REL = '30_Areas/Claude/project-a/2026-10-01 Fake release planning.md';

// the fake preview, as source (hqFake.set takes a function; it is stringified into the page like vault-preview-confirm's)
export const TEMPLATE_PREVIEW = `(id) => ({
  path: 'C:\\\\fake-vault\\\\30_Areas\\\\Claude\\\\project-a\\\\2026-10-01 Fake release planning.md', rel: ${JSON.stringify(REL)}, exists: false,
  model: null, basis: 4, drafted: 'template', modelUnavailable: true,
  markdown: '---\\nsource: claude-code\\nconversation: ' + JSON.stringify(String(id)) + '\\nproject: "[[project-a]]"\\ncreated: 2026-10-16\\nchat_date: 2026-10-01\\ntitle: "Fake release planning"\\ndrafted_by: "a template, no model, from 4 chat messages"\\ntags: [claude]\\n---\\n\\n# Fake release planning\\n\\nProject: [[project-a]] · chat of 2026-10-01\\n\\n## Opening request\\n\\n> Plan the fake release.\\n\\n## Where it ended\\n\\n> Added: tag first, then ship.\\n\\n4 messages · chat of 2026-10-01\\n' })`;

const DIALOG = `document.querySelector('[role="dialog"][aria-label="Save to vault"]')`;
export const PAGE = Object.freeze({
  dialog: DIALOG,
  banner: `document.querySelector('[data-vault="template-banner"]')`,
  redraft: `document.querySelector('[data-vault="redraft"]')`,
  bannerText: `(() => { const b = document.querySelector('[data-vault="template-banner"]'); return b ? b.textContent.replace(/\\s+/g, ' ').trim() : null; })()`,
  dialogText: `(() => { const d = ${DIALOG}; return d ? d.textContent.replace(/\\s+/g, ' ') : ''; })()`,
  draft: `(() => { const d = ${DIALOG}; const a = d && d.querySelector('textarea'); return a ? a.value : null; })()`,
  previews: `hqFake.calls('claudeVault.preview').map((c) => c.args)`,
  saves: `hqFake.calls('claudeVault.save').map((c) => c.args[0])`,
  stub: `(() => { hqFake.reset(true); hqFake.set('claudeVault.preview', ${TEMPLATE_PREVIEW}); return true; })()`,
  openThread: `(() => { const L = WHQ.app.logic; L.store.live.claudeLib = Object.assign({}, L.store.live.claudeLib, { thread: { conversation: { id: ${JSON.stringify(ID)}, title: 'Fake release planning', source: 'code' }, messages: [], hasMore: false } });
    L.go('claude', 'chats'); L.setState({ clOpen: true }); return true; })()`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L.closeVault(); L.setState({ clOpen: false }); if (L.store.live.claudeLib) L.store.live.claudeLib.thread = null; return true; })()`,
  click: (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
});

export function makeVaultTemplateScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  return {
    async 'vault-template-preview'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.stub);
        await t.evaluate(PAGE.openThread);
        if (!await t.waitFor(`!!document.querySelector('[data-cl="vault"]')`, 5000)) return out.concat('the thread view has no "Save to vault" button');
        if (!await t.evaluate(PAGE.click('[data-cl="vault"]'))) return out.concat('"Save to vault" was disabled for an open chat');
        if (!await t.waitFor(`!!${DIALOG} && !!${DIALOG}.querySelector('textarea')`, 5000)) return out.concat('a model-less machine never reached a draft: ' + String(await t.evaluate(PAGE.dialogText)).slice(0, 220));

        const banner = await t.evaluate(PAGE.bannerText);
        if (banner == null) out.push('the draft shows no template banner');
        else if (banner !== WANT_BANNER) out.push('the banner says ' + JSON.stringify(banner) + ', want ' + JSON.stringify(WANT_BANNER));
        const text = String(await t.evaluate(PAGE.dialogText));
        if (/Drafted by the local model/.test(text)) out.push('the dialog still claims a local model drafted it');
        if (/undefined|\[object|NaN/.test(text)) out.push('an unresolved binding reached the dialog text');
        if (await t.evaluate(`!!${PAGE.redraft}`)) out.push('the "' + REDRAFT_LABEL + '" button shows although no model is reachable');
        const draft = await t.evaluate(PAGE.draft);
        if (!String(draft).startsWith('---\nsource: claude-code\nconversation: "' + ID + '"')) out.push('the draft is not the preview’s markdown: ' + JSON.stringify(String(draft).slice(0, 80)));
        if (!String(draft).includes('drafted_by: "a template, no model, from 4 chat messages"')) out.push('the draft’s drafted_by line does not name a template');
        if (!text.includes('VEEMO CORTEX / ' + REL)) out.push('the destination path is not shown');

        const asked = await t.evaluate(PAGE.previews);
        if (JSON.stringify(asked) !== JSON.stringify([[ID]])) out.push('the preview was asked as ' + JSON.stringify(asked) + ', want one call with the plain chat id');
        if ((await t.evaluate(PAGE.saves)).length) out.push('something was saved before Save was pressed');

        await pause(60);
        if (!await t.evaluate(PAGE.click('[data-vault="save"]'))) return out.concat('Save was disabled on a template draft');
        if (!await t.waitFor(`!!${DIALOG} && ${DIALOG}.textContent.includes('Saved to VEEMO CORTEX')`, 5000)) out.push('no "Saved to" confirmation');
        const s = await t.evaluate(PAGE.saves);
        if (s.length !== 1) out.push('Save wrote ' + s.length + ' notes, want exactly 1');
        else {
          if (s[0].markdown !== draft) out.push('Save did not send exactly the draft');
          if ('replace' in s[0]) out.push('Save sent replace on a fresh note');
          if (s[0].path !== 'C:\\fake-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Fake release planning.md') out.push('Save sent the path ' + JSON.stringify(s[0].path));
        }
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
