// CDP scenarios for the small delights (batch 7): the idle attract scene, the monthly ornament and the back room. cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeDelightsScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario delights-off-nothing,delights-attract-idle,delights-attract-blockers,delights-attract-reduced-motion,delights-season,delights-room   (needs --preload=fake)
//
// Hooks these scenarios use (all on the running component, none of them in the fake preload):
//   WHQ.app.logic._dlxIdleMs   shortens the 90 s idle threshold to a few hundred ms (it can only ever be made shorter)
//   WHQ.app.logic._dlxClock    the one injected clock: a function returning milliseconds, read by the seasonal ornament
//   window.__hqLayerProbe()    the Console layer's read-only counts { links, listeners, timers, frames }
// The Console layer is switched on and off through the component state (consoleLayer), the way Settings does; every scenario ends with the layer OFF,
// the hooks removed, the selection cleared, the OS motion preference put back and hqFake reset.
//
//   delights-off-nothing            layer off: no attract timer, listener, ornament, room or delights.css link (probe zeros), even after waiting past the shortened idle
//   delights-attract-idle           layer on + empty Brief: the scene starts once idle; mousemove, a key, wheel and touch each stop it at once; the input listeners are
//                                   the probe's baseline + exactly the controller's while armed and gone after the card leaves
//   delights-attract-blockers       selected text, Settings, the palette and the cheat sheet each keep it from starting; clearing the blocker lets it start (positive control)
//   delights-attract-reduced-motion reduceMotion and the OS media query: no slot, no scene, no listener, and the ornament is static (no running animation)
//   delights-season                 two pinned months give two ornaments, each with its aria-label and title; the layer off removes it
//   delights-room                   Memory card's empty slot opens the back room, Escape closes it, the typed code backroom opens it, 'backroom' is in the found list,
//                                   and the room makes no hq call and loads no resource

const ANCHOR = `document.querySelector('[data-dlx="attract-anchor"]')`;
const SCENE = `document.querySelector('svg[data-dlx="attract"]')`;
const SEASON = `document.querySelector('[data-dlx="season"]')`;
const ROOM = `document.querySelector('[data-dlx="room"]')`;
const LAYER = (on) => `{ on: ${on ? 'true' : 'false'}, skin: false, scan: false, palette: '', debug: false, shelf: false }`;

