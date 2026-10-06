// node --test legacy/dashboard-v4/src/surfaces/system/screen-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserScans, domSum, rollup, projectMap, distractPct, distractTier,
  trend, trendPct, socialStreak, weekBuckets, summarize, platformDetail,
} from './screen-core.mjs';
import { categorize } from './categories.mjs';

// 2026-07-20 is a Monday; 07-21 a Tuesday.
const scan = (id, domains, extra = {}) => ({
  scan: { id },
  browser: { captured: true, by_domain: domains, ...extra },
});

test('browserScans keeps only captured scans at-or-before the selection', () => {
  const scans = [
    scan('2026-07-20', [{ domain: 'a.com', focus_ms: 10 }]),
    { scan: { id: '2026-07-21' } },                                   // no browser block at all
    scan('2026-07-22', []),                                           // captured but empty
    scan('2026-07-23', [{ domain: 'b.com', focus_ms: 20 }]),
  ];
  assert.equal(browserScans(scans, 3).length, 2);
  assert.equal(browserScans(scans, 0).length, 1);                     // the time machine truncates
  assert.equal(browserScans(scans, 1).length, 1);
  assert.deepEqual(browserScans(null, 5), []);
});

test('browserScans drops malformed domain entries without dropping the scan', () => {
  const scans = [scan('2026-07-20', [null, { focus_ms: 5 }, { domain: 'ok.com', focus_ms: 7 }])];
  const out = browserScans(scans, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].browser.by_domain.length, 1);
  assert.equal(out[0].browser.by_domain[0].domain, 'ok.com');
  // the source scan is untouched — normalization copies
  assert.equal(scans[0].browser.by_domain.length, 3);
});

test('browserScans drops a scan whose every domain entry was malformed', () => {
  assert.deepEqual(browserScans([scan('2026-07-20', [null, { focus_ms: 5 }])], 0), []);
});

test('domSum totals focus time and honours the pick filter', () => {
  const B = { by_domain: [{ domain: 'a', focus_ms: 10 }, { domain: 'b', focus_ms: 5 }, { domain: 'c' }] };
  assert.equal(domSum(B), 15);
  assert.equal(domSum(B, (d) => d.domain === 'a'), 10);
  assert.equal(domSum(null), 0);
});

test('rollup accumulates per domain and indexes the series per captured scan', () => {
  const scansB = browserScans([
    scan('2026-07-20', [{ domain: 'x.com', focus_ms: 100, visits: 2, last_ts: 1, title: 'old' }]),
    scan('2026-07-21', [
      { domain: 'x.com', focus_ms: 300, visits: 3, last_ts: 9, title: 'new' },
      { domain: 'y.com', focus_ms: 50, visits: 1 },
    ]),
  ], 1);
  const roll = rollup(scansB);
  assert.deepEqual(roll.map((r) => r.domain), ['x.com', 'y.com']);    // sorted by total desc
  const x = roll[0];
  assert.equal(x.total, 400);
  assert.equal(x.days, 2);
  assert.equal(x.visits, 5);
  assert.deepEqual(x.series, [100, 300]);
  assert.deepEqual(x.visitsSeries, [2, 3]);
  assert.equal(x.title, 'new');                                       // newest last_ts wins the title
  assert.deepEqual(roll[1].series, [0, 50]);                          // absent day is a real zero
});

test('rollup breaks total ties by domain name so the order is deterministic', () => {
  const scansB = browserScans([scan('2026-07-20', [
    { domain: 'b.com', focus_ms: 10 }, { domain: 'a.com', focus_ms: 10 },
  ])], 0);
  assert.deepEqual(rollup(scansB).map((r) => r.domain), ['a.com', 'b.com']);
});

