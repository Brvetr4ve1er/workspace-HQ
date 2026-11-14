// CDP scenarios for the foldable surfaces (batch 7, subtraction): Settings > "Show everything", the rail, the sub bars, the number keys and the
// use marks while something is folded. cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeFoldScenarios({ fresh, sleep }));
// This file imports only the two pure catalog / foldable modules (never cdp-gate.mjs; the helpers are passed in) and does nothing on import:
// no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario fold-default-shows-everything,fold-hides-and-reveals,fold-number-keys-stable,fold-use-marks,fold-no-motion,fold-reload-persists   (needs --preload=fake)
//
// The two renderer prefs are the component state keys `foldIds` (an array of ids from src/live/foldable.mjs FOLDABLE) and `showEverything`,
// saved in whq3-prefs. The shipped MEASURED_ZERO_14D list is empty, so a scenario folds things through foldIds (setState, or the pref written
// before a reload). Each scenario ends with hqFake.reset(true), both prefs removed, Settings and the palette closed and the app back on Home.
//
//   fold-default-shows-everything  the shipped (empty) fold list: the rail shows all eleven spaces with their number keys, every sub bar is
//                                  complete, and Settings has no Show-everything row
//   fold-hides-and-reveals         foldIds ['projects/archived','life'] written before a reload: Life is gone from the rail, Archived from
//                                  the Projects sub bar, Settings shows "Show everything" naming both; on brings both back, off hides them;
//                                  the Go palette and a direct route still reach them
//   fold-number-keys-stable        Life folded: the other spaces keep their own digits (Money 9, Cosmos 0) and the keys still go to the same
//                                  spaces as unfolded, Life included
//   fold-use-marks                 opening Projects > Archived sends one projects-archived mark per arrival (a re-render sends none) and none
//                                  while it is folded
//   fold-no-motion                 Reduce motion on: nothing on the new Settings row has a transition or an animation, before or after the switch
//   fold-reload-persists           foldIds and showEverything survive a reload (both prefs read back from whq3-prefs, and the rail agrees)
//
// In-page snippets that change something start with an `/*op:name {json}*/` comment, so a plain-Node test can tell what a scenario asked for.
import { NAV, SUBS } from '../src/live/catalog.mjs';
import { navDigit } from '../src/live/foldable.mjs';

const op = (name, args) => `/*op:${name} ${JSON.stringify(args === undefined ? null : args)}*/ `;
const SET = `document.querySelector('[role="dialog"][aria-label="Settings"]')`;
const PAL = `document.querySelector('[role="dialog"][aria-label="Search and commands"]')`;
const ROW = `(() => { const d = ${SET}; if (!d) return null; return [...d.querySelectorAll('button[role="switch"]')].find((b) => b.parentElement.textContent.includes('Show everything')) || null; })()`;
const L = `WHQ.app.logic`;

