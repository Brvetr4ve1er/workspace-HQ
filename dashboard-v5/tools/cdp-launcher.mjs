// CDP scenarios for the Launcher screens (batch 9, dish "launcher screens"). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeLauncherScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario launcher-render,launcher-add,launcher-remove,launcher-allow-command,launcher-open-workspace,launcher-refuse,launcher-palette,launcher-setup-row   (needs --preload=fake)
//
// The fake preload stands in for main (tools/launcher-fixture.mjs, pasted into fake-preload.js): three INVENTED entries (a folder, an app that is the editor, a link),
// the gate's own projects (a has a scanned dev command and is "not allowed yet" until hq.devAllow), and sessionStorage "hqFake:launcher" = locked | error | refuse picks a
// state. The fake opens no window, starts no process and shows no dialog: main's checks, argument lists and limits are pinned in dashboard/launcher.test.mjs. Each scenario
// ends with hqFake.reset(true), the storage key gone and the page on Home.
//
//   launcher-render           Settings reads the Launcher once per opening (never before), shows the entries, the editor, the terminal in words and the allowed commands with the scan's text
//   launcher-add              an add button asks main once with its kind only and the list grows; a refusal says main's reason; nothing sends a usage mark
//   launcher-remove           Remove asks main once with the entry's id; removing the editor says no editor is chosen
//   launcher-allow-command    Allow this command sends the project id and the hash of the text shown; Remove permission goes back to "not allowed yet"
//   launcher-open-workspace   Open workspace on a project page asks main once (a double click is one call), shows main's own sentence in order dev, editor, terminal,
//                             leaves Allow and run on the dev button, and exactly ONE launcher-workspace act mark is written (by the fake, as main does), never by the renderer
//   launcher-refuse           a refused or busy answer shows plain words and no mark; a locked list shows its sentence and no add button works
//   launcher-palette          Ctrl+K lists "Open workspace · <project>" only for a typed query, Enter runs it once; the empty palette has no Launcher row
//   launcher-setup-row        "Set up Launcher" is offered only while no editor is chosen, and Enter opens Settings
import { hashShown } from '../src/logic/dev-allow.mjs';

const SEL = (name) => `document.querySelector('[data-lnch="${name}"]')`;
const ALL = (name) => `[...document.querySelectorAll('[data-lnch="${name}"]')]`;
export const PAGE = Object.freeze({
  sel: SEL,
  all: ALL,
  text: `document.body.innerText.replace(/\\s+/g, ' ')`,
  section: `(${SEL('section')} ? ${SEL('section')}.innerText.replace(/\\s+/g, ' ') : '')`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).length`,
  callArgs: (method) => `hqFake.calls(${JSON.stringify(method)}).map((c) => c.args)`,
  marks: (surface, action) => `hqFake.calls('use').filter((c) => c.args[0] === ${JSON.stringify(surface)} && c.args[1] === ${JSON.stringify(action)}).length`,
  allMarks: `hqFake.calls('use').filter((c) => /^launcher|^lnch/.test(String(c.args[0]))).length`,
  mode: (m) => `(() => { try { sessionStorage.setItem('hqFake:launcher', ${JSON.stringify(m)}); } catch (e) {} return true; })()`,
  openSettings: `(() => { WHQ.app.logic.setState({ settingsOpen: true }); return true; })()`,
  closeSettings: `(() => { WHQ.app.logic.setState({ settingsOpen: false }); return true; })()`,
  project: `(() => { const L = WHQ.app.logic, p = L.M.P0.find((x) => x.dev); return p ? JSON.stringify({ id: p.id, dev: p.dev, name: p.name }) : ''; })()`,
  openPage: (id) => `(() => { const L = WHQ.app.logic; L.setState({ devAsk: {}, toasts: [] }); L.go('projects', 'grid'); L.openProject(${JSON.stringify(id)}); return true; })()`,
  button: (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}))`,
  rowButton: (rowAttr, rowText, name) => `(() => { const r = ${ALL(rowAttr)}.find((x) => x.textContent.includes(${JSON.stringify(rowText)})); return r ? r.querySelector('[data-lnch="${name}"]') : null; })()`,
  palette: (q) => `(() => { WHQ.app.logic.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: ${JSON.stringify(q)}, paletteSel: 0 }); return true; })()`,
  paletteLabels: `(() => { const P = WHQ.app.logic.paletteItems(); return JSON.stringify(P.flat.map((i) => i.label)); })()`,
  enter: `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`,
  state: (path) => `JSON.stringify(${path})`,
  reset: `(() => { try { sessionStorage.removeItem('hqFake:launcher'); } catch (e) {} hqFake.reset(true); const L = WHQ.app.logic; L._lnchAsked = false; L._lnchWorking = false; L._lnchReading = false; L._lnchWs = null; L.setState({ lnch: null, settingsOpen: false, paletteOpen: false, paletteQuery: '', devAsk: {}, toasts: [], route: null }); L.go('home'); return true; })()`,
});

