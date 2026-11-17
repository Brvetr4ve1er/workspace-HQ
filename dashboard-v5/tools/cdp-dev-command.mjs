// CDP scenarios for the dev command as an argument list (batch 9). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeDevCommandScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario dev-start-unconfirmed,dev-start-confirmed   (needs --preload=fake)
//
// The fake preload stands in for main: hq.devStart answers 'unconfirmed' until hq.devAllow was called for that project, then 'started'. It starts
// nothing (the fake spawns no process); main's argument list, limits and checks are pinned in dashboard/dev-command.test.mjs. Each scenario ends
// with hqFake.reset(true) and the page on Home. The project is the first one in the page's own data that has a scanned dev command.
//
//   dev-start-unconfirmed   Start dev on a project the owner has not allowed asks main once, spawns nothing in the page, turns the button into "Allow and run",
//                           shows the command text and "It runs this project's own scripts", and sends no allow
//   dev-start-confirmed     "Allow and run" sends ONE allow carrying the hash of the text that was shown, then starts it in the same click, toasts, and the button
//                           goes back to "Start dev"; a refused answer from main shows the plain reason and offers no allow
import { hashShown } from '../src/logic/dev-allow.mjs';

const BTN = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}))`;
export const PAGE = Object.freeze({
  btn: BTN,
  text: `document.body.innerText.replace(/\\s+/g, ' ')`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).length`,
  callArgs: (method) => `hqFake.calls(${JSON.stringify(method)}).map((c) => c.args)`,
  project: `(() => { const L = WHQ.app.logic, p = L.M.P0.find((x) => x.dev); return p ? JSON.stringify({ id: p.id, dev: p.dev }) : ''; })()`,
  open: (id) => `(() => { const L = WHQ.app.logic; L.setState({ devAsk: {}, toasts: [] }); L.go('projects', 'grid'); L.openProject(${JSON.stringify(id)}); return true; })()`,
  toasts: `JSON.stringify((WHQ.app.logic.state.toasts || []).map((x) => x.kind + ' · ' + x.text))`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L.setState({ devAsk: {}, toasts: [], route: null }); L.go('home'); return true; })()`,
});

export function makeDevCommandScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const setup = async (t, out) => {
    await t.evaluate(PAGE.reset);
    const raw = await t.evaluate(PAGE.project);
    if (!raw) { out.push('no project with a dev command in the page data'); return null; }
    const p = JSON.parse(raw);
    await t.evaluate(PAGE.open(p.id));
    if (!await t.waitFor(`!!${PAGE.btn('Start dev')}`, 6000)) { out.push('the project page never showed a Start dev button: ' + (await t.evaluate(PAGE.text)).slice(0, 200)); return null; }
    return p;
  };
  return {
    async 'dev-start-unconfirmed'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const p = await setup(t, out); if (!p) return out;
        await t.evaluate(`${PAGE.btn('Start dev')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('devStart')} === 1`, 3000)) return out.concat('Start dev did not ask main');
        if (!await t.waitFor(`!!${PAGE.btn('Allow and run')}`, 3000)) return out.concat('the button did not become "Allow and run" after an unconfirmed answer');
        const text = await t.evaluate(PAGE.text);
        if (!text.includes('Allow and run “' + p.dev + '”?')) out.push('the command text was not shown beside the button: ' + text.slice(0, 200));
        if (!text.includes('It runs this project’s own scripts.')) out.push('the note about what runs is missing');
        if (await t.evaluate(PAGE.calls('devAllow'))) out.push('an allow was sent without a click on Allow and run');
        if (await t.evaluate(`Object.values(WHQ.app.logic.LIVE.dev).filter(Boolean).length`)) out.push('the page shows a dev server running that nothing started');
        if (!/not allowed yet/.test(await t.evaluate(PAGE.toasts))) out.push('no toast said "not allowed yet": ' + await t.evaluate(PAGE.toasts));
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'dev-start-confirmed'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        const p = await setup(t, out); if (!p) return out;
        await t.evaluate(`${PAGE.btn('Start dev')}.click()`);
        if (!await t.waitFor(`!!${PAGE.btn('Allow and run')}`, 3000)) return out.concat('no Allow and run after the first click');
        await t.evaluate(`${PAGE.btn('Allow and run')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('devStart')} === 2`, 3000)) return out.concat('Allow and run did not start the server in the same click');
        const allows = await t.evaluate(PAGE.callArgs('devAllow'));
        if (JSON.stringify(allows) !== JSON.stringify([[p.id, hashShown(p.dev)]])) out.push('the allow carried ' + JSON.stringify(allows) + ', want the project id and the hash of the text shown');
        await pause(150);
        if (!/Dev server starting/.test(await t.evaluate(PAGE.toasts))) out.push('no "starting" toast: ' + await t.evaluate(PAGE.toasts));
        if (!await t.waitFor(`!!${PAGE.btn('Start dev')} && !${PAGE.btn('Allow and run')}`, 3000)) out.push('the button did not go back to Start dev');
        // main refuses: the plain reason, and no allow offered
        await t.evaluate(`hqFake.set('devStart', 'refused')`);
        await t.evaluate(`${PAGE.btn('Start dev')}.click()`);
        if (!await t.waitFor(`/needs a runner or syntax/.test(${PAGE.toasts})`, 3000)) out.push('a refused command did not say why: ' + await t.evaluate(PAGE.toasts));
        if (await t.evaluate(`!!${PAGE.btn('Allow and run')}`)) out.push('a refused command offered Allow and run');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
