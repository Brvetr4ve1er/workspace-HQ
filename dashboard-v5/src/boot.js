// Entry point: builds the live store from window.DATA (dashboard/data.js, baked
// by build-data.mjs) and the preload bridge, then mounts the Claude Design
// screen into #app.
// Dev query params mirror the prototype's tweak panel:
//   ?state=live|loading|error|nobridge  ?tab=home|projects|…  ?theme=dark|light|os  ?pet=0
//   ?selftest=1   render every screen × overlay and log `[selftest] {…}` (src/selftest.js)
import { mount, unresolved, failures, renderErrorPanel, errorText as textOf } from './dc/runtime.js';
import template from './app.tpl.js';
import { Component } from './app.js';
import { createStore } from './live/store.js';

const q = new URLSearchParams(location.search);
const hq = window.hq || null;
// A bundle the adapter can't read must not blank the window: boot read-only on
// an empty store, in the error state, with the real reason.
let store, errorText = '';
try { store = createStore(window.DATA, hq); }
catch (e) {
  console.error('[boot] createStore failed:', e);
  errorText = textOf(e) || 'The data bundle couldn’t be read';
  store = createStore({}, null);
}
const props = {
  store,
  previewState: errorText ? 'error' : q.get('state') || (hq ? 'live' : 'nobridge'),
  errorText,
  startTab: q.get('tab') || 'home',
  theme: q.get('theme') || 'dark',
  pet: q.get('pet') !== '0',
};

// mount() itself throws only if the template or the Component constructor
// does; the runtime covers render failures after that.
const root = document.getElementById('app');
let app = null;
try { app = mount(root, Component, template, props); }
catch (e) { failures.count++; failures.last = textOf(e); console.error('[boot] mount failed:', e); renderErrorPanel(root, e); }

// Hooks for the CDP harness and selftests.
window.WHQ = { app, store, unresolved, failures, setProps: (p) => app && app.setProps(p) };

if (q.get('selftest') === '1') import('./selftest.js').then((m) => m.run(window.WHQ)).catch((e) => console.error('[selftest] didn’t start:', e));
