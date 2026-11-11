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

const OP = `document.querySelector('section[aria-label="Operator: what the Brief noticed"]')`;
const CARD = `document.querySelector('section[aria-label="Brief: all clear"]')`;
const PANEL = `document.querySelector('section[aria-label="Brief: what needs you now"]')`;
export const PAGE = Object.freeze({
  opSec: OP,
  opRows: `(${OP} ? [...${OP}.querySelectorAll('[role="listitem"]')] : [])`,
  opTexts: `(${OP} ? [...${OP}.querySelectorAll('[role="listitem"]')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()) : [])`,
  opText: `(${OP} ? ${OP}.textContent.replace(/\\s+/g, ' ').trim() : '')`,
  cardSec: CARD,
  cardText: `(${CARD} ? ${CARD}.textContent.replace(/\\s+/g, ' ').trim() : '')`,
  ackBtn: `(${CARD} ? [...${CARD}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Got it') : null)`,
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
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L.setState({ bhsLoaded: false, bhsData: null, bhsErr: '', bhsBusy: false, toasts: [] }); L._bhsSig = null; L._bhsReading = false; L._bhsAcking = false; L._bhsHold = false; delete window.__bhs; WHQ.store.refreshBrief(); L.go('home'); return true; })()`,
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
  };
}
