// node --test dashboard/claude-launch.test.mjs — the Claude terminal launcher
// shared by hq:claude-quest and the snip bar's "send to Claude" (K-5).
// Nothing here opens a terminal or starts Claude: spawnSync is a recording fake, except in
// the end-to-end cmd.exe test at the bottom, which runs the real cmd parse with `start /b`
// (no window) against a fake claude.cmd on a PATH that cannot reach the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { launchClaudeTerminal, sanitizePrompt, promptEnvValue, PROMPT_MAX, HELPER } = require('./claude-launch.js');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-claude-launch-'));   // stands in for a project folder
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

function fakes(env = {}) {
  const spawns = [], logs = [];
  return {
    spawns, logs,
    opts: { env, log: (l) => logs.push(l), spawnSync: (...a) => { spawns.push(a); return { status: 0 }; } },
  };
}

// ---------------------------------------------------------------- dry launch
test('HQ_DRY_LAUNCH=1 logs "[dry-launch] <cwd> :: <prompt>", spawns nothing, returns true', () => {
  const f = fakes({ HQ_DRY_LAUNCH: '1' });
  const shot = path.join(DIR, 'shots', 'snip-1.png');
  assert.equal(launchClaudeTerminal(DIR, `Look at this screenshot: ${shot} — `, f.opts), true);
  assert.deepEqual(f.spawns, []);
  assert.deepEqual(f.logs, [`[dry-launch] ${DIR} :: Look at this screenshot: ${shot} — `]);
});

test('the dry log carries the SANITIZED prompt (what claude would really get)', () => {
  const f = fakes({ HQ_DRY_LAUNCH: '1' });
  launchClaudeTerminal(DIR, 'fix "the" thing\r\nnow', f.opts);
  assert.deepEqual(f.logs, [`[dry-launch] ${DIR} :: fix 'the' thing now`]);
});

test('only the exact value "1" is a dry launch', () => {
  for (const v of ['0', 'true', 'yes', '', undefined]) {
    const f = fakes(v === undefined ? {} : { HQ_DRY_LAUNCH: v });
    assert.equal(launchClaudeTerminal(DIR, 'hi', f.opts), true, String(v));
    assert.equal(f.spawns.length, 1, `HQ_DRY_LAUNCH=${v} launches for real`);
    assert.deepEqual(f.logs, []);
  }
});

test('HQ_DRY_LAUNCH is read from process.env on every call (no opts.env)', () => {
  const prev = process.env.HQ_DRY_LAUNCH;
  const spawns = [], logs = [];
  const opts = { log: (l) => logs.push(l), spawnSync: (...a) => { spawns.push(a); return {}; } };
  try {
    process.env.HQ_DRY_LAUNCH = '1';
    assert.equal(launchClaudeTerminal(DIR, 'a', opts), true);
    delete process.env.HQ_DRY_LAUNCH;
    assert.equal(launchClaudeTerminal(DIR, 'b', opts), true);
  } finally {
    if (prev === undefined) delete process.env.HQ_DRY_LAUNCH; else process.env.HQ_DRY_LAUNCH = prev;
  }
  assert.deepEqual(logs, [`[dry-launch] ${DIR} :: a`]);
  assert.equal(spawns.length, 1);
});

// ---------------------------------------------------------------- real launch
test('a real launch: a fixed verbatim start line; the folder and prompt travel as cwd + env only', () => {
  const f = fakes({ KEEP: 'me' });
  assert.equal(launchClaudeTerminal(DIR, 'Put Project A under version control', f.opts), true);
  assert.equal(f.spawns.length, 1);
  const [file, args, o] = f.spawns[0];
  assert.equal(file, 'cmd.exe');
  assert.deepEqual(args, [`/d /v:off /c start "" cmd /d /v:off /k "${HELPER}"`]);
  assert.equal(o.cwd, DIR);
  assert.equal(o.windowsVerbatimArguments, true, 'no \\" re-quoting of the cmd line (it broke `cd /d`)');
  assert.equal(o.windowsHide, false);
  assert.equal(o.env.HQ_LAUNCH_PROMPT, 'Put Project A under version control');
  assert.equal(o.env.KEEP, 'me', 'the rest of the environment is passed through');
});

test('neither the prompt nor the folder ever appears on the cmd command line (injection regression)', () => {
  const f = fakes({});
  const weird = path.join(DIR, 'R&D %OS% !x! (y)');
  fs.mkdirSync(weird, { recursive: true });
  launchClaudeTerminal(weird, 'x" & calc.exe & "', f.opts);
  const [, args, o] = f.spawns[0];
  assert.ok(!args[0].includes('calc') && !args[0].includes('R&D'), args[0]);
  assert.equal(o.cwd, weird);
  assert.equal(o.env.HQ_LAUNCH_PROMPT, "x' & calc.exe & '");
});

test('the helper batch file exists and expands the prompt only inside quotes, delayed expansion off', () => {
  const body = fs.readFileSync(HELPER, 'utf8');
  const code = body.split(/\r?\n/).filter((l) => l.trim() && !/^@?rem\b/i.test(l.trim()));
  assert.deepEqual(code, ['@setlocal DisableDelayedExpansion', '@claude "%HQ_LAUNCH_PROMPT%"']);
});

test('a missing helper or one at an unsafe path refuses (false, nothing spawned or logged)', () => {
  for (const helper of [path.join(DIR, 'nope.cmd'), 'C:\\a&b\\claude-launch.cmd', 'C:\\100%\\claude-launch.cmd']) {
    for (const dry of ['1', '0']) {
      const f = fakes({ HQ_DRY_LAUNCH: dry });
      assert.equal(launchClaudeTerminal(DIR, 'x', { ...f.opts, helper }), false, helper);
      assert.deepEqual(f.spawns, []);
      assert.deepEqual(f.logs, []);
    }
  }
});

