import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from './store.mjs';
import { fixMojibake, igDate, igBlocks, decodeEntities, categorize, detectMetaOrigin, importMetaFile, PROJECT, SOCIAL } from './ingest-meta.mjs';
import { writeFacebookZip, writeInstagramZip, OWNER } from './__fixtures__/make-meta-export.mjs';
import { zipFiles } from './__fixtures__/make-export.mjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-meta-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const meta = (s) => Buffer.from(s, 'utf8').toString('latin1');
const all = (store, sql, ...a) => store.db.prepare(sql).all(...a).map((r) => ({ ...r }));

test('mojibake: Meta-escaped UTF-8 is repaired; real Latin-1 and correct text are kept', () => {
  assert.equal(fixMojibake(meta('مرحبا café')), 'مرحبا café');
  assert.equal(fixMojibake('café'), 'café', 'é alone is not valid UTF-8 bytes: kept');
  assert.equal(fixMojibake('already مرحبا'), 'already مرحبا');
  assert.equal(fixMojibake('plain'), 'plain');
});

test('Instagram dates: 12-hour local time with or without seconds; junk is null', () => {
  assert.equal(igDate('Jan 26, 2026 6:26 pm'), new Date(2026, 0, 26, 18, 26).toISOString());
  assert.equal(igDate('Oct 2, 2025 12:05 am'), new Date(2025, 9, 2, 0, 5).toISOString());
  assert.equal(igDate('Dec 31, 2025 12:00 pm'), new Date(2025, 11, 31, 12, 0).toISOString());
  assert.equal(igDate('not a date'), null);
  assert.equal(igDate('Foo 1, 2025 1:00 pm'), null);
  assert.equal(decodeEntities('a &amp; b &#064;c &#x1F600; &bogus;'), 'a & b @c 😀 &bogus;');
});

test('igBlocks: a wrapper passes its items up; an item absorbs its nested Owner block', () => {
  const html = '<main>' + '<div class="_a6-g"><div class="_a6-p">'
    + '<div class="_a6-g"><table><tr><td>Caption</td><td>one</td></tr><tr><td colspan="2">Owner<div><div class="_a6-g"><table><tr><td>Username</td><td>u1</td></tr></table></div></div></td></tr></table></div>'
    + '<div class="_a6-g"><table><tr><td>Caption</td><td>two</td></tr></table></div>' + '</div></div></main>';
  const b = igBlocks(html);
  assert.equal(b.length, 2);
  assert.deepEqual(b[0].rows.filter(([, v]) => v), [['Caption', 'one'], ['Username', 'u1']]);
  assert.deepEqual(b[1].rows, [['Caption', 'two']]);
});

test('categories: sensitive folders are never read; unknown files are skipped; threads are recognised elsewhere', () => {
  assert.deepEqual(categorize('facebook', 'security_and_login_information/account_activity.json'), { skip: 'sensitive' });
  assert.deepEqual(categorize('facebook', 'your_facebook_activity/facebook_payments/payment_history.json'), { skip: 'sensitive' });
  assert.deepEqual(categorize('instagram', 'connections/contacts/synced_contacts.html'), { skip: 'sensitive' });
  assert.deepEqual(categorize('facebook', 'logged_information/location/primary_location.json'), { skip: 'sensitive' });
  assert.deepEqual(categorize('facebook', 'preferences/preferences/dark_mode_settings.json'), { skip: 'other' });
  assert.equal(categorize('instagram', 'your_instagram_activity/likes/liked_posts.html').mode, 'tally');
  assert.equal(detectMetaOrigin(['instagram_profile_information.html', 'start_here.html']), 'instagram');
  assert.equal(detectMetaOrigin(['profile_information.json', 'your_friends.json']), 'facebook');
  assert.equal(detectMetaOrigin(['conversations.json', 'user.json']), null);
});

test('Facebook import: threads merged across parts, owner = user, others named; profile whitelist; no sensitive text', async () => {
  const d = tmp(), zip = path.join(d, 'facebook-placeholder.zip'), store = openStore(path.join(d, 'hub.sqlite'));
  writeFacebookZip(zip);
  const r = await importMetaFile(store, zip);
  assert.equal(r.source, 'facebook');
  assert.equal(r.owner, true);
  assert.deepEqual(r.conversations, { seen: 1, imported: 1, unchanged: 0, forgotten: 0, skipped: 0 });
  assert.equal(r.skippedFiles.sensitive, 2);
  const msgs = all(store, 'SELECT role, text, tool_name, conversation_id FROM message ORDER BY at');
  assert.deepEqual(msgs.map((m) => [m.role, m.tool_name]), [['user', null], ['user', null], ['other', 'Placeholder Friend']]);
  assert.equal(msgs[0].conversation_id, 'facebook:friendone_100');
  assert.match(msgs[1].text, /placeholder hello from me\n\[photo\]/);
  assert.equal(msgs[2].text, 'مرحبا placeholder lantern', 'mojibake repaired');
  const conv = all(store, 'SELECT source, project_id, title FROM conversation')[0];
  assert.deepEqual(conv, { source: 'facebook', project_id: PROJECT.facebook, title: 'Placeholder Friend' });
  const docs = all(store, 'SELECT id, title, text, meta FROM document WHERE source = ?', SOCIAL);
  const text = docs.map((x) => x.text).join('\n');
  assert.match(text, /Placeholder lantern post café/);
  assert.match(text, /Placeholder City é/);
  assert.match(text, /Interest: Placeholder lanterns/);
  for (const bad of [/example\.invalid/, /192\.0\.2\.1/, /Relative/, /abc-123/, /Wi-Fi/, /2000/]) assert.doesNotMatch(text, bad);
  assert.ok(docs.every((x) => JSON.parse(x.meta).origin === 'facebook'));
  // re-import: nothing new; a forgotten thread stays forgotten
  const again = await importMetaFile(store, zip);
  assert.equal(again.conversations.unchanged, 1);
  assert.equal(again.documents.imported, 0);
  store.forget({ conversationId: 'facebook:friendone_100' });
  assert.equal((await importMetaFile(store, zip)).conversations.forgotten, 1);
  store.close();
});