export const PAGE = Object.freeze({
  anchor: `!!${ANCHOR}`,
  scene: `!!${SCENE}`,
  season: `!!${SEASON}`,
  seasonLabel: `(${SEASON} && ${SEASON}.querySelector('svg') ? ${SEASON}.querySelector('svg').getAttribute('aria-label') : null)`,
  seasonTitle: `(${SEASON} ? ${SEASON}.getAttribute('title') : null)`,
  seasonSize: `(() => { const s = ${SEASON}; if (!s) return null; const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`,
  seasonAnimations: `(() => { const s = ${SEASON}; return s ? s.getAnimations({ subtree: true }).length : -1; })()`,
  room: `!!${ROOM}`,
  roomText: `(${ROOM} ? ${ROOM}.textContent.replace(/\\s+/g, ' ').trim() : '')`,
  roomButtons: `(${ROOM} ? ${ROOM}.querySelectorAll('button').length : -1)`,
  consoleNodes: `document.querySelectorAll('[data-hq-console]').length`,
  anyDlxNode: `document.querySelectorAll('[data-dlx]').length`,
  cssLink: `!!document.querySelector('link[href*="delights.css"]')`,
  probe: `JSON.stringify(typeof window.__hqLayerProbe === 'function' ? window.__hqLayerProbe() : null)`,
  ctl: `(() => { const c = WHQ.app.logic._dlxCtl; return c ? JSON.stringify(c.status()) : null; })()`,
  calls: `hqFake.calls().length`,
  resources: `performance.getEntriesByType('resource').length`,
  found: `JSON.stringify((WHQ.app.logic.state.cheatsFound) || [])`,
  // the set-up: the layer on or off, a short idle, an empty Brief, Home
  arm: (on, idleMs) => `(() => { const L = WHQ.app.logic; L._dlxIdleMs = ${Number(idleMs) || 300}; L.setState({ consoleLayer: ${LAYER(on)}, tab: 'home', route: null, snapOffset: 0, dlxRun: false, dlxRoom: false, settingsOpen: false, paletteOpen: false, cheatOpen: false, toasts: [] }); return true; })()`,
  emptyBrief: `(() => { hqFake.set('brief.read', { brief: { v: 1, generatedAt: new Date().toISOString(), items: [], more: 0, overflow: [], standing: [], errors: [] } }); WHQ.store.refreshBrief(); return true; })()`,
  go: (tab) => `(() => { WHQ.app.logic.go(${JSON.stringify(tab)}); return true; })()`,
  state: (patch) => `(() => { WHQ.app.logic.setState(${JSON.stringify(patch)}); return true; })()`,
  rerender: `(() => { WHQ.app.logic.forceUpdate(); return true; })()`,
  pinClock: (ms) => `(() => { WHQ.app.logic._dlxClock = () => ${Number(ms)}; WHQ.app.logic.forceUpdate(); return true; })()`,
  select: `(() => { const a = document.querySelector('[data-dlx="attract-anchor"]'); const h = a && a.parentElement; if (!h) return false; const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(h); s.addRange(r); return String(s).length > 0; })()`,
  unselect: `(() => { getSelection().removeAllRanges(); return String(getSelection()).length === 0; })()`,
  wheel: `(() => { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true })); return true; })()`,
  touch: `(() => { window.dispatchEvent(new Event('touchstart', { bubbles: true })); return true; })()`,
  typeCode: (word) => `(() => { for (const ch of ${JSON.stringify(String(word))}) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } return true; })()`,
  emptySlot: `!!document.querySelector('button[aria-label="Empty slot"]')`,
  emptySlotClick: `(() => { const b = document.querySelector('button[aria-label="Empty slot"]'); if (!b) return false; b.click(); return true; })()`,
  reset: `(() => { const L = WHQ.app.logic; delete L._dlxIdleMs; delete L._dlxClock; L.setState({ consoleLayer: ${LAYER(false)}, dlxRun: false, dlxRoom: false, settingsOpen: false, paletteOpen: false, cheatOpen: false, reduceMotion: false, tab: 'home', route: null, toasts: [] }); try { getSelection().removeAllRanges(); } catch {} hqFake.reset(true); WHQ.store.refreshBrief(); return true; })()`,
});

export const FEB_10_2026 = new Date(2026, 1, 10, 9, 0, 0).getTime();   // local time, like the unit tests
export const OCT_20_2026 = new Date(2026, 9, 20, 9, 0, 0).getTime();
export const WANT = Object.freeze({ febLabel: 'Season ornament: Paper kite (February)', octLabel: 'Season ornament: Fallen leaf (October)', roomNote: 'Nothing here needs you.', code: 'backroom', emptySlot: 'Empty slot' });

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const zero = (p) => !!p && p.links === 0 && p.listeners === 0 && p.timers === 0 && p.frames === 0;

