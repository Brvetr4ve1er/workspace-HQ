// node --test dashboard-v5/src/logic/cosmos-polish.test.mjs
// Pure helpers for the Cosmos polish dish: placeholder fixtures only, no DOM, no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from './cosmos-polish.mjs';

const {
  selectModel, nextBrokenLevel, applyFailures, cardImage, createFailureBatcher, lbSizeModel, lbFailedModel, escapeAction, lbDraftOpen,
  ABOVE_LIGHTBOX, isFileDrag, dragStep, phaseRows, PHASE_ORDER, reportExtraLines, skipReasonWords, FAILED_TEXT, LB_FAILED_TEXT,
} = P;

// ---- select models -----------------------------------------------------------------------------------------------------
test('selectModel carries the selected value, one selected option, and onChange picks like the chip did', () => {
  const picked = [];
  const m = selectModel(['newest', 'oldest', 'name'], { newest: 'Newest', oldest: 'Oldest', name: 'Name' }, 'oldest', (v) => picked.push(v));
  assert.equal(m.value, 'oldest');
  assert.deepEqual(m.options.map((o) => [o.value, o.label, o.selected]), [['newest', 'Newest', false], ['oldest', 'Oldest', true], ['name', 'Name', false]]);
  assert.deepEqual(m.sel, { newest: false, oldest: true, name: false });
  m.onChange({ target: { value: 'name' } });
  m.onChange('newest');
  m.onChange({ target: { value: 'sideways' } });   // not a mode: ignored
  m.onChange(undefined);
  assert.deepEqual(picked, ['name', 'newest']);
});
test('selectModel with an unknown current value selects the first mode; with no modes it is empty and harmless', () => {
  assert.equal(selectModel(['a', 'b'], { a: 'A' }, 'zzz', () => {}).value, 'a');
  assert.equal(selectModel(['a', 'b'], { a: 'A' }, 'a', () => {}).options[1].label, 'b', 'a mode without a label reads as itself');
  const e = selectModel(undefined, undefined, 'x', undefined);
  assert.deepEqual([e.value, e.options.length], ['', 0]);
  assert.doesNotThrow(() => e.onChange('x'));
  assert.equal(P.sortSelect, selectModel);
  assert.equal(P.groupSelect, selectModel);
});

// ---- a picture that will not load ----------------------------------------------------------------------------------------
const W = { id: 'alpha-site-001', thumbUrl: 'file:///placeholder/t1.jpg', url: 'file:///placeholder/o1.png' };
test('card failure sequence: thumbnail -> original -> failed, with the title staying and the words shown', () => {
  assert.equal(nextBrokenLevel(W, undefined), 'thumb');
  assert.equal(nextBrokenLevel(W, 'thumb'), 'failed');
  assert.equal(nextBrokenLevel(W, 'failed'), 'failed');
  const a = cardImage(W, undefined), b = cardImage(W, 'thumb'), c = cardImage(W, 'failed');
  assert.deepEqual([a.src, a.failed, a.thumbFailed], [W.thumbUrl, false, false]);
  assert.deepEqual([b.src, b.failed, b.thumbFailed], [W.url, false, true]);
  assert.deepEqual([c.src, c.hasSrc, c.failed, c.failedText], ['', false, true, FAILED_TEXT]);
  assert.equal(FAILED_TEXT, 'could not load');
});
test('a card with no separate original, or a video, fails at once instead of swapping to something that cannot load', () => {
  const only = { id: 'a', thumbUrl: 'file:///placeholder/t.jpg' };
  const same = { id: 'b', thumbUrl: 'file:///placeholder/x.jpg', url: 'file:///placeholder/x.jpg' };
  const video = { id: 'c', thumbUrl: 'file:///placeholder/t.jpg', url: 'file:///placeholder/v.mp4', video: true };
  const noThumb = { id: 'd', url: 'file:///placeholder/o.png' };
  for (const w of [only, same, video, noThumb]) assert.equal(nextBrokenLevel(w, undefined), 'failed', w.id);
  assert.equal(cardImage(noThumb, undefined).src, noThumb.url, 'no thumbnail: the original is what the card shows');
  assert.equal(cardImage(video, 'thumb').failed, true, 'a video never swaps');
  assert.equal(cardImage({}, undefined).hasSrc, false);
  assert.equal(cardImage(null, undefined).failed, false);
});
test('applyFailures returns a new object only when something moved, ignores unknown ids and counts one id once', () => {
  const lib = { 'alpha-site-001': W, 'alpha-site-002': { id: 'alpha-site-002', thumbUrl: 'file:///placeholder/t2.jpg' } };
  const look = (id) => lib[id] || null;
  const prev = {};
  const n1 = applyFailures(prev, ['alpha-site-001', 'alpha-site-002', 'alpha-site-001', 'nope'], look);
  assert.notEqual(n1, prev);
  assert.deepEqual(n1, { 'alpha-site-001': 'thumb', 'alpha-site-002': 'failed' });
  assert.deepEqual(prev, {}, 'the old object is never mutated');
  assert.equal(applyFailures(n1, ['nope'], look), n1, 'nothing new keeps the identity (no re-render)');
  assert.equal(applyFailures(n1, ['alpha-site-002'], look), n1);
  assert.deepEqual(applyFailures(n1, ['alpha-site-001'], look), { 'alpha-site-001': 'failed', 'alpha-site-002': 'failed' });
  assert.deepEqual(applyFailures(undefined, [], look), {});
});

