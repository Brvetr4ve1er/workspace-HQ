// CDP scenarios for the Brief history (batch 3, dish brief-history). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeBriefHistoryScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario brief-history-render,brief-history-all-clear   (needs --preload=fake)
//
// The fake preload answers hq.briefHistory.read / .ack (tools/fake-preload.js SPEC rows 'briefHistory.read' and 'briefHistory.ack'; the shapes are in
// IPC-CONTRACT). Each scenario serves its own PLACEHOLDER answers with hqFake.set(...) (counting reads and acks in the page, so it does not depend on how
// the fake logs an overridden method) and ends with hqFake.reset(true) and Home shown.
//
//   brief-history-render     History > Timeline shows the Operator section: one row per entry, each ending in words; a silent or changed close is never worded
//                            as resolved or fixed; nothing is written just by looking
//   brief-history-all-clear  the card is hidden while the brief on screen has an item; with the brief empty it shows what got resolved plus the
//                            "cleared this week" footer; "Got it" sends ONE ack and the card goes; a later read (a new brief) does not bring it back
//   brief-history-strip      (batch 8) the strip on the Brief panel shows plain counts (week one reads "0 still gone after 72 hours"; a busy week shows held, kinds, oldest open, set aside, outside),
//                            in History too with the set-aside rows and their age; no score or total; looking sends no ack
//   brief-history-clean-card (batch 8) an empty Brief says "Board clean since ..." only with nothing open, outside or set aside; set-aside rows make it "Nothing new needs you,
//                            N set aside" and name the high-severity ones; a Brief with a row shows no card; the card has no button and sends nothing
//   brief-history-settings   (batch 8) Settings shows the same counts one per row, read-only (no button, no input), after ONE read when opened from another screen

