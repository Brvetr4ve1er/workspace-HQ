// dashboard/claude-hub/link.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchProject, readHqProjects, autoLink } from './link.mjs';
import { projectForCwd } from '../../dashboard-v5/src/live/adapter.mjs';
import { openStore } from './store.mjs';

const P = [
  { id: 'project-a', path: 'project-a' },
  { id: 'project-b', path: 'project-b' },
  { id: 'nested', path: 'project-b/vendor/project-a' },
  { id: 'abs', path: 'C:\\placeholder\\abs-project' },
  { id: 'dot', path: '.' }, { id: 'up', path: '../x' }, { id: 'empty', path: '' },
];
const CWDS = ['C:\\placeholder\\project-a', 'C:/placeholder/project-a/src', 'C:\\placeholder\\project-b\\vendor\\project-a',
  'C:\\PLACEHOLDER\\ABS-PROJECT\\x', 'C:\\placeholder\\project-ab', 'C:\\placeholder\\other', '', null];

test('matchProject agrees with the renderer projectForCwd on every case', () => {
  for (const cwd of CWDS) assert.equal(matchProject(cwd, P), projectForCwd(cwd, P), String(cwd));
  assert.equal(matchProject('C:\\placeholder\\project-a', P), 'project-a');
  assert.equal(matchProject('C:\\placeholder\\project-ab', P), null);
});

test('readHqProjects: projects + archived, [] without a scan, throws on broken JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-link-'));
  const f = path.join(dir, 'latest.json');
  assert.deepEqual(readHqProjects(f), []);
  fs.writeFileSync(f, JSON.stringify({ projects: [{ id: 'project-a', path: 'project-a', name: 'x' }], archived_projects: [{ id: 'old', path: 'old' }] }));
  assert.deepEqual(readHqProjects(f), [{ id: 'project-a', path: 'project-a' }, { id: 'old', path: 'old' }]);
  fs.writeFileSync(f, '{ not json');
  assert.throws(() => readHqProjects(f));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('autoLink touches only none/auto rows and clears a stale auto link', () => {
  const s = openStore(':memory:');
  for (const [id, p] of [['code:a', 'C:\\placeholder\\project-a'], ['code:b', 'C:\\placeholder\\project-b'], ['code:c', 'C:\\placeholder\\other'], ['code:r', 'C:\\placeholder\\project-a\\sub']])
    s.upsertProject({ id, source: 'code', key: id.slice(5), name: id, path: p });
  s.setLink({ projectId: 'code:b', hqProjectId: 'project-a', state: 'confirmed' });   // owner's choice wins over the path
  s.setLink({ projectId: 'code:r', hqProjectId: 'x', state: 'rejected' });           // owner unlinked it
  s.setLink({ projectId: 'code:c', hqProjectId: 'gone', state: 'auto' });            // matched a project that no longer exists
  const r = autoLink(s, P);
  const by = Object.fromEntries(s.linkRows().map((x) => [x.id, x]));
  assert.deepEqual([by['code:a'].link_state, by['code:a'].hq_project_id], ['auto', 'project-a']);
  assert.deepEqual([by['code:b'].link_state, by['code:b'].hq_project_id], ['confirmed', 'project-a']);
  assert.deepEqual([by['code:r'].link_state, by['code:r'].hq_project_id], ['rejected', null]);
  assert.deepEqual([by['code:c'].link_state, by['code:c'].hq_project_id], ['none', null]);
  assert.deepEqual(r, { linked: 1, cleared: 1 });
  assert.deepEqual(autoLink(s, P), { linked: 0, cleared: 0 });   // idempotent
  s.close();
});
