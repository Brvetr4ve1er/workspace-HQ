// Prompt harvest scoring (spec 2026-10-15 §6.2, phase P2). Pure; placeholder text only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harvest, normalize, candidateKey, excludeReason, HARVEST_MIN_CHARS, HARVEST_LIMIT_MAX } from './harvest.mjs';
import { MASK } from './redact.mjs';

const long = (s, n = 130) => { let t = s; while (t.length < n) t += ' placeholder words'; return t; };
const A = long('Placeholder prompt alpha: review the placeholder module');
const B = long('Placeholder prompt beta: draft a placeholder plan');
let seq = 0;
const row = (o) => ({ kind: 'code', role: 'user', text: A, at: `2026-09-0${1 + (seq++ % 9)}T10:00:00Z`, sessionKey: 'code:s1',
  conversationId: 'code:s1', documentId: null, project: 'project-a', turnsAfter: 0, pasted: false, ...o });
const JUDGE = /\b(good|great|best|better|excellent|strong|quality|top|useful|recommended|valuable|effective|smart)\b/i;

test('normalize: NFKC, trim, collapsed whitespace, lower-case; key is cand:<sha1>', () => {
  assert.equal(normalize('  Hello\n\n  WORLD\t '), 'hello world');
  assert.equal(normalize('ﬁle'), 'file');
  assert.match(candidateKey('hello world'), /^cand:[0-9a-f]{40}$/);
  assert.equal(candidateKey('x'), candidateKey('x'));
});

test('excludeReason: every exclusion of §6.2 (+ slash-command expansions)', () => {
  assert.equal(excludeReason(row({})), null);
  assert.equal(excludeReason(row({ kind: 'memory' })), 'source');
  assert.equal(excludeReason(row({ role: 'assistant' })), 'role');
  assert.equal(excludeReason(row({ role: 'tool' })), 'role');
  assert.equal(excludeReason(row({ role: 'system' })), 'role');
  assert.equal(excludeReason(row({ kind: 'history', role: undefined, pasted: true })), 'pasted');
  assert.equal(excludeReason(row({ text: 'x'.repeat(HARVEST_MIN_CHARS - 1) })), 'short');
  assert.equal(excludeReason(row({ text: '   ' + 'x'.repeat(HARVEST_MIN_CHARS - 1) + '   ' })), 'short');
  assert.equal(excludeReason(row({ text: 'x'.repeat(HARVEST_MIN_CHARS) })), null);
  assert.equal(excludeReason(row({ text: '/review ' + A })), 'slash');
  assert.equal(excludeReason(row({ text: '<command-name>/review</command-name> ' + A })), 'slash');
  assert.equal(excludeReason(row({ text: A + ' ' + MASK('github-token') })), 'secret');
  assert.equal(excludeReason(row({ text: '<local-command-stdout>' + A })), 'local-command');
  assert.equal(excludeReason(row({ kind: 'history', role: undefined })), null);   // history lines have no role
});

test('a history line and its transcript message are one session; pasted lines never pool', () => {
  const r = harvest([
    row({ kind: 'history', role: undefined, documentId: 'history:s1:0', conversationId: null, sessionKey: 'code:s1' }),
    row({ conversationId: 'code:s1', sessionKey: 'code:s1' }),
    row({ kind: 'history', role: undefined, documentId: 'history:s2:0', conversationId: null, sessionKey: 'code:s2', text: B, pasted: true }),
  ]);
  assert.equal(r.candidates.length, 1);
  const c = r.candidates[0];
  assert.equal(c.sessions, 1);
  assert.deepEqual(c.reasons.find((x) => x.key === 'reuse'), { key: 'reuse', points: 0, text: 'seen in 1 session' });
  assert.equal(c.sources.length, 2);
});

test('reuse ×3 across ≥ 2 sessions; text differences of case and whitespace group together', () => {
  const r = harvest([
    row({ sessionKey: 'code:s1' }),
    row({ sessionKey: 'web:w1', kind: 'web', conversationId: 'web:w1', text: '  ' + A.toUpperCase().replace(/ /g, '\n ') }),
    row({ sessionKey: 'chatgpt:c1', kind: 'chatgpt', conversationId: 'chatgpt:c1' }),
  ]);
  assert.equal(r.candidates.length, 1);
  assert.deepEqual(r.candidates[0].reasons[0], { key: 'reuse', points: 9, text: 'used in 3 sessions' });
  assert.equal(r.candidates[0].score, 9);
});

