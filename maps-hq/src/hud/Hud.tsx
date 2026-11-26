import { useState } from 'react';
import type { Job, World } from '../world/model';
import { JOB_KINDS, JOB_LABEL, legendCounts } from '../world/model';
import type { Source } from '../world/source';
import { openInApp } from '../world/source';
import { legendSvg } from '../map/markers';
import { useUi, permalink } from '../ui/store';

/** Rank, read from the app's own economy. The map never adds to it. */
export function RankHud({ world, source }: { world: World; source: Source }) {
  const r = world.rank;
  const pct = r && r.xpIntoLevel + r.xpToNext > 0 ? (r.xpIntoLevel / (r.xpIntoLevel + r.xpToNext)) * 100 : 0;
  return (
    <div className="panel rank">
      <div className="rank-row">
        <span className="rank-lvl">L{r?.level ?? '?'}</span>
        <span className="rank-title">{r?.title || 'No scan yet'}</span>
      </div>
      <div className="rank-track" aria-hidden="true"><div className="rank-fill" style={{ width: `${pct}%` }} /></div>
      <div className="rank-meta">
        {r ? `${r.xpToNext} to next · streak ${r.streakDays} d` : 'Run a scan in WorkspaceHQ'}
        {' · '}
        <span className={world.stale ? 'warn' : ''}>
          {world.scanAgeHours == null ? 'scan age unknown' : `scan ${world.scanAgeHours} h ago`}
        </span>
      </div>
      {source.mode === 'demo' && <div className="rank-demo">Invented demo city. Your own opens from WorkspaceHQ.</div>}
      {!world.pinned && source.mode === 'live' && <div className="rank-demo">HQ is not pinned yet: data/world/pins.json</div>}
    </div>
  );
}

/** The Brief's top rows, as the jobs board. Clicking one flies to it. */
export function BriefBoard({ world }: { world: World }) {
  const select = useUi((s) => s.select);
  const rows = world.jobs.filter((j) => j.id.startsWith('brief:')).slice(0, 3);
  if (!rows.length) return <div className="panel board"><div className="board-k">ALL CLEAR</div><div className="board-empty">The Brief has nothing for you.</div></div>;
  return (
    <div className="panel board">
      <div className="board-k">WHAT NEEDS YOU</div>
      {rows.map((j) => (
        <button key={j.id} type="button" className={`board-row u-${j.urgency}`} onClick={() => select({ kind: 'job', id: j.id })}>
          <span className="board-dot" aria-hidden="true" />
          <span className="board-t">{j.title}</span>
        </button>
      ))}
    </div>
  );
}