// a clock-free batcher harness
function harness(delayMs) {
  const timers = new Map(); let nextId = 1; const flushed = [];
  const b = createFailureBatcher({ onFlush: (ids) => flushed.push(ids), delayMs, setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; }, clearTimer: (id) => timers.delete(id) });
  const fire = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  return { b, timers, flushed, fire };
}
test('1,000 failure reports coalesce into ONE flush and arm ONE timer at 100 ms', () => {
  const h = harness();
  for (let i = 0; i < 1000; i++) { h.b.report('alpha-site-' + String(i).padStart(3, '0')); h.b.report('alpha-site-000'); }
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 100);
  assert.equal(h.b.size, 1000, 'duplicates of one id count once');
  assert.equal(h.flushed.length, 0, 'nothing flushed before the timer');
  h.fire();
  assert.equal(h.flushed.length, 1);
  assert.equal(h.flushed[0].length, 1000);
  assert.equal(h.b.size, 0);
  assert.equal(h.b.armed, false);
  h.fire();
  assert.equal(h.flushed.length, 1, 'no second flush');
  h.b.report('alpha-site-001'); h.fire();
  assert.equal(h.flushed.length, 2, 'a later report starts a fresh batch');
  assert.equal(h.b.flushes, 2);
});
test('flushNow is the selftest hook: synchronous, once, a no-op when empty', () => {
  const h = harness();
  assert.equal(h.b.flushNow(), 0);
  h.b.report('a'); h.b.report('b');
  assert.equal(h.b.flushNow(), 2);
  assert.deepEqual(h.flushed, [['a', 'b']]);
  assert.equal(h.timers.size, 0, 'the timer was cancelled by the flush');
  assert.equal(h.b.flushNow(), 0);
});
test('clear (library switch) drops pending ids and the timer but the batcher keeps working', () => {
  const h = harness();
  h.b.report('a'); h.b.clear();
  assert.equal(h.timers.size, 0); assert.equal(h.b.size, 0);
  h.fire(); assert.equal(h.flushed.length, 0);
  h.b.report('b'); h.b.flushNow();
  assert.deepEqual(h.flushed, [['b']]);
});
test('dispose (unmount): a report or a flush afterwards does nothing, and a timer already armed is cancelled', () => {
  const h = harness();
  h.b.report('a');
  h.b.dispose();
  assert.equal(h.timers.size, 0);
  assert.equal(h.b.disposed, true);
  h.b.report('b');
  assert.equal(h.b.size, 0);
  assert.equal(h.b.flushNow(), 0);
  h.fire();
  assert.equal(h.flushed.length, 0);
});
test('a timer that fires after dispose (the clearTimer was lost) still flushes nothing', () => {
  let fn = null; const flushed = [];
  const b = createFailureBatcher({ onFlush: (i) => flushed.push(i), setTimer: (f) => { fn = f; return 1; }, clearTimer: () => {} });
  b.report('a'); b.dispose(); fn();
  assert.deepEqual(flushed, []);
});
test('the batcher defaults to the global timers and ignores empty ids', async () => {
  const flushed = [];
  const b = createFailureBatcher({ onFlush: (i) => flushed.push(i), delayMs: 5 });
  b.report(''); b.report(null); b.report(undefined);
  assert.equal(b.size, 0);
  b.report('a');
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(flushed, [['a']]);
});

