// CDP scenarios for the "New version inserted" card (batch 7, dish version-card). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeVersionCardScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario version-card-plays-once,version-card-skip,version-card-hidden-launch,version-card-layer-off-hidden,version-card-reduced-motion,version-card-new-stamp   (needs --preload=fake)
//
// Needs the Console layer dish (consoleLayer pref, window.__hqLayerProbe) to be in the build. Every scenario writes its own prefs (the layer, the
// stamp last seen, what's-new already seen so it never holds the card back), injects a page-side recorder AND a visibility override before the
// reload (the harness window may itself be hidden, and a hidden launch is exactly what two scenarios need), reloads, and puts everything back:
// the prefs, the injected script, the emulated media, hqFake.reset(true), and a clean reload.
//
//   version-card-plays-once         layer on, no stamp seen yet (a first-ever run), window visible: the card shows once with the caption and the
//                                   stamp, role=status aria-live=polite, focus untouched, no AudioContext made while it shows; it goes by itself after
//                                   about 1.2 s; the layer registered exactly 2 listeners and 1 timer for it and they are gone; the stamp is stored;
//                                   a reload does not show it again
//   version-card-skip               press a key (run one) / press the pointer (run two): the card is gone at once, its listeners and timer with it, and it
//                                   stays gone after a reload
//   version-card-hidden-launch      layer on, document hidden at load: nothing shows, one visibility listener waits; make it visible: the card shows once
//                                   and the waiting listener is gone
//   version-card-layer-off-hidden   layer off, document hidden, stamp unseen: no card, no node, probe all zeros, the stamp is recorded at load; make it
//                                   visible and switch the layer on later: it does NOT play (not now, not after a reload)
//   version-card-reduced-motion     with the app's reduceMotion pref and again with the OS media query: no card, the stamp is recorded, nothing registered
//   version-card-new-stamp          the stored stamp is an older build's, layer on: it plays again once, then a reload does not

import { BUILD_STAMP } from '../src/live/build-stamp.mjs';
import { WHATS_NEW_VERSION } from '../src/logic/whats-new.js';

const PREFS_KEY = 'whq3-prefs';
const READY = `!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0 && !!window.hqFake)`;
export const LAYER_ON = Object.freeze({ on: true, skin: false, scan: false, palette: '', debug: false, shelf: false });
export const LAYER_OFF = Object.freeze({ on: false, skin: false, scan: false, palette: '', debug: false, shelf: false });
export const OLDER_STAMP = '2026-10-01.batch6';
export const CARD_MS = 1200;

/** the script injected before every load: a visibility override, an audio-construction counter and a recorder of the card coming and going */
export const initScript = (hidden) => `(() => {
  window.__vcdHidden = ${hidden ? 'true' : 'false'};
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__vcdHidden ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__vcdHidden });
  } catch (e) {}
  window.__vcdAudio = 0;
  const O = window.AudioContext || window.webkitAudioContext;
  if (O) { const W = function (...a) { window.__vcdAudio++; return new O(...a); }; W.prototype = O.prototype; window.AudioContext = W; }
  window.__vcdLog = []; window.__vcdOn = false;
  const look = () => {
    const c = document.querySelector('[data-vcd="card"]'), n = performance.now();
    if (c && !window.__vcdOn) { window.__vcdOn = true; window.__vcdLog.push(['on', n, window.__vcdAudio]); }
    else if (!c && window.__vcdOn) { window.__vcdOn = false; window.__vcdLog.push(['off', n, window.__vcdAudio]); }
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true });
})()`;

