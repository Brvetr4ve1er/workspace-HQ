// The ORACLE and draft-commit promise that nothing leaves this PC. These pin
// the model picker that carries that promise: pinned model first, cloud models
// never, embedding models never.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// PREFERRED is read from HQ_LLM_MODEL at load time — reload per env.
function load(env) {
  const key = require.resolve('./llm-local.js');
  delete require.cache[key];
  const prev = process.env.HQ_LLM_MODEL;
  if (env === undefined) delete process.env.HQ_LLM_MODEL; else process.env.HQ_LLM_MODEL = env;
  try { return require('./llm-local.js'); }
  finally { if (prev === undefined) delete process.env.HQ_LLM_MODEL; else process.env.HQ_LLM_MODEL = prev; }
}

const QWEN = { id: 'qwen2.5:7b-instruct-q4_K_M', caps: ['completion', 'tools'] };
const LLAMA = { id: 'llama3.1:8b', caps: ['completion'] };
const CLOUD = { id: 'gpt-oss:120b-cloud', remote: true, caps: ['completion'] };
const EMBED = { id: 'nomic-embed-text:latest', caps: ['embedding'] };

test('the pinned model wins even when a newer model is listed first', () => {
  const l = load();
  assert.equal(l.pickChatModel([LLAMA, CLOUD, QWEN]), QWEN.id);
});

test('cloud models are never picked — remote flag or -cloud suffix', () => {
  const l = load();
  assert.equal(l.pickChatModel([CLOUD, LLAMA]), LLAMA.id);
  assert.equal(l.pickChatModel([{ id: 'deepseek-v3.1:671b-cloud', caps: ['completion'] }, LLAMA]), LLAMA.id);
  assert.equal(l.isRemote({ id: 'kimi-k2:1t-cloud' }), true);
  assert.equal(l.isRemote(QWEN), false);
});

test('a cloud model pinned via HQ_LLM_MODEL is still refused', () => {
  const l = load(CLOUD.id);
  assert.equal(l.pickChatModel([CLOUD]), null);
  assert.equal(l.pickChatModel([CLOUD, LLAMA]), LLAMA.id);
});

test('a cloud stub renamed to the pinned id is refused (remote flag survives the rename)', () => {
  const l = load();
  assert.equal(l.pickChatModel([{ ...QWEN, remote: true }]), null);
});

test('embedding-only models are skipped — by capabilities, then by name', () => {
  const l = load();
  assert.equal(l.pickChatModel([EMBED, LLAMA]), LLAMA.id);
  assert.equal(l.pickChatModel([{ id: 'bge-m3' }, { id: 'mistral:7b' }]), 'mistral:7b');
});

test('nothing usable -> null (caller reports "no local chat model")', () => {
  const l = load();
  assert.equal(l.pickChatModel([CLOUD, EMBED]), null);
  assert.equal(l.pickChatModel([]), null);
  assert.equal(l.pickChatModel(undefined), null);
});
