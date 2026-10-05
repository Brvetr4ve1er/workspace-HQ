// tokens.css is the palette + type contract the main window and every
// transparent satellite share. These pin: both theme blocks exist, light only
// overrides names dark defines, the names the template + satellites read are
// there, the vendored fonts resolve relative to the CSS file, tokens.css stays
// tokens-only (no html/body rules), and app.css doesn't grow a second copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTokens, normalizeSelector, DARK, LIGHT } from './tokens-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // dashboard-v5/styles — never cwd
const read = (p) => readFileSync(resolve(HERE, p), 'utf8');
const tokens = parseTokens(read('tokens.css'));

const REQUIRED = ['--bg', '--panel', '--card', '--card-hi', '--ink', '--frame', '--frame-hi', '--text',
  '--muted', '--faint', '--gold', '--accent-text', '--green', '--red', '--orange', '--yellow', '--blue',
  '--purple', '--term'];

test('both theme blocks exist and are non-empty', () => {
  assert.ok(tokens.dark && Object.keys(tokens.dark).length, `${DARK} block missing or empty`);
  assert.ok(tokens.light && Object.keys(tokens.light).length, `${LIGHT} block missing or empty`);
});

test('every custom property the light block overrides is defined in the dark block', () => {
  const orphans = Object.keys(tokens.light).filter((k) => !(k in tokens.dark));
  assert.deepEqual(orphans, []);
});

test('the required token set is defined (non-empty) in the dark block', () => {
  const missing = REQUIRED.filter((k) => !tokens.dark[k]);
  assert.deepEqual(missing, []);
});

test('every @font-face url is local and points at an existing file, relative to tokens.css', () => {
  assert.ok(tokens.fontFaces.length >= 1, 'no @font-face rules');
  for (const ff of tokens.fontFaces) {
    assert.equal(ff.family, 'IBM Plex Mono');
    assert.ok(ff.urls.length, `@font-face without url(): ${ff.src}`);
    for (const u of ff.urls) {
      assert.doesNotMatch(u, /^[a-z]+:/i, `remote/absolute font url (CSP font-src 'self'): ${u}`);
      assert.ok(existsSync(resolve(HERE, u)), `font file missing: ${u} (resolved from styles/)`);
    }
  }
});

test('tokens.css is tokens-only: no html/body/:root rules (satellites are transparent)', () => {
  assert.deepEqual(Object.keys(tokens.rules).sort(), [DARK, LIGHT].sort());
});

test('app.css carries no second copy of the token blocks or @font-face', () => {
  const app = parseTokens(read('app.css'));
  assert.equal(app.dark, null);
  assert.equal(app.light, null);
  assert.deepEqual(app.fontFaces, []);
  const redefined = Object.entries(app.rules).flatMap(([sel, d]) =>
    Object.keys(d).filter((k) => k.startsWith('--')).map((k) => `${sel} ${k}`));
  assert.deepEqual(redefined, []);
});

test('index.html links tokens.css before app.css, favicons are v5-local, no file link into dashboard-v3', () => {
  const html = read('../index.html');
  const links = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  const t = links.indexOf('./styles/tokens.css'), a = links.indexOf('./styles/app.css');
  assert.ok(t !== -1 && a !== -1 && t < a, `stylesheet order: ${links.join(' ')}`);
  assert.deepEqual(links.filter((l) => l.includes('dashboard-v3')), []);
  const icons = [...html.matchAll(/<link\b[^>]*rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(icons.length >= 1, 'no favicon links');
  for (const href of icons) assert.ok(existsSync(resolve(HERE, '..', href)), `favicon missing: ${href}`);
});

// ── parseTokens itself (a later package reuses it for the extension's copy) ──

test('parseTokens: comments are ignored, including ones that contain braces', () => {
  const t = parseTokens(`/* [data-hq-theme]{--x:1} */ [data-hq-theme]{ /* } */ --a:1; --b : 2 }`);
  assert.deepEqual(t.dark, { '--a': '1', '--b': '2' });
});

test('parseTokens: quoted values keep their commas, semicolons and braces', () => {
  const t = parseTokens(`[data-hq-theme]{--term:'IBM Plex Mono',ui-monospace,monospace;--q:"a;b{c}";--u:url("x;y.png")}`);
  assert.equal(t.dark['--term'], `'IBM Plex Mono',ui-monospace,monospace`);
  assert.equal(t.dark['--q'], `"a;b{c}"`);
  assert.equal(t.dark['--u'], `url("x;y.png")`);
});

test('parseTokens: nested @media is skipped without derailing later top-level rules', () => {
  const t = parseTokens(`@import url("x.css"); @media (prefers-color-scheme: light){ [data-hq-theme]{--a:media} .x{color:red} }
    [data-hq-theme]{--a:base}`);
  assert.deepEqual(t.dark, { '--a': 'base' });
  assert.equal(t.rules['.x'], undefined);
});

test('parseTokens: attribute-selector quoting variants normalize to one key', () => {
  for (const sel of [`[data-hq-theme="light"]`, `[data-hq-theme='light']`, `[data-hq-theme=light]`, `[ data-hq-theme = "light" ]`]) {
    assert.equal(normalizeSelector(sel), LIGHT, sel);
    assert.deepEqual(parseTokens(`${sel}{--a:1}`).light, { '--a': '1' }, sel);
  }
});

test('parseTokens: selector lists fill every selector; a repeated selector merges, later wins', () => {
  const t = parseTokens(`:root , [data-hq-theme]{--a:1;--b:1;color-scheme:dark} [data-hq-theme]{--b:2}`);
  assert.deepEqual(t.rules[':root'], { '--a': '1', '--b': '1', 'color-scheme': 'dark' });
  assert.deepEqual(t.dark, { '--a': '1', '--b': '2' }); // custom properties only
  assert.equal(t.light, null);
});

test('parseTokens: @font-face exposes family, every url, weight and style', () => {
  const t = parseTokens(`@font-face{font-family:"Mono X";src:url('../f/a.woff2') format('woff2'), url(../f/a.ttf) format('truetype');font-weight:400 500;font-style:normal}`);
  assert.deepEqual(t.fontFaces.map(({ family, urls, weight, style }) => ({ family, urls, weight, style })),
    [{ family: 'Mono X', urls: ['../f/a.woff2', '../f/a.ttf'], weight: '400 500', style: 'normal' }]);
  assert.deepEqual(t.rules, {});
});