export function makeLauncherScenarios({ fresh, sleep }) {
  const arr = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const openReady = async (t, out) => {
    await t.evaluate(PAGE.reset);
    await t.evaluate(PAGE.openSettings);
    if (!await t.waitFor(`${PAGE.all('entry')}.length >= 3`, 6000)) { out.push('Settings never listed the Launcher entries: ' + (await t.evaluate(PAGE.section)).slice(0, 220)); return false; }
    return true;
  };
  return {
    async 'launcher-render'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        if (await t.evaluate(PAGE.calls('launcher.read')) !== 0) out.push('the Launcher was read before Settings opened');
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`${PAGE.all('entry')}.length === 3`, 6000)) return out.concat('Settings did not list the three entries: ' + (await t.evaluate(PAGE.section)).slice(0, 220));
        await pause(150);
        if (await t.evaluate(PAGE.calls('launcher.read')) !== 1) out.push('Settings read the Launcher ' + await t.evaluate(PAGE.calls('launcher.read')) + ' times on opening, want 1');
        const sec = await t.evaluate(PAGE.section);
        for (const want of ['Placeholder folder', 'Example editor', 'docs.example.test', 'Add folder', 'Add file', 'Add app', 'Add link', 'My editor', 'My terminal', 'Windows Terminal (found)', 'Allowed commands']) if (!sec.includes(want)) out.push('the Launcher section does not say "' + want + '"');
        const p = JSON.parse(await t.evaluate(PAGE.project) || '{}');
        if (p.dev && !await t.evaluate(`${PAGE.all('cmd-text')}.some((c) => c.textContent.trim() === ${JSON.stringify(p.dev)})`)) out.push('Allowed commands does not show the scan\'s text "' + p.dev + '"');
        if (!/Not allowed yet/.test(sec)) out.push('the command row does not say Not allowed yet');
        if (await t.evaluate(`!!${SEL('refresh')} && ${SEL('refresh')}.disabled`)) out.push('Refresh stayed disabled');
        if (await t.evaluate(PAGE.allMarks)) out.push('the Launcher section sent a usage mark');
        if (/undefined|\[object|NaN/.test(sec)) out.push('an unresolved binding reached the Launcher text: ' + sec.slice(0, 160));
        // closing and opening again reads once more; leaving it open does not read again
        await t.evaluate(PAGE.closeSettings); await pause(100);
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`${PAGE.calls('launcher.read')} === 2`, 3000)) out.push('a second opening did not read once more');
        await pause(150);
        if (await t.evaluate(PAGE.calls('launcher.read')) !== 2) out.push('more than one read in one opening');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'launcher-add'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await openReady(t, out)) return out;
        await t.evaluate(`${PAGE.all('add')}.find((b) => b.dataset.lnchKind === 'folder').click()`);
        if (!await t.waitFor(`${PAGE.all('entry')}.length === 4`, 4000)) return out.concat('Add folder did not add an entry');
        if (JSON.stringify(await t.evaluate(PAGE.callArgs('launcher.add'))) !== JSON.stringify([['folder']])) out.push('Add folder sent ' + JSON.stringify(await t.evaluate(PAGE.callArgs('launcher.add'))) + ', want only the kind');
        if (!/Folder added/.test(await t.evaluate(`${SEL('notice')} ? ${SEL('notice')}.textContent : ''`))) out.push('no notice said the folder was added');
        // a refusal is main's reason, in words
        await t.evaluate(PAGE.mode('refuse'));
        await t.evaluate(`${PAGE.all('add')}.find((b) => b.dataset.lnchKind === 'app').click()`);
        if (!await t.waitFor(`/Not added: that is not a full path/.test(${SEL('notice')} ? ${SEL('notice')}.textContent : '')`, 3000)) out.push('a refused add did not say main\'s reason: ' + await t.evaluate(`${SEL('notice')} ? ${SEL('notice')}.textContent : 'no notice'`));
        if (await t.evaluate(PAGE.all('entry') + '.length') !== 4) out.push('a refused add changed the list');
        if (await t.evaluate(PAGE.allMarks)) out.push('adding sent a usage mark');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'launcher-remove'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await openReady(t, out)) return out;
        await t.evaluate(`${PAGE.rowButton('entry', 'Placeholder folder', 'remove')}.click()`);
        if (!await t.waitFor(`${PAGE.all('entry')}.length === 2`, 4000)) return out.concat('Remove did not take the entry out');
        if (JSON.stringify(await t.evaluate(PAGE.callArgs('launcher.remove'))) !== JSON.stringify([['aaaa0001']])) out.push('Remove sent ' + JSON.stringify(await t.evaluate(PAGE.callArgs('launcher.remove'))) + ', want only the id');
        // removing the editor leaves no editor chosen
        await t.evaluate(`${PAGE.rowButton('entry', 'Example editor', 'remove')}.click()`);
        if (!await t.waitFor(`/No editor chosen/.test(${SEL('editor')}.textContent)`, 4000)) out.push('removing the editor did not say no editor is chosen');
        if (await t.evaluate(PAGE.allMarks)) out.push('removing sent a usage mark');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'launcher-allow-command'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        if (!await openReady(t, out)) return out;
        const p = JSON.parse(await t.evaluate(PAGE.project) || '{}');
        if (!p.id) return out.concat('no project with a dev command in the page data');
        await t.evaluate(`${SEL('allow')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('devAllow')} === 1`, 3000)) return out.concat('Allow this command did not ask main');
        const args = await t.evaluate(PAGE.callArgs('devAllow'));
        if (JSON.stringify(args) !== JSON.stringify([[p.id, hashShown(p.dev)]])) out.push('the allow carried ' + JSON.stringify(args) + ', want the project id and the hash of the text shown');
        if (!await t.waitFor(`/Allowed/.test(${SEL('cmd-state')}.textContent) && !!${SEL('forget')}`, 4000)) return out.concat('the row did not turn to Allowed with a Remove permission button');
        if (await t.evaluate(`!!${SEL('allow')}`)) out.push('an allowed row still offers Allow this command');
        await t.evaluate(`${SEL('forget')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('devForget')} === 1`, 3000)) return out.concat('Remove permission did not ask main');
        if (JSON.stringify(await t.evaluate(PAGE.callArgs('devForget'))) !== JSON.stringify([[p.id]])) out.push('Remove permission sent more than the project id');
        if (!await t.waitFor(`/Not allowed yet/.test(${SEL('cmd-state')}.textContent) && !!${SEL('allow')}`, 4000)) out.push('the row did not go back to Not allowed yet');
        if (await t.evaluate(PAGE.allMarks)) out.push('allowing sent a usage mark');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'launcher-open-workspace'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        const p = JSON.parse(await t.evaluate(PAGE.project) || '{}');
        if (!p.id) return out.concat('no project with a dev command in the page data');
        await t.evaluate(PAGE.openPage(p.id));
        if (!await t.waitFor(`!!${SEL('workspace')}`, 6000)) return out.concat('the project page has no Open workspace button: ' + (await t.evaluate(PAGE.text)).slice(0, 200));
        if (await t.evaluate(PAGE.calls('launcher.openWorkspace'))) out.push('the page called Open workspace before a click');
        // a double click is one call
        await t.evaluate(`(() => { const b = ${SEL('workspace')}; b.click(); b.click(); return true; })()`);
        if (!await t.waitFor(`/not allowed yet/.test(${SEL('workspace-line')} ? ${SEL('workspace-line')}.textContent : '')`, 4000)) return out.concat('the line under the button never said the dev step is not allowed yet: ' + (await t.evaluate(PAGE.text)).slice(0, 220));
        if (await t.evaluate(PAGE.calls('launcher.openWorkspace')) !== 1) out.push('a double click made ' + await t.evaluate(PAGE.calls('launcher.openWorkspace')) + ' calls, want 1');
        if (JSON.stringify(await t.evaluate(PAGE.callArgs('launcher.openWorkspace'))) !== JSON.stringify([[p.id]])) out.push('Open workspace sent more than the project id');
        const line = await t.evaluate(`${SEL('workspace-line')}.textContent`);
        if (!(line.indexOf('Dev server:') >= 0 && line.indexOf('Dev server:') < line.indexOf('Editor:') && line.indexOf('Editor:') < line.indexOf('Terminal:'))) out.push('the line is not in the order dev, editor, terminal: ' + line);
        const answer = await t.evaluate(`hqFake.calls('launcher.openWorkspace').length`);
        void answer;
        if (!await t.waitFor(`!!${PAGE.button('Allow and run')}`, 3000)) out.push('a not-allowed dev step did not leave Allow and run on the dev button');
        if (await t.evaluate(PAGE.marks('launcher-workspace', 'act')) !== 1) out.push('one Open workspace click wrote ' + await t.evaluate(PAGE.marks('launcher-workspace', 'act')) + ' launcher-workspace act marks, want 1 (the editor opened)');
        // allow on the page, then Open workspace again: the dev server starts, a second mark
        await t.evaluate(`${PAGE.button('Allow and run')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('devAllow')} === 1`, 3000)) out.push('Allow and run did not allow');
        await pause(200);
        await t.evaluate(`${SEL('workspace')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('launcher.openWorkspace')} === 2`, 3000)) return out.concat('the second click did not reach main');
        if (!await t.waitFor(`/Dev server: (started|already running)/.test(${SEL('workspace-line')} ? ${SEL('workspace-line')}.textContent : '')`, 3000)) out.push('an allowed project did not say its dev server started: ' + await t.evaluate(`${SEL('workspace-line')} ? ${SEL('workspace-line')}.textContent : 'no line'`));
        if (await t.evaluate(PAGE.marks('launcher-workspace', 'act')) !== 2) out.push('two clicks wrote ' + await t.evaluate(PAGE.marks('launcher-workspace', 'act')) + ' act marks, want 2');
        if (await t.evaluate(`hqFake.calls('use').filter((c) => c.args[0] !== 'launcher-workspace' && /launcher|workspace/i.test(String(c.args[0]))).length`)) out.push('the renderer wrote a launcher mark of its own');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'launcher-refuse'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        const p = JSON.parse(await t.evaluate(PAGE.project) || '{}');
        if (!p.id) return out.concat('no project with a dev command in the page data');
        await t.evaluate(PAGE.openPage(p.id));
        if (!await t.waitFor(`!!${SEL('workspace')}`, 6000)) return out.concat('no Open workspace button');
        // a busy answer
        await t.evaluate(`hqFake.set('launcher.openWorkspace', { ok: false, steps: [], line: '', state: 'busy' })`);
        await t.evaluate(`${SEL('workspace')}.click()`);
        if (!await t.waitFor(`/Too many Open workspace clicks/.test(${SEL('workspace-line')} ? ${SEL('workspace-line')}.textContent : '')`, 3000)) out.push('a busy answer did not say so: ' + await t.evaluate(`${SEL('workspace-line')} ? ${SEL('workspace-line')}.textContent : 'no line'`));
        // a refused answer
        await t.evaluate(`hqFake.set('launcher.openWorkspace', { ok: false, steps: [], line: '', state: 'refused' })`);
        await t.evaluate(`${SEL('workspace')}.click()`);
        if (!await t.waitFor(`/Open workspace did not work/.test(${SEL('workspace-line')} ? ${SEL('workspace-line')}.textContent : '')`, 3000)) out.push('a refused answer did not say so');
        // a folder that is gone
        await t.evaluate(`hqFake.set('launcher.openWorkspace', (id) => ({ ok: false, steps: ['dev', 'editor', 'terminal'].map((step) => ({ step, state: 'skipped' })), line: 'Folder not found: rescan' }))`);
        await t.evaluate(`${SEL('workspace')}.click()`);
        if (!await t.waitFor(`/Folder not found: rescan/.test(${SEL('workspace-line')} ? ${SEL('workspace-line')}.textContent : '')`, 3000)) out.push('a missing folder did not say "Folder not found: rescan"');
        if (await t.evaluate(PAGE.allMarks)) out.push('a refused or failed Open workspace wrote a mark');
        // a locked list
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.mode('locked'));
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`!!${SEL('locked')}`, 5000)) return out.concat('a locked list did not say so: ' + (await t.evaluate(PAGE.section)).slice(0, 200));
        if (await t.evaluate(`${ALL('add')}.length`)) out.push('a locked list still shows add buttons');
        if (await t.evaluate(`${ALL('entry')}.length`)) out.push('a locked list shows entries');
        // an error with nothing held
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.mode('error'));
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`!!${SEL('error')}`, 5000)) out.push('a failed read did not show the error');
        else if (!/Retry/.test(await t.evaluate(`${SEL('refresh')}.textContent`))) out.push('a failed read has no Retry button');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'launcher-palette'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.palette(''));
        await pause(200);
        const empty = arr(await t.evaluate(PAGE.paletteLabels));
        if (empty.some((l) => /workspace|launcher/i.test(l))) out.push('the empty palette lists a Launcher row: ' + empty.filter((l) => /workspace|launcher/i.test(l)).join(' | '));
        await t.evaluate(PAGE.palette('workspace'));
        await pause(150);
        const rows = arr(await t.evaluate(PAGE.paletteLabels)).filter((l) => /^Open workspace · /.test(l));
        if (rows.length < 1) return out.concat('a typed "workspace" listed no Open workspace row');
        if (await t.evaluate(PAGE.calls('launcher.openWorkspace'))) out.push('listing the rows launched something');
        await t.evaluate(PAGE.enter);
        if (!await t.waitFor(`${PAGE.calls('launcher.openWorkspace')} === 1`, 3000)) return out.concat('Enter on the row did not ask main to open the workspace');
        if (await t.evaluate(PAGE.calls('launcher.openWorkspace')) !== 1) out.push('Enter launched more than once');
        if (!await t.waitFor(`!!${SEL('workspace-line')}`, 4000)) out.push('the project page did not open to show the answer');
        if (await t.evaluate(PAGE.marks('launcher-workspace', 'act')) !== 1) out.push('one palette launch wrote ' + await t.evaluate(PAGE.marks('launcher-workspace', 'act')) + ' act marks, want 1');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'launcher-setup-row'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        // an editor is chosen: not offered
        await t.evaluate(PAGE.palette('launcher'));
        if (!await t.waitFor(`${PAGE.calls('launcher.read')} === 1`, 3000)) return out.concat('the palette did not read the Launcher');
        await pause(200);
        if (arr(await t.evaluate(PAGE.paletteLabels)).some((l) => l === 'Set up Launcher')) out.push('Set up Launcher was offered with an editor chosen');
        // no editor: offered, and Enter opens Settings
        await t.evaluate(`(async () => { await window.hq.launcher.remove('aaaa0002'); await WHQ.app.logic.lnchLoad(); return true; })()`);
        await pause(150);
        await t.evaluate(PAGE.palette('launcher'));
        if (!await t.waitFor(`JSON.parse(${PAGE.paletteLabels}).includes('Set up Launcher')`, 3000)) return out.concat('Set up Launcher was not offered with no editor chosen');
        await t.evaluate(PAGE.enter);
        if (!await t.waitFor(`!!${SEL('section')}`, 4000)) out.push('Enter on Set up Launcher did not open the Launcher in Settings');
        // the empty palette never lists it (Commands shows its first four)
        await t.evaluate(`WHQ.app.logic.setState({ settingsOpen: false })`);
        await t.evaluate(PAGE.palette(''));
        await pause(150);
        if (arr(await t.evaluate(PAGE.paletteLabels)).includes('Set up Launcher')) out.push('the empty palette lists Set up Launcher');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
