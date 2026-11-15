// node --test dashboard-v5/src/live/build-stamp.test.mjs
// The stamp's format, and that the latest batch-done record names the stamp that shipped. The second check only bites once a record for
// THIS stamp's batch exists (a done entry in docs/sync/HANDOFF.md, or the batch's line in CLAUDE.md): until then, and for every later
// unrelated entry, it has nothing to say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_STAMP } from './build-stamp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FORMAT = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\.batch[1-9]\d*$/;

/** the batch number inside a stamp ('2026-11-14.batch7' -> 7), or null */
export const batchOf = (stamp) => { const m = /^\d{4}-\d{2}-\d{2}\.batch([1-9]\d*)$/.exec(String(stamp || '')); return m ? Number(m[1]) : null; };

/** the HANDOFF entries (text from one "## " heading to the next), in the order written */
export const entriesOf = (handoff) => String(handoff || '').split(/\n(?=## )/).filter((e) => e.startsWith('## '));

/** the entry that closes batch N: its heading says "BATCH N DONE" (any case). Never an ANNOUNCE or PLANNED entry, never another batch's. */
export function doneEntryFor(handoff, n) {
  const re = new RegExp('^##[^\\n]*\\bbatch\\s+' + n + '\\s+done\\b', 'i');
  return entriesOf(handoff).find((e) => re.test(e)) || null;
}

/** CLAUDE.md's facts line for batch N: a bullet that starts "- Batch N" (the shape every batch line has) */
export function factsLineFor(claudeMd, n) {
  const re = new RegExp('^- Batch\\s+' + n + '\\b[^\\n]*', 'im');
  const m = re.exec(String(claudeMd || ''));
  return m ? m[0] : null;
}

/**
 * -> { checked, ok, why }. checked=false when no record of that batch exists yet (nothing to hold the stamp against).
 * Otherwise ok means at least one of the records that exist names the stamp.
 */
export function stampCheck(stamp, handoff, claudeMd) {
  const n = batchOf(stamp);
  if (n === null) return { checked: true, ok: false, why: 'the stamp is not YYYY-MM-DD.batchN' };
  const records = [doneEntryFor(handoff, n), factsLineFor(claudeMd, n)].filter(Boolean);
  if (!records.length) return { checked: false, ok: true, why: 'no record of batch ' + n + ' yet' };
  const named = records.some((r) => r.includes(stamp));
  return { checked: true, ok: named, why: named ? '' : 'batch ' + n + ' has a done record that does not name ' + stamp + ' (bump or quote the stamp)' };
}

test('the stamp is YYYY-MM-DD.batchN, with a real calendar date', () => {
  assert.match(BUILD_STAMP, FORMAT);
  const [d] = BUILD_STAMP.split('.');
  const t = new Date(d + 'T00:00:00Z');
  assert.equal(t.toISOString().slice(0, 10), d, 'the date part is a real day');
  assert.ok(batchOf(BUILD_STAMP) >= 7, 'batch 7 shipped the stamp, so it never names an earlier batch');
});

test('the format rule refuses the near misses', () => {
  for (const bad of ['', '2026-11-14', '2026-11-14.batch', '2026-11-14.batch0', '2026-13-01.batch7', '26-11-14.batch7', '2026-11-14.Batch7', '2026-11-14.batch7 ', 'v1.2.3', '2026-11-14.batch07']) assert.doesNotMatch(bad, FORMAT, JSON.stringify(bad));
  for (const good of ['2026-11-14.batch7', '2027-01-02.batch12']) assert.match(good, FORMAT, good);
});

test('doneEntryFor finds the done entry of exactly that batch, not announcements, plans or other batches', () => {
  const h = [
    '# Handoff', '---',
    '## 2026-11-20 · FROM frontend (BATCH 8 DONE: later) · main @ bbb\nDONE: later stuff 2026-11-20.batch8',
    '## 2026-11-14 · FROM frontend (ANNOUNCE: batch 7, a plan) · main @ aaa\nDONE: nothing yet',
    '## 2026-11-14 · FROM frontend (batch 7 dish 3 DONE: one dish) · main @ aaa\nDONE: one dish',
    '## 2026-11-14 · FROM frontend (BATCH 7 DONE: all dishes) · main @ aaa\nDONE: all dishes, stamp 2026-11-14.batch7',
    '## 2026-11-14 · FROM frontend (BATCH 70 DONE: not seven) · main @ aaa\nDONE: x',
  ].join('\n\n');
  const e = doneEntryFor(h, 7);
  assert.ok(e && e.includes('all dishes') && e.includes('2026-11-14.batch7'));
  assert.ok(doneEntryFor(h, 8).includes('later stuff'));
  assert.equal(doneEntryFor(h, 6), null, 'a batch with no done entry has none');
  assert.equal(doneEntryFor(h, 9), null);
  assert.equal(doneEntryFor('', 7), null);
});

test('factsLineFor finds the batch line and nothing else', () => {
  const c = '- Batch 6 (2026-11-14; plan x): reach.\n- Batch 7 (2026-11-14; plan y): the new card, stamp 2026-11-14.batch7.\n- Batch 70 (z)';
  assert.ok(factsLineFor(c, 7).includes('stamp 2026-11-14.batch7'));
  assert.ok(factsLineFor(c, 6).startsWith('- Batch 6'));
  assert.equal(factsLineFor(c, 8), null);
  assert.equal(factsLineFor('', 7), null);
});

test('stampCheck: nothing to hold it against until a record exists, then the record must name the stamp', () => {
  const S = '2026-11-14.batch7';
  const none = stampCheck(S, '## 2026-11-14 · FROM frontend (ANNOUNCE: batch 7) · main\nx', '- Batch 6 (a)');
  assert.deepEqual([none.checked, none.ok], [false, true]);
  const later = stampCheck(S, '## 2026-12-01 · FROM frontend (BATCH 8 DONE: later) · main\nDONE: 2026-12-01.batch8', '- Batch 8 (later)');
  assert.deepEqual([later.checked, later.ok], [false, true], 'a later batch done entry does not fail an earlier stamp');
  const good = stampCheck(S, '## 2026-11-14 · FROM frontend (BATCH 7 DONE: x) · main\nstamp 2026-11-14.batch7', '- Batch 7 (no stamp here)');
  assert.deepEqual([good.checked, good.ok], [true, true], 'one record naming the stamp is enough');
  const viaClaude = stampCheck(S, '## 2026-11-14 · FROM frontend (BATCH 7 DONE: x) · main\nno stamp quoted', '- Batch 7 (stamp 2026-11-14.batch7)');
  assert.equal(viaClaude.ok, true);
  const bad = stampCheck(S, '## 2026-11-14 · FROM frontend (BATCH 7 DONE: x) · main\nno stamp quoted', '- Batch 7 (nor here)');
  assert.deepEqual([bad.checked, bad.ok], [true, false]);
  assert.match(bad.why, /bump or quote the stamp/);
  assert.equal(stampCheck('nonsense', '', '').ok, false);
});

test('the real HANDOFF and CLAUDE.md name the shipped stamp once a record of its batch exists', () => {
  const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return ''; } };
  const r = stampCheck(BUILD_STAMP, read('docs/sync/HANDOFF.md'), read('CLAUDE.md'));
  assert.equal(r.ok, true, r.why);
});

test('the stamp file is one constant and nothing else (no import, no IO)', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('./build-stamp.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.equal((src.match(/^export\s/gm) || []).length, 1);
});
