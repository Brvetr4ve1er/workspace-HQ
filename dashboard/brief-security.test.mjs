// The Brief's six Security rules (dashboard/brief-security.mjs). Placeholder data only (public repo).
//   node --test dashboard/brief-security.test.mjs
//
// brief-core.mjs, brief-project.mjs and brief-sources.js take their shared edits in the batch's integration commit; until then a few
// checks below SIMULATE the edit (the same table pasted into WORDING, the placement computed by placeSecurityRules) and, once the edit
// has landed, assert the real file equals what this module says it should be. That keeps the file green before and honest after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BRIEF_SECURITY_FNS, SECURITY_RULES, SECURITY_STANDING_EXEMPT, SECURITY_WORDING, SECURITY_PLACEMENT, placeSecurityRules, securityInput, STALE_MS,
} from './brief-security.mjs';
import { RULES, STANDING_EXEMPT, SEV_RANK } from './brief-core.mjs';
import { projectBrief, WORDING } from './brief-project.mjs';

const MIN = 60e3, H = 3600e3, D = 24 * H;
const NOW = Date.parse('2026-11-11T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const PLANTED_FILE = 'Chrome Passwords PLANTED.csv';
const PLANTED_SITE = 'planted-bank.example.test';
const PLANTED_TITLE = 'Planted Account Title';

// A status.json as the vault dish writes it, plus planted fields a careless rule could copy into the text.
const status = (o = {}) => ({
  v: 1, at: iso(NOW - 2 * H), refreshedAt: iso(NOW - 3 * D), breachCheckedAt: iso(NOW - 3 * D),
  counts: { weak: 0, reused: 0, breached: 0, no2fa: 0, old: 0, notInVault: 0, accounts: 12, identities: 2 },
  exportsFound: 0, conflicts: 0, email2faDone: true, walkthroughStarted: true,
  exportNames: [PLANTED_FILE], sites: [PLANTED_SITE], title: PLANTED_TITLE, vaultPath: 'Z:\\invented\\planted.kdbx',
  ...o,
});
const run = (id, s, now = NOW) => BRIEF_SECURITY_FNS[id]({ now, security: s });
const all = (s, now = NOW) => SECURITY_RULES.map((id) => [id, run(id, s, now)]).filter(([, it]) => it);

test('the six rules are registered under their ids, in order, as functions', () => {
  assert.deepEqual(Object.keys(BRIEF_SECURITY_FNS), ['plain-export-found', 'vault-conflict', 'accounts-breached', 'passwords-reused', 'footprint-stale', 'email-2fa-first']);
  assert.deepEqual([...SECURITY_RULES], Object.keys(BRIEF_SECURITY_FNS));
  for (const id of SECURITY_RULES) assert.equal(typeof BRIEF_SECURITY_FNS[id], 'function', id);
  assert.equal(STALE_MS, 30 * D);
});

test('exportsFound 1 -> one high plain-export-found item with no file name in text or why, worded "may be"', () => {
  const it = run('plain-export-found', status({ exportsFound: 1 }));
  assert.equal(it.severity, 'high');
  assert.equal(it.text, 'A file that may be a plain password export is sitting in a folder');
  assert.match(it.why, /guess/);
  assert.match(it.why, /never opened/);
  assert.equal(it.source, 'security');
  assert.deepEqual(it.action, { kind: 'go', tab: 'security', sub: 'health' });
  assert.equal(it.others, 0);
  assert.equal(it.key, 'plain-export-found:1');
  assert.equal(it.age, 'security 2 h ago');
  for (const f of ['key', 'severity', 'text', 'why', 'source', 'age', 'action', 'others']) assert.ok(f in it, f);
  const s = JSON.stringify(it);
  for (const planted of [PLANTED_FILE, 'Chrome', '.csv', PLANTED_SITE, PLANTED_TITLE, 'planted.kdbx']) assert.ok(!s.includes(planted), planted);
  // and it is the only item of that status
  assert.deepEqual(all(status({ exportsFound: 1 })).map(([id]) => id), ['plain-export-found']);
});

test('exportsFound 3 reads in the plural and folds the extras into "others"; the key moves with the count', () => {
  const it = run('plain-export-found', status({ exportsFound: 3 }));
  assert.equal(it.text, '3 files that may be plain password exports are sitting in folders');
  assert.equal(it.others, 2);
  assert.equal(it.key, 'plain-export-found:3');
  assert.notEqual(it.key, run('plain-export-found', status({ exportsFound: 1 })).key);
});

test('conflicts 0 and every count 0 -> no items at all (a clean, recently refreshed status)', () => {
  assert.deepEqual(all(status()), []);
  for (const id of SECURITY_RULES) assert.equal(run(id, status()), null, id);
});

test('vault-conflict: high, from status.conflicts, the merge advice, no file name', () => {
  const it = run('vault-conflict', status({ conflicts: 1 }));
  assert.equal(it.severity, 'high');
  assert.equal(it.text, 'The password vault has a sync conflict copy');
  assert.match(it.why, /merge/i);
  assert.equal(it.key, 'vault-conflict:1');
  assert.deepEqual(it.action, { kind: 'go', tab: 'security', sub: 'health' });
  const two = run('vault-conflict', status({ conflicts: 2 }));
  assert.equal(two.text, 'The password vault has 2 sync conflict copies');
  assert.equal(two.others, 1);
  assert.ok(!JSON.stringify([it, two]).includes('sync-conflict-'), 'no conflict file name');
});

test('accounts-breached: med from counts.breached, honest about what a match means; passwords-reused: low from counts.reused', () => {
  const b = run('accounts-breached', status({ counts: { breached: 2 } }));
  assert.equal(b.severity, 'med');
  assert.equal(b.text, '2 saved passwords appear in public breach lists');
  assert.equal(b.others, 1);
  assert.match(b.why, /does not mean the site was hacked/);
  assert.equal(run('accounts-breached', status({ counts: { breached: 1 } })).text, 'A saved password appears in a public breach list');
  const r = run('passwords-reused', status({ counts: { reused: 3 } }));
  assert.equal(r.severity, 'low');
  assert.equal(r.text, '3 accounts share a password with another account');
  assert.equal(r.key, 'passwords-reused:3');
  assert.equal(run('accounts-breached', status({ counts: { breached: 0, reused: 5 } })), null, 'reused does not raise breached');
  assert.equal(run('passwords-reused', status({ counts: { breached: 5, reused: 0 } })), null);
});


test('footprint-stale: only after a first refresh and only past 30 days', () => {
  const at = (days, extra = {}) => run('footprint-stale', status({ refreshedAt: iso(NOW - days * D), ...extra }));
  assert.equal(at(1), null);
  assert.equal(at(29), null);
  assert.equal(at(30), null, 'exactly 30 days is not past 30 days');
  const it = at(31);
  assert.ok(it, '31 days');
  assert.equal(it.severity, 'low');
  assert.equal(it.text, 'The Security map was last refreshed 31 days ago');
  assert.equal(it.age, 'security map 31 d ago');
  assert.deepEqual(it.action, { kind: 'go', tab: 'security' });
  assert.equal(it.key, 'footprint-stale:' + iso(NOW - 31 * D), 'stable until the next refresh, then it is a new key');
  assert.ok(run('footprint-stale', status({ refreshedAt: iso(NOW - 30 * D - 1) })), 'a millisecond past 30 days');
  assert.match(at(120).text, /120 days ago/);
  // never refreshed: silent however old the status file is
  assert.equal(run('footprint-stale', status({ refreshedAt: null, at: iso(NOW - 400 * D) })), null);
  assert.equal(run('footprint-stale', status({ refreshedAt: undefined })), null);
  assert.equal(run('footprint-stale', status({ refreshedAt: 'not a date' })), null);
  // the scan's own stamp ('at') being fresh does not hide a stale refresh
  assert.ok(run('footprint-stale', status({ at: iso(NOW - MIN), refreshedAt: iso(NOW - 45 * D) })));
});

test('email-2fa-first: only when the walkthrough was started and the email step is explicitly not done', () => {
  const t = (o) => run('email-2fa-first', status(o));
  const it = t({ walkthroughStarted: true, email2faDone: false });
  assert.ok(it);
  assert.equal(it.severity, 'low');
  assert.equal(it.text, 'Your main email still needs two-step sign-in');
  assert.equal(it.key, 'email-2fa-first:main-email');
  assert.deepEqual(it.action, { kind: 'go', tab: 'security', sub: 'setup' });
  assert.equal(t({ walkthroughStarted: true, email2faDone: true }), null);
  assert.equal(t({ walkthroughStarted: false, email2faDone: false }), null);
  assert.equal(t({ walkthroughStarted: true, email2faDone: undefined }), null, 'an unknown is not a "false"');
  assert.equal(t({ walkthroughStarted: 'yes', email2faDone: false }), null);
  assert.equal(t({ walkthroughStarted: undefined, email2faDone: undefined }), null);
});

test('a status written by a scan (at only, no refresh) is silent: no items, no throw, nothing to name as an error', () => {
  for (const s of [{ v: 1, at: iso(NOW) }, { v: 1, at: iso(NOW), exportsFound: 0, conflicts: 0 }, { v: 1 }, {}]) {
    for (const id of SECURITY_RULES) assert.equal(run(id, s), null, id + ' ' + JSON.stringify(s));
  }
  // a status with no 'at' still speaks, with an honest unknown age (the Brief never gets a "has no timestamp" error from here)
  const noAt = run('plain-export-found', { v: 1, exportsFound: 1 });
  assert.ok(noAt);
  assert.equal(noAt.age, 'security age unknown');
});

test('the rules never throw on a malformed ctx or status; they are silent', () => {
  const junk = [undefined, null, 0, 'text', [], [1], true, () => 1, { counts: 'x' }, { counts: [] }, { exportsFound: 'many', conflicts: -1, counts: { breached: NaN, reused: Infinity } }, { exportsFound: 1.5, conflicts: 2.5 }];
  for (const j of junk) {
    for (const id of SECURITY_RULES) {
      assert.doesNotThrow(() => BRIEF_SECURITY_FNS[id]({ now: NOW, security: j }), id);
      assert.equal(BRIEF_SECURITY_FNS[id]({ now: NOW, security: j }), null, id + ' ' + JSON.stringify(j));
    }
  }
  for (const ctx of [undefined, null, {}, { security: status({ exportsFound: 1 }) }, { now: 'soon', security: status({ exportsFound: 1 }) }]) {
    for (const id of SECURITY_RULES) assert.doesNotThrow(() => BRIEF_SECURITY_FNS[id](ctx), id);
  }
});

test('securityInput keeps only numbers, booleans and timestamps; flat or nested counts both read; everything else is dropped', () => {
  assert.equal(securityInput(undefined), null);
  assert.equal(securityInput(null), null);
  assert.equal(securityInput('x'), null);
  assert.equal(securityInput([status()]), null);
  const s = securityInput(status({ exportsFound: 2, conflicts: 1, counts: { breached: 4, reused: 3 } }));
  assert.deepEqual(s, { at: iso(NOW - 2 * H), refreshedAt: iso(NOW - 3 * D), breachCheckedAt: iso(NOW - 3 * D), counts: { breached: 4, reused: 3 }, exportsFound: 2, conflicts: 1, email2faDone: true, walkthroughStarted: true });
  const nested = securityInput({ counts: { flags: { breached: 7, reused: 6 } } });
  assert.deepEqual(nested.counts, { breached: 7, reused: 6 });
  const j = JSON.stringify(securityInput(status()));
  for (const planted of [PLANTED_FILE, PLANTED_SITE, PLANTED_TITLE, 'planted.kdbx', 'exportNames', 'sites']) assert.ok(!j.includes(planted), planted);
  // junk becomes zero / null, never a thrown error or a string
  const odd = securityInput({ at: 12, refreshedAt: {}, exportsFound: '3', conflicts: -2, counts: { breached: 1.5, reused: 'x' }, email2faDone: 'no', walkthroughStarted: 1 });
  assert.deepEqual(odd, { at: null, refreshedAt: null, breachCheckedAt: null, counts: { breached: 0, reused: 0 }, exportsFound: 0, conflicts: 0, email2faDone: null, walkthroughStarted: null });
  // idempotent: the reduction of a reduction is itself
  assert.deepEqual(securityInput(securityInput(status({ exportsFound: 1 }))), securityInput(status({ exportsFound: 1 })));
});

test('every item has the fields computeBrief copies, a real severity, and text/why with no host, title or file name, across a full set of counts', () => {
  const s = status({ exportsFound: 2, conflicts: 1, counts: { breached: 3, reused: 4 }, refreshedAt: iso(NOW - 60 * D), email2faDone: false, walkthroughStarted: true });
  const items = all(s);
  assert.equal(items.length, 6);
  const keys = new Set();
  for (const [id, it] of items) {
    for (const f of ['key', 'severity', 'text', 'why', 'source', 'age', 'action', 'others']) assert.ok(f in it, id + ' ' + f);
    assert.ok(it.severity in SEV_RANK, id);
    assert.equal(typeof it.text, 'string');
    assert.ok(it.text.length > 0 && it.text.length < 160, id);
    assert.ok(Number.isInteger(it.others) && it.others >= 0, id);
    assert.match(it.age, /^[A-Za-z0-9.\- ]{1,40}$/, id + ' age passes the projection allowlist');
    assert.equal(it.action.kind, 'go');
    assert.match(it.action.tab, /^[a-z]{2,16}$/);
    keys.add(it.key);
    const j = JSON.stringify(it);
    for (const planted of [PLANTED_FILE, PLANTED_SITE, PLANTED_TITLE, 'planted.kdbx', '.csv', '.kdbx', 'example.test']) assert.ok(!j.includes(planted), id + ' ' + planted);
  }
  assert.equal(keys.size, 6, 'six distinct keys');
  assert.deepEqual(items.map(([, it]) => it.severity), ['high', 'high', 'med', 'low', 'low', 'low']);
});

test('placement: placeSecurityRules puts the six where the plan says, is idempotent, and matches brief-core once the edit has landed', () => {
  const placed = placeSecurityRules(RULES);
  const at = (id) => placed.indexOf(id);
  assert.equal(placed.length, RULES.filter((r) => !SECURITY_RULES.includes(r)).length + 6);
  assert.deepEqual(placed.slice(at('secrets'), at('secrets') + 3), ['secrets', 'plain-export-found', 'vault-conflict'], 'right after secrets');
  assert.equal(placed[at('quest-red') + 1], 'accounts-breached', 'after quest-red');
  assert.deepEqual(placed.slice(placed.length - 4), ['passwords-reused', 'footprint-stale', 'email-2fa-first', 'claude-sync'], 'the three lows before claude-sync');
  assert.deepEqual(placeSecurityRules(placed), placed);
  assert.deepEqual(placed.filter((r) => !SECURITY_RULES.includes(r)), RULES.filter((r) => !SECURITY_RULES.includes(r)), 'the other rules keep their order');
  assert.equal(new Set(placed).size, placed.length);
  assert.deepEqual(Object.keys(SECURITY_PLACEMENT.after), ['secrets', 'quest-red']);
  // after the shared edit: the real RULES is exactly this
  if (RULES.includes('plain-export-found')) assert.deepEqual(RULES, placed, 'brief-core.mjs RULES');
});

test('standing: the two ids that never step aside; once brief-core carries them, STANDING_EXEMPT lists them beside secrets', () => {
  assert.deepEqual([...SECURITY_STANDING_EXEMPT], ['plain-export-found', 'vault-conflict']);
  for (const id of SECURITY_STANDING_EXEMPT) assert.ok(SECURITY_RULES.includes(id));
  assert.ok(STANDING_EXEMPT.includes('secrets'));
  if (RULES.includes('plain-export-found')) for (const id of SECURITY_STANDING_EXEMPT) assert.ok(STANDING_EXEMPT.includes(id), id);
  // the four that may step aside after 72 h are not on the list
  for (const id of ['accounts-breached', 'passwords-reused', 'footprint-stale', 'email-2fa-first']) assert.ok(!SECURITY_STANDING_EXEMPT.includes(id), id);
});

// ---- brief-project: the screen-safe projection ----
// Simulate the WORDING edit (the table this module exports), project, and put WORDING back; after the edit lands the real table must equal it.
function withSecurityWording(fn) {
  const added = [];
  for (const [id, row] of Object.entries(SECURITY_WORDING)) if (!Object.prototype.hasOwnProperty.call(WORDING, id)) { WORDING[id] = { ...row }; added.push(id); }
  try { return fn(); } finally { for (const id of added) delete WORDING[id]; }
}
const asItem = (id, it) => ({ key: it.key, rule: id, severity: it.severity, text: it.text, why: it.why, source: it.source, age: it.age, action: it.action, count: it.others });

test('brief-project: every new rule id has a WORDING row (counts only), and the real WORDING equals it once the edit has landed', () => {
  for (const id of SECURITY_RULES) {
    const w = SECURITY_WORDING[id];
    assert.ok(w, id);
    assert.equal(typeof w.one, 'string', id);
    assert.equal(typeof w.short, 'string', id);
    if (w.many) assert.ok(w.many.includes('{n}'), id);
    if (w.shortMany) assert.ok(w.shortMany.includes('{n}'), id);
    assert.ok(!/example\.test|\.csv|\.kdbx|@/.test(JSON.stringify(w)), id + ' no host, file or address in the wording');
    if (Object.prototype.hasOwnProperty.call(WORDING, id)) assert.deepEqual(WORDING[id], w, 'brief-project.mjs WORDING row ' + id);
  }
  // the edit is all-or-nothing: either none of the six rows is in WORDING yet or all six are
  const present = SECURITY_RULES.filter((id) => Object.prototype.hasOwnProperty.call(WORDING, id));
  assert.ok(present.length === 0 || present.length === 6, 'present: ' + present.join(','));
  if (RULES.includes('plain-export-found')) assert.equal(present.length, 6, 'RULES lists them, so WORDING must');
});

test('brief-project: the projected text of every new rule comes from WORDING and holds no host, title, file name or why text', () => {
  const s = status({ exportsFound: 3, conflicts: 2, counts: { breached: 5, reused: 2 }, refreshedAt: iso(NOW - 40 * D), email2faDone: false, walkthroughStarted: true });
  const items = all(s).map(([id, it]) => asItem(id, it));
  const brief = { v: 1, generatedAt: iso(NOW - 5 * MIN), items: items.slice(0, 3), overflow: items.slice(3), more: 3, errors: [] };
  const p = withSecurityWording(() => projectBrief(brief, { now: NOW }));
  const rows = p.items.concat(p.overflow);
  assert.equal(rows.length, 6);
  const text = Object.fromEntries(rows.map((r) => [r.rule, r.text]));
  assert.equal(text['plain-export-found'], '3 files that may be plain password exports are sitting in folders');
  assert.equal(text['vault-conflict'], 'The password vault has 2 sync conflict copies');
  assert.equal(text['accounts-breached'], '5 saved passwords appear in public breach lists');
  assert.equal(text['passwords-reused'], '2 accounts share a password with another account');
  assert.equal(text['footprint-stale'], 'The Security map is out of date');
  assert.equal(text['email-2fa-first'], 'Your main email still needs two-step sign-in');
  for (const r of rows) assert.notEqual(r.rule, 'unknown', r.rule);
  const j = JSON.stringify(p);
  for (const planted of [PLANTED_FILE, PLANTED_SITE, PLANTED_TITLE, 'planted.kdbx', '.csv', 'example.test', 'Chrome', 'guess', 'Recycle', 'merge']) assert.ok(!j.includes(planted), planted);
  // the nav is the app's own route words only
  for (const r of p.items) assert.deepEqual(Object.keys(r.nav), ['kind', 'tab', 'sub']);
  assert.ok(p.items.every((r) => r.nav.tab === 'security'));
  assert.ok(p.overflowLine.startsWith('+3 more'));
  // the wording is gone again after the simulation (nothing leaked into the shared table)
  if (!RULES.includes('plain-export-found')) for (const id of SECURITY_RULES) assert.ok(!Object.prototype.hasOwnProperty.call(WORDING, id), id);
});

test('brief-project: with one export and one conflict the rows read in the singular', () => {
  const items = [['plain-export-found', run('plain-export-found', status({ exportsFound: 1 }))], ['vault-conflict', run('vault-conflict', status({ conflicts: 1 }))]].map(([id, it]) => asItem(id, it));
  const p = withSecurityWording(() => projectBrief({ v: 1, generatedAt: iso(NOW), items, overflow: [], more: 0 }, { now: NOW }));
  assert.deepEqual(p.items.map((r) => r.text), ['A file that may be a plain password export is sitting in a folder', 'The password vault has a sync conflict copy']);
  assert.deepEqual(p.items.map((r) => r.count), [0, 0]);
});

test('this module is pure: no imports, no IO, no clock, no network', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('./brief-security.mjs', import.meta.url)), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'no import statements');
  for (const bad of ['require(', 'Date.now', 'new Date()', 'fetch(', 'process.', 'readFile', 'http']) assert.ok(!src.includes(bad), bad);
});
