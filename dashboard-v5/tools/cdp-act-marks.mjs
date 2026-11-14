// CDP scenario for the act marks (batch 6, dish act-marks). cdp-gate.mjs merges it:
//   Object.assign(SCENARIOS, makeActMarksScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario use-act-marks     (needs --preload=fake)
//
//   use-act-marks   the fake's hq.use records every call. Dismiss, a Brief row button, a Cosmos favourite and a Save to vault each add exactly ONE
//                   ('<surface>','act') call; a second Dismiss on the same screen adds another (acts are per click, not per arrival); and opening the
//                   same screen twice still adds ONE 'open'. No act mark from any other surface appears.
//                   Ends with hqFake.reset(true), Cosmos and the vault dialog closed, Home shown.

export const SURFACES = Object.freeze(['brief-panel', 'cosmos', 'claude-vault']);

const BRIEF_SEC = `document.querySelector('section[aria-label="Brief: what needs you now"]')`;
const ROWS = `[...((${BRIEF_SEC} || document.createElement('div')).querySelectorAll('[role="listitem"]'))]`;
export const PAGE = Object.freeze({
  rows: ROWS,
  // the row's own action button (not Dismiss / Mark done), or its Dismiss button
  rowButton: (i) => `(() => { const it = ${ROWS}[${Number(i)}]; const b = it && [...it.querySelectorAll('button')].find((x) => !x.disabled && x.textContent.trim() !== 'Dismiss' && x.textContent.trim() !== 'Mark done'); if (!b) return false; b.click(); return true; })()`,
  dismissButton: (i) => `(() => { const it = ${ROWS}[${Number(i)}]; const b = it && [...it.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Dismiss'); if (!b || b.disabled) return false; b.click(); return true; })()`,
  marks: (surface, action) => `hqFake.calls('use').filter((c) => c.args[0] === ${JSON.stringify(surface)} && c.args[1] === ${JSON.stringify(action)}).length`,
  allMarks: `hqFake.calls('use').map((c) => c.args.join('/'))`,
  toHome: `(() => { const L = WHQ.app.logic; L.go('system'); return true; })()`,
  armBrief: `(() => { const L = WHQ.app.logic; hqFake.reset(); L.setState({ brfBusy: false, toasts: [] }); L._brfBusy = false; L.store.refreshBrief(); L.go('home'); return true; })()`,
  cosmosCards: `[...document.querySelectorAll('[data-cos-card]')].map((b) => b.getAttribute('data-id'))`,
  goCosmos: `(() => { WHQ.app.logic.go('cosmos'); return true; })()`,
  favorite: (id) => `(async () => { const r = await WHQ.app.logic.cosFavorite(${JSON.stringify(id)}); return r === true; })()`,
  readyVault: `(() => { WHQ.app.logic.setState({ vault: { id: 'code:fake-1', phase: 'ready', path: 'C:\\\\fake-vault\\\\x.md', rel: 'x.md', draft: '# placeholder note', exists: false, drafted: 'model', modelUnavailable: false, askReplace: false, saveError: null } }); return true; })()`,
  saveVault: `(async () => { await WHQ.app.logic.saveVault(); return WHQ.app.logic.state.vault && WHQ.app.logic.state.vault.phase; })()`,
  reset: `(() => { const L = WHQ.app.logic; hqFake.reset(true); L.closeVault(); L.setState({ brfBusy: false, toasts: [] }); L._brfBusy = false; L.go('home'); return true; })()`,
});

export function makeActMarksScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  return {
    async 'use-act-marks'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.toHome); await pause(150);                    // leave Home first, so the next arrival is a new one
        await t.evaluate(PAGE.armBrief);
        if (!await t.waitFor(`${PAGE.rows}.length === 3`, 8000)) return out.concat('the Brief never rendered the fixture’s 3 items');
        await pause(300);
        const was = await t.evaluate(PAGE.marks('brief-panel', 'open'));
        if (was !== 1) out.push('arriving on Home sent ' + was + ' brief-panel open mark(s), want 1');
        const n = async (surface, action) => t.evaluate(PAGE.marks(surface, action));

        // Dismiss: one act per click that took effect, and a second Dismiss on the same screen is a second act
        if (!await t.evaluate(PAGE.dismissButton(0))) return out.concat('row 1 has no Dismiss button');
        if (!await t.waitFor(`${PAGE.marks('brief-panel', 'act')} === 1`, 3000)) out.push('Dismiss added ' + await n('brief-panel', 'act') + ' act mark(s), want 1');
        await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ brfBusy: false }); L._brfBusy = false; return true; })()`);
        if (!await t.waitFor(`${PAGE.rows}.length === 2`, 3000)) out.push('the panel did not drop the dismissed row');
        if (!await t.evaluate(PAGE.dismissButton(0))) out.push('no second row to dismiss');
        else if (!await t.waitFor(`${PAGE.marks('brief-panel', 'act')} === 2`, 3000)) out.push('a second Dismiss on the same screen made ' + await n('brief-panel', 'act') + ' act mark(s) in all, want 2');
        if (await n('brief-panel', 'open') !== 1) out.push('Dismiss changed the Brief open count to ' + await n('brief-panel', 'open'));

        // the Brief row's own button (it goes somewhere, so it comes last on Home)
        await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ brfBusy: false }); L._brfBusy = false; L.store.refreshBrief(); return true; })()`);
        await t.waitFor(`${PAGE.rows}.length >= 1`, 4000);
        if (!await t.evaluate(PAGE.rowButton(0))) out.push('no Brief row button to click');
        else if (!await t.waitFor(`${PAGE.marks('brief-panel', 'act')} === 3`, 3000)) out.push('a Brief row button made ' + await n('brief-panel', 'act') + ' act mark(s) in all, want 3');

        // Cosmos favourite: one act; the arrival is one open even when the screen is asked for twice
        await t.evaluate(PAGE.goCosmos); await pause(200);
        await t.evaluate(PAGE.goCosmos); await pause(300);
        if (!await t.waitFor(`${PAGE.cosmosCards}.length >= 1`, 8000)) out.push('the Cosmos Feed showed no card');
        else {
          if (await n('cosmos', 'open') !== 1) out.push('asking for Cosmos twice sent ' + await n('cosmos', 'open') + ' cosmos open mark(s), want 1');
          const id = (await t.evaluate(PAGE.cosmosCards))[0];
          if (!await t.evaluate(PAGE.favorite(id))) out.push('the favourite was not accepted');
          else if (!await t.waitFor(`${PAGE.marks('cosmos', 'act')} === 1`, 3000)) out.push('a Cosmos favourite made ' + await n('cosmos', 'act') + ' act mark(s), want 1');
        }

        // Save to vault: one act
        await t.evaluate(PAGE.readyVault);
        const phase = await t.evaluate(PAGE.saveVault);
        if (phase !== 'saved') out.push('Save to vault ended in phase ' + JSON.stringify(phase) + ', want "saved"');
        if (await n('claude-vault', 'act') !== 1) out.push('Save to vault made ' + await n('claude-vault', 'act') + ' act mark(s), want 1');

        // no act mark from any other surface (the Home panels' own opens are not this scenario's business)
        const odd = (await t.evaluate(PAGE.allMarks)).filter((m) => m.endsWith('/act') && !SURFACES.some((s) => m.startsWith(s + '/')));
        if (odd.length) out.push('unexpected act marks: ' + JSON.stringify(odd));
      } finally { await leave(t); }
      return out.concat(t.errors());
    },
  };
}
