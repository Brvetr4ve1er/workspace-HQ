// Sessions board engine: the classification table. Pure; placeholder data only (the repo is public).
//   node --test dashboard/sessions-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './sessions-core.mjs';

process.env.TZ = 'UTC';
const NOW = Date.parse('2026-11-05T12:00:00.000Z');   // a Thursday
const MIN = 60e3, H = 3600e3;
const at = (msAgo) => new Date(NOW - msAgo).toISOString();

const conv = (o = {}) => ({ id: 'code:s1', native_id: '11111111-1111-4111-8111-111111111111', project_id: 'code:C--work-alpha-site',
  title: 'Alpha session', started_at: at(5 * H), last_at: at(10 * MIN), message_count: 20, cwd: 'C:/work/alpha-site', git_branch: 'main',
  tokens_in: 100, tokens_out: 200, tokens_cache_read: 3000, active_ms: 30 * MIN, project_name: 'alpha-site', hq_project_id: null, ...o });
const turn = (role, msAgo, o = {}) => ({ role, at: at(msAgo), text: '', tool_name: null, is_sidechain: 0, ...o });
const tool = (msAgo, name = 'Bash', o = {}) => turn('assistant', msAgo, { tool_name: name, text: '[tool: ' + name + ']', ...o });
const say = (msAgo, text = 'Done.') => turn('assistant', msAgo, { text });
const cls = (c, turns) => C.classify(c, turns, NOW);

test('running: a turn inside 120 s, not at 121 s', () => {
  let r = cls(conv({ last_at: at(119e3) }), [turn('user', 200e3), tool(119e3)]);
  assert.equal(r.state, 'running');
  assert.match(r.sentence, /^working now · \d+ turns? this hour$/);
  r = cls(conv({ last_at: at(121e3) }), [turn('user', 200e3), tool(121e3)]);
  assert.equal(r.state, 'waiting-tool');
});

test('running counts a subagent turn; the main line alone would be waiting', () => {
  const r = cls(conv({ last_at: at(30e3) }), [tool(10 * MIN), turn('assistant', 30e3, { is_sidechain: 1, tool_name: 'Read' })]);
  assert.equal(r.state, 'running');
});

test('waiting-tool under 2 h names the tool and the age, then stopped-mid-tool', () => {
  let r = cls(conv({ last_at: at(14 * MIN) }), [turn('user', 20 * MIN), tool(14 * MIN, 'Bash')]);
  assert.equal(r.state, 'waiting-tool');
  assert.equal(r.lastTool, 'Bash');
  assert.equal(r.sentence, 'asked to run Bash 14 min ago — no result since (a permission prompt, or a long tool)');
  r = cls(conv({ last_at: at(2 * H - 1) }), [tool(2 * H - 1)]);
  assert.equal(r.state, 'waiting-tool');
  r = cls(conv({ last_at: at(2 * H) }), [tool(2 * H, 'Edit')]);
  assert.equal(r.state, 'stopped-mid-tool');
  assert.match(r.sentence, /^stopped mid-tool: asked to run Edit 2 h ago/);
});

test('subagent turns are ignored when reading where the session stopped', () => {
  const r = cls(conv({ last_at: at(40 * MIN) }), [say(50 * MIN, 'All done.'), turn('assistant', 40 * MIN, { is_sidechain: 1, tool_name: 'Grep' })]);
  assert.equal(r.state, 'finished');
  assert.equal(r.sentence, 'finished its turn 50 min ago');
  assert.equal(r.lastTool, undefined);
});

test('system turns (compaction, command echoes) are not the last word', () => {
  const r = cls(conv({ last_at: at(20 * MIN) }), [say(30 * MIN), turn('system', 20 * MIN, { text: '/clear' })]);
  assert.equal(r.state, 'finished');
});

test('no-reply: the owner prompt older than 3 min', () => {
  assert.equal(cls(conv({ last_at: at(4 * MIN) }), [say(10 * MIN), turn('user', 4 * MIN)]).state, 'no-reply');
  assert.equal(cls(conv({ last_at: at(4 * MIN) }), [say(10 * MIN), turn('user', 4 * MIN)]).sentence, 'your last prompt has no reply');
  assert.equal(cls(conv({ last_at: at(150e3) }), [say(10 * MIN), turn('user', 150e3)]).state, 'running', 'between 120 s and 3 min it is not yet a missing reply');
});

