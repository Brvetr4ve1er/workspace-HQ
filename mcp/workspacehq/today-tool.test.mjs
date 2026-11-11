// hq_today reader (mcp/workspacehq/today-tool.mjs): counts only, age stated, an app-closed note, another day answers an error that
// names the app, and no name or domain in any answer. Placeholder data in temp folders (public repo).
//   node --test mcp/workspacehq/today-tool.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readToday, TOOL_NAME, DESCRIPTION, INPUT_SCHEMA, STALE_MINUTES } from './today-tool.mjs';
import { localDayKey } from '../../dashboard/day-core.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-today-mcp-'));
const NOW = new Date('2026-11-10T15:00:00.000Z');
const localKey = (d) => localDayKey(d.getTime(), -d.getTimezoneOffset());
const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const COUNTS = { claudeBlocks: 50, claudeProjects: 3, commits: 6, asleepMinutes: 150, browserMinutes: null };
function setup(over = {}) {
  const dataDir = tmp();
  const generatedAt = over.generatedAt || new Date(NOW.getTime() - 4 * 60000).toISOString();
  const doc = over.doc === undefined ? { v: 1, day: localKey(NOW), generatedAt, counts: COUNTS, ...(over.extra || {}) } : over.doc;
  if (doc !== null) fs.writeFileSync(path.join(dataDir, 'today.json'), typeof doc === 'string' ? doc : JSON.stringify(doc));
  return { dataDir, generatedAt };
}
const snap = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);

test('today as counts, with the sentence, the time it is as of, and its age', () => {
  const { dataDir, generatedAt } = setup();
  const r = readToday({ dataDir, now: NOW });
  assert.deepEqual(r.counts, COUNTS);
  assert.equal(r.day, localKey(NOW));
  assert.equal(r.isToday, true);
  assert.equal(r.asOf, 'as of ' + hhmm(new Date(generatedAt)));
  assert.match(r.asOf, /^as of \d\d:\d\d$/);
  assert.equal(r.ageMinutes, 4);
  assert.equal(r.appLikelyOpen, true);
  assert.equal(r.summary, '50 five-minute blocks with Claude across 3 projects, 6 commits, PC asleep 2 h 30 m');
  assert.match(r.note, /five minutes with at least one turn/);
  assert.doesNotMatch(JSON.stringify(r), /hours? (worked|of work)/i);
});

test('counts only: extra fields in the file, a name, a path or a domain never come back, and every count is a number or null', () => {
  const { dataDir } = setup({ extra: { project: 'alpha-site', path: 'C:/work/alpha-site', domain: 'secret.example', subject: 'fix the thing', lanes: [{ ref: 'code:alpha' }] },
    doc: { v: 1, day: localKey(NOW), generatedAt: new Date(NOW.getTime() - 60000).toISOString(), counts: { ...COUNTS, project: 'alpha-site', domain: 'secret.example', claudeProjects: '3', commits: -2 }, project: 'alpha-site' } });
  const r = readToday({ dataDir, now: NOW });
  const all = JSON.stringify(r);
  for (const s of ['alpha', 'secret', 'example', 'C:/', 'fix the thing', 'code:']) assert.ok(!all.includes(s), 'leaked ' + s);
  assert.deepEqual(Object.keys(r.counts), ['claudeBlocks', 'claudeProjects', 'commits', 'asleepMinutes', 'browserMinutes']);
  assert.equal(r.counts.claudeProjects, null);
  assert.equal(r.counts.commits, null);
  for (const v of Object.values(r.counts)) assert.ok(v === null || Number.isInteger(v));
  assert.match(r.summary, /commits unavailable/);
});

