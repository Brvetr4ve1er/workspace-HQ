// ?selftest=1 (loaded by boot.js; dev-main.js --selftest turns its last line
// into an exit code). Renders every combination the screen can be in —
// theme × time-machine end (live, oldest) × every tab and sub-tab plus the
// first project's page × every overlay, then preview states × theme × overlay
// on Home — and counts what broke:
//   errors      console.error calls, uncaught errors, unhandled rejections
//   unresolved  template bindings that never resolved (WHQ.unresolved, boot included)
//   failures    runtime render failures (WHQ.failures, boot included)
// Read-only by construction: it drives setState / go / openProject / setProps
// only and never touches window.hq. setState persists prefs and place, so
// those storage keys are snapshotted first and put back at the end.
import { NAV, SUBS } from './live/catalog.mjs';

const LOCAL_KEYS = ['whq3-prefs', 'hq-theme'], SESSION_KEYS = ['whq3-place'];
// every overlay closed; applied before each combo so combos never stack
const CLEAR = { paletteOpen: false, paletteMode: 'go', paletteQuery: '', paletteSel: 0, askOpen: false, runsOpen: false, scrubOpen: false, settingsOpen: false, cheatOpen: false, moreOpen: false, ambientOverlay: false, focus: null, confirm: null, commit: null, sheet: null, levelUp: null, onboard: null, lightbox: null, pageMore: false };
const RESTORE = Object.keys(CLEAR).concat(['tab', 'sub', 'route', 'snapOffset', 'themePref', 'sound', 'askHistory', 'confirmAsk', 'commitSel', 'diagTab', 'journalDraft']);
const ASK = { q: 'selftest question', id: 'selftest-ask', a: { text: 'Synthetic answer for the selftest.', src: ['Scan'], est: true, status: 'done' } };

// One render = the queued flush (a microtask) + a frame for refs, animations
// and custom elements. A hidden window may get ~1 frame a second, so a 60 Hz
// frame's worth of time stands in when rAF doesn't come.
const frame = () => new Promise((res) => { let done = false; const fin = () => { if (!done) { done = true; res(); } }; requestAnimationFrame(fin); setTimeout(fin, 16); });
const rendered = () => new Promise((res) => queueMicrotask(res)).then(frame);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const short = (a) => a.map((x) => (x && x.stack) || (x && x.message) || String(x)).join(' ').slice(0, 400);

function snapshot(store, keys) { const o = {}; for (const k of keys) { try { o[k] = store.getItem(k); } catch { o[k] = null; } } return o; }
function restore(store, saved) { for (const [k, v] of Object.entries(saved)) { try { if (v == null) store.removeItem(k); else store.setItem(k, v); } catch {} } }

