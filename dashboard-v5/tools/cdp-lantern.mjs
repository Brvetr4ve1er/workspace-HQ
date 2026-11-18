// CDP scenarios for the Lantern look (batch 11: the third Console-layer look, drawn in code). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeLanternScenarios({ fresh, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario lantern-skin,lantern-art,lantern-sealed,lantern-reduced-motion,lantern-leave   (needs --preload=fake)
//   (the gate step runs them through its own hidden window: node tools/gates.mjs --only cdp --scenario lantern-skin,lantern-art,...)
//
//   lantern-skin             switch the layer on and choose the Lantern chip in Settings: data-hq-look=lantern, the Console skin attribute stays empty, ONE extra stylesheet (#hq-lantern-css)
//                            is loaded and its own tokens resolve (--bg, --gold, --text, --lnt-brass), the probe counts 3 links, a heading really takes the serif stack in capitals, a
//                            stored accent palette adds no link and no attribute, the red-accent row is not offered; Workbench and Console each take the look over; the layer off is zero again
//   lantern-art              under the look: the project's own card (the same id is the same card after leaving and coming back), the Crew and Vault desk cards with the numbers the app
//                            holds ("<n> SKILLS", "<n> NOTES", "N+ NOTES" when capped), the empty Brief card ("0 NEED YOU"); each named once (role img, aria-label), the readout inside the card,
//                            ink on bone, real size, the SVG namespace; a real Brief with an "urgent" row shows the blood-red edge on that row and on no other; an unrelated re-render keeps the
//                            same card node and does not restart its animation; with the look off there is no card at all
//   lantern-sealed           a number held back shows the face-down card (the word SEALED, no digit anywhere in it), then the face when the number arrives: the attribute turns "up" and the
//                            sheet's own turn animation runs; the sealed card never reads a false 0
//   lantern-reduced-motion   a card turns only when the OS and the app both allow motion: with Reduce motion on, and again with the OS preference emulated, the computed animation is none
//   lantern-leave            the shell Light/dark button, the palette's "Toggle light / dark", the Dark chip, the Workbench chip and the Console chip each leave the look (attribute empty or
//                            the other look, sheet gone, no card, layer still on)
// Each scenario puts back the prefs it touched (consoleLayer, themePref, reduceMotion, the emulated media) and ends with hqFake.reset(true).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens } from '../styles/tokens-parse.mjs';
import { PAGE as C } from './cdp-console.mjs';
import { bindProject } from '../src/logic/lantern-art.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const q = JSON.stringify;
export const LAYER_LANTERN = Object.freeze({ on: true, skin: false, scan: false, palette: '', debug: false, shelf: false, look: 'lantern' });
export const SCENARIO_NAMES = Object.freeze(['lantern-skin', 'lantern-art', 'lantern-sealed', 'lantern-reduced-motion', 'lantern-leave']);

/** The sheet's own dark and light token values (one source of truth for the expected computed colours). */
export function lanternTokens() {
  const w = parseTokens(readFileSync(resolve(HERE, '../styles/lantern.css'), 'utf8')).rules;
  return { dark: w['[data-hq-look=lantern][data-hq-theme]'] || {}, light: w['[data-hq-look=lantern][data-hq-theme=light]'] || {} };
}

// the Vault desk answer the sealed scenario hands over (invented placeholder names, a known count)
const NOTE = { state: 'ready', vaultName: 'Cdp Vault', canOpen: true, folder: 'Daily', folderFromSettings: true, folderSource: 'daily-notes', settingsIgnored: false, noteName: '2026-11-18', date: '2026-11-18', text: '# Monday\n\n- a placeholder line\n', truncated: false, recent: ['Note A', 'Note B', 'Note C', 'Note D'].map((name) => ({ name })), noteCount: 4, noteCountCapped: false };
const EMPTY_BRIEF = { v: 1, generatedAt: '2026-11-18T09:00:00.000Z', items: [], more: 0, overflow: [], standing: [], errors: [] };

