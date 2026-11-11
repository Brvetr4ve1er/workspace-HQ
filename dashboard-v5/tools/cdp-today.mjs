// CDP scenarios for Home › "Where today went" (the Today ribbon). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeTodayScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario today-render,today-step-back,today-partial   (needs --preload=fake)
//
// The fake preload answers hq.today.read({ dayOffset }) with an INVENTED day (placeholderDay in src/selftest-today.mjs): offsets 0..3 are a full
// day (three invented projects, browser focus, a sleep, commit ticks), offsets 4..6 are the "partial" day (the Claude lane says to update the
// Hub, the browser lane says it is kept for 3 days, the PC lane says there is no app log) and any other offset is refused like main refuses
// it. hqFake.calls('today.read') lists what the page asked. Each scenario ends with hqFake.reset(true), the ribbon re-armed and day 0 shown.
//
//   today-render      Home shows the ribbon: the caption in blocks, a labelled SVG, a text twin, the legend, today's day label, the forward
//                     arrow disabled and the back arrow enabled; opening Home read the day exactly once (dayOffset 0) and nothing was written
//   today-step-back   back to Yesterday reads dayOffset 1 once; forward to Today needs no second read; stepping back to 6 days stops there
//                     (the back arrow disabled, no dayOffset above 6 ever asked)
//   today-partial     a day with no sources says so in words: "update the Hub", "browser lane is kept for 3 days", "PC sleep unknown";
//                     nothing reads as a zero and the page logs no error

const SEC = `document.querySelector('section[aria-label="Where today went"]')`;
const SVG = `(${SEC} && ${SEC}.querySelector('svg[role="img"]'))`;
const BACK = `(${SEC} && ${SEC}.querySelector('button[aria-label^="Previous day"]'))`;
const FWD = `(${SEC} && ${SEC}.querySelector('button[aria-label^="Next day"]'))`;
export const PAGE = Object.freeze({
  section: SEC,
  svg: SVG,
  back: BACK,
  forward: FWD,
  text: `(${SEC} ? ${SEC}.textContent.replace(/\\s+/g, ' ') : '')`,
  status: `(${SEC} ? [...${SEC}.querySelectorAll('[role="status"]')].map((n) => n.textContent.trim()).join(' | ') : '')`,
  svgLabel: `(${SVG} ? ${SVG}.getAttribute('aria-label') : null)`,
  svgShapes: `(${SVG} ? ${SVG}.querySelectorAll('rect, line').length : 0)`,
  twinItems: `(${SEC} ? ${SEC}.querySelectorAll('ul[aria-label="Where today went, in words"] li').length : 0)`,
  reads: `JSON.stringify(hqFake.calls('today.read').map((c) => c.args))`,
  writes: `hqFake.calls('today.write').length`,
  open: `(() => { const L = WHQ.app.logic; hqFake.reset(true); if (L.tdyRearm) L.tdyRearm(); const T = L.LIVE && L.LIVE.today; if (T) { T.loaded = false; T.days = {}; T.errors = {}; T.revision = 0; } L.setState({ tab: 'home', route: null, tdyOffset: 0 }); return true; })()`,
  reset: `(() => { const L = WHQ.app.logic; if (L.tdyRearm) L.tdyRearm(); hqFake.reset(true); L.setState({ tdyOffset: 0, toasts: [] }); return true; })()`,
});