export async function run(W = window.WHQ) {
  const t0 = performance.now();
  const stats = { combos: 0, errors: 0 };
  const samples = [], holes = new Map();
  let label = 'start';
  const note = (kind, args) => { stats.errors++; if (samples.length < 25) samples.push(label + ' · ' + kind + ' · ' + short(args)); };
  const origError = console.error;
  console.error = function (...a) { note('console.error', a); return origError.apply(this, a); };
  const onError = (e) => note('error', [e.error || e.message]);
  const onRejection = (e) => note('unhandledrejection', [e.reason]);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const savedLocal = snapshot(localStorage, LOCAL_KEYS), savedSession = snapshot(sessionStorage, SESSION_KEYS);
  const L = W && W.app && W.app.logic;
  if (W) for (const k of W.unresolved) holes.set(k, 'boot');
  const initial = {}, initialProps = {};
  try {
    if (!L) throw new Error('no mounted app (WHQ.app is null)');
    for (const k of RESTORE) initial[k] = L.state[k];
    for (const k of ['previewState', 'errorText']) initialProps[k] = L.props[k];
    const M = W.store.model;
    const combo = async (name, drive) => {
      label = name;
      drive();
      await rendered();
      stats.combos++;
      for (const k of W.unresolved) if (!holes.has(k)) holes.set(k, name);
    };

    L.setState({ sound: false });   // no chiptune blips for a thousand tab switches (restored below)
    await rendered(); await sleep(300);   // let boot reads land first

    const views = [];
    for (const n of NAV) for (const s of SUBS[n.id] || [[undefined]]) views.push({ tab: n.id, sub: s[0], name: n.id + (s[0] ? '/' + s[0] : '') });
    const proj = (M.P0[0] || {}).id;
    if (proj) views.push({ tab: 'projects', sub: 'grid', project: proj, name: 'project-page' });
    const open = typeof L.openTasks === 'function' ? L.openTasks(0) : M.T0;
    const auto = M.AUTOS[0];
    const overlays = [
      ['none', {}],
      ['palette-go', { paletteOpen: true, paletteMode: 'go' }],
      ['palette-ask', { paletteOpen: true, paletteMode: 'ask' }],
      ['ask', { askOpen: true, askHistory: [ASK] }],
      ['runs', { runsOpen: true }],
      ['scrub', { scrubOpen: true }],
      ['settings', { settingsOpen: true }],
      ['cheat', { cheatOpen: true }],
      ['focus', { focus: { taskId: open[0] ? open[0].id : null, start: Date.now() } }],
      auto && ['confirm', { confirm: auto.id, confirmAsk: 'always' }],
      proj && ['commit', { commit: { pid: proj, files: [{ name: 'src/a.js', st: 'mod', on: true }], stat: '', loading: false, msg: 'x', drafted: '' }, commitSel: 0 }],
      ['sheet', { sheet: { title: 't', body: 'b', ok: 'ok', danger: true } }],
      ['levelUp', { levelUp: { l: 5, t: 'Foreman' } }],
      ...[1, 2, 3].map((step) => ['onboard-' + step, { onboard: { step, path: '', dev: 'npm run dev', branch: 'main', name: '' } }]),
    ].filter(Boolean);
    const offsets = M.maxOff > 0 ? [0, M.maxOff] : [0];
    const base = { askHistory: initial.askHistory };

    for (const theme of ['dark', 'light']) {
      for (const off of offsets) {
        for (const v of views) {
          for (const [ov, patch] of overlays) {
            await combo([theme, 'off' + off, v.name, ov].join(' '), () => {
              L.go(v.tab, v.sub);
              if (v.project) L.openProject(v.project);
              L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: off }, patch));
            });
          }
        }
      }
    }
    // preview states (loading / error / nobridge / live) only change the shell and body
    for (const state of ['loading', 'error', 'nobridge', 'live']) {
      for (const theme of ['dark', 'light']) {
        for (const [ov, patch] of overlays) {
          await combo(['state:' + state, theme, ov].join(' '), () => {
            W.app.setProps({ previewState: state, errorText: state === 'error' ? 'selftest: synthetic error text' : initialProps.errorText });
            L.go('home');
            L.setState(Object.assign({}, CLEAR, base, { themePref: theme, snapOffset: 0 }, patch));
          });
        }
      }
    }
    await sleep(300);   // stragglers: timers and frames the last combos queued
  } catch (e) {
    note('selftest crashed', [e]);
  } finally {
    // the app first (its componentDidUpdate rewrites prefs + place), then storage
    label = 'restore';
    try {
      if (L) {
        W.app.setProps(initialProps);
        L.setState(initial);
        await rendered();
      }
    } catch (e) { note('restore failed', [e]); }
    restore(localStorage, savedLocal); restore(sessionStorage, savedSession);
    console.error = origError;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }
  const summary = { combos: stats.combos, errors: stats.errors, unresolved: W ? W.unresolved.size : -1, failures: W && W.failures ? W.failures.count : -1 };
  const detail = { ms: Math.round(performance.now() - t0), samples, holes: [...holes].map(([k, at]) => k + ' @ ' + at), lastFailure: W && W.failures ? W.failures.last : '' };
  window.__selftestDetail = detail;
  console.log('[selftest:detail] ' + JSON.stringify(detail));
  console.log('[selftest] ' + JSON.stringify(summary));
  window.__selftest = summary;
  return summary;
}
