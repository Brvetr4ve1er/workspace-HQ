// The assistant's one log (dashboard/assist-audit.mjs). Temp folders only; placeholder data — the repo is public.
//   node --test dashboard/assist-audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { append, record, read, rotate, auditPath, MAX_BYTES, FILE_NAME } from './assist-audit.mjs';
import { auditEntry } from './assist-core.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-audit-'));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } };
const fields = (i = 0, extra = {}) => ({ at: Date.parse('2026-11-07T10:00:00Z') + i * 1000, door: 'mcp', tool: 'hq_capture', tier: 'note', ok: true, ms: 4, pid: 77, ...extra });

test('append and read back; the file name and shape are the contract', () => {
  const d = tmp();
  try {
    assert.equal(path.basename(auditPath(d)), 'assistant-audit.jsonl');
    assert.equal(FILE_NAME, 'assistant-audit.jsonl');
    assert.deepEqual(read(d), { entries: [], skipped: 0 }, 'no file yet is not an error');
    const e = record(d, fields(0));
    assert.deepEqual(e, auditEntry(fields(0)));
    assert.equal(append(d, auditEntry(fields(1, { tool: 'hq_brief', tier: 'read' }))), true);
    const r = read(d);
    assert.equal(r.skipped, 0);
    assert.deepEqual(r.entries.map((x) => x.tool), ['hq_capture', 'hq_brief']);
    assert.equal(fs.readFileSync(auditPath(d), 'utf8').split('\n').filter(Boolean).length, 2);
  } finally { rm(d); }
});

test('record creates a missing data folder and never throws, even when the folder cannot exist', () => {
  const d = tmp();
  try {
    const nested = path.join(d, 'not', 'yet');
    assert.ok(record(nested, fields()));
    assert.equal(read(nested).entries.length, 1);
    const blocker = path.join(d, 'a-file');
    fs.writeFileSync(blocker, 'x');
    assert.equal(record(path.join(blocker, 'data'), fields()), null);
    assert.deepEqual(read(path.join(blocker, 'data')), { entries: [], skipped: 0 });
  } finally { rm(d); }
});

test('rotation at 512 KB keeps exactly one .1 generation and loses no line across the pair', () => {
  const d = tmp();
  try {
    const file = auditPath(d);
    const line = JSON.stringify(auditEntry(fields(0))) + '\n';
    const n = Math.ceil(MAX_BYTES / line.length) + 5;
    fs.writeFileSync(file, line.repeat(n));                  // already past the threshold
    assert.ok(fs.statSync(file).size >= MAX_BYTES);
    record(d, fields(1));
    assert.ok(fs.existsSync(file + '.1'), 'old file renamed to .1');
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1, 'a fresh live file');
    assert.equal(read(d).entries.length, n + 1);
    // a second rotation replaces .1 — no .2, no third file
    fs.writeFileSync(file, line.repeat(n));
    record(d, fields(2));
    const names = fs.readdirSync(d).filter((x) => x.startsWith(FILE_NAME)).sort();
    assert.deepEqual(names, [FILE_NAME, FILE_NAME + '.1']);
    assert.equal(read(d).entries.length, n + 1, 'the first generation was dropped, the second kept');
    assert.equal(rotate(path.join(d, 'nothing-here')), false);
  } finally { rm(d); }
});

test('a torn or foreign line is skipped and counted, the lines around it still read', () => {
  const d = tmp();
  try {
    const good = JSON.stringify(auditEntry(fields(0))) + '\n';
    fs.writeFileSync(auditPath(d), good + '{"v":1,"at":"2026-11-07T10:0' + '\n' + 'not json\n' + '{"v":2,"tool":"x","at":"a"}\n' + '\n' + good);
    const r = read(d);
    assert.equal(r.entries.length, 2);
    assert.equal(r.skipped, 3);
  } finally { rm(d); }
});

test('two child processes appending 200 lines each leave 400 readable lines', async () => {
  const d = tmp();
  try {
    const here = pathToFileURL(fileURLToPath(new URL('./assist-audit.mjs', import.meta.url))).href;
    const code = `import(${JSON.stringify(here)}).then(({ record }) => { for (let i = 0; i < 200; i++) record(${JSON.stringify(d)}, { at: Date.now(), door: 'mcp', tool: 'hq_capture', tier: 'note', ok: true, ms: i, pid: process.pid }); });`;
    const run = () => new Promise((resolve, reject) => { const c = spawn(process.execPath, ['-e', code], { stdio: 'ignore' }); c.on('error', reject); c.on('close', (x) => (x === 0 ? resolve() : reject(new Error('child exit ' + x)))); });
    await Promise.all([run(), run()]);
    const r = read(d);
    assert.equal(r.skipped, 0);
    assert.equal(r.entries.length, 400);
    assert.equal(new Set(r.entries.map((e) => e.pid)).size, 2);
  } finally { rm(d); }
});

test('no free text reaches the file: extra fields on the call are dropped', () => {
  const d = tmp();
  try {
    record(d, { ...fields(0), text: 'captured thought', title: 'a title', path: 'C:/work/alpha-site', args: { x: 1 } });
    const raw = fs.readFileSync(auditPath(d), 'utf8');
    for (const s of ['captured thought', 'a title', 'alpha-site', 'args']) assert.ok(!raw.includes(s), s);
  } finally { rm(d); }
});