test('with the app closed the last file answers with its age and says so', () => {
  const old = new Date(NOW.getTime() - 3 * 3600000).toISOString();
  const { dataDir, generatedAt } = setup({ generatedAt: old });
  const r = readToday({ dataDir, now: NOW });
  assert.equal(r.appLikelyOpen, false);
  assert.equal(r.ageMinutes, 180);
  assert.match(r.note, /WorkspaceHQ looks closed \(the file is 3 h old\)/);
  assert.ok(r.note.includes('as of ' + hhmm(new Date(generatedAt))));
  assert.deepEqual(r.counts, COUNTS, 'the last answer is still given');
  const mid = readToday({ dataDir: setup({ generatedAt: new Date(NOW.getTime() - 45 * 60000).toISOString() }).dataDir, now: NOW });
  assert.match(mid.note, /45 min old/);
  const edge = readToday({ dataDir: setup({ generatedAt: new Date(NOW.getTime() - STALE_MINUTES * 60000).toISOString() }).dataDir, now: NOW });
  assert.equal(edge.appLikelyOpen, true);
});

test('a file from an earlier day is labelled with its day and never passed off as today', () => {
  const { dataDir } = setup({ doc: { v: 1, day: '2026-11-08', generatedAt: new Date(NOW.getTime() - 60000).toISOString(), counts: COUNTS } });
  const r = readToday({ dataDir, now: NOW });
  assert.equal(r.isToday, false);
  assert.equal(r.day, '2026-11-08');
  assert.match(r.note, /answer for 2026-11-08, not today/);
});

test('a day other than today answers an error that names the app; a bad daysAgo is refused', () => {
  const { dataDir } = setup();
  for (const d of [1, 3, 6]) { const r = readToday({ dataDir, daysAgo: d, now: NOW }); assert.match(r.error, /open WorkspaceHQ/); assert.equal(r.counts, undefined); }
  for (const d of [-1, 7, 1.5, '0', null, NaN]) assert.match(readToday({ dataDir, daysAgo: d, now: NOW }).error, /whole number from 0 to 6/, String(d));
  assert.equal(readToday({ dataDir, daysAgo: 0, now: NOW }).day, localKey(NOW));
});

test('honest errors: no file yet, a corrupt file, an unknown version, a missing time; a missing folder too', () => {
  assert.match(readToday({ dataDir: setup({ doc: null }).dataDir, now: NOW }).error, /does not exist yet: open WorkspaceHQ/);
  assert.match(readToday({ dataDir: path.join(tmp(), 'nope'), now: NOW }).error, /does not exist yet/);
  assert.match(readToday({ dataDir: setup({ doc: '{ nope' }).dataDir, now: NOW }).error, /unreadable/);
  assert.match(readToday({ dataDir: setup({ doc: { v: 2, day: localKey(NOW), generatedAt: NOW.toISOString(), counts: COUNTS } }).dataDir, now: NOW }).error, /not in a shape/);
  assert.match(readToday({ dataDir: setup({ doc: { v: 1, day: 'today', generatedAt: NOW.toISOString(), counts: COUNTS } }).dataDir, now: NOW }).error, /not in a shape/);
  assert.match(readToday({ dataDir: setup({ doc: { v: 1, day: localKey(NOW), counts: COUNTS } }).dataDir, now: NOW }).error, /not in a shape/);
  assert.match(readToday({ dataDir: setup({ doc: [1] }).dataDir, now: NOW }).error, /not in a shape/);
});

test('it never writes, renames or quarantines anything, even when the file is corrupt', () => {
  for (const doc of [undefined, '{ nope', null]) {
    const { dataDir } = setup({ doc });
    const before = snap(dataDir);
    readToday({ dataDir, now: NOW }); readToday({ dataDir, daysAgo: 2, now: NOW });
    assert.deepEqual(snap(dataDir), before);
  }
  const src = fs.readFileSync(new URL('./today-tool.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /writeFile|renameSync|unlinkSync|rmSync|mkdirSync|appendFile|copyFile/);
});

test('the tool definition: its name, a schema that allows only daysAgo 0..6, and a description that promises counts only', () => {
  assert.equal(TOOL_NAME, 'hq_today');
  assert.deepEqual(Object.keys(INPUT_SCHEMA.properties), ['daysAgo']);
  assert.equal(INPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual([INPUT_SCHEMA.properties.daysAgo.minimum, INPUT_SCHEMA.properties.daysAgo.maximum], [0, 6]);
  assert.match(DESCRIPTION, /never returns a project name, website, commit message or path/i);
  assert.match(DESCRIPTION, /Read-only/);
  assert.doesNotMatch(DESCRIPTION, /hours? (worked|of work)/i);
});
