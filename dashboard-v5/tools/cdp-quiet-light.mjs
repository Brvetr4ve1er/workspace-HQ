// CDP scenarios for "Quiet and light" (batch 6, dish quiet-light). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeQuietLightScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario quiet-hidden-no-rerender,quiet-sound-default-off,reach-notify-test   (needs --preload=fake)
//
//   quiet-hidden-no-rerender  document.visibilityState is overridden to 'hidden', a subscriber counts the store's emits, the fake pushes 5 machine
//                             samples: 0 emits and the latest sample is stored; flipping to visible fires exactly 1 emit, carrying the latest
//   quiet-sound-default-off   a fresh profile AND a profile that saved sound:true (an older build): both start with the Sound switch Off, with
//                             sound:false + soundV:2 persisted at once and no AudioContext made by a tab or a click; turning Sound on and reloading keeps it on
//   reach-notify-test         the Reach row 'notify-test' shows its button; pressing it calls hq.reach.notifyTest ONCE and the toast says so honestly
//                             ("Sent - did you see it?" or the reason it did not); nothing else is called
//
// Needs from the fake preload (tools/fake-preload.js, shared edit): hq.reach.notifyTest (answers { ok:true }; hqFake.set('reach.notifyTest', ...)
// overrides) and ONE more row in reach.read: { id:'notify-test', ok:null, detail:'Press the button: ...', actions:[{ id:'notify-test', label:'Send a test notification' }] }.
// Each scenario puts back what it touched (visibilityState, the prefs it wrote, the AudioContext wrapper) and ends with hqFake.reset(true).

const PREFS_KEY = 'whq3-prefs';
const READY = `!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0)`;
export const SAMPLE = (n) => ({ cpu: 10 + n, ram: 40 + n, n });
export const TEST_LABEL = 'Send a test notification';

