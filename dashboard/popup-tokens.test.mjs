// The browser extension can't link dashboard-v5/styles/tokens.css (it can only
// load files inside its own folder), so browser-bridge/popup.css carries a copy
// of the token blocks. These pin the copy to the source: every shared name has
// the same value in both themes, the popup only reads names it defines, and the
// popup stays a CSP-clean MV3 page (no inline script, nothing remote).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens } from '../dashboard-v5/styles/tokens-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // dashboard/ — never cwd
const EXT = resolve(HERE, '..', 'browser-bridge');
const read = (p) => readFileSync(p, 'utf8');
const source = parseTokens(read(resolve(HERE, '..', 'dashboard-v5', 'styles', 'tokens.css')));
const popupCss = read(resolve(EXT, 'popup.css'));
const popup = parseTokens(popupCss);

test('popup.css carries both token blocks', () => {
  assert.ok(popup.dark && Object.keys(popup.dark).length, 'popup.css has no [data-hq-theme] block');
  assert.ok(popup.light && Object.keys(popup.light).length, 'popup.css has no [data-hq-theme="light"] block');
});

test('every dark token in popup.css exists in tokens.css with the same value', () => {
  const drift = Object.entries(popup.dark)
    .filter(([k, v]) => source.dark[k] !== v)
    .map(([k, v]) => `${k}: popup "${v}" vs tokens.css "${source.dark[k]}"`);
  assert.deepEqual(drift, []);
});

test('every light token in popup.css exists in tokens.css with the same value', () => {
  const drift = Object.entries(popup.light)
    .filter(([k, v]) => source.light[k] !== v)
    .map(([k, v]) => `${k}: popup "${v}" vs tokens.css "${source.light[k]}"`);
  assert.deepEqual(drift, []);
});

test('popup light block only overrides names its dark block defines', () => {
  assert.deepEqual(Object.keys(popup.light).filter((k) => !(k in popup.dark)), []);
});

test('every var(--name) popup.css reads is defined by its dark block', () => {
  const used = new Set([...popupCss.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((k) => !(k in popup.dark)).sort(), []);
});

test('no rule outside the two token blocks defines a custom property', () => {
  const stray = Object.entries(popup.rules)
    .filter(([sel]) => sel !== '[data-hq-theme]' && sel !== '[data-hq-theme=light]')
    .flatMap(([sel, d]) => Object.keys(d).filter((k) => k.startsWith('--')).map((k) => `${sel} ${k}`));
  assert.deepEqual(stray, []);
});

test('popup.html: no inline script, every script/style is a local file, theme script loads before paint', () => {
  const html = read(resolve(EXT, 'popup.html'));
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 2);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /\bsrc="[^"]+"/, 'inline <script> (MV3 CSP blocks it)');
    assert.equal(body.trim(), '', 'script with a body');
  }
  const refs = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const r of refs) {
    assert.doesNotMatch(r, /^[a-z]+:|^\/\//i, `remote reference: ${r}`);
    assert.ok(existsSync(resolve(EXT, r)), `missing file: ${r}`);
  }
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler attribute');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('popup-theme.js'), 'theme script must run in <head>');
  assert.match(html, /<html[^>]*\bdata-hq-theme="dark"/, 'dark default on <html>');
});

test('popup.css loads nothing remote (no @import, no url())', () => {
  assert.doesNotMatch(popupCss, /@import\b/);
  assert.doesNotMatch(popupCss, /url\(/);
});

test('manifest: MV3, version bumped past 0.1.0, popup wired, no remote-code CSP loosening', () => {
  const m = JSON.parse(read(resolve(EXT, 'manifest.json')));
  assert.equal(m.manifest_version, 3);
  const v = m.version.split('.').map(Number);
  assert.ok(v[0] > 0 || v[1] > 1 || (v[1] === 1 && v[2] > 0), `version ${m.version} not bumped`);
  assert.equal(m.action.default_popup, 'popup.html');
  assert.equal(m.content_security_policy, undefined, 'keep the MV3 default extension CSP');
});
