// CDP scenarios for Settings > "Claude sessions may read Money (words only)". cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeMoneyAccessScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario money-access-off-by-default,money-access-toggle   (needs --preload=fake)
//
// The fake preload answers hq.moneyAccess.read with { on:false, lastAskedAt:null } on every fresh start and hq.moneyAccess.set(on) with { on }
// (a non-boolean is refused like main does); each scenario ends with hqFake.reset(true) and Settings closed.
//
//   money-access-off-by-default   Settings shows the card OFF, the explanation (what it does, what it never shows, where the words travel), "last asked: never";
//                                 opening Settings read the switch exactly once and nothing was written
//   money-access-toggle           click: set(true) reaches main once and the card says On; click again: set(false) and Off

const SWITCH = `document.querySelector('button[role="switch"][aria-label^="Claude sessions may read Money"]')`;
const SEC = `document.querySelector('section[aria-label="Money for Claude sessions"]')`;
export const PAGE = Object.freeze({
  switchEl: SWITCH,
  section: SEC,
  text: `(${SEC} ? ${SEC}.textContent.replace(/\\s+/g, ' ') : '')`,
  checked: `(${SWITCH} ? ${SWITCH}.getAttribute('aria-checked') : null)`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).length`,
  open: `(() => { const L = WHQ.app.logic; hqFake.reset(true); L._macAsked = false; L.setState({ macLoaded: false, macOn: false, macAskedAt: null, macBusy: false, macErr: '', settingsOpen: true }); return true; })()`,
  reset: `(() => { const L = WHQ.app.logic; hqFake.reset(true); L._macAsked = false; L._macSetting = false; L.setState({ settingsOpen: false, macLoaded: false, macOn: false, macAskedAt: null, macBusy: false, macErr: '', toasts: [] }); return true; })()`,
});

export const WANT_TEXT = Object.freeze([
  'Claude sessions may read Money (words only)',
  'whether Money is set up, whether the cycle is ok or tight, how many days to payday',
  'They never see amounts, names, accounts or notes',
  'travel in Claude’s transcripts and in the Claude Hub’s local index',
  'last asked: never',
]);

export function makeMoneyAccessScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  return {
    async 'money-access-off-by-default'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.open);
        if (!await t.waitFor(`!!${SWITCH} && !${SWITCH}.disabled`, 6000)) return out.concat('Settings never showed an enabled Money-access switch: ' + String(await t.evaluate(PAGE.text)).slice(0, 220));
        if ((await t.evaluate(PAGE.checked)) !== 'false') out.push('the switch is not OFF on a fresh start (aria-checked ' + (await t.evaluate(PAGE.checked)) + ')');
        const txt = String(await t.evaluate(PAGE.text));
        for (const w of WANT_TEXT) if (!txt.includes(w)) out.push('the card lacks "' + w + '": ' + txt.slice(0, 300));
        if (!/\bOff\b/.test(txt)) out.push('the card never says Off in words');
        if (/undefined|\[object|NaN/.test(txt)) out.push('an unresolved binding reached the card text');
        const reads = await t.evaluate(PAGE.calls('moneyAccess.read'));
        if (reads !== 1) out.push('opening Settings read the switch ' + reads + ' times, want exactly 1');
        if (await t.evaluate(PAGE.calls('moneyAccess.set'))) out.push('something was written just by opening Settings');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'money-access-toggle'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.open);
        if (!await t.waitFor(`!!${SWITCH} && !${SWITCH}.disabled`, 6000)) return out.concat('the switch never became usable');
        await t.evaluate(`${SWITCH}.click()`);
        if (!await t.waitFor(`${PAGE.checked} === 'true'`, 4000)) return out.concat('turning it on never showed On (aria-checked ' + (await t.evaluate(PAGE.checked)) + ')');
        let sets = await t.evaluate(`hqFake.calls('moneyAccess.set').map((c) => c.args)`);
        if (JSON.stringify(sets) !== JSON.stringify([[true]])) out.push('turning on sent ' + JSON.stringify(sets) + ', want one set(true)');
        if (!String(await t.evaluate(PAGE.text)).includes('On')) out.push('the card never says On in words');
        await pause(60);
        await t.evaluate(`${SWITCH}.click()`);
        if (!await t.waitFor(`${PAGE.checked} === 'false'`, 4000)) return out.concat('turning it off never showed Off');
        sets = await t.evaluate(`hqFake.calls('moneyAccess.set').map((c) => c.args)`);
        if (JSON.stringify(sets) !== JSON.stringify([[true], [false]])) out.push('the two clicks sent ' + JSON.stringify(sets) + ', want set(true) then set(false)');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
