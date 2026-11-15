// Settings > Memory card, renderer side: the logic mixin, the vals, the template and the selftest states, in plain Node with a rigged `this` and a fake
// window.hq.memory. Placeholder data only - the repo is public.
//   node --test dashboard-v5/src/vals/memory-card.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memoryCardLogic, mcdInit, mcdLayerOn, cleanRead, MCD_OFFLINE, MCD_NOTE } from '../logic/memory-card.js';
import { cheatsVals } from './cheats.js';   // batch 7 (cheat codes): the codes slot now holds the found list, bound to chtv
import { memoryCardVals, humanBytes, humanAge, buildBlocks, slotBlock, snapshotBlock, BAR_W } from './memory-card.js';
import { inventedMemoryRead, memoryStates, MEMORY_OFFLINE_ROWS } from '../selftest-memory-card.mjs';
import { EXPECT, SNAPSHOT_EXPECT, FILL_EXPECT } from '../../tools/cdp-memory-card.mjs';
import { resolve } from '../dc/runtime.js';
import tpl from '../tpl/memory-card.tpl.js';

process.env.TZ = 'UTC';
const tick = () => new Promise((r) => setTimeout(r, 15));
const AT = Date.parse('2026-11-14T12:00:00.000Z');
const LAYER = { on: true };

function rig(o = {}) {
  const reads = [];
  const memory = o.noMemory ? undefined : {
    read: async () => { reads.push(1); if (o.fail) throw new Error(o.fail); return o.answer === undefined ? inventedMemoryRead() : o.answer; },
  };
  const self = Object.assign(Object.create(memoryCardLogic), {
    state: { tab: 'home', route: null, sub: {}, settingsOpen: true, consoleLayer: LAYER, ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    hq: { ...(memory ? { memory } : {}) },
  });
  const vals = () => memoryCardVals.call(self, { S: self.state }).mcdv;
  return { self, reads, vals };
}

test('ONE top-level key: the surface returns { mcdv } and nothing else', () => {
  const { self } = rig();
  assert.deepEqual(Object.keys(memoryCardVals.call(self, { S: self.state })), ['mcdv']);
});

// ---- formatting ----------------------------------------------------------------------------------------------------------------
test('sizes: exact words at the edges; a value that is not a size says it could not look', () => {
  const cases = [[0, '0 B'], [999, '999 B'], [1024, '1 KB'], [1536, '1.5 KB'], [12400000, '12 MB'], [5100000000, '4.7 GB'], [1048575, '1 MB'], [1023.9 * 1024 ** 3, '1 TB']];
  for (const [n, want] of cases) assert.equal(humanBytes(n), want, String(n));
  for (const bad of [null, undefined, -5, NaN, '3']) assert.equal(humanBytes(bad), 'could not look');
});

test('ages: just now, minutes, hours, days; nothing is a guess', () => {
  const h = 3600e3;
  assert.equal(humanAge(AT - 30e3, AT), 'just now');
  assert.equal(humanAge(AT - 20 * 60e3, AT), '20 min ago');
  assert.equal(humanAge(AT - 3 * h, AT), '3 h ago');
  assert.equal(humanAge(AT - 30 * h, AT), '1 d ago');
  assert.equal(humanAge(AT + h, AT), 'just now');
  assert.equal(humanAge(null, AT), 'unknown');
});

// ---- the blocks ------------------------------------------------------------------------------------------------------------------
const CLEAN = cleanRead(inventedMemoryRead()).data;

test('the invented answer words out as EXPECT says, one block per kind, then the snapshot', () => {
  const blocks = buildBlocks(CLEAN.slots, CLEAN.snapshot, CLEAN.at);
  assert.deepEqual(blocks.map((b) => b.kind), [...EXPECT.map((e) => e.kind), 'snapshot']);
  for (const e of EXPECT) {
    const b = blocks.find((x) => x.kind === e.kind);
    assert.equal(b.big, e.size, e.kind);
    assert.equal(b.small, e.small, e.kind);
  }
  const s = blocks[blocks.length - 1];
  assert.deepEqual([s.big, s.small], [SNAPSHOT_EXPECT.big, SNAPSHOT_EXPECT.small]);
  assert.equal(s.hasBar, false);
  for (const b of blocks) assert.ok(b.twin.startsWith(b.label + ':') && b.twin.endsWith('.'), b.kind + ' has a sentence');
  assert.ok(blocks.find((x) => x.kind === 'scans').twin.includes('34 files') && blocks.find((x) => x.kind === 'scans').twin.includes('newest write 3 h ago'));
  assert.equal(blocks.find((x) => x.kind === 'delivery').twin, 'Delivery: empty.');
});

test('fill bars are scaled to the largest kind: the biggest fills the track, the rest are bytes over it, never more', () => {
  const blocks = buildBlocks(CLEAN.slots, CLEAN.snapshot, CLEAN.at);
  const max = Math.max(...CLEAN.slots.map((s) => s.bytes));
  for (const s of CLEAN.slots) {
    const b = blocks.find((x) => x.kind === s.kind);
    assert.ok(Math.abs(b.fillW - (s.bytes / max) * BAR_W) < 0.01, s.kind + ' ' + b.fillW);
    assert.ok(b.fillW >= 0 && b.fillW <= BAR_W);
  }
  for (const [kind, w] of Object.entries(FILL_EXPECT)) assert.ok(Math.abs(blocks.find((x) => x.kind === kind).fillW - w) <= 0.05, kind);
  assert.equal(blocks.find((x) => x.kind === 'cosmos').fillPct, 100);
  const order = [...CLEAN.slots].sort((a, b) => a.bytes - b.bytes).map((s) => blocks.find((x) => x.kind === s.kind).fillW);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'more bytes never draws a shorter bar');
});

