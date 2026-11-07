// The assistant's rulebook, pure half (dashboard/assist-core.mjs). Placeholder data only — the repo is public.
//   node --test dashboard/assist-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, LIMITS, decide, auditEntry, isUnderWindowsDir, summarize, sinceWindow, safeName, HOUR_MS } from './assist-core.mjs';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const entry = (tool, tier, msAgo, ok = true, extra = {}) => ({ v: 1, at: ago(msAgo), door: 'mcp', tool, tier, ok, ms: 3, pid: 100, ...extra });
const many = (n, tool, tier, msAgo = 60e3) => Array.from({ length: n }, (_, i) => entry(tool, tier, msAgo + i * 1000));

test('the limits table pins the rulebook numbers', () => {
  assert.deepEqual([...TIERS], ['read', 'note', 'run', 'stage']);   // no act tier
  assert.equal(LIMITS.note.perHourPerTool, 30);
  assert.equal(LIMITS.stage.perHour, 10);
  assert.equal(LIMITS.stage.waitingMax, 20);
  assert.equal(LIMITS.run.cooldownMs, 10 * 60e3);
  assert.equal(LIMITS.run.oneAtATime, true);
});

test('an unknown or missing tier is refused in words, an act tier does not exist', () => {
  for (const tier of [undefined, null, 'act', 'admin', '']) {
    const d = decide({ door: 'mcp', tool: 'hq_mystery', tier, cwd: 'C:/work/alpha-site' }, [], NOW);
    assert.equal(d.allow, false);
    assert.match(d.reason, /not on the rulebook/);
    assert.match(d.reason, /hq_mystery/);
  }
});

test('read is always allowed, even with a huge history', () => {
  assert.deepEqual(decide({ door: 'mcp', tool: 'hq_brief', tier: 'read', cwd: 'C:/work/alpha-site' }, many(500, 'hq_brief', 'read'), NOW), { allow: true });
});

test('note: 30 an hour per tool; the 31st is refused with retryAt; another tool is not affected; refused and old calls do not count', () => {
  const ctx = { door: 'mcp', tool: 'hq_capture', tier: 'note', cwd: 'C:/work/alpha-site' };
  assert.equal(decide(ctx, many(29, 'hq_capture', 'note'), NOW).allow, true);
  const d = decide(ctx, many(30, 'hq_capture', 'note'), NOW);
  assert.equal(d.allow, false);
  assert.match(d.reason, /30 an hour/);
  // the oldest counted call is 60s + 29s ago, so the slot frees one hour after it
  assert.equal(d.retryAt, new Date(NOW - 89e3 + HOUR_MS).toISOString());
  assert.equal(decide({ ...ctx, tool: 'hq_quest_done' }, many(30, 'hq_capture', 'note'), NOW).allow, true);
  assert.equal(decide(ctx, [...many(30, 'hq_capture', 'note').map((e) => ({ ...e, ok: false }))], NOW).allow, true);
  assert.equal(decide(ctx, many(30, 'hq_capture', 'note', HOUR_MS + 1000), NOW).allow, true);
});

test('stage: 10 an hour across stage tools, and at most 20 waiting', () => {
  const ctx = { door: 'mcp', tool: 'hq_social_post', tier: 'stage', cwd: 'C:/work/alpha-site', waiting: 0 };
  const mixed = [...many(5, 'hq_social_post', 'stage'), ...many(5, 'hq_social_reply', 'stage', 90e3)];
  const d = decide(ctx, mixed, NOW);
  assert.equal(d.allow, false);
  assert.match(d.reason, /10 an hour/);
  assert.ok(d.retryAt);
  assert.equal(decide(ctx, mixed.slice(0, 9), NOW).allow, true);
  const w = decide({ ...ctx, waiting: 20 }, [], NOW);
  assert.equal(w.allow, false);
  assert.match(w.reason, /20 .*waiting|waiting.*20/);
  assert.equal(decide({ ...ctx, waiting: 19 }, [], NOW).allow, true);
});

