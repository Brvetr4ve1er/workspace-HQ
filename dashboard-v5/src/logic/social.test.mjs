// Social tab (2026-10-27): the pure pieces — archive cards from the Hub's socialSummary, the extension snapshot's
// accounts + activity, the note limits shared with main, and the platform list shared with main + the extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { archiveNetworks, KIND_LABEL } from '../vals/social.js';
import { social } from '../live/adapter.mjs';
import { PLATFORMS, SUBS, NAV } from '../live/catalog.mjs';
import { TITLE_MAX, BODY_MAX } from './social-limits.mjs';

const require = createRequire(import.meta.url);
const main = require('../../../dashboard/social-tab.js');

test('archiveNetworks: per network DM counts + kinds with labels; a network with nothing is marked empty', () => {
  const n = archiveNetworks({ kinds: [{ origin: 'instagram', kind: 'posts', docs: 3 }, { origin: 'instagram', kind: 'mystery', docs: 1 }, { origin: 'other', kind: 'posts', docs: 9 }],
    dms: [{ origin: 'instagram', conversations: 2, messages: 40, last_at: 'not a date' }] });
  assert.deepEqual(n.map((x) => [x.origin, x.has, x.dms, x.messages, x.last]), [['instagram', true, 2, 40, ''], ['facebook', false, 0, 0, '']]);
  assert.deepEqual(n[0].kinds, [{ kind: 'posts', label: 'Posts', docs: 3 }, { kind: 'mystery', label: 'mystery', docs: 1 }]);
  assert.deepEqual(archiveNetworks(null).map((x) => x.has), [false, false]);
  for (const k of ['profile', 'posts', 'comments', 'likes', 'saved', 'connections', 'interests', 'ads', 'searches', 'groups', 'events', 'marketplace']) assert.ok(KIND_LABEL[k], k);
});

test('adapter social(): accounts and per-platform activity from the extension snapshot', () => {
  const s = social({
    accounts: { accounts: [{ platform: 'bluesky', handle: 'placeholder.example', display: 'Placeholder', connected_at: '2026-10-01T00:00:00Z' }, { handle: 'no-platform' }] },
    inbox: { events: [{ platform: 'bluesky', kind: 'feed', ts: '2026-10-02T00:00:00Z' }, { platform: 'bluesky', kind: 'mention', ts: '2026-10-03T00:00:00Z' }, { kind: 'feed' }] },
  });
  assert.deepEqual(s.ACCOUNTS.map((a) => [a.platform, a.handle, a.display]), [['bluesky', 'placeholder.example', 'Placeholder']]);
  assert.equal(s.ACTIVITY.bluesky.events, 2);
  assert.equal(s.ACTIVITY.bluesky.mentions, 1);
  assert.equal(s.ACTIVITY.bluesky.lastMs, Date.parse('2026-10-03T00:00:00Z'));
  assert.equal(s.connected, true);
  assert.deepEqual(social(null).ACCOUNTS, []);
});

test('renderer and main agree: note limits, and every platform with a site is one main may open', () => {
  assert.equal(TITLE_MAX, main.TITLE_MAX);
  assert.equal(BODY_MAX, main.BODY_MAX);
  for (const p of PLATFORMS) {
    if (p.site) assert.equal(new URL(main.SITES[p.id]).host.replace(/^www\./, ''), p.site, p.id);
    else assert.equal(main.SITES[p.id], undefined, p.id);
  }
  assert.equal(Object.keys(main.SITES).length, PLATFORMS.filter((p) => p.site).length);
});

test('PLATFORMS are exactly the extension adapters; Social is a tab with four subs and Life lost its social sub', () => {
  const src = fs.readFileSync(new URL('../../../browser-bridge/social.js', import.meta.url), 'utf8');
  const block = /const SOCIAL_ADAPTERS = \{([\s\S]*?)\n\};/.exec(src)[1];
  const ids = [...block.matchAll(/^\s{2}([a-z]+): \{/gm)].map((m) => m[1]);
  assert.deepEqual([...ids].sort(), PLATFORMS.map((p) => p.id).sort());
  assert.ok(NAV.some((n) => n.id === 'social'));
  assert.deepEqual(SUBS.social.map((s) => s[0]), ['accounts', 'inbox', 'archive', 'vault']);
  assert.ok(!SUBS.life.some((s) => s[0] === 'social'));
  assert.ok(NAV.length <= 10, 'digits 1–9 and 0 reach every destination');
});

test('every destination has its own rail icon (an unknown name falls back to the Home house)', () => {
  const src = fs.readFileSync(new URL('../elements/hq-v3.js', import.meta.url), 'utf8');
  const icons = /const I = \{([\s\S]*?)\r?\n  \};/.exec(src)[1];
  for (const n of NAV) assert.match(icons, new RegExp('^ {4}' + n.id + ': \\[', 'm'), n.id);
});