test('limit: the session limit with a time and a zone suffix', () => {
  const r = cls(conv(), [say(10 * MIN, 'You\u2019ve hit your session limit \u00b7 resets 4:30pm (Europe/Paris)')]);
  assert.equal(r.state, 'limit');
  assert.equal(r.limitKind, 'session');
  assert.equal(r.resetsAt, '2026-11-05T16:30:00.000Z');
  assert.equal(r.sentence, 'stopped at your session limit \u00b7 resets 4:30 pm');
});

test('limit: the plain limit with 9am rolls to the next 9am', () => {
  const r = cls(conv(), [say(10 * MIN, "You've hit your limit \u00b7 resets 9am")]);
  assert.equal(r.limitKind, 'limit');
  assert.equal(r.resetsAt, '2026-11-06T09:00:00.000Z');
  assert.equal(r.sentence, 'stopped at your usage limit \u00b7 resets 9 am');
});

test('limit: the weekly limit with a date-form reset', () => {
  const r = cls(conv(), [say(10 * MIN, "You've hit your weekly limit \u00b7 resets Nov 7, 5pm")]);
  assert.equal(r.limitKind, 'weekly');
  assert.equal(r.resetsAt, '2026-11-07T17:00:00.000Z');
  assert.equal(r.sentence, 'stopped at your weekly limit \u00b7 resets Sat 5 pm');
});

test('limit: a date in January written in December means next year', () => {
  const p = C.parseLimitNotice("You've hit your weekly limit \u00b7 resets Jan 2, 5pm", Date.parse('2026-12-30T10:00:00Z'));
  assert.equal(p.resetsAt, '2027-01-02T17:00:00.000Z');
});

test('limit: the monthly spend limit has no reset time', () => {
  const r = cls(conv(), [say(10 * MIN, "You've hit your monthly spend limit")]);
  assert.equal(r.limitKind, 'monthly');
  assert.equal(r.resetsAt, null);
  assert.equal(r.sentence, 'stopped at your monthly spend limit');
});

test('limit: a reset already in the past reads "reset", not "resets"', () => {
  const r = cls(conv({ last_at: at(20 * H) }), [say(20 * H, "You've hit your weekly limit \u00b7 resets Nov 4, 5pm")]);
  assert.match(r.sentence, /^stopped at your weekly limit \u00b7 reset Wed 5 pm$/);
});

test('limit beats running: a notice written seconds ago is a stop, not work', () => {
  assert.equal(cls(conv({ last_at: at(10e3) }), [say(10e3, "You've hit your limit \u00b7 resets 3pm")]).state, 'limit');
});

test('ordinary assistant prose that mentions a limit is not a notice', () => {
  assert.equal(C.parseLimitNotice('The rate limit on this endpoint is 5/s; you have hit your target.', NOW), null);
  assert.equal(C.parseLimitNotice('', NOW), null);
  assert.equal(C.parseLimitNotice(null, NOW), null);
  assert.equal(cls(conv(), [say(10 * MIN, 'I raised the rate limit.')]).state, 'finished');
});

test('api-error, finished, quiet at 6 h', () => {
  assert.equal(cls(conv({ last_at: at(10 * MIN) }), [say(10 * MIN, 'API Error: 529 overloaded')]).state, 'api-error');
  assert.equal(cls(conv({ last_at: at(10 * MIN) }), [say(10 * MIN, 'API Error: 529 overloaded')]).sentence, 'stopped on a connection error');
  assert.equal(cls(conv({ last_at: at(2 * H) }), [say(2 * H)]).sentence, 'finished its turn 2 h ago');
  assert.equal(cls(conv({ last_at: at(6 * H - MIN) }), [say(6 * H - MIN)]).state, 'finished');
  assert.equal(cls(conv({ last_at: at(6 * H) }), [say(6 * H)]).state, 'quiet');
});

test('a session with no turns indexed is honest about it', () => {
  const r = cls(conv({ last_at: at(2 * H) }), []);
  assert.equal(r.state, 'finished');
  assert.equal(r.sentence, 'quiet for 2 h');
  assert.equal(cls(conv({ last_at: at(7 * H) }), []).state, 'quiet');
});