test('nothing kept anywhere: every size is 0 B, every bar is empty (no divide by zero), the snapshot says none yet', () => {
  const c = cleanRead(inventedMemoryRead({ empty: true, noSnapshot: true })).data;
  const blocks = buildBlocks(c.slots, c.snapshot, c.at);
  for (const b of blocks.slice(0, 10)) assert.deepEqual([b.big, b.small, b.fillW], ['0 B', 'empty', 0], b.kind);
  const s = blocks[10];
  assert.deepEqual([s.big, s.small, s.twin], ['none yet', '0 of 7 kept', 'Chat-index snapshots: none yet.']);
});

test('a kind main could not look at says so in words (no zero, no bar); a cut-off kind says "at least"; an unreadable snapshot folder says so', () => {
  const c = cleanRead(inventedMemoryRead({ partial: true, snapshotUnreadable: true })).data;
  const blocks = buildBlocks(c.slots, c.snapshot, c.at);
  const sec = blocks.find((b) => b.kind === 'security'), cos = blocks.find((b) => b.kind === 'cosmos');
  assert.deepEqual([sec.big, sec.small, sec.fillW, sec.twin], ['could not look', '', 0, 'Security map (sizes only): could not look.']);
  assert.ok(cos.big.startsWith('at least ') && cos.small.startsWith('5000+ files'), JSON.stringify([cos.big, cos.small]));
  assert.ok(cos.twin.includes('at least 5000 files, at least 4.7 GB') && cos.twin.includes('not everything was looked into'));
  assert.equal(cos.barFill, 'var(--orange)');
  const snap = blocks[10];
  assert.deepEqual([snap.big, snap.small, snap.twin], ['could not look', '', 'Chat-index snapshots: could not look.']);
});

test('colours are tokens only; every block says its meaning in words, so colour never carries it alone', () => {
  for (const state of memoryStates()) {
    const c = state[3];
    if (!c.slots) continue;
    for (const b of buildBlocks(c.slots, c.snapshot, c.at)) {
      for (const col of [b.bigFill, b.barFill]) assert.match(col, /^var\(--[a-z-]+\)$/, col);
      assert.ok(b.twin.length > 10);
    }
  }
});

