// CDP scenarios for the Security space (the 11th destination, no number key). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeSecurityScenarios({ fresh, SNAP_KEYS, RESTORE_KEYS, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario security-map-render,security-node-edit,... (needs --preload=fake)
//
// The footprint the page is served is the invented one from src/selftest-security.mjs (securityFixture: example.test, acme.test,
// alpha-site.test, owner@example.test; the passphrase "correct horse example" is the only one the fake accepts). The fake preload's
// hq.security is createFakeSecurity below, PASTED into tools/fake-preload.js (FAKE_SECURITY_SOURCE() prints the exact text): a small
// stateful stand-in for main. What a scenario EXPECTS is computed here in Node with plain counts, never by asking the page's own code.
//
//   security-map-render        arrival reads once; the bubbles, a flag dot, the status line, the growth line, 11 rail items, no digit for Security
//   security-node-edit         card, 2FA chip, hide switch, archive, Add account, Add identity (refused then accepted), the time slider
//   security-unlock-clears     the dialog, a wrong then a right passphrase, cancel, Escape: the typed text is never in state, vals, storage or the page
//   security-health            flag rows, breached "not checked", the export list worded as a guess, Recycle Bin per file, the conflict sentence
//   security-setup             the ten steps in order, who decided each, ticking, the vault path, the blank emergency sheet
//   security-generate          passphrase and character modes, Copy once to main, the clipboard sentence, output dropped on arrival
import { securityFixture, FIXTURE_EXPORTS, FAKE_PASSPHRASE, WRONG_PASSPHRASE_ERROR } from '../src/selftest-security.mjs';

export const SECURITY_SCENARIOS = Object.freeze(['security-map-render', 'security-node-edit', 'security-unlock-clears', 'security-health', 'security-setup', 'security-generate']);

/** Every hq.security method; a read-only window must never record a write. */
export const SECURITY_WRITE_METHODS = Object.freeze(['security.refresh', 'security.settings', 'security.edit', 'security.addManual', 'security.addIdentity', 'security.walkthrough', 'security.trashExport', 'security.copy']);

// ---- the fake main process (pasted into fake-preload.js; self-contained on purpose: no imports, no outer names) -----------------
export function createFakeSecurity(fx, exportsList) {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const S = clone(fx), files = clone(exportsList || []);
  const PASS = 'correct horse example';
  let seq = 0;
  const hex = (n) => ('000000000000' + n.toString(16)).slice(-12);
  const view = () => ({ settings: clone(S.settings), map: clone(S.map), owner: clone(S.owner), snapshots: clone(S.snapshots), status: clone(S.status), cliFound: S.cliFound, vaultExists: S.vaultExists });
  const OK_KEYS = ['signInWith', 'recoveryRef', 'twofa', 'hiddenFromClaude', 'archived'];
  return {
    read: async () => view(),
    refresh: async (pass, check) => {
      if (pass !== PASS) return { error: 'wrong passphrase or key file' };
      const at = '2026-11-11T09:00:00.000Z';
      if (S.map) S.map.refreshedAt = at;
      S.status.refreshedAt = at;
      if (check !== false) S.status.breachCheckedAt = at;
      return { ok: true, accounts: S.map ? S.map.accounts.length : 0, breachChecked: check !== false, notes: [] };
    },
    scanExports: async () => ({ files: clone(files), looked: ['Downloads', 'Desktop', 'Documents'], redirected: 1 }),
    trashExport: async (name, dir) => {
      const i = files.findIndex((f) => f.name === name && f.dir === dir);
      if (i < 0) return { error: 'not in the last scan' };
      files.splice(i, 1);
      S.status.exportsFound = files.length;
      return { ok: true };
    },
    edit: async (id, patch) => {
      if (!id || !patch || typeof patch !== 'object') return { error: 'nothing to change' };
      const keys = Object.keys(patch);
      if (!keys.length || keys.some((k) => OK_KEYS.indexOf(k) < 0)) return { error: 'that change is not allowed' };
      const cur = S.owner.accounts[id] || (S.owner.accounts[id] = {});
      for (const k of keys) { if (patch[k] === null || patch[k] === false) delete cur[k]; else cur[k] = patch[k]; }
      return { ok: true };
    },
    addManual: async (o) => {
      const title = o && typeof o.title === 'string' ? o.title.trim() : '';
      if (!title) return { error: 'a name is required' };
      const id = 'm-' + hex(++seq);
      S.owner.manual.push({ id, title, host: o && typeof o.host === 'string' ? o.host.trim() : '', createdAt: '2026-11-11T09:30:00.000Z' });
      return { ok: true, id };
    },
    addIdentity: async (o) => {
      const v = o && typeof o.value === 'string' ? o.value.trim() : '';
      const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), digits = v.replace(/[\s\-()+]/g, '');
      const phone = /^\d{8,15}$/.test(digits);
      if (!email && !phone) return { error: 'not an email or phone number' };
      const ref = 'i-' + hex(0xc0de00 + ++seq);
      S.owner.identities.push({ ref, kind: email ? 'email' : 'phone', label: v });
      return { ok: true, ref };
    },
    settings: async (p) => {
      const v = p && typeof p.vaultPath === 'string' ? p.vaultPath : null;
      if (v !== null && !(/^([A-Za-z]:[\\/]|\/)/.test(v) && /\.kdbx$/i.test(v))) return { error: 'the vault path must be absolute and end in .kdbx' };
      S.settings.vaultPath = v;
      S.vaultExists = !!v;
      return { ok: true };
    },
    walkthrough: async (stepId, done) => {
      if (typeof stepId !== 'string' || !stepId) return { error: 'unknown step' };
      S.settings.walkthrough[stepId] = { done: !!done, at: '2026-11-11T09:00:00.000Z' };
      return { ok: true };
    },
    copy: async (text) => (typeof text === 'string' && text ? { ok: true } : { error: 'nothing to copy' }),
  };
}

