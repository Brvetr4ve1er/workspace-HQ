/**
 * The world model: turns the app's facts (WorldState) into a city. PURE and deterministic:
 * the same state always gives the same plots, so a building never moves while its district keeps its size.
 *
 * Region = everything around the HQ pin. District = one per client (from the owner's pins, or one per
 * delivery client when nothing is pinned), plus the Studio Quarter and the Atelier. Sub-district = a repo
 * (a building). Outskirts = dormant repos, scattered on the outer ring. Jobs sit on their building.
 *
 * No XP, no points, no "found" flags: every number shown comes from the scan, the Brief or a scope list.
 */
import type { DistrictKind, OpenTarget, Severity, WorldState, WProject, WRank } from './types';
import { chamferedRect, hash, offset, polar, type Pt } from './geo';

export const DEFAULT_HQ: Pt = [3.0588, 36.7538]; // a city centre, used only until the owner sets their own pin
export const DISTRICT_RING_M = 1300;
export const OUTSKIRTS_RING_M = 2300;
export const SECTORS = 12;
export const OUTSKIRT_SLOTS = 48;
export const PLOT_M = 70;
export const FOOTPRINT_M = 42;

export type JobKind = 'contract' | 'errand' | 'commission' | 'quickwin' | 'fire';
export const JOB_KINDS: JobKind[] = ['contract', 'fire', 'errand', 'commission', 'quickwin'];
export const JOB_LABEL: Record<JobKind, string> = {
  contract: 'Contract', fire: 'Fire', errand: 'Errand', commission: 'Commission', quickwin: 'Quick win',
};
export type Urgency = 'red' | 'brass' | 'dim';

export type Job = {
  id: string; kind: JobKind; urgency: Urgency; title: string; why: string;
  districtId: string | null; projectId: string | null; at: Pt; target: OpenTarget | null; verb: string;
};
export type District = {
  id: string; name: string; kind: DistrictKind | 'outskirts'; center: Pt; labelAt: Pt; ring: Pt[] | null;
  fixer: (Pt & { label?: string }) | null; fixerLabel: string | null; projectIds: string[];
  progress: { have: number; need: number; word: string };
};
export type Building = {
  projectId: string; name: string; districtId: string; ring: Pt[]; at: Pt; height: number; risk: number;
  scaffold: boolean; smoke: boolean; dormant: boolean; project: WProject;
};
export type World = {
  hq: Pt; hqLabel: string; pinned: boolean; districts: District[]; buildings: Building[]; jobs: Job[];
  rank: WRank | null; scanAgeHours: number | null; stale: boolean;
};

const FIRE_RULES = new Set(['scan-failed', 'prod-deploy-error', 'ci-red', 'secrets', 'session-waiting']);
const SKIP_RULES = new Set(['quest-red']); // red quests already stand on their building as contracts
const STALE_HOURS = 36;

/** Which district a project belongs to. Pinned first, then dormant -> Outskirts, then delivery client, else Atelier. */
export function assignDistricts(state: WorldState): Map<string, { id: string; name: string; kind: District['kind'] }> {
  const out = new Map<string, { id: string; name: string; kind: District['kind'] }>();
  const pinned = state.pins?.districts ?? [];
  const clients = new Set(state.scope.map((s) => s.projectId));
  for (const p of state.projects) {
    const pin = pinned.find((d) => d.projects.includes(p.id));
    if (pin) out.set(p.id, { id: pin.id, name: pin.name, kind: pin.kind });
    else if (p.activity === 'dormant') out.set(p.id, { id: 'outskirts', name: 'Outskirts', kind: 'outskirts' });
    else if (clients.has(p.id)) out.set(p.id, { id: `client-${p.id}`, name: p.name, kind: 'client' });
    else out.set(p.id, { id: 'atelier', name: 'Atelier', kind: 'atelier' });
  }
  return out;
}

/** Risk 0..10 from facts only: red build, dirty tree, unpushed work, secrets in plain text, open quests. */
export function riskOf(p: WProject, redQuests: number, orangeQuests: number): number {
  let r = 0;
  if (p.build === 'red') r += 3;
  if (p.dirty >= 10) r += 2; else if (p.dirty > 0) r += 1;
  if (p.unpushed || p.ahead > 0) r += 1;
  if (p.secrets) r += 3;
  r += 2 * redQuests + orangeQuests;
  return Math.min(10, r);
}

/** Spread picker for districts: from hash(key) on, the first free slot with both neighbours free, else any free slot. */
function pickSpread(key: string, slots: number, taken: Set<number>): number {
  const start = hash(key) % slots;
  for (let i = 0; i < slots; i++) {
    const s = (start + i) % slots;
    if (!taken.has(s) && !taken.has((s + 1) % slots) && !taken.has((s + slots - 1) % slots)) { taken.add(s); return s; }
  }
  return pick(key, slots, taken);
}

/** Linear-probe slot picker: the first free slot from hash(key) on. */
function pick(key: string, slots: number, taken: Set<number>): number {
  let s = hash(key) % slots;
  for (let i = 0; i < slots && taken.has(s); i++) s = (s + 1) % slots;
  taken.add(s);
  return s;
}