// ---- lightbox ---------------------------------------------------------------------------------------------------------
test('lbSizeModel: fit by default, the label names the action, toggle sets the other mode', () => {
  const calls = [];
  const fit = lbSizeModel(undefined, (m) => calls.push(m)), act = lbSizeModel('actual', (m) => calls.push(m));
  assert.deepEqual([fit.mode, fit.label, fit.pressed], ['fit', 'Actual size', 'false']);
  assert.deepEqual([act.mode, act.label, act.pressed], ['actual', 'Fit', 'true']);
  fit.toggle(); act.toggle();
  assert.deepEqual(calls, ['actual', 'fit']);
  assert.equal(lbSizeModel('garbage').mode, 'fit');
  assert.doesNotThrow(() => lbSizeModel('fit').toggle());
});
test('lbFailedModel says it in words, over the thumbnail when there is one', () => {
  assert.deepEqual(lbFailedModel(false, true), { lbFailed: false, lbFailedText: '' });
  assert.equal(lbFailedModel(true, false).lbFailedText, LB_FAILED_TEXT);
  assert.equal(lbFailedModel(true, true).lbFailedText, 'Could not open the original: showing the thumbnail');
  assert.ok(lbFailedModel(true, true).lbFailedText.startsWith('Could not open the original'));
});

// ---- Escape ----------------------------------------------------------------------------------------------------------------
test('Escape with a title draft open and the lightbox topmost cancels the draft and keeps the lightbox', () => {
  const S = { cosLb: { id: 'alpha-site-001', edit: 'title', draft: 'half typed', trashAsk: false } };
  const a = escapeAction(S);
  assert.equal(a.handled, true);
  assert.deepEqual(a.patch, { cosLb: { id: 'alpha-site-001', edit: null, trashAsk: false } });
  assert.equal(a.patch.cosLb.draft, undefined);
  assert.equal(S.cosLb.edit, 'title', 'the input is never mutated');
  // the second Escape: no draft, not handled, so closeTop closes the lightbox
  assert.deepEqual(escapeAction({ cosLb: a.patch.cosLb }), { handled: false, patch: null });
});
test('a tag draft counts as a draft too, and a Recycle Bin question stays as it was', () => {
  const a = escapeAction({ cosLb: { id: 'x', edit: null, tagDraft: 'sky', trashAsk: true } });
  assert.equal(a.handled, true);
  assert.deepEqual(a.patch, { cosLb: { id: 'x', edit: null, trashAsk: true } });
  assert.equal(lbDraftOpen({ id: 'x', edit: null, tagDraft: '' }), false, 'an empty tag box is not a draft');
  assert.equal(lbDraftOpen({ id: 'x', edit: 'tags' }), true);
});
test('Escape with a draft open AND anything above the lightbox: not handled, so that overlay closes first and the draft stays', () => {
  for (const k of ABOVE_LIGHTBOX) {
    const S = { cosLb: { id: 'x', edit: 'title', draft: 'd' }, [k]: true };
    assert.deepEqual(escapeAction(S), { handled: false, patch: null }, k);
  }
  assert.ok(ABOVE_LIGHTBOX.includes('paletteOpen') && ABOVE_LIGHTBOX.includes('settingsOpen') && ABOVE_LIGHTBOX.includes('cosReportOpen') && ABOVE_LIGHTBOX.includes('cosIdx'));
  assert.equal(ABOVE_LIGHTBOX.length, 12);
});
test('Escape with no draft, no lightbox or junk state is not handled (closeTop runs unchanged)', () => {
  assert.deepEqual(escapeAction({ cosLb: { id: 'x', edit: null, trashAsk: false } }), { handled: false, patch: null });
  assert.deepEqual(escapeAction({ cosLb: null }), { handled: false, patch: null });
  assert.deepEqual(escapeAction({}), { handled: false, patch: null });
  assert.deepEqual(escapeAction(null), { handled: false, patch: null });
  assert.deepEqual(escapeAction(undefined), { handled: false, patch: null });
});
test('ABOVE_LIGHTBOX is exactly the flags app.js closeTop lists before cosLb (when that file is present)', () => {
  let src = '';
  try { src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8'); } catch { return; }
  const m = /const order = \[([^\]]*)\]/.exec(src);
  if (!m) return;
  const order = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  const before = order.slice(0, order.indexOf('cosLb'));
  assert.deepEqual([...ABOVE_LIGHTBOX].sort(), before.sort(), 'closeTop order drifted from the polish list');
});

