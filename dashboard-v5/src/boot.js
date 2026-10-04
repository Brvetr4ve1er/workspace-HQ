// Entry point: builds the live store from window.DATA (dashboard/data.js, baked
// by build-data.mjs) and the preload bridge, then mounts the Claude Design
// screen into #app.
// Dev query params mirror the prototype's tweak panel:
//   ?state=live|loading|error|nobridge  ?tab=home|projects|…  ?theme=dark|light|os  ?pet=0
import { mount, unresolved } from './dc/runtime.js';
import template from './app.tpl.js';
import { Component } from './app.js';
import { createStore } from './live/store.js';

const q = new URLSearchParams(location.search);
const hq = window.hq || null;
const store = createStore(window.DATA, hq);
const props = {
  store,
  previewState: q.get('state') || (hq ? 'live' : 'nobridge'),
  startTab: q.get('tab') || 'home',
  theme: q.get('theme') || 'dark',
  pet: q.get('pet') !== '0',
};

const app = mount(document.getElementById('app'), Component, template, props);

// Hooks for the CDP harness and selftests.
window.WHQ = { app, store, unresolved, setProps: (p) => app.setProps(p) };