/** The exact text the Pass pastes into tools/fake-preload.js: the invented answer, then createFakeSecurity. */
export function fakeSecuritySource() {
  return 'const FAKE_SECURITY_FIXTURE = ' + JSON.stringify(securityFixture()) + ';\nconst FAKE_SECURITY_EXPORTS = ' + JSON.stringify(FIXTURE_EXPORTS) + ';\n' + createFakeSecurity.toString() + '\n';
}

// ---- what the gates expect, with plain counts ---------------------------------------------------------------------------
/** The bubbles on the default map: vault accounts + identities + manual accounts. */
export function expectedBubbles(fx = securityFixture()) {
  return fx.map.accounts.length + fx.map.identities.length + fx.owner.manual.length;
}
export const COUNT_STEPS = 10;
export const STEP_IDS = Object.freeze(['email-2fa', 'install-keepassxc', 'create-vault', 'emergency-sheet', 'import-browser', 'phone-keepassdx', 'syncthing', 'ente-auth', 'import-authenticator', 'first-refresh']);
export const SENTENCES = Object.freeze({
  hide: 'hides this account from the hq_footprint tool only; the map file stays readable on this PC by anything that can read this app’s data folder, a Claude session included',
  clipboard: 'Windows clipboard history (Win+V) or a cloud clipboard',
  unlockClipboard: 'Type it, never copy it: the app’s 30 s clipboard clear cannot reach Windows clipboard history (Win+V) or a cloud clipboard.',
  looked: 'Looked in Downloads, Desktop, Documents (1 moved folder followed)',
  conflict: 'Syncthing made a conflict copy: open both in KeePassXC and merge (Database > Merge)',
  exportGuess: 'may be a plain password export',
  breachBox: 'check breaches online (Have I Been Pwned, 5 hash characters leave the PC)',
});

// ---- in-page snippets (strings for t.evaluate); exported so a test can compile every one of them ---------------------------------
const L_ = 'WHQ.app.logic';
const SEC_CLOSED = "sec: { sel: null, dlg: null, form: null, formErr: '', slider: null, sheet: false, pathErr: '', note: '', busy: false, gen: { kind: 'words', words: 7, chars: 20, sets: { lower: true, upper: true, digits: true, symbols: true }, out: null, note: '', err: '' } }, paletteOpen: false, askOpen: false, whatsNewOpen: false, toasts: [], snapOffset: 0";
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;