test('long-run flag at 2 h of active time', () => {
  assert.equal(cls(conv({ active_ms: 2 * H - 1 }), [say(10 * MIN)]).longRun, false);
  assert.equal(cls(conv({ active_ms: 2 * H }), [say(10 * MIN)]).longRun, true);
});

test('sentences carry no prompt text', () => {
  const secret = 'ZZ-PROMPT-TEXT-ZZ';
  for (const turns of [[turn('user', 10 * MIN, { text: secret })], [turn('user', 10 * MIN, { text: secret }), tool(5 * MIN)], [say(10 * MIN, secret)]]) {
    assert.ok(!cls(conv(), turns).sentence.includes(secret));
  }
});

test('deterministic for a fixed now', () => {
  const t = [turn('user', 20 * MIN), tool(14 * MIN)];
  assert.deepEqual(cls(conv(), t), cls(conv(), t));
});

test('nightly-run grouping by cwd, with either slash and any case', () => {
  assert.equal(C.isNightly('C:/WINDOWS/system32'), true);
  assert.equal(C.isNightly('c:\\Windows\\System32\\'), true);
  assert.equal(C.isNightly('C:/work/alpha-site'), false);
  assert.equal(C.isNightly(null), false);
});

test('canResume rules', () => {
  const R = (state, agoMs, o) => C.resumeRule(state, NOW - agoMs, NOW, o);
  assert.equal(R('finished', 31 * MIN).canResume, true);
  assert.equal(R('finished', 29 * MIN).canResume, false);
  assert.equal(R('finished', 30 * MIN).canResume, true);
  assert.equal(R('running', 5 * H).canResume, false);
  assert.equal(R('waiting-tool', 5 * H).canResume, false);
  assert.equal(R('stopped-mid-tool', 3 * H).canResume, true);
  assert.equal(R('limit', 3 * H).canResume, true);
  assert.equal(R('finished', 3 * H, { nightly: true }).canResume, false);
  assert.equal(R('finished', 3 * H, { hasCwd: false }).canResume, false);
  assert.ok(R('running', 5 * H).why);
});

test('project-label precedence: confirmed, auto, folder', () => {
  const c = conv();
  assert.deepEqual(C.projectLabel(c, { link_state: 'confirmed', hq_project_id: 'alpha', name: 'alpha-site' }), { id: 'alpha', name: 'alpha-site', matched: 'confirmed' });
  assert.deepEqual(C.projectLabel(c, { link_state: 'auto', hq_project_id: 'alpha', name: 'alpha-site' }), { id: 'alpha', name: 'alpha-site', matched: 'auto' });
  assert.deepEqual(C.projectLabel(c, { link_state: 'none', hq_project_id: null, name: 'alpha-site' }), { id: null, name: 'alpha-site', matched: 'folder' });
  assert.deepEqual(C.projectLabel(c, { link_state: 'rejected', hq_project_id: 'alpha', name: 'x' }), { id: null, name: 'alpha-site', matched: 'folder' });
  assert.deepEqual(C.projectLabel(c, undefined), { id: null, name: 'alpha-site', matched: 'folder' });
  assert.deepEqual(C.projectLabel(conv({ cwd: null, project_name: 'beta' }), undefined), { id: null, name: 'beta', matched: 'folder' });
});

// ---------------------------------------------------------------- the board
const row = (id, o) => conv({ id: 'code:' + id, native_id: id, ...o });
function board(rows, details, extra = {}) {
  return C.buildBoard({ rows, details, projects: { 'code:C--work-alpha-site': { link_state: 'auto', hq_project_id: 'alpha', name: 'alpha-site' } }, now: NOW, ...extra });
}

