import { useEffect, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import type { Job } from '../world/model';
import { distanceM, type Pt } from '../world/geo';

const RADAR_M = 1600;

/** Radar around the camera centre: one blip per visible job in range, turning with the map. SVG only. */
export function Radar({ jobs, map }: { jobs: Job[]; map: MLMap | null }) {
  const [view, setView] = useState<{ c: Pt; bearing: number } | null>(null);
  useEffect(() => {
    if (!map) return;
    const sync = () => { const c = map.getCenter(); setView({ c: [c.lng, c.lat], bearing: map.getBearing() }); };
    sync();
    map.on('move', sync);
    return () => void map.off('move', sync);
  }, [map]);
  if (!view) return null;
  const { c, bearing } = view;
  const blips = jobs
    .map((j) => ({ j, d: distanceM(c, j.at) }))
    .filter((b) => b.d <= RADAR_M)
    .map(({ j, d }) => {
      const dy = (j.at[1] - c[1]) * 111320;
      const dx = (j.at[0] - c[0]) * 111320 * Math.cos((c[1] * Math.PI) / 180);
      const a = Math.atan2(dx, dy) - (bearing * Math.PI) / 180;
      const r = (d / RADAR_M) * 46;
      return { id: j.id, x: 50 + Math.sin(a) * r, y: 50 - Math.cos(a) * r, u: j.urgency };
    });
  return (
    <div className="radar" aria-label={`Radar: ${blips.length} jobs within ${RADAR_M / 1000} km`}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="48" className="r-bg" />
        <circle cx="50" cy="50" r="23" className="r-ring" />
        <circle cx="50" cy="50" r="46" className="r-ring" />
        {blips.map((b) => <circle key={b.id} cx={b.x} cy={b.y} r="2.4" className={`r-blip u-${b.u}`} />)}
        <path d="M50 45 L53.5 54 L50 52 L46.5 54 Z" className="r-you" />
        <text x="50" y="9" className="r-n" transform={`rotate(${-bearing} 50 50)`}>N</text>
      </svg>
    </div>
  );
}
