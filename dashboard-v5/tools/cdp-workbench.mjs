// CDP scenarios for the Workbench look (batch 8, dish 4: the second Console-layer look, drawn in code). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeWorkbenchScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario workbench-skin,workbench-art,workbench-reduced-motion,workbench-leave   (needs --preload=fake)
//
//   workbench-skin            switch the layer on and choose the Workbench chip in Settings: data-hq-look=workbench, the Console skin attribute stays empty, ONE extra stylesheet
//                             (#hq-workbench-css) is loaded and its own tokens resolve (--bg, --gold), no scanline attribute, the probe counts 3 links; the warm red chip adds data-hq-accent=signal
//                             and a fourth link; choosing Console leaves the look (and removes its sheet); the layer off is all zeros again
//   workbench-art             under the look, Claude > Crew and Life > Notes carry their small picture: the readout reads "<n> SKILLS" / "<n> NOTES" with n the number the app holds, the
//                             picture is named once (role img, aria-label), the readout sits inside its screen box, the drawing has real size; with the look off there is no picture at all
//   workbench-reduced-motion  the screen cursor blinks only when the OS and the app both allow motion: with Reduce motion on, and again with the OS preference emulated, its computed
//                             animation is none; with both free it is the sheet's own wbn- keyframes
//   workbench-leave           the shell Light/dark button, the palette's "Toggle light / dark" and the Dark chip each leave the look (attribute empty, sheet gone, layer still on, the red accent kept)
// Each scenario puts back the prefs it touched (consoleLayer, themePref, reduceMotion, the emulated media) and ends with hqFake.reset(true).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens } from '../styles/tokens-parse.mjs';
import { PAGE as C, LAYER_OFF } from './cdp-console.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const q = JSON.stringify;
export const LAYER_LOOK = Object.freeze({ on: true, skin: false, scan: false, palette: '', debug: false, shelf: false, look: 'workbench' });
export const SCENARIO_NAMES = Object.freeze(['workbench-skin', 'workbench-art', 'workbench-reduced-motion', 'workbench-leave']);

/** The sheet's own dark and light token values, and the red palette's (one source of truth for the expected computed colours). */
export function workbenchTokens() {
  const w = parseTokens(readFileSync(resolve(HERE, '../styles/workbench.css'), 'utf8')).rules;
  const p = parseTokens(readFileSync(resolve(HERE, '../styles/palettes.css'), 'utf8')).rules;
  return {
    dark: w['[data-hq-look=workbench][data-hq-theme]'] || {}, light: w['[data-hq-look=workbench][data-hq-theme=light]'] || {},
    signalDark: p['[data-hq-look=workbench][data-hq-theme][data-hq-accent=signal]'] || {}, signalLight: p['[data-hq-look=workbench][data-hq-theme=light][data-hq-accent=signal]'] || {},
  };
}

export const PAGE = Object.freeze({
  look: `(() => { const r = ${C.root}; return r ? r.getAttribute('data-hq-look') : undefined; })()`,
  accent: `(() => { const r = ${C.root}; return r ? r.getAttribute('data-hq-accent') : undefined; })()`,
  links: `document.querySelectorAll('link#hq-workbench-css').length`,
  sheetLoaded: `(() => { const l = document.getElementById('hq-workbench-css'); try { return !!(l && l.sheet && l.sheet.cssRules.length > 0); } catch (e) { return false; } })()`,
  probeLinks: `(window.__hqLayerProbe ? window.__hqLayerProbe().links : -1)`,
  theme: `WHQ.app.logic.themeName()`,
  go: (tab, sub) => `(() => { WHQ.app.logic.go(${q(tab)}, ${q(sub)}); return true; })()`,
  artText: (kind) => `(() => { const a = document.querySelector('[data-wbn="art-${kind}"]'); const r = a && a.querySelector('[data-wbn="readout"]'); return r ? r.textContent.trim() : null; })()`,
  artCount: `document.querySelectorAll('[data-wbn^="art-"]').length`,
  artInfo: (kind) => `(() => { const a = document.querySelector('[data-wbn="art-${kind}"]'); if (!a) return null; const r = a.querySelector('[data-wbn="readout"]'), s = a.querySelector('svg'); const ab = a.getBoundingClientRect(), rb = r.getBoundingClientRect(); return JSON.stringify({ role: a.getAttribute('role'), label: a.getAttribute('aria-label'), w: Math.round(ab.width), h: Math.round(ab.height), inside: rb.left >= ab.left - 1 && rb.right <= ab.right + 1 && rb.top >= ab.top - 1 && rb.bottom <= ab.bottom + 1, readoutHidden: r.getAttribute('aria-hidden'), svgHidden: s.getAttribute('aria-hidden'), paths: s.querySelectorAll('path').length, ns: (s.querySelector('path') || {}).namespaceURI || '', bbox: (() => { const p = s.querySelector('path'); try { const b = p.getBBox(); return Math.round(b.width) + 'x' + Math.round(b.height); } catch (e) { return 'none'; } })(), upper: getComputedStyle(r).textTransform, mono: /mono|monospace/i.test(getComputedStyle(r).fontFamily) }); })()`,
  cursor: `(() => { const c = document.querySelector('.wbn-cursor'); if (!c) return null; const cs = getComputedStyle(c); return JSON.stringify({ name: cs.animationName, iter: cs.animationIterationCount }); })()`,
  heldCount: (key) => `(() => { const s = WHQ.app.logic.state; return ${key === 'crw' ? "(s.crw && s.crw.rows ? s.crw.rows.length : -1)" : "(s.vdk && s.vdk.data && s.vdk.data.recent ? s.vdk.data.recent.length : -1)"}; })()`,
  setState: (o) => `(() => { WHQ.app.logic.setState(${q(o)}); return true; })()`,
  tokenNow: (name) => C.cssVar(name),
  chips: `(() => { const d = document.querySelector('[role="dialog"][aria-label="Settings"]'); return d ? JSON.stringify([...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((x) => ['Dark', 'Light', 'Follow system', 'Console', 'Workbench'].includes(x))) : null; })()`,
});

