// The sessions board (Claude › Sessions) and Home strip: actions, honest states, render values, and a static check that every
// key the templates read exists in the vals. Rig in the logic/brief.test.mjs style: a never-mounted object over the real mixin
// and vals, a fake window.hq. Placeholder data only (the repo is public).
//   node --test dashboard-v5/src/logic/sessions-board.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionsBoardLogic } from './sessions-board.js';
import { sessionsBoardVals } from '../vals/sessions-board.js';
import boardTpl from '../tpl/sessions-board.tpl.js';
import stripTpl from '../tpl/sessions-strip.tpl.js';
import { resetMemo } from '../live/sessions-view.mjs';

process.env.TZ = 'UTC';
globalThis.window = globalThis.window || { HQFx: { sfx() {} } };

const GEN = Date.parse('2026-11-05T12:00:00.000Z');
const MIN = 60e3, H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const sess = (n, state, o = {}) => ({ id: 'id' + n, title: 'Session ' + n, project: { id: null, name: 'alpha-site', matched: 'folder' }, branch: 'main', cwdLabel: 'alpha-site',
  startedAt: iso(GEN - 3 * H), lastAt: iso(GEN - 10 * MIN), activeMin: 45, messages: 12, tokens: { in: 1200, out: 3400, cacheRead: 2500000 },
  state, sentence: 'sentence for ' + state, longRun: false, canResume: state === 'finished', canOpen: true, ...(state !== 'finished' ? { why: 'not now' } : {}), ...o });
const board = (sessions, o = {}) => ({ v: 1, generatedAt: iso(GEN), state: 'ok', sessions, nightly: { count: 2, lastAt: iso(GEN - 2 * H) }, codex: { count: 20, lastAt: iso(GEN - 3 * 24 * H) },
  limitStops: { days: 7, count: 3, last: { kind: 'weekly', at: iso(GEN - 2 * 24 * H) } }, counts: { total: sessions.length, running: 1, waiting: 1, stopped: 1, limit: 0, finished: 1, quiet: 0 }, ...o });
const EIGHT = ['running', 'waiting-tool', 'stopped-mid-tool', 'no-reply', 'limit', 'api-error', 'finished', 'quiet'].map((s, i) => sess(i, s));

function rig(o = {}) {
  const calls = [], toasts = [], copies = [], marks = [];
  const self = Object.assign(Object.create(sessionsBoardLogic), {
    state: { tab: 'claude', sub: { claude: 'sessions' }, route: null, reduceMotion: false, sbdBusy: [], ...(o.state || {}) },
    setState(p) { this.state = { ...this.state, ...(typeof p === 'function' ? p(this.state) : p) }; },
    toast: (k, t) => toasts.push([k, t]),
    copy: (text, msg) => copies.push([text, msg]),
    LIVE: { board: o.live === undefined ? { board: board(EIGHT), error: '', loaded: true } : o.live },
    hq: o.noBridge ? null : { sessionsBoard: { read() {}, resume() {}, openFolder: async (id) => { calls.push(['openFolder', id]); return o.openResult || { ok: true }; }, onBoard() {} } },
    store: {
      resumeSession: async (id, opts) => { calls.push(['resume', id, opts]); await (o.gate || Promise.resolve()); if (o.reject) throw new Error('bridge down'); return o.resume || { ok: true }; },
      refreshBoard: () => { calls.push(['refresh']); return Promise.resolve(); },
    },
    go: (tab, sub) => calls.push(['go', tab, sub]),
    useMark: o.noMark ? undefined : (n, a) => marks.push(a && a !== 'open' ? n + '/' + a : n),
  });
  const vals = (extra = {}) => sessionsBoardVals.call(self, { S: self.state, LIVE: self.LIVE, live: true, ...extra });
  return { self, calls, toasts, copies, marks, vals };
}

test.beforeEach(() => resetMemo());

test('every key is sbd-prefixed (one shared namespace with the other surfaces)', () => {
  const { vals } = rig();
  for (const k of Object.keys(vals())) assert.match(k, /^sbd[A-Z]/, k);
  const home = rig({ state: { tab: 'home', sub: {} } }).vals();
  for (const k of Object.keys(home)) assert.match(k, /^sbd[A-Z]/, k);
});