test('the edges: sizes next to a unit boundary read as the bigger unit, one file reads singular', () => {
  const c = cleanRead(inventedMemoryRead({ huge: true })).data;
  const blocks = buildBlocks(c.slots, c.snapshot, c.at);
  assert.equal(blocks.find((b) => b.kind === 'cosmos').big, '1 TB');
  assert.equal(blocks.find((b) => b.kind === 'scans').big, '1 MB');
  assert.equal(blocks.find((b) => b.kind === 'brief').big, '1023 B');
  const one = slotBlock({ kind: 'k', label: 'Kind', files: 1, bytes: 1, newestMs: AT - 90e3, partial: false }, AT, 1);
  assert.deepEqual([one.big, one.small], ['1 B', '1 file · 1 min ago']);
  assert.equal(slotBlock({ kind: 'k', label: 'Kind', files: 3, bytes: 5, newestMs: null, partial: false }, AT, 5).small, '3 files');
  assert.equal(snapshotBlock({ newestMs: AT - 3600e3, kept: 1, max: 7, ok: true }, AT).small, '1 of 7 kept');
});

// ---- cleaning what main sends -----------------------------------------------------------------------------------------------------
test('cleanRead keeps only the whitelisted fields; a stray name or path from anywhere never reaches the vals', () => {
  const dirty = inventedMemoryRead();
  dirty.slots[0].path = 'C:/Users/someone/alpha-site/latest.json';
  dirty.slots[0].name = 'alpha-site-notes.txt';
  dirty.extra = { dir: 'client-zeta' };
  const c = cleanRead(dirty);
  assert.ok(c.ok);
  const wire = JSON.stringify(c.data);
  for (const n of ['alpha-site', 'client-zeta', 'latest.json', 'someone']) assert.ok(!wire.includes(n), n);
  for (const s of c.data.slots) assert.deepEqual(Object.keys(s).sort(), ['bytes', 'files', 'kind', 'label', 'newestMs', 'partial']);
});

test('cleanRead: errors, malformed answers and bad numbers become words or null, never a number that was not sent', () => {
  assert.deepEqual(cleanRead({ error: 'could not look at the data folder' }), { ok: false, error: 'could not look at the data folder' });
  assert.deepEqual(cleanRead(null), { ok: false, error: 'no answer' });
  assert.deepEqual(cleanRead({ slots: 'x' }), { ok: false, error: 'no answer' });
  assert.deepEqual(cleanRead([]), { ok: false, error: 'no answer' });
  const c = cleanRead({ at: 'not a date', slots: [{ kind: 'a', files: -1, bytes: NaN, newestMs: 'x' }, { kind: '' }, null, { files: 3 }], snapshot: { kept: 'many' } });
  assert.deepEqual(c.data.slots, [{ kind: 'a', label: 'a', files: null, bytes: null, newestMs: null, partial: false }]);
  assert.equal(c.data.at, null);
  assert.deepEqual(c.data.snapshot, { newestMs: null, kept: null, max: null, ok: true });
  assert.deepEqual(cleanRead({ slots: [] }).data.snapshot, { newestMs: null, kept: null, max: null, ok: false }, 'no snapshot part at all is not an ok snapshot');
});

// ---- the surface -----------------------------------------------------------------------------------------------------------------
test('LAYER OFF: the surface is the frozen "off" constant, nothing is read, even with Settings open and the bridge present', async () => {
  for (const layer of [undefined, null, {}, { on: false }, { on: 'yes' }, { on: 1 }, []]) {
    const { self, reads, vals } = rig({ state: { consoleLayer: layer } });
    const v = vals();
    assert.equal(v.mcdShow, false);
    assert.equal(v.mcdHasBody, false);
    assert.equal(v.mcdOffline, false);
    assert.deepEqual(v.mcdBlocks, []);
    assert.ok(Object.isFrozen(v), 'the same frozen constant each time');
    assert.equal(vals(), v);
    await tick();
    assert.equal(reads.length, 0, 'no read for ' + JSON.stringify(layer));
    assert.equal(self._mcdAsked, false);
  }
  assert.equal(mcdLayerOn({ consoleLayer: { on: true } }), true);
  assert.equal(mcdLayerOn(null), false);
});

test('SETTINGS CLOSED with the layer on: nothing is shown and nothing is read', async () => {
  const { reads, vals } = rig({ state: { settingsOpen: false } });
  assert.equal(vals().mcdShow, false);
  await tick();
  assert.equal(reads.length, 0);
});

