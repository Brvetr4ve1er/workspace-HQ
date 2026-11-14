// node --test dashboard-v5/src/logic/sound-pref.test.mjs
// Placeholder prefs only. The disk is a plain object here; "save" mirrors app.js: re-read, Object.assign the app's own keys, write back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSound, SOUND_V, SOUND_PATCH } from './sound-pref.mjs';

test('no prefs at all: sound off, marker set, a write is needed', () => {
  for (const none of [undefined, null, {}, 'x', [], 7]) {
    const r = migrateSound(none);
    assert.equal(r.prefs.sound, false);
    assert.equal(r.prefs.soundV, SOUND_V);
    assert.equal(r.changed, true);
  }
});

test('an older build saved sound:true with no marker: reset to false once', () => {
  const r = migrateSound({ themePref: 'dark', sound: true });
  assert.equal(r.prefs.sound, false);
  assert.equal(r.prefs.soundV, 2);
  assert.equal(r.prefs.themePref, 'dark', 'other prefs ride along untouched');
  assert.equal(r.changed, true);
});

test('saved false without the marker stays false (and the marker is still written)', () => {
  const r = migrateSound({ sound: false });
  assert.equal(r.prefs.sound, false);
  assert.equal(r.changed, true);
});

test('saved true WITH the marker stays true, nothing to write', () => {
  const r = migrateSound({ sound: true, soundV: 2 });
  assert.equal(r.prefs.sound, true);
  assert.equal(r.changed, false);
});

test('saved false with the marker stays false; a missing or odd sound reads false', () => {
  assert.equal(migrateSound({ sound: false, soundV: 2 }).prefs.sound, false);
  assert.equal(migrateSound({ soundV: 2 }).prefs.sound, false);
  assert.equal(migrateSound({ soundV: 2, sound: 'yes' }).prefs.sound, false, 'only a real true counts');
  assert.equal(migrateSound({ soundV: 2 }).changed, false);
});

test('a later marker version is respected; a junk marker is not a marker', () => {
  assert.equal(migrateSound({ sound: true, soundV: 3 }).prefs.sound, true);
  assert.equal(migrateSound({ sound: true, soundV: '2' }).prefs.sound, true, 'a numeric string still counts');
  assert.equal(migrateSound({ sound: true, soundV: 'x' }).prefs.sound, false);
  assert.equal(migrateSound({ sound: true, soundV: 1 }).prefs.sound, false);
});

test('the caller’s object is never mutated; SOUND_PATCH is frozen', () => {
  const p = { sound: true };
  const r = migrateSound(p);
  assert.deepEqual(p, { sound: true });
  assert.notEqual(r.prefs, p);
  assert.ok(Object.isFrozen(SOUND_PATCH));
  assert.deepEqual({ ...SOUND_PATCH }, { sound: false, soundV: 2 });
});

test('the critic scenario: migrate, persist at once, the owner turns sound on, a reload keeps it on', () => {
  // disk as an older build left it
  let disk = { themePref: 'dark', sound: true, petOn: true };
  const loadPrefs = () => JSON.parse(JSON.stringify(disk));
  const savePrefs = (p) => { disk = JSON.parse(JSON.stringify(p)); };
  // app.js's save: re-read, merge ONLY the listed keys (soundV is not among them), write back
  const ownerSave = (S) => savePrefs(Object.assign(loadPrefs(), { themePref: S.themePref, sound: S.sound, petOn: S.petOn }));

  // launch 1: migrate and persist at once
  const m1 = migrateSound(loadPrefs());
  assert.equal(m1.changed, true);
  savePrefs(Object.assign(loadPrefs(), SOUND_PATCH));
  assert.equal(disk.sound, false);
  assert.equal(disk.soundV, 2);
  assert.equal(disk.petOn, true, 'the rest of the prefs survive the persist');
  const state = { themePref: 'dark', sound: m1.prefs.sound, petOn: true };

  // the owner switches Sound on; the save writes sound:true and the persisted marker survives in the re-read prefs
  state.sound = true;
  ownerSave(state);
  assert.equal(disk.sound, true);
  assert.equal(disk.soundV, 2, 'the marker is not lost by the key-list save');

  // launch 2: the choice is kept
  const m2 = migrateSound(loadPrefs());
  assert.equal(m2.prefs.sound, true);
  assert.equal(m2.changed, false);
});

test('the counter-case: a marker kept only in memory would have been lost (why the persist is immediate)', () => {
  let disk = { sound: true };
  const loadPrefs = () => JSON.parse(JSON.stringify(disk));
  const m1 = migrateSound(loadPrefs());                       // changed, but suppose the app did NOT persist the marker
  assert.equal(m1.prefs.soundV, 2);
  disk = Object.assign(loadPrefs(), { sound: true });         // the owner turns it on: the key-list save writes sound only
  assert.equal(migrateSound(loadPrefs()).prefs.sound, false, 'without the persisted marker the choice would be undone');
});

// Source guard (batch 6, quiet-light): no tab or click blip is left anywhere in the renderer, the other kinds still exist, and the pet's default is silent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const sources = walk(SRC).filter((f) => /\.(m?js)$/.test(f) && !/\.test\./.test(f));

test('source: no sfx(\'click\') or sfx(\'tab\') call remains; open, run, error, done, level and pet still do', () => {
  const all = sources.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.equal(/sfx\(\s*['"](?:tab|click)['"]\s*\)/.test(all), false, 'a tab or click sound call is still there');
  for (const k of ['open', 'run', 'error', 'done', 'level', 'pet']) assert.ok(new RegExp('sfx[(][ ]*[' + "'" + '"]' + k + '[' + "'" + '"][ ]*[)]').test(all), 'sfx(' + k + ') should still exist');
});

test('source: the effects engine starts silent, and app.js defaults sound through migrateSound, never to "on unless false"', () => {
  const fx = fs.readFileSync(path.join(SRC, 'elements', 'hq-fx.js'), 'utf8');
  assert.match(fx, /opts = \{ sound: false,/);
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  assert.match(app, /migrateSound\(/);
  assert.ok(!/sound: P\.sound !== false/.test(app));
  const shell = fs.readFileSync(path.join(SRC, 'vals', 'shell.js'), 'utf8');
  assert.ok(shell.includes('A short sound when something finishes (a scan, a save, a level-up).'));
  assert.ok(!/chiptune blips on clicks/.test(shell));
});
