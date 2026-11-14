// CDP scenarios for Home as one decision (batch 7, dish home-one-decision). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeHomeOneScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario home-one-render,home-one-more-persist,home-one-follows-brief,home-one-allclear,home-one-done-xp,home-one-no-motion,home-one-use-marks   (needs --preload=fake)
//
// Home reads: greeting, the Brief, ONE next-action card (or the All clear card), then a single "More on Home" disclosure that holds the rest
// (the since banner, the sessions strip, the Today ribbon, Portfolio, Changes and the aside: Trend, Worth a re-run, Weekly recap). The flag is the
// per-viewer localStorage key 'hq.homeMore' (src/logic/home-more.mjs), read at mount into state.homeMore.
//
//   home-one-render        heading order is Brief, then the Next action card, then the More on Home button (aria-expanded false); closed, no Portfolio,
//                          Changes, Trend, Today ribbon or sessions strip node exists; opening shows them in order and the button says Less on Home
//   home-one-more-persist  open it, reload, still open; close it, reload, still closed; with the flag's storage access throwing, the page still renders
//                          closed, logs no error, and the button still toggles in memory
//   home-one-follows-brief a Brief whose top row names a fixture project that has an open task makes the card show that project's top task and
//                          "Follows the top Brief row"; a lead that names no project leaves the ranker's top on the card
//   home-one-allclear      an empty Brief with open tasks shows the ranker's top with "picked by fixed rules"; an empty Brief with no open task shows
//                          the All clear card with Scan now and Browse ideas and no Next action card
//   home-one-done-xp       Mark done on the card completes the quest through the fake bridge (markQuestDone for that id) and the Done toast appears;
//                          the XP rises once the coin lands
//   home-one-no-motion     with Reduce motion set, and again with the OS media query, the disclosure toggles with no transition, no animation and no
//                          running Web Animation on the control or the revealed blocks
//   home-one-use-marks     closed, Home sends no today-ribbon or sessions-strip mark; opening sends each shown one once per arrival
//
// The disclosure is closed by default. A scenario that reads a block now inside it (Where today went, Portfolio, Changes, the strip, Weekly recap)
// opens it first with `await openHomeMore(t)` or `t.evaluate(HOME_MORE_ON)`; both set the localStorage flag AND the live state, because the state is
// read from storage only at mount.

export const READY = `!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0)`;

