import { useEffect, useMemo, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { MapView } from './map/MapView';
import { Radar } from './hud/Radar';
import { RankHud, BriefBoard, Legend, SelectionCard } from './hud/Hud';
import { buildWorld, filterJobs } from './world/model';
import { detectSource, loadWorld } from './world/source';
import type { WorldState } from './world/types';
import { useUi, selectionFromHash } from './ui/store';
import { pickBasemap } from './map/style';

const POLL_MS = 60_000;

export default function App() {
  const source = useMemo(() => detectSource(), []);
  const [state, setState] = useState<WorldState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const hidden = useUi((s) => s.hidden);
  const query = useUi((s) => s.query);
  const select = useUi((s) => s.select);

  // Load now, then once a minute and whenever the tab comes back.
  useEffect(() => {
    let off = false;
    const load = async () => {
      const r = await loadWorld(source);
      if (off) return;
      if (r.ok) { setError(r.world ? null : r.reason ?? 'No world yet.'); if (r.world) setState(r.world); }
      else setError(r.error);
    };
    load();
    const t = setInterval(load, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { off = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [source]);

  // On a phone the legend starts folded so the city shows first.
  useEffect(() => {
    try { if (window.matchMedia('(max-width: 720px)').matches) useUi.getState().setLegendOpen(false); } catch { /* no matchMedia */ }
  }, []);

  // Permalinks: #job=<id> or #b=<project>.
  useEffect(() => {
    const apply = () => { const s = selectionFromHash(window.location.hash); if (s) select(s); };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [select]);

  const world = useMemo(() => (state ? buildWorld(state) : null), [state]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const jobs = useMemo(() => (world ? filterJobs(world, hiddenSet, query) : []), [world, hiddenSet, query]);

  if (!world) {
    return (
      <div className="app boot">
        <div className="panel boot-card">
          <div className="brand">MAPS<span>HQ</span></div>
          <p>{error ?? 'Loading the city…'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <MapView world={world} jobs={jobs} onMap={setMap} />
      <header className="top">
        <div className="brand">MAPS<span>HQ</span></div>
        <RankHud world={world} source={source} />
      </header>
      <BriefBoard world={world} />
      <Legend world={world} />
      <SelectionCard world={world} source={source} />
      <Radar jobs={jobs} map={map} />
      {error && <div className="panel banner" role="status">{error} Showing the last city read.</div>}
      <footer className="hint">Surface · ops{source.mode === 'demo' ? ' · demo data' : ''} · tiles: {pickBasemap()}</footer>
    </div>
  );
}