// ---- drag ------------------------------------------------------------------------------------------------------------------
const FILES = { types: ['Files'] }, TEXT = { types: ['text/plain'] };
test('dragStep counts enters and leaves so nested children do not flicker, and a drop or reset zeroes it', () => {
  let s = dragStep(0, 'enter', FILES);
  assert.deepEqual(s, { count: 1, on: true });
  s = dragStep(s.count, 'enter', FILES);   // a child element
  assert.deepEqual(s, { count: 2, on: true });
  s = dragStep(s.count, 'leave', FILES);   // leaving the child
  assert.deepEqual(s, { count: 1, on: true });
  s = dragStep(s.count, 'leave', FILES);
  assert.deepEqual(s, { count: 0, on: false });
  assert.deepEqual(dragStep(0, 'leave', FILES), { count: 0, on: false }, 'never below zero');
  assert.deepEqual(dragStep(3, 'drop', FILES), { count: 0, on: false });
  assert.deepEqual(dragStep(3, 'reset'), { count: 0, on: false });
  assert.deepEqual(dragStep(NaN, 'enter', FILES), { count: 1, on: true });
});
test('a dragged piece of text, or no dataTransfer, never lights the host', () => {
  assert.deepEqual(dragStep(0, 'enter', TEXT), { count: 0, on: false });
  assert.deepEqual(dragStep(0, 'enter', undefined), { count: 0, on: false });
  assert.deepEqual(dragStep(0, 'enter', {}), { count: 0, on: false });
  assert.equal(isFileDrag({ types: { contains: (t) => t === 'Files' } }), true);
  assert.equal(isFileDrag({ types: { contains: () => { throw new Error('x'); }, 0: 'Files', length: 1 } }), true);
  assert.equal(isFileDrag({ types: ['text/uri-list'] }), false);
});

// ---- index phases ----------------------------------------------------------------------------------------------------------
test('phaseRows walks done -> running -> waiting in the engine order, for each phase', () => {
  assert.deepEqual(PHASE_ORDER, ['walk', 'thumbs', 'hashes', 'dupes']);
  const states = (ix) => phaseRows(ix).map((r) => r.state).join(',');
  assert.equal(states({ phase: 'walk', done: 10, total: 100 }), 'running,waiting,waiting,waiting');
  assert.equal(states({ phase: 'thumbs', done: 40, total: 100 }), 'done,running,waiting,waiting');
  assert.equal(states({ phase: 'hashes', done: 70, total: 100 }), 'done,done,running,waiting');
  assert.equal(states({ phase: 'dupes', done: 5, total: 9 }), 'done,done,done,running');
  const rows = phaseRows({ phase: 'thumbs', done: 1240, total: 5000 });
  assert.deepEqual(rows.map((r) => r.text), ['done', '1,240 / 5,000', 'waiting', 'waiting']);
  assert.deepEqual(rows.map((r) => r.id), PHASE_ORDER);
  assert.deepEqual(rows.map((r) => r.label), ['Reading the folder', 'Thumbnails', 'File hashes', 'Duplicates']);
});
test('phaseRows: no run, or a phase the engine does not have, gives no rows; a run without a total still reads honestly', () => {
  assert.deepEqual(phaseRows(null), []);
  assert.deepEqual(phaseRows(undefined), []);
  assert.deepEqual(phaseRows('walk'), []);
  assert.deepEqual(phaseRows({ phase: 'mystery', done: 1, total: 2 }), []);
  assert.equal(phaseRows({ phase: 'walk', done: 0, total: 0 })[0].text, 'starting');
  assert.equal(phaseRows({ phase: 'walk', done: 37, total: 0 })[0].text, '37');
  assert.equal(phaseRows({ phase: 'walk' })[0].text, 'starting');
});

