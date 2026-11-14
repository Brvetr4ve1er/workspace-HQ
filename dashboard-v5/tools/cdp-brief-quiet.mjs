// CDP scenarios for the unclogged Brief (batch 6, dish brief-unclog). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeBriefQuietScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario brief-group-row,brief-aged-slot,brief-quiet-lane   (needs --preload=fake)
//
// Each scenario serves its own PLACEHOLDER brief with hqFake.set('brief.read', ...) (the new fields, group / aged / quiet, are exactly the ones
// dashboard/brief-quiet.mjs adds; they are additive, so the fake's older fixtures are untouched) and ends with hqFake.reset(true) and Home shown.
// No template changes: the group, aged and quiet fields all ride in the existing bindings (i.meta, i.act, the existing Mark done button, brfStanding).
//
//   brief-group-row   a collapsed row reads "oldest since 7 Nov", its main button opens Projects > Grid (not one project), and the Commit... verb still
//                     reaches main for the row's own worst-project key and opens the commit overlay for that project
//   brief-aged-slot   two fresh rows plus an aged quest row (re-admitted from standing): the third slot shows it with a Mark done button, the others
//                     have none, and the standing line below no longer lists it
//   brief-quiet-lane  the quiet entry appears in the standing line with its own tip, never as a card; on an empty brief the empty text is unchanged
//                     ("Nothing needs you right now") and the line leads with "Quiet:"

