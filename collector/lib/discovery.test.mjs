import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeFolder, kindOf, looseFiles, detectVaultPaths, mergeVaults } from './discovery.mjs';

const noGit = () => ({ has_git: false });
const noPrune = (n) => n === 'node_modules';

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-disc-'));
  for (const f of files) {
    const abs = path.join(root, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (f.endsWith('/')) continue;
    fs.writeFileSync(abs, f.endsWith('package.json') ? '{"dependencies":{"next":"1","react":"1"}}' : 'x');
  }
  return root;
}

test('kindOf: empty beats vault beats project-like beats other', () => {
  assert.equal(kindOf({ files: 0, has_obsidian: true, has_git: true, stack: ['Node'] }), 'empty');
  assert.equal(kindOf({ files: 4, has_obsidian: true, has_git: true, stack: [] }), 'vault');
  assert.equal(kindOf({ files: 4, has_obsidian: false, has_git: false, stack: ['Python'] }), 'project-like');
  assert.equal(kindOf({ files: 4, has_obsidian: false, has_git: false, stack: [] }), 'other');
});

test('describeFolder reports stack, files and prunes node_modules', () => {
  const root = tree(['app/package.json', 'app/src/a.js', 'app/node_modules/x/y.js', 'app/README.md']);
  const d = describeFolder(path.join(root, 'app'), { root, gitFacts: noGit, shouldPrune: noPrune });
  assert.deepEqual(d.stack, ['Node', 'Next.js', 'React']);
  assert.equal(d.files, 3);
  assert.equal(d.md_files, 1);
  assert.equal(d.kind, 'project-like');
  assert.equal(d.path, 'app');
});

test('describeFolder flags a vault and an empty folder', () => {
  const root = tree(['v/.obsidian/app.json', 'v/note.md', 'e/']);
  assert.equal(describeFolder(path.join(root, 'v'), { root, gitFacts: noGit, shouldPrune: noPrune }).kind, 'vault');
  assert.equal(describeFolder(path.join(root, 'e'), { root, gitFacts: noGit, shouldPrune: noPrune }).kind, 'empty');
});

test('looseFiles lists root files largest first and skips desktop.ini', () => {
  const root = tree(['a.zip', 'desktop.ini', 'sub/x.txt']);
  fs.writeFileSync(path.join(root, 'big.bundle'), 'x'.repeat(50));
  assert.deepEqual(looseFiles(root).map((f) => f.name), ['big.bundle', 'a.zip']);
});

test('detectVaultPaths finds registry + root + child + grandchild vaults, deduped', () => {
  const root = tree(['.obsidian/a', 'one/.obsidian/a', 'two/inner/.obsidian/a', 'plain/f.txt']);
  const outside = tree(['.obsidian/a']);
  const registryFile = path.join(root, 'obsidian.json');
  fs.writeFileSync(registryFile, JSON.stringify({ vaults: { k1: { path: path.join(root, 'one') }, k2: { path: outside }, k3: { path: path.join(root, 'gone') } } }));
  const names = detectVaultPaths(root, { registryFile, shouldPrune: noPrune }).map((v) => `${path.basename(v.abs)}:${v.source}`).sort();
  assert.equal(names.filter((n) => n.startsWith('one:')).length, 1);          // registry + scan hit, one entry
  assert.ok(names.includes('inner:scan'));
  assert.ok(names.includes(`${path.basename(outside)}:registry`));            // outside the root still counted
  assert.ok(!names.some((n) => n.startsWith('gone')));                        // registry path that no longer exists is skipped
});

test('mergeVaults: config wins, no duplicate paths, embedded_in flagged', () => {
  const root = tree(['prod/.obsidian/a', 'cfg/.obsidian/a']);
  const detected = [{ abs: path.join(root, 'cfg'), source: 'scan' }, { abs: path.join(root, 'prod'), source: 'registry' }, { abs: root, source: 'scan' }];
  const m = mergeVaults(root, [{ name: 'CFG', path: 'cfg', role: 'primary' }], detected, [{ id: 'prod-id', abs: path.join(root, 'prod') }]);
  assert.equal(m.length, 3);
  assert.equal(m.find((v) => v.source === 'config').name, 'CFG');
  assert.equal(m.find((v) => v.name === 'prod').embedded_in, 'prod-id');
  assert.equal(m.find((v) => v.role === 'root').name, 'Documents (root)');
});

import { findProjectNote } from './discovery.mjs';
test('findProjectNote matches folders and files by normalised name across dirs', () => {
  const v = tree(['20_Projects/alliance travel agency/x.md', '20_Projects/doctor-cherfia-clinic/x.md', '30_Areas/crucix-osint-aggregator.md', '30_Areas/hamma-sat-iptv/x.md']);
  const dirs = ['20_Projects', '30_Areas'];
  assert.equal(findProjectNote(v, dirs, 'alliance travel'), '20_Projects/alliance travel agency');
  assert.equal(findProjectNote(v, dirs, 'DOCTOR CHERFIA CLINIC'), '20_Projects/doctor-cherfia-clinic');
  assert.equal(findProjectNote(v, dirs, 'Crucix'), '30_Areas/crucix-osint-aggregator.md');
  assert.equal(findProjectNote(v, dirs, 'HAMMA SAT IPTV'), '30_Areas/hamma-sat-iptv');
  assert.equal(findProjectNote(v, dirs, 'INTEL SCRAPER (A.G.E.S.)'), null);
  assert.equal(findProjectNote(v, ['nope'], 'alliance travel'), null);
});
