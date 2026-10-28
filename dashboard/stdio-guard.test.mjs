// dashboard/stdio-guard.test.mjs — a closed console pipe silences the console once instead of crash-looping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { guardStdio, isPipeError } = require('./stdio-guard.js');

const pipeErr = (code = 'EPIPE') => Object.assign(new Error(`${code}: broken pipe, write`), { code });

function setup() {
  const proc = { stdout: new EventEmitter(), stderr: new EventEmitter() };
  const calls = [];
  const con = { log: () => calls.push('log'), error: () => calls.push('error'), warn: () => calls.push('warn') };
  const broken = [];
  const g = guardStdio({ proc, con, onBroken: (e) => broken.push(e.code) });
  return { proc, con, calls, broken, g };
}

test('an EPIPE on stdout silences every console method once and reports it once', () => {
  const { proc, con, calls, broken, g } = setup();
  con.log('before');
  proc.stdout.emit('error', pipeErr());
  proc.stderr.emit('error', pipeErr());
  con.log('x'); con.error('y'); con.warn('z');
  assert.deepEqual(calls, ['log']);
  assert.deepEqual(broken, ['EPIPE']);
  assert.equal(g.isBroken(), true);
});

test('handle() claims pipe errors from the uncaught handler and leaves real errors alone', () => {
  const { g, broken } = setup();
  assert.equal(g.handle(new TypeError('real bug')), false);
  assert.equal(g.isBroken(), false);
  assert.equal(g.handle(pipeErr('EOF')), true);
  assert.equal(g.handle(pipeErr()), true);
  assert.deepEqual(broken, ['EOF']);
});

test('isPipeError knows the stream-gone codes only', () => {
  for (const c of ['EPIPE', 'EOF']) assert.equal(isPipeError(pipeErr(c)), true);
  for (const c of ['ENOENT', 'EBADF', 'ERR_STREAM_DESTROYED']) assert.equal(isPipeError(pipeErr(c)), false);
  assert.equal(isPipeError(null), false);
});

test('a throwing onBroken does not escape', () => {
  const proc = { stdout: new EventEmitter(), stderr: new EventEmitter() };
  const g = guardStdio({ proc, con: { log() {} }, onBroken: () => { throw new Error('boom'); } });
  assert.doesNotThrow(() => proc.stdout.emit('error', pipeErr()));
  assert.equal(g.isBroken(), true);
});
