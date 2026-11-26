/**
 * The answer of GET /world/state on the WorkspaceHQ bridge (CONTRACT "Local bridge routes — the map").
 * Built by dashboard/world-project.js. The map only reads it: nothing here is ever written back,
 * and the map has no points, XP or progress of its own.
 */
export type Build = 'green' | 'red' | 'yellow' | 'unknown';
export type Activity = 'active' | 'stale' | 'dormant' | 'unknown';
export type Tier = 'red' | 'orange' | 'yellow';
export type Severity = 'high' | 'med' | 'low';
export type DistrictKind = 'client' | 'studio' | 'atelier';

export type LngLat = { lng: number; lat: number; label?: string };

export type WProject = {
  id: string; name: string; stack: string; activity: Activity; daysSinceCommit: number | null;
  completion: number; level: number; build: Build; dirty: number; ahead: number; unpushed: boolean;
  hasGit: boolean; hasRemote: boolean; secrets: boolean;
};
export type WQuest = { id: string; title: string; tier: Tier; projectId: string | null; ageDays: number };
export type WBriefRow = { ref: string; rule: string; severity: Severity; text: string; why: string; projectId: string | null; top: boolean };
export type WTop3 = { kind: string; label: string; reason: string; projectId: string | null; questId: string | null };
export type WScope = { projectId: string; done: number; total: number; open: { id: string; text: string }[] };
export type WDistrictPin = { id: string; name: string; kind: DistrictKind; fixer?: LngLat; projects: string[] };
export type WPins = { v: 1; hq: LngLat | null; districts: WDistrictPin[] };
export type WRank = { level: number; title: string; xp: number; xpIntoLevel: number; xpToNext: number; streakDays: number };

export type WorldState = {
  v: 1;
  generatedAt: string;
  scanAt: string | null;
  scanAgeHours: number | null;
  rank: WRank | null;
  pins: WPins | null;
  projects: WProject[];
  quests: WQuest[];
  brief: WBriefRow[];
  top3: WTop3[];
  scope: WScope[];
};

/** What the map may ask the app to open. The app finds it again in its own files or refuses. */
export type OpenTarget = { kind: 'brief'; ref: string } | { kind: 'project'; id: string } | { kind: 'quest'; id: string };
