// Projects render values: grid (sorts, cards), the iso map, archived.
import { FX } from '../logic/shared.js';

export function projectsVals(ctx) {
  const { S, H, snap, projects, sub, tabStyle, rows, rowOf } = ctx;
  // ----- projects -----
  const sorters = { worst: (a, b) => H.ST[a.st].rank - H.ST[b.st].rank || b.pct - a.pct, recent: (a, b) => (a.lastDays == null ? 999 : a.lastDays) - (b.lastDays == null ? 999 : b.lastDays), dirty: (a, b) => (b.dirty || 0) - (a.dirty || 0), name: (a, b) => a.name.localeCompare(b.name) };
  const projCards = projects.slice().sort(sorters[S.projSort] || sorters.worst).map(rowOf);
  const projSorts = [['worst', 'Worst first'], ['dirty', 'Most uncommitted'], ['recent', 'Recent'], ['name', 'Name']].map(([id, l]) => ({ label: l, go: () => this.setState({ projSort: id }), style: tabStyle(S.projSort === id) }));
  const archived = snap.archived.map((p) => ({ name: p.name, stack: p.stack.join(' · '), since: p.archivedOn ? 'Archived ' + H.fmtD(new Date(p.archivedOn + 'T12:00')) : 'Archived', restore: () => { if (!this.canWrite()) return this.denied(); this.toast('success', 'Restoring ' + p.name); FX().event('cheer', 'Welcome back, ' + p.name + '.'); this.defer('revive:' + p.id, () => this.call(() => this.hq.reviveProject(p.id), 'Restore failed')); } }));
  // iso map
  const tw = 88, th = 44, ox = 216, oy = 200, P2 = (x, y) => x.toFixed(1) + ',' + y.toFixed(1);
  const tiles = []; for (let gx = -1; gx <= 4; gx++) for (let gy = -1; gy <= Math.max(2, Math.ceil(rows.length / 4)); gy++) { const cx = ox + (gx - gy) * tw / 2, cy = oy + (gx + gy) * th / 2; tiles.push({ pts: [P2(cx, cy - th / 2), P2(cx + tw / 2, cy), P2(cx, cy + th / 2), P2(cx - tw / 2, cy)].join(' '), op: (gx + gy) % 2 ? 0.55 : 0.85 }); }
  const hovId = S.hoverProj && rows.some((p) => p.id === S.hoverProj) ? S.hoverProj : (rows[0] && rows[0].id);
  const towers = rows.map((p, i) => {
    const gx = i % 4, gy = Math.floor(i / 4), cx = ox + (gx - gy) * tw / 2, cy = oy + (gx + gy) * th / 2, hw = tw / 2 * 0.62, hh = th / 2 * 0.62;
    const Hh = 16 + Math.min(118, (p.dirty || 0) * 1.7 + Math.min(4, p.secrets || 0) * 34 + (p.hasGit ? 0 : 58) + (p.st === 'care' ? 14 : 0));
    const T = [cx, cy - hh], R = [cx + hw, cy], B = [cx, cy + hh], Lf = [cx - hw, cy], up = (a) => [a[0], a[1] - Hh];
    const j = (a) => a.map((q) => P2(q[0], q[1])).join(' ');
    const wins = p.activity === 'active' ? [0, 1, 2].filter((k) => 10 + k * 14 < Hh - 6).map((k) => ({ x: (cx - hw * 0.55).toFixed(1), y: (cy - 4 - k * 14 - 6).toFixed(1), dur: (1.6 + ((i + k) % 3) * 0.7).toFixed(1) + 's' })) : [];
    const smoke = p.st === 'risk' ? [0, 1, 2].map((k) => ({ x: (cx + (k - 1) * 5).toFixed(1), y0: (cy - hh - Hh).toFixed(1), y1: (cy - hh - Hh - 34).toFixed(1), begin: (k * 0.7).toFixed(1) + 's' })) : [];
    return { wins, smoke, hasSmoke: smoke.length > 0, depth: gx + gy, left: j([Lf, B, up(B), up(Lf)]), right: j([B, R, up(R), up(B)]), top: j([up(T), up(R), up(B), up(Lf)]), color: H.ST[p.st].color, stroke: hovId === p.id ? 'var(--gold)' : 'var(--ink)', sw: hovId === p.id ? 2.5 : 1.5, lx: cx, ly: cy + hh + 20, name: p.name, open: () => this.openProject(p.id), hover: () => this.setState({ hoverProj: p.id }) };
  }).sort((a, b) => a.depth - b.depth);
  const hp = projects.find((p) => p.id === hovId);
  const mapCard = hp ? Object.assign(rowOf(hp), { dirtyText: hp.dirty == null ? 'unknown (no git)' : String(hp.dirty), last: hp.lastCommit ? '"' + hp.lastCommit + '"' : 'no commits yet' }) : {};
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // projects
    isGrid: sub === 'grid', isMap: sub === 'map', isArchived: sub === 'archived', projSorts, projCards, archived, noArchived: archived.length === 0,
    tiles, towers, mapCard, mapOpen: () => hp && this.openProject(hp.id),
  };
}