/** MapGenie-style legend: groups with live counts, show all / hide all, search. */
export function Legend({ world }: { world: World }) {
  const { hidden, toggleKind, showAll, hideAll, query, setQuery, legendOpen, setLegendOpen } = useUi();
  const counts = legendCounts(world.jobs);
  if (!legendOpen) return <button type="button" className="panel legend-tab" onClick={() => setLegendOpen(true)}>Legend</button>;
  return (
    <aside className="panel legend" aria-label="Legend">
      <div className="legend-head">
        <span className="legend-k">JOBS</span>
        <button type="button" className="link" onClick={showAll}>Show all</button>
        <button type="button" className="link" onClick={() => hideAll(JOB_KINDS)}>Hide all</button>
        <button type="button" className="link" aria-label="Close legend" onClick={() => setLegendOpen(false)}>×</button>
      </div>
      <input className="legend-search" type="search" placeholder="Search jobs, repos, districts" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="legend-list">
        {JOB_KINDS.map((k) => (
          <li key={k}>
            <button type="button" className={hidden.includes(k) ? 'legend-item off' : 'legend-item'} aria-pressed={!hidden.includes(k)} onClick={() => toggleKind(k)}>
              <span className="legend-ico" dangerouslySetInnerHTML={{ __html: legendSvg(k) }} />
              <span className="legend-name">{JOB_LABEL[k]}</span>
              <span className="legend-n">{counts[k]}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="legend-k sub">DISTRICTS</div>
      <ul className="legend-districts">
        {world.districts.map((d) => (
          <li key={d.id}>
            <span className="ld-name">{d.name}</span>
            <span className="ld-bar" aria-hidden="true"><span style={{ width: `${d.progress.need ? (d.progress.have / d.progress.need) * 100 : 0}%` }} /></span>
            <span className="ld-n">{d.progress.have}/{d.progress.need}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** One card for the selection: what, where, why, and the one verb. */
export function SelectionCard({ world, source }: { world: World; source: Source }) {
  const selected = useUi((s) => s.selected);
  const select = useUi((s) => s.select);
  const [msg, setMsg] = useState<string | null>(null);
  if (!selected) return null;

  const job: Job | undefined = selected.kind === 'job' ? world.jobs.find((j) => j.id === selected.id) : undefined;
  const bId = job?.projectId ?? (selected.kind === 'building' ? selected.id : null);
  const b = bId ? world.buildings.find((x) => x.projectId === bId) : undefined;
  const district = world.districts.find((d) => d.id === (job?.districtId ?? b?.districtId));
  if (!job && !b) return null;

  const act = async (target: NonNullable<Job['target']>) => {
    setMsg('Opening…');
    const r = await openInApp(source, target);
    setMsg(r.message);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(permalink(selected)); setMsg('Link copied (it never carries the key).'); } catch { setMsg('Could not copy.'); }
  };
  const p = b?.project;
  const others = b ? world.jobs.filter((j) => j.projectId === b.projectId && j.id !== job?.id) : [];

  return (
    <section className="panel card" aria-label="Selection">
      <button type="button" className="card-x" aria-label="Close" onClick={() => { setMsg(null); select(null); }}>×</button>
      {job ? (
        <>
          <div className={`card-kind u-${job.urgency}`}>{JOB_LABEL[job.kind].toUpperCase()}</div>
          <h2 className="card-t">{job.title}</h2>
          {job.why && <p className="card-why">{job.why}</p>}
        </>
      ) : (
        <>
          <div className="card-kind">REPO</div>
          <h2 className="card-t">{b!.name}</h2>
        </>
      )}
      <div className="card-where">{[district?.name, b && job ? b.name : null].filter(Boolean).join(' · ')}</div>
      {p && (
        <dl className="card-facts">
          <div><dt>Build</dt><dd className={p.build === 'red' ? 'warn' : ''}>{p.build}</dd></div>
          <div><dt>Uncommitted</dt><dd>{p.dirty}</dd></div>
          <div><dt>Ahead</dt><dd>{p.ahead}</dd></div>
          <div><dt>Done</dt><dd>{p.completion}%</dd></div>
          <div><dt>Last commit</dt><dd>{p.daysSinceCommit == null ? 'n/a' : `${p.daysSinceCommit} d`}</dd></div>
          <div><dt>Risk</dt><dd>{b!.risk}/10</dd></div>
        </dl>
      )}
      <div className="card-actions">
        {job?.target && <button type="button" className="cta" onClick={() => act(job.target!)}>{job.verb}</button>}
        {!job && b && <button type="button" className="cta" onClick={() => act({ kind: 'project', id: b.projectId })}>Open project</button>}
        <button type="button" className="btn" onClick={copy}>Copy link</button>
      </div>
      {msg && <div className="card-msg" role="status">{msg}</div>}
      {others.length > 0 && (
        <div className="card-more">
          <div className="legend-k sub">ALSO HERE</div>
          {others.slice(0, 6).map((j) => (
            <button key={j.id} type="button" className={`board-row u-${j.urgency}`} onClick={() => { setMsg(null); select({ kind: 'job', id: j.id }); }}>
              <span className="board-dot" aria-hidden="true" /><span className="board-t">{j.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
