// node --test dashboard-v5/src/live/machine-history.test.mjs
// The pure engine behind System › Machine › "How the PC changed": local-time parsing, gaps (never zeros), the seven charts, the
// honest estimate. Placeholder numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HIST_MAX, MIN_ESTIMATE_CHECKS, MIN_ESTIMATE_DAYS, CHARTS, ROW_KEYS, BOX,
  parseLocal, dayLabel, normalizeRows, buildChart, buildCharts, summaryText, estimateDisk,
} from './machine-history.mjs';

const pad = (n) => String(n).padStart(2, '0');
// zone-less local strings, `i * stepH` hours after 2026-11-01 06:00, formed from calendar fields (no DST arithmetic involved)
function at(i, stepH = 6) {
  const d = new Date(Date.UTC(2026, 10, 1, 6 + i * stepH, 0, 0));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}
const row = (i, o = {}, stepH = 6) => ({ at: at(i, stepH), cpu: 20, ram: 60, diskFreeGB: 100 - i, startup: 10, temp: 3, pingMs: 10, updateDays: 3, ...o });
const rows = (n, f = () => ({}), stepH = 6) => Array.from({ length: n }, (_, i) => row(i, f(i), stepH));
const chart = (id, raw) => buildCharts(raw).find((c) => c.id === id);
const segs = (path) => (path.match(/M/g) || []).length;

test('parseLocal: a zone-less string is LOCAL time, an explicit zone is exact, junk is NaN', () => {
  const t = parseLocal('2026-10-16T10:03:28');
  const d = new Date(t);
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], [2026, 10, 16, 10, 3, 28]);
  assert.equal(parseLocal('2026-10-16 10:03'), new Date(2026, 9, 16, 10, 3, 0).getTime());
  assert.equal(parseLocal('2026-10-16'), new Date(2026, 9, 16, 0, 0, 0).getTime());   // a date alone is local midnight, never UTC midnight
  assert.equal(parseLocal('2026-10-16T10:03:28.250'), new Date(2026, 9, 16, 10, 3, 28).getTime());
  assert.equal(parseLocal('2026-11-11T09:22:35.780Z'), Date.UTC(2026, 10, 11, 9, 22, 35, 780));
  assert.equal(parseLocal('2026-11-11T09:22:35+02:00'), Date.UTC(2026, 10, 11, 7, 22, 35));
  for (const bad of ['', 'tomorrow', '2026-13-01T00:00:00', '2026-02-30T00:00:00', '2026-10-16T25:00:00', null, undefined, 42, {}]) assert.ok(Number.isNaN(parseLocal(bad)), String(bad));
});

test('dayLabel is a short local date, with the year only on request', () => {
  assert.equal(dayLabel(new Date(2026, 9, 16, 12).getTime()), 'Oct 16');
  assert.equal(dayLabel(new Date(2026, 11, 3, 12).getTime(), true), 'Dec 3, 2026');
  assert.equal(dayLabel(NaN), '');
});

test('normalizeRows: oldest first, a stable sort, unreadable times dropped and counted, only the known fields copied', () => {
  const raw = [
    { ...row(2), gpuDriverDays: 15, gpuTempC: 44, battery: 85, path: 'C:\\placeholder', extra: 'x' },
    row(0), { at: 'not a time', cpu: 1 }, null, 'string', row(1),
  ];
  const { rows: out, dropped } = normalizeRows(raw);
  assert.equal(dropped, 3);
  assert.deepEqual(out.map((r) => r.at), [at(0), at(1), at(2)]);
  const keys = Object.keys(out[2]).sort();
  assert.deepEqual(keys, ['at', 't', ...ROW_KEYS].sort());
  for (const k of ['gpuDriverDays', 'gpuTempC', 'battery', 'path', 'extra']) assert.ok(!(k in out[2]), k);
});

test('normalizeRows: a value that is not a finite non-negative number becomes a gap; the window is the last HIST_MAX', () => {
  const { rows: out } = normalizeRows([row(0, { cpu: null, ram: '60', diskFreeGB: -4, startup: NaN, temp: Infinity, pingMs: undefined })]);
  for (const k of ['cpu', 'ram', 'diskFreeGB', 'startup', 'temp', 'pingMs']) assert.equal(out[0][k], null, k);
  assert.equal(out[0].updateDays, 3);
  const many = normalizeRows(rows(HIST_MAX + 20)).rows;
  assert.equal(many.length, HIST_MAX);
  assert.equal(many[0].at, at(20));
});