export const PAGE = Object.freeze({
  op,
  railTitles: `[...document.querySelectorAll('nav[aria-label="Destinations"] button[title]')].map((b) => b.getAttribute('title')).filter((x) => !/^Keyboard shortcuts/.test(x))`,
  subTabs: `(() => { const tl = document.querySelector('[role="tablist"]'); return tl ? [...tl.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim()) : []; })()`,
  settingsOpen: `!!${SET}`,
  row: `(() => { const b = ${ROW}; return b ? { text: b.parentElement.textContent.replace(/\\s+/g, ' ').trim(), state: b.textContent.trim() } : null; })()`,
  clickSwitch: op('clickSwitch') + `(() => { const b = ${ROW}; if (!b) return false; b.click(); return true; })()`,
  rowMotion: `(() => { const b = ${ROW}; if (!b) return -1; const row = b.parentElement; return [row, ...row.querySelectorAll('*')].filter((el) => { const cs = getComputedStyle(el); return cs.transitionDuration.split(',').some((x) => parseFloat(x) > 0) || (cs.animationName && cs.animationName !== 'none'); }).length; })()`,
  prefs: `(() => { try { const p = JSON.parse(localStorage.getItem('whq3-prefs') || '{}') || {}; return { foldIds: p.foldIds === undefined ? null : p.foldIds, showEverything: p.showEverything === undefined ? null : p.showEverything }; } catch (e) { return null; } })()`,
  where: `(() => { const S = ${L}.state; return { tab: S.tab, sub: (S.sub && S.sub[S.tab]) || null, subs: Object.assign({}, S.sub) }; })()`,
  state: `(() => { const S = ${L}.state; return { foldIds: S.foldIds === undefined ? null : S.foldIds, showEverything: S.showEverything === undefined ? null : S.showEverything }; })()`,
  marks: `hqFake.calls('use').filter((c) => c.args[0] === 'projects-archived').map((c) => c.args.join('/'))`,
  paletteText: `(${PAL} ? ${PAL}.textContent.replace(/\\s+/g, ' ') : '')`,
  setFold: (ids, show) => op('setFold', { ids, show }) + `(() => { ${L}.setState({ foldIds: ${JSON.stringify(ids)}, showEverything: ${!!show} }); return true; })()`,
  prefsWrite: (ids) => op('prefsWrite', { ids }) + `(() => { try { const p = JSON.parse(localStorage.getItem('whq3-prefs') || '{}') || {}; p.foldIds = ${JSON.stringify(ids)}; delete p.showEverything; localStorage.setItem('whq3-prefs', JSON.stringify(p)); return true; } catch (e) { return false; } })()`,
  go: (tab, sub) => op('go', { tab, sub: sub || null }) + `(() => { ${L}.go(${JSON.stringify(tab)}${sub ? ', ' + JSON.stringify(sub) : ''}); return true; })()`,
  settings: (open) => op('settings', { open: !!open }) + `(() => { ${L}.setState({ settingsOpen: ${!!open}, paletteOpen: false }); return true; })()`,
  palette: (open, query) => op('palette', { open: !!open, query: query || '' }) + `(() => { ${L}.setState({ paletteOpen: ${!!open}, paletteMode: 'go', paletteQuery: ${JSON.stringify(query || '')}, paletteSel: 0, settingsOpen: false }); return true; })()`,
  paletteClick: (label) => op('paletteClick', { label }) + `(() => { const d = ${PAL}; if (!d) return false; const b = [...d.querySelectorAll('button')].find((x) => x.children[1] && x.children[1].textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`,
  key: (k) => op('key', { key: k }) + `(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); return true; })()`,
  reduce: (on) => op('reduce', { on: !!on }) + `(() => { ${L}.setState({ reduceMotion: ${!!on} }); return true; })()`,
  reset: op('reset') + `(() => { try { const p = JSON.parse(localStorage.getItem('whq3-prefs') || '{}') || {}; delete p.foldIds; delete p.showEverything; localStorage.setItem('whq3-prefs', JSON.stringify(p)); } catch (e) {} hqFake.reset(true); ${L}.setState({ foldIds: [], showEverything: false, settingsOpen: false, paletteOpen: false, reduceMotion: false, toasts: [], route: null }); ${L}.go('home'); return true; })()`,
});

