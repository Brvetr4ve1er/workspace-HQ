// dashboard/claude-chat.e2e.test.mjs — real cmd.exe + the npm-shaped fake claude.cmd (never the real CLI)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeFakeClaude } from './__fixtures__/make-fake-claude.mjs';
const require = createRequire(import.meta.url);
const { createChat, resolveClaudeBin, buildArgs, EVENT } = require('./claude-chat.js');

const WIN = { skip: process.platform !== 'win32' && 'cmd.exe only', timeout: 60000 };
const until = async (cond, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function setup(mode) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-chat-e2e-'));
  const fake = makeFakeClaude(base);
  const proj = path.join(base, 'project a & b');   // a folder name cmd would choke on if it ever reached a command line
  fs.mkdirSync(proj);
  const pidFile = path.join(base, 'fake.pid');
  const env = fake.env({ FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_PIDFILE: pidFile });
  const pushed = [];
  const chat = createChat({
    resolve: async (req) => ({ cwd: proj, sessionId: req.sessionId || null, key: null, prompt: req.text, seeded: null }),
    bin: () => resolveClaudeBin(env), env, send: (ch, d) => pushed.push([ch, d]), turnMs: 30000,
  });
  const ev = (id) => pushed.filter(([ch, d]) => ch === EVENT && d.turnId === id).map(([, d]) => d);
  const records = () => (fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { base, fake, proj, pidFile, env, chat, ev, records, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('e2e: the fake resolves (never the real claude), gets the exact argv, the prompt on stdin, the project folder', WIN, async () => {
  const s = setup('ok');
  try {
    assert.equal(resolveClaudeBin(s.env).cmd, s.fake.bin);
    const prompt = 'a & calc | "x" %OS% !OS! ^ <y> café 🚀\nsecond line';
    const { turnId } = await s.chat.send({ projectId: 'p', text: prompt, mode: 'read-only' });
    assert.ok(await until(() => s.ev(turnId).some((e) => e.kind === 'done' || e.kind === 'error')), 'the turn ended');
    const rec = s.records();
    assert.equal(rec.length, 1);
    assert.deepEqual(rec[0].argv, buildArgs({ mode: 'read-only' }));
    assert.equal(rec[0].stdin, prompt);
    assert.equal(path.resolve(rec[0].cwd).toLowerCase(), path.resolve(s.proj).toLowerCase());
    const kinds = s.ev(turnId).map((e) => e.kind);
    assert.equal(kinds[0], 'session'); assert.equal(kinds[kinds.length - 1], 'done');
    assert.equal(s.ev(turnId).filter((e) => e.kind === 'delta').map((e) => e.text).join(''), 'Placeholder answer from the fake claude.');
    assert.deepEqual(s.ev(turnId).pop().usage, { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 });
  } finally { s.done(); }
});

test('e2e: Allow edits passes acceptEdits, a resume id passes --resume, nothing ever bypasses', WIN, async () => {
  const s = setup('ok');
  try {
    const SID = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
    const { turnId } = await s.chat.send({ projectId: 'p', sessionId: SID, text: 'x', mode: 'edits' });
    assert.ok(await until(() => s.ev(turnId).some((e) => e.kind === 'done')));
    const argv = s.records()[0].argv;
    assert.deepEqual(argv, buildArgs({ mode: 'edits', sessionId: SID }));
    assert.ok(!argv.join(' ').includes('bypass') && !argv.join(' ').includes('dangerously'));
    assert.equal(s.ev(turnId).find((e) => e.kind === 'session').sessionId, SID);
  } finally { s.done(); }
});

test('e2e: Stop on a hanging turn ends the whole tree — the fake node process is gone, one done{stopped}', WIN, async () => {
  const s = setup('hang');
  try {
    const { turnId } = await s.chat.send({ projectId: 'p', text: 'hang', mode: 'read-only' });
    assert.ok(await until(() => fs.existsSync(s.pidFile) && fs.readFileSync(s.pidFile, 'utf8').trim()), 'the fake started');
    const pid = Number(fs.readFileSync(s.pidFile, 'utf8').trim());
    assert.ok(alive(pid));
    assert.equal(s.chat.cancel(turnId), true);
    assert.ok(await until(() => s.ev(turnId).some((e) => e.kind === 'done')), 'the turn ended');
    assert.ok(await until(() => !alive(pid), 10000), 'no orphan: the fake claude process was stopped');
    const ends = s.ev(turnId).filter((e) => e.kind === 'done' || e.kind === 'error');
    assert.equal(ends.length, 1); assert.equal(ends[0].stopped, true);
    assert.ok(s.ev(turnId).some((e) => e.kind === 'delta' && e.text === 'Working'), 'the partial text had streamed');
  } finally { s.done(); }
});

test('e2e: a failing CLI says why', WIN, async () => {
  const s = setup('fail');
  try {
    const { turnId } = await s.chat.send({ projectId: 'p', text: 'x', mode: 'read-only' });
    assert.ok(await until(() => s.ev(turnId).some((e) => e.kind === 'error')));
    assert.equal(s.ev(turnId).pop().error, 'Claude Code exited with code 1: Placeholder failure');
  } finally { s.done(); }
});