export function makeWorkbenchScenarios({ fresh, sleep }) {
  const pause = (t, ms) => (t && typeof t.sleep === 'function' ? t.sleep(ms) : sleep(ms));
  const json = async (t, expr) => { const v = await t.evaluate(expr); try { return v === null || v === undefined ? v : JSON.parse(v); } catch (e) { return v; } };
  const snapshotOf = async (t) => (await json(t, C.snapshot)) || { themePref: 'dark', reduceMotion: false };
  const leave = async (t, snap) => {
    await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
    await t.evaluate(C.restore(snap || { themePref: 'dark', reduceMotion: false })).catch(() => {});
    await t.evaluate(C.reset).catch(() => {});
    await t.evaluate(PAGE.go('home', null)).catch(() => {});
  };
  const lookOn = async (t, out, where, extra) => {
    await t.evaluate(C.setLayer({ ...LAYER_LOOK, ...(extra || {}) }));
    if (!await t.waitFor(`${PAGE.links} === 1 && ${PAGE.sheetLoaded} && ${PAGE.look} === 'workbench'`, 6000)) { out.push(where + ': the look never showed (link ' + await t.evaluate(PAGE.links) + ', attr ' + JSON.stringify(await t.evaluate(PAGE.look)) + ')'); return false; }
    return true;
  };
  const tok = workbenchTokens();
  const hex = (s) => String(s || '').trim().toLowerCase();

  return {
    async 'workbench-skin'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(C.restore(snap));
        await t.evaluate(C.openSettings);
        if (!await t.waitFor(`!!${'document.querySelector(\'[role="dialog"][aria-label="Settings"]\')'}`, 4000)) return out.concat('Settings never opened');
        if (JSON.stringify(await json(t, PAGE.chips)) !== JSON.stringify(['Dark', 'Light', 'Follow system'])) out.push('with the layer off the Appearance chips are not just the three base ones: ' + await t.evaluate(PAGE.chips));
        if (await t.evaluate(PAGE.look) !== '') out.push('the root data-hq-look is not an empty attribute while the layer is off: ' + JSON.stringify(await t.evaluate(PAGE.look)));
        if (await t.evaluate(PAGE.links) !== 0) out.push('the Workbench sheet is in the page while the layer is off');
        await t.evaluate(C.clickSwitch('Console layer'));
        if (!await t.waitFor(`${PAGE.chips}.includes('Workbench')`, 4000)) return out.concat('the Workbench chip never appeared with the layer on: ' + await t.evaluate(PAGE.chips));
        await t.evaluate(C.clickChip('Workbench'));
        if (!await t.waitFor(`${PAGE.links} === 1 && ${PAGE.sheetLoaded} && ${PAGE.look} === 'workbench'`, 6000)) return out.concat('choosing the Workbench chip did not load the look (link ' + await t.evaluate(PAGE.links) + ')');
        if (await t.evaluate(C.skinAttr) !== '') out.push('the Console skin attribute is not empty under the look: ' + JSON.stringify(await t.evaluate(C.skinAttr)));
        if (await t.evaluate(C.scanAttr) !== null) out.push('the scanline attribute is set under the look');
        if (await t.evaluate(PAGE.probeLinks) !== 3) out.push('the probe counts ' + await t.evaluate(PAGE.probeLinks) + ' links under the look, want 3 (console sheet, delights, workbench)');
        const dark = (await t.evaluate(PAGE.theme)) !== 'light';
        const want = dark ? tok.dark : tok.light;
        for (const k of ['--bg', '--gold', '--text']) if (hex(await t.evaluate(PAGE.tokenNow(k))) !== hex(want[k])) out.push(k + ' computes to ' + await t.evaluate(PAGE.tokenNow(k)) + ', the sheet says ' + want[k]);
        // the warm red accent
        await t.evaluate(C.clickSwitch('Warm red accent'));
        if (!await t.waitFor(`${PAGE.accent} === 'signal' && ${PAGE.probeLinks} === 4`, 6000)) out.push('the warm red chip did not set data-hq-accent=signal with a fourth link (accent ' + JSON.stringify(await t.evaluate(PAGE.accent)) + ', links ' + await t.evaluate(PAGE.probeLinks) + ')');
        else {
          const red = dark ? tok.signalDark : tok.signalLight;
          if (hex(await t.evaluate(PAGE.tokenNow('--gold'))) !== hex(red['--gold'])) out.push('--gold under the red accent is ' + await t.evaluate(PAGE.tokenNow('--gold')) + ', the palette says ' + red['--gold']);
        }
        await t.evaluate(C.clickSwitch('Warm red accent'));
        if (!await t.waitFor(`${PAGE.accent} === '' && ${PAGE.probeLinks} === 3`, 6000)) out.push('turning the red chip off left the accent or its link');
        // Console leaves the look
        await t.evaluate(C.clickChip('Console'));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === '' && ${C.skinAttr} === 'console'`, 6000)) out.push('choosing Console did not leave the look (workbench sheets ' + await t.evaluate(PAGE.links) + ', look ' + JSON.stringify(await t.evaluate(PAGE.look)) + ')');
        await t.evaluate(C.clickChip('Workbench'));
        if (!await t.waitFor(`${PAGE.links} === 1 && ${PAGE.look} === 'workbench' && ${C.skinAttr} === ''`, 6000)) out.push('choosing Workbench again did not leave the Console skin');
        // off: zero, without a reload
        await t.evaluate(C.mark);
        await t.evaluate(C.clickSwitch('Console layer'));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === '' && ${C.links} === 0 && ${PAGE.probeLinks} === 0`, 6000)) out.push('the layer off left something behind (look sheet ' + await t.evaluate(PAGE.links) + ', probe ' + await t.evaluate(C.probe) + ')');
        if (!await t.evaluate(C.marked)) out.push('the page reloaded when the look was switched off');
        const p = await json(t, C.probe);
        if (!p || p.listeners !== 0 || p.timers !== 0 || p.frames !== 0) out.push('the probe is not all zeros with the layer off: ' + JSON.stringify(p));
      } finally { await leave(t, snap); }
      return out;
    },

    async 'workbench-art'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(C.restore(snap));
        // look off: nothing of it
        await t.evaluate(PAGE.go('claude', 'crew'));
        if (!await t.waitFor(`!!document.querySelector('[data-crw="view"]')`, 8000)) return out.concat('Claude > Crew never showed');
        if (await t.evaluate(PAGE.artCount) !== 0) out.push('a Workbench picture is in the page while the layer is off');
        if (!await lookOn(t, out, 'crew')) return out;
        if (!await t.waitFor(`${PAGE.artText('skills')} !== null`, 6000)) return out.concat('the Crew header never drew its picture under the look');
        const held = await t.evaluate(PAGE.heldCount('crw'));
        if (await t.evaluate(PAGE.artText('skills')) !== held + ' SKILLS') out.push('the Crew readout is ' + JSON.stringify(await t.evaluate(PAGE.artText('skills'))) + ', the roster holds ' + held);
        const a = await json(t, PAGE.artInfo('skills'));
        if (!a) out.push('no picture info for the Crew');
        else {
          if (a.role !== 'img' || a.label !== held + ' skills') out.push('the picture is not named once as "' + held + ' skills": ' + JSON.stringify({ role: a.role, label: a.label }));
          if (a.readoutHidden !== 'true' || a.svgHidden !== 'true') out.push('the drawing or its readout is not hidden from a screen reader (the wrapper speaks once)');
          if (a.w < 100 || a.h < 60) out.push('the picture has no real size: ' + a.w + ' x ' + a.h);
          if (!a.inside) out.push('the readout is outside the picture');
          if (a.paths < 6) out.push('the drawing has only ' + a.paths + ' shapes');
          if (a.ns !== 'http://www.w3.org/2000/svg') out.push('the shapes are not in the SVG namespace, so nothing paints: ' + JSON.stringify(a.ns));
          if (!/^[1-9]\d*x\d+$|^\d+x[1-9]\d*$/.test(a.bbox)) out.push('the first shape has no size (' + a.bbox + '), so nothing paints');
          if (a.upper !== 'uppercase' || !a.mono) out.push('the readout is not uppercase monospace: ' + JSON.stringify({ upper: a.upper, mono: a.mono }));
        }
        await t.evaluate(PAGE.go('life', 'notes'));
        if (!await t.waitFor(`${PAGE.artText('notes')} !== null`, 8000)) out.push('the Vault desk header never drew its picture under the look');
        else {
          const n = await t.evaluate(PAGE.heldCount('vdk'));
          if (await t.evaluate(PAGE.artText('notes')) !== n + ' NOTES') out.push('the Vault desk readout is ' + JSON.stringify(await t.evaluate(PAGE.artText('notes'))) + ', the desk lists ' + n);
          if (await t.evaluate(PAGE.artCount) !== 1) out.push('more than one picture is on the Vault desk screen: ' + await t.evaluate(PAGE.artCount));
        }
        // the Console skin and the layer off show none
        await t.evaluate(C.setLayer({ ...LAYER_LOOK, look: '', skin: true }));
        await pause(t, 250);
        if (await t.evaluate(PAGE.artCount) !== 0) out.push('a Workbench picture is in the page under the Console skin');
        await t.evaluate(C.setLayer({ ...LAYER_LOOK, on: false }));
        await pause(t, 250);
        if (await t.evaluate(PAGE.artCount) !== 0) out.push('a Workbench picture is in the page with the layer off and a look stored');
      } finally { await leave(t, snap); }
      return out;
    },

    async 'workbench-reduced-motion'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(C.restore(snap));
        await t.evaluate(PAGE.go('claude', 'crew'));
        if (!await t.waitFor(`!!document.querySelector('[data-crw="view"]')`, 8000)) return out.concat('Claude > Crew never showed');
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await t.evaluate(C.setReduce(false));
        if (!await lookOn(t, out, 'motion allowed')) return out;
        if (!await t.waitFor(`${PAGE.cursor} !== null`, 6000)) return out.concat('the screen cursor never drew');
        let c = await json(t, PAGE.cursor);
        if (!c || !/^wbn-/.test(c.name)) out.push('with motion allowed the cursor does not run the sheet\'s wbn- keyframes: ' + JSON.stringify(c));
        // the app's Reduce motion pref
        await t.evaluate(C.setReduce(true));
        await pause(t, 300);
        c = await json(t, PAGE.cursor);
        if (!c || c.name !== 'none') out.push('with Reduce motion on the cursor still animates: ' + JSON.stringify(c));
        // the OS preference
        await t.evaluate(C.setReduce(false));
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await pause(t, 300);
        c = await json(t, PAGE.cursor);
        if (!c || c.name !== 'none') out.push('with the OS reduced-motion preference the cursor still animates: ' + JSON.stringify(c));
      } finally { await leave(t, snap); }
      return out;
    },

    async 'workbench-leave'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      const left = async (where) => {
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === ''`, 6000)) { out.push(where + ': the look stayed on (sheets ' + await t.evaluate(PAGE.links) + ', attr ' + JSON.stringify(await t.evaluate(PAGE.look)) + ')'); return; }
        const L = await json(t, C.layer);
        if (!L || L.on !== true) out.push(where + ': the layer itself was switched off: ' + JSON.stringify(L));
        if (!L || L.look !== '') out.push(where + ': the stored look is not cleared: ' + JSON.stringify(L));
        if (!L || L.palette !== 'signal') out.push(where + ': the red accent choice was not kept: ' + JSON.stringify(L));
      };
      try {
        await t.evaluate(C.restore(snap));
        if (!await lookOn(t, out, 'shell button', { palette: 'signal' })) return out;
        await t.evaluate(`(() => { const b = document.querySelector('button[title="Light / dark"]'); if (!b) return false; b.click(); return true; })()`);
        await left('the shell Light/dark button');
        if (!await lookOn(t, out, 'palette toggle', { palette: 'signal' })) return out;
        await t.evaluate(C.paletteToggle);
        await left('the palette "Toggle light / dark"');
        if (!await lookOn(t, out, 'Dark chip', { palette: 'signal' })) return out;
        await t.evaluate(C.openSettings);
        if (!await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Settings"]')`, 4000)) return out.concat('Settings never opened');
        await t.evaluate(C.clickChip('Dark'));
        await left('the Dark chip');
      } finally { await leave(t, snap); }
      return out;
    },
  };
}