/** What the rail's buttons are titled when nothing is folded: "Home (1)" ... "Money (9)", "Cosmos (0)", "Security" (the 11th has no key). */
export const railTitle = (n, i) => n.label + (i < 10 ? ' (' + navDigit(i) + ')' : '');
export const ALL_TITLES = Object.freeze(NAV.map(railTitle));
export const labelOf = (title) => String(title).replace(/ \(\d\)$/, '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function makeFoldScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const rail = async (t) => (await t.evaluate(PAGE.railTitles)) || [];
  const subLabels = (space) => (SUBS[space] || []).map((s) => s[1]);
  const archivedMarks = async (t) => (await t.evaluate(PAGE.marks)) || [];
  return {
    async 'fold-default-shows-everything'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        if (!await t.waitFor(`${PAGE.railTitles}.length === ${NAV.length}`, 6000)) return out.concat('the rail never showed all ' + NAV.length + ' spaces: ' + JSON.stringify(await rail(t)));
        const titles = await rail(t);
        if (!same(titles, ALL_TITLES)) out.push('the rail shows ' + JSON.stringify(titles) + ', want ' + JSON.stringify(ALL_TITLES));
        for (const n of NAV) {
          const want = subLabels(n.id);
          if (!want.length) continue;
          await t.evaluate(PAGE.go(n.id));
          if (!await t.waitFor(`JSON.stringify(${PAGE.subTabs}) === ${JSON.stringify(JSON.stringify(want))}`, 4000)) out.push(n.label + ' sub bar is ' + JSON.stringify(await t.evaluate(PAGE.subTabs)) + ', want the complete ' + JSON.stringify(want));
        }
        await t.evaluate(PAGE.go('home'));
        await t.evaluate(PAGE.settings(true));
        if (!await t.waitFor(PAGE.settingsOpen, 4000)) return out.concat('Settings never opened');
        if (await t.evaluate(PAGE.row)) out.push('Settings has a Show-everything row although nothing is folded');
        const st = await t.evaluate(PAGE.state);
        if (st && st.foldIds && st.foldIds.length) out.push('foldIds is not empty by default: ' + JSON.stringify(st.foldIds));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'fold-hides-and-reveals'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const FOLD = ['projects/archived', 'life'];
      try {
        await t.evaluate(PAGE.reset);
        await pause(150);   // the reset's own pref save lands first, or it would overwrite the fold written next
        await t.evaluate(PAGE.prefsWrite(FOLD));
        await t.reload();
        const again = await fresh(t); if (again) return again;
        if (!await t.waitFor(`${PAGE.railTitles}.length === ${NAV.length - 1}`, 6000)) return out.concat('with Life folded the rail shows ' + JSON.stringify(await rail(t)) + ', want ' + (NAV.length - 1) + ' spaces without Life');
        if ((await rail(t)).some((x) => labelOf(x) === 'Life')) out.push('Life is still in the rail');
        await t.evaluate(PAGE.go('projects', 'grid'));
        if (!await t.waitFor(`${PAGE.subTabs}.length > 0`, 4000)) return out.concat('Projects never showed its sub bar');
        const subs = await t.evaluate(PAGE.subTabs);
        if (subs.includes('Archived')) out.push('Archived is still in the Projects sub bar: ' + JSON.stringify(subs));
        if (!same(subs, subLabels('projects').filter((l) => l !== 'Archived'))) out.push('the Projects sub bar lost more than Archived: ' + JSON.stringify(subs));
        await t.evaluate(PAGE.settings(true));
        if (!await t.waitFor(`!!${PAGE.row}`, 4000)) return out.concat('Settings has no Show-everything row although two surfaces are folded');
        const row = await t.evaluate(PAGE.row);
        for (const w of ['Show everything', 'Projects › Archived', 'Life']) if (!row.text.includes(w)) out.push('the Show-everything row does not say "' + w + '": ' + row.text.slice(0, 200));
        if (!/Hidden/.test(row.text)) out.push('the row does not say these are hidden: ' + row.text.slice(0, 200));
        if (row.state !== 'Off') out.push('the switch reads "' + row.state + '" by default, want Off');
        await t.evaluate(PAGE.clickSwitch);
        if (!await t.waitFor(`${PAGE.railTitles}.length === ${NAV.length}`, 4000)) out.push('Show everything on did not bring Life back to the rail: ' + JSON.stringify(await rail(t)));
        if ((await t.evaluate(PAGE.row) || {}).state !== 'On') out.push('the switch does not read On after pressing it');
        await t.evaluate(PAGE.settings(false));
        await t.evaluate(PAGE.go('projects', 'grid'));
        if (!await t.waitFor(`${PAGE.subTabs}.includes('Archived')`, 4000)) out.push('Show everything on did not bring Archived back to the sub bar: ' + JSON.stringify(await t.evaluate(PAGE.subTabs)));
        await t.evaluate(PAGE.settings(true));
        await t.evaluate(PAGE.clickSwitch);
        if (!await t.waitFor(`${PAGE.railTitles}.length === ${NAV.length - 1}`, 4000)) out.push('Show everything off did not hide Life again: ' + JSON.stringify(await rail(t)));
        await t.evaluate(PAGE.settings(false));
        // reversible, never unreachable: the Go palette and a direct route reach a folded surface
        await t.evaluate(PAGE.palette(true, ''));
        if (!await t.waitFor(`${PAGE.paletteText}.includes('Life')`, 4000)) out.push('the Go palette does not list Life while it is folded: ' + String(await t.evaluate(PAGE.paletteText)).slice(0, 200));
        else {
          if (!await t.evaluate(PAGE.paletteClick('Life'))) out.push('the Go palette has no Life item to press');
          if (!await t.waitFor(`${PAGE.where}.tab === 'life'`, 4000)) out.push('pressing Life in the Go palette did not open it: ' + JSON.stringify(await t.evaluate(PAGE.where)));
        }
        await t.evaluate(PAGE.go('home'));
        await t.evaluate(PAGE.palette(true, 'archived'));
        if (!await t.waitFor(`${PAGE.paletteText}.includes('Archived projects')`, 4000)) out.push('the Go palette does not list Archived projects while it is folded');
        await t.evaluate(PAGE.palette(false));
        await t.evaluate(PAGE.go('projects', 'archived'));
        const w = await t.evaluate(PAGE.where);
        if (w.tab !== 'projects' || w.sub !== 'archived') out.push('a direct route to Projects > Archived did not land: ' + JSON.stringify(w));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'fold-number-keys-stable'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.setFold(['life'], false));
        if (!await t.waitFor(`${PAGE.railTitles}.length === ${NAV.length - 1}`, 6000)) return out.concat('with Life folded the rail shows ' + JSON.stringify(await rail(t)));
        const titles = await rail(t);
        const want = NAV.map(railTitle).filter((x) => labelOf(x) !== 'Life');
        if (!same(titles, want)) out.push('with Life folded the rail is ' + JSON.stringify(titles) + ', want every other space with the digit it has unfolded: ' + JSON.stringify(want));
        for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
          const target = NAV[key === '0' ? 9 : Number(key) - 1].id;
          await t.evaluate(PAGE.go(target === 'home' ? 'tasks' : 'home'));   // start from somewhere else
          await t.evaluate(PAGE.key(key));
          if (!await t.waitFor(`${PAGE.where}.tab === ${JSON.stringify(target)}`, 3000)) out.push('key ' + key + ' went to ' + JSON.stringify((await t.evaluate(PAGE.where)).tab) + ', want ' + target);
        }
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'fold-use-marks'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.go('home'));
        if ((await archivedMarks(t)).length) out.push('a projects-archived mark was sent before Archived was opened');
        await t.evaluate(PAGE.go('projects', 'archived'));
        if (!await t.waitFor(`${PAGE.marks}.length === 1`, 4000)) return out.concat('opening Projects > Archived sent ' + JSON.stringify(await archivedMarks(t)) + ', want exactly one projects-archived mark');
        await t.evaluate(PAGE.settings(true));
        await t.evaluate(PAGE.settings(false));
        await pause(120);
        if ((await archivedMarks(t)).length !== 1) out.push('a re-render on the same screen sent another mark: ' + JSON.stringify(await archivedMarks(t)));
        await t.evaluate(PAGE.go('home'));
        await t.evaluate(PAGE.go('projects', 'archived'));
        if (!await t.waitFor(`${PAGE.marks}.length === 2`, 4000)) out.push('a second arrival did not send a second mark: ' + JSON.stringify(await archivedMarks(t)));
        // folded: the surface is not an arrival the owner chose
        await t.evaluate(PAGE.go('home'));
        await t.evaluate(PAGE.setFold(['projects/archived'], false));
        await t.evaluate(`hqFake.reset(true)`);
        await t.evaluate(PAGE.go('projects', 'archived'));
        await pause(400);
        if ((await archivedMarks(t)).length) out.push('a mark was sent for Archived while it is folded: ' + JSON.stringify(await archivedMarks(t)));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'fold-no-motion'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.reduce(true));
        await t.evaluate(PAGE.setFold(['life'], false));
        await t.evaluate(PAGE.settings(true));
        if (!await t.waitFor(`!!${PAGE.row}`, 4000)) return out.concat('Settings never showed the Show-everything row');
        let n = await t.evaluate(PAGE.rowMotion);
        if (n !== 0) out.push(n + ' element(s) on the Show-everything row have a transition or an animation with Reduce motion on');
        await t.evaluate(PAGE.clickSwitch);
        await pause(60);
        n = await t.evaluate(PAGE.rowMotion);
        if (n !== 0) out.push(n + ' element(s) on the row animate right after the switch is pressed');
        if (!same((await rail(t)).map(labelOf), NAV.map((x) => x.label))) out.push('Show everything on did not show every space at once: ' + JSON.stringify(await rail(t)));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'fold-reload-persists'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.setFold(['projects/archived', 'life'], false));
        if (!await t.waitFor(`JSON.stringify((${PAGE.prefs} || {}).foldIds) === '["projects/archived","life"]'`, 4000)) return out.concat('foldIds was not saved to the prefs: ' + JSON.stringify(await t.evaluate(PAGE.prefs)));
        await t.reload();
        let again = await fresh(t); if (again) return again;
        if (!await t.waitFor(`${PAGE.railTitles}.length === ${NAV.length - 1}`, 6000)) out.push('after a reload Life is back in the rail although it was folded: ' + JSON.stringify(await rail(t)));
        const st = await t.evaluate(PAGE.state);
        if (!same(st && st.foldIds, ['projects/archived', 'life'])) out.push('after a reload foldIds is ' + JSON.stringify(st && st.foldIds));
        await t.evaluate(PAGE.settings(true));
        if (!await t.waitFor(`!!${PAGE.row}`, 4000)) return out.concat('after a reload Settings lost the Show-everything row');
        await t.evaluate(PAGE.clickSwitch);
        if (!await t.waitFor(`(${PAGE.prefs} || {}).showEverything === true`, 4000)) return out.concat('showEverything was not saved to the prefs: ' + JSON.stringify(await t.evaluate(PAGE.prefs)));
        await t.reload();
        again = await fresh(t); if (again) return again;
        if (!await t.waitFor(`${PAGE.railTitles}.length === ${NAV.length}`, 6000)) out.push('after a reload with Show everything on the rail shows ' + JSON.stringify(await rail(t)));
        await t.evaluate(PAGE.settings(true));
        if (!await t.waitFor(`!!${PAGE.row}`, 4000)) out.push('after a reload with Show everything on Settings lost the row that turns it off');
        else if ((await t.evaluate(PAGE.row)).state !== 'On') out.push('after a reload the switch does not read On');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
