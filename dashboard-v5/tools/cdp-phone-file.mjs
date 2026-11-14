// CDP scenarios for Settings > Reach > the phone file row (batch 6, dish phone-file). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makePhoneFileScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario phone-file-off-by-default,phone-file-pick-and-clear   (needs --preload=fake)
//
// The row comes from the fake hq.reach.read (tools/fake-preload.js REACH_ROWS gains one 'brief-file' row, OFF) and the buttons call hq.reach.briefFile(action).
// Each scenario serves its own PLACEHOLDER rows with hqFake.set(...) (built by dashboard/brief-file-core.mjs briefFileRow, the same function main uses),
// keeps the folder state in the page (window.__pf) so it does not depend on how the fake logs an overridden method, and ends with hqFake.reset(true)
// and Settings closed. The row is found by its buttons ("Pick folder"), not by a label, so a label change in vals/reach.js cannot break the scenario.
//
//   phone-file-off-by-default   Reach shows the row off with a Pick folder button; opening Settings only READS (reach.read), the fake briefFile is not called
//   phone-file-pick-and-clear   Pick folder: briefFile('pick') reaches main once, the row shows the folder's last segment and a "last written" time;
//                               Turn off: briefFile('clear') once and the row returns to off; the full path is never in the DOM

import { briefFileRow } from '../../dashboard/brief-file-core.mjs';

const SEC = `document.querySelector('section[aria-label="Reach: which doors to the assistant are open"]')`;
const ROW = `(() => { const s = ${SEC}; return s ? [...s.querySelectorAll('[role="listitem"]')].find((li) => [...li.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Pick folder')) || null : null; })()`;
const BTN = (label) => `(() => { const r = ${ROW}; return r ? [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}) || null : null; })()`;

export const PLACEHOLDER_FOLDER = 'Phone Notes';                    // the last segment only: the fake never knows a full path
export const PLACEHOLDER_PATH_RE = 'placeholder-sync-root|[A-Za-z]:\\\\';   // what must never be in the DOM: the invented parent folder, and any drive-letter path
const AT = new Date(2026, 10, 14, 9, 41);                          // the fake "last written": 09:41 local, the page clock is set to the same day

// the two row states main would answer, from the real builder (so the scenario fails if the wording stops saying the folder and the time)
export const ROW_OFF = briefFileRow({ state: null }, AT);
export const ROW_ON = briefFileRow({ state: { v: 1, folder: 'C:\\placeholder-sync-root\\' + PLACEHOLDER_FOLDER, lastWriteAt: AT.toISOString(), lastError: null } }, AT);

const OTHER_ROWS = [
  { id: 'phone-door', ok: false, detail: 'not running since boot at 08:12', step: 'start remote control in a terminal', who: 'owner', copy: 'claude remote-control' },
  { id: 'user-scope', ok: true, detail: 'workspacehq is registered for every session', who: 'owner' },
];

export const PAGE = Object.freeze({
  section: SEC,
  row: ROW,
  hasRow: `!!${ROW}`,
  rowText: `(() => { const r = ${ROW}; return r ? r.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
  button: BTN,
  hasButton: (label) => `!!${BTN(label)}`,
  click: (label) => `(() => { const b = ${BTN(label)}; if (!b) return false; b.click(); return true; })()`,
  bodyText: `document.body.innerText`,
  bodyHtml: `document.body.innerHTML`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).length`,
  pageCalls: `(window.__pf ? window.__pf.actions.slice() : [])`,
  reads: `(window.__pf ? window.__pf.reads : 0)`,
  // serve: reach.read answers the other rows plus the brief-file row for the CURRENT page state; briefFile pick/clear move that state
  serve: (rows) => `(() => {
    window.__pf = { folder: null, reads: 0, actions: [] };
    const rowOff = ${JSON.stringify(rows.off)}, rowOn = ${JSON.stringify(rows.on)}, others = ${JSON.stringify(OTHER_ROWS)};
    hqFake.set('reach.read', () => { window.__pf.reads++; return { at: new Date().toISOString(), rows: others.concat([window.__pf.folder ? rowOn : rowOff]) }; });
    hqFake.set('reach.briefFile', (action) => {
      window.__pf.actions.push(action);
      if (action === 'pick') { window.__pf.folder = ${JSON.stringify(PLACEHOLDER_FOLDER)}; return { ok: true, folderName: window.__pf.folder, written: true }; }
      if (action === 'clear') { const had = !!window.__pf.folder; window.__pf.folder = null; return { ok: true, folderName: null, fileLeft: had, note: 'Turned off.' }; }
      return { error: 'Unknown action' };
    });
    return true;
  })()`,
  open: `(() => { const L = WHQ.app.logic; if (L.rchRearm) L.rchRearm(); L.setState({ rchRows: null, rchError: '', rchAt: null, rchBusy: false, toasts: [], settingsOpen: true }); return true; })()`,
  reset: `(() => { const L = WHQ.app.logic; hqFake.reset(true); if (L.rchRearm) L.rchRearm(); L.setState({ settingsOpen: false, rchRows: null, rchError: '', rchAt: null, rchBusy: false, toasts: [] }); delete window.__pf; return true; })()`,
});