test('run: one at a time, then a 10-minute cooldown with retryAt', () => {
  const ctx = { door: 'mcp', tool: 'hq_scan_trigger', tier: 'run', cwd: 'C:/work/alpha-site' };
  assert.deepEqual(decide(ctx, [], NOW), { allow: true });
  const running = decide({ ...ctx, running: { by: 'mcp' } }, [], NOW);
  assert.equal(running.allow, false);
  assert.match(running.reason, /already running/);
  assert.match(running.reason, /15 minutes/);   // the answer says when a stuck lock clears
  const app = decide({ ...ctx, running: { by: 'app' } }, [], NOW);
  assert.match(app.reason, /app's own scan/);
  const cool = decide(ctx, [entry('hq_scan_trigger', 'run', 4 * 60e3)], NOW);
  assert.equal(cool.allow, false);
  assert.equal(cool.retryAt, new Date(NOW - 4 * 60e3 + 10 * 60e3).toISOString());
  assert.equal(decide(ctx, [entry('hq_scan_trigger', 'run', 11 * 60e3)], NOW).allow, true);
  assert.equal(decide(ctx, [entry('hq_scan_trigger', 'run', 4 * 60e3, false)], NOW).allow, true, 'a refused call does not start a cooldown');
});

test('the nightly belt: write tiers are refused for a cwd under the Windows folder, reads are allowed', () => {
  for (const cwd of ['C:/WINDOWS/system32', 'C:\\Windows\\System32', 'c:/windows', 'D:\\WINDOWS\\x']) {
    assert.equal(isUnderWindowsDir(cwd), true, cwd);
    for (const tier of ['note', 'run', 'stage']) {
      const d = decide({ door: 'mcp', tool: 'hq_x', tier, cwd }, [], NOW);
      assert.equal(d.allow, false, `${tier} @ ${cwd}`);
      assert.match(d.reason, /Windows folder/);
    }
    assert.equal(decide({ door: 'mcp', tool: 'hq_brief', tier: 'read', cwd }, [], NOW).allow, true);
  }
  for (const cwd of ['C:/work/alpha-site', 'C:/windowsill/x', 'C:/Users/placeholder/windows', '', undefined]) assert.equal(isUnderWindowsDir(cwd), false, String(cwd));
});

test('decide() is pure: same inputs, same answer, inputs untouched', () => {
  const entries = many(30, 'hq_capture', 'note');
  const snap = JSON.stringify(entries);
  const ctx = { door: 'mcp', tool: 'hq_capture', tier: 'note', cwd: 'C:/work/alpha-site' };
  const a = decide(ctx, entries, NOW), b = decide(ctx, entries, new Date(NOW));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(entries), snap);
  assert.deepEqual(decide(ctx, 'not an array', NOW), { allow: true });
  assert.deepEqual(decide(ctx, [null, 7, {}, { at: 'nope' }], NOW), { allow: true });
});

test('auditEntry has a fixed key set and carries nothing else', () => {
  const e = auditEntry({ at: NOW, door: 'mcp', tool: 'hq_capture', tier: 'note', ok: true, ms: 12.4, pid: 4242, text: 'secret thought', args: { text: 'x' }, path: 'C:/work/alpha-site' });
  assert.deepEqual(Object.keys(e), ['v', 'at', 'door', 'tool', 'tier', 'ok', 'ms', 'pid']);
  assert.deepEqual(e, { v: 1, at: new Date(NOW).toISOString(), door: 'mcp', tool: 'hq_capture', tier: 'note', ok: true, ms: 12, pid: 4242 });
  const r = auditEntry({ at: NOW, door: 'browser', tool: 'hq_social_post', tier: 'stage', ok: false, reason: 'limit\nreached', ms: 1, pid: 1 });
  assert.deepEqual(Object.keys(r), ['v', 'at', 'door', 'tool', 'tier', 'ok', 'ms', 'pid', 'reason']);
  assert.equal(r.reason, 'limit reached');
  // junk in, safe values out
  const j = auditEntry({ door: 'elsewhere', tool: 'a b/../c\\d', tier: 'act', ok: 'yes', ms: -5, pid: 'x', reason: 'r'.repeat(999) });
  assert.equal(j.door, 'unknown'); assert.equal(j.tier, 'none'); assert.equal(j.ok, false); assert.equal(j.ms, 0); assert.equal(j.pid, 0); assert.equal(j.at, null);
  assert.equal(j.tool, 'ab..cd');   // separators and spaces gone assert.equal(j.reason.length, 160);
  assert.equal(safeName('hq_scan_trigger'), 'hq_scan_trigger');
});

test('sinceWindow + summarize: counts by tool, tier and door; last 20 newest first; last scan trigger found beyond the window', () => {
  const day = 24 * HOUR_MS;
  assert.equal(sinceWindow('24h', NOW).fromMs, NOW - day);
  assert.equal(sinceWindow('7d', NOW).fromMs, NOW - 7 * day);
  assert.equal(sinceWindow('bogus', NOW).since, 'today');
  const midnight = new Date(NOW); midnight.setHours(0, 0, 0, 0);
  assert.equal(sinceWindow('today', NOW).fromMs, midnight.getTime());

  const entries = [
    ...many(25, 'hq_brief', 'read', 2 * 60e3),
    entry('hq_capture', 'note', 5 * 60e3),
    { ...entry('hq_social_post', 'stage', 6 * 60e3, false, { reason: 'staging is limited' }), door: 'browser' },
    entry('hq_scan_trigger', 'run', 3 * day, true),          // outside 24h, still the last scan trigger
    entry('hq_brief', 'read', 5 * day),                       // outside 24h
  ];
  const s = summarize(entries, { now: NOW, since: '24h' });
  assert.equal(s.since, '24h');
  assert.equal(s.counts.byTool.hq_brief, 25);
  assert.equal(s.counts.byTool.hq_capture, 1);
  assert.deepEqual(s.counts.byTier, { read: 25, note: 1, stage: 1 });
  assert.deepEqual(s.counts.byDoor, { mcp: 26, browser: 1 });
  assert.equal(s.recent.length, 20);
  assert.ok(Date.parse(s.recent[0].at) >= Date.parse(s.recent[19].at), 'newest first');
  assert.deepEqual(Object.keys(s.recent[0]).sort(), ['at', 'door', 'ms', 'ok', 'tier', 'tool']);
  assert.equal(s.lastScanTrigger.ok, true);
  assert.equal(s.lastScanTrigger.at, ago(3 * day));
  assert.equal(summarize([], { now: NOW }).lastScanTrigger, null);
  assert.deepEqual(summarize(null, { now: NOW, since: '7d' }).counts, { byTool: {}, byTier: {}, byDoor: {} });
});