test('seven charts only, in order, with no GPU series and the temp chart titled in GB', () => {
  const charts = buildCharts(rows(12));
  assert.deepEqual(charts.map((c) => c.id), ['disk', 'ram', 'cpu', 'temp', 'ping', 'startup', 'updates']);
  assert.equal(charts.length, 7);
  assert.equal(CHARTS.length, 7);
  assert.equal(charts.find((c) => c.id === 'temp').title, 'Temp files (GB)');
  assert.ok(!charts.some((c) => /gpu|driver|battery|temperature|°/i.test(c.title + c.text + c.id)));
  assert.deepEqual(charts.map((c) => c.title), ['Free disk (GB)', 'RAM in use (%)', 'CPU load (%)', 'Temp files (GB)', 'Ping (ms)', 'Startup apps', 'Days since updates']);
});

test('every chart says its sample count and date span, and the units', () => {
  const c = chart('disk', rows(12));
  assert.equal(c.n, 12);
  assert.match(c.countText, /^12 checks over 3 days$/);
  assert.equal(c.rangeText, 'Nov 1 – Nov 4');
  assert.match(c.text, /Free disk \(GB\): 100\.0 GB on Nov 1, 89\.0 GB on Nov 4; low 89\.0 GB, high 100\.0 GB — 12 checks over 3 days\./);
  const one = chart('cpu', [row(0)]);
  assert.equal(one.countText, '1 check');
  assert.match(one.text, /one reading, 20 % on Nov 1/);
  assert.equal(summaryText(rows(12)), '12 checks · Nov 1 – Nov 4 · only the last 96 checks are kept');
  assert.equal(summaryText([]), 'No checks kept yet');
});

test('a missing value is a gap: the line breaks, no zero point is ever drawn', () => {
  const raw = rows(10, (i) => (i === 4 ? { cpu: null } : {}));
  const c = chart('cpu', raw);
  assert.equal(c.missing, 1);
  assert.equal(c.points, 9);
  assert.equal(segs(c.path), 2, 'one break gives two segments');
  assert.match(c.text, /1 check with no reading/);
  assert.equal(c.note, 'A break in the line means there was no reading there, not zero.');
  // the y of every drawn point is a real reading: with a fixed 0-100 domain, 20 % sits at the same y everywhere
  const ys = [...c.path.matchAll(/[ML]?\s?([\d.]+) ([\d.]+)/g)].map((m) => +m[2]);
  const want = +(BOX.bottom - 0.2 * (BOX.bottom - BOX.top)).toFixed(1);
  assert.ok(ys.every((y) => y === want), JSON.stringify(ys));
  assert.ok(!ys.includes(BOX.bottom), 'nothing sits on the zero line');
});

test('a 0 ping and a 0 updateDays are gaps (the collector writes 0 for unknown); a 0 CPU or 0 startup is a real value', () => {
  const raw = rows(10, (i) => ({ pingMs: i === 2 || i === 3 ? 0 : 12 + i, updateDays: i === 0 ? 0 : 5, cpu: i === 1 ? 0 : 30, startup: i === 5 ? 0 : 9 }));
  const ping = chart('ping', raw), up = chart('updates', raw), cpu = chart('cpu', raw), st = chart('startup', raw);
  assert.equal(ping.missing, 2);
  assert.equal(segs(ping.path), 2);
  assert.match(ping.text, /2 checks with no reading/);
  assert.equal(ping.note, 'The collector writes 0 when it could not measure this, so a 0 is left out as a gap, not drawn as a point.');
  assert.equal(up.missing, 1);
  assert.equal(up.note, ping.note);
  assert.equal(cpu.missing, 0, 'a real 0 % load is a point');
  assert.equal(st.missing, 0, 'a real 0 startup apps is a point');
  assert.equal(chart('disk', raw).note, '');
});

test('a series that is all 0 or all missing is an honest empty chart, not a flat line at zero', () => {
  const raw = rows(6, () => ({ pingMs: 0, updateDays: undefined }));
  for (const id of ['ping', 'updates']) {
    const c = chart(id, raw);
    assert.equal(c.empty, true, id);
    assert.equal(c.path, '', id);
    assert.match(c.text, /none of the 6 checks has a reading/, id);
  }
  const none = chart('disk', []);
  assert.equal(none.empty, true);
  assert.equal(none.countText, 'no checks yet');
});