test('buildBoard: 24 h cards newest first, nightly folded, 7-day limit line', () => {
  const rows = [
    row('a', { last_at: at(1 * H), started_at: at(3 * H) }),
    row('b', { last_at: at(10 * MIN) }),
    row('n1', { last_at: at(2 * H), cwd: 'C:/WINDOWS/system32' }),
    row('n2', { last_at: at(5 * H), cwd: 'C:\\Windows\\System32' }),
    row('old', { last_at: at(3 * 24 * H) }),
    row('older', { last_at: at(9 * 24 * H) }),
  ];
  const details = {
    'code:a': [say(1 * H)],
    'code:b': [tool(10 * MIN)],
    'code:old': [say(3 * 24 * H, "You've hit your weekly limit \u00b7 resets Nov 7, 5pm")],
    'code:older': [say(9 * 24 * H, "You've hit your weekly limit \u00b7 resets Nov 1, 5pm")],
    'code:n1': [say(2 * H, "You've hit your limit \u00b7 resets 3pm")],
  };
  const b = board(rows, details, { codex: { count: 20, lastAt: '2026-10-31T10:00:00.000Z' } });
  assert.deepEqual(b.sessions.map((s) => s.id), ['b', 'a']);
  assert.equal(b.nightly.count, 2);
  assert.equal(b.nightly.lastAt, at(2 * H));
  assert.equal(b.limitStops.count, 1, 'only the 7-day window, and never nightly runs');
  assert.deepEqual(b.limitStops.last, { kind: 'weekly', at: at(3 * 24 * H) });
  assert.equal(b.counts.week, 5);
  assert.equal(b.counts.total, 2);
  assert.equal(b.counts.waiting, 1);
  assert.equal(b.sessions[0].project.matched, 'auto');
  assert.equal(b.sessions[0].canResume, false, 'waiting');
  assert.equal(b.sessions[1].canResume, true);
  assert.deepEqual(b.sessions[1].tokens, { in: 100, out: 200, cacheRead: 3000 });
  assert.equal(b.sessions[1].activeMin, 30);
  assert.equal(b.codex.count, 20);
  assert.equal(b.state, 'ok');
  assert.equal(C.limitLine(b.limitStops), 'limit stops in the last 7 days: 1 (last: weekly limit, Nov 2)');
});

test('buildBoard: no codex, no rows, an error', () => {
  const b = C.buildBoard({ rows: [], details: {}, projects: {}, now: NOW, state: 'hub-down', error: 'x'.repeat(500) });
  assert.equal(b.codex, null);
  assert.deepEqual(b.sessions, []);
  assert.equal(b.state, 'hub-down');
  assert.equal(b.error.length, 300);
  assert.equal(C.limitLine(b.limitStops), 'limit stops in the last 7 days: 0');
});

test('buildBoard is deterministic and the signature ignores generatedAt', () => {
  const rows = [row('a')], details = { 'code:a': [say(10 * MIN)] };
  const one = board(rows, details), two = C.buildBoard({ rows, details, projects: {}, now: NOW });
  assert.equal(C.boardSignature(board(rows, details)), C.boardSignature(one));
  const later = C.buildBoard({ rows, details, projects: {}, now: NOW + 1000 });
  assert.equal(C.boardSignature(two).includes('generatedAt'), false);
  assert.equal(C.boardSignature(later) === C.boardSignature(two) || later.sessions[0].sentence !== two.sessions[0].sentence, true);
});

test('homeStrip: running, waiting, stopped in the last 2 h; at most 3; none when only quiet', () => {
  const rows = [
    row('r', { last_at: at(30e3) }), row('w', { last_at: at(20 * MIN) }), row('s', { last_at: at(90 * MIN) }),
    row('l', { last_at: at(80 * MIN) }), row('f', { last_at: at(15 * MIN) }), row('o', { last_at: at(3 * H) }),
  ];
  const details = {
    'code:r': [tool(30e3)], 'code:w': [tool(20 * MIN)], 'code:s': [turn('user', 90 * MIN)],
    'code:l': [say(80 * MIN, "You've hit your limit \u00b7 resets 3pm")], 'code:f': [say(15 * MIN)], 'code:o': [tool(3 * H)],
  };
  const strip = C.homeStrip(board(rows, details), NOW);
  assert.deepEqual(strip.map((s) => s.id), ['r', 'w', 'l']);
  const quiet = board([row('f', { last_at: at(15 * MIN) })], { 'code:f': [say(15 * MIN)] });
  assert.deepEqual(C.homeStrip(quiet, NOW), []);
  assert.deepEqual(C.homeStrip(null, NOW), []);
});

test('ago ladder', () => {
  assert.equal(C.ago(NOW - 10e3, NOW), 'just now');
  assert.equal(C.ago(NOW - 90 * MIN, NOW), '2 h ago');
  assert.equal(C.ago(NOW - 49 * H, NOW), '2 d ago');
  assert.equal(C.ago(NaN, NOW), 'age unknown');
});