function gridSide(n: number): number {
  for (const side of [3, 5, 7, 9, 11]) if (side * side - 1 >= n) return side;
  return 13;
}

export function buildWorld(state: WorldState): World {
  const hq: Pt = state.pins?.hq ? [state.pins.hq.lng, state.pins.hq.lat] : DEFAULT_HQ;
  const assigned = assignDistricts(state);
  const byDistrict = new Map<string, { name: string; kind: District['kind']; ids: string[] }>();
  for (const p of state.projects) {
    const a = assigned.get(p.id)!;
    const d = byDistrict.get(a.id) ?? { name: a.name, kind: a.kind, ids: [] };
    d.ids.push(p.id);
    byDistrict.set(a.id, d);
  }
  // pinned districts show even while empty: the owner set them on purpose
  for (const d of state.pins?.districts ?? []) if (!byDistrict.has(d.id)) byDistrict.set(d.id, { name: d.name, kind: d.kind, ids: [] });

  const quests = new Map<string, { red: number; orange: number }>();
  for (const q of state.quests) {
    if (!q.projectId) continue;
    const c = quests.get(q.projectId) ?? { red: 0, orange: 0 };
    if (q.tier === 'red' && !q.id.endsWith('-build')) c.red++;
    if (q.tier === 'orange') c.orange++;
    quests.set(q.projectId, c);
  }

  const projById = new Map(state.projects.map((p) => [p.id, p]));
  const districts: District[] = [];
  const buildings: Building[] = [];
  const sectorTaken = new Set<number>();
  const outskirtTaken = new Set<number>();
  const ids = [...byDistrict.keys()].sort();

  for (const id of ids) {
    const d = byDistrict.get(id)!;
    const pinned = state.pins?.districts.find((x) => x.id === id);
    const fixer = pinned?.fixer ? ([pinned.fixer.lng, pinned.fixer.lat] as Pt) : null;
    const members = [...d.ids].sort();
    let center: Pt;
    let labelAt: Pt;
    let ring: Pt[] | null = null;

    if (d.kind === 'outskirts') {
      center = polar(hq, OUTSKIRTS_RING_M, 200);
      labelAt = center;
      for (const pid of members) {
        const s = pick(pid, OUTSKIRT_SLOTS, outskirtTaken);
        const jitter = (hash(pid + ':r') % 400) - 200;
        buildings.push(makeBuilding(projById.get(pid)!, id, polar(hq, OUTSKIRTS_RING_M + jitter, (s * 360) / OUTSKIRT_SLOTS), quests));
      }
    } else {
      const sector = pickSpread(id, SECTORS, sectorTaken);
      center = polar(hq, DISTRICT_RING_M, (sector * 360) / SECTORS);
      const side = gridSide(members.length);
      const mid = (side * side - 1) / 2;
      const taken = new Set<number>([mid]); // the centre plot holds the district's name card
      for (const pid of members) {
        const s = pick(pid, side * side, taken);
        const gx = (s % side) - (side - 1) / 2;
        const gy = Math.floor(s / side) - (side - 1) / 2;
        buildings.push(makeBuilding(projById.get(pid)!, id, offset(center, gx * PLOT_M, -gy * PLOT_M), quests));
      }
      const size = side * PLOT_M + 40;
      ring = chamferedRect(center, size, size, PLOT_M * 0.8);
      labelAt = offset(center, 0, size / 2 + 12); // the name card stands on the district's north edge
    }

    districts.push({
      id, name: d.name, kind: d.kind, center, labelAt, ring, fixer, fixerLabel: pinned?.fixer?.label ?? null, projectIds: members,
      progress: progressOf(d.kind, members, state, projById),
    });
  }

  const jobs = buildJobs(state, hq, buildings, assigned);
  const stale = state.scanAgeHours == null || state.scanAgeHours > STALE_HOURS;
  return {
    hq, hqLabel: state.pins?.hq?.label ?? 'HQ', pinned: !!state.pins?.hq, districts, buildings, jobs,
    rank: state.rank, scanAgeHours: state.scanAgeHours, stale,
  };
}

function makeBuilding(p: WProject, districtId: string, at: Pt, quests: Map<string, { red: number; orange: number }>): Building {
  const q = quests.get(p.id) ?? { red: 0, orange: 0 };
  const risk = riskOf(p, q.red, q.orange);
  const dormant = p.activity === 'dormant';
  return {
    projectId: p.id, name: p.name, districtId, at,
    ring: chamferedRect(at, FOOTPRINT_M, FOOTPRINT_M, dormant ? 0 : 6),
    height: dormant ? 8 : 16 + risk * 14, risk,
    scaffold: p.dirty > 0, smoke: p.build === 'red', dormant, project: p,
  };
}