const OP = `document.querySelector('section[aria-label="Operator: what the Brief noticed"]')`;
const CARD = `document.querySelector('section[aria-label="Brief: all clear"]')`;
const PANEL = `document.querySelector('section[aria-label="Brief: what needs you now"]')`;
const STRIP = `document.querySelector('[aria-label="Brief: this week"]')`;
const HSTRIP = `document.querySelector('[aria-label="Brief history: this week"]')`;
const CLEAN = `document.querySelector('section[aria-label="Brief: board clean"]')`;
const SETS = `document.querySelector('section[aria-label="Brief history counts"]')`;
const flat = (el) => `(${el} ? ${el}.innerText.replace(/\\s+/g, ' ').trim() : '')`;
export const PAGE = Object.freeze({
  opSec: OP,
  opRows: `(${OP} ? [...${OP}.querySelectorAll('[role="listitem"]')] : [])`,
  opTexts: `(${OP} ? [...${OP}.querySelectorAll('[role="listitem"]')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()) : [])`,
  opText: `(${OP} ? ${OP}.textContent.replace(/\\s+/g, ' ').trim() : '')`,
  cardSec: CARD,
  cardText: `(${CARD} ? ${CARD}.textContent.replace(/\\s+/g, ' ').trim() : '')`,
  ackBtn: `(${CARD} ? [...${CARD}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Got it') : null)`,
  stripText: flat(STRIP),
  hstripText: flat(HSTRIP),
  cleanSec: CLEAN,
  cleanText: flat(CLEAN),
  cleanButtons: `(${CLEAN} ? ${CLEAN}.querySelectorAll('button').length : -1)`,
  setSec: SETS,
  setText: flat(SETS),
  setControls: `(${SETS} ? ${SETS}.querySelectorAll('button,input,select,textarea,a').length : -1)`,
  openSettings: `(() => { WHQ.app.logic.setState({ settingsOpen: true }); return true; })()`,
  panelText: `(${PANEL} ? ${PANEL}.textContent.replace(/\\s+/g, ' ').trim() : '')`,
  reads: `(window.__bhs ? window.__bhs.reads : 0)`,
  acks: `(window.__bhs ? window.__bhs.acks : 0)`,
  // serve: the read answer (a JSON value, or null for allClear-after-ack logic below), counting reads and acks in the page
  serve: (answer, brief) => `(() => {
    const L = WHQ.app.logic;
    window.__bhs = { reads: 0, acks: 0 };
    const answer = ${JSON.stringify(answer)};
    hqFake.set('briefHistory.read', () => { window.__bhs.reads++; return window.__bhs.acks > 0 ? Object.assign({}, answer, { allClear: null }) : answer; });
    hqFake.set('briefHistory.ack', () => { window.__bhs.acks++; return { ok: true, acked: true }; });
    hqFake.set('brief.read', { brief: ${JSON.stringify(brief)} });
    L.setState({ bhsLoaded: false, bhsData: null, bhsErr: '', bhsBusy: false, toasts: [] });
    L._bhsSig = null; L._bhsReading = false; L._bhsAcking = false; L._bhsHold = false;
    WHQ.store.refreshBrief();
    return true;
  })()`,
  rebrief: (brief) => `(() => { hqFake.set('brief.read', { brief: ${JSON.stringify(brief)} }); WHQ.store.refreshBrief(); return true; })()`,
  go: (tab, sub) => `(() => { WHQ.app.logic.go(${JSON.stringify(tab)}${sub ? ', ' + JSON.stringify(sub) : ''}); return true; })()`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L.setState({ bhsLoaded: false, bhsData: null, bhsErr: '', bhsBusy: false, settingsOpen: false, toasts: [] }); L._bhsSig = null; L._bhsReading = false; L._bhsAcking = false; L._bhsHold = false; delete window.__bhs; WHQ.store.refreshBrief(); L.go('home'); return true; })()`,
});

const iso = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();
export const ENTRY_WORDS = Object.freeze({
  open: 'still open', resolved: 'resolved', acted: 'acted on', dismissed: 'dismissed', changed: 'a newer version of it took its place', silent: 'went quiet',
});
export const ANSWER = Object.freeze({
  entries: [
    { text: 'A bill is late', rule: 'money-late', severity: 'high', first: iso(10, 7, 30), ended: null, how: 'open', after: '1 h' },
    { text: 'Work not pushed', rule: 'unpushed', severity: 'med', first: iso(3, 9, 12), ended: iso(5, 9, 40), how: 'resolved', after: '2 d' },
    { text: 'A production deploy failed', rule: 'prod-deploy-error', severity: 'high', first: iso(4, 14, 0), ended: iso(4, 16, 20), how: 'acted', after: '2 h' },
    { text: 'Secrets in plain sight', rule: 'secrets', severity: 'high', first: iso(2, 8, 0), ended: iso(6, 8, 5), how: 'dismissed', after: '4 d' },
    { text: 'CI failing on 3 repos', rule: 'ci-red', severity: 'med', first: iso(5, 11, 0), ended: iso(6, 12, 0), how: 'changed', after: '1 d' },
    { text: 'An account needs confirming', rule: 'money-stale', severity: 'med', first: iso(1, 10, 0), ended: iso(3, 10, 0), how: 'silent', after: '2 d' },
  ],
  clearedThisWeek: 2, dismissedThisWeek: 1, allClear: null, notice: '',
});
// batch 8: what main adds (counts only; IPC-CONTRACT "briefHistory.read"). ZERO_COUNTS is week one; BUSY_COUNTS a week with some of everything.
export const ZERO_COUNTS = Object.freeze({ clears: { inPlace: 0, markedDone: 0, scanConfirmed: 0, unknown: 0 }, heldThisWeek: 0, pendingNow: 0, cameBackThisWeek: 0, openCount: 0, oldestOpen: null, outside: { count: 0, rules: [] }, setAside: { count: 0, oldest: null, items: [] } });
export const ASIDE_ITEMS = Object.freeze([{ text: 'A bill is late', rule: 'money-late', severity: 'high', first: iso(1, 9, 0), after: '9 d' }, { text: 'Work not pushed', rule: 'unpushed', severity: 'med', first: iso(3, 9, 0), after: '7 d' }]);
export const BUSY_COUNTS = Object.freeze({ clearedThisWeek: 5, clears: { inPlace: 2, markedDone: 1, scanConfirmed: 1, unknown: 1 }, heldThisWeek: 2, pendingNow: 1, cameBackThisWeek: 1, openCount: 2, oldestOpen: { since: iso(6, 9, 0), after: '4 d' }, outside: { count: 1, rules: ['pc-ember'] }, setAside: { count: 2, oldest: { since: iso(1, 9, 0), after: '9 d' }, items: ASIDE_ITEMS } });
export const withCounts = (o) => Object.assign({ entries: [], clearedThisWeek: 0, dismissedThisWeek: 0, allClear: null, notice: '' }, ZERO_COUNTS, o || {});
export const CLEAR_ANSWER = Object.freeze({
  entries: [], clearedThisWeek: 2, dismissedThisWeek: 1, notice: '',
  allClear: { since: iso(10, 8, 50), resolved: [{ text: 'Work not pushed', after: '2 d', how: 'resolved', ended: iso(10, 8, 50) }, { text: 'A bill is late', after: '5 h', how: 'acted', ended: iso(10, 8, 50) }] },
});
const itemRow = { key: 'dirty:placeholder-a:12', rule: 'dirty', severity: 'low', text: 'Project A has 12 uncommitted files', why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action: { kind: 'scan' }, count: 0 };
export const briefOf = (items) => ({ v: 1, generatedAt: new Date().toISOString(), items, overflow: [], standing: [], more: 0, errors: [] });

export function makeBriefHistoryScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  return {
    async 'brief-history-render'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.serve(ANSWER, briefOf([itemRow])));
        await t.evaluate(PAGE.go('history', 'timeline'));
        if (!await t.waitFor(`${PAGE.opRows}.length === ${ANSWER.entries.length}`, 8000)) return out.concat('the Operator section never showed ' + ANSWER.entries.length + ' rows: ' + String(await t.evaluate(PAGE.opText)).slice(0, 300));
        const texts = await t.evaluate(PAGE.opTexts);
        const want = ['open', 'resolved', 'acted', 'dismissed', 'changed', 'silent'];
        want.forEach((how, i) => { if (!String(texts[i] || '').includes(ENTRY_WORDS[how])) out.push('row ' + i + ' does not say "' + ENTRY_WORDS[how] + '": ' + texts[i]); });
        for (const i of [4, 5]) if (/resolved|fixed/i.test(String(texts[i] || ''))) out.push('a ' + want[i] + ' close is worded as resolved or fixed: ' + texts[i]);
        if (!String(texts[1] || '').includes('Work not pushed: noticed')) out.push('the resolved row lacks its noticed time: ' + texts[1]);
        const all = String(await t.evaluate(PAGE.opText));
        if (!all.includes('operator · what the Brief noticed')) out.push('the section heading is missing: ' + all.slice(0, 120));
        if (!all.includes('2 cleared this week · 1 dismissed')) out.push('the summary does not count cleared and dismissed apart: ' + all.slice(-160));
        if (/undefined|\[object|NaN/.test(all)) out.push('an unresolved binding reached the section text');
        if ((await t.evaluate(PAGE.reads)) < 1) out.push('the section never read the history');
        if ((await t.evaluate(PAGE.acks)) !== 0) out.push('something was acknowledged just by looking');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-history-all-clear'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        // 1. main says "all clear" but the brief on screen has an item: the second look hides the card
        await t.evaluate(PAGE.serve(CLEAR_ANSWER, briefOf([itemRow])));
        await t.evaluate(PAGE.go('home'));
        if (!await t.waitFor(`${PAGE.reads} >= 1`, 6000)) return out.concat('Home never read the history');
        await pause(150);
        if (await t.evaluate(`!!${PAGE.cardSec}`)) out.push('the all-clear card shows while the brief has an item');
        // 2. the brief empties: the card appears with what got resolved, and the footer counts apart
        await t.evaluate(PAGE.rebrief(briefOf([])));
        if (!await t.waitFor(`!!${PAGE.cardSec}`, 8000)) return out.concat('the card never appeared on an empty brief: ' + String(await t.evaluate(PAGE.panelText)).slice(0, 300));
        const card = String(await t.evaluate(PAGE.cardText));
        for (const w of ['All clear', 'Work not pushed', 'resolved', 'A bill is late', 'acted on', 'Clear since']) if (!card.includes(w)) out.push('the card lacks "' + w + '": ' + card.slice(0, 300));
        if (/undefined|\[object|NaN/.test(card)) out.push('an unresolved binding reached the card');
        const panel = String(await t.evaluate(PAGE.panelText));
        if (!panel.includes('2 cleared this week · 1 dismissed')) out.push('the footer does not count cleared and dismissed apart: ' + panel.slice(-200));
        if ((await t.evaluate(PAGE.acks)) !== 0) out.push('the card was acknowledged before the owner clicked');
        // 3. Got it: one ack, the card goes
        if (!await t.evaluate(`!!${PAGE.ackBtn}`)) return out.concat('the card has no Got it button');
        await t.evaluate(`(() => { const b = ${PAGE.ackBtn}; b.click(); b.click(); return true; })()`);   // a double click is one write
        if (!await t.waitFor(`!${PAGE.cardSec}`, 4000)) return out.concat('the card did not go after Got it');
        await pause(200);
        if ((await t.evaluate(PAGE.acks)) !== 1) out.push('Got it sent ' + (await t.evaluate(PAGE.acks)) + ' acks, want exactly 1');
        // 4. a new brief arrives (and so a new read): the card does not come back
        await t.evaluate(PAGE.rebrief(Object.assign(briefOf([]), { generatedAt: new Date(Date.now() + 1000).toISOString() })));
        await pause(400);
        if (await t.evaluate(`!!${PAGE.cardSec}`)) out.push('the card came back after it was acknowledged');
        if ((await t.evaluate(PAGE.acks)) !== 1) out.push('a later read acknowledged again');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-history-strip'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        // week one: nothing yet, and it says so in plain words
        await t.evaluate(PAGE.serve(withCounts(), briefOf([itemRow])));
        await t.evaluate(PAGE.go('home'));
        if (!await t.waitFor(PAGE.stripText + '.length > 0', 8000)) return out.concat('the strip never showed on Home: ' + String(await t.evaluate(PAGE.panelText)).slice(-200));
        const one = String(await t.evaluate(PAGE.stripText));
        if (!one.includes('0 cleared this week · 0 still gone after 72 hours')) out.push('week one does not read "0 still gone after 72 hours": ' + one);
        // a busy week: every count in plain words, no score
        await t.evaluate(PAGE.serve(withCounts(BUSY_COUNTS), briefOf([itemRow])));
        await t.evaluate(PAGE.go('system')); await pause(150);
        await t.evaluate(PAGE.go('home'));
        if (!await t.waitFor(PAGE.stripText + ".includes('5 cleared this week')", 8000)) return out.concat('the strip never showed the busy week: ' + String(await t.evaluate(PAGE.stripText)));
        const busy = String(await t.evaluate(PAGE.stripText));
        for (const w of ['5 cleared this week · 2 still gone after 72 hours', '1 waiting out the hold', '1 came back', '2 in place', '1 marked done', '1 confirmed by a scan', '1 source cannot confirm', '2 open · oldest 4 d (since the app first noticed it)', '2 set aside, the oldest 9 d', 'waiting on something outside the app']) if (!busy.includes(w)) out.push('the strip lacks "' + w + '": ' + busy);
        if (/score|total|level|xp|streak|%|undefined|\[object|NaN/i.test(busy)) out.push('the strip reads like a score or leaks a binding: ' + busy);
        if (/ dismissed/.test(String(await t.evaluate(PAGE.panelText)))) out.push('the old footer line still shows beside the strip');
        // History > Timeline: the same counts, and the set-aside rows with their age
        await t.evaluate(PAGE.go('history', 'timeline'));
        if (!await t.waitFor(PAGE.hstripText + ".includes('5 cleared this week')", 8000)) return out.concat('History never showed the strip: ' + String(await t.evaluate(PAGE.opText)).slice(0, 300));
        const op = String(await t.evaluate(PAGE.opText));
        for (const w of ['Set aside, not cleared', 'A bill is late · set aside 9 d', 'Work not pushed · set aside 7 d']) if (!op.includes(w)) out.push('History lacks "' + w + '": ' + op.slice(-300));
        if ((await t.evaluate(PAGE.acks)) !== 0) out.push('something was acknowledged just by looking');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-history-clean-card'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const resolved = [{ text: 'Work not pushed', rule: 'unpushed', severity: 'med', first: iso(3, 9, 12), ended: iso(5, 9, 40), how: 'resolved', after: '2 d' }];
        // a row on the Brief: no card, whatever the counts say
        await t.evaluate(PAGE.serve(withCounts({ entries: resolved }), briefOf([itemRow])));
        await t.evaluate(PAGE.go('home'));
        if (!await t.waitFor(PAGE.reads + ' >= 1', 6000)) return out.concat('Home never read the history');
        await pause(200);
        if (await t.evaluate('!!' + PAGE.cleanSec)) out.push('the clean card shows while the Brief has a row');
        // empty Brief, nothing open, outside or set aside: "Board clean since ..."
        await t.evaluate(PAGE.rebrief(briefOf([])));
        if (!await t.waitFor('!!' + PAGE.cleanSec, 8000)) return out.concat('the clean card never appeared on an empty Brief: ' + String(await t.evaluate(PAGE.panelText)).slice(0, 300));
        const clean = String(await t.evaluate(PAGE.cleanText));
        if (!/^Board clean since [A-Z][a-z]{2} [0-9]{2}:[0-9]{2}/.test(clean)) out.push('the clean card does not say since when: ' + clean);
        if ((await t.evaluate(PAGE.cleanButtons)) !== 0) out.push('the clean card has a button, it should have nothing to click');
        // set-aside rows: not clean, say how many, name the high-severity ones
        await t.evaluate(PAGE.serve(withCounts({ entries: resolved, setAside: { count: 2, oldest: { since: iso(1, 9, 0), after: '9 d' }, items: ASIDE_ITEMS } }), briefOf([])));
        await t.evaluate(PAGE.go('system')); await pause(150);
        await t.evaluate(PAGE.go('home'));
        if (!await t.waitFor(PAGE.cleanText + ".includes('set aside')", 8000)) return out.concat('the card never said rows were set aside: ' + String(await t.evaluate(PAGE.cleanText)));
        const aside = String(await t.evaluate(PAGE.cleanText));
        if (!aside.includes('Nothing new needs you, 2 set aside')) out.push('the card does not say "Nothing new needs you, 2 set aside": ' + aside);
        if (!aside.includes('A bill is late · set aside 9 d')) out.push('the card does not name the high-severity set-aside row: ' + aside);
        if (aside.includes('Work not pushed')) out.push('a medium row is named on the card');
        if (/Board clean/.test(aside)) out.push('set-aside rows still read as a clean board: ' + aside);
        // a rule that never steps aside, set aside: never the clean line
        await t.evaluate(PAGE.serve(withCounts({ setAside: { count: 1, oldest: { since: iso(2, 9, 0), after: '8 d' }, items: [{ text: 'Secrets in plain sight', rule: 'secrets', severity: 'high', first: iso(2, 9, 0), after: '8 d' }] } }), briefOf([])));
        await t.evaluate(PAGE.go('system')); await pause(150);
        await t.evaluate(PAGE.go('home'));
        if (!await t.waitFor(PAGE.cleanText + ".includes('1 set aside')", 8000)) out.push('a set-aside secrets row did not stop the clean line: ' + String(await t.evaluate(PAGE.cleanText)));
        if ((await t.evaluate(PAGE.acks)) !== 0) out.push('the card acknowledged something');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-history-settings'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.serve(withCounts(BUSY_COUNTS), briefOf([itemRow])));
        await t.evaluate(PAGE.go('system')); await pause(400);
        const before = Number(await t.evaluate(PAGE.reads));
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(PAGE.setText + ".includes('Cleared this week')", 8000)) return out.concat('Settings never showed the counts: ' + String(await t.evaluate(PAGE.setText)).slice(0, 300));
        const txt = String(await t.evaluate(PAGE.setText));
        for (const w of ['Cleared this week 5', 'Held (still gone after 72 hours) 2', 'Waiting out the hold 1', 'Came back inside the hold 1', 'Cleared in place 2', 'Marked done 1', 'Confirmed by a scan 1', 'Source cannot confirm 1', 'Open now 2', 'Oldest open 4 d', 'Set aside 2, the oldest 9 d', 'Waiting on something outside the app 1', 'A bill is late · set aside 9 d', 'no score']) if (!txt.includes(w)) out.push('Settings lacks "' + w + '": ' + txt);
        if (/undefined|\[object|NaN/.test(txt)) out.push('an unresolved binding reached Settings');
        if ((await t.evaluate(PAGE.setControls)) !== 0) out.push('the counts block has ' + (await t.evaluate(PAGE.setControls)) + ' controls, it is read-only');
        await pause(300);
        const after = Number(await t.evaluate(PAGE.reads)) - before;
        if (after !== 1) out.push('opening Settings read the history ' + after + ' times, want 1');
        if ((await t.evaluate(PAGE.acks)) !== 0) out.push('something was acknowledged just by looking');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
