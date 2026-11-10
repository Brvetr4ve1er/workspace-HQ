// CDP scenarios for Projects > Clients (the list of client jobs). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeClientsListScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario clients-list-open,clients-list-open-card,clients-list-empty   (needs --preload=fake)
//
// The fake preload answers hq.delivery.clients from the same small stand-in as the delivery card (tools/fake-preload.js, DLV.clients): three invented
// client jobs (a half-done checklist kept in the app, a checklist file with a production link, a job with no scope yet) and one marked job the latest
// scan no longer lists. A scenario that needs other rows sets them with hqFake.set('delivery.clients', ...); each one ends with hqFake.reset(true).
//
//   clients-list-open        Projects > Clients shows the four rows in the pinned order (most left, oldest update, name; the one gone from the scan last)
//   clients-list-open-card   Open card on a row lands on that project's page, at the delivery card
//   clients-list-empty       no client marked: the honest line, and no row; a service error says so with a Retry that works

const LIST = `document.querySelector('[data-cls="list"]')`;
export const PAGE = Object.freeze({
  list: LIST,
  text: `(${LIST} ? ${LIST}.textContent.replace(/\\s+/g, ' ') : '')`,
  rows: `[...document.querySelectorAll('[data-cls="row"]')]`,
  rowNames: `[...document.querySelectorAll('[data-cls="row"]')].map((r) => r.querySelector('span').textContent.trim())`,
  button: (label) => `[...(${LIST} ? ${LIST}.querySelectorAll('button') : [])].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).length`,
  go: `(() => { WHQ.app.logic.go('projects', 'clients'); return true; })()`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L._clsBusy = false; L.setState({ cls: null, toasts: [], route: null }); L.go('home'); return true; })()`,
});

export const ORDER = Object.freeze(['Alpha Site', 'Beta App', 'Delta Lib', 'ghost-job']);

export function makeClientsListScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  return {
    async 'clients-list-open'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        const before = await t.evaluate(PAGE.calls('delivery.clients'));
        if (before !== 0) out.push('the list was read before the owner opened it (' + before + ' calls)');
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`${PAGE.rows}.length === 4`, 6000)) return out.concat('Projects > Clients never showed four rows: ' + (await t.evaluate(PAGE.text)).slice(0, 220));
        const names = await t.evaluate(PAGE.rowNames);
        if (JSON.stringify(names) !== JSON.stringify(ORDER)) out.push('row order ' + JSON.stringify(names) + ', want ' + JSON.stringify(ORDER));
        const txt = await t.evaluate(PAGE.text);
        for (const w of ['4 client jobs', '2 with work left', '1 not in the latest scan', '1 of 3 done', '2 of 4 done', 'no scope yet', 'link ready · production', 'link ready · preview', 'no link yet', 'never copied', 'last copied 2 days ago']) {
          if (!txt.includes(w)) out.push('the list lacks "' + w + '": ' + txt.slice(0, 300));
        }
        const openBtns = await t.evaluate(`${PAGE.rows}.map((r) => !!r.querySelector('button'))`);
        if (JSON.stringify(openBtns) !== JSON.stringify([true, true, true, false])) out.push('Open card buttons ' + JSON.stringify(openBtns) + ', want one per row but the one gone from the scan');
        const calls = await t.evaluate(PAGE.calls('delivery.clients'));
        if (calls !== 1) out.push('the list was read ' + calls + ' times on arrival, want exactly 1');
        if (/undefined|\[object|NaN/.test(txt)) out.push('an unresolved binding reached the list text');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'clients-list-open-card'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        // a client job whose id is the first project of the page's own data, so Open card has a page to land on
        const pid = await t.evaluate(`(() => { const p = WHQ.app.logic.M.P0[0]; if (!p) return ''; hqFake.set('delivery.clients', { clients: [{ id: p.id, name: 'Acme Studio', mode: 'client', done: 1, total: 3, linkState: 'ready-production', lastCopyAt: null, fileState: null, inScan: true }], generatedAt: new Date().toISOString(), omitted: 0 }); return p.id; })()`);
        if (!pid) return ['the page data has no project to open'];
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`${PAGE.rows}.length === 1`, 6000)) return out.concat('the Clients list never showed its row');
        if (!await t.waitFor('!!' + PAGE.button('Open card'), 2000)) return out.concat('the row has no Open card button');
        await t.evaluate(`${PAGE.button('Open card')}.click()`);
        if (!await t.waitFor(`!!document.querySelector('[data-dlv="card"]')`, 6000)) return out.concat('Open card did not land on the project page with the delivery card');
        const route = await t.evaluate(`JSON.stringify(WHQ.app.logic.state.route)`);
        if (!route.includes(pid)) out.push('the route after Open card is ' + route + ', want the project ' + pid);
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'clients-list-empty'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(`hqFake.set('delivery.clients', { clients: [], generatedAt: new Date().toISOString(), omitted: 0 })`);
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`${PAGE.text}.includes('No client jobs yet. Mark one on a project page.')`, 6000)) return out.concat('the empty list does not say so: ' + (await t.evaluate(PAGE.text)).slice(0, 220));
        if (await t.evaluate(`${PAGE.rows}.length`)) out.push('rows show with no client marked');
        // the delivery service not answering: told apart from "no clients", with a button that reads again and recovers
        await t.evaluate(`hqFake.set('delivery.clients', { error: 'the delivery service did not answer' })`);
        await t.evaluate(`${PAGE.button('Refresh')}.click()`);
        if (!await t.waitFor(`${PAGE.text}.includes('the delivery service did not answer')`, 4000)) return out.concat('a service error was not shown');
        await t.evaluate(`hqFake.set('delivery.clients', { clients: [{ id: 'c-1', name: 'Acme Studio', mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt: null, fileState: null, inScan: true }], generatedAt: new Date().toISOString(), omitted: 0 })`);
        await pause(50);
        if (!await t.waitFor('!!' + PAGE.button('Refresh') + ' || !!' + PAGE.button('Retry'), 2000)) out.push('no Retry / Refresh button after an error');
        await t.evaluate(`(${PAGE.button('Retry')} || ${PAGE.button('Refresh')}).click()`);
        if (!await t.waitFor(`${PAGE.rows}.length === 1`, 4000)) out.push('Retry did not bring the list back');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
