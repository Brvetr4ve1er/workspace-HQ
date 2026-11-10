// CDP scenarios for the client delivery check (project page, under the delivery card). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeDeliveryCheckScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario delivery-check-nothing-answering,delivery-check-run,...   (needs --preload=fake)
//
// The fake preload answers hq.deliveryCheck from a small stand-in (tools/fake-preload.js, DCK): the project "alpha-site" has a dev server
// "answering" at a placeholder address, every other project answers nothing; run keeps one fixed report per project; forget clears it.
// The scenarios open the first project of the page's own data and make its delivery view a client job (hqFake.set), so the block shows.
//
//   delivery-check-nothing-answering   the honest state: nothing answered, the type-an-address field is there, Check is off until an address is typed
//   delivery-check-run                 detect -> the field is prefilled -> Check -> the report (findings, heuristics labelled, the blocked line); a public address is refused
//   delivery-check-forget              Forget results clears the report, tells main once, and the next read is empty
//   delivery-check-button-sweep        every button in the block once: none throws, none is unlabelled, each does something

const CARD = `document.querySelector('[data-dck="card"]')`;
export const PAGE = Object.freeze({
  card: CARD,
  text: `(${CARD} ? ${CARD}.textContent.replace(/\\s+/g, ' ') : '')`,
  button: (label) => `[...(${CARD} ? ${CARD}.querySelectorAll('button') : [])].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`,
  input: `(${CARD} ? ${CARD}.querySelector('input[aria-label="Dev server address on this PC"]') : null)`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).map((c) => c.args)`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L._dckBusy = false; L._dlvBusy = false; WHQ.store.live.delivery = { byProject: {}, error: '', loaded: false }; L.setState({ dck: undefined, dlv: {}, dlvBusy: false, toasts: [], route: null }); return true; })()`,
  // the first project of the page's own data on its page, as a client job; resolves its id ('' when the data has none)
  open: (view) => `(() => { const L = WHQ.app.logic, p = L.M.P0[0]; if (!p) return ''; const v = Object.assign({}, ${JSON.stringify(view)}, { projectId: p.id }); hqFake.set('delivery.read', v); WHQ.store.live.delivery = { byProject: {}, error: '', loaded: false }; L.setState({ dck: undefined, dlv: {}, dlvBusy: false, toasts: [] }); L.go('projects', 'grid'); L.openProject(p.id); return p.id; })()`,
});

export const CLIENT_VIEW = Object.freeze({
  client: true, mode: 'client', source: 'app', scopeFile: null, sourceLabel: 'a checklist kept in WorkspaceHQ', sourceNote: '', fileState: null, fileDetail: null,
  candidates: [], walkTruncated: false, walkError: null,
  milestones: [{ name: 'Design', done: 1, total: 2, items: [{ id: 'i-1', text: 'Home page', done: true }, { id: 'i-2', text: 'Gallery', done: false }] }],
  done: 1, total: 2, summary: '1 of 2 done', doneSince: [], link: null, linkWhy: 'No Vercel project linked to this repo', update: '', lastCopyAt: null,
});
export const READY = Object.freeze({ state: 'ready', startedHere: false, candidates: [{ origin: 'http://127.0.0.1:5173', title: 'Acme Studio' }], hasCommand: true });