test('a lone reading between gaps is a dot (a zero-length round stroke), and nothing is smoothed', () => {
  const raw = rows(7, (i) => ({ pingMs: i === 3 ? 20 : 0 }));
  const c = chart('ping', raw);
  assert.equal(c.points, 1);
  assert.match(c.path, /^M[\d.]+ [\d.]+ h0$/);
  const straight = chart('disk', rows(5));
  assert.ok(!/[CQSTA]/.test(straight.path), 'only M, L and h commands: straight segments between real readings');
  assert.equal(segs(straight.path), 1);
});

test('x is spread by time: an irregular gap between checks shows as a wider step', () => {
  const raw = [row(0), row(1), { ...row(2), at: '2026-11-11T06:00:00' }];
  const c = chart('disk', raw);
  const xs = [...c.path.matchAll(/([\d.]+) [\d.]+/g)].map((m) => +m[1]);
  assert.equal(xs.length, 3);
  assert.ok(xs[1] - xs[0] < 10 && xs[2] - xs[1] > 250, JSON.stringify(xs));
});

test('estimate refuses with 7 rows, naming the reason in words', () => {
  const r = estimateDisk(rows(7, () => ({}), 24 * 3));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'few-checks');
  assert.match(r.text, /at least 8 free-disk readings, and there are 7/);
  assert.equal(r.checks, 7);
  assert.equal(MIN_ESTIMATE_CHECKS, 8);
});

test('estimate refuses with a 10-day span even with many checks', () => {
  const r = estimateDisk(rows(40, (i) => ({ diskFreeGB: 200 - i * 3 }), 6));   // 40 checks, 6 h apart = 9.75 days
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'short-span');
  assert.match(r.text, /at least 14 days, and these cover 9 days/);
  assert.equal(MIN_ESTIMATE_DAYS, 14);
});

test('estimate refuses when the line is flat or rising', () => {
  const flat = estimateDisk(rows(20, () => ({ diskFreeGB: 80 }), 24));
  assert.equal(flat.ok, false);
  assert.equal(flat.reason, 'not-falling');
  assert.match(flat.text, /flat or rising/);
  const up = estimateDisk(rows(20, (i) => ({ diskFreeGB: 50 + i }), 24));
  assert.equal(up.reason, 'not-falling');
  const barely = estimateDisk(rows(20, (i) => ({ diskFreeGB: 80 - i * 0.001 }), 24));   // a few MB a day: not a trend
  assert.equal(barely.reason, 'not-falling');
});

test('estimate answers in "about N days of room, if nothing changes" with enough falling data', () => {
  const r = estimateDisk(rows(30, (i) => ({ diskFreeGB: 130 - i * 2 }), 24));   // 30 daily checks, exactly 2 GB a day; 72 GB left
  assert.equal(r.ok, true);
  assert.equal(r.days, 36);
  assert.equal(r.perDayGB, 2);
  assert.equal(r.text, 'At this pace there would be about 36 days of room, if nothing changes.');
  assert.match(r.basis, /30 readings over 29 days, falling about 2 GB a day/);
  assert.ok(!/will run out|run out|going to|zero/i.test(r.text + r.basis), 'never a promise');
});

test('estimate: a huge horizon says "more than", a tiny one says "less than a day"; gaps in the disk series are ignored', () => {
  const far = estimateDisk(rows(30, (i) => ({ diskFreeGB: 900 - i * 0.05 }), 24));
  assert.equal(far.ok, true);
  assert.equal(far.text, 'At this pace there would be more than 999 days of room, if nothing changes.');
  const near = estimateDisk(rows(30, (i) => ({ diskFreeGB: 40 - i * 1.4 }), 24));
  assert.equal(near.ok, true);
  assert.equal(near.text, 'At this pace there would be less than a day of room, if nothing changes.');
  const holes = estimateDisk(rows(30, (i) => ({ diskFreeGB: i % 3 === 1 ? null : 130 - i * 2 }), 24));
  assert.equal(holes.ok, true);
  assert.equal(holes.checks, 20);
});

test('estimate from raw rows that do not parse refuses instead of throwing', () => {
  for (const bad of [null, undefined, [], [{}], 'x']) assert.equal(estimateDisk(bad).ok, false);
});

test('buildChart tolerates junk input', () => {
  assert.equal(buildChart(CHARTS[0], null).empty, true);
  assert.equal(buildCharts('nope').length, 7);
});
