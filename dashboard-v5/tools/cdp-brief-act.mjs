// CDP scenarios for acting in place on a Brief row (batch 2, dish brief-act-waiting). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeBriefActScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario brief-act-done,brief-act-commit,brief-act-balance,brief-act-forged,brief-waiting-render   (needs --preload=fake)
//
// The fake preload answers hq.brief.act like main's table does (tools/fake-preload.js, 'brief.act'): the rule comes from the key's first segment, a key no
// rule owns is refused with main's own words, quest-done and confirm-balance answer an acted marker, commit answers { open:'commit', projectId }, open-folder
// answers { ok }. Each scenario serves its own placeholder brief with hqFake.set('brief.read', ...) and ends with hqFake.reset(true).
//
//   brief-act-done        Mark done on the quest row: the inline confirm, hq.brief.act called ONCE (a double click is one call), the row reads "Done ... clears when the next scan confirms"
//   brief-act-commit      Commit... on the dirty row opens the existing commit overlay for that project, its .env guard text intact; nothing is committed
//   brief-act-balance     Confirm balance: the inline field, a bad balance is refused before main, the typed balance reaches main exactly, the row reads done
//   brief-act-forged      a row whose key no rule owns: main refuses, the toast says so, the row does not read done
//   brief-waiting-render  the waiting-session row renders its honest text and an Open its folder button that reaches main once, and never says a title or a tool