test('promptEnvValue doubles only a trailing backslash run (Windows argv rules before the closing quote)', () => {
  assert.equal(promptEnvValue('a\\b'), 'a\\b');
  assert.equal(promptEnvValue('a\\'), 'a\\\\');
  assert.equal(promptEnvValue('a\\\\'), 'a\\\\\\\\');
  assert.equal(promptEnvValue(''), '');
});

test('a failed spawn (error or throw) → false', () => {
  assert.equal(launchClaudeTerminal(DIR, 'x', { env: {}, spawnSync: () => ({ error: new Error('ENOENT') }) }), false);
  assert.equal(launchClaudeTerminal(DIR, 'x', { env: {}, spawnSync: () => { throw new Error('boom'); } }), false);
});

// ---------------------------------------------------------------- refusals
test('refuses (false, nothing spawned or logged) a cwd that is missing, relative, a file or not a string', () => {
  const file = path.join(DIR, 'README.md');
  fs.writeFileSync(file, '# Project A\n');
  for (const dry of ['1', '0']) {
    for (const cwd of [path.join(DIR, 'nope'), 'project-a', file, '', null, 42, `${DIR}"`]) {
      const f = fakes({ HQ_DRY_LAUNCH: dry });
      assert.equal(launchClaudeTerminal(cwd, 'x', f.opts), false, `${dry} ${cwd}`);
      assert.deepEqual(f.spawns, []);
      assert.deepEqual(f.logs, []);
    }
  }
});

// ---------------------------------------------------------------- sanitizePrompt
test('sanitizePrompt: one line, no double quotes, capped', () => {
  assert.equal(sanitizePrompt('a\nb\r\n\tc'), 'a b c');
  assert.equal(sanitizePrompt('say "hi"'), "say 'hi'");
  assert.equal(sanitizePrompt(null), '');
  assert.equal(sanitizePrompt(undefined), '');
  assert.equal(sanitizePrompt(7), '7');
  assert.equal(sanitizePrompt('y'.repeat(PROMPT_MAX + 50)).length, PROMPT_MAX);
  assert.equal(PROMPT_MAX, 500);
});

// ---------------------------------------------------------------- end to end through cmd.exe
// The real cmd parse, made harmless: the spawn seam turns `start ""` into `start "" /b /wait`
// (same parse, no new window, waits) and `/k` into `/c` (exits). PATH holds ONLY a temp dir with
// a fake claude.cmd shaped like npm's shim (SETLOCAL + %*) plus System32, and the current folder
// is not searched, so the real claude can never run. The fake records the argv and folder it got.
test('end to end: claude receives exactly the sanitized prompt, in the project folder, with no injection', { skip: process.platform !== 'win32' && 'cmd.exe only' }, () => {
  const BS = '\\';
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-claude-e2e-'));
  try {
    const bin = path.join(base, 'fakebin');
    fs.mkdirSync(bin);
    const out = path.join(base, 'argv.jsonl');
    fs.writeFileSync(path.join(bin, 'printer.js'),
      `require('fs').appendFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n');`);
    fs.writeFileSync(path.join(bin, 'claude.cmd'), ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start',
      'SETLOCAL', 'CALL :find_dp0', `"${process.execPath}" "%dp0%printer.js"   %*`, ''].join('\r\n'));
    const root = process.env.SystemRoot || 'C:\\Windows';
    const env = { SystemRoot: root, PATH: `${bin};${path.join(root, 'System32')}`, PATHEXT: '.COM;.EXE;.BAT;.CMD',
      NoDefaultCurrentDirectoryInExePath: '1', TEMP: os.tmpdir(), TMP: os.tmpdir(), OS: 'Windows_NT' };
    const marker = path.join(base, 'INJECTED.txt');
    const seam = (file, args, o) => {
      let a = args.slice();
      if (a.length === 1) a = [a[0].replace('start ""', 'start "" /b /wait').replace(' /k ', ' /c ')];
      else { a.splice(a.indexOf('start') + 2, 0, '/b', '/wait'); a[a.lastIndexOf('/k')] = '/c'; }   // pre-fix argv shape
      return childProcess.spawnSync(file, a, { ...o, env: { ...env, ...(o && o.env) }, encoding: 'utf8', input: '', timeout: 30000 });
    };
    const prompts = [
      'plain prompt', `a & type nul > ${marker} & rem`, `a | type nul > ${marker}`, 'x < y > z', 'caret ^ here ^',
      'pct %OS% and %PATH%', 'bang !OS! lone ! end', 'paren ( ) @ amp &', 'say "hi" now', `trailing ${BS}`, `two ${BS}${BS}`,
      `Look at this screenshot: C:${BS}x y${BS}snip 1.png — `, 'café ✓', '',
    ];
    const cases = prompts.map((p) => ['proj dir', p])
      .concat(['R&D proj', 'bang!x!dir', 'pct %OS% dir', 'caret ^ (dir)'].map((d) => [d, 'build & deploy']));
    for (const [dirName, prompt] of cases) {
      const dir = path.join(base, dirName);
      fs.mkdirSync(dir, { recursive: true });
      fs.rmSync(out, { force: true });
      assert.equal(launchClaudeTerminal(dir, prompt, { env, spawnSync: seam }), true, `${dirName} :: ${prompt}`);
      const lines = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n') : [];
      assert.equal(lines.length, 1, `claude ran exactly once for ${JSON.stringify([dirName, prompt])}`);
      assert.deepEqual(JSON.parse(lines[0]), { argv: [sanitizePrompt(prompt)], cwd: dir }, JSON.stringify([dirName, prompt]));
    }
    assert.equal(fs.existsSync(marker), false, 'no prompt text ever ran as a command');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