/** A district's progress, from facts: a client's scope items done, else its buildings standing clean. */
function progressOf(kind: District['kind'], members: string[], state: WorldState, projById: Map<string, WProject>): District['progress'] {
  const scopes = state.scope.filter((s) => members.includes(s.projectId));
  if (kind === 'client' && scopes.some((s) => s.total > 0)) {
    const have = scopes.reduce((a, s) => a + s.done, 0);
    const need = scopes.reduce((a, s) => a + s.total, 0);
    return { have, need, word: 'scope done' };
  }
  const clean = members.filter((pid) => {
    const p = projById.get(pid)!;
    return p.build !== 'red' && p.dirty === 0 && !p.unpushed && p.ahead === 0 && !p.secrets;
  }).length;
  return { have: clean, need: members.length, word: 'standing clean' };
}

function urgencyOfSeverity(s: Severity): Urgency {
  return s === 'low' ? 'dim' : 'brass';
}

function buildJobs(state: WorldState, hq: Pt, buildings: Building[], assigned: ReturnType<typeof assignDistricts>): Job[] {
  const at = new Map(buildings.map((b) => [b.projectId, b.at]));
  const count = new Map<string, number>();
  // jobs on the same anchor fan out on a small ring so none hides another
  const place = (projectId: string | null): Pt => {
    const anchor = (projectId && at.get(projectId)) || hq;
    const key = projectId && at.has(projectId) ? projectId : '#hq';
    const k = count.get(key) ?? 0;
    count.set(key, k + 1);
    return k === 0 ? anchor : polar(anchor, 16 + 6 * Math.floor((k - 1) / 6), ((k - 1) % 6) * 60 + 30);
  };
  const districtOf = (pid: string | null) => (pid ? assigned.get(pid)?.id ?? null : null);
  const jobs: Job[] = [];

  for (const b of state.brief) {
    if (SKIP_RULES.has(b.rule)) continue;
    const pid = b.projectId && at.has(b.projectId) ? b.projectId : null;
    const fire = FIRE_RULES.has(b.rule);
    jobs.push({
      id: `brief:${b.ref}`, kind: fire ? 'fire' : b.top ? 'contract' : 'errand',
      urgency: fire ? 'red' : urgencyOfSeverity(b.severity),
      title: b.text, why: b.why, projectId: pid, districtId: districtOf(pid), at: place(pid),
      target: { kind: 'brief', ref: b.ref }, verb: 'Open in WorkspaceHQ',
    });
  }
  for (const q of state.quests) {
    const pid = q.projectId && at.has(q.projectId) ? q.projectId : null;
    const buildFire = q.tier === 'red' && q.id.endsWith('-build');
    jobs.push({
      id: `quest:${q.id}`, kind: buildFire ? 'fire' : q.tier === 'red' ? 'contract' : 'errand',
      urgency: q.tier === 'red' ? 'red' : q.tier === 'orange' ? 'brass' : 'dim',
      title: q.title, why: q.ageDays > 0 ? `Open for ${q.ageDays} d` : 'New this scan',
      projectId: pid, districtId: districtOf(pid), at: place(pid), target: { kind: 'quest', id: q.id }, verb: 'Open in Tasks',
    });
  }
  for (const s of state.scope) {
    if (!at.has(s.projectId)) continue;
    for (const item of s.open.slice(0, 6)) {
      jobs.push({
        id: `scope:${s.projectId}:${item.id}`, kind: 'commission', urgency: 'brass', title: item.text,
        why: `${s.done} of ${s.total} scope items done`, projectId: s.projectId, districtId: districtOf(s.projectId),
        at: place(s.projectId), target: { kind: 'project', id: s.projectId }, verb: 'Open the client project',
      });
    }
  }
  state.top3.forEach((t, i) => {
    const pid = t.projectId && at.has(t.projectId) ? t.projectId : null;
    jobs.push({
      id: `top3:${i}:${t.questId ?? t.projectId ?? 'x'}`, kind: 'quickwin', urgency: 'brass', title: t.label, why: t.reason,
      projectId: pid, districtId: districtOf(pid), at: place(pid),
      target: t.questId ? { kind: 'quest', id: t.questId } : pid ? { kind: 'project', id: pid } : null,
      verb: t.questId ? 'Open in Tasks' : 'Open project',
    });
  });
  return jobs;
}

/** Legend counts and filtering (MapGenie-style): per kind, live, and a search over titles and district names. */
export function legendCounts(jobs: Job[]): Record<JobKind, number> {
  const out = { contract: 0, fire: 0, errand: 0, commission: 0, quickwin: 0 } as Record<JobKind, number>;
  for (const j of jobs) out[j.kind]++;
  return out;
}

export function filterJobs(world: World, hidden: ReadonlySet<JobKind>, query: string): Job[] {
  const q = query.trim().toLowerCase();
  const dname = new Map(world.districts.map((d) => [d.id, d.name.toLowerCase()]));
  const pname = new Map(world.buildings.map((b) => [b.projectId, b.name.toLowerCase()]));
  return world.jobs.filter((j) => {
    if (hidden.has(j.kind)) return false;
    if (!q) return true;
    return j.title.toLowerCase().includes(q)
      || (j.districtId != null && (dname.get(j.districtId) ?? '').includes(q))
      || (j.projectId != null && (pname.get(j.projectId) ?? '').includes(q));
  });
}