export const PAGE = {
  READY: "!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0 && window.hqFake)",
  home: `(() => { ${L_}.go('home'); document.activeElement && document.activeElement.blur && document.activeElement.blur(); return true; })()`,
  quiet: `(() => { ${L_}.setState({ whatsNewOpen: false }); hqFake.reset(true); return true; })()`,
  goSecurity: (sub) => `(() => { ${L_}.go('security', ${JSON.stringify(sub || 'map')}); return true; })()`,
  tab: `${L_}.state.tab`,
  sub: `${L_}.state.sub.security`,
  loaded: "!!(WHQ.store.live.security && WHQ.store.live.security.loaded && WHQ.store.live.security.map)",
  bubbles: "document.querySelectorAll('[data-sec-node]').length",
  nodeIds: "[...document.querySelectorAll('[data-sec-node]')].map((g) => g.getAttribute('data-sec-node'))",
  nodeKinds: "[...document.querySelectorAll('[data-sec-node]')].map((g) => g.getAttribute('data-sec-kind'))",
  nodeRadii: "(() => { const out = {}; for (const g of document.querySelectorAll('[data-sec-node]')) { const c = g.querySelector('circle'); const k = g.getAttribute('data-sec-kind'); const r = Number(c.getAttribute('r')); out[k] = Math.max(out[k] || 0, r); } return out; })()",
  dots: "document.querySelectorAll('[data-sec-node] circle').length - document.querySelectorAll('[data-sec-node]').length",
  text: (sel) => `(() => { const e = ${q(sel)}; return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`,
  has: (sel) => `!!${q(sel)}`,
  count: (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`,
  texts: (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`,
  click: (sel) => `(() => { const b = ${q(sel)}; if (!b) return false; b.click(); return true; })()`,
  clickNodeByTitle: (re) => `(() => { for (const g of document.querySelectorAll('[data-sec-node]')) { if (${re}.test(g.getAttribute('aria-label') || '')) { g.dispatchEvent(new MouseEvent('click', { bubbles: true })); return g.getAttribute('data-sec-node'); } } return null; })()`,
  clickInRoot: (root, re) => `(() => { const r = ${root}; if (!r) return null; const b = [...r.querySelectorAll('button')].find((x) => ${re}.test(x.textContent.trim() + ' ' + (x.getAttribute('aria-label') || ''))); if (!b) return null; b.click(); return b.textContent.trim(); })()`,
  pressedChips: (root) => `(() => { const r = ${root}; return r ? [...r.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent.trim()) : null; })()`,
  setField: (sel, value) => `(() => { const e = ${q(sel)}; if (!e) return false; e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  fieldValue: (sel) => `(() => { const e = ${q(sel)}; return e ? e.value : null; })()`,
  focusField: (sel) => `(() => { const e = ${q(sel)}; if (!e) return false; e.focus(); return document.activeElement === e; })()`,
  checkbox: (sel) => `(() => { const e = ${q(sel)}; return e ? e.checked : null; })()`,
  clickCheckbox: (sel) => `(() => { const e = ${q(sel)}; if (!e) return null; e.click(); return e.checked; })()`,
  setSlider: (v) => `(() => { const e = ${q('[data-sec="slider"]')}; if (!e) return false; e.value = ${JSON.stringify(String(v))}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  calls: (m) => `hqFake.calls(${JSON.stringify(m)})`,
  callCount: (m) => `hqFake.calls(${JSON.stringify(m)}).length`,
  anyCall: (methods) => `hqFake.calls().filter((c) => ${JSON.stringify(methods)}.includes(c.method)).map((c) => c.method)`,
  marks: "hqFake.calls('use').filter((c) => c.args[0] === 'security').map((c) => c.args.join('/'))",
  refreshMarks: "hqFake.calls('use').filter((c) => c.args[0] === 'security-refresh').map((c) => c.args.join('/'))",
  persistRead: (answer) => `hqFake.set('security.read', ${JSON.stringify(answer)}, { persist: true })`,
  reread: "(WHQ.store && typeof WHQ.store.refreshSecurity === 'function' ? WHQ.store.refreshSecurity(true).then(() => true, () => true) : true)",
  vals: `(() => { const v = ${L_}.renderVals().secv; return { show: v.secShow, status: v.secStatusLine, offline: v.secOffline, cardShow: v.secCard.show, nodes: v.secNodes.length, dlg: v.secDlgOpen }; })()`,
  nav: `(() => { const v = ${L_}.renderVals(); const n = v.nav || []; return { count: n.length, last: n.length ? { id: n[n.length - 1].id, digit: n[n.length - 1].digit, title: n[n.length - 1].title } : null }; })()`,
  overflowX: "document.documentElement.scrollWidth <= window.innerWidth + 1",
  // the passphrase leak scan: the app state, the vals tree, both storages and the page's own markup (attributes), as text
  leaks: (pass) => `(() => { const P = ${JSON.stringify(pass)}; const J = (x) => { const seen = new WeakSet(); try { return JSON.stringify(x, (k, v) => { if (typeof v === 'function') return undefined; if (v && typeof v === 'object') { if (seen.has(v)) return undefined; seen.add(v); } return v; }) || ''; } catch (e) { return 'UNREADABLE'; } };
    const dump = (s) => { const o = {}; try { for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } } catch (e) { /* blocked */ } return o; };
    const where = []; const L = ${L_};
    const st = J(L.state), vv = J(L.renderVals()); if (st === 'UNREADABLE' || vv === 'UNREADABLE') where.push('unreadable: the scan could not read the state or the vals');
    if (st.includes(P)) where.push('state'); if (vv.includes(P)) where.push('vals');
    if (J(dump(sessionStorage)).includes(P)) where.push('sessionStorage'); if (J(dump(localStorage)).includes(P)) where.push('localStorage');
    if (document.documentElement.outerHTML.includes(P)) where.push('markup'); if (J(WHQ.store.live.security).includes(P)) where.push('live');
    return where; })()`,
  leakLog: "(() => { const c = (window.__secConsole || []); return c.length; })()",
  cleanup: `(async () => { ${L_}.setState({ ${SEC_CLOSED} }); hqFake.reset(true); ${L_}.go('home'); return true; })()`,
  escapeInDialog: "(() => { const d = document.querySelector('[data-sec=\"dialog\"]'); if (!d) return false; d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()",
};

const brief = (v) => JSON.stringify(v);

// ---- the scenarios ----------------------------------------------------------------------------------------------------
export function makeSecurityScenarios({ fresh, SNAP_KEYS, RESTORE_KEYS, sleep } = {}) {
  const pause = typeof sleep === 'function' ? sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const fx = () => securityFixture();

  async function boot(t) {
    const pre = await fresh(t); if (pre) return pre;
    await t.send('Page.bringToFront');   // a --hidden harness's first focus opens What's new once, which blocks the hotkeys
    await pause(200);
    await t.evaluate(PAGE.quiet);
    return null;
  }
  async function leave(t, saved) {
    await t.evaluate(PAGE.cleanup).catch(() => {});
    await t.evaluate(RESTORE_KEYS(saved)).catch(() => {});
  }
  async function openSecurity(t, sub) {
    await t.evaluate(PAGE.goSecurity(sub));
    if (!await t.waitFor(PAGE.loaded, 8000)) return ['the Security files never arrived in LIVE.security'];
    await pause(150);
    return null;
  }
  const type = async (t, text) => { await t.send('Input.insertText', { text }); };

  return {
    // The arrival reads once; the bubbles match the invented footprint; flag dots; growth; the rail has 11 items and Security shows no digit
    async 'security-map-render'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t); if (pre) return pre;
        const want = expectedBubbles(fx());
        const nav = await t.evaluate(PAGE.nav);
        if (!nav || nav.count !== 11) out.push('the rail has ' + (nav && nav.count) + ' destinations, want 11');
        else if (nav.last.id !== 'security' || nav.last.digit !== '' || /\(/.test(nav.last.title)) out.push('Security must be last with no digit and no (n) in its title, got ' + brief(nav.last));
        const fail = await openSecurity(t, 'map'); if (fail) return out.concat(fail);
        if (await t.evaluate(PAGE.tab) !== 'security') out.push('the tab is not security');
        await pause(500);
        const reads = await t.evaluate(PAGE.callCount('security.read'));
        if (reads !== 1) out.push('arrival called hq.security.read ' + reads + ' times, want exactly 1');
        const scans = await t.evaluate(PAGE.callCount('security.scanExports'));
        if (scans !== 1) out.push('arrival called hq.security.scanExports ' + scans + ' times, want exactly 1');
        const marks = await t.evaluate(PAGE.marks);
        if (marks.length !== 1 || marks[0] !== 'security/open') out.push('hq.use marks for security: ' + brief(marks) + ', want exactly security/open');
        const n = await t.evaluate(PAGE.bubbles);
        if (n !== want) out.push('the map shows ' + n + ' bubbles, want ' + want);
        const radii = await t.evaluate(PAGE.nodeRadii);
        if (!(radii.identity > radii.account)) out.push('an identity bubble must be larger than an account bubble, got ' + brief(radii));
        if (!(await t.evaluate(PAGE.dots) > 0)) out.push('no flag dot is drawn on any account');
        const status = await t.evaluate(PAGE.text('[data-sec="status"]'));
        if (!status || !status.includes('Last refreshed 2026-11-10')) out.push('the status line reads "' + status + '"');
        const growth = await t.evaluate(PAGE.text('[data-sec="growth-text"]'));
        if (!growth || !/refreshes kept/.test(growth)) out.push('the growth line reads "' + growth + '"');
        if (!await t.evaluate(PAGE.overflowX)) out.push('the page scrolls sideways');
        const writes = await t.evaluate(PAGE.anyCall(SECURITY_WRITE_METHODS));
        if (writes.length) out.push('opening the map wrote: ' + brief(writes));
        await t.evaluate(PAGE.home); await pause(150);
        await t.evaluate(PAGE.goSecurity('map')); await pause(400);
        const reads2 = await t.evaluate(PAGE.callCount('security.read'));
        if (reads2 !== 2) out.push('coming back must read once more (2 total), got ' + reads2);
      } finally { await leave(t, saved); }
      return out;
    },

    // The card, the chips, the switch, archive, the add forms and the slider
    async 'security-node-edit'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t); if (pre) return pre;
        const f = fx(), first = f.map.accounts[0], want = expectedBubbles(f);
        const fail = await openSecurity(t, 'map'); if (fail) return out.concat(fail);
        const id = await t.evaluate(PAGE.clickNodeByTitle('/^example\\.test/'));
        if (id !== first.id) out.push('clicking example.test picked ' + id + ', want ' + first.id);
        if (!await t.waitFor(PAGE.has('[data-sec="card"]'), 3000)) return out.concat('the side card never opened');
        const flags = await t.evaluate(PAGE.text('[data-sec="card-flags"]'));
        if (!/weak password/.test(flags) || !/password reused/.test(flags) || !/no 2FA recorded/.test(flags)) out.push('the card flags read "' + flags + '"');
        const hideWords = await t.evaluate(PAGE.text('[data-sec="card-hide-words"]'));
        if (hideWords !== SENTENCES.hide) out.push('the hide switch says "' + hideWords + '"');
        await t.evaluate(PAGE.clickInRoot(q('[data-sec="card-twofa"]'), '/Ente Auth/'));
        await pause(250);
        const edits = await t.evaluate(PAGE.calls('security.edit'));
        if (edits.length !== 1 || edits[0].args[0] !== first.id || brief(edits[0].args[1]) !== brief({ twofa: 'ente' })) out.push('the 2FA chip called hq.security.edit with ' + brief(edits.map((e) => e.args)));
        const after = await t.evaluate(PAGE.text('[data-sec="card-flags"]'));
        if (/no 2FA recorded/.test(after)) out.push('the 2FA flag stays after choosing Ente Auth');
        const chips = await t.evaluate(PAGE.pressedChips(q('[data-sec="card-twofa"]')));
        if (!chips || chips.join() !== 'Ente Auth') out.push('the pressed 2FA chip is ' + brief(chips));
        const hid = await t.evaluate(PAGE.clickCheckbox('[data-sec="card-hide"]'));
        await pause(250);
        const hideCall = (await t.evaluate(PAGE.calls('security.edit'))).slice(-1)[0];
        if (!hideCall || brief(hideCall.args[1]) !== brief({ hiddenFromClaude: true })) out.push('the hide switch sent ' + brief(hideCall && hideCall.args) + ' (checkbox ' + hid + ')');
        await t.evaluate(PAGE.click('[data-sec="card-archive"]'));
        await pause(250);
        const archived = await t.evaluate(`(() => { const g = document.querySelector('[data-sec-node="${first.id}"]'); return g ? g.style.opacity : null; })()`);
        if (archived !== '0.35') out.push('an archived account must fade (opacity .35), got ' + archived);
        await t.evaluate(PAGE.click('[data-sec="card-close"]'));
        // Add account
        await t.evaluate(PAGE.click('[data-sec="add-account"]'));
        if (!await t.waitFor(PAGE.has('[data-sec="form-account"]'), 3000)) return out.concat('the Add account form never opened');
        await t.evaluate(PAGE.setField('[data-sec="form-title"]', 'old-hobby-2.test'));
        await t.evaluate(PAGE.setField('[data-sec="form-host"]', 'old-hobby-2.test'));
        await t.evaluate(PAGE.click('[data-sec="form-save"]'));
        await pause(400);
        const adds = await t.evaluate(PAGE.calls('security.addManual'));
        if (adds.length !== 1 || brief(adds[0].args[0]) !== brief({ title: 'old-hobby-2.test', host: 'old-hobby-2.test' })) out.push('Add account sent ' + brief(adds.map((a) => a.args)));
        if (await t.evaluate(PAGE.bubbles) !== want + 1) out.push('the new account did not appear on the map');
        // Add identity: refused, then accepted
        await t.evaluate(PAGE.click('[data-sec="add-identity"]'));
        if (!await t.waitFor(PAGE.has('[data-sec="form-identity"]'), 3000)) return out.concat('the Add identity form never opened');
        await t.evaluate(PAGE.setField('[data-sec="form-idvalue"]', 'not-an-address'));
        await t.evaluate(PAGE.click('[data-sec="form-save"]')); await pause(300);
        const refused = await t.evaluate(PAGE.text('[role="alert"]'));
        if (!refused || !refused.includes('not an email or phone number')) out.push('a refused identity shows "' + refused + '"');
        await t.evaluate(PAGE.setField('[data-sec="form-idvalue"]', 'second@example.test'));
        await t.evaluate(PAGE.click('[data-sec="form-save"]')); await pause(400);
        if (await t.evaluate(PAGE.has('[data-sec="form-identity"]'))) out.push('the identity form stays open after an accepted add');
        if (await t.evaluate(PAGE.bubbles) !== want + 2) out.push('the new identity did not appear on the map');
        // the slider
        const total = await t.evaluate(PAGE.bubbles);
        await t.evaluate(PAGE.setSlider(1)); await pause(300);
        const early = await t.evaluate(PAGE.bubbles);
        if (!(early < total)) out.push('the slider at its second stop must show fewer bubbles (' + early + ' of ' + total + ')');
        const label = await t.evaluate(PAGE.text('[data-sec="slider-label"]'));
        if (!label || !/^Showing accounts created on or before /.test(label)) out.push('the slider label reads "' + label + '"');
      } finally { await leave(t, saved); }
      return out;
    },

    // The typed passphrase is never in the state, the vals, storage or the markup; the field is empty after send, error, cancel and Escape
    async 'security-unlock-clears'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      const WRONG = 'wrong horse example', RIGHT = FAKE_PASSPHRASE;
      const leakCheck = async (label, pass) => { const w = await t.evaluate(PAGE.leaks(pass)); if (w && w.length) out.push('at "' + label + '" the passphrase is in: ' + w.join(', ')); };
      try {
        const pre = await boot(t); if (pre) return pre;
        const fail = await openSecurity(t, 'map'); if (fail) return out.concat(fail);
        await t.evaluate(PAGE.click('[data-sec="refresh"]'));
        if (!await t.waitFor(PAGE.has('[data-sec="dialog"]'), 3000)) return out.concat('the unlock dialog never opened');
        const tag = await t.evaluate(`(() => { const e = ${q('[data-sec="pass"]')}; return e ? { type: e.type, ac: e.getAttribute('autocomplete'), sp: e.getAttribute('spellcheck') } : null; })()`);
        if (!tag || tag.type !== 'password' || tag.ac !== 'off' || tag.sp !== 'false') out.push('the passphrase field is ' + brief(tag));
        if (await t.evaluate(PAGE.checkbox('[data-sec="breaches"]')) !== true) out.push('the breach checkbox must default on');
        const box = await t.evaluate(PAGE.text('[data-sec="dialog"]'));
        if (!box || !box.includes(SENTENCES.breachBox)) out.push('the dialog never says "' + SENTENCES.breachBox + '"');
        if (!box || !box.includes(SENTENCES.unlockClipboard)) out.push('the unlock help never carries the clipboard sentence, it reads "' + box + '"');
        // wrong passphrase
        await t.evaluate(PAGE.focusField('[data-sec="pass"]'));
        await type(t, WRONG);
        if (await t.evaluate(PAGE.fieldValue('[data-sec="pass"]')) !== WRONG) out.push('the typed text never reached the field');
        await leakCheck('typed (wrong)', WRONG);
        await t.evaluate(PAGE.click('[data-sec="dialog-go"]'));
        await pause(200);
        const afterSend = await t.evaluate(PAGE.fieldValue('[data-sec="pass"]'));
        if (afterSend !== '' && afterSend !== null) out.push('the field still holds text after the send');
        if (!await t.waitFor(`(${PAGE.text('[data-sec="dialog-error"]')} || '').includes(${JSON.stringify(WRONG_PASSPHRASE_ERROR)})`, 3000)) out.push('a wrong passphrase must show main\'s words "' + WRONG_PASSPHRASE_ERROR + '"');
        await leakCheck('after the error (wrong)', WRONG);
        if (await t.evaluate(PAGE.fieldValue('[data-sec="pass"]')) !== '') out.push('the field is not empty after an error');
        const calls = await t.evaluate(PAGE.calls('security.refresh'));
        if (calls.length !== 1 || calls[0].args[0] !== WRONG || calls[0].args[1] !== true) out.push('the first refresh call carried ' + brief(calls.map((c) => [c.args[1]])) + ' (count ' + calls.length + ')');
        // right passphrase, breach check off
        await t.evaluate(PAGE.focusField('[data-sec="pass"]'));
        await type(t, RIGHT);
        await leakCheck('typed (right)', RIGHT);
        await t.evaluate(PAGE.clickCheckbox('[data-sec="breaches"]'));
        await t.evaluate(PAGE.click('[data-sec="dialog-go"]'));
        if (!await t.waitFor(`!${PAGE.has('[data-sec="dialog"]')}`, 4000)) return out.concat('the dialog stays open after a good passphrase');
        await leakCheck('after success', RIGHT);
        const calls2 = await t.evaluate(PAGE.calls('security.refresh'));
        if (calls2.length !== 2 || calls2[1].args[0] !== RIGHT || calls2[1].args[1] !== false) out.push('the second refresh carried the box value ' + brief(calls2[1] && calls2[1].args[1]) + ', want false');
        const status = await t.evaluate(PAGE.text('[data-sec="status"]'));
        if (!status || !status.includes('Last refreshed 2026-11-11')) out.push('the status line did not move after the refresh: "' + status + '"');
        const note = await t.evaluate(PAGE.text('[data-sec="note"]'));
        if (!note || !/breach check off or not finished/.test(note)) out.push('the note after a refresh without the breach check reads "' + note + '"');
        const rmarks = await t.evaluate(PAGE.refreshMarks);
        if (rmarks.length !== 1) out.push('security-refresh marks: ' + brief(rmarks) + ', want exactly one (a second press in the same arrival is the same mark)');
        // cancel
        await t.evaluate(PAGE.click('[data-sec="refresh"]'));
        if (!await t.waitFor(PAGE.has('[data-sec="dialog"]'), 3000)) return out.concat('the dialog did not open a second time');
        await t.evaluate(PAGE.focusField('[data-sec="pass"]'));
        await type(t, RIGHT);
        const cleared = await t.evaluate(`(() => { const e = ${q('[data-sec="pass"]')}; const b = ${q('[data-sec="dialog-cancel"]')}; if (!e || !b) return null; b.click(); return e.value; })()`);
        if (cleared !== '') out.push('Cancel left "' + cleared + '" in the field');
        await leakCheck('after cancel', RIGHT);
        // Escape
        await t.evaluate(PAGE.click('[data-sec="refresh"]'));
        if (!await t.waitFor(PAGE.has('[data-sec="dialog"]'), 3000)) return out.concat('the dialog did not open a third time');
        await t.evaluate(PAGE.focusField('[data-sec="pass"]'));
        await type(t, RIGHT);
        const esc = await t.evaluate(`(() => { const e = ${q('[data-sec="pass"]')}; const ok = ${PAGE.escapeInDialog}; return ok ? e.value : null; })()`);
        if (esc !== '') out.push('Escape left "' + esc + '" in the field');
        if (!await t.waitFor(`!${PAGE.has('[data-sec="dialog"]')}`, 3000)) out.push('Escape did not close the dialog');
        await leakCheck('after escape', RIGHT);
        // Escape with the focus outside the dialog (the owner clicked its text): the page-level handler closes it
        await t.evaluate(PAGE.click('[data-sec="refresh"]'));
        if (!await t.waitFor(PAGE.has('[data-sec="dialog"]'), 3000)) return out.concat('the dialog did not open a fourth time');
        await t.evaluate(PAGE.focusField('[data-sec="pass"]'));
        await type(t, RIGHT);
        await t.evaluate("(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()");
        await t.press('Escape');
        if (!await t.waitFor(`!${PAGE.has('[data-sec="dialog"]')}`, 3000)) out.push('Escape with the focus outside the dialog did not close it');
        await leakCheck('after an outside Escape', RIGHT);
        if (await t.evaluate(PAGE.callCount('security.refresh')) !== 2) out.push('cancel and Escape must never call hq.security.refresh');
      } finally { await leave(t, saved); }
      return out;
    },

    // Flag rows, "not checked", the export list as a guess, the Recycle Bin per file, the conflict sentence
    async 'security-health'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t); if (pre) return pre;
        const f = fx(); f.status.breachCheckedAt = null; for (const a of f.map.accounts) a.breached = null;
        await t.evaluate(PAGE.persistRead(f));
        const fail = await openSecurity(t, 'health'); if (fail) return out.concat(fail);
        const rows = await t.evaluate(PAGE.count('[data-sec="flag-row"]'));
        if (rows !== 6) out.push('the health list has ' + rows + ' flag rows, want 6');
        const counts = await t.evaluate(PAGE.texts('[data-sec="flag-row"] [data-sec="flag-count"]'));
        if (counts[0] !== 'not checked') out.push('breached must read "not checked" when nothing was checked, got "' + counts[0] + '"');
        const line = await t.evaluate(PAGE.text('[data-sec="breach-line"]'));
        if (!line || !/not checked/.test(line)) out.push('the breach line reads "' + line + '"');
        const exports = await t.evaluate(PAGE.texts('[data-sec="export-row"]'));
        if (exports.length !== 1 || !exports[0].includes(SENTENCES.exportGuess) || !exports[0].includes('Chrome Passwords.csv')) out.push('the export list reads ' + brief(exports));
        const looked = await t.evaluate(PAGE.text('[data-sec="exports-looked"]'));
        if (looked !== SENTENCES.looked) out.push('the looked-in line reads "' + looked + '"');
        if (looked && /[\/:]/.test(looked)) out.push('the looked-in line carries a path: "' + looked + '"');
        const conflict = await t.evaluate(PAGE.text('[data-sec="conflicts"]'));
        if (!conflict || !conflict.includes(SENTENCES.conflict)) out.push('the conflict card reads "' + conflict + '"');
        if (await t.evaluate(PAGE.callCount('security.trashExport')) !== 0) out.push('opening Health moved a file');
        await t.evaluate(PAGE.click('[data-sec="export-trash"]'));
        await pause(500);
        const trash = await t.evaluate(PAGE.calls('security.trashExport'));
        if (trash.length !== 1 || trash[0].args[0] !== 'Chrome Passwords.csv') out.push('Move to Recycle Bin sent ' + brief(trash.map((c) => c.args)));
        if (await t.evaluate(PAGE.count('[data-sec="export-row"]')) !== 0) out.push('the file row stays after it was moved');
        // a flagged account opens its card on the map
        const flagged = await t.evaluate(PAGE.count('[data-sec="flagged"]'));
        if (flagged < 3) out.push('only ' + flagged + ' flagged accounts are listed');
        await t.evaluate(`(() => { const b = document.querySelector('[data-sec="flagged"] button'); if (b) b.click(); return !!b; })()`);
        await pause(300);
        if (await t.evaluate(PAGE.sub) !== 'map' || !await t.evaluate(PAGE.has('[data-sec="card"]'))) out.push('a flagged account did not open its card on the map');
      } finally { await leave(t, saved); }
      return out;
    },

    // The ten steps in order, who decided each, ticking, the vault path, the blank sheet
    async 'security-setup'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t); if (pre) return pre;
        const fail = await openSecurity(t, 'setup'); if (fail) return out.concat(fail);
        const ids = await t.evaluate("[...document.querySelectorAll('[data-sec=\"step\"]')].map((e) => e.getAttribute('data-step'))");
        if (brief(ids) !== brief(STEP_IDS)) out.push('the steps run in the order ' + brief(ids));
        const checks = await t.evaluate(PAGE.texts('[data-sec="step-check"]'));
        if (checks[0] !== 'you ticked this') out.push('step 1 reads "' + checks[0] + '"');
        if (checks[1] !== 'checked by the app: keepassxc-cli was found') out.push('step 2 reads "' + checks[1] + '"');
        if (checks[5] !== 'not ticked yet') out.push('step 6 reads "' + checks[5] + '"');
        const ticks = await t.evaluate(PAGE.count('[data-sec="tick"]'));
        if (ticks !== 7) out.push(ticks + ' tick buttons, want 7 (an app-checked step has none)');
        await t.evaluate(`(() => { const b = document.querySelector('[data-step="phone-keepassdx"] [data-sec="tick"]'); if (b) b.click(); return !!b; })()`);
        await pause(300);
        const wk = await t.evaluate(PAGE.calls('security.walkthrough'));
        if (wk.length !== 1 || wk[0].args[0] !== 'phone-keepassdx' || wk[0].args[1] !== true) out.push('ticking sent ' + brief(wk.map((c) => c.args)));
        const after = await t.evaluate(PAGE.texts('[data-sec="step-check"]'));
        if (after[5] !== 'you ticked this') out.push('step 6 reads "' + after[5] + '" after ticking');
        // the vault path
        await t.evaluate(PAGE.setField('[data-sec="vault-path"]', 'C:/placeholder/vault.txt'));
        await t.evaluate(PAGE.click('[data-sec="vault-save"]')); await pause(300);
        const err = await t.evaluate(PAGE.text('[role="alert"]'));
        if (!err || !/\.kdbx/.test(err)) out.push('a bad vault path shows "' + err + '"');
        await t.evaluate(PAGE.setField('[data-sec="vault-path"]', 'C:/placeholder/vault/other.kdbx'));
        await t.evaluate(PAGE.click('[data-sec="vault-save"]')); await pause(300);
        const sets = await t.evaluate(PAGE.calls('security.settings'));
        if (sets.length !== 2 || sets[1].args[0].vaultPath !== 'C:/placeholder/vault/other.kdbx') out.push('Save path sent ' + brief(sets.map((c) => c.args)));
        // the emergency sheet
        await t.evaluate(PAGE.click('[data-sec="sheet-open"]'));
        if (!await t.waitFor(PAGE.has('[data-sec="sheet"]'), 3000)) return out.concat('the emergency sheet never opened');
        const lines = await t.evaluate(PAGE.count('[data-sec="sheet-line"]'));
        if (lines < 6) out.push('the sheet has ' + lines + ' lines');
        const sheet = await t.evaluate(PAGE.text('[data-sec="sheet"]'));
        for (const s of ['example.test', 'acme.test', 'alpha-site', 'owner@example', 'placeholder', '.kdbx']) if (sheet.includes(s)) out.push('the sheet carries "' + s + '": it must hold blank lines only');
        // printing: the sheet prints alone (the page behind it, with the vault path field, is hidden), black on white, without its buttons
        try {
          await t.send('Emulation.setEmulatedMedia', { media: 'print' });
          const pr = await t.evaluate("(() => { const cs = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e) : null; }; const sh = cs('[data-sec=\"sheet\"]'), ln = cs('[data-sec=\"sheet-line\"]'), vp = cs('[data-sec=\"vault-path\"]'), pb = cs('[data-sec=\"sheet-print\"]'); return { sheet: sh && sh.visibility, bg: sh && sh.backgroundColor, color: sh && sh.color, line: ln && ln.visibility, vault: vp && vp.visibility, printBtn: pb && pb.display }; })()");
          if (!pr || pr.sheet !== 'visible' || pr.line !== 'visible') out.push('printing hides the sheet: ' + brief(pr));
          if (pr && pr.vault !== 'hidden') out.push('printing still shows the page behind the sheet (the vault path field is ' + (pr && pr.vault) + ')');
          if (pr && (pr.bg !== 'rgb(255, 255, 255)' || pr.color !== 'rgb(0, 0, 0)')) out.push('the printed sheet is ' + pr.color + ' on ' + pr.bg + ', want black on white');
          if (pr && pr.printBtn !== 'none') out.push('the Print button would be printed (' + (pr && pr.printBtn) + ')');
        } finally { await t.send('Emulation.setEmulatedMedia', { media: '' }).catch(() => {}); }
        // Escape closes the sheet even when focus is on the page, not in the sheet
        await t.evaluate("(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()");
        await t.press('Escape'); await pause(200);
        if (await t.evaluate(PAGE.has('[data-sec="sheet"]'))) out.push('Escape did not close the emergency sheet');
        await t.evaluate(PAGE.click('[data-sec="sheet-open"]'));
        if (!await t.waitFor(PAGE.has('[data-sec="sheet"]'), 3000)) return out.concat('the emergency sheet did not open again');
        await t.evaluate(PAGE.click('[data-sec="sheet-close"]'));
        if (await t.evaluate(PAGE.has('[data-sec="sheet"]'))) out.push('the sheet stays open after Close');
      } finally { await leave(t, saved); }
      return out;
    },

    // Passphrase and character modes, Copy once, the clipboard sentence, output dropped on arrival
    async 'security-generate'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t); if (pre) return pre;
        const fail = await openSecurity(t, 'generate'); if (fail) return out.concat(fail);
        await t.evaluate(PAGE.click('[data-sec="gen-do"]')); await pause(200);
        const pass = await t.evaluate(PAGE.text('[data-sec="gen-out"]'));
        if (!pass || !/^[a-z]{3,8}(-[a-z]{3,8}){6}$/.test(pass)) out.push('the passphrase reads "' + pass + '", want 7 lower-case words joined by "-"');
        await t.evaluate(PAGE.click('[data-sec="gen-copy"]')); await pause(250);
        const copies = await t.evaluate(PAGE.calls('security.copy'));
        if (copies.length !== 1 || copies[0].args[0] !== pass) out.push('Copy sent ' + brief(copies.map((c) => c.args)) + ', want the shown text once');
        const note = await t.evaluate(PAGE.text('[data-sec="gen-note"]'));
        if (!note || !note.includes(SENTENCES.clipboard)) out.push('the copy note reads "' + note + '"');
        if (note && !/^Copied; /.test(note)) out.push('the copy toast must start with "Copied; ", it reads "' + note + '"');
        const stat = await t.evaluate(PAGE.text('[data-sec="gen-copy-note"]'));
        if (!stat || !stat.includes(SENTENCES.clipboard)) out.push('the standing copy note reads "' + stat + '"');
        // characters, symbols off
        await t.evaluate(`(() => { const b = [...document.querySelectorAll('[data-sec="generator"] button')].find((x) => /Characters/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
        await pause(200);
        await t.evaluate(`(() => { const boxes = [...document.querySelectorAll('[data-sec="gen-set"]')]; const sym = boxes[3]; if (sym) sym.click(); return boxes.length; })()`);
        await t.evaluate(PAGE.click('[data-sec="gen-do"]')); await pause(200);
        const chars = await t.evaluate(PAGE.text('[data-sec="gen-out"]'));
        if (!chars || !/^[A-Za-z0-9]{20}$/.test(chars)) out.push('the character password reads "' + chars + '", want 20 letters and digits (symbols off)');
        for (const [name, re] of [['a lower-case letter', /[a-z]/], ['an upper-case letter', /[A-Z]/], ['a digit', /[0-9]/]]) if (chars && !re.test(chars)) out.push('the character password has no ' + name);
        await t.evaluate(PAGE.click('[data-sec="gen-clear"]'));
        if (await t.evaluate(PAGE.has('[data-sec="gen-out"]'))) out.push('Clear leaves the password on screen');
        // output never survives an arrival
        await t.evaluate(PAGE.click('[data-sec="gen-do"]')); await pause(150);
        await t.evaluate(PAGE.home); await pause(150);
        await t.evaluate(PAGE.goSecurity('generate')); await pause(400);
        if (await t.evaluate(PAGE.has('[data-sec="gen-out"]'))) out.push('a generated password survived leaving and coming back');
        const stateDump = await t.evaluate(`JSON.stringify(${L_}.state.sec.gen.out)`);
        if (stateDump !== 'null') out.push('the generated output is still in state: ' + stateDump);
      } finally { await leave(t, saved); }
      return out;
    },
  };
}
