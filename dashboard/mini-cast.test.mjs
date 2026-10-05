// node --test dashboard/mini-cast.test.mjs — the pure halves of the mini HUD
// (mini.js) and the quick-run palette (cast.js): deep-link routes, honest counts,
// last-outcome labels. Placeholder ids only (public repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mini = require('./mini.js');
const cast = require('./cast.js');
const { cleanRoute } = require('./nav-bridge.js');

const NOW = Date.parse('2026-10-05T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

// ---- mini HUD -------------------------------------------------------------------
test('count buttons deep-link where the design says, and nav-bridge accepts each route', () => {
  assert.deepEqual(mini.countRoute('secrets'), { tab: 'tasks', sub: 'ideas' });
  assert.deepEqual(mini.countRoute('uncommitted'), { tab: 'projects', sort: 'dirty' });
  assert.deepEqual(mini.countRoute('unpushed'), { tab: 'projects' });
  assert.equal(mini.countRoute('nope'), null);
  for (const k of ['secrets', 'uncommitted', 'unpushed']) assert.deepEqual(cleanRoute(mini.countRoute(k)), mini.countRoute(k), k);
  const r = mini.countRoute('secrets'); r.tab = 'x';
  assert.equal(mini.countRoute('secrets').tab, 'tasks', 'callers get a copy');
});

test('next action opens its project only when topQuest.projectId is a valid id', () => {
  assert.deepEqual(mini.nextActionRoute({ title: 't', projectId: 'project-a' }), { tab: 'projects', projectId: 'project-a' });
  assert.deepEqual(cleanRoute(mini.nextActionRoute({ projectId: 'project-a' })), { tab: 'projects', projectId: 'project-a' });
  assert.equal(mini.nextActionRoute({ title: 't' }), null, 'K-6 absent → plain show-main');
  assert.equal(mini.nextActionRoute({ projectId: '../x' }), null);
  assert.equal(mini.nextActionRoute({ projectId: 7 }), null);
  assert.equal(mini.nextActionRoute(null), null);
});

test('counts: an absent or garbage field reads "—", never a made-up 0', () => {
  assert.equal(mini.countText(undefined), '—');
  assert.equal(mini.countText(null), '—');
  assert.equal(mini.countText('3'), '—');
  assert.equal(mini.countText(NaN), '—');
  assert.equal(mini.countText(-1), '—');
  assert.equal(mini.countText(0), '0');
  assert.equal(mini.countText(38), '38');
  assert.equal(mini.countTone('secrets', 1), 'red');
  assert.equal(mini.countTone('uncommitted', 38), 'orange');
  assert.equal(mini.countTone('unpushed', 2), 'orange');
  assert.equal(mini.countTone('secrets', 0), 'quiet');
  assert.equal(mini.countTone('secrets', undefined), 'quiet');
  assert.match(mini.countTitle('secrets', undefined), /not reported/);
  assert.match(mini.countTitle('uncommitted', 1), /^1 uncommitted change —/);
  assert.match(mini.countTitle('uncommitted', 38), /^38 uncommitted changes —/);
});

test('level line is "lv N · X xp" and tolerates a missing payload', () => {
  assert.equal(mini.levelText({ level: 4, xp: 842 }), 'lv 4 · 842 xp');
  assert.equal(mini.levelText(null), 'lv – · – xp');
  assert.equal(mini.levelText({ level: 4 }), 'lv 4 · – xp');
  assert.equal(mini.levelTitle({ level: 4, xpToNext: 158, streak: 3 }), '158 xp to lv 5 · 3-day scan streak');
  assert.equal(mini.levelTitle({ level: 9, xpToNext: 0 }), 'max level');
  assert.equal(mini.tierTone('red'), 'red');
  assert.equal(mini.tierTone('purple'), 'quiet');
  assert.equal(mini.clampPct(140), 100);
  assert.equal(mini.clampPct(undefined), 0);
});

test('errText strips Electron’s remote-method prefix', () => {
  assert.equal(mini.errText(new Error("Error invoking remote method 'hq:mini-data': Error: boom")), 'boom');
  assert.equal(cast.errText('plain'), 'plain');
  assert.equal(cast.errText(null), 'unknown error');
});

// ---- quick-run palette ------------------------------------------------------------
test('ago: minutes, hours, days, "just now", and nothing for a bad time', () => {
  assert.equal(cast.ago(daysAgo(2), NOW), '2d ago');
  assert.equal(cast.ago(new Date(NOW - 5 * 60000).toISOString(), NOW), '5m ago');
  assert.equal(cast.ago(new Date(NOW - 3 * 3600000).toISOString(), NOW), '3h ago');
  assert.equal(cast.ago(new Date(NOW - 10000).toISOString(), NOW), 'just now');
  assert.equal(cast.ago(null, NOW), '');
  assert.equal(cast.ago('not a date', NOW), '');
});

test('last outcome: both vocabularies (ok|failed and resolved|fizzled) label the same', () => {
  for (const ok of ['ok', 'resolved']) {
    assert.deepEqual(cast.lastRun({ last_outcome: ok, last_cast: daysAgo(2) }, 'castable', NOW),
      { text: '✓ 2d ago', tone: 'green', title: 'last run succeeded' }, ok);
  }
  for (const bad of ['failed', 'fizzled']) {
    const r = cast.lastRun({ last_outcome: bad, last_exit: 1, last_at: daysAgo(2), last_cast: daysAgo(9) }, 'castable', NOW);
    assert.equal(r.text, '✗ failed 2d ago', bad);
    assert.equal(r.tone, 'red');
    assert.match(r.title, /exit 1/);
  }
  const ch = cast.lastRun({ last_outcome: 'channeled', last_cast: daysAgo(2) }, 'channeled', NOW);
  assert.equal(ch.text, '↗ terminal 2d ago');
});

test('a failure is never dated with the last SUCCESS time (rollup.last_cast skips fizzles)', () => {
  const r = cast.lastRun({ last_outcome: 'fizzled', last_exit: 2, last_cast: daysAgo(7) }, 'castable', NOW);
  assert.equal(r.text, '✗ failed');
  assert.match(r.title, /exit 2/);
  assert.match(r.title, /last success 7d ago/);
  assert.equal(cast.lastRun({ last_outcome: 'failed', last_outcome_at: daysAgo(1) }, 'castable', NOW).text, '✗ failed 1d ago');
});

test('no last_outcome (main before K-6): fall back to last_cast only, then "not run yet"', () => {
  const r = cast.lastRun({ last_cast: daysAgo(3), lifetime_casts: 4, distinct_days: 2 }, 'castable', NOW);
  assert.equal(r.text, '3d ago');
  assert.equal(r.tone, 'faint');
  assert.match(r.title, /not reported/);
  assert.equal(cast.lastRun(undefined, 'castable', NOW).text, 'not run yet');
  assert.equal(cast.lastRun(undefined, 'channeled', NOW).text, '↗ opens a terminal');
  assert.equal(cast.lastRun({ last_outcome: 'weird' }, 'castable', NOW).text, 'not run yet');
  assert.equal(cast.lastRun({ last_outcome: 'ok' }, 'castable', NOW).text, '✓ ok');
});

test('castable keeps runnable, valid spells only', () => {
  const book = { spells: [
    { id: 'sp-a', kind: 'castable' }, { id: 'sp-b', kind: 'tome' }, { id: 'sp-c', kind: 'channeled' },
    { id: 'sp-d', kind: 'chain' }, { id: 'sp-e', kind: 'castable', invalid: true }, null,
  ] };
  assert.deepEqual(cast.castable(book).map((s) => s.id), ['sp-a', 'sp-c', 'sp-d']);
  assert.deepEqual(cast.castable(null), []);
  assert.deepEqual(cast.castable({}), []);
});

test('pickHits: favourites, then most recent (failures count as recent when dated), then grimoire', () => {
  const S = [
    { id: 'sp-a', name: 'Alpha', source: 'grimoire' },
    { id: 'sp-b', name: 'Beta build' },
    { id: 'sp-c', name: 'Gamma', school: 'divination' },
    { id: 'sp-d', name: 'Delta' },
  ];
  const tele = { favorites: ['sp-d', 'sp-missing'], rollup: {
    'sp-b': { last_cast: daysAgo(5) },
    'sp-c': { last_cast: daysAgo(9), last_outcome: 'fizzled', last_at: daysAgo(1) },
  } };
  assert.deepEqual(cast.pickHits(S, tele, '').map((s) => s.id), ['sp-d', 'sp-c', 'sp-b', 'sp-a']);
  assert.deepEqual(cast.pickHits(S, tele, 'b').map((s) => s.id), ['sp-b']);
  assert.deepEqual(cast.pickHits(S, tele, 'div').map((s) => s.id), ['sp-c'], 'school matches');
  assert.deepEqual(cast.pickHits(S, tele, 'ta').map((s) => s.id), ['sp-b', 'sp-d'], 'contains');
  assert.deepEqual(cast.pickHits(S, {}, '').map((s) => s.id), ['sp-a'], 'no telemetry → grimoire only');
  assert.equal(cast.pickHits(S, tele, '', 2).length, 2);
});

test('castProblem surfaces refusals instead of swallowing them', () => {
  assert.equal(cast.castProblem({ error: 'already casting' }), 'already casting');
  assert.equal(cast.castProblem(null), 'no answer from the app');
  assert.equal(cast.castProblem({ castId: 'c-1' }), null);
  assert.equal(cast.castProblem({ channeled: true }), null);
  assert.equal(cast.pipCount({ distinct_days: 16 }), 3);
  assert.equal(cast.pipCount(undefined), 0);
});

// ---- the pages themselves ----------------------------------------------------------
for (const page of ['mini', 'cast']) {
  test(`${page}.html: v5 CSP, tokens, satellite-theme first, no inline script`, () => {
    const html = readFileSync(new URL(`./${page}.html`, import.meta.url), 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(csp, 'has a CSP meta');
    assert.match(csp[1], /default-src 'self'/);
    assert.match(csp[1], /script-src 'self'(;|$)/);
    assert.doesNotMatch(csp[1], /unsafe-eval|https?:/);
    assert.match(html, /href="\.\.\/dashboard-v5\/styles\/tokens\.css"/);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 2);
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /src="/, 'every script is external');
      assert.equal(body.trim(), '', 'no inline script body');
    }
    assert.match(scripts[0][1], /satellite-theme\.js/, 'satellite-theme.js loads first');
    assert.ok(html.indexOf('satellite-theme.js') < html.indexOf('tokens.css'), 'theme attribute before the stylesheet');
    assert.match(scripts[scripts.length - 1][1], new RegExp(`${page}\\.js`));
    assert.doesNotMatch(html, /\son[a-z]+="/i, 'no inline event handlers');
  });
}