test('a double click on Resume sends one call; main\'s answer is told', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { self, calls, toasts, marks } = rig({ gate });
  const a = self.sbdResume('id6');
  const b = self.sbdResume('id6');
  assert.deepEqual(self.state.sbdBusy, ['id6']);
  release();
  assert.deepEqual(await Promise.all([a, b]), [true, false]);
  assert.equal(calls.filter((c) => c[0] === 'resume').length, 1);
  assert.deepEqual(calls[0], ['resume', 'id6', {}]);
  assert.deepEqual(self.state.sbdBusy, []);
  assert.deepEqual(marks, ['sessions-board/resume']);
  assert.equal(toasts[0][0], 'success');
  await self.sbdResume('id6');
  assert.equal(calls.filter((c) => c[0] === 'resume').length, 2, 'the id is free again once main answered');
});

test('Resume and say continue sends exactly {say:"continue"}; anything else sends nothing extra', async () => {
  const { self, calls } = rig();
  await self.sbdResume('id6', 'continue');
  await self.sbdResume('id6', 'rm -rf');
  assert.deepEqual(calls.map((c) => c[2]), [{ say: 'continue' }, {}]);
});

test('a refusal toasts main\'s reason and keeps the cards', async () => {
  const { self, toasts, vals } = rig({ resume: { error: 'refused: the folder is a drive root' } });
  assert.equal(await self.sbdResume('id6'), false);
  assert.deepEqual(toasts, [['error', 'Not resumed · refused: the folder is a drive root']]);
  assert.equal(vals().sbdCards.length, 8, 'a refused resume never blanks the cards');
});

test('a thrown bridge error is told, not unhandled', async () => {
  const { self, toasts } = rig({ reject: true });
  assert.equal(await self.sbdResume('id6'), false);
  assert.equal(toasts[0][1], 'Not resumed · bridge down');
  assert.deepEqual(self.state.sbdBusy, []);
});

test('no bridge: Resume and Open folder say so and call nothing', async () => {
  const { self, calls, toasts } = rig({ noBridge: true });
  assert.equal(await self.sbdResume('id6'), false);
  assert.equal(await self.sbdOpenFolder('id6'), false);
  assert.deepEqual(calls, []);
  assert.deepEqual(toasts.map((t) => t[1]), ['The sessions board needs the desktop app', 'The sessions board needs the desktop app']);
});

test('Open folder and Copy resume command', async () => {
  const { self, calls, copies, toasts } = rig();
  assert.equal(await self.sbdOpenFolder('id6'), true);
  assert.deepEqual(calls, [['openFolder', 'id6']]);
  const bad = rig({ openResult: { error: 'refused: that session is not on the board' } });
  assert.equal(await bad.self.sbdOpenFolder('zzz'), false);
  assert.match(bad.toasts[0][1], /not on the board/);
  self.sbdCopyCommand('id6', 'alpha-site');
  assert.equal(copies[0][0], 'claude --resume id6 --permission-mode default');
  assert.match(copies[0][1], /alpha-site folder/);
  assert.deepEqual(toasts, []);
});

test('arriving marks the board open and refreshes; the strip is marked only where it renders; a missing useMark is harmless', () => {
  const { self, calls, marks, vals } = rig();
  self.sbdArrive('board'); self.sbdArrive('strip');
  assert.deepEqual(marks, ['sessions-board'], 'arriving on Home marks nothing by itself');
  assert.equal(calls.filter((c) => c[0] === 'refresh').length, 2);
  const home = rig({ state: { tab: 'home', sub: {}, route: null } });
  assert.equal(home.vals().sbdStripShow, true);
  assert.deepEqual(home.marks, ['sessions-strip'], 'the strip marks itself while it shows');
  const quiet = rig({ state: { tab: 'home', sub: {}, route: null }, live: { board: { v: 1, generatedAt: '2026-11-05T12:00:00.000Z', state: 'ok', sessions: [], nightly: { count: 0, lastAt: null }, codex: null, limitStops: { days: 7, count: 0, last: null }, counts: {} }, error: '', loaded: true } });
  assert.equal(quiet.vals().sbdStripShow, false);
  assert.deepEqual(quiet.marks, [], 'no strip, no mark');
  const none = rig({ noMark: true });
  assert.doesNotThrow(() => none.self.sbdArrive('board'));
});