export const PAGE = Object.freeze({
  look: `(() => { const r = ${C.root}; return r ? r.getAttribute('data-hq-look') : undefined; })()`,
  accent: `(() => { const r = ${C.root}; return r ? r.getAttribute('data-hq-accent') : undefined; })()`,
  links: `document.querySelectorAll('link#hq-lantern-css').length`,
  wbnLinks: `document.querySelectorAll('link#hq-workbench-css').length`,
  sheetLoaded: `(() => { const l = document.getElementById('hq-lantern-css'); try { return !!(l && l.sheet && l.sheet.cssRules.length > 0); } catch (e) { return false; } })()`,
  probeLinks: `(window.__hqLayerProbe ? window.__hqLayerProbe().links : -1)`,
  theme: `WHQ.app.logic.themeName()`,
  go: (tab, sub) => `(() => { WHQ.app.logic.go(${q(tab)}, ${q(sub)}); return true; })()`,
  tokenNow: (name) => C.cssVar(name),
  artCount: `document.querySelectorAll('[data-lnt^="art-"]').length`,
  wbnArtCount: `document.querySelectorAll('[data-wbn^="art-"]').length`,
  face: (kind) => `(() => { const a = document.querySelector('[data-lnt="art-${kind}"]'); return a ? a.getAttribute('data-lnt-face') : null; })()`,
  artText: (kind) => `(() => { const a = document.querySelector('[data-lnt="art-${kind}"]'); const r = a && a.querySelector('[data-lnt="readout"]'); return r ? r.textContent.trim() : null; })()`,
  artInfo: (kind) => `(() => { const a = document.querySelector('[data-lnt="art-${kind}"]'); if (!a) return null; const r = a.querySelector('[data-lnt="readout"]'), n = a.querySelector('[data-lnt="roman"]'), s = a.querySelector('svg'); return JSON.stringify({ role: a.getAttribute('role'), label: a.getAttribute('aria-label'), face: a.getAttribute('data-lnt-face'), text: r.textContent.trim(), roman: n.textContent.trim(), w: a.offsetWidth, h: a.offsetHeight, inside: r.offsetLeft >= 0 && r.offsetTop >= 0 && r.offsetLeft + r.offsetWidth <= a.offsetWidth + 1 && r.offsetTop + r.offsetHeight <= a.offsetHeight + 1 && r.offsetWidth > 0, readoutHidden: r.getAttribute('aria-hidden'), romanHidden: n.getAttribute('aria-hidden'), svgHidden: s.getAttribute('aria-hidden'), paths: s.querySelectorAll('path').length, ns: (s.querySelector('path') || {}).namespaceURI || '', bbox: (() => { const p = s.querySelector('path'); try { const b = p.getBBox(); return Math.round(b.width) + 'x' + Math.round(b.height); } catch (e) { return 'none'; } })(), upper: getComputedStyle(r).textTransform, mono: /mono|monospace/i.test(getComputedStyle(r).fontFamily), ink: getComputedStyle(r).color, serif: /cinzel|georgia/i.test(getComputedStyle(n).fontFamily), rects: s.querySelectorAll('rect,circle,ellipse,line,polyline,text').length }); })()`,
  anim: (kind) => `(() => { const a = document.querySelector('[data-lnt="art-${kind}"]'); if (!a) return null; const cs = getComputedStyle(a); return JSON.stringify({ name: cs.animationName, count: a.getAnimations().length }); })()`,
  mark: (kind) => `(() => { const a = document.querySelector('[data-lnt="art-${kind}"]'); if (!a) return false; a.__lntMark = 'same'; const an = a.getAnimations()[0]; if (an) an.__lntMark = 'same'; a.__lntTime = an ? an.currentTime : -1; return true; })()`,
  kept: (kind) => `(() => { const a = document.querySelector('[data-lnt="art-${kind}"]'); if (!a) return null; const an = a.getAnimations()[0]; return JSON.stringify({ same: a.__lntMark === 'same', sameAnimation: an ? an.__lntMark === 'same' : true, before: a.__lntTime, now: an ? an.currentTime : -1 }); })()`,
  heading: `(() => { const hs = [...document.querySelectorAll('h2,h1,h3')].filter((x) => x.getBoundingClientRect().width > 0); const h = hs.find((x) => x.tagName === 'H2' && x.textContent.trim()) || hs[0]; if (!h) return null; const cs = getComputedStyle(h); return JSON.stringify({ tag: h.tagName, count: hs.length, family: cs.fontFamily, upper: cs.textTransform, spacing: cs.letterSpacing }); })()`,
  briefRows: `(() => { const sec = document.querySelector('section[aria-label="Brief: what needs you now"]'); if (!sec) return null; return JSON.stringify([...sec.querySelectorAll('[role="listitem"]')].map((x) => ({ badge: ((x.firstElementChild || {}).textContent || '').trim(), shadow: getComputedStyle(x).boxShadow }))); })()`,
  blood: `(() => { const d = document.createElement('div'); d.style.color = 'var(--lnt-blood)'; ${C.root}.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`,
  setState: (o) => `(() => { WHQ.app.logic.setState(${q(o)}); return true; })()`,
  projectIds: `JSON.stringify(WHQ.app.logic.projectsAt(0, true).map((p) => p.id))`,
  openProject: (id) => `(() => { const L = WHQ.app.logic; L.go('projects', 'grid'); L.openProject(${q(id)}); return true; })()`,
  serveBrief: (brief) => `(() => { const L = WHQ.app.logic; hqFake.set('brief.read', { brief: ${q(brief)} }); L.setState({ brfBusy: false, batOpen: null, batBal: '', batBusy: false, batDone: {}, toasts: [], recentDone: [] }); L._brfBusy = false; L._batBusy = false; WHQ.store.refreshBrief(); return true; })()`,
  freshBrief: `(() => { const L = WHQ.app.logic; L.setState({ brfBusy: false }); L._brfBusy = false; L.store.refreshBrief(); L.go('home'); return true; })()`,
  holdVdk: `(() => { const L = WHQ.app.logic; L.vdkArrive = () => Promise.resolve(null); return true; })()`,
  releaseVdk: `(() => { const L = WHQ.app.logic; delete L.vdkArrive; return true; })()`,
  heldCount: (key) => `(() => { const s = WHQ.app.logic.state; return ${key === 'crw' ? '(s.crw && s.crw.rows ? s.crw.rows.length : -1)' : "(s.vdk && s.vdk.data && s.vdk.data.recent ? (typeof s.vdk.data.noteCount === 'number' ? s.vdk.data.noteCount : s.vdk.data.recent.length) : -1)"}; })()`,
  chips: `(() => { const d = document.querySelector('[role="dialog"][aria-label="Settings"]'); return d ? JSON.stringify([...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((x) => ['Dark', 'Light', 'Follow system', 'Console', 'Workbench', 'Lantern'].includes(x))) : null; })()`,
});