export function makeDeliveryCheckScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  async function open(t, { ready }) {
    await t.evaluate(PAGE.reset);
    if (ready) await t.evaluate(`hqFake.set('deliveryCheck.detect', ${JSON.stringify(READY)})`);
    const pid = await t.evaluate(PAGE.open(CLIENT_VIEW));
    if (!pid) return '';
    // the block shows once the delivery card says client; the arrival probe settles into ready / nothing
    if (!await t.waitFor(`!!${PAGE.card} && !${PAGE.text}.includes('Looking on the usual') && !${PAGE.text}.includes('Not looked yet')`, 8000)) return '';
    return pid;
  }
  return {
    async 'delivery-check-nothing-answering'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const pid = await open(t, { ready: false });
        if (!pid) return ['the project page never showed the Check phone and languages block'];
        const txt = await t.evaluate(PAGE.text);
        for (const w of ['Check phone and languages', 'Nothing answered on the usual local ports', 'Only a dev server on this PC can be checked']) if (!txt.includes(w)) out.push('the block lacks "' + w + '": ' + txt.slice(0, 220));
        if (!await t.evaluate(`!!${PAGE.input}`)) out.push('the type-an-address field is missing');
        if (!await t.evaluate('!!' + PAGE.button('Check'))) out.push('no Check button');
        else if (!await t.evaluate(PAGE.button('Check') + '.disabled')) out.push('Check is on with no address typed');
        if (!await t.evaluate('!!' + PAGE.button('Look for the dev server'))) out.push('no "Look for the dev server" button');
        if (await t.evaluate(`${PAGE.text}.includes('Forget results')`)) out.push('Forget results shows with no report');
        const det = await t.evaluate(PAGE.calls('deliveryCheck.detect'));
        if (det.length !== 1 || det[0][0] !== pid) out.push('detect calls ' + JSON.stringify(det) + ', want exactly one for ' + pid);
        if ((await t.evaluate(PAGE.calls('deliveryCheck.run'))).length) out.push('a check ran with nothing to check');
        if (/undefined|\[object|NaN/.test(txt)) out.push('an unresolved binding reached the block text');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'delivery-check-run'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const pid = await open(t, { ready: true });
        if (!pid) return ['the project page never showed the Check phone and languages block'];
        let txt = await t.evaluate(PAGE.text);
        if (!txt.includes('Answering at http://127.0.0.1:5173') || !txt.includes('Confirm it is the right app')) out.push('the ready state does not ask the owner to confirm the address: ' + txt.slice(0, 220));
        if (await t.evaluate(`${PAGE.input}.value`) !== 'http://127.0.0.1:5173') out.push('the field was not prefilled with the answering address');
        if (!await t.waitFor(`!${PAGE.button('Check')}.disabled`, 2000)) return out.concat('Check stayed off with a prefilled address');
        await t.evaluate(`${PAGE.button('Check')}.click()`);
        if (!await t.waitFor(`${PAGE.text}.includes('1 to fix')`, 5000)) return out.concat('Check did not show a report: ' + (await t.evaluate(PAGE.text)).slice(0, 220));
        txt = await t.evaluate(PAGE.text);
        for (const w of ['1 to fix', '1 to look at', 'to fix', 'heuristic · may be wrong', 'Sideways scroll at 390 px', '4 outside requests blocked (fonts.example.test)', 'checked', 'against 127.0.0.1:5173', 'Forget results']) if (!txt.includes(w)) out.push('the report lacks "' + w + '"');
        if (/nothing left your pc/i.test(txt)) out.push('the report claims an absolute "nothing left your PC"');
        const runs = await t.evaluate(PAGE.calls('deliveryCheck.run'));
        if (runs.length !== 1 || runs[0][0] !== pid || runs[0][1] !== 'http://127.0.0.1:5173') out.push('run calls ' + JSON.stringify(runs) + ', want one for ' + pid + ' with the confirmed address');
        // (the use mark is pinned by the unit test: the harness window is hidden, and a hidden window sends no marks)
        // an address that is not on this PC: main's refusal is shown and the held report stays
        await t.evaluate(`WHQ.app.logic.dckField('https://client.example.test')`);
        await t.evaluate(`${PAGE.button('Check')}.click()`);
        if (!await t.waitFor(`${PAGE.text}.includes('Only a dev server on this PC can be checked.')`, 4000) && !await t.waitFor(`document.querySelector('[data-dck="card"] [role="alert"]') !== null`, 4000)) out.push('a public address was not refused in the block');
        if (!await t.evaluate(`${PAGE.text}.includes('1 to fix')`)) out.push('a refused address blanked the held report');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'delivery-check-forget'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const pid = await open(t, { ready: true });
        if (!pid) return ['the project page never showed the Check phone and languages block'];
        await t.evaluate(`${PAGE.button('Check')}.click()`);
        if (!await t.waitFor(`!!${PAGE.button('Forget results')}`, 5000)) return out.concat('no report to forget after Check');
        await t.evaluate(`${PAGE.button('Forget results')}.click()`);
        if (!await t.waitFor(`!${PAGE.button('Forget results')}`, 4000)) return out.concat('Forget results did not clear the report');
        const f = await t.evaluate(PAGE.calls('deliveryCheck.forget'));
        if (f.length !== 1 || f[0][0] !== pid) out.push('forget calls ' + JSON.stringify(f) + ', want exactly one for ' + pid);
        if (await t.evaluate(`${PAGE.text}.includes('to fix')`)) out.push('findings stayed on screen after Forget');
        if (await t.evaluate(`(async () => (await WHQ.store.hq.deliveryCheck.read(${JSON.stringify(pid)})) === null)()`) !== true) out.push('main still reads a report after Forget');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    // every button in the block, once, from a clean arrival with a held report: none throws, none is unlabelled, each leaves a trace
    async 'delivery-check-button-sweep'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      let count = 0;
      try {
        const pid = await open(t, { ready: true });
        if (!pid) return ['the project page never showed the Check phone and languages block'];
        await t.evaluate(`${PAGE.button('Check')}.click()`);
        if (!await t.waitFor(`!!${PAGE.button('Forget results')}`, 5000)) return ['no report to sweep around'];
        const labels = await t.evaluate(`[...${CARD}.querySelectorAll('button')].map((b) => ((b.getAttribute('aria-label') || '') + ' ' + b.textContent).replace(/\\s+/g, ' ').trim())`);
        count = labels.length;
        if (count < 3) out.push('expected at least Look / Check / Forget in the block, found ' + count);
        for (let i = 0; i < labels.length; i++) {
          await t.evaluate(PAGE.reset);
          await t.evaluate(`hqFake.set('deliveryCheck.detect', ${JSON.stringify(READY)})`);
          const id = await t.evaluate(PAGE.open(CLIENT_VIEW));
          if (!id || !await t.waitFor(`!!${PAGE.button('Check')}`, 6000)) { out.push('button #' + i + ': the block never came back'); continue; }
          await t.evaluate(`${PAGE.button('Check')}.click()`);
          if (!await t.waitFor(`!!${PAGE.button('Forget results')}`, 5000)) { out.push('button #' + i + ': no report to sweep around'); continue; }
          const before = await t.evaluate(`hqFake.calls().length`);   // (hqFake.reset also re-seeds the fake's reports, so the log is counted, not cleared)
          t.clearErrors();
          const r = await t.evaluate(`(() => { const bs = [...${CARD}.querySelectorAll('button')]; const b = bs[${i}]; if (!b) return { gone: true }; const label = ((b.getAttribute('aria-label') || '') + ' ' + b.textContent).replace(/\\s+/g, ' ').trim(); const before = ${CARD}.innerHTML.length + ':' + b.disabled; const wasOff = b.disabled; b.click(); return { label, wasOff, before }; })()`);
          await pause(150);
          if (r && r.gone) { out.push('button #' + i + ' vanished'); continue; }
          if (!r.label) out.push('button #' + i + ' has no label');
          if (!r.wasOff) {
            const traced = await t.evaluate(`hqFake.calls().slice(${before}).some((c) => /^deliveryCheck\\./.test(c.method)) ||(WHQ.app.logic.state.toasts || []).length > 0`);
            if (!traced) out.push('"' + r.label + '" did nothing: no hq.deliveryCheck call and no toast');
          }
          const errs = t.errors();
          if (errs.length) out.push('"' + r.label + '": ' + errs.join(' | '));
        }
        console.log('[delivery-check-button-sweep] ' + count + ' buttons in the block, each clicked once from a held report');
      } finally { await leave(t); }
      return out.concat(t.errors());
    },
  };
}