export const PAGE = Object.freeze({
  hide: `(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); return document.visibilityState; })()`,
  show: `(() => { delete document.visibilityState; return document.visibilityState; })()`,
  fireVisibility: `(() => { document.dispatchEvent(new Event('visibilitychange')); return true; })()`,
  countEmits: `(() => { window.__qlEmits = 0; window.__qlOff = WHQ.store.on(() => { window.__qlEmits++; }); return true; })()`,
  stopCount: `(() => { if (window.__qlOff) window.__qlOff(); window.__qlOff = null; return true; })()`,
  emits: `window.__qlEmits | 0`,
  push: (n) => `(() => { hqFake.emit('hq:machine', ${JSON.stringify(SAMPLE(n))}); return true; })()`,
  machineN: `(() => { const m = WHQ.store.live.machine; return m ? m.n : null; })()`,
  prefs: `(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)}) || '{}') || {}; } catch (e) { return {}; } })()`,
  setPrefs: (o) => `(() => { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, ${JSON.stringify(JSON.stringify(o))}); return true; })()`,
  clearPrefs: `(() => { localStorage.removeItem(${JSON.stringify(PREFS_KEY)}); return true; })()`,
  prefsRaw: `(() => localStorage.getItem(${JSON.stringify(PREFS_KEY)}))()`,
  openSettings: `(() => { WHQ.app.logic.setState({ settingsOpen: true }); return true; })()`,
  closeSettings: `(() => { WHQ.app.logic.setState({ settingsOpen: false }); return true; })()`,
  soundText: `(() => { const b = [...document.querySelectorAll('button[role="switch"]')].find((x) => x.parentElement && /^Sound/.test(x.parentElement.textContent.trim())); return b ? b.textContent.trim() : null; })()`,
  soundDesc: `(() => { const b = [...document.querySelectorAll('button[role="switch"]')].find((x) => x.parentElement && /^Sound/.test(x.parentElement.textContent.trim())); return b ? b.parentElement.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
  clickSound: `(() => { const b = [...document.querySelectorAll('button[role="switch"]')].find((x) => x.parentElement && /^Sound/.test(x.parentElement.textContent.trim())); if (!b) return false; b.click(); return true; })()`,
  stateSound: `WHQ.app.logic.state.sound`,
  wrapAudio: `(() => { if (window.__qlAc) return true; const O = window.AudioContext || window.webkitAudioContext; if (!O) { window.__qlAc = { n: 0, none: true }; return true; } const box = { n: 0, O }; window.AudioContext = function () { box.n++; return new O(); }; window.AudioContext.prototype = O.prototype; window.__qlAc = box; return true; })()`,
  unwrapAudio: `(() => { const b = window.__qlAc; if (b && b.O) window.AudioContext = b.O; window.__qlAc = null; return true; })()`,
  audioMade: `(window.__qlAc ? window.__qlAc.n : 0)`,
  tapButton: `(() => { const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && x.offsetParent); if (!b) return false; const r = b.getBoundingClientRect(); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 2, clientY: r.top + 2 })); return true; })()`,
  goTab: `(() => { const L = WHQ.app.logic; L.go('projects'); L.go('home'); return true; })()`,
  doneSfx: `(() => { window.HQFx && window.HQFx.sfx('done'); return true; })()`,
  reachRow: `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(TEST_LABEL)}); return b || null; })()`,
  clickReach: `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(TEST_LABEL)}); if (!b) return false; b.click(); return true; })()`,
  notifyCalls: `hqFake.calls('reach.notifyTest').length`,
  otherReachCalls: `hqFake.calls().filter((c) => /^reach\\./.test(c.method) && c.method !== 'reach.read' && c.method !== 'reach.notifyTest').length`,
  toasts: `JSON.stringify((WHQ.app.logic.state.toasts || []).map((x) => (x && (x.text || x.msg || x.message)) || ''))`,
  reset: `(() => { hqFake.reset(true); const L = WHQ.app.logic; L.setState({ settingsOpen: false, toasts: [] }); return true; })()`,
});

export function makeQuietLightScenarios({ fresh, sleep }) {
  const pause = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const leave = async (t) => { for (const s of [PAGE.show, PAGE.stopCount, PAGE.unwrapAudio, PAGE.reset]) await t.evaluate(s).catch(() => {}); };
  const reload = async (t) => { await t.reload(); const ok = await t.waitFor(READY + ` && !!window.hqFake && hqFake.calls('liveState').length > 0`, 15000); if (ok) await pause(300); return ok; };
  return {
    async 'quiet-hidden-no-rerender'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.countEmits);
        await t.evaluate(PAGE.hide);
        await pause(50);
        const base = await t.evaluate(PAGE.emits);
        for (let n = 1; n <= 5; n++) await t.evaluate(PAGE.push(n));
        await pause(120);
        const hidden = (await t.evaluate(PAGE.emits)) - base;
        if (hidden !== 0) out.push('5 machine samples while hidden caused ' + hidden + ' store emits, want 0');
        if ((await t.evaluate(PAGE.machineN)) !== 5) out.push('the latest sample was not stored while hidden: ' + await t.evaluate(PAGE.machineN));
        await t.evaluate(PAGE.show);
        const b2 = await t.evaluate(PAGE.emits);
        await t.evaluate(PAGE.fireVisibility);
        await pause(120);
        const shown = (await t.evaluate(PAGE.emits)) - b2;
        if (shown !== 1) out.push('flipping to visible caused ' + shown + ' emits, want exactly 1');
        const b3 = await t.evaluate(PAGE.emits);
        await t.evaluate(PAGE.push(6));
        await pause(120);
        if ((await t.evaluate(PAGE.emits)) - b3 < 1) out.push('a sample while visible did not re-render as before');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },

    async 'quiet-sound-default-off'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const prior = await t.evaluate(PAGE.prefsRaw).catch(() => null);
      const restore = async () => {
        await t.evaluate(prior == null ? PAGE.clearPrefs : `(() => { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, ${JSON.stringify(prior)}); return true; })()`).catch(() => {});
      };
      const check = async (label) => {
        if (!await reload(t)) { out.push(label + ': the app never came back after the reload'); return false; }
        if ((await t.evaluate(PAGE.stateSound)) !== false) out.push(label + ': state.sound is not false at start');
        const p = await t.evaluate(PAGE.prefs);
        if (p.sound !== false || p.soundV !== 2) out.push(label + ': prefs were not persisted at once as sound:false, soundV:2 — ' + JSON.stringify({ sound: p.sound, soundV: p.soundV }));
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`${PAGE.soundText} !== null`, 4000)) { out.push(label + ': the Sound switch never rendered'); return false; }
        if ((await t.evaluate(PAGE.soundText)) !== 'Off') out.push(label + ': the Sound switch reads ' + await t.evaluate(PAGE.soundText) + ', want Off');
        const desc = String(await t.evaluate(PAGE.soundDesc));
        if (/clicks/i.test(desc)) out.push(label + ': the Sound switch still promises sound on clicks: ' + desc);
        if (!/finishes/i.test(desc)) out.push(label + ': the Sound switch wording is not the new one: ' + desc);
        await t.evaluate(PAGE.closeSettings);
        // with sound off, a tab change and a click make no AudioContext
        await t.evaluate(PAGE.wrapAudio);
        await t.evaluate(PAGE.goTab);
        await t.evaluate(PAGE.tapButton);
        await pause(80);
        if ((await t.evaluate(PAGE.audioMade)) !== 0) out.push(label + ': a tab or click made an AudioContext with sound off');
        await t.evaluate(PAGE.unwrapAudio);
        return true;
      };
      try {
        // a fresh profile
        await t.evaluate(PAGE.clearPrefs);
        if (!await check('fresh profile')) return out;
        // a profile an older build left with sound ON and no marker
        await t.evaluate(PAGE.setPrefs({ themePref: 'dark', sound: true }));
        if (!await check('old profile with sound:true')) return out;
        // the owner turns it on; the choice survives a reload
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`${PAGE.soundText} === 'Off'`, 4000)) return out.concat('the Sound switch is not Off before turning it on');
        await t.evaluate(PAGE.clickSound);
        if (!await t.waitFor(`${PAGE.stateSound} === true`, 3000)) return out.concat('pressing the Sound switch did not turn it on');
        await pause(150);
        const p = await t.evaluate(PAGE.prefs);
        if (p.sound !== true || p.soundV !== 2) out.push('turning sound on saved ' + JSON.stringify({ sound: p.sound, soundV: p.soundV }) + ', want sound:true with soundV:2 kept');
        if (!await reload(t)) return out.concat('the app never came back after the reload');
        if ((await t.evaluate(PAGE.stateSound)) !== true) out.push('the owner’s choice (sound on) was undone by the next launch');
        await t.evaluate(PAGE.wrapAudio);
        await t.evaluate(PAGE.doneSfx);
        await pause(80);
        if ((await t.evaluate(PAGE.audioMade)) < 1) out.push('with sound on, a finished-style sound made no AudioContext');
        await t.evaluate(PAGE.unwrapAudio);
        out.push(...t.errors());
      } finally { await restore(); await leave(t); }
      return out;
    },

    async 'reach-notify-test'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      try {
        await t.evaluate(PAGE.reset);
        await t.evaluate(PAGE.openSettings);
        if (!await t.waitFor(`!!${PAGE.reachRow}`, 6000)) return out.concat('Settings › Reach shows no "' + TEST_LABEL + '" button');
        if ((await t.evaluate(PAGE.notifyCalls)) !== 0) out.push('opening Settings already sent a test notification');
        await t.evaluate(PAGE.clickReach);
        if (!await t.waitFor(`${PAGE.notifyCalls} >= 1`, 4000)) return out.concat('the button never called hq.reach.notifyTest');
        await pause(200);
        if ((await t.evaluate(PAGE.notifyCalls)) !== 1) out.push('one press called notifyTest ' + await t.evaluate(PAGE.notifyCalls) + ' times, want 1');
        if (!await t.waitFor(`${PAGE.toasts}.includes('Sent - did you see it?') || ${PAGE.toasts}.includes('Sent \\u2013 did you see it?') || ${PAGE.toasts}.includes('Sent \\u2014 did you see it?')`, 3000)) out.push('no honest toast after the press: ' + await t.evaluate(PAGE.toasts));
        if ((await t.evaluate(PAGE.otherReachCalls)) !== 0) out.push('the button called something besides notifyTest on reach');
        out.push(...t.errors());
      } finally { await leave(t); }
      return out;
    },
  };
}
