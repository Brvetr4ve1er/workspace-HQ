import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrowser } from './browser.mjs';

const projects = [
  { id: 'crucix', name: 'Crucix', path: 'C:/Users/x/Documents/Crucix', dev_cmd: 'npm run dev' },
  { id: 'alliance-travel', name: 'alliance travel', path: 'alliance travel', dev_cmd: 'python -m http.server 5500 --directory site' },
];

test('empty / missing activity yields an uncaptured block', () => {
  assert.equal(buildBrowser(null, projects).captured, false);
  assert.equal(buildBrowser({ events: [] }, projects).captured, false);
});

test('aggregates focus by domain, sorted desc and deterministic on ties', () => {
  const activity = { updated: 'T', events: [
    { domain: 'github.com', host: 'github.com', path: '/u/crucix', ts: 3, focus_ms: 1000, title: 'newer' },
    { domain: 'github.com', host: 'github.com', path: '/u/crucix', ts: 1, focus_ms: 500, title: 'older' },
    { domain: 'news.ycombinator.com', host: 'news.ycombinator.com', ts: 2, focus_ms: 1500 },
  ] };
  const b = buildBrowser(activity, projects);
  assert.equal(b.captured, true);
  // github.com (1500) ties news.ycombinator.com (1500) -> alphabetical tiebreak
  assert.equal(b.by_domain[0].domain, 'github.com');
  const gh = b.by_domain.find((d) => d.domain === 'github.com');
  assert.equal(gh.focus_ms, 1500);
  assert.equal(gh.visits, 2);
  assert.equal(gh.title, 'newer'); // most recent ts wins
  assert.equal(b.totals.visits, 3);
  assert.equal(b.totals.focus_ms, 3000);
});

test('correlates github path + localhost port to projects', () => {
  const activity = { updated: 'T', events: [
    { domain: 'github.com', host: 'github.com', path: '/user/crucix', ts: 5, focus_ms: 2000 },
    { domain: 'localhost', host: 'localhost:5500', port: '5500', ts: 6, focus_ms: 3000 },
    { domain: 'example.com', host: 'example.com', ts: 7, focus_ms: 100 },
  ] };
  const b = buildBrowser(activity, projects);
  const cx = b.by_project.find((p) => p.project_id === 'crucix');
  const at = b.by_project.find((p) => p.project_id === 'alliance-travel');
  assert.ok(cx && cx.focus_ms === 2000, 'crucix matched via github repo slug');
  assert.ok(at && at.focus_ms === 3000, 'alliance-travel matched via dev_cmd port 5500');
  // example.com correlates to nothing
  assert.equal(b.by_project.reduce((s, p) => s + p.focus_ms, 0), 5000);
});

test('explicit browser_domains wins over slug/localhost heuristics', () => {
  const projs = [
    { id: 'etoile', name: 'etoile', path: 'etoile', dev_cmd: 'npm run dev', browser_domains: ['supabase.com', 'app.tambo.co'] },
    { id: 'other', name: 'other', path: 'other', dev_cmd: 'http.server 5500' },
  ];
  const activity = { updated: 'T', events: [
    { domain: 'supabase.com', host: 'supabase.com', path: '/dashboard/project/abc', ts: 1, focus_ms: 1000 },
    { domain: 'tambo.co', host: 'app.tambo.co', path: '/', ts: 2, focus_ms: 2000 },   // subdomain match
    { domain: 'unrelated.com', host: 'unrelated.com', ts: 3, focus_ms: 500 },
  ] };
  const b = buildBrowser(activity, projs);
  const et = b.by_project.find((p) => p.project_id === 'etoile');
  assert.ok(et && et.focus_ms === 3000, 'both configured domains map to etoile');
  assert.equal(b.by_project.length, 1, 'unrelated.com maps to nothing');
});

test('current prefers the live session and tags its project', () => {
  const activity = {
    updated: 'T',
    live: { domain: 'localhost', host: 'localhost:5500', port: '5500', title: 'dev', ts: 9, focus_ms: 4000 },
    events: [{ domain: 'github.com', host: 'github.com', path: '/user/crucix', ts: 1, focus_ms: 10 }],
  };
  const b = buildBrowser(activity, projects);
  assert.equal(b.current.live, true);
  assert.equal(b.current.host, 'localhost:5500');
  assert.equal(b.current.project_id, 'alliance-travel');
});