/** In-page: open the disclosure now (flag + live state). */
export const HOME_MORE_ON = `(() => { try { localStorage.setItem('hq.homeMore', '1'); } catch (e) {} WHQ.app.logic.setState({ homeMore: true }); return true; })()`;
/** In-page: close the disclosure now and forget the flag. */
export const HOME_MORE_OFF = `(() => { try { localStorage.removeItem('hq.homeMore'); } catch (e) {} WHQ.app.logic.setState({ homeMore: false }); return true; })()`;
/** For other Home-block scenarios: open the disclosure, then show Home. Resolves true when the toggle shows "Less on Home". */
export async function openHomeMore(t) {
  await t.evaluate(HOME_MORE_ON);
  await t.evaluate(`WHQ.app.logic.go('home')`);
  return t.waitFor(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(More|Less) on Home$/.test(x.textContent.trim())); return !!b && b.textContent.trim() === 'Less on Home'; })()`, 6000);
}

const BRIEF_SEC = `document.querySelector('section[aria-label="Brief: what needs you now"]')`;
const NEXT_SEC = `document.querySelector('section[aria-label="Next action"]')`;
const MORE_BTN = `[...document.querySelectorAll('button')].find((x) => /^(More|Less) on Home$/.test(x.textContent.trim()))`;
const REST_SEC = `[...document.querySelectorAll('section')].find((s) => s.textContent.includes('Nothing on fire.'))`;
const NODES = Object.freeze({
  portfolio: `document.querySelector('section[aria-label="Portfolio"]')`,
  changes: `document.querySelector('section[aria-label="Changes"]')`,
  ribbon: `document.querySelector('section[aria-label="Where today went"]')`,
  strip: `document.querySelector('[aria-label="Claude sessions that need a look"]')`,
  trend: `[...document.querySelectorAll('main h2, main h3, main span')].find((n) => n.textContent.trim() === 'Trend')`,
  recap: `[...document.querySelectorAll('main h2, main h3, main span')].find((n) => n.textContent.trim().startsWith('Weekly recap'))`,
});
const after = (a, b) => `(() => { const a = ${a}, b = ${b}; return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); })()`;
const NO_TEXT = /undefined|\[object|NaN|Infinity/;
const MARKS = ['today-ribbon', 'sessions-strip'];

export const PAGE = Object.freeze({
  briefSec: BRIEF_SEC,
  nextSec: NEXT_SEC,
  moreBtn: MORE_BTN,
  restSec: REST_SEC,
  nodes: NODES,
  // the card's title is an <hq-scramble text="..."> custom element (its glyphs are drawn, not text nodes): read its attribute, then the rest of the card's text
  nextText: `(() => { const s = ${NEXT_SEC}; if (!s) return ''; const title = [...s.querySelectorAll('hq-scramble')].map((e) => e.getAttribute('text') || '').join(' '); return (title + ' ' + s.textContent).replace(/\\s+/g, ' ').trim(); })()`,
  restText: `(() => { const s = ${REST_SEC}; return s ? s.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
  moreState: `(() => { const b = ${MORE_BTN}; return b ? { label: b.textContent.trim(), expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls') || '', tag: b.tagName, type: b.getAttribute('type') || '' } : null; })()`,
  present: `JSON.stringify({ ${Object.entries(NODES).map(([k, v]) => `${k}: !!(${v})`).join(', ')} })`,
  briefBeforeNext: after(BRIEF_SEC, NEXT_SEC),
  nextBeforeMore: after(NEXT_SEC, MORE_BTN),
  briefBeforeRest: after(BRIEF_SEC, REST_SEC),
  restBeforeMore: after(REST_SEC, MORE_BTN),
  openOrder: `(() => { const els = [${NODES.ribbon}, ${NODES.portfolio}, ${NODES.changes}, ${NODES.recap}]; for (let i = 1; i < els.length; i++) { if (!els[i - 1] || !els[i]) return 'missing ' + (!els[i - 1] ? i - 1 : i); if (!(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return 'out of order at ' + i; } return 'ok'; })()`,
  flagState: `WHQ.app.logic.state.homeMore`,
  tasks: `(() => { const L = WHQ.app.logic; return L.tasksAt(0).filter((t) => !(L.state.recentDone || []).includes(t.id)).map((t) => ({ id: t.id, proj: t.proj == null ? null : String(t.proj), title: t.title, xp: t.xp })); })()`,
  where: `JSON.stringify({ tab: WHQ.app.logic.state.tab, route: WHQ.app.logic.state.route || null })`,
  toasts: `JSON.stringify((WHQ.app.logic.state.toasts || []).map((x) => (x && (x.text || x.msg || x.message)) || ''))`,
  uses: `JSON.stringify(hqFake.calls('use').map((c) => c.args))`,
  // what a motion check reads: the control and the revealed blocks (the children of the region the control names)
  motion: `(() => { const b = ${MORE_BTN}; if (!b) return null; const id = b.getAttribute('aria-controls'); const region = id ? document.getElementById(id) : null;
    const els = [b].concat(region ? [region].concat([...region.children]) : []);
    const bad = [];
    for (const el of els) { const cs = getComputedStyle(el), inl = el.getAttribute('style') || '';
      const td = cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0), an = cs.animationName !== 'none' && cs.animationName !== '';
      if (td || an || /transition|animation/i.test(inl) || (el.getAnimations ? el.getAnimations().length > 0 : false)) bad.push((el.tagName + ' ' + (el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24))).trim()); }
    return { checked: els.length, region: !!region, bad }; })()`,
  serve: (brief) => `(() => { const L = WHQ.app.logic; hqFake.set('brief.read', { brief: ${JSON.stringify(brief)} }); L.setState({ brfBusy: false, batOpen: null, batBal: '', batBusy: false, batDone: {}, toasts: [], recentDone: [] }); L._brfBusy = false; L._batBusy = false; WHQ.store.refreshBrief(); L.go('home'); return true; })()`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; try { localStorage.removeItem('hq.homeMore'); } catch (e) {} L.setState({ homeMore: false, reduceMotion: false, recentDone: [], toasts: [], brfBusy: false }); L._brfBusy = false; WHQ.store.refreshBrief(); L.go('home'); return true; })()`,
});

const item = (key, severity, text, action) => ({ key, rule: key.split(':')[0], severity, text, why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action, count: 0 });
export const briefOf = (items) => ({ v: 1, generatedAt: '2026-11-14T09:00:00.000Z', items, overflow: [], standing: [], more: 0, errors: [], quiet: null });
export const SCAN_ROW = item('scan-stale:2026-11-12', 'med', 'Scan data is 2 days old', { kind: 'scan' });
export const projectRow = (pid) => item('secrets:' + pid + ':1', 'high', 'Placeholder project has 1 secret in plain sight', { kind: 'go', tab: 'projects', projectId: String(pid) });
export { NO_TEXT, MARKS };

export function makeHomeOneScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const reload = async (t) => { await t.reload(); const ok = await t.waitFor(READY + ` && !!window.hqFake && hqFake.calls('liveState').length > 0`, 15000); if (ok) await pause(300); return ok; };
  const moreOf = async (t) => t.evaluate(PAGE.moreState);
  // closed Home on a placeholder Brief whose lead names no project: the card is the ranker's
  const showHome = async (t, brief) => {
    await t.evaluate(HOME_MORE_OFF);
    await t.evaluate(PAGE.serve(brief || briefOf([SCAN_ROW])));
    return t.waitFor(`!!(${NEXT_SEC} || ${REST_SEC}) && !!(${MORE_BTN})`, 8000);
  };
  const clickMore = (t) => t.evaluate(`(() => { const b = ${MORE_BTN}; if (!b) return false; b.click(); return true; })()`);

  return {
    async 'home-one-render'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await showHome(t)) return ['Home never showed a card and the More on Home button'];
        if (!await t.evaluate(PAGE.briefBeforeNext)) out.push('the Brief is not above the Next action card');
        if (!await t.evaluate(PAGE.nextBeforeMore)) out.push('the More on Home button is not below the Next action card');
        const m = await moreOf(t);
        if (m.label !== 'More on Home') out.push('the closed button reads "' + m.label + '", want More on Home');
        if (m.expanded !== 'false') out.push('the closed button has aria-expanded=' + m.expanded);
        if (m.tag !== 'BUTTON') out.push('the control is a ' + m.tag + ', want a real button');
        if (!m.controls) out.push('the button has no aria-controls');
        const closed = JSON.parse(await t.evaluate(PAGE.present));
        for (const [k, v] of Object.entries(closed)) if (v) out.push('closed, the ' + k + ' node still exists');
        // opening shows every block, in the order the Home column had before
        await clickMore(t);
        if (!await t.waitFor(`!!(${NODES.portfolio})`, 6000)) return out.concat('opening More on Home never showed Portfolio');
        const open = await moreOf(t);
        if (open.label !== 'Less on Home' || open.expanded !== 'true') out.push('the open button reads "' + open.label + '" with aria-expanded=' + open.expanded);
        if (!open.controls || !await t.evaluate(`!!document.getElementById(${JSON.stringify(open.controls)})`)) out.push('aria-controls does not name an element while open');
        for (const k of ['portfolio', 'changes', 'recap']) if (!JSON.parse(await t.evaluate(PAGE.present))[k]) out.push('open, the ' + k + ' node is missing');
        if (!await t.waitFor(`!!(${NODES.ribbon})`, 6000)) out.push('open, the Today ribbon never showed');
        const order = await t.evaluate(PAGE.openOrder);
        if (order !== 'ok') out.push('the revealed blocks are not in order (Today ribbon, Portfolio, Changes, Weekly recap): ' + order);
        // closing again takes them away
        await clickMore(t);
        if (!await t.waitFor(`!(${NODES.portfolio})`, 4000)) out.push('closing More on Home left Portfolio on the page');
        if (NO_TEXT.test(String(await t.evaluate(PAGE.nextText)))) out.push('an unresolved binding reached the Next action card');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'home-one-more-persist'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      let hook = null;
      try {
        if (!await showHome(t)) return ['Home never showed the More on Home button'];
        // open, reload, still open
        await clickMore(t);
        if (!await t.waitFor(`!!(${NODES.portfolio})`, 6000)) return ['More on Home never opened'];
        if (await t.evaluate(`localStorage.getItem('hq.homeMore')`) !== '1') out.push('opening did not store the flag as 1');
        if (!await reload(t)) return out.concat('the app never came back after the reload');
        if (!await t.waitFor(`!!(${MORE_BTN})`, 8000)) return out.concat('Home never showed the button after the reload');
        if (!await t.evaluate(PAGE.flagState)) out.push('after a reload the disclosure came back closed');
        if (!await t.waitFor(`!!(${NODES.portfolio})`, 4000)) out.push('after a reload Portfolio is not on the page');
        // close, reload, still closed
        await clickMore(t);
        if (!await t.waitFor(`!(${NODES.portfolio})`, 4000)) return out.concat('More on Home never closed');
        if (!await reload(t)) return out.concat('the app never came back after the second reload');
        if (!await t.waitFor(`!!(${MORE_BTN})`, 8000)) return out.concat('Home never showed the button after the second reload');
        if (await t.evaluate(PAGE.flagState)) out.push('after closing and reloading the disclosure came back open');
        if (await t.evaluate(`!!(${NODES.portfolio})`)) out.push('after closing and reloading Portfolio is on the page');
        // the flag's storage access throws: the page still renders closed, logs nothing, and the button still toggles in memory
        const src = `(() => { const g = Storage.prototype.getItem, s = Storage.prototype.setItem, r = Storage.prototype.removeItem;
          Storage.prototype.getItem = function (k) { if (k === 'hq.homeMore') throw new DOMException('blocked', 'SecurityError'); return g.apply(this, arguments); };
          Storage.prototype.setItem = function (k) { if (k === 'hq.homeMore') throw new DOMException('blocked', 'SecurityError'); return s.apply(this, arguments); };
          Storage.prototype.removeItem = function (k) { if (k === 'hq.homeMore') throw new DOMException('blocked', 'SecurityError'); return r.apply(this, arguments); }; })();`;
        hook = (await t.send('Page.addScriptToEvaluateOnNewDocument', { source: src })).identifier;
        t.clearErrors();
        if (!await reload(t)) return out.concat('the app never came back with the flag storage blocked');
        if (!await t.waitFor(`!!(${NEXT_SEC} || ${REST_SEC})`, 8000)) return out.concat('Home did not render with the flag storage blocked');
        const m = await moreOf(t);
        if (!m || m.label !== 'More on Home' || m.expanded !== 'false') out.push('with the storage blocked the button is not the closed one: ' + JSON.stringify(m));
        if (await t.evaluate(`!!(${NODES.portfolio})`)) out.push('with the storage blocked Portfolio is on the page');
        await clickMore(t);
        if (!await t.waitFor(`!!(${NODES.portfolio})`, 4000)) out.push('with the storage blocked the button no longer toggles in memory');
        out.push(...t.errors());
      } finally {
        if (hook) await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook }).catch(() => {});
        await leave(t);
        if (hook) await reload(t).catch(() => {});
        await leave(t);
      }
      return out;
    },

    async 'home-one-follows-brief'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const tasks = (await t.evaluate(PAGE.tasks)) || [];
        const withProj = tasks.filter((x) => x.proj);
        if (!tasks.length) return ['the page data has no open task, so nothing can be followed'];
        // prefer a project whose top task is NOT the ranker's global top, so following is visible
        const top = tasks[0];
        const pick = withProj.find((x) => x.proj !== top.proj) || withProj[0];
        if (!pick) return ['no open task in the page data belongs to a project, so nothing can be followed'];
        const want = tasks.find((x) => x.proj === pick.proj);
        // 1. the lead row names that project
        if (!await showHome(t, briefOf([projectRow(pick.proj), SCAN_ROW]))) return ['Home never showed a card for a Brief that names a project'];
        if (!await t.waitFor(`(${PAGE.nextText}).includes(${JSON.stringify(want.title)})`, 6000)) out.push('the card does not show ' + JSON.stringify(want.title) + ' (the top open task of the project the Brief names): ' + String(await t.evaluate(PAGE.nextText)).slice(0, 200));
        const text = String(await t.evaluate(PAGE.nextText));
        if (!text.includes('Follows the top Brief row')) out.push('the card does not say "Follows the top Brief row": ' + text.slice(0, 200));
        if (text.includes('picked by fixed rules')) out.push('the card claims fixed rules while following the Brief');
        // 2. a lead that names no project leaves the ranker's top
        await t.evaluate(PAGE.serve(briefOf([SCAN_ROW, projectRow(pick.proj)])));
        if (!await t.waitFor(`(${PAGE.nextText}).includes(${JSON.stringify(top.title)})`, 6000)) out.push('with a lead that names no project the card is not the ranker\'s top ' + JSON.stringify(top.title));
        const plain = String(await t.evaluate(PAGE.nextText));
        if (!plain.includes('picked by fixed rules')) out.push('the ranker card does not say "picked by fixed rules": ' + plain.slice(0, 200));
        if (plain.includes('Follows the top Brief row')) out.push('a later Brief row moved the card');
        // 3. the card and the Tasks list agree (one ordering)
        await t.evaluate(PAGE.serve(briefOf([projectRow(pick.proj)])));
        await t.waitFor(`(${PAGE.nextText}).includes('Follows the top Brief row')`, 6000);
        await t.evaluate(`WHQ.app.logic.go('tasks')`);
        if (!await t.waitFor(`document.body.textContent.includes(${JSON.stringify(want.title)})`, 6000)) out.push('the Tasks space does not list the followed task');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'home-one-allclear'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const tasks = (await t.evaluate(PAGE.tasks)) || [];
        if (!tasks.length) return ['the page data has no open task, so the empty-Brief ranker card cannot be checked'];
        // empty Brief + open tasks: the ranker's top, the card is never missing
        if (!await showHome(t, briefOf([]))) return ['Home never showed a card for an empty Brief'];
        if (!await t.waitFor(`(${PAGE.nextText}).includes(${JSON.stringify(tasks[0].title)})`, 6000)) out.push('an empty Brief did not leave the ranker\'s top on the card: ' + String(await t.evaluate(PAGE.nextText)).slice(0, 200));
        const text = String(await t.evaluate(PAGE.nextText));
        if (!text.includes('picked by fixed rules')) out.push('the card does not say "picked by fixed rules": ' + text.slice(0, 200));
        if (text.includes('Follows the top Brief row')) out.push('an empty Brief claims to be followed');
        if (await t.evaluate(`!!(${REST_SEC})`)) out.push('the All clear card shows while tasks are open');
        // empty Brief + no open task: the All clear card, with its two buttons, and no Next action card
        await t.evaluate(`WHQ.app.logic.setState({ recentDone: ${JSON.stringify(tasks.map((x) => x.id))} })`);
        if (!await t.waitFor(`!!(${REST_SEC})`, 6000)) return out.concat('with no open task the All clear card never showed');
        if (await t.evaluate(`!!(${NEXT_SEC})`)) out.push('the Next action card shows with no open task');
        const rest = String(await t.evaluate(PAGE.restText));
        for (const w of ['All clear', 'Nothing on fire.', 'Scan now', 'Browse ideas']) if (!rest.includes(w)) out.push('the All clear card is missing "' + w + '": ' + rest.slice(0, 200));
        if (NO_TEXT.test(rest)) out.push('an unresolved binding reached the All clear card');
        if (!await t.evaluate(PAGE.restBeforeMore)) out.push('the More on Home button is not below the All clear card');
        if (!await t.evaluate(PAGE.briefBeforeRest)) out.push('the Brief is not above the All clear card');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'home-one-done-xp'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const tasks = (await t.evaluate(PAGE.tasks)) || [];
        if (!tasks.length) return ['the page data has no open task to mark done'];
        if (!await showHome(t, briefOf([]))) return ['Home never showed a card'];
        const want = tasks[0];
        if (!await t.waitFor(`(${PAGE.nextText}).includes(${JSON.stringify(want.title)})`, 6000)) return ['the card is not the ranker\'s top ' + JSON.stringify(want.title)];
        const xp0 = await t.evaluate(`WHQ.app.logic.state.xp`);
        const clicked = await t.evaluate(`(() => { const s = ${NEXT_SEC}; const b = s && [...s.querySelectorAll('button')].find((x) => x.textContent.includes('Mark done') && !x.disabled); if (!b) return false; b.click(); return true; })()`);
        if (!clicked) return ['the card has no enabled Mark done button'];
        if (!await t.waitFor(`WHQ.app.logic.state.completed.includes(${JSON.stringify(want.id)})`, 4000)) out.push('Mark done did not complete ' + want.id);
        // and the card moves on at once: the done task is no longer the one it shows (it is filtered for a moment, then the scan data decides)
        if (!await t.waitFor(`!(${PAGE.nextText}).includes(${JSON.stringify(want.title)}) || !!(${REST_SEC})`, 1200)) out.push('the card still shows the task that was just done');
        if (!await t.waitFor(`${PAGE.toasts}.includes('Done')`, 4000)) out.push('no Done toast appeared: ' + String(await t.evaluate(PAGE.toasts)));
        // the write is deferred (the Undo window), then goes through the fake bridge for exactly this id
        if (!await t.waitFor(`hqFake.calls('markQuestDone').length >= 1`, 6000)) return out.concat('markQuestDone never reached the bridge');
        const calls = await t.evaluate(`hqFake.calls('markQuestDone').map((c) => c.args[0])`);
        if (calls.length !== 1 || calls[0] !== want.id) out.push('markQuestDone was called with ' + JSON.stringify(calls) + ', want [' + JSON.stringify(want.id) + ']');
        // the XP lands when the coin does
        if (!await t.waitFor(`WHQ.app.logic.state.xp > ${Number(xp0) || 0}`, 6000)) out.push('the XP did not rise after the task was marked done');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'home-one-no-motion'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const check = async (label) => {
        if (!await showHome(t)) { out.push(label + ': Home never showed the button'); return; }
        await clickMore(t);
        if (!await t.waitFor(`!!(${NODES.portfolio})`, 4000)) { out.push(label + ': opening never showed Portfolio'); return; }
        const open = await t.evaluate(PAGE.motion);
        if (!open || !open.region) out.push(label + ': the control names no region while open (aria-controls)');
        else if (open.bad.length) out.push(label + ': motion on ' + JSON.stringify(open.bad) + ' while open');
        await clickMore(t);
        await t.waitFor(`!(${NODES.portfolio})`, 4000);
        const closed = await t.evaluate(PAGE.motion);
        if (closed && closed.bad.length) out.push(label + ': motion on ' + JSON.stringify(closed.bad) + ' once closed');
      };
      try {
        await t.evaluate(`WHQ.app.logic.setState({ reduceMotion: true })`);
        await check('Reduce motion on');
        await t.evaluate(`WHQ.app.logic.setState({ reduceMotion: false })`);
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        if (!await t.evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)) out.push('the OS media query could not be emulated, so the second pass proves nothing');
        else await check('OS reduced-motion query');
        out.push(...t.errors());
      } finally {
        await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
        await leave(t);
      }
      return out;
    },

    async 'home-one-use-marks'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const arrive = async () => { await t.evaluate(`WHQ.app.logic.go('tasks')`); await pause(150); await t.evaluate(`WHQ.app.logic.go('home')`); await pause(700); };
      const marks = async () => JSON.parse(await t.evaluate(PAGE.uses)).filter((a) => MARKS.includes(a[0]));
      const count = (list, id) => list.filter((a) => a[0] === id).length;
      try {
        await t.evaluate(`WHQ.store.refreshBoard && WHQ.store.refreshBoard()`);
        if (!await showHome(t)) return ['Home never showed the button'];
        await t.evaluate(`hqFake.reset(false)`).catch(() => {});
        // 1. closed: nothing is counted as seen, however long Home stays
        await t.evaluate(`WHQ.store.refreshBoard && WHQ.store.refreshBoard()`);
        await arrive();
        await pause(500);
        const closed = await marks();
        if (closed.length) out.push('Home with the disclosure closed sent ' + JSON.stringify(closed));
        // 2. open: each block that is shown is counted once for this arrival
        await clickMore(t);
        if (!await t.waitFor(`!!(${NODES.ribbon})`, 6000)) return out.concat('the Today ribbon never showed with the disclosure open, so its mark cannot be checked');
        await pause(700);
        const stripShown = await t.evaluate(`!!(${NODES.strip})`);
        let open = await marks();
        if (count(open, 'today-ribbon') !== 1) out.push('opening sent the today-ribbon mark ' + count(open, 'today-ribbon') + ' times, want once: ' + JSON.stringify(open));
        if (count(open, 'sessions-strip') !== (stripShown ? 1 : 0)) out.push('opening sent the sessions-strip mark ' + count(open, 'sessions-strip') + ' times with the strip ' + (stripShown ? 'shown' : 'not shown') + ': ' + JSON.stringify(open));
        // 3. closing and opening again inside the same arrival does not count twice
        await clickMore(t); await pause(200); await clickMore(t); await pause(500);
        open = await marks();
        if (count(open, 'today-ribbon') !== 1) out.push('a second open in the same arrival sent today-ribbon ' + count(open, 'today-ribbon') + ' times in all');
        // 4. a new arrival with it closed counts nothing new
        await clickMore(t);
        await t.evaluate(`hqFake.reset(false)`).catch(() => {});
        await arrive();
        const again = await marks();
        if (again.length) out.push('a new arrival with the disclosure closed sent ' + JSON.stringify(again));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