const SEC = `document.querySelector('section[aria-label="Brief: what needs you now"]')`;
export const PAGE = Object.freeze({
  sec: SEC,
  rows: `[...((${SEC}) || document).querySelectorAll('[role="listitem"]')]`,
  texts: `[...((${SEC}) || document).querySelectorAll('[role="listitem"]')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim())`,
  btn: (i, label) => `(() => { const it = [...((${SEC}) || document).querySelectorAll('[role="listitem"]')][${i}]; return it ? [...it.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}) : null; })()`,
  click: (i, label) => `(() => { const it = [...((${SEC}) || document).querySelectorAll('[role="listitem"]')][${i}]; const b = it ? [...it.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}) : null; if (!b) return false; b.click(); return true; })()`,
  calls: `hqFake.calls('brief.act')`,
  toasts: `JSON.stringify((WHQ.app.logic.state.toasts || []))`,
  serve: (brief) => `(() => { const L = WHQ.app.logic; hqFake.set('brief.read', { brief: ${JSON.stringify(brief)} }); L.setState({ brfBusy: false, batOpen: null, batBal: '', batBusy: false, batDone: {}, toasts: [] }); L._brfBusy = false; L._batBusy = false; WHQ.store.refreshBrief(); L.go('home'); return true; })()`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L.setState({ brfBusy: false, batOpen: null, batBal: '', batBusy: false, batDone: {}, toasts: [], commit: null }); L._brfBusy = false; L._batBusy = false; WHQ.store.refreshBrief(); L.go('home'); return true; })()`,
});

const item = (key, severity, text, action, extra) => Object.assign({ key, rule: key.split(':')[0], severity, text, why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action, count: 0 }, extra || {});
export const QUEST = 'quest-red:wq:acme-1', STALE = 'money-stale:c1:2026-10-01T10:00:00.000Z', DIRTY = 'dirty:p1:12', WAIT = 'session-waiting:s-1:2026-11-05T08:00:00.000Z';
export const briefOf = (items) => ({ v: 1, generatedAt: '2026-11-05T09:00:00.000Z', items, overflow: [], standing: [], more: 0, errors: [] });
export const ITEMS = Object.freeze({
  quest: item(QUEST, 'high', 'Acme: rotate the leaked key', { kind: 'go', tab: 'tasks' }),
  stale: item(STALE, 'med', 'Confirm Cash — last confirmed 9 days ago', { kind: 'go', tab: 'money', sub: 'today' }, { source: 'money', age: 'live' }),
  dirty: item(DIRTY, 'low', 'Project A has 12 uncommitted files', { kind: 'go', tab: 'projects', projectId: 'p1' }),
  wait: item(WAIT, 'med', 'Acme Studio: a Claude session has waited on a tool for 40 min', { kind: 'go', tab: 'claude', sub: 'sessions' }, { source: 'claude-code', age: 'sessions board', why: 'It may be a long-running tool or a permission prompt. Check its own terminal window.' }),
});

export function makeBriefActScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const show = async (t, items) => {
    await t.evaluate(PAGE.serve(briefOf(items)));
    return t.waitFor(`${PAGE.rows}.length === ${items.length}`, 8000);
  };
  return {
    async 'brief-act-done'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await show(t, [ITEMS.quest, ITEMS.dirty])) return ['the Brief never rendered the two placeholder rows'];
        if (!await t.evaluate(PAGE.btn(0, 'Mark done') + ' ? true : false')) return ['the quest row has no Mark done button: ' + JSON.stringify(await t.evaluate(PAGE.texts))];
        if (await t.evaluate(PAGE.btn(1, 'Mark done') + ' ? true : false')) out.push('a Mark done button sits on the uncommitted-files row');
        await t.evaluate(PAGE.click(0, 'Mark done'));
        if (!await t.waitFor(`${PAGE.texts}[0].includes('Mark this quest done?')`, 3000)) return out.concat('Mark done did not ask first: ' + (await t.evaluate(PAGE.texts))[0]);
        if ((await t.evaluate(`${PAGE.calls}.length`)) !== 0) out.push('main was called before the owner confirmed');
        await t.evaluate(`(${PAGE.click(0, 'Mark done')}, ${PAGE.click(0, 'Mark done')})`);   // a double click on the confirm
        if (!await t.waitFor(`${PAGE.calls}.length >= 1`, 3000)) return out.concat('Mark done never reached main');
        await pause(250);
        const calls = await t.evaluate(`${PAGE.calls}.map((c) => c.args)`);
        if (JSON.stringify(calls) !== JSON.stringify([[QUEST, 'quest-done']])) out.push('hq.brief.act calls ' + JSON.stringify(calls) + ', want exactly one for ' + QUEST);
        if (!await t.waitFor(`${PAGE.texts}[0].includes('clears when the next scan confirms')`, 3000)) out.push('the row does not read done: ' + (await t.evaluate(PAGE.texts))[0]);
        if (await t.evaluate(PAGE.btn(0, 'Mark done') + ' ? true : false')) out.push('the done row still offers Mark done');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-act-commit'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        // main answers { open:'commit', projectId } from the item's own action: here the page's first git project, whose id the fake is told to hand back
        const pid = await t.evaluate(`(() => { const p = WHQ.app.logic.projectsAt(0).find((x) => x.hasGit); return p ? p.id : ''; })()`);
        if (!pid) return ['no git project in the page data to open the commit overlay for'];
        await t.evaluate(`hqFake.set('brief.act', () => ({ ok: true, open: 'commit', projectId: ${JSON.stringify(pid)} }))`);
        const dirty = Object.assign({}, ITEMS.dirty, { action: { kind: 'go', tab: 'projects', projectId: pid } });
        if (!await show(t, [ITEMS.quest, dirty])) return ['the Brief never rendered the two placeholder rows'];
        if (!await t.evaluate(PAGE.btn(1, 'Commit…') + ' ? true : false')) return ['the dirty row has no Commit… button: ' + JSON.stringify(await t.evaluate(PAGE.texts))];
        await t.evaluate(PAGE.click(1, 'Commit…'));
        if (!await t.waitFor(`!!(WHQ.app.logic.state.commit && WHQ.app.logic.state.commit.pid === ${JSON.stringify(pid)})`, 4000)) return out.concat('Commit… did not open the commit overlay for ' + pid);
        const calls = await t.evaluate(`${PAGE.calls}.map((c) => c.args)`);
        if (JSON.stringify(calls) !== JSON.stringify([[DIRTY, 'commit']])) out.push('hq.brief.act calls ' + JSON.stringify(calls) + ', want one commit for ' + DIRTY);
        if (!await t.waitFor(`document.body.textContent.includes('A .env file is in this change set')`, 4000)) out.push('the overlay lost its .env guard text');
        if (await t.evaluate(`hqFake.calls('doCommit').length`)) out.push('something was committed from the Brief');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-act-balance'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await show(t, [ITEMS.stale, ITEMS.dirty])) return ['the Brief never rendered the two placeholder rows'];
        await t.evaluate(PAGE.click(0, 'Confirm balance'));
        const field = `document.querySelector('input[aria-label="Balance you see in the account"]')`;
        if (!await t.waitFor(`!!${field}`, 3000)) return out.concat('Confirm balance did not open the inline balance field');
        const type = (v) => `(() => { const el = ${field}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
        await t.evaluate(type('abc'));
        await t.evaluate(PAGE.click(0, 'Confirm balance'));
        await pause(250);
        if ((await t.evaluate(`${PAGE.calls}.length`)) !== 0) out.push('a balance of "abc" reached main');
        if (!await t.waitFor(`${PAGE.toasts}.includes('Not saved')`, 2000)) out.push('a bad balance was not refused out loud');
        await t.evaluate(type('2 500'));
        await t.evaluate(PAGE.click(0, 'Confirm balance'));
        if (!await t.waitFor(`${PAGE.calls}.length >= 1`, 3000)) return out.concat('the typed balance never reached main');
        await pause(250);
        const calls = await t.evaluate(`${PAGE.calls}.map((c) => c.args)`);
        if (JSON.stringify(calls) !== JSON.stringify([[STALE, 'confirm-balance', '2 500']])) out.push('hq.brief.act calls ' + JSON.stringify(calls) + ', want one confirm-balance with "2 500"');
        if (!await t.waitFor(`${PAGE.texts}[0].includes('clears when the next scan confirms')`, 3000)) out.push('the row does not read done: ' + (await t.evaluate(PAGE.texts))[0] + ' | state ' + await t.evaluate(`JSON.stringify((({ batOpen, batBusy, batDone, batBal }) => ({ batOpen, batBusy, batDone, batBal }))(WHQ.app.logic.state)) + ' toasts ' + ${PAGE.toasts}`));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-act-forged'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        // a quest row whose key no rule owns: what a forged or stale key looks like to main
        const forged = Object.assign({}, ITEMS.quest, { key: 'forged-key', rule: 'quest-red' });
        if (!await show(t, [forged, ITEMS.dirty])) return ['the Brief never rendered the two placeholder rows'];
        await t.evaluate(PAGE.click(0, 'Mark done'));
        if (!await t.waitFor(`${PAGE.texts}[0].includes('Mark this quest done?')`, 3000)) return out.concat('Mark done did not ask first');
        await t.evaluate(PAGE.click(0, 'Mark done'));
        if (!await t.waitFor(`${PAGE.calls}.length >= 1`, 3000)) return out.concat('the click never reached the bridge');
        if (!await t.waitFor(`${PAGE.toasts}.includes('not on the brief any more')`, 3000)) out.push('main’s refusal was not shown: ' + await t.evaluate(PAGE.toasts));
        if (await t.evaluate(`${PAGE.texts}[0].includes('clears when the next scan confirms')`)) out.push('a refused row reads done');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-waiting-render'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await show(t, [ITEMS.wait, ITEMS.quest])) return ['the Brief never rendered the two placeholder rows'];
        const txt = (await t.evaluate(PAGE.texts))[0];
        for (const w of ['a Claude session has waited on a tool for 40 min', 'long-running tool or a permission prompt', 'Open its folder', 'Open Claude']) if (!txt.includes(w)) out.push('the waiting row lacks "' + w + '": ' + txt);
        await t.evaluate(PAGE.click(0, 'Open its folder'));
        if (!await t.waitFor(`${PAGE.calls}.length >= 1`, 3000)) return out.concat('Open its folder never reached main');
        await pause(200);
        const calls = await t.evaluate(`${PAGE.calls}.map((c) => c.args)`);
        if (JSON.stringify(calls) !== JSON.stringify([[WAIT, 'open-folder']])) out.push('hq.brief.act calls ' + JSON.stringify(calls) + ', want one open-folder for ' + WAIT);
        if (await t.evaluate(`${PAGE.texts}[0].includes('Done')`)) out.push('opening a folder marked the row done');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