test('the read happens ONCE per opening of Settings, never while rendering, and closing re-arms it', async () => {
  const { self, reads, vals } = rig();
  const first = vals();
  assert.equal(reads.length, 0, 'rendering itself reads nothing');
  assert.equal(first.mcdShow, true);
  assert.equal(first.mcdLoading, true);
  assert.equal(first.mcdReady, false);
  vals(); vals(); vals();
  await tick();
  assert.equal(reads.length, 1, 'many renders, one read');
  const ready = vals();
  assert.equal(ready.mcdReady, true);
  assert.equal(ready.mcdLoading, false);
  assert.equal(ready.mcdBlocks.length, 11);
  vals();
  assert.equal(reads.length, 1);
  self.setState({ settingsOpen: false });
  assert.equal(vals().mcdShow, false);                     // closing re-arms
  self.setState({ settingsOpen: true });
  vals();
  await tick();
  assert.equal(reads.length, 2, 'the second opening reads again');
});

test('Refresh is one read and nothing else; while it runs the button is off and says so; two clicks are one read', async () => {
  const { self, reads, vals } = rig();
  vals(); await tick();
  assert.equal(reads.length, 1);
  const before = vals();
  assert.equal(before.mcdRefreshLabel, 'Refresh');
  assert.equal(before.mcdRefreshOff, false);
  const a = before.mcdRefresh(), b = before.mcdRefresh();
  assert.equal(vals().mcdRefreshOff, true);
  assert.equal(vals().mcdRefreshLabel, 'Reading…');
  await Promise.all([a, b]);
  await tick();
  assert.equal(reads.length, 2, 'Refresh re-reads exactly once');
  assert.equal(vals().mcdRefreshOff, false);
  assert.equal(self.state.mcd.error, '');
});

test('the layer going off while Settings stays open stops the card and the next read', async () => {
  const { self, reads, vals } = rig();
  vals(); await tick();
  const v = vals();
  self.setState({ consoleLayer: { on: false } });
  assert.equal(vals().mcdShow, false);
  assert.equal(await v.mcdRefresh(), false, 'a refresh from a stale handler does nothing with the layer off');
  assert.equal(reads.length, 1);
});

test('NO BRIDGE: the section is one sentence, no controls, no read, no error', async () => {
  const { reads, vals } = rig({ noMemory: true });
  const v = vals();
  assert.equal(v.mcdShow, true);
  assert.equal(v.mcdOffline, true);
  assert.equal(v.mcdOfflineText, 'The memory card needs the desktop app');
  assert.equal(MCD_OFFLINE, 'The memory card needs the desktop app');
  assert.deepEqual([v.mcdHasBody, v.mcdReady, v.mcdLoading, v.mcdHasErr, v.mcdBlocks.length], [false, false, false, false, 0]);
  await tick();
  assert.equal(reads.length, 0);
});

test('a read that fails: the words, no rows; a later failure keeps the last answer on screen and says so', async () => {
  const bad = rig({ fail: 'main is busy' });
  bad.vals(); await tick();
  let v = bad.vals();
  assert.deepEqual([v.mcdHasErr, v.mcdReady, v.mcdLoading], [true, false, false]);
  assert.equal(v.mcdErrText, 'Couldn’t look at what the app keeps · main is busy');

  const ok = rig();
  ok.vals(); await tick();
  assert.equal(ok.vals().mcdReady, true);
  ok.self.hq.memory.read = async () => ({ error: 'could not look at the data folder' });
  await ok.vals().mcdRefresh();
  v = ok.vals();
  assert.equal(v.mcdReady, true, 'the last answer stays');
  assert.equal(v.mcdBlocks.length, 11);
  assert.deepEqual([v.mcdHasErr, v.mcdErrText], [true, 'Couldn’t refresh the memory card · could not look at the data folder · the last answer stays on screen']);
  const empty = rig({ answer: { not: 'an answer' } });
  empty.vals(); await tick();
  assert.equal(empty.vals().mcdErrText, 'Couldn’t look at what the app keeps · no answer');
});