test('projectMap takes the most recent attribution', () => {
  const scansB = browserScans([
    scan('2026-07-20', [{ domain: 'd.com', focus_ms: 1 }], { by_project: [{ project_name: 'OLD', domains: ['d.com'] }] }),
    scan('2026-07-21', [{ domain: 'd.com', focus_ms: 1 }], { by_project: [{ project_name: 'NEW', domains: ['d.com'] }] }),
  ], 1);
  assert.equal(projectMap(scansB).get('d.com'), 'NEW');
});

test('distractPct is the social+video share of visible time', () => {
  const B = { by_domain: [
    { domain: 'youtube.com', focus_ms: 60 },      // video
    { domain: 'reddit.com', focus_ms: 20 },       // social
    { domain: 'github.com', focus_ms: 20 },       // dev
  ] };
  assert.equal(distractPct(B), 80);
  assert.equal(distractPct({ by_domain: [] }), 0);                    // no divide-by-zero
  assert.equal(distractTier(0), 'low');
  assert.equal(distractTier(34), 'low');
  assert.equal(distractTier(35), 'mid');
  assert.equal(distractTier(64), 'mid');
  assert.equal(distractTier(65), 'high');
});

test('trend returns null without a baseline and never invents one', () => {
  assert.equal(trend(5, null), null);
  assert.equal(trendPct(null, 10), '');
  assert.deepEqual(trend(5, 3), { d: 2, glyph: '▲', dir: 'up' });
  assert.deepEqual(trend(3, 5), { d: -2, glyph: '▼', dir: 'down' });
  assert.equal(trend(5, 5).dir, 'flat');
  assert.equal(trendPct(trend(5, 5), 5), '±0');
  assert.equal(trendPct(trend(5, 0), 0), 'new');                      // grew from nothing
  assert.equal(trendPct(trend(15, 10), 10), '+50%');
  assert.equal(trendPct(trend(5, 10), 10), '-50%');
});

test('socialStreak counts consecutive increases ending at the selection', () => {
  const s = (ms) => scan('2026-07-20', [{ domain: 'reddit.com', focus_ms: ms }]);
  assert.equal(socialStreak(browserScans([s(1), s(2), s(3)], 2)), 2);
  assert.equal(socialStreak(browserScans([s(1), s(2), s(2)], 2)), 0); // flat breaks it (strict growth)
  assert.equal(socialStreak(browserScans([s(5)], 0)), 0);
});

test('weekBuckets buckets Monday-first in UTC and ignores unparseable ids', () => {
  const b = weekBuckets(browserScans([
    scan('2026-07-20', [{ domain: 'a', focus_ms: 10 }]),   // Monday
    scan('2026-07-21', [{ domain: 'a', focus_ms: 5 }]),    // Tuesday
    scan('not-a-date', [{ domain: 'a', focus_ms: 99 }]),
  ], 2));
  assert.deepEqual(b, [10, 5, 0, 0, 0, 0, 0]);
});

test('summarize and platformDetail report the headline facts', () => {
  const scansB = browserScans([
    scan('2026-07-20', [{ domain: 'a.com', focus_ms: 10 }]),
    scan('2026-07-21', [{ domain: 'a.com', focus_ms: 40 }, { domain: 'b.com', focus_ms: 5 }]),
  ], 1);
  const roll = rollup(scansB);
  assert.deepEqual(summarize(scansB, roll), { grandMs: 55, sites: 2, days: 2, busiest: 'a.com' });
  assert.deepEqual(platformDetail(roll[0]), { peak: 40, peakIdx: 1, firstIdx: 0 });
  assert.deepEqual(platformDetail(roll[1]), { peak: 5, peakIdx: 1, firstIdx: 1 });
  assert.deepEqual(summarize([], []), { grandMs: 0, sites: 0, days: 0, busiest: null });
});

test('categorize is first-hit-wins with the AI needles above dev/docs', () => {
  assert.equal(categorize('claude.ai'), 'ai');
  assert.equal(categorize('docs.google.com'), 'docs');
  assert.equal(categorize('github.com'), 'dev');
  assert.equal(categorize('unknown.example'), 'other');
  assert.equal(categorize(null), 'other');
});
