import { describe, it, expect } from 'vitest';
import { buildWorld, assignDistricts, riskOf, legendCounts, filterJobs, DEFAULT_HQ, DISTRICT_RING_M, OUTSKIRTS_RING_M } from './model';
import { FIXTURE } from './fixture';
import { distanceM, hash } from './geo';
import type { WorldState } from './types';

const clone = (): WorldState => JSON.parse(JSON.stringify(FIXTURE));

describe('districts', () => {
  it('pinned first, dormant to the Outskirts, delivery clients get their own, the rest to the Atelier', () => {
    const s = clone();
    s.pins = null;
    s.scope = [{ projectId: 'orchard-portal', done: 1, total: 2, open: [] }];
    const a = assignDistricts(s);
    expect(a.get('kite-game')!.id).toBe('outskirts');
    expect(a.get('orchard-portal')).toEqual({ id: 'client-orchard-portal', name: 'Orchard Portal', kind: 'client' });
    expect(a.get('toolbox')!.id).toBe('atelier');
    expect(assignDistricts(FIXTURE).get('lantern-site')!.id).toBe('lantern-co');
  });

  it('a pinned district shows even while empty', () => {
    const s = clone();
    s.pins!.districts.push({ id: 'new-client', name: 'New Client', kind: 'client', projects: [] });
    expect(buildWorld(s).districts.map((d) => d.id)).toContain('new-client');
  });

  it('districts sit on the inner ring, the Outskirts on the outer ring', () => {
    const w = buildWorld(FIXTURE);
    for (const d of w.districts) {
      const r = distanceM(w.hq, d.center);
      if (d.kind === 'outskirts') expect(Math.abs(r - OUTSKIRTS_RING_M)).toBeLessThan(30);
      else expect(Math.abs(r - DISTRICT_RING_M)).toBeLessThan(30);
    }
  });

  it('falls back to a public city centre until the owner pins their HQ', () => {
    const s = clone();
    s.pins = null;
    const w = buildWorld(s);
    expect(w.hq).toEqual(DEFAULT_HQ);
    expect(w.pinned).toBe(false);
  });
});

describe('plots are sticky', () => {
  it('same state, same plots', () => {
    expect(buildWorld(clone())).toEqual(buildWorld(clone()));
  });

  it('adding a project to another district moves nobody', () => {
    const before = buildWorld(FIXTURE);
    const s = clone();
    s.projects.push({ ...s.projects[0], id: 'zz-new', name: 'New' });
    s.pins!.districts.find((d) => d.id === 'orchard')!.projects.push('zz-new');
    const after = buildWorld(s);
    for (const b of before.buildings.filter((x) => x.districtId !== 'orchard')) {
      expect(after.buildings.find((x) => x.projectId === b.projectId)!.at).toEqual(b.at);
    }
  });

  it('no two buildings share a plot', () => {
    const w = buildWorld(FIXTURE);
    const keys = w.buildings.map((b) => b.at.join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('the hash is stable (plots depend on it)', () => {
    expect(hash('lantern-site')).toBe(hash('lantern-site'));
    expect(hash('a')).not.toBe(hash('b'));
  });
});

describe('buildings', () => {
  it('height is risk, from facts only', () => {
    const w = buildWorld(FIXTURE);
    const site = w.buildings.find((b) => b.projectId === 'lantern-site')!;
    const portal = w.buildings.find((b) => b.projectId === 'orchard-portal')!;
    expect(site.risk).toBeGreaterThan(portal.risk);
    expect(site.height).toBeGreaterThan(portal.height);
    expect(site.smoke).toBe(true);
    expect(site.scaffold).toBe(true);
    expect(portal.risk).toBe(0);
  });

  it('riskOf caps at 10', () => {
    const p = { ...FIXTURE.projects[0], build: 'red' as const, dirty: 99, secrets: true, unpushed: true };
    expect(riskOf(p, 5, 5)).toBe(10);
  });
});

describe('jobs', () => {
  it('a red build quest is a Fire, other red quests Contracts, the top Brief rows Contracts, secrets a Fire', () => {
    const w = buildWorld(FIXTURE);
    const kind = (id: string) => w.jobs.find((j) => j.id === id)?.kind;
    expect(kind('quest:q-lantern-site-build')).toBe('fire');
    expect(kind('quest:q-lantern-site-commit-dirty')).toBe('contract');
    expect(kind('quest:q-studio-site-push')).toBe('errand');
    expect(kind('brief:a1b2c3d4e5f6')).toBe('contract');
    expect(kind('brief:b2c3d4e5f6a1')).toBe('fire');
    expect(kind('brief:d4e5f6a1b2c3')).toBe('errand');
  });

  it('red is only for Fires and red Contracts', () => {
    for (const j of buildWorld(FIXTURE).jobs) {
      if (j.urgency === 'red') expect(j.kind === 'fire' || (j.kind === 'contract' && j.id.startsWith('quest:'))).toBe(true);
    }
  });

  it('commissions come from open scope items, at most 6 per building', () => {
    const s = clone();
    s.scope[0].open = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, text: `Item ${i}` }));
    const w = buildWorld(s);
    expect(w.jobs.filter((j) => j.kind === 'commission' && j.projectId === 'lantern-site')).toHaveLength(6);
  });

  it('jobs on one building fan out, none hidden under another', () => {
    const w = buildWorld(FIXTURE);
    const keys = w.jobs.map((j) => j.at.join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a job with no building stands at HQ', () => {
    const j = buildWorld(FIXTURE).jobs.find((x) => x.id === 'brief:d4e5f6a1b2c3')!;
    expect(j.projectId).toBeNull();
    expect(distanceM(j.at, [3.0588, 36.7538])).toBeLessThan(40);
  });

  it('every job can be opened in the app', () => {
    for (const j of buildWorld(FIXTURE).jobs) expect(j.target).not.toBeNull();
  });

  it('the quest-red Brief row is not doubled', () => {
    const s = clone();
    s.brief.push({ ref: 'eeeeeeeeeeee', rule: 'quest-red', severity: 'high', text: 'x', why: '', projectId: null, top: true });
    expect(buildWorld(s).jobs.some((j) => j.id === 'brief:eeeeeeeeeeee')).toBe(false);
  });
});

describe('legend', () => {
  it('counts per kind and filters by kind and by search', () => {
    const w = buildWorld(FIXTURE);
    const c = legendCounts(w.jobs);
    expect(c.fire).toBe(2);
    expect(c.commission).toBe(5);
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(w.jobs.length);
    expect(filterJobs(w, new Set(['fire']), '').some((j) => j.kind === 'fire')).toBe(false);
    expect(filterJobs(w, new Set(), 'orchard').every((j) => j.projectId === 'orchard-portal')).toBe(true);
    expect(filterJobs(w, new Set(), 'arabic')).toHaveLength(1);
  });
});

describe('progress is facts, never self-marked', () => {
  it('a client district reads its scope, others their clean buildings', () => {
    const w = buildWorld(FIXTURE);
    expect(w.districts.find((d) => d.id === 'lantern-co')!.progress).toEqual({ have: 6, need: 10, word: 'scope done' });
    const atelier = w.districts.find((d) => d.id === 'atelier')!.progress;
    expect(atelier).toEqual({ have: 1, need: 2, word: 'standing clean' });
  });

  it('stale when the scan is older than 36 h or unknown', () => {
    const s = clone();
    s.scanAgeHours = 40;
    expect(buildWorld(s).stale).toBe(true);
    s.scanAgeHours = null;
    expect(buildWorld(s).stale).toBe(true);
    expect(buildWorld(FIXTURE).stale).toBe(false);
  });
});