export const ROWS = Object.freeze({ off: ROW_OFF, on: ROW_ON });

export function makePhoneFileScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const noPath = (out, text, where) => { if (new RegExp(PLACEHOLDER_PATH_RE).test(String(text))) out.push('a full path reached ' + where); };
  return {
    async 'phone-file-off-by-default'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.serve(ROWS));
        await t.evaluate(PAGE.open);
        if (!await t.waitFor(PAGE.hasRow, 8000)) return out.concat('Reach never showed the phone file row with a Pick folder button: ' + String(await t.evaluate(`(() => { const s = ${SEC}; return s ? s.textContent.replace(/\\s+/g, ' ').slice(0, 300) : 'no Reach section'; })()`)));
        const text = String(await t.evaluate(PAGE.rowText));
        if (!/off/i.test(text)) out.push('the row does not say it is off: ' + text.slice(0, 200));
        if (!text.includes('Pick a folder you already sync to your phone')) out.push('the row lacks its one missing step: ' + text.slice(0, 200));
        if (/undefined|\[object|NaN/.test(text)) out.push('an unresolved binding reached the row');
        noPath(out, text, 'the row');
        await pause(150);
        if ((await t.evaluate(PAGE.reads)) < 1) out.push('opening Settings never read the Reach rows');
        if ((await t.evaluate(PAGE.pageCalls)).length !== 0) out.push('briefFile was called just by looking: ' + JSON.stringify(await t.evaluate(PAGE.pageCalls)));
        if ((await t.evaluate(PAGE.calls('reach.briefFile'))) !== 0) out.push('the fake logged a briefFile call just by looking');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'phone-file-pick-and-clear'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.serve(ROWS));
        await t.evaluate(PAGE.open);
        if (!await t.waitFor(PAGE.hasRow, 8000)) return out.concat('Reach never showed the phone file row: ' + String(await t.evaluate(PAGE.bodyText)).slice(0, 200));
        // 1. Pick folder: one call, the row names the folder and the time, never the path
        if (!await t.evaluate(PAGE.click('Pick folder'))) return out.concat('the Pick folder button could not be clicked');
        if (!await t.waitFor(`${PAGE.rowText}.includes(${JSON.stringify(PLACEHOLDER_FOLDER)})`, 6000)) return out.concat('after Pick folder the row never showed the folder: ' + String(await t.evaluate(PAGE.rowText)).slice(0, 220));
        const on = String(await t.evaluate(PAGE.rowText));
        if (!on.includes('last written 09:41')) out.push('the row lacks "last written 09:41": ' + on.slice(0, 220));
        noPath(out, on, 'the row after Pick');
        const picks = await t.evaluate(PAGE.pageCalls);
        if (JSON.stringify(picks) !== JSON.stringify(['pick'])) out.push('Pick folder sent ' + JSON.stringify(picks) + ', want exactly ["pick"]');
        if (!await t.evaluate(PAGE.hasButton('Turn off'))) out.push('the row has no Turn off button once a folder is set');
        // 2. Turn off: one clear, the row is off again, the folder's name is gone
        await t.evaluate(PAGE.click('Turn off'));
        if (!await t.waitFor(`!${PAGE.rowText}.includes(${JSON.stringify(PLACEHOLDER_FOLDER)}) && ${PAGE.hasRow}`, 6000)) return out.concat('after Turn off the row still names the folder: ' + String(await t.evaluate(PAGE.rowText)).slice(0, 220));
        await pause(150);
        const off = String(await t.evaluate(PAGE.rowText));
        if (!/off/i.test(off)) out.push('the row does not say off after Turn off: ' + off.slice(0, 200));
        const all = await t.evaluate(PAGE.pageCalls);
        if (JSON.stringify(all) !== JSON.stringify(['pick', 'clear'])) out.push('the calls were ' + JSON.stringify(all) + ', want ["pick","clear"]');
        // 3. the full path was never anywhere in the page
        noPath(out, await t.evaluate(PAGE.bodyHtml), 'the page');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
