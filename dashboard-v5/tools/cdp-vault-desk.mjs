// CDP scenarios for Life > Notes > the Vault desk (today's daily note read-only and one capture line). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeVaultDeskScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario vault-desk-read,vault-desk-capture,vault-desk-missing-note,vault-desk-open   (needs --preload=fake)
//
// The fake preload answers hq.vaultDesk.read with an invented vault ("Example Vault", one note for 2026-11-16, twelve recent names) and
// hq.vaultDesk.capture by appending to that note in memory. sessionStorage "hqFake:vaultDesk" picks a state: no-folder, no-note, error, refuse
// (a capture is refused in main's words), no-open (the scan does not list the vault). The real file work is pinned in dashboard/vault-desk.test.mjs,
// where main's own code runs on a temp vault. Each scenario ends with hqFake.reset(true), the state back to its default and the page on Home.
//
//   vault-desk-read          Life > Notes reads once on arrival (never before), shows today's note as text, says which folder it looked in, lists twelve recent names, sends one open mark
//   vault-desk-capture       a typed line and Enter calls hq.vaultDesk.capture with that line only, clears the box, shows the line in the note and sends exactly ONE act mark; a refused capture keeps the line and marks nothing
//   vault-desk-missing-note  no note and no folder say so in words, the box is off and no capture reaches main
//   vault-desk-open          Open in Obsidian calls the existing hq.vaultOpen with the vault name and "open"; it is not offered when the scan does not list the vault