const SEC = `document.querySelector('section[aria-label="Brief: what needs you now"]')`;
const ROWS = `[...((${SEC}) || document).querySelectorAll('[role="listitem"]')]`;
export const PAGE = Object.freeze({
  sec: SEC,
  rows: ROWS,
  texts: `${ROWS}.map((x) => x.textContent.replace(/\\s+/g, ' ').trim())`,
  // everything in the panel that is not one of the item cards: the standing line, the empty text, the footer
  outside: `(() => { const s = ${SEC}; if (!s) return ''; const c = s.cloneNode(true); c.querySelectorAll('[role="listitem"]').forEach((x) => x.remove()); return c.textContent.replace(/\\s+/g, ' ').trim(); })()`,
  buttons: (i) => `(() => { const it = ${ROWS}[${i}]; return it ? [...it.querySelectorAll('button')].map((b) => b.textContent.trim()) : []; })()`,
  click: (i, label) => `(() => { const it = ${ROWS}[${i}]; const b = it ? [...it.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}) : null; if (!b) return false; b.click(); return true; })()`,
  // a button OUTSIDE the cards (the standing line) by its tooltip text
  tipped: (needle) => `(() => { const s = ${SEC}; if (!s) return null; const b = [...s.querySelectorAll('button[title]')].find((x) => !x.closest('[role="listitem"]') && x.getAttribute('title').includes(${JSON.stringify(needle)})); return b ? { text: b.textContent.trim(), title: b.getAttribute('title') } : null; })()`,
  where: `JSON.stringify({ tab: WHQ.app.logic.state.tab, route: WHQ.app.logic.state.route || null, sub: (WHQ.app.logic.state.sub || {}).projects || null })`,
  calls: `hqFake.calls('brief.act')`,
  serve: (brief) => `(() => { const L = WHQ.app.logic; hqFake.set('brief.read', { brief: ${JSON.stringify(brief)} }); L.setState({ brfBusy: false, batOpen: null, batBal: '', batBusy: false, batDone: {}, toasts: [] }); L._brfBusy = false; L._batBusy = false; WHQ.store.refreshBrief(); L.go('home'); return true; })()`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L.setState({ brfBusy: false, batOpen: null, batBal: '', batBusy: false, batDone: {}, toasts: [], commit: null }); L._brfBusy = false; L._batBusy = false; WHQ.store.refreshBrief(); L.go('home'); return true; })()`,
});

const item = (key, severity, text, action, extra) => Object.assign({ key, rule: key.split(':')[0], severity, text, why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action, count: 0 }, extra || {});
export const DIRTY = 'dirty:p1:12', QUEST = 'quest-red:wq:acme-1';
export const SINCE = new Date(2026, 10, 7, 12, 0, 0).toISOString();   // local noon on 7 Nov, so its day word is "7 Nov" in any time zone
export const QUIET = Object.freeze({
  key: 'quiet:quiet-security-unstarted', rule: 'quiet-security-unstarted', kind: null, text: 'The Security walkthrough has not been started',
  why: 'The Security space has a setup walkthrough and nothing in it has been started.', source: 'security', age: 'not started', action: { kind: 'go', tab: 'security', sub: 'setup' },
});
export const briefOf = (parts) => Object.assign({ v: 1, generatedAt: '2026-11-14T09:00:00.000Z', items: [], overflow: [], standing: [], more: 0, errors: [], quiet: null }, parts);
export const groupRow = (pid) => item(DIRTY, 'low', 'Project A has 12 uncommitted files and 2 more projects', { kind: 'go', tab: 'projects', projectId: pid },
  { count: 2, group: { n: 3, sinceAt: SINCE, listAction: { kind: 'go', tab: 'projects', sub: 'grid' } } });
export const agedQuest = () => item(QUEST, 'high', 'Acme: rotate the leaked key', { kind: 'go', tab: 'tasks' }, { aged: { since: new Date(2026, 10, 9, 12, 0, 0).toISOString() } });
export const FRESH_A = item('scan-stale:2026-11-11', 'med', 'Scan data is 3 days old', { kind: 'scan' });
export const FRESH_B = item('claude-sync:0:never', 'low', "claude.ai chats aren't syncing", { kind: 'go', tab: 'claude', sub: 'chats' });
export const STANDING_LOW = Object.assign(item('dirty:p9:11', 'low', 'Project Z has 11 uncommitted files', { kind: 'go', tab: 'projects', projectId: 'p9' }), { since: new Date(2026, 10, 8, 12, 0, 0).toISOString() });

export function makeBriefQuietScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const show = async (t, brief, rows) => {
    await t.evaluate(PAGE.serve(brief));
    return t.waitFor(`${PAGE.rows}.length === ${rows}`, 8000);
  };
  return {
    async 'brief-group-row'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const pid = await t.evaluate(`(() => { const p = WHQ.app.logic.projectsAt(0).find((x) => x.hasGit); return p ? p.id : ''; })()`);
        if (!pid) return ['no git project in the page data to open the commit overlay for'];
        await t.evaluate(`hqFake.set('brief.act', () => ({ ok: true, open: 'commit', projectId: ${JSON.stringify(pid)} }))`);
        if (!await show(t, briefOf({ items: [groupRow(pid)] }), 1)) return ['the Brief never rendered the placeholder group row'];
        const text = String((await t.evaluate(PAGE.texts))[0] || '');
        if (!text.includes('oldest since 7 Nov')) out.push('the group row does not say "oldest since 7 Nov": ' + text);
        if (/undefined|\[object|NaN/.test(text)) out.push('an unresolved binding reached the row: ' + text);
        // 1. the main button opens the list, not one project
        const labels = await t.evaluate(PAGE.buttons(0));
        if (!labels.includes('Open Projects')) return out.concat('the group row has no "Open Projects" button: ' + JSON.stringify(labels));
        await t.evaluate(PAGE.click(0, 'Open Projects'));
        if (!await t.waitFor(`(${PAGE.where}.includes('"tab":"projects"'))`, 4000)) return out.concat('the main button did not open Projects');
        const where = JSON.parse(await t.evaluate(PAGE.where));
        if (where.route !== null) out.push('the main button opened one project, not the list: ' + JSON.stringify(where));
        if (where.sub !== 'grid') out.push('the main button did not land on Projects > Grid: ' + JSON.stringify(where));
        // 2. the row's own worst-project action still feeds the Commit verb
        await t.evaluate(PAGE.reset);   // hqFake.reset(true) also drops the brief.act answer set above: set it again
        await t.evaluate(`hqFake.set('brief.act', () => ({ ok: true, open: 'commit', projectId: ${JSON.stringify(pid)} }))`);
        if (!await show(t, briefOf({ items: [groupRow(pid)] }), 1)) return out.concat('the Brief did not come back for the Commit check');
        if (!(await t.evaluate(PAGE.buttons(0))).includes('Commit…')) return out.concat('the group row lost its Commit… button: ' + JSON.stringify(await t.evaluate(PAGE.buttons(0))));
        await t.evaluate(PAGE.click(0, 'Commit…'));
        if (!await t.waitFor(`!!(WHQ.app.logic.state.commit && WHQ.app.logic.state.commit.pid === ${JSON.stringify(pid)})`, 4000)) return out.concat('Commit… did not open the commit overlay for the row\'s own project ' + pid);
        const calls = await t.evaluate(`${PAGE.calls}.map((c) => c.args)`);
        if (JSON.stringify(calls) !== JSON.stringify([[DIRTY, 'commit']])) out.push('hq.brief.act calls ' + JSON.stringify(calls) + ', want one commit for ' + DIRTY);
        if (await t.evaluate(`hqFake.calls('doCommit').length`)) out.push('something was committed from the Brief');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-aged-slot'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await show(t, briefOf({ items: [FRESH_A, FRESH_B, agedQuest()], standing: [STANDING_LOW] }), 3)) return ['the Brief never rendered three rows (two fresh and the aged quest)'];
        const texts = await t.evaluate(PAGE.texts);
        if (!String(texts[2] || '').includes('Acme: rotate the leaked key')) out.push('the third slot is not the aged quest row: ' + texts[2]);
        if (!(await t.evaluate(PAGE.buttons(2))).includes('Mark done')) out.push('the aged quest row has no Mark done button: ' + JSON.stringify(await t.evaluate(PAGE.buttons(2))));
        for (const i of [0, 1]) if ((await t.evaluate(PAGE.buttons(i))).includes('Mark done')) out.push('a Mark done button sits on fresh row ' + i);
        const rest = String(await t.evaluate(PAGE.outside));
        if (rest.includes('Acme: rotate the leaked key')) out.push('the standing line still lists the aged quest: ' + rest.slice(0, 240));
        if (!rest.includes('Project Z has 11 uncommitted files')) out.push('the standing line lost the row that stayed in standing: ' + rest.slice(0, 240));
        if (/undefined|\[object|NaN/.test(texts.join(' ') + rest)) out.push('an unresolved binding reached the panel');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'brief-quiet-lane'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        // 1. one fresh row and the quiet line: still one card, the quiet entry is in the standing line with its own tip
        if (!await show(t, briefOf({ items: [FRESH_A], standing: [STANDING_LOW], quiet: QUIET }), 1)) return ['the Brief never rendered the one placeholder row'];
        const rows = await t.evaluate(`${PAGE.rows}.length`);
        if (rows !== 1) out.push('the quiet line became a card: ' + rows + ' rows');
        const q = await t.evaluate(PAGE.tipped('Quiet lane'));
        if (!q) return out.concat('the quiet entry is not in the standing line with its own tip: ' + String(await t.evaluate(PAGE.outside)).slice(0, 240));
        if (q.text !== QUIET.text) out.push('the quiet entry reads "' + q.text + '"');
        if (!q.title.includes('changes daily')) out.push('the quiet tip does not say it changes daily: ' + q.title);
        const real = await t.evaluate(PAGE.tipped('Standing since'));
        if (!real) out.push('the real standing row lost its own tip');
        const rest = String(await t.evaluate(PAGE.outside));
        if (!rest.includes('Standing')) out.push('the standing lead is gone while a real standing row exists: ' + rest.slice(0, 200));
        if (rest.indexOf('Project Z') > rest.indexOf(QUIET.text)) out.push('the quiet entry is not appended after the real standing rows');
        // 2. nothing else on the brief: the empty text is unchanged, the line leads with "Quiet:"
        await t.evaluate(PAGE.serve(briefOf({ items: [], standing: [], quiet: QUIET })));
        if (!await t.waitFor(`${PAGE.outside}.includes('Nothing needs you right now')`, 6000)) return out.concat('the empty text changed or vanished: ' + String(await t.evaluate(PAGE.outside)).slice(0, 240));
        await pause(100);
        const alone = String(await t.evaluate(PAGE.outside));
        if (!alone.includes('Quiet:')) out.push('the lone quiet line does not lead with "Quiet:": ' + alone.slice(0, 240));
        if (alone.includes('Standing since') || alone.includes('Standing, oldest since')) out.push('the lone quiet line borrowed a standing lead: ' + alone.slice(0, 240));
        if (!alone.includes(QUIET.text)) out.push('the lone quiet line is missing: ' + alone.slice(0, 240));
        if ((await t.evaluate(`${PAGE.rows}.length`)) !== 0) out.push('the quiet line became a card on an empty brief');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