test('Chats: a Code chat resumes; a missing transcript is remembered and the caller falls back to a fresh session', async () => {
  const conv = { id: 'code:11111111-1111-4111-8111-111111111111', source: 'code' };
  const f = rig({ resume: { error: 'Claude Code deleted this transcript (older than 30 days) — read it in Claude › Chats' } });
  assert.equal(f.self.sbdChatCan(conv), true);
  assert.equal(f.self.sbdChatCan({ id: 'web:abc', source: 'web' }), false);
  assert.equal(f.self.sbdChatCan({ id: 'code:nope', source: 'code' }), false);
  assert.equal(f.self.sbdChatGone(conv), '');
  assert.equal(await f.self.sbdChatResume(conv), false);
  assert.match(f.self.sbdChatGone(conv), /older than 30 days/);
  assert.equal(await f.self.sbdChatResume(conv), null, 'now the caller keeps the fresh-session button');
  assert.equal(f.calls.filter((c) => c[0] === 'resume').length, 1);
  assert.equal(await f.self.sbdChatResume({ id: 'web:abc', source: 'web' }), null);
  const ok = rig();
  assert.equal(await ok.self.sbdChatResume(conv), true);
  assert.equal(ok.calls[0][1], conv.id, 'the Hub id goes through; main strips the code: prefix');
});

// ------------------------------------------------------------------ vals
test('off-tab the vals are frozen constants (no board is read on another tab)', () => {
  const a = rig({ state: { tab: 'money', sub: {} } }).vals();
  const b = rig({ state: { tab: 'projects', sub: {} } }).vals();
  assert.equal(a.sbdCards, b.sbdCards, 'the very same constant array');
  assert.equal(a.sbdStripCards, b.sbdStripCards);
  assert.equal(a.sbdReady, false);
  assert.equal(a.sbdStripShow, false);
  assert.ok(Object.isFrozen(a.sbdLanes) || a.sbdLanes.length === 0);
  const other = rig({ state: { tab: 'claude', sub: { claude: 'chats' } } }).vals();
  assert.equal(other.sbdCards, a.sbdCards);
});

test('honest states: no bridge · loading · error · hub down · empty', () => {
  assert.equal(rig({ noBridge: true }).vals().sbdOffline, true);
  assert.equal(rig({ noBridge: true }).vals().sbdOfflineText, 'The sessions board needs the desktop app');
  assert.equal(rig({ live: { board: null, error: '', loaded: false } }).vals().sbdLoading, true);
  const err = rig({ live: { board: null, error: 'hub exploded', loaded: true } }).vals();
  assert.equal(err.sbdError, true);
  assert.equal(err.sbdErrorText, 'hub exploded');
  assert.equal(err.sbdLoading, false);

  const down = rig({ live: { board: board(EIGHT, { state: 'hub-down', error: 'x' }), error: '', loaded: true } }).vals();
  assert.equal(down.sbdNote, true);
  assert.equal(down.sbdNoteText, 'Claude Hub isn’t running — showing the board from 12:00');
  assert.ok(down.sbdCards.every((c) => c.canResume === false && c.canOpen === false), 'read-only');
  assert.ok(down.sbdCards.length === 8, 'the last sessions stay');
  const never = rig({ live: { board: board([], { state: 'hub-down', nightly: { count: 0, lastAt: null }, codex: null }), error: '', loaded: true } }).vals();
  assert.equal(never.sbdNoteText, 'Claude Hub isn’t running — nothing yet');
  assert.equal(never.sbdEmpty, false, 'a down hub is not "no sessions"');
  const starting = rig({ live: { board: board([], { state: 'starting' }), error: '', loaded: true } }).vals();
  assert.match(starting.sbdNoteText, /^Claude Hub is starting — nothing yet$/);

  const empty = rig({ live: { board: board([], { nightly: { count: 0, lastAt: null }, codex: null }), error: '', loaded: true } }).vals();
  assert.equal(empty.sbdEmpty, true);
  assert.equal(empty.sbdEmptyText, 'No Claude Code session in the last 24 hours');
  assert.equal(empty.sbdReady, false);
  assert.equal(empty.sbdHasLimitLine, true, 'the 7-day limit line still stands');
});