test('productivity = min(turns after, 20) / 4, with the real count said', () => {
  const r = harvest([row({ turnsAfter: 12 }), row({ text: B, sessionKey: 'code:s9', turnsAfter: 21 }), row({ text: long('Placeholder gamma'), sessionKey: 'code:s8' })]);
  const by = (t) => r.candidates.find((c) => c.text === t.trim());
  assert.deepEqual(by(A).reasons.find((x) => x.key === 'turns'), { key: 'turns', points: 3, text: 'followed by 12 assistant messages' });
  assert.deepEqual(by(B).reasons.find((x) => x.key === 'turns'), { key: 'turns', points: 5, text: 'followed by more than 20 assistant messages (counted as 20)' });
  assert.deepEqual(by(long('Placeholder gamma')).reasons.find((x) => x.key === 'turns'), { key: 'turns', points: 0, text: 'no assistant message followed it' });
  // two occurrences: the larger follow-up counts
  const r2 = harvest([row({ turnsAfter: 2 }), row({ turnsAfter: 7, sessionKey: 'code:s2' })]);
  assert.equal(r2.candidates[0].reasons.find((x) => x.key === 'turns').points, 1.75);
});

test('length bonus 1 for ≥ 300 characters; already a prompt note −5 (normalized match)', () => {
  const L = long('Placeholder long prompt', 300);
  const r = harvest([row({ text: L }), row({ text: B, sessionKey: 'code:s2' })], { promptBodies: ['  ' + B.toUpperCase() + '\n'] });
  const l = r.candidates.find((c) => c.text === L), b = r.candidates.find((c) => c.text === B);
  assert.deepEqual(l.reasons.find((x) => x.key === 'length'), { key: 'length', points: 1, text: '300+ characters' });
  assert.equal(b.reasons.find((x) => x.key === 'length'), undefined);
  assert.deepEqual(b.reasons.find((x) => x.key === 'library'), { key: 'library', points: -5, text: 'already a prompt note' });
  assert.equal(b.score, -5);
});

test('hidden keys never come back and are counted', () => {
  const key = candidateKey(normalize(A));
  const r = harvest([row({}), row({ text: B, sessionKey: 'code:s2' })], { hidden: new Set([key]) });
  assert.deepEqual(r.candidates.map((c) => c.text), [B]);
  assert.equal(r.hidden, 1);
});

test('reasons carry every term with its points and never a judgment word; score = sum of points', () => {
  const r = harvest([row({ turnsAfter: 30, text: long('Placeholder delta', 320) }), row({ turnsAfter: 30, text: long('Placeholder delta', 320), sessionKey: 'code:s2' })],
    { promptBodies: [long('Placeholder delta', 320)] });
  const c = r.candidates[0];
  assert.deepEqual(c.reasons.map((x) => x.key), ['reuse', 'turns', 'length', 'library']);
  assert.equal(c.score, c.reasons.reduce((s, x) => s + x.points, 0));
  for (const x of c.reasons) { assert.equal(typeof x.points, 'number'); assert.doesNotMatch(x.text, JUDGE); }
});

test('order score DESC, lastAt DESC, key; limit default 50, cap 200; sources ≤ 5 newest first', () => {
  const pool = [];
  for (let i = 0; i < 260; i++) pool.push(row({ text: long('Placeholder prompt number ' + i), sessionKey: 'code:x' + i, at: `2026-09-01T10:${String(i % 60).padStart(2, '0')}:00Z` }));
  assert.equal(harvest(pool).candidates.length, 50);
  assert.equal(harvest(pool, { limit: 999 }).candidates.length, HARVEST_LIMIT_MAX);
  const many = [];
  for (let i = 0; i < 8; i++) many.push(row({ sessionKey: 'code:m' + i, at: `2026-09-0${1 + i}T10:00:00Z` }));
  many.push(row({ text: B, sessionKey: 'code:z', at: '2026-10-01T00:00:00Z' }));
  const c = harvest(many).candidates;
  assert.equal(c[0].text, A.trim());
  assert.equal(c[0].sources.length, 5);
  assert.equal(c[0].sources[0].at, '2026-09-08T10:00:00Z');
  assert.equal(c[0].lastAt, '2026-09-08T10:00:00Z');
  const tie = harvest([row({ text: B, sessionKey: 'code:q', at: '2026-01-01T00:00:00Z' }), row({ sessionKey: 'code:r', at: '2026-02-01T00:00:00Z' })]).candidates;
  assert.deepEqual(tie.map((x) => x.text), [A.trim(), B.trim()]);   // same score → newer first
  assert.equal(harvest(null).candidates.length, 0);
});