export function makeDelightsScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = (t) => t.evaluate(PAGE.reset).catch(() => {});
  const probe = async (t) => parse(await t.evaluate(PAGE.probe));
  // layer on, Home, empty Brief, short idle: the attract's start condition
  const armed = async (t, idleMs = 300) => {
    await t.evaluate(PAGE.emptyBrief);
    await t.evaluate(PAGE.arm(true, idleMs));
    return t.waitFor(PAGE.anchor, 4000);
  };
  // leave and come back to the card: a new visit (the loop cap and the idle spell start over)
  const newVisit = async (t) => { await t.evaluate(PAGE.go('projects')); await pause(150); await t.evaluate(PAGE.go('home')); return t.waitFor(PAGE.anchor, 4000); };
  const mouse = (t, n) => t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 240 + (n % 5) * 17, y: 260 + (n % 3) * 13 });
  // a --hidden harness's first real input gives the page focus, and on a profile that has not seen this build's What's new (a solo run) that opens the
  // What's new dialog once, which is a dialog and rightly blocks the scene. Take that one focus up front and close the dialog, so a solo run behaves like the full run.
  const quiet = async (t) => { await mouse(t, 0); await pause(300); await t.evaluate(PAGE.state({ whatsNewOpen: false })); };

  return {
    async 'delights-off-nothing'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.emptyBrief);
        await t.evaluate(PAGE.arm(false, 250));
        await pause(1500);   // well past the shortened idle
        const p = await probe(t);
        if (!p) return out.concat('window.__hqLayerProbe is not there: the Console layer is not wired, so "nothing runs" cannot be proven');
        if (!zero(p)) out.push('layer off but the probe counts something: ' + JSON.stringify(p));
        if (await t.evaluate(PAGE.cssLink)) out.push('delights.css is linked with the layer off');
        if (await t.evaluate(PAGE.anyDlxNode)) out.push('a data-dlx node exists with the layer off');
        if (await t.evaluate(PAGE.consoleNodes)) out.push('a data-hq-console node exists with the layer off');
        if (await t.evaluate(PAGE.scene)) out.push('the attract scene is on screen with the layer off');
        if (await t.evaluate(PAGE.season)) out.push('the seasonal ornament is on screen with the layer off');
        if (await t.evaluate(PAGE.room)) out.push('the back room is on screen with the layer off');
        const c = await t.evaluate(PAGE.ctl);
        if (c) out.push('an attract controller exists with the layer off: ' + c);
        // the typed code and the door are inert with the layer off
        await t.evaluate(PAGE.typeCode(WANT.code)); await pause(200);
        if (await t.evaluate(PAGE.room)) out.push('typing the code opened the room with the layer off');
      } finally { await leave(t); }
      return out;
    },

    async 'delights-attract-idle'(t) {
      const pre = await fresh(t); if (pre) return pre;
      await quiet(t);
      const out = [];
      try {
        await t.evaluate(PAGE.emptyBrief);
        await t.evaluate(PAGE.arm(true, 300));
        await t.evaluate(PAGE.go('projects')); await pause(300);
        const base = await probe(t);   // layer on, the card not on screen: whatever the rest of the layer registers
        if (!base) return out.concat('window.__hqLayerProbe is not there');
        if (!await newVisit(t)) return out.concat('the attract anchor never appeared on the empty Brief with the layer on');
        const armedProbe = await probe(t);
        if (armedProbe.listeners !== base.listeners + 9) out.push('armed listeners should be baseline + 9 inputs, got ' + armedProbe.listeners + ' vs ' + base.listeners);
        if (armedProbe.timers !== base.timers + 1) out.push('armed timers should be baseline + 1 (the one idle clock), got ' + armedProbe.timers + ' vs ' + base.timers);
        if (!await t.waitFor(PAGE.scene, 3500)) return out.concat('the scene never started after the shortened idle: ' + (await t.evaluate(PAGE.ctl)));
        // each kind of input stops it at once; every stop is a fresh visit so the cap of three loops never hides one
        const stops = [
          ['a real mouse move', (n) => mouse(t, n)],
          ['a real key', () => t.press('Escape')],
          ['a wheel', () => t.evaluate(PAGE.wheel)],
          ['a touch', () => t.evaluate(PAGE.touch)],
        ];
        for (let n = 0; n < stops.length; n++) {
          const [what, act] = stops[n];
          if (n > 0) { if (!await newVisit(t)) { out.push('no anchor on a new visit before ' + what); continue; } if (!await t.waitFor(PAGE.scene, 3500)) { out.push('the scene did not start before ' + what); continue; } }
          await act(n);
          if (!await t.waitFor('!' + PAGE.scene, 400)) out.push(what + ' did not stop the scene');
        }
        // leaving the card removes every listener and timer it registered
        await t.evaluate(PAGE.go('projects')); await pause(300);
        const after = await probe(t);
        if (after.listeners !== base.listeners || after.timers !== base.timers) out.push('after leaving the card the probe is ' + JSON.stringify(after) + ', baseline was ' + JSON.stringify(base));
        // the cap: left alone it plays at most three loops and rests with nothing registered
        if (await newVisit(t) && await t.waitFor(PAGE.scene, 3500)) {
          if (!await t.waitFor('!' + PAGE.scene, 3 * 6000 + 4000)) out.push('the scene is still playing after its three loops');
          else {
            const rest = await probe(t);
            if (rest.listeners !== base.listeners || rest.timers !== base.timers) out.push('resting, the probe is ' + JSON.stringify(rest) + ', baseline was ' + JSON.stringify(base));
          }
        } else out.push('the scene did not start for the cap check');
      } finally { await leave(t); }
      return out;
    },

    async 'delights-attract-blockers'(t) {
      const pre = await fresh(t); if (pre) return pre;
      await quiet(t);
      const out = [];
      try {
        if (!await armed(t, 300)) return out.concat('the attract anchor never appeared on the empty Brief with the layer on');
        const cases = [
          ['selected text', async () => { if (!await t.evaluate(PAGE.select)) throw new Error('could not select text'); }, () => t.evaluate(PAGE.unselect)],
          ['Settings open', () => t.evaluate(PAGE.state({ settingsOpen: true })), () => t.evaluate(PAGE.state({ settingsOpen: false }))],
          ['the palette open', () => t.evaluate(PAGE.state({ paletteOpen: true, paletteMode: 'go', paletteQuery: '' })), () => t.evaluate(PAGE.state({ paletteOpen: false }))],
          ['the cheat sheet open', () => t.evaluate(PAGE.state({ cheatOpen: true })), () => t.evaluate(PAGE.state({ cheatOpen: false }))],
        ];
        for (const [what, block, unblock] of cases) {
          if (!await newVisit(t)) { out.push('no anchor before the ' + what + ' case'); continue; }
          try { await block(); } catch (e) { out.push(what + ': ' + e.message); continue; }
          await pause(1400);   // several shortened idle spells
          if (await t.evaluate(PAGE.scene)) out.push('the scene started while ' + what);
          await unblock();
          if (!await t.waitFor(PAGE.scene, 3500)) out.push('with ' + what + ' cleared the scene still did not start (the blocker was not the only thing in the way)');
          await mouse(t, 1);
        }
      } finally { await leave(t); }
      return out;
    },

    async 'delights-attract-reduced-motion'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const check = async (what) => {
        await pause(1400);
        if (await t.evaluate(PAGE.scene)) out.push(what + ': the scene started');
        if (await t.evaluate(PAGE.anchor)) out.push(what + ': the attract anchor is still drawn');
        const p = await probe(t);
        if (p && p.timers !== 0) out.push(what + ': a timer is registered: ' + JSON.stringify(p));
        const a = await t.evaluate(PAGE.seasonAnimations);
        if (a > 0) out.push(what + ': the ornament has ' + a + ' running animations');
        if (a === -1) out.push(what + ': the ornament is not drawn (it is static, not hidden)');
      };
      try {
        if (!await armed(t, 300)) return out.concat('the attract anchor never appeared on the empty Brief with the layer on');
        await t.evaluate(PAGE.state({ reduceMotion: true }));
        await check('with the Reduce motion pref');
        await t.evaluate(PAGE.state({ reduceMotion: false }));
        if (!await t.waitFor(PAGE.anchor, 4000)) out.push('turning Reduce motion off did not bring the slot back');
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await t.evaluate(PAGE.rerender);
        await check('with the OS media query');
      } finally {
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] }).catch(() => {});
        await leave(t);
      }
      return out;
    },

    async 'delights-season'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.arm(true, 300));
        await t.evaluate(PAGE.pinClock(FEB_10_2026));
        if (!await t.waitFor(PAGE.season, 4000)) return out.concat('the seasonal ornament never appeared beside the Home greeting');
        const a = await t.evaluate(PAGE.seasonLabel);
        if (a !== WANT.febLabel) out.push('February label is "' + a + '", wanted "' + WANT.febLabel + '"');
        if (!/Paper kite/.test(String(await t.evaluate(PAGE.seasonTitle)))) out.push('the ornament has no title');
        const size = await t.evaluate(PAGE.seasonSize);
        if (!size || size[0] !== 28 || size[1] !== 28) out.push('the ornament is not 28 x 28: ' + JSON.stringify(size));
        if ((await t.evaluate(PAGE.seasonAnimations)) !== 0) out.push('the ornament is not static');
        await t.evaluate(PAGE.pinClock(OCT_20_2026));
        if (!await t.waitFor(`${PAGE.seasonLabel} === ${JSON.stringify(WANT.octLabel)}`, 3000)) out.push('a different month did not change the ornament: ' + (await t.evaluate(PAGE.seasonLabel)));
        await t.evaluate(PAGE.state({ consoleLayer: { on: false, skin: false, scan: false, palette: '', debug: false, shelf: false } }));
        if (!await t.waitFor('!' + PAGE.season, 3000)) out.push('the layer off did not remove the ornament');
      } finally { await leave(t); }
      return out;
    },

    async 'delights-room'(t) {
      const pre = await fresh(t); if (pre) return pre;
      await quiet(t);
      const out = [];
      try {
        await t.evaluate(PAGE.arm(true, 300));
        await t.evaluate(PAGE.state({ settingsOpen: true }));
        if (!await t.waitFor(PAGE.emptySlot, 4000)) return out.concat('Settings has no "' + WANT.emptySlot + '" button on the Memory card (the memory card dish is not wired)');
        await t.evaluate(`(() => { hqFake.reset(true); return true; })()`);
        const calls0 = await t.evaluate(PAGE.calls), res0 = await t.evaluate(PAGE.resources);
        await t.evaluate(PAGE.emptySlotClick);
        if (!await t.waitFor(PAGE.room, 3000)) return out.concat('the Empty slot did not open the back room');
        const txt = String(await t.evaluate(PAGE.roomText));
        if (!txt.includes(WANT.roomNote)) out.push('the room lacks its note: ' + txt.slice(0, 200));
        if ((await t.evaluate(PAGE.roomButtons)) !== 1) out.push('the room should have exactly one button (close)');
        if ((await t.evaluate(PAGE.calls)) !== calls0) out.push('opening the room made an hq call');
        if ((await t.evaluate(PAGE.resources)) !== res0) out.push('opening the room loaded a resource');
        const found = parse(await t.evaluate(PAGE.found)) || [];
        if (!found.includes(WANT.code)) out.push('"backroom" is not in the found list: ' + JSON.stringify(found));
        await t.press('Escape');
        if (!await t.waitFor('!' + PAGE.room, 2000)) out.push('Escape did not close the room');
        if (!await t.evaluate(`!!document.querySelector('[role="dialog"][aria-label="Settings"]')`)) out.push('Escape closed Settings along with the room (it should close the room first)');
        await t.evaluate(PAGE.state({ settingsOpen: false }));
        // the typed code (the cheat registry); a Settings-free screen so no field is focused
        await t.evaluate(PAGE.typeCode(WANT.code));
        if (!await t.waitFor(PAGE.room, 2500)) out.push('typing the code did not open the room with the layer on');
        await t.press('Escape');
        if (!await t.waitFor('!' + PAGE.room, 2000)) out.push('Escape did not close the room after the typed code');
        if ((await t.evaluate(PAGE.calls)) !== calls0) out.push('the room path made an hq call');
      } finally { await leave(t); }
      return out;
    },
  };
}