test('a failed refresh shows its error but keeps the cards below it', () => {
  const v = rig({ live: { board: board(EIGHT), error: 'refresh failed', loaded: true } }).vals();
  assert.equal(v.sbdError, true);
  assert.equal(v.sbdCards.length, 8);
});

test('the ready board: summary, limit line, lanes (8 + nightly + Codex), cards with the right sentences', () => {
  const v = rig().vals();
  assert.equal(v.sbdReady, true);
  assert.equal(v.sbdSummary, '8 sessions in the last 24 h · 1 running · 1 waiting · 1 stopped');
  assert.equal(v.sbdLimitLine, 'limit stops in the last 7 days: 3 (last: weekly limit, Nov 3)');
  assert.equal(v.sbdLanes.length, 10);
  assert.deepEqual(v.sbdLanes.slice(-2).map((l) => l.label), ['nightly scan runs (2)', 'Codex (20 threads · last 3 d ago)']);
  assert.equal(v.sbdLanes.filter((l) => l.capShow).length, 1, 'only the running lane has an end-cap');
  assert.equal(v.sbdLanes.filter((l) => l.pulse).length, 1);
  assert.equal(v.sbdAnimate, true);
  assert.match(v.sbdSvgViewBox, /^0 0 960 \d+$/);
  assert.equal(v.sbdCards[0].sentence, 'sentence for running');
  assert.equal(v.sbdCards[0].stateLabel, 'running');
  assert.equal(v.sbdCards[6].stateLabel, 'finished');
  assert.equal(v.sbdCards[0].tokens, '1k in · 3k out · 2.5M cache read');
  assert.equal(v.sbdCards[0].tokensLabel, 'whole session');
  assert.equal(v.sbdCards[0].active, '45 min active');
  assert.equal(v.sbdCards[0].activeTitle, 'active time, from gaps under 5 min');
  assert.equal(v.sbdCards[0].started, 'started 3 h ago');
});

test('Reduce motion keeps the end-cap but stops the pulse', () => {
  const v = rig({ state: { reduceMotion: true } }).vals();
  assert.equal(v.sbdAnimate, false);
  assert.equal(v.sbdLanes.filter((l) => l.capShow).length, 1);
  assert.equal(v.sbdLanes.filter((l) => l.pulse).length, 0);
});

test('Resume is offered only where main says canResume, and is greyed while busy', () => {
  const v = rig().vals();
  assert.deepEqual(v.sbdCards.map((c) => c.canResume), [false, false, false, false, false, false, true, false]);
  assert.equal(v.sbdCards[6].resumeNote, 'opens a new terminal that continues this chat — close the old window first if it’s still open');
  assert.equal(v.sbdCards[0].resumeNote, 'not now');
  assert.equal(v.sbdCards[0].hasResumeNote, true);
  const busy = rig({ state: { sbdBusy: ['id6'] } }).vals();
  assert.equal(busy.sbdCards[6].canResume, false);
  assert.equal(busy.sbdCards[6].busy, true);
});

test('project notes: auto-matched, not a scanned project, confirmed says nothing', () => {
  const ss = [sess(0, 'finished', { project: { id: 'a', name: 'alpha', matched: 'confirmed' } }), sess(1, 'finished', { project: { id: 'a', name: 'alpha', matched: 'auto' } }), sess(2, 'finished')];
  const v = rig({ live: { board: board(ss), error: '', loaded: true } }).vals();
  assert.deepEqual(v.sbdCards.map((c) => c.projectNote), ['', 'auto-matched', 'not a scanned project']);
});