test('summary and cap note: kinds and the time of the read; the cap note only when main said capped', async () => {
  const a = rig();
  a.vals(); await tick();
  assert.equal(a.vals().mcdSummary, '10 kinds · read 12:00');
  assert.equal(a.vals().mcdCapped, false);
  const b = rig({ answer: inventedMemoryRead({ partial: true }) });
  b.vals(); await tick();
  assert.equal(b.vals().mcdCapped, true);
  assert.match(b.vals().mcdCappedText, /at least/);
  assert.equal(b.vals().mcdNote, MCD_NOTE);
  assert.equal(b.vals().mcdEmptySlotText, 'Empty slot');
});

test('the blocks are memoised on the held answer: a render with nothing new returns the same array', async () => {
  const { vals } = rig();
  vals(); await tick();
  assert.equal(vals().mcdBlocks, vals().mcdBlocks);
});

test('state: the card holds ONE state object (mcd) and never writes any other key', async () => {
  const { self, vals } = rig();
  const keys = new Set(Object.keys(self.state));
  vals(); await tick();
  assert.deepEqual([...Object.keys(self.state)].filter((k) => !keys.has(k)), ['mcd']);
  assert.deepEqual(Object.keys(self.state.mcd).sort(), Object.keys(mcdInit()).sort());
});

// ---- the template -----------------------------------------------------------------------------------------------------------------
const ready = async () => { const r = rig(); r.vals(); await tick(); return r.vals(); };