const VIEW = `document.querySelector('[data-vdk="view"]')`;
export const PAGE = Object.freeze({
  view: VIEW,
  text: `(${VIEW} ? ${VIEW}.textContent.replace(/\\s+/g, ' ') : '')`,
  note: `(() => { const n = document.querySelector('[data-vdk="note"]'); return n ? n.textContent : null; })()`,
  recent: `[...document.querySelectorAll('[data-vdk="recent-row"]')].map((r) => r.textContent.trim())`,
  where: `(() => { const n = document.querySelector('[data-vdk="where"]'); return n ? n.textContent : ''; })()`,
  button: (kind) => `document.querySelector('[data-vdk="${kind}"]')`,
  lineValue: `(() => { const i = document.querySelector('[data-vdk="line"]'); return i ? i.value : null; })()`,
  lineDisabled: `(() => { const i = document.querySelector('[data-vdk="line"]'); return i ? !!i.disabled : null; })()`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).length`,
  callArgs: (method) => `hqFake.calls(${JSON.stringify(method)}).map((c) => c.args)`,
  marks: (surface, action) => `hqFake.calls('use').filter((c) => c.args[0] === ${JSON.stringify(surface)} && c.args[1] === ${JSON.stringify(action)}).length`,
  mode: (m) => `(() => { try { sessionStorage.setItem('hqFake:vaultDesk', ${JSON.stringify(m)}); } catch (e) {} return true; })()`,
  type: (text) => `(() => { const i = document.querySelector('[data-vdk="line"]'); if (!i) return false; i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
  enter: `(() => { const i = document.querySelector('[data-vdk="line"]'); if (!i) return false; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`,
  go: `(() => { WHQ.app.logic.go('life', 'notes'); return true; })()`,
  goOther: `(() => { WHQ.app.logic.go('life', 'screen'); return true; })()`,
  reset: `(() => { try { sessionStorage.removeItem('hqFake:vaultDesk'); } catch (e) {} hqFake.reset(true); const L = WHQ.app.logic; L._vdkBusy = false; L._vdkSending = false; L._useOnce = null; L.setState({ vdk: null, toasts: [], route: null }); L.go('home'); return true; })()`,
});

export function makeVaultDeskScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  return {
    async 'vault-desk-read'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.goOther);
        await pause(200);
        if (await t.evaluate(PAGE.calls('vaultDesk.read')) !== 0) out.push('the desk was read before the owner opened Life > Notes');
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`${PAGE.note} !== null && ${PAGE.note}.includes('slept well')`, 6000)) return out.concat('Life > Notes never showed today\'s note: ' + (await t.evaluate(PAGE.text)).slice(0, 220));
        if (await t.evaluate(PAGE.calls('vaultDesk.read')) !== 1) out.push('the desk was read ' + await t.evaluate(PAGE.calls('vaultDesk.read')) + ' times on arrival, want exactly 1');
        if (await t.evaluate(PAGE.marks('vault-desk', 'open')) !== 1) out.push('arriving sent ' + await t.evaluate(PAGE.marks('vault-desk', 'open')) + ' open marks, want 1');
        const where = await t.evaluate(PAGE.where);
        if (!/10_Daily/.test(where) || !/from the vault’s daily notes settings/.test(where)) out.push('the card does not say which folder it looked in: ' + where);
        const recent = await t.evaluate(PAGE.recent);
        if (recent.length !== 12) out.push('the recent notes are ' + recent.length + ', want 12');
        if (recent.some((n) => /\.md$/.test(n))) out.push('a recent name still has .md: ' + JSON.stringify(recent.slice(0, 3)));
        if (/undefined|\[object|NaN/.test(await t.evaluate(PAGE.text))) out.push('an unresolved binding reached the Vault desk text');
        if (await t.evaluate(`document.querySelectorAll('[data-vdk="note"] b, [data-vdk="note"] img, [data-vdk="note"] script').length`) !== 0) out.push('the note was rendered as markup, not as text');
        if (!(await t.evaluate(PAGE.note)).includes('<b>not bold</b>')) out.push('the angle brackets in the note did not show as text');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'vault-desk-capture'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`!!${PAGE.button('line')} && ${PAGE.lineDisabled} === false`, 6000)) return out.concat('the capture box never opened: ' + (await t.evaluate(PAGE.text)).slice(0, 200));
        await t.evaluate(PAGE.type('call the plumber'));
        await t.evaluate(PAGE.enter);
        if (!await t.waitFor(`${PAGE.calls('vaultDesk.capture')} === 1`, 3000)) return out.concat('Enter did not call hq.vaultDesk.capture');
        const args = await t.evaluate(PAGE.callArgs('vaultDesk.capture'));
        if (JSON.stringify(args) !== JSON.stringify([['call the plumber']])) out.push('hq.vaultDesk.capture was called with ' + JSON.stringify(args) + ', want only the line');
        if (!await t.waitFor(`${PAGE.note}.includes('- call the plumber')`, 4000)) out.push('the note on screen did not show the new line');
        if (await t.evaluate(PAGE.lineValue) !== '') out.push('the box was not cleared: ' + await t.evaluate(PAGE.lineValue));
        if (await t.evaluate(PAGE.marks('vault-desk-capture', 'act')) !== 1) out.push('a capture sent ' + await t.evaluate(PAGE.marks('vault-desk-capture', 'act')) + ' act marks, want 1');
        // a refused capture keeps the line, says why and marks nothing
        await t.evaluate(PAGE.mode('refuse'));
        await t.evaluate(PAGE.type('a refused line'));
        await t.evaluate(`${PAGE.button('send')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('vaultDesk.capture')} === 2`, 3000)) out.push('the Add button did not reach main');
        await pause(200);
        const toast = await t.evaluate(`JSON.stringify(WHQ.app.logic.state.toasts || [])`);
        if (!/not a plain file/.test(toast)) out.push('a refusal did not say why: ' + toast.slice(0, 160));
        if (await t.evaluate(PAGE.lineValue) !== 'a refused line') out.push('a refused line was not kept in the box');
        if (await t.evaluate(PAGE.marks('vault-desk-capture', 'act')) !== 1) out.push('a refused capture changed the act mark count to ' + await t.evaluate(PAGE.marks('vault-desk-capture', 'act')));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'vault-desk-missing-note'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        for (const [mode, words] of [['no-note', /no note for today yet/], ['no-folder', /not in the vault/]]) {
          await t.evaluate(PAGE.reset);
          await t.evaluate(PAGE.mode(mode));
          await t.evaluate(PAGE.go);
          if (!await t.waitFor(`!!document.querySelector('[data-vdk="state"]')`, 6000)) { out.push(mode + ': the card never said what is missing: ' + (await t.evaluate(PAGE.text)).slice(0, 200)); continue; }
          const txt = await t.evaluate(`document.querySelector('[data-vdk="state"]').textContent`);
          if (!words.test(txt)) out.push(mode + ': the words were ' + txt);
          if (await t.evaluate(PAGE.lineDisabled) !== true) out.push(mode + ': the capture box is open although there is no note to add to');
          if (await t.evaluate(`!!${PAGE.button('send')} && !${PAGE.button('send')}.disabled`)) out.push(mode + ': the Add button is on');
          if (await t.evaluate(PAGE.note) !== null) out.push(mode + ': a note area is shown with nothing to read');
          await t.evaluate(PAGE.enter);
          await pause(150);
          if (await t.evaluate(PAGE.calls('vaultDesk.capture')) !== 0) out.push(mode + ': a capture reached main');
        }
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'vault-desk-open'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`!!${PAGE.button('open')}`, 6000)) return out.concat('Open in Obsidian was not offered for a vault the scan lists');
        await t.evaluate(`${PAGE.button('open')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('vaultOpen')} >= 1`, 3000)) return out.concat('Open in Obsidian did not call hq.vaultOpen');
        const args = await t.evaluate(PAGE.callArgs('vaultOpen'));
        if (JSON.stringify(args.at(-1)) !== JSON.stringify(['Example Vault', 'open'])) out.push('hq.vaultOpen was called with ' + JSON.stringify(args.at(-1)));
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.mode('no-open'));
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`${PAGE.note} !== null`, 6000)) return out.concat('the note never showed in the no-open state');
        if (await t.evaluate(`!!${PAGE.button('open')}`)) out.push('Open in Obsidian was offered for a vault the scan does not list');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