test('the Home strip: up to 3, running first, only the last 2 h; absent when nothing is hot or the app is on an older scan', () => {
  const hot = [sess(0, 'finished'), sess(1, 'stopped-mid-tool', { lastAt: iso(GEN - 90 * MIN) }), sess(2, 'running', { lastAt: iso(GEN - 20e3) }), sess(3, 'waiting-tool'), sess(4, 'limit', { lastAt: iso(GEN - 30 * MIN) }), sess(5, 'api-error', { lastAt: iso(GEN - 3 * H) })];
  const f = rig({ state: { tab: 'home', sub: {} }, live: { board: board(hot), error: '', loaded: true } });
  const v = f.vals();
  assert.equal(v.sbdStripShow, true);
  assert.deepEqual(v.sbdStripCards.map((c) => c.key), ['id2', 'id3', 'id4']);
  v.sbdStripCards[0].go();
  assert.deepEqual(f.calls.pop(), ['go', 'claude', 'sessions']);
  assert.equal(v.sbdStripHasNote, false);
  const quiet = rig({ state: { tab: 'home', sub: {} }, live: { board: board([sess(0, 'finished'), sess(1, 'quiet')]), error: '', loaded: true } }).vals();
  assert.equal(quiet.sbdStripShow, false);
  assert.deepEqual(quiet.sbdStripCards, []);
  assert.equal(f.vals({ live: false }).sbdStripShow, false, 'viewing an older scan hides the strip');
  const stale = rig({ state: { tab: 'home', sub: {} }, live: { board: board(hot, { state: 'hub-down' }), error: '', loaded: true } }).vals();
  assert.equal(stale.sbdStripHasNote, true);
  assert.match(stale.sbdStripNote, /^from the 12:00 board/);
});

// ------------------------------------------------------------------ templates
// dc-lite throws a "hole" for a key the vals do not provide; check that statically for both fragments.
// walks the raw template in order (tags and attribute bindings alike), tracking the sc-for scopes; true / false are the hint literals
function scanAll(tpl, vals) {
  const bad = new Set();
  const scopes = [];
  const re = /<sc-for\s+list="\{\{\s*([\w.]+)\s*\}\}"\s+as="(\w+)"|<\/sc-for>|\{\{\s*!?\s*([\w.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(tpl))) {
    if (m[1]) { if (!(m[1] in vals)) bad.add(m[1]); scopes.push({ as: m[2], sample: (vals[m[1]] || [])[0] }); }
    else if (m[0] === '</sc-for>') scopes.pop();
    else {
      if (m[3] === 'true' || m[3] === 'false') continue;
      const [head, ...rest] = m[3].split('.');
      const scope = scopes.slice().reverse().find((s) => s.as === head);
      if (scope) { if (scope.sample && !(rest[0] in scope.sample)) bad.add(m[3]); }   // an empty list renders nothing
      else if (!(head in vals)) bad.add(m[3]);
    }
  }
  return [...bad];
}

test('the board template reads only keys the vals provide, in every state', () => {
  const states = [rig().vals(), rig({ noBridge: true }).vals(), rig({ live: { board: null, error: 'x', loaded: true } }).vals(),
    rig({ live: { board: board([], { nightly: { count: 0, lastAt: null }, codex: null }), error: '', loaded: true } }).vals()];
  for (const v of states) assert.deepEqual(scanAll(boardTpl, v), []);
  assert.ok(boardTpl.includes('Sessions board'));
});

test('the strip template reads only keys the vals provide, shown and hidden', () => {
  const hot = rig({ state: { tab: 'home', sub: {} }, live: { board: board([sess(0, 'running', { lastAt: iso(GEN - 10e3) })]), error: '', loaded: true } }).vals();
  assert.equal(hot.sbdStripShow, true);
  assert.deepEqual(scanAll(stripTpl, hot), []);
  assert.deepEqual(scanAll(stripTpl, rig({ state: { tab: 'money', sub: {} } }).vals()), []);
});

test('the templates use tokens only: no raw colours except the gold button ink', () => {
  for (const tpl of [boardTpl, stripTpl]) {
    const raw = (tpl.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []).filter((c) => c.toLowerCase() !== '#1a0f0a');
    assert.deepEqual(raw, []);
  }
});