export const PAGE = Object.freeze({
  ready: READY,
  has: `!!document.querySelector('[data-vcd="card"]')`,
  nodes: `document.querySelectorAll('[data-vcd], [data-hq-console]').length`,
  cardNodes: `document.querySelectorAll('[data-vcd]').length`,   // the card only (with the layer ON its own stylesheet link is rightly in the page)
  text: `(() => { const c = document.querySelector('[data-vcd="card"]'); return c ? c.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
  role: `(() => { const c = document.querySelector('[data-vcd="card"]'); return c ? [c.getAttribute('role'), c.getAttribute('aria-live')].join('/') : ''; })()`,
  focusInside: `(() => { const c = document.querySelector('[data-vcd="card"]'); return !!(c && document.activeElement && c.contains(document.activeElement)); })()`,
  probe: `(() => (typeof window.__hqLayerProbe === 'function' ? JSON.stringify(window.__hqLayerProbe()) : null))()`,
  log: `JSON.stringify(window.__vcdLog || [])`,
  audio: `window.__vcdAudio | 0`,
  prefs: `(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)}) || '{}') || {}; } catch (e) { return {}; } })()`,
  prefsRaw: `(() => localStorage.getItem(${JSON.stringify(PREFS_KEY)}))()`,
  /** merge a patch into the saved prefs; a null value removes the key */
  setPrefs: (patch) => `(() => { let p = {}; try { p = JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)}) || '{}') || {}; } catch (e) {} const patch = ${JSON.stringify(patch)}; for (const k of Object.keys(patch)) { if (patch[k] === null) delete p[k]; else p[k] = patch[k]; } localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify(p)); return true; })()`,
  putPrefsBack: (raw) => (raw == null ? `(() => { localStorage.removeItem(${JSON.stringify(PREFS_KEY)}); return true; })()` : `(() => { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, ${JSON.stringify(raw)}); return true; })()`),
  becomeVisible: `(() => { window.__vcdHidden = false; document.dispatchEvent(new Event('visibilitychange')); return true; })()`,
  switchLayerOn: `(() => { WHQ.app.logic.setState({ consoleLayer: ${JSON.stringify(LAYER_ON)} }); return true; })()`,
  press: `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })); return true; })()`,
  reset: `(() => { try { hqFake.reset(true); } catch (e) {} return true; })()`,
});

const parseProbe = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const parseLog = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const sum = (p) => (p ? (p.listeners | 0) + (p.timers | 0) + (p.frames | 0) + (p.links | 0) : -1);

export function makeVersionCardScenarios({ fresh, sleep }) {
  if (typeof sleep !== 'function') throw new Error('makeVersionCardScenarios needs the harness sleep');
  const pause = sleep;

  // one run's bookkeeping: what to put back
  const newRun = () => ({ scriptId: null, priorPrefs: undefined, media: false });

  async function boot(t, run, { prefs, hidden = false, reducedMedia = false }) {
    if (run.priorPrefs === undefined) run.priorPrefs = await t.evaluate(PAGE.prefsRaw);
    await t.evaluate(PAGE.setPrefs(Object.assign({ whatsNewSeen: WHATS_NEW_VERSION }, prefs)));
    if (run.scriptId) await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: run.scriptId }).catch(() => {});
    const r = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript(hidden) });
    run.scriptId = r && r.identifier;
    if (reducedMedia) { await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); run.media = true; }
    await t.reload();
    return t.waitFor(PAGE.ready, 15000);
  }

  async function leave(t, run) {
    try {
      if (run.scriptId) await t.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: run.scriptId }).catch(() => {});
      if (run.media) await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
      if (run.priorPrefs !== undefined) await t.evaluate(PAGE.putPrefsBack(run.priorPrefs)).catch(() => {});
      await t.reload().catch(() => {});
      await t.waitFor(PAGE.ready, 15000);
      await t.evaluate(PAGE.reset).catch(() => {});
    } catch { /* the harness decides what a dead page means */ }
  }

  const stored = async (t) => (await t.evaluate(PAGE.prefs)).versionCardSeen;
  const probeNow = async (t) => parseProbe(await t.evaluate(PAGE.probe));
  const absentFor = async (t, ms) => { for (let spent = 0; spent < ms; spent += 150) { if (await t.evaluate(PAGE.has)) return false; await pause(150); } return !(await t.evaluate(PAGE.has)); };
  const noLayerProbe = 'window.__hqLayerProbe is missing: the Console layer dish is not in this build';

  /** the card shows once, with its caption, stamp and role; returns { log problems } and the probe taken while it showed */
  async function expectCard(t, out, label) {
    if (!await t.waitFor(PAGE.has, 4000)) { out.push(label + ': the card never showed (stored stamp ' + JSON.stringify(await stored(t)) + ')'); return null; }
    const probeShown = await probeNow(t);
    const text = String(await t.evaluate(PAGE.text));
    if (!text.includes('New version inserted')) out.push(label + ': the caption is missing: ' + text.slice(0, 120));
    if (!text.includes(BUILD_STAMP)) out.push(label + ': the stamp ' + BUILD_STAMP + ' is missing: ' + text.slice(0, 120));
    if ((await t.evaluate(PAGE.role)) !== 'status/polite') out.push(label + ': the card is not role=status aria-live=polite: ' + await t.evaluate(PAGE.role));
    if (await t.evaluate(PAGE.focusInside)) out.push(label + ': focus moved into the card');
    return probeShown;
  }

  return {
    async 'version-card-plays-once'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const run = newRun(), out = [];
      try {
        if (!await boot(t, run, { prefs: { consoleLayer: LAYER_ON, versionCardSeen: null } })) return ['the app never came back after the reload'];
        const shown = await expectCard(t, out, 'first run');
        if (!shown) return out;
        if (!await t.waitFor(`!${PAGE.has}`, 3500)) return out.concat('the card did not go by itself within 3.5 s');
        const log = parseLog(await t.evaluate(PAGE.log));
        const on = log.filter((e) => e[0] === 'on'), off = log.filter((e) => e[0] === 'off');
        if (on.length !== 1 || off.length !== 1) out.push('the card came ' + on.length + ' time(s) and went ' + off.length + ', want 1 and 1');
        else {
          const ms = off[0][1] - on[0][1];
          if (ms < 1000 || ms > 1700) out.push('the card stayed ' + Math.round(ms) + ' ms, want about 1200');
          if (off[0][2] !== on[0][2]) out.push('an AudioContext was made while the card showed (' + on[0][2] + ' -> ' + off[0][2] + '): the card makes no sound');
        }
        const after = await probeNow(t);
        if (!shown || !after) out.push(noLayerProbe);
        else if (sum(shown) - sum(after) !== 3 || shown.listeners - after.listeners !== 2 || shown.timers - after.timers !== 1) out.push('the layer held ' + JSON.stringify(shown) + ' while the card showed and ' + JSON.stringify(after) + ' after: want exactly 2 listeners and 1 timer fewer');
        if ((await stored(t)) !== BUILD_STAMP) out.push('the stamp was not stored: ' + JSON.stringify(await stored(t)));
        if (!await boot(t, run, { prefs: {} })) return out.concat('the app never came back after the second reload');
        if (!await absentFor(t, 1800)) out.push('the card showed again after a reload');
        if (parseLog(await t.evaluate(PAGE.log)).length) out.push('the recorder saw the card on the second load');
        out.push(...t.errors());
      } finally { await leave(t, run); }
      return out;
    },

    async 'version-card-skip'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const run = newRun(), out = [];
      try {
        for (const how of ['key', 'click']) {
          if (!await boot(t, run, { prefs: { consoleLayer: LAYER_ON, versionCardSeen: null } })) return out.concat(how + ': the app never came back');
          const shown = await expectCard(t, out, how); if (!shown) return out;
          const base = (await probeNow(t)) || shown;
          if (how === 'key') await t.press('Enter'); else await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 220, y: 220, button: 'left', clickCount: 1 }).then(() => t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 220, y: 220, button: 'left', clickCount: 1 }));
          if (!await t.waitFor(`!${PAGE.has}`, 700)) { out.push(how + ': the card was still there 700 ms after the ' + how); continue; }
          const log = parseLog(await t.evaluate(PAGE.log)), ms = log.length >= 2 ? log[1][1] - log[0][1] : null;
          if (ms !== null && ms > 900) out.push(how + ': it took ' + Math.round(ms) + ' ms to go, want at once');
          const after = await probeNow(t);
          if (!after) out.push(noLayerProbe); else if (base.listeners - after.listeners !== 2 || base.timers - after.timers !== 1) out.push(how + ': after dismissing, the layer still holds ' + JSON.stringify(after) + ' (was ' + JSON.stringify(base) + ')');
          if ((await stored(t)) !== BUILD_STAMP) out.push(how + ': the stamp was not stored');
          if (!await boot(t, run, { prefs: {} })) return out.concat(how + ': the app never came back after the reload');
          if (!await absentFor(t, 1500)) out.push(how + ': the card came back after a reload');
        }
        out.push(...t.errors());
      } finally { await leave(t, run); }
      return out;
    },

    async 'version-card-hidden-launch'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const run = newRun(), out = [];
      try {
        if (!await boot(t, run, { prefs: { consoleLayer: LAYER_ON, versionCardSeen: null }, hidden: true })) return ['the app never came back after the reload'];
        if (!await absentFor(t, 1800)) return out.concat('a card showed in a hidden window');
        const waiting = await probeNow(t);
        if (!waiting) return out.concat(noLayerProbe);
        if ((waiting.listeners | 0) < 1) out.push('nothing waits for the window to show: ' + JSON.stringify(waiting));
        if (await stored(t) === BUILD_STAMP) out.push('the stamp was stored while the card had not been seen');
        await t.evaluate(PAGE.becomeVisible);
        const shown = await expectCard(t, out, 'after showing'); if (!shown) return out;
        if (shown.listeners - waiting.listeners !== 1) out.push('the layer holds ' + JSON.stringify(shown) + ' with the card, ' + JSON.stringify(waiting) + ' while waiting: want the one waiting listener swapped for the two dismiss listeners');
        if (!await t.waitFor(`!${PAGE.has}`, 3500)) return out.concat('the card did not go by itself');
        const log = parseLog(await t.evaluate(PAGE.log));
        if (log.filter((e) => e[0] === 'on').length !== 1) out.push('the card showed ' + log.filter((e) => e[0] === 'on').length + ' times, want once');
        const after = await probeNow(t);
        if (after && after.listeners !== waiting.listeners - 1) out.push('a listener is left over: ' + JSON.stringify(after) + ' (was ' + JSON.stringify(waiting) + ' while waiting)');
        out.push(...t.errors());
      } finally { await leave(t, run); }
      return out;
    },

    async 'version-card-layer-off-hidden'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const run = newRun(), out = [];
      try {
        if (!await boot(t, run, { prefs: { consoleLayer: LAYER_OFF, versionCardSeen: null }, hidden: true })) return ['the app never came back after the reload'];
        await pause(400);
        if ((await t.evaluate(PAGE.nodes)) !== 0) out.push('a card or console node is in the page with the layer off');
        const p = await probeNow(t);
        if (!p) return out.concat(noLayerProbe);
        if (sum(p) !== 0) out.push('the probe is not all zeros with the layer off: ' + JSON.stringify(p));
        if ((await stored(t)) !== BUILD_STAMP) out.push('the stamp was not recorded at load: ' + JSON.stringify(await stored(t)));
        await t.evaluate(PAGE.becomeVisible);
        if (!await absentFor(t, 1500)) out.push('the card showed when the window became visible with the layer off');
        await t.evaluate(PAGE.switchLayerOn);
        if (!await absentFor(t, 1800)) out.push('the card played when the layer was switched on later');
        if (!await boot(t, run, { prefs: { consoleLayer: LAYER_ON } })) return out.concat('the app never came back after the reload');
        if (!await absentFor(t, 1800)) out.push('the card played after a reload with the layer on: the recorded stamp was not honoured');
        out.push(...t.errors());
      } finally { await leave(t, run); }
      return out;
    },

    async 'version-card-reduced-motion'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const run = newRun(), out = [];
      try {
        for (const how of ['the reduceMotion pref', 'the OS media query']) {
          const opts = how === 'the OS media query' ? { reducedMedia: true, prefs: { consoleLayer: LAYER_ON, versionCardSeen: null, reduceMotion: false } } : { prefs: { consoleLayer: LAYER_ON, versionCardSeen: null, reduceMotion: true } };
          if (!await boot(t, run, opts)) return out.concat(how + ': the app never came back');
          if (!await absentFor(t, 1800)) out.push(how + ': a card showed');
          if ((await t.evaluate(PAGE.cardNodes)) !== 0) out.push(how + ': a card node is in the page');
          if ((await stored(t)) !== BUILD_STAMP) out.push(how + ': the stamp was not recorded: ' + JSON.stringify(await stored(t)));
          const p = await probeNow(t);
          if (p && (p.timers | 0) !== 0) out.push(how + ': a timer is registered: ' + JSON.stringify(p));
        }
        out.push(...t.errors());
      } finally { await leave(t, run); }
      return out;
    },

    async 'version-card-new-stamp'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const run = newRun(), out = [];
      try {
        if (!await boot(t, run, { prefs: { consoleLayer: LAYER_ON, versionCardSeen: OLDER_STAMP } })) return ['the app never came back after the reload'];
        const shown = await expectCard(t, out, 'new stamp'); if (!shown) return out;
        if (!await t.waitFor(`!${PAGE.has}`, 3500)) return out.concat('the card did not go by itself');
        if ((await stored(t)) !== BUILD_STAMP) out.push('the stamp was not replaced: ' + JSON.stringify(await stored(t)));
        if (!await boot(t, run, { prefs: {} })) return out.concat('the app never came back after the second reload');
        if (!await absentFor(t, 1800)) out.push('it played a second time for the same stamp');
        out.push(...t.errors());
      } finally { await leave(t, run); }
      return out;
    },
  };
}