export const WANT_TEXT = Object.freeze(['Where today went', 'five-minute block', 'with Claude', 'commit', 'PC', 'Claude (5-minute blocks)', 'browser focus', 'PC asleep']);
export const NO_TEXT = /undefined|\[object|NaN|Infinity|hours? worked/;

export function makeTodayScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const label = (t) => t.evaluate(`(${SEC} ? (${SEC}.querySelector('[role="status"][aria-live="polite"]') || {}).textContent || '' : '')`);
  const readsOf = async (t) => JSON.parse(await t.evaluate(PAGE.reads));
  return {
    async 'today-render'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.open);
        if (!await t.waitFor(`!!${SVG} && ${PAGE.svgShapes} > 6`, 6000)) return out.concat('Home never showed a drawn ribbon: ' + String(await t.evaluate(PAGE.text)).slice(0, 240));
        const txt = String(await t.evaluate(PAGE.text));
        for (const w of WANT_TEXT) if (!txt.includes(w)) out.push('the ribbon lacks "' + w + '": ' + txt.slice(0, 300));
        if (NO_TEXT.test(txt)) out.push('an unresolved binding or a forbidden wording reached the ribbon text');
        if (!/^Where today went, Today\./.test(String(await t.evaluate(PAGE.svgLabel)))) out.push('the SVG has no label that starts "Where today went, Today."');
        if ((await t.evaluate(PAGE.twinItems)) < 4) out.push('the text twin lists fewer than 4 lanes');
        if ((await label(t)).trim() !== 'Today') out.push('the day label is not "Today": ' + (await label(t)));
        if (!(await t.evaluate(`${FWD}.disabled`))) out.push('the forward arrow is enabled on today');
        if (await t.evaluate(`${BACK}.disabled`)) out.push('the back arrow is disabled on today');
        const reads = await readsOf(t);
        if (JSON.stringify(reads) !== JSON.stringify([[{ dayOffset: 0 }]])) out.push('opening Home read ' + JSON.stringify(reads) + ', want exactly one read of dayOffset 0');
        if (await t.evaluate(PAGE.writes)) out.push('something was written just by opening Home');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'today-step-back'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.open);
        if (!await t.waitFor(`!!${SVG} && !${BACK}.disabled`, 6000)) return out.concat('the ribbon never became usable');
        await t.evaluate(`${BACK}.click()`);
        if (!await t.waitFor(`(${SEC}.textContent || '').includes('Yesterday') && !!${SVG}`, 4000)) return out.concat('stepping back never showed Yesterday: ' + String(await t.evaluate(PAGE.text)).slice(0, 200));
        let reads = await readsOf(t);
        if (JSON.stringify(reads) !== JSON.stringify([[{ dayOffset: 0 }], [{ dayOffset: 1 }]])) out.push('one step back read ' + JSON.stringify(reads) + ', want day 0 then day 1');
        if (await t.evaluate(`${FWD}.disabled`)) out.push('the forward arrow is disabled on yesterday');
        await pause(60);
        await t.evaluate(`${FWD}.click()`);
        if (!await t.waitFor(`(${SEC}.querySelector('[role="status"][aria-live="polite"]') || {}).textContent === 'Today'`, 4000)) return out.concat('stepping forward never showed Today');
        reads = await readsOf(t);
        if (reads.length !== 2) out.push('stepping forward to a day just read asked main again: ' + JSON.stringify(reads));
        for (let i = 0; i < 6; i++) { await t.evaluate(`(${BACK} && !${BACK}.disabled) ? ${BACK}.click() : null`); await pause(40); }
        if (!await t.waitFor(`${BACK} && ${BACK}.disabled`, 4000)) return out.concat('the back arrow never stopped at 6 days');
        if (!String(await t.evaluate(`${BACK}.getAttribute('aria-label')`)).includes('7 days')) out.push('the disabled back arrow does not say how far back the ribbon goes');
        reads = await readsOf(t);
        const asked = reads.map((r) => r[0].dayOffset);
        if (Math.max(...asked) !== 6) out.push('the farthest day asked was ' + Math.max(...asked) + ', want 6');
        if (asked.some((n) => n > 6 || n < 0)) out.push('a day outside 0..6 was asked: ' + JSON.stringify(asked));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'today-partial'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.open);
        if (!await t.waitFor(`!!${SVG} && !${BACK}.disabled`, 6000)) return out.concat('the ribbon never became usable');
        for (let i = 0; i < 4; i++) { await t.evaluate(`${BACK}.click()`); await pause(60); }
        if (!await t.waitFor(`(${SEC}.textContent || '').includes('update the Hub')`, 5000)) return out.concat('the day with no Claude source never said to update the Hub: ' + String(await t.evaluate(PAGE.text)).slice(0, 260));
        const txt = String(await t.evaluate(PAGE.text));
        for (const w of ['browser lane is kept for 3 days', 'PC sleep unknown', 'Claude blocks unavailable', 'no app log for this day']) if (!txt.includes(w)) out.push('the partial day lacks "' + w + '"');
        if (/\b0 five-minute blocks|\b0 m\b|asleep 0/.test(txt)) out.push('a lane with no source reads as a zero: ' + txt.slice(0, 260));
        if (NO_TEXT.test(txt)) out.push('an unresolved binding reached the partial day');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
