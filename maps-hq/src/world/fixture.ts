/**
 * An INVENTED world for `npm run dev` and the tests. Never owner data: every name, client and pin is made up,
 * and the HQ sits on a public city centre. The real world comes from GET /world/state on the bridge.
 */
import type { WorldState } from './types';

export const FIXTURE: WorldState = {
  v: 1,
  generatedAt: '2026-11-25T12:00:00.000Z',
  scanAt: '2026-11-25T09:00:00.000Z',
  scanAgeHours: 3,
  rank: { level: 7, title: 'Artificer', xp: 4200, xpIntoLevel: 300, xpToNext: 700, streakDays: 4 },
  pins: {
    v: 1,
    hq: { lng: 3.0588, lat: 36.7538, label: 'Studio' },
    districts: [
      { id: 'lantern-co', name: 'Lantern & Co', kind: 'client', fixer: { lng: 3.0421, lat: 36.7651, label: 'Lantern & Co office' }, projects: ['lantern-site', 'lantern-booking'] },
      { id: 'orchard', name: 'Orchard Freight', kind: 'client', fixer: { lng: 3.0702, lat: 36.7449, label: 'Orchard depot' }, projects: ['orchard-portal'] },
      { id: 'studio', name: 'Studio Quarter', kind: 'studio', projects: ['studio-site', 'studio-hub'] },
      { id: 'atelier', name: 'Atelier', kind: 'atelier', projects: ['toolbox', 'field-notes'] },
    ],
  },
  projects: [
    p('lantern-site', 'Lantern Site', { build: 'red', dirty: 23, ahead: 2, unpushed: true, completion: 72 }),
    p('lantern-booking', 'Lantern Booking', { dirty: 3, completion: 40 }),
    p('orchard-portal', 'Orchard Portal', { completion: 88 }),
    p('studio-site', 'Studio Site', { ahead: 1, unpushed: true, completion: 64 }),
    p('studio-hub', 'Studio Hub', { secrets: true, completion: 51 }),
    p('toolbox', 'Toolbox', { dirty: 12, completion: 80 }),
    p('field-notes', 'Field Notes', { completion: 30 }),
    p('kite-game', 'Kite Game', { activity: 'dormant', daysSinceCommit: 240, completion: 20 }),
    p('old-blog', 'Old Blog', { activity: 'dormant', daysSinceCommit: 400, completion: 90 }),
  ],
  quests: [
    { id: 'q-lantern-site-build', title: 'Fix Lantern Site build', tier: 'red', projectId: 'lantern-site', ageDays: 2 },
    { id: 'q-lantern-site-commit-dirty', title: 'Commit Lantern Site working tree (23 files)', tier: 'red', projectId: 'lantern-site', ageDays: 1 },
    { id: 'q-studio-site-push', title: 'Push Studio Site (1 ahead)', tier: 'orange', projectId: 'studio-site', ageDays: 3 },
    { id: 'q-toolbox-tests', title: 'Add tests to Toolbox', tier: 'yellow', projectId: 'toolbox', ageDays: 9 },
    { id: 'q-kite-game-revive', title: 'Decide: revive or archive Kite Game', tier: 'yellow', projectId: 'kite-game', ageDays: 30 },
  ],
  brief: [
    { ref: 'a1b2c3d4e5f6', rule: 'dirty', severity: 'med', text: 'Commit 23 files in Lantern Site', why: 'They live only on this PC.', projectId: 'lantern-site', top: true },
    { ref: 'b2c3d4e5f6a1', rule: 'secrets', severity: 'high', text: 'Secrets sit in plain text in this repo', why: '', projectId: 'studio-hub', top: true },
    { ref: 'c3d4e5f6a1b2', rule: 'unpushed', severity: 'med', text: 'Push Studio Site: 1 commit only here', why: 'A disk failure would lose it.', projectId: 'studio-site', top: true },
    { ref: 'd4e5f6a1b2c3', rule: 'scan-stale', severity: 'low', text: 'Last scan is 3 h old', why: '', projectId: null, top: false },
  ],
  top3: [{ kind: 'quick', label: 'Push Studio Site', reason: 'One command, then it is safe', projectId: 'studio-site', questId: 'q-studio-site-push' }],
  scope: [
    { projectId: 'lantern-site', done: 6, total: 10, open: [{ id: 'i1', text: 'Contact form sends to the office inbox' }, { id: 'i2', text: 'Arabic menu labels' }, { id: 'i3', text: 'Gallery page' }, { id: 'i4', text: 'Footer map link' }] },
    { projectId: 'orchard-portal', done: 7, total: 8, open: [{ id: 'j1', text: 'Driver sign-in on phones' }] },
  ],
};

function p(id: string, name: string, o: Partial<WorldState['projects'][number]> = {}): WorldState['projects'][number] {
  return {
    id, name, stack: 'ts', activity: 'active', daysSinceCommit: 1, completion: 50, level: 3, build: 'green',
    dirty: 0, ahead: 0, unpushed: false, hasGit: true, hasRemote: true, secrets: false, ...o,
  };
}