// ---- import report ---------------------------------------------------------------------------------------------------------
test('reportExtraLines shows only the numbers main sent, in words', () => {
  const lines = reportExtraLines({ seeded: 12, rekeyed: 3, skippedCount: 4, skipped: [{ id: 'a', reason: 'id-known' }, { id: 'b', reason: 'id-known' }, { id: null, reason: 'no-id' }, { id: 'c', reason: 'bad-path' }], notMatchedCount: 2, notMatched: [{ reason: 'referenced' }, { reason: 'id-in-use' }], manifest: 'used' });
  assert.deepEqual(lines.map((l) => l.label), ['Matched to old ids', 'Re-keyed to the old ids', 'Skipped from the manifest', 'Not matched', 'Manifest']);
  assert.equal(lines[0].value, '12');
  assert.equal(lines[1].value, '3');
  assert.equal(lines[2].value, '4 entries: that id is already used here (2); it has no id; its path is not a real folder path');
  assert.equal(lines[3].value, '2 files: the file keeps the id your curation already points at; the old id is already taken by another file');
  assert.equal(lines[4].value, 'Used');
});
test('a report with skippedCount 0 adds no skipped line, and absent fields add nothing at all', () => {
  const a = reportExtraLines({ seeded: 0, rekeyed: 0, skippedCount: 0, skipped: [], notMatchedCount: 0, manifest: 'skipped' });
  assert.deepEqual(a.map((l) => l.label), ['Matched to old ids', 'Re-keyed to the old ids', 'Manifest']);
  assert.equal(a[0].value, '0', 'a present zero is a real answer');
  assert.equal(a[2].value, 'None chosen: no ids were taken over');
  assert.deepEqual(reportExtraLines({ clusters: 3, favorites: 25 }), []);
  assert.deepEqual(reportExtraLines({}), []);
  assert.deepEqual(reportExtraLines(null), []);
  assert.deepEqual(reportExtraLines('x'), []);
  assert.deepEqual(reportExtraLines({ seeded: 'many', rekeyed: NaN, manifest: 'bogus' }), [], 'junk is not a number and not a state');
});
test('skipped and not-matched counts fall back to the listed arrays; singular words; unreadable manifest in words', () => {
  const l = reportExtraLines({ skipped: [{ reason: 'no-path' }], notMatched: [{ reason: 'referenced' }], manifest: 'unreadable' });
  assert.equal(l.find((x) => x.label === 'Skipped from the manifest').value, '1 entry: it has no file path');
  assert.equal(l.find((x) => x.label === 'Not matched').value, '1 file: the file keeps the id your curation already points at');
  assert.equal(l.find((x) => x.label === 'Manifest').value, 'Could not be read: no ids were taken over');
  const big = reportExtraLines({ skippedCount: 1500, skipped: [] });
  assert.equal(big[0].value, '1,500 entries', 'no listed reasons: only the count, never an invented reason');
});
test('skipReasonWords names at most 3 distinct reasons and an unknown reason in neutral words', () => {
  const s = ['bad-path', 'no-id', 'no-path', 'path-known', 'id-known'].map((reason) => ({ reason }));
  assert.equal(skipReasonWords(s).length, 3);
  assert.equal(skipReasonWords(s, 0).length, 0);
  assert.deepEqual(skipReasonWords([{ reason: 'weird' }, { reason: '' }, null]), ['another reason']);
  assert.deepEqual(skipReasonWords(undefined), []);
});

// ---- the module itself -----------------------------------------------------------------------------------------------------
test('the module is pure: no DOM, no network, no owner path, no Lorem or TODO', () => {
  const src = fs.readFileSync(new URL('./cosmos-polish.mjs', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const re of [/\bdocument\b/, /\bwindow\b/, /\bfetch\(/, /require\(/, /from 'node:/, /ROG|Users\\|C:\/Users|Pictures/, /Lorem|TODO/i]) assert.ok(!re.test(code), String(re));
  assert.deepEqual(Object.keys(P).sort(), ['ABOVE_LIGHTBOX', 'FAILED_TEXT', 'LB_FAILED_TEXT', 'PHASE_LABELS', 'PHASE_ORDER', 'applyFailures', 'cardImage', 'createFailureBatcher', 'dragStep', 'escapeAction', 'groupSelect', 'isFileDrag', 'lbDraftOpen', 'lbFailedModel', 'lbSizeModel', 'nextBrokenLevel', 'phaseRows', 'reportExtraLines', 'selectModel', 'skipReasonWords', 'sortSelect']);
});
