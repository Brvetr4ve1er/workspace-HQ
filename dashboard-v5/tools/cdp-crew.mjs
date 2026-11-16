// CDP scenarios for Claude > Crew (the installed skills by role, and Start). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeCrewScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario crew-render,crew-start,crew-search   (needs --preload=fake)
//
// The fake preload answers hq.crew.read with 24 invented skills over the roles (tools/crew-fixture.mjs, pasted into fake-preload.js);
// sessionStorage "hqFake:crewCount" asks for more. hq.crew.start answers { ok: true } for a skill the roster has. The fake never opens a
// terminal: the dry launch line and the --permission-mode default argv are pinned in dashboard/crew.test.mjs, where main's own code runs.
// Each scenario ends with hqFake.reset(true), the crew count back to its default and the page on Home.
//
//   crew-render   Claude > Crew reads the roster exactly once on arrival, groups it by role, and a role with more than 12 skills shows 12 and a "Show N more" button
//   crew-start    Start on a row calls hq.crew.start with that skill's id once, toasts, and sends exactly ONE ('crew-start', 'act') mark; a second click inside a minute opens a session but adds no mark
//   crew-search   typing narrows the list (flat, 60 a page with a "Show more" button), a word with no match says so, Clear brings the groups back

const VIEW = `document.querySelector('[data-crw="view"]')`;
export const PAGE = Object.freeze({
  view: VIEW,
  text: `(${VIEW} ? ${VIEW}.textContent.replace(/\\s+/g, ' ') : '')`,
  groups: `[...document.querySelectorAll('[data-crw="group"]')]`,
  groupSizes: `[...document.querySelectorAll('[data-crw="group"]')].map((g) => [g.querySelector('[data-crw="role"]').textContent.trim(), g.querySelectorAll('[data-crw="row"]').length])`,
  flatRows: `[...document.querySelectorAll('[data-crw="flat"] [data-crw="row"]')]`,
  names: `[...document.querySelectorAll('[data-crw="name"]')].map((n) => n.textContent.trim())`,
  startOf: (name) => `[...document.querySelectorAll('[data-crw="row"]')].find((r) => r.querySelector('[data-crw="name"]').textContent.trim() === ${JSON.stringify(name)}).querySelector('[data-crw="start"]')`,
  button: (kind) => `document.querySelector('[data-crw="${kind}"]')`,
  moreButtons: `[...document.querySelectorAll('[data-crw="toggle"]')].map((b) => b.textContent.trim())`,
  calls: (method) => `hqFake.calls(${JSON.stringify(method)}).length`,
  callArgs: (method) => `hqFake.calls(${JSON.stringify(method)}).map((c) => c.args)`,
  marks: (surface, action) => `hqFake.calls('use').filter((c) => c.args[0] === ${JSON.stringify(surface)} && c.args[1] === ${JSON.stringify(action)}).length`,
  count: (n) => `(() => { try { sessionStorage.setItem('hqFake:crewCount', ${JSON.stringify(String(n))}); } catch (e) {} return true; })()`,
  type: (text) => `(() => { const i = document.querySelector('[data-crw="search"]'); if (!i) return false; i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
  go: `(() => { WHQ.app.logic.go('claude', 'crew'); return true; })()`,
  reset: `(() => { try { sessionStorage.removeItem('hqFake:crewCount'); } catch (e) {} hqFake.reset(true); const L = WHQ.app.logic; L._crwBusy = false; L._crwStarting = null; L._useOnce = null; L.setState({ crw: null, crwBusy: [], toasts: [], route: null }); L.go('home'); return true; })()`,
});

export function makeCrewScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  return {
    async 'crew-render'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.count(300));
        const before = await t.evaluate(PAGE.calls('crew.read'));
        if (before !== 0) out.push('the roster was read before the owner opened the view (' + before + ' calls)');
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`${PAGE.groups}.length >= 5`, 6000)) return out.concat('Claude > Crew never showed its role groups: ' + (await t.evaluate(PAGE.text)).slice(0, 220));
        const sizes = await t.evaluate(PAGE.groupSizes);
        if (sizes.some(([, n]) => n > 12)) out.push('a role showed more than 12 rows: ' + JSON.stringify(sizes));
        if (!sizes.some(([, n]) => n === 12)) out.push('no role shows a full 12 rows although 300 skills are installed: ' + JSON.stringify(sizes));
        const labels = sizes.map(([l]) => l);
        if (labels[0] !== 'Developers' || labels[labels.length - 1] !== 'Other') out.push('roles are not in the table order: ' + JSON.stringify(labels));
        const more = await t.evaluate(PAGE.moreButtons);
        if (!more.length || !more.every((m) => /^Show \d+ more$/.test(m))) out.push('a long role has no "Show N more" button: ' + JSON.stringify(more));
        const txt = await t.evaluate(PAGE.text);
        if (!/300 skills/.test(txt)) out.push('the summary does not say 300 skills: ' + txt.slice(0, 160));
        if (!txt.includes('terminal session')) out.push('the note about what Start does is missing');
        const calls = await t.evaluate(PAGE.calls('crew.read'));
        if (calls !== 1) out.push('the roster was read ' + calls + ' times on arrival, want exactly 1');
        if (await t.evaluate(PAGE.marks('crew', 'open')) !== 1) out.push('arriving on Crew sent ' + await t.evaluate(PAGE.marks('crew', 'open')) + ' open marks, want 1');
        // Show more opens the whole role
        await t.evaluate(`document.querySelector('[data-crw="toggle"]').click()`);
        if (!await t.waitFor(`${PAGE.groupSizes}.some(([, n]) => n > 12)`, 3000)) out.push('Show more did not open the role');
        if (/undefined|\[object|NaN/.test(await t.evaluate(PAGE.text))) out.push('an unresolved binding reached the Crew text');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'crew-start'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`${PAGE.names}.includes('alpha-lint')`, 6000)) return out.concat('the Crew never listed alpha-lint: ' + (await t.evaluate(PAGE.text)).slice(0, 200));
        await t.evaluate(`${PAGE.startOf('alpha-lint')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('crew.start')} === 1`, 3000)) return out.concat('Start did not call hq.crew.start');
        const args = await t.evaluate(PAGE.callArgs('crew.start'));
        if (JSON.stringify(args) !== JSON.stringify([['alpha-lint']])) out.push('hq.crew.start was called with ' + JSON.stringify(args) + ', want only the skill id');
        await pause(150);
        const toast = await t.evaluate(`JSON.stringify(WHQ.app.logic.state.toasts || [])`);
        if (!/alpha-lint/.test(toast)) out.push('no toast named the started skill: ' + toast.slice(0, 160));
        if (await t.evaluate(PAGE.marks('crew-start', 'act')) !== 1) out.push('a launched session sent ' + await t.evaluate(PAGE.marks('crew-start', 'act')) + ' crew-start act marks, want 1');
        // the same skill again inside a minute opens a session but adds no second mark
        await t.evaluate(`${PAGE.startOf('alpha-lint')}.click()`);
        if (!await t.waitFor(`${PAGE.calls('crew.start')} === 2`, 3000)) out.push('a second click did not reach main');
        await pause(150);
        if (await t.evaluate(PAGE.marks('crew-start', 'act')) !== 1) out.push('the same skill inside a minute added a mark: ' + await t.evaluate(PAGE.marks('crew-start', 'act')));
        // a skill the roster does not have is refused in main's words and marks nothing
        const refused = await t.evaluate(`(async () => { const r = await window.hq.crew.start('not-a-skill'); return JSON.stringify(r); })()`);
        if (!/not in the crew/.test(refused)) out.push('an unknown id was not refused: ' + refused);
        if (await t.evaluate(PAGE.marks('crew-start', 'act')) !== 1) out.push('a refused start changed the mark count');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'crew-search'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.count(300));
        await t.evaluate(PAGE.go);
        if (!await t.waitFor(`!!${PAGE.button('search')}`, 6000)) return out.concat('the search box never appeared');
        await t.evaluate(PAGE.type('ledger'));
        if (!await t.waitFor(`${PAGE.flatRows}.length === 2`, 4000)) return out.concat('searching "ledger" did not narrow to the 2 ledger skills: ' + (await t.evaluate(PAGE.text)).slice(0, 220));
        const names = await t.evaluate(PAGE.names);
        if (JSON.stringify(names.slice().sort()) !== JSON.stringify(['gamma-ledger', 'month-close'])) out.push('search hits were ' + JSON.stringify(names));
        if (await t.evaluate(`${PAGE.groups}.length`)) out.push('role groups stayed on screen while searching');
        await t.evaluate(PAGE.type('gen-skill'));
        if (!await t.waitFor(`${PAGE.flatRows}.length === 60`, 4000)) out.push('a wide search did not stop at 60 rows: ' + await t.evaluate(`${PAGE.flatRows}.length`));
        if (!await t.waitFor(`!!${PAGE.button('more-page')}`, 2000)) out.push('a wide search has no "Show more" button');
        else {
          await t.evaluate(`${PAGE.button('more-page')}.click()`);
          if (!await t.waitFor(`${PAGE.flatRows}.length === 120`, 3000)) out.push('Show more did not add a page of 60');
        }
        await t.evaluate(PAGE.type('zzzz-no-such-thing'));
        if (!await t.waitFor(`!!${PAGE.button('no-match')}`, 3000)) out.push('a search with no match did not say so');
        await t.evaluate(`${PAGE.button('clear')}.click()`);
        if (!await t.waitFor(`${PAGE.groups}.length >= 5 && ${PAGE.flatRows}.length === 0`, 3000)) out.push('Clear did not bring the role groups back');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