export function makeLanternScenarios({ fresh, sleep }) {
  const pause = (t, ms) => (t && typeof t.sleep === 'function' ? t.sleep(ms) : sleep(ms));
  const json = async (t, expr) => { const v = await t.evaluate(expr); try { return v === null || v === undefined ? v : JSON.parse(v); } catch (e) { return v; } };
  const snapshotOf = async (t) => (await json(t, C.snapshot)) || { themePref: 'dark', reduceMotion: false };
  const leave = async (t, snap) => {
    await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
    await t.evaluate(PAGE.releaseVdk).catch(() => {});
    await t.evaluate(`(() => { const L = WHQ.app.logic; L.setState({ vdk: null, crw: null, route: null }); return true; })()`).catch(() => {});
    await t.evaluate(C.restore(snap || { themePref: 'dark', reduceMotion: false })).catch(() => {});
    await t.evaluate(C.reset).catch(() => {});
    await t.evaluate(PAGE.go('home', null)).catch(() => {});
  };
  const lookOn = async (t, out, where, extra) => {
    await t.evaluate(C.setLayer({ ...LAYER_LANTERN, ...(extra || {}) }));
    if (!await t.waitFor(`${PAGE.links} === 1 && ${PAGE.sheetLoaded} && ${PAGE.look} === 'lantern'`, 6000)) { out.push(where + ': the look never showed (link ' + await t.evaluate(PAGE.links) + ', attr ' + JSON.stringify(await t.evaluate(PAGE.look)) + ')'); return false; }
    return true;
  };
  const tok = lanternTokens();
  const hex = (s) => String(s || '').trim().toLowerCase();

  return {
    async 'lantern-skin'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(C.restore(snap));
        await t.evaluate(C.openSettings);
        if (!await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Settings"]')`, 4000)) return out.concat('Settings never opened');
        if (JSON.stringify(await json(t, PAGE.chips)) !== JSON.stringify(['Dark', 'Light', 'Follow system'])) out.push('with the layer off the Appearance chips are not just the three base ones: ' + await t.evaluate(PAGE.chips));
        if (await t.evaluate(PAGE.look) !== '') out.push('the root data-hq-look is not an empty attribute while the layer is off: ' + JSON.stringify(await t.evaluate(PAGE.look)));
        if (await t.evaluate(PAGE.links) !== 0) out.push('the Lantern sheet is in the page while the layer is off');
        await t.evaluate(C.clickSwitch('Console layer'));
        if (!await t.waitFor(`${PAGE.chips}.includes('Lantern')`, 4000)) return out.concat('the Lantern chip never appeared with the layer on: ' + await t.evaluate(PAGE.chips));
        if (JSON.stringify(await json(t, PAGE.chips)) !== JSON.stringify(['Dark', 'Light', 'Follow system', 'Console', 'Workbench', 'Lantern'])) out.push('the Appearance chips are not in the documented order: ' + await t.evaluate(PAGE.chips));
        await t.evaluate(C.clickChip('Lantern'));
        if (!await t.waitFor(`${PAGE.links} === 1 && ${PAGE.sheetLoaded} && ${PAGE.look} === 'lantern'`, 6000)) return out.concat('choosing the Lantern chip did not load the look (link ' + await t.evaluate(PAGE.links) + ')');
        if (await t.evaluate(C.skinAttr) !== '') out.push('the Console skin attribute is not empty under the look: ' + JSON.stringify(await t.evaluate(C.skinAttr)));
        if (await t.evaluate(C.scanAttr) !== null) out.push('the scanline attribute is set under the look');
        if (await t.evaluate(PAGE.probeLinks) !== 3) out.push('the probe counts ' + await t.evaluate(PAGE.probeLinks) + ' links under the look, want 3 (console sheet, delights, lantern)');
        if (await t.evaluate(PAGE.wbnLinks) !== 0) out.push('the Workbench sheet is in the page beside the Lantern one');
        const dark = (await t.evaluate(PAGE.theme)) !== 'light';
        const want = dark ? tok.dark : tok.light;
        for (const k of ['--bg', '--gold', '--text', '--lnt-brass', '--lnt-card']) if (hex(await t.evaluate(PAGE.tokenNow(k))) !== hex(want[k])) out.push(k + ' computes to ' + await t.evaluate(PAGE.tokenNow(k)) + ', the sheet says ' + want[k]);
        // no download: the serif is a system stack
        const fonts = await t.evaluate(`[...document.fonts].map((f) => f.family).join('|')`);
        if (/cinzel/i.test(String(fonts))) out.push('a Cinzel font face is loaded by the page (nothing may be downloaded): ' + fonts);
        // the headings take the engraved stack in capitals (every space but Home opens with an h1)
        await t.evaluate(PAGE.go('tasks', 'ranked'));
        if (!await t.waitFor(`${PAGE.heading} !== null`, 6000)) out.push('no heading on Tasks to read (h1/h2/h3 in the page: ' + await t.evaluate("document.querySelectorAll('h1,h2,h3').length") + ')');
        else {
          const h = await json(t, PAGE.heading);
          if (!/cinzel/i.test(h.family) || !/georgia/i.test(h.family)) out.push('a heading is not on the serif stack: ' + JSON.stringify(h));
          if (h.upper !== 'uppercase') out.push('a heading is not upper case: ' + JSON.stringify(h));
        }
        // a stored accent palette does nothing under this look (no attribute, no extra link), and the red-accent row is not offered
        await t.evaluate(C.openSettings);
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN, palette: 'signal' }));
        await pause(t, 400);
        if (await t.evaluate(PAGE.accent) !== '') out.push('the stored red palette set data-hq-accent under Lantern: ' + JSON.stringify(await t.evaluate(PAGE.accent)));
        if (await t.evaluate(PAGE.probeLinks) !== 3) out.push('the stored palette added a link under Lantern: ' + await t.evaluate(PAGE.probeLinks));
        if (await t.evaluate(C.switchRow('Warm red accent'))) out.push('the Warm red accent row is offered under Lantern, where it does nothing');
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN }));
        // the other looks take it over, one sheet at a time
        await t.evaluate(C.openSettings);
        if (!await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Settings"]')`, 4000)) return out.concat('Settings did not reopen');
        await t.evaluate(C.clickChip('Workbench'));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.wbnLinks} === 1 && ${PAGE.look} === 'workbench'`, 6000)) out.push('choosing Workbench did not take the look over from Lantern (lantern sheets ' + await t.evaluate(PAGE.links) + ', workbench sheets ' + await t.evaluate(PAGE.wbnLinks) + ')');
        await t.evaluate(C.clickChip('Lantern'));
        if (!await t.waitFor(`${PAGE.links} === 1 && ${PAGE.wbnLinks} === 0 && ${PAGE.look} === 'lantern'`, 6000)) out.push('choosing Lantern did not take the look over from Workbench');
        await t.evaluate(C.clickChip('Console'));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === '' && ${C.skinAttr} === 'console'`, 6000)) out.push('choosing Console did not leave the look (lantern sheets ' + await t.evaluate(PAGE.links) + ', look ' + JSON.stringify(await t.evaluate(PAGE.look)) + ')');
        await t.evaluate(C.clickChip('Lantern'));
        if (!await t.waitFor(`${PAGE.links} === 1 && ${PAGE.look} === 'lantern' && ${C.skinAttr} === ''`, 6000)) out.push('choosing Lantern again did not leave the Console skin');
        // off: zero, without a reload
        await t.evaluate(C.mark);
        await t.evaluate(C.clickSwitch('Console layer'));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === '' && ${C.links} === 0 && ${PAGE.probeLinks} === 0 && ${PAGE.artCount} === 0`, 6000)) out.push('the layer off left something behind (look sheet ' + await t.evaluate(PAGE.links) + ', probe ' + await t.evaluate(C.probe) + ', cards ' + await t.evaluate(PAGE.artCount) + ')');
        if (!await t.evaluate(C.marked)) out.push('the page reloaded when the look was switched off');
        const p = await json(t, C.probe);
        if (!p || p.listeners !== 0 || p.timers !== 0 || p.frames !== 0) out.push('the probe is not all zeros with the layer off: ' + JSON.stringify(p));
      } finally { await leave(t, snap); }
      return out;
    },

    async 'lantern-art'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      const checkCard = (where, a, wantText, wantLabel, wantRoman) => {
        if (!a) { out.push(where + ': no card info'); return; }
        if (a.role !== 'img' || a.label !== wantLabel) out.push(where + ': the card is not named once as ' + JSON.stringify(wantLabel) + ': ' + JSON.stringify({ role: a.role, label: a.label }));
        if (a.text !== wantText) out.push(where + ': the bottom line is ' + JSON.stringify(a.text) + ', want ' + JSON.stringify(wantText));
        if (wantRoman !== undefined && a.roman !== wantRoman) out.push(where + ': the roman number is ' + JSON.stringify(a.roman) + ', want ' + JSON.stringify(wantRoman));
        if (a.face !== 'up') out.push(where + ': the card is not face up: ' + a.face);
        if (a.readoutHidden !== 'true' || a.svgHidden !== 'true' || a.romanHidden !== 'true') out.push(where + ': the drawing, number or bottom line is not hidden from a screen reader (the wrapper speaks once)');
        if (a.w < 60 || a.h < 100) out.push(where + ': the card has no real size: ' + a.w + ' x ' + a.h);
        if (!a.inside) out.push(where + ': the bottom line is outside the card');
        if (a.paths < 3) out.push(where + ': the drawing has only ' + a.paths + ' shapes');
        if (a.rects) out.push(where + ': the drawing holds ' + a.rects + ' element(s) that are not paths');
        if (a.ns !== 'http://www.w3.org/2000/svg') out.push(where + ': the shapes are not in the SVG namespace, so nothing paints: ' + JSON.stringify(a.ns));
        if (!/^[1-9]\d*x\d+$|^\d+x[1-9]\d*$/.test(a.bbox)) out.push(where + ': the first shape has no size (' + a.bbox + '), so nothing paints');
        if (a.upper !== 'uppercase' || !a.mono) out.push(where + ': the bottom line is not uppercase monospace: ' + JSON.stringify({ upper: a.upper, mono: a.mono }));
        if (a.ink !== 'rgb(10, 9, 11)') out.push(where + ': the bottom line is not ink on bone (colour ' + a.ink + ')');
        if (!a.serif) out.push(where + ': the roman number is not in the engraved serif');
      };
      try {
        await t.evaluate(C.restore(snap));
        await t.evaluate(PAGE.holdVdk);
        // look off: nothing of it
        await t.evaluate(PAGE.go('claude', 'crew'));
        if (!await t.waitFor(`!!document.querySelector('[data-crw="view"]')`, 8000)) return out.concat('Claude > Crew never showed');
        if (await t.evaluate(PAGE.artCount) !== 0) out.push('a Lantern card is in the page while the layer is off');
        if (!await lookOn(t, out, 'crew')) return out;
        if (!await t.waitFor(`${PAGE.artText('skills')} !== null`, 6000)) return out.concat('the Crew header never drew its card under the look');
        const held = await t.evaluate(PAGE.heldCount('crw'));
        checkCard('Crew', await json(t, PAGE.artInfo('skills')), held + ' SKILLS', held + ' skills, card: The Lovers', 'VI');
        if (await t.evaluate(PAGE.wbnArtCount) !== 0) out.push('a Workbench picture is in the page under the Lantern look');
        // an unrelated re-render keeps the same node and does not restart its animation
        await pause(t, 900);
        await t.evaluate(PAGE.mark('skills'));
        await t.evaluate(PAGE.setState({ toasts: [] }));
        await t.evaluate(PAGE.setState({ toasts: [] }));
        await pause(t, 300);
        const kept = await json(t, PAGE.kept('skills'));
        if (!kept || !kept.same) out.push('an unrelated re-render replaced the card node: ' + JSON.stringify(kept));
        else if (!kept.sameAnimation || (kept.before >= 0 && kept.now < kept.before)) out.push('an unrelated re-render restarted the card animation: ' + JSON.stringify(kept));
        // Life > Notes: the walk's count, and N+ when capped
        await t.evaluate(PAGE.setState({ vdk: { data: { ...NOTE, noteCount: 87, recent: NOTE.recent }, error: '', loaded: true, busy: false, draft: '', sending: false } }));
        await t.evaluate(PAGE.go('life', 'notes'));
        if (!await t.waitFor(`${PAGE.artText('notes')} !== null`, 8000)) out.push('the Vault desk header never drew its card under the look');
        else {
          checkCard('Vault desk', await json(t, PAGE.artInfo('notes')), '87 NOTES', '87 notes, card: The High Priestess', 'II');
          await t.evaluate(`(() => { const L = WHQ.app.logic, s = L.state; L.setState({ vdk: { ...s.vdk, data: { ...s.vdk.data, noteCount: 4000, noteCountCapped: true } } }); return true; })()`);
          if (!await t.waitFor(`${PAGE.artText('notes')} === '4000+ NOTES'`, 4000)) out.push('a capped count did not read "4000+ NOTES": ' + JSON.stringify(await t.evaluate(PAGE.artText('notes'))));
          if (await t.evaluate(PAGE.artCount) !== 1) out.push('more than one card is on the Vault desk screen: ' + await t.evaluate(PAGE.artCount));
        }
        // Home: the empty Brief card, then a real Brief with an urgent row
        await t.evaluate(PAGE.serveBrief(EMPTY_BRIEF));
        await t.evaluate(PAGE.go('home', null));
        if (!await t.waitFor(`${PAGE.artText('needyou')} !== null`, 8000)) out.push('the empty Brief never drew its card under the look');
        else checkCard('empty Brief', await json(t, PAGE.artInfo('needyou')), '0 NEED YOU', '0 need you, card: The Sun', 'XIX');
        await t.evaluate('hqFake.reset(true)');
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN }));
        await t.evaluate(PAGE.freshBrief);
        if (!await t.waitFor(`${PAGE.briefRows} !== null && JSON.parse(${PAGE.briefRows}).length === 3`, 8000)) out.push('the fake Brief never rendered its three rows');
        else {
          const rows = await json(t, PAGE.briefRows);
          const blood = hex(await t.evaluate(PAGE.blood));
          rows.forEach((r) => {
            const urgent = r.badge === 'urgent';
            const has = hex(r.shadow).includes(blood) && /inset/.test(r.shadow);
            if (urgent && !has) out.push('the urgent Brief row has no blood-red edge (box-shadow ' + r.shadow + ', want the colour ' + blood + ')');
            if (!urgent && has) out.push('the "' + r.badge + '" Brief row has a blood-red edge but is not urgent');
          });
          if (!rows.some((r) => r.badge === 'urgent')) out.push('the fake Brief has no urgent row to check the blood-red edge on');
        }
        // the project page: this project's own card, stable across leaving and coming back
        const ids = await json(t, PAGE.projectIds);
        if (!Array.isArray(ids) || ids.length < 2) out.push('the gate data has fewer than two projects: ' + JSON.stringify(ids));
        else {
          for (const id of ids.slice(0, 2)) {
            const want = bindProject(id);
            await t.evaluate(PAGE.openProject(id));
            if (!await t.waitFor(`${PAGE.artText('project')} !== null`, 8000)) { out.push('the project page for ' + id + ' never drew its card'); continue; }
            checkCard('project ' + id, await json(t, PAGE.artInfo('project')), want.label, want.aria, want.roman);
            await t.evaluate(PAGE.go('home', null));
            await t.evaluate(PAGE.openProject(id));
            await t.waitFor(`${PAGE.artText('project')} !== null`, 8000);
            if ((await t.evaluate(PAGE.artText('project'))) !== want.label) out.push('the card for ' + id + ' changed after leaving and coming back');
            if (await t.evaluate(PAGE.artCount) !== 1) out.push('more than one card is on the project page: ' + await t.evaluate(PAGE.artCount));
          }
          await t.evaluate(`(() => { WHQ.app.logic.setState({ route: null }); return true; })()`);
          await t.evaluate(PAGE.go('home', null));
          if (await t.evaluate(`document.querySelector('[data-lnt="art-project"]') !== null`)) out.push('the project card stayed in the page after leaving the project page');
        }
        // the layer off and the other look show none
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN, look: 'workbench' }));
        await pause(t, 250);
        if (await t.evaluate(PAGE.artCount) !== 0) out.push('a Lantern card is in the page under the Workbench look');
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN, look: '', skin: true }));
        await pause(t, 250);
        if (await t.evaluate(PAGE.artCount) !== 0) out.push('a Lantern card is in the page under the Console skin');
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN, on: false }));
        await pause(t, 250);
        if (await t.evaluate(PAGE.artCount) !== 0) out.push('a Lantern card is in the page with the layer off and a look stored');
      } finally { await leave(t, snap); }
      return out;
    },

    async 'lantern-sealed'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(C.restore(snap));
        await t.evaluate(PAGE.holdVdk);
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN }));
        await t.evaluate(PAGE.setState({ vdk: { data: null, error: '', loaded: false, busy: false, draft: '', sending: false } }));
        await t.evaluate(PAGE.go('life', 'notes'));
        if (!await t.waitFor(`${PAGE.face('notes')} === 'sealed'`, 8000)) return out.concat('a number held back did not show the face-down card (face ' + JSON.stringify(await t.evaluate(PAGE.face('notes'))) + ')');
        const s = await json(t, PAGE.artInfo('notes'));
        if (s.text !== 'SEALED') out.push('the face-down card reads ' + JSON.stringify(s.text) + ', want "SEALED"');
        if (/\d/.test(s.text + s.label + s.roman)) out.push('the face-down card carries a number: ' + JSON.stringify([s.text, s.label, s.roman]));
        if (s.label !== 'Not read yet, card face down') out.push('the face-down card is named ' + JSON.stringify(s.label));
        if (s.role !== 'img' || s.svgHidden !== 'true') out.push('the face-down card is not one named image');
        if (s.ink !== 'rgb(160, 124, 60)') out.push('the SEALED word is not dim brass (colour ' + s.ink + ')');
        // the number arrives: the card turns face up
        await t.evaluate(C.setReduce(false));
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await t.evaluate(PAGE.setState({ vdk: { data: NOTE, error: '', loaded: true, busy: false, draft: '', sending: false } }));
        if (!await t.waitFor(`${PAGE.face('notes')} === 'up'`, 6000)) out.push('the card did not turn face up when its number arrived');
        else {
          if ((await t.evaluate(PAGE.artText('notes'))) !== '4 NOTES') out.push('the face reads ' + JSON.stringify(await t.evaluate(PAGE.artText('notes'))) + ', want "4 NOTES"');
          const a = await json(t, PAGE.anim('notes'));
          if (!a || a.name !== 'lnt-turn') out.push('turning face up does not run the sheet\'s lnt-turn animation: ' + JSON.stringify(a));
        }
        // and back: the number is lost again (a failed read), the back returns and never shows a false 0
        await t.evaluate(PAGE.setState({ vdk: { data: null, error: '', loaded: false, busy: false, draft: '', sending: false } }));
        if (!await t.waitFor(`${PAGE.face('notes')} === 'sealed'`, 6000)) out.push('the card did not go back to its sealed back when the number was lost');
        else if (/\d/.test(String(await t.evaluate(PAGE.artText('notes'))))) out.push('the sealed back shows a digit after the number was lost');
      } finally { await leave(t, snap); }
      return out;
    },

    async 'lantern-reduced-motion'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      try {
        await t.evaluate(C.restore(snap));
        await t.evaluate(PAGE.holdVdk);
        await t.evaluate(PAGE.go('claude', 'crew'));
        if (!await t.waitFor(`!!document.querySelector('[data-crw="view"]')`, 8000)) return out.concat('Claude > Crew never showed');
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await t.evaluate(C.setReduce(false));
        if (!await lookOn(t, out, 'motion allowed')) return out;
        if (!await t.waitFor(`${PAGE.anim('skills')} !== null`, 6000)) return out.concat('the Crew card never drew');
        let a = await json(t, PAGE.anim('skills'));
        if (!a || a.name !== 'lnt-turn') out.push('with motion allowed a card does not run the sheet\'s lnt-turn animation: ' + JSON.stringify(a));
        // the app's Reduce motion pref
        await t.evaluate(C.setReduce(true));
        await pause(t, 300);
        a = await json(t, PAGE.anim('skills'));
        if (!a || a.name !== 'none') out.push('with Reduce motion on the card still animates: ' + JSON.stringify(a));
        // the OS preference
        await t.evaluate(C.setReduce(false));
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await pause(t, 300);
        a = await json(t, PAGE.anim('skills'));
        if (!a || a.name !== 'none') out.push('with the OS reduced-motion preference the card still animates: ' + JSON.stringify(a));
        const d = await t.evaluate(`getComputedStyle(document.querySelector('[data-lnt="art-skills"]')).transform`);
        if (d !== 'none') out.push('with reduced motion the card is still transformed: ' + d);
      } finally { await leave(t, snap); }
      return out;
    },

    async 'lantern-leave'(t) {
      const pre = await fresh(t); if (pre) return pre;
      const out = [];
      const snap = await snapshotOf(t);
      const left = async (where) => {
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === '' && ${PAGE.artCount} === 0`, 6000)) { out.push(where + ': the look stayed on (sheets ' + await t.evaluate(PAGE.links) + ', attr ' + JSON.stringify(await t.evaluate(PAGE.look)) + ', cards ' + await t.evaluate(PAGE.artCount) + ')'); return; }
        const L = await json(t, C.layer);
        if (!L || L.on !== true) out.push(where + ': the layer itself was switched off: ' + JSON.stringify(L));
        if (!L || L.look !== '') out.push(where + ': the stored look is not cleared: ' + JSON.stringify(L));
      };
      try {
        await t.evaluate(C.restore(snap));
        await t.evaluate(PAGE.holdVdk);
        await t.evaluate(PAGE.go('claude', 'crew'));
        await t.waitFor(`!!document.querySelector('[data-crw="view"]')`, 8000);
        if (!await lookOn(t, out, 'shell button')) return out;
        await t.waitFor(`${PAGE.artCount} >= 1`, 6000);
        await t.evaluate(`(() => { const b = document.querySelector('button[title="Light / dark"]'); if (!b) return false; b.click(); return true; })()`);
        await left('the shell Light/dark button');
        if (!await lookOn(t, out, 'palette toggle')) return out;
        await t.evaluate(C.paletteToggle);
        await left('the palette "Toggle light / dark"');
        if (!await lookOn(t, out, 'Dark chip')) return out;
        await t.evaluate(C.openSettings);
        if (!await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Settings"]')`, 4000)) return out.concat('Settings never opened');
        await t.evaluate(C.clickChip('Dark'));
        await left('the Dark chip');
        // Workbench and Console take the look over: the sheet and every card go
        if (!await lookOn(t, out, 'Workbench chip')) return out;
        await t.evaluate(C.openSettings);
        await t.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Settings"]')`, 4000);
        await t.evaluate(C.clickChip('Workbench'));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === 'workbench' && ${PAGE.artCount} === 0`, 6000)) out.push('the Workbench chip left a Lantern sheet or card behind (sheets ' + await t.evaluate(PAGE.links) + ', cards ' + await t.evaluate(PAGE.artCount) + ')');
        await t.evaluate(C.clickChip('Lantern'));
        await t.waitFor(`${PAGE.links} === 1`, 6000);
        await t.evaluate(C.clickChip('Console'));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === '' && ${C.skinAttr} === 'console' && ${PAGE.artCount} === 0`, 6000)) out.push('the Console chip left a Lantern sheet or card behind (sheets ' + await t.evaluate(PAGE.links) + ', cards ' + await t.evaluate(PAGE.artCount) + ')');
        // the layer switched off
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN }));
        await t.waitFor(`${PAGE.links} === 1`, 6000);
        await t.evaluate(C.setLayer({ ...LAYER_LANTERN, on: false }));
        if (!await t.waitFor(`${PAGE.links} === 0 && ${PAGE.look} === '' && ${PAGE.artCount} === 0 && ${PAGE.probeLinks} === 0`, 6000)) out.push('the layer off left a Lantern sheet, attribute or card behind');
      } finally { await leave(t, snap); }
      return out;
    },
  };
}