test('Instagram import (HTML): sender by h2, dates parsed, attachments noted; likes tallied; post metadata dropped', async () => {
  const d = tmp(), zip = path.join(d, 'instagram-placeholder.zip'), store = openStore(path.join(d, 'hub.sqlite'));
  writeInstagramZip(zip);
  const r = await importMetaFile(store, zip);
  assert.equal(r.source, 'instagram');
  assert.equal(r.conversations.imported, 1);
  assert.equal(r.skippedFiles.sensitive, 2);
  const msgs = all(store, 'SELECT role, text, tool_name, at FROM message ORDER BY at');
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'user', 'other']);
  assert.equal(msgs[0].text, 'placeholder question');
  assert.match(msgs[1].text, /\[photo\]/);
  assert.match(msgs[1].text, /\[link: https:\/\/www\.instagram\.com\/reel\/PLACEHOLDER\/\]/);
  assert.equal(msgs[2].text, 'placeholder lantern reply @soon');
  assert.equal(msgs[2].tool_name, 'Placeholder Pal');
  assert.equal(msgs[2].at, new Date(2025, 9, 2, 18, 26).toISOString());
  assert.equal(all(store, 'SELECT title FROM conversation')[0].title, 'Placeholder Pal');
  const docs = all(store, 'SELECT id, title, text FROM document');
  const text = docs.map((x) => x.text).join('\n');
  assert.match(text, /acct\.one \(2\)/, 'the tally credits both likes to the account');
  assert.match(text, /Caption: placeholder lantern caption/);
  assert.match(text, /placeholder my own post/);
  assert.match(text, /Bio: placeholder designer & maker/);
  for (const bad of [/example\.invalid/, /Phone/, /36\.7/, /android-abc/, /1024/, /192\.0\.2\.1/, /Someone Private/, /2000-01-02/]) assert.doesNotMatch(text, bad);
  store.close();
});

test('refusals: not a Meta export; Instagram sent as JSON; the wrong origin for the button', async () => {
  const d = tmp(), store = openStore(path.join(d, 'hub.sqlite'));
  const other = path.join(d, 'other.zip'); zipFiles(other, [{ name: 'conversations.json', data: '[]' }]);
  await assert.rejects(importMetaFile(store, other), /Not an Instagram or Facebook export/);
  const igJson = path.join(d, 'ig-json.zip');
  zipFiles(igJson, [{ name: 'personal_information/personal_information/instagram_profile_information.json', data: '{}' },
    { name: 'your_instagram_activity/messages/inbox/x_1/message_1.json', data: '{}' }]);
  await assert.rejects(importMetaFile(store, igJson), /Instagram export is in JSON format — request it again as HTML/);
  const fb = path.join(d, 'fb.zip'); writeFacebookZip(fb);
  await assert.rejects(importMetaFile(store, fb, { expect: 'instagram' }), /That is a Facebook export, not an Instagram export/);
  store.close();
});

test('people are not AI chats: unfiltered chat / project lists and stats leave Instagram / Facebook out; by source they are listed', async () => {
  const d = tmp(), zip = path.join(d, 'facebook-placeholder.zip'), store = openStore(path.join(d, 'hub.sqlite'));
  writeFacebookZip(zip);
  await importMetaFile(store, zip);
  assert.equal(store.listConversations({}).length, 0);
  assert.equal(store.search({ q: 'lantern' }).length, 0, 'search with no source matches the unfiltered list');
  assert.ok(store.search({ q: 'lantern', source: 'facebook' }).length > 0);
  assert.equal(store.listConversations({ source: 'facebook' }).length, 1);
  assert.equal(store.listProjects({}).length, 0);
  assert.equal(store.listProjects({ source: 'facebook' }).length, 1);
  assert.equal(store.stats({ from: '2025-09-01', to: '2025-10-31' }).totals.chats, 0);
  assert.equal(store.harvestPool().pooled.messages, 0);
  store.close();
});
