// CDP scenarios for System > Machine > "How the PC changed". cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeMachineDriftScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario machine-drift-render,machine-drift-estimate-refuses   (needs --preload=fake)
//
// The fake preload answers hq.machineHistory.read with the invented history of src/selftest-drift.mjs inventedAnswer(): 40 checks six hours
// apart (under ten days), a deliberate gap (three checks with no CPU/RAM reading), a ping of 0 every ninth check, one partial disk reading and no
// folder lines. Each scenario ends with hqFake.reset(true) and the app back on Home.
//
//   machine-drift-render             System > Machine shows the seven charts in order (Temp files (GB), no GPU series), each with its count and span;
//                                    the CPU and ping lines break at their gaps; the disk part says the readings are partial instead of guessing;
//                                    the history was read exactly once and one 'machine-drift' usage mark was sent; no estimate is shown before it is asked for
//   machine-drift-estimate-refuses   the opt-in Estimate button on the disk chart refuses in words (it needs 14 days; these cover 9), says nothing like
//                                    "will run out", reads nothing more, and pressing it again hides the answer

const SEC = `document.querySelector('section[data-md="drift"]')`;
export const PAGE = Object.freeze({
  section: SEC,
  text: `(${SEC} ? ${SEC}.textContent.replace(/\\s+/g, ' ') : '')`,
  charts: `[...document.querySelectorAll('[data-dft="chart"]')]`,
  ids: `[...document.querySelectorAll('[data-dft="chart"]')].map((c) => c.getAttribute('data-dft-id'))`,
  titles: `[...document.querySelectorAll('[data-dft="chart"]')].map((c) => c.querySelector('span').textContent.trim())`,
  pathOf: (id) => `(() => { const p = document.querySelector('[data-dft="chart"][data-dft-id="${id}"] path'); return p ? p.getAttribute('d') : null; })()`,
  twinOf: (id) => `(() => { const e = document.querySelector('[data-dft="chart"][data-dft-id="${id}"] [data-dft="twin"]'); return e ? e.textContent.trim() : ''; })()`,
  cardText: (id) => `(() => { const e = document.querySelector('[data-dft="chart"][data-dft-id="${id}"]'); return e ? e.textContent.replace(/\\s+/g, ' ') : ''; })()`,
  summary: `(() => { const e = document.querySelector('[data-dft="summary"]'); return e ? e.textContent.trim() : ''; })()`,
  disk: `(() => { const e = document.querySelector('[data-dft="disk"]'); return e ? e.textContent.replace(/\\s+/g, ' ') : ''; })()`,
  estButton: `document.querySelector('[data-dft="estimate-button"]')`,
  estimate: `document.querySelector('[data-dft="estimate"]')`,
  estimateText: `(() => { const e = document.querySelector('[data-dft="estimate"]'); return e ? e.textContent.replace(/\\s+/g, ' ') : ''; })()`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).length`,
  marks: `hqFake.calls('use').filter((c) => c.args[0] === 'machine-drift').map((c) => c.args.join('/'))`,
  go: `(() => { const L = WHQ.app.logic; hqFake.reset(true); L._dftAsked = false; L._dftExam = false; L.setState({ dft: null, route: null }); L.go('system', 'machine'); return true; })()`,
  reset: `(() => { const L = WHQ.app.logic; hqFake.reset(true); L._dftAsked = false; L._dftExam = false; L._dftReading = false; L._dftAgain = false; L.setState({ dft: null, toasts: [], route: null }); L.go('home'); return true; })()`,
});

export const SEVEN = Object.freeze(['disk', 'ram', 'cpu', 'temp', 'ping', 'startup', 'updates']);
export const TITLES = Object.freeze(['Free disk (GB)', 'RAM in use (%)', 'CPU load (%)', 'Temp files (GB)', 'Ping (ms)', 'Startup apps', 'Days since updates']);

const breaks = (d) => (typeof d === 'string' ? (d.match(/M/g) || []).length : 0);

export function makeMachineDriftScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  return {
    async 'machine-drift-render'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        if (await t.evaluate(PAGE.calls('machineHistory.read'))) out.push('the history was read before the owner opened System > Machine');
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`${PAGE.charts}.length === 7`, 6000)) return out.concat('System > Machine never showed seven charts: ' + String(await t.evaluate(PAGE.text)).slice(0, 240));
        const ids = await t.evaluate(PAGE.ids);
        if (JSON.stringify(ids) !== JSON.stringify(SEVEN)) out.push('chart order ' + JSON.stringify(ids) + ', want ' + JSON.stringify(SEVEN));
        const titles = await t.evaluate(PAGE.titles);
        if (JSON.stringify(titles) !== JSON.stringify(TITLES)) out.push('chart titles ' + JSON.stringify(titles) + ', want ' + JSON.stringify(TITLES));
        const txt = String(await t.evaluate(PAGE.text));
        if (/gpu|driver|battery/i.test(txt)) out.push('a GPU, driver or battery series reached the panel: ' + txt.slice(0, 200));
        if (/undefined|\[object|NaN/.test(txt)) out.push('an unresolved binding reached the panel text');
        const summary = String(await t.evaluate(PAGE.summary));
        if (!/^40 checks · /.test(summary) || !summary.includes('only the last 96 checks are kept')) out.push('the summary says "' + summary + '"');
        for (const id of SEVEN) {
          const card = String(await t.evaluate(PAGE.cardText(id)));
          if (!/40 checks over \d+ days/.test(card)) out.push('chart ' + id + ' lacks its count and span: ' + card.slice(0, 160));
        }
        const cpu = await t.evaluate(PAGE.pathOf('cpu'));
        if (breaks(cpu) < 2) out.push('the CPU line does not break at its gap (path has ' + breaks(cpu) + ' segment(s))');
        const ping = await t.evaluate(PAGE.pathOf('ping'));
        if (breaks(ping) < 2) out.push('the ping line does not break at its zero readings (path has ' + breaks(ping) + ' segment(s))');
        const pingCard = String(await t.evaluate(PAGE.cardText('ping')));
        if (!pingCard.includes('left out as a gap')) out.push('the ping chart never says a 0 is a gap: ' + pingCard.slice(0, 200));
        if (!String(await t.evaluate(PAGE.cardText('temp'))).includes('Temp files (GB)')) out.push('the temp-files chart is not titled in GB');
        const disk = String(await t.evaluate(PAGE.disk));
        if (!disk.includes('What filled the disk') || !disk.includes('partial')) out.push('the disk part does not say the readings are partial: ' + disk.slice(0, 200));
        if (await t.evaluate(`!!${PAGE.estimate}`)) out.push('an estimate was shown before the owner asked for one');
        const reads = await t.evaluate(PAGE.calls('machineHistory.read'));
        if (reads !== 1) out.push('System > Machine read the history ' + reads + ' times on arrival, want exactly 1');
        const marks = await t.evaluate(PAGE.marks);
        if (marks.length !== 1) out.push('hq.use marks for machine-drift: ' + JSON.stringify(marks) + ', want exactly one');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'machine-drift-estimate-refuses'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`!!${PAGE.estButton} && ${PAGE.charts}.length === 7`, 6000)) return out.concat('the disk chart never showed its Estimate button: ' + String(await t.evaluate(PAGE.text)).slice(0, 220));
        if (await t.evaluate(`!!${PAGE.estimate}`)) out.push('an estimate was shown before the button was pressed');
        await t.evaluate(`${PAGE.estButton}.click()`);
        if (!await t.waitFor(`!!${PAGE.estimate}`, 4000)) return out.concat('pressing Estimate showed nothing');
        const said = String(await t.evaluate(PAGE.estimateText));
        if (!said.includes('at least 14 days')) out.push('the refusal does not say it needs 14 days: ' + said.slice(0, 200));
        if (!/these cover \d+ days/.test(said)) out.push('the refusal does not say how many days the checks cover: ' + said.slice(0, 200));
        if (/will run out|about \d+ days of room/i.test(said)) out.push('a refused estimate still sounds like an answer: ' + said.slice(0, 200));
        if (await t.evaluate(PAGE.calls('machineHistory.read')) !== 1) out.push('pressing Estimate read the history again');
        await pause(60);
        await t.evaluate(`${PAGE.estButton}.click()`);
        if (!await t.waitFor(`!${PAGE.estimate}`, 4000)) out.push('pressing Estimate again did not hide the answer');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