test('the template has exactly two buttons (Refresh, bound to mcdRefresh, and the Empty slot door to the back room), no link or input, and nothing that could forget, delete, clear or export', () => {
  assert.equal((tpl.match(/<button\b/g) || []).length, 2);
  assert.equal((tpl.match(/\bonClick=/g) || []).length, 2);
  assert.match(tpl, /<button type="button" data-mcd="empty-slot" aria-label="{{ mcdv.mcdEmptySlotText }}" onClick="{{ mcdv.mcdEmptyOpen }}"/);
  assert.match(tpl, /<button type="button" data-mcd="refresh" onClick="\{\{ mcdv\.mcdRefresh \}\}"/);
  for (const re of [/<a\b/, /<input\b/, /<select\b/, /<textarea\b/, /\bonChange=/, /\bonInput=/, /\bonKey/, /role="button"/, /<form\b/]) assert.ok(!re.test(tpl), 'template has ' + re);
  const labels = (tpl.match(/>([^<>]*)<\/button>/g) || []).concat(tpl.match(/aria-label="[^"]*"/g) || []);
  for (const l of labels) assert.ok(!/forget|delete|clear|erase|export|reset|remove|wipe/i.test(l.replace(/Memory card: what the app keeps on this PC/, '')), l);
});

test('nothing animates: no transition, animation, keyframes or motion style in the section', () => {
  for (const re of [/transition/i, /animation/i, /@keyframes/i, /<animate/i, /<set\b/, /will-change/i, /[^-]transform:/i]) assert.ok(!re.test(tpl), 'template has ' + re);
});

test('every binding in the template resolves against the ready vals; every handler is a function; control flow is balanced; no backticks', async () => {
  const v = await ready();
  const chtv = cheatsVals.call({ state: { consoleLayer: { on: true }, cheatsFound: ['cartridge'] } }).chtv;   // the codes slot: the found list (the cheat codes dish)
  const scope = { mcdv: v, b: v.mcdBlocks[0], w: v.mcdBlocks[0], chtv, c: chtv.chtFound[0] };
  const bindings = [...new Set([...tpl.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]))].filter((x) => !/^(true|false)$/.test(x));
  assert.ok(bindings.length > 15);
  for (const b of bindings) assert.notEqual(resolve(scope, b), undefined, 'unbound ' + b);
  assert.equal(typeof resolve(scope, 'mcdv.mcdRefresh'), 'function');
  assert.equal((tpl.match(/<sc-if\b/g) || []).length, (tpl.match(/<\/sc-if>/g) || []).length);
  assert.equal((tpl.match(/<sc-for\b/g) || []).length, (tpl.match(/<\/sc-for>/g) || []).length);
  assert.ok(!tpl.includes('`'));
  assert.ok(!/\{\{[^}]*(&&|\|\||\?)/.test(tpl), 'dc-lite dialect: no operators other than !');
  // top-level names it reads: only the one nested key (and the loop variables)
  const roots = new Set(bindings.map((b) => b.replace(/^!/, '').split('.')[0]));
  assert.deepEqual([...roots].sort(), ['b', 'c', 'chtv', 'mcdv', 'w']);
});

test('the template is tokens only: no literal colour anywhere', () => {
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(tpl.replace(/&#\d+;/g, '')), 'a hex colour');
  assert.ok(!/\brgba?\(|\bhsla?\(/i.test(tpl), 'an rgb()/hsl() colour');
});

test('each block is an img with its own label; the hidden list says the same in words; both hooks are in the markup and inert', () => {
  assert.match(tpl, /<svg data-mcd="slot" data-mcd-kind="\{\{ b\.kind \}\}" viewBox="0 0 160 72" role="img" aria-label="\{\{ b\.twin \}\}"/);
  assert.match(tpl, /<ul data-mcd="twin"[^>]*>\s*<sc-for list="\{\{ mcdv\.mcdBlocks \}\}" as="w"[^>]*><li>\{\{ w\.twin \}\}<\/li>/);
  // the slot was empty in the Memory card dish; the cheat codes dish puts the found list (names only, no handler) in it, bound to chtv only
  const slot = /<div data-mcd="codes-slot" id="mcd-codes-slot">([\s\S]*?)<div data-mcd="note"/.exec(tpl);
  assert.ok(slot, 'the codes slot is in the markup');
  assert.ok(!/onClick|<button|<a\b|tabindex/i.test(slot[1]), 'the codes slot has no handler');
  assert.ok(/chtv\.chtShowFound/.test(slot[1]) && !/mcdv\./.test(slot[1]));
  // small delights turned the empty slot into the ONE door to the back room: a labelled button whose only handler is mcdEmptyOpen
  const empty = /<button type="button" data-mcd="empty-slot"[^>]*>/.exec(tpl);
  assert.ok(empty, 'the empty slot is a button');
  assert.ok(/onClick="{{ mcdv.mcdEmptyOpen }}"/.test(empty[0]) && !/tabindex|role=/i.test(empty[0]));
  assert.ok(!/onClick|tabindex/i.test(/<div data-mcd="codes-slot"[^>]*>/.exec(tpl)[0]));
});

test('the section node exists only behind mcdv.mcdShow; the offline sentence stands alone; the body (heading, Refresh, blocks, note) is behind mcdHasBody', () => {
  assert.match(tpl, /<sc-if value="\{\{ mcdv\.mcdShow \}\}"[^>]*>\s*<section data-mcd="section"/);
  const offline = /<sc-if value="\{\{ mcdv\.mcdOffline \}\}"[^>]*>(.*?)<\/sc-if>/.exec(tpl)[1];
  assert.ok(!/<button|<svg/.test(offline));
  const body = tpl.slice(tpl.indexOf('mcdv.mcdHasBody'));
  for (const part of ['data-mcd="refresh"', 'data-mcd="strip"', 'data-mcd="note"', 'data-mcd="empty-slot"', 'data-mcd="codes-slot"']) assert.ok(body.includes(part), part + ' is inside the body');
  assert.ok(!tpl.slice(0, tpl.indexOf('mcdv.mcdHasBody')).includes('data-mcd="refresh"'));
});

// ---- the selftest states ------------------------------------------------------------------------------------------------------------
const REQUIRED = ['memory-offline', 'memory-loading', 'memory-error', 'memory-error-with-rows', 'memory-ready', 'memory-ready-empty', 'memory-ready-partial', 'memory-ready-edges'];

test('selftest rows: unique memory- names, the drift row shape, Settings open with the layer on, every key a real mcd key', () => {
  const rows = memoryStates();
  const names = rows.map((r) => r[0]);
  assert.equal(new Set(names).size, names.length);
  for (const n of REQUIRED) assert.ok(names.includes(n), 'missing ' + n);
  for (const n of names) assert.match(n, /^memory-[a-z-]+$/);
  assert.ok(rows.length <= 12, 'each row runs in both themes under a 180 s selftest');
  for (const [name, sub, live, mcd, extra] of rows) {
    assert.equal(sub, 'settings', name);
    assert.equal(live, null, name);
    assert.deepEqual(Object.keys(mcd).sort(), Object.keys(mcdInit()).sort(), name + ' keys');
    assert.deepEqual(extra, { settingsOpen: true, consoleLayer: { on: true } }, name);
  }
  assert.deepEqual([...MEMORY_OFFLINE_ROWS], ['memory-offline']);
});

test('selftest rows land in the state their names promise, using the same cleaning the page runs', () => {
  const by = Object.fromEntries(memoryStates().map((r) => [r[0], r[3]]));
  assert.deepEqual(by['memory-ready'], { ...cleanRead(inventedMemoryRead()).data, loaded: true, busy: false, error: '' });
  assert.equal(by['memory-loading'].slots, null);
  assert.equal(by['memory-error'].slots, null);
  assert.ok(by['memory-error'].error);
  assert.ok(by['memory-error-with-rows'].error && by['memory-error-with-rows'].slots.length === 10);
  assert.ok(by['memory-ready-empty'].slots.every((s) => s.files === 0));
  assert.equal(by['memory-ready-partial'].capped, true);
  assert.equal(by['memory-ready-partial'].snapshot.ok, false);
});

test('the rows render through the real vals without a throw, in each state', () => {
  for (const [name, , , mcd, extra] of memoryStates()) {
    const self = Object.assign(Object.create(memoryCardLogic), {
      state: { tab: 'home', route: null, sub: {}, ...extra, mcd }, setState() {},
      hq: name === 'memory-offline' ? {} : { memory: { read: async () => ({}) } },
    });
    self._mcdAsked = true;
    const v = memoryCardVals.call(self, { S: self.state }).mcdv;
    assert.equal(v.mcdShow, true, name);
    if (name === 'memory-offline') assert.equal(v.mcdOffline, true);
    else if (name === 'memory-loading') assert.equal(v.mcdLoading, true);
    else if (name === 'memory-error') assert.equal(v.mcdHasErr && !v.mcdReady, true);
    else assert.equal(v.mcdReady, true, name);
  }
});

test('the fixture labels are the engine labels, in the engine order (the main side and the selftest cannot drift apart)', async () => {
  const core = await import('../../../dashboard/memory-card-core.mjs');
  assert.deepEqual(inventedMemoryRead().slots.map((s) => [s.kind, s.label]), core.KINDS.map((k) => [k.id, k.label]));
  assert.equal(inventedMemoryRead().snapshot.max, core.SNAPSHOT_MAX);
  assert.ok(core.KINDS.every((k) => k.label.length <= 26), 'a label fits the block');
});

// ---- the shared edits (skipped LOUDLY until the integrator lands them, then they pin them) ---------------------------------------------
const loud = (t, what) => { const m = 'SKIPPED LOUDLY (memory-card): ' + what + ' is not in place yet'; process.stderr.write('\n' + m + '\n'); return t.skip(m); };
const src = (rel) => fs.readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

test('Settings includes the fragment under an sc-if on cslv.cslOn; the vals index registers memoryCardVals; the logic is mixed in', (t) => {
  const settings = src('src/tpl/ov-settings.tpl.js');
  if (!/memory-card\.tpl\.js/.test(settings)) return loud(t, 'the memory-card include in tpl/ov-settings.tpl.js');
  assert.match(settings, /<sc-if value="\{\{ cslv\.cslOn \}\}"[^>]*>\$\{memoryCard\}<\/sc-if>/);
  const index = src('src/vals/index.js');
  if (!/memoryCardVals/.test(index)) return loud(t, 'memoryCardVals in vals/index.js');
  assert.equal((index.match(/memoryCardVals/g) || []).length, 2, 'one import, one list entry, nothing else');
  const app = src('src/app.js');
  assert.match(app, /memoryCardLogic/);
});
