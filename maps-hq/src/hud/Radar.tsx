import { useEffect, useRef } from 'react';
import { Map as MLMap } from 'maplibre-gl';
import { basemapStyle } from '../map/style';
import { ensurePmtiles } from '../map/MapView';
import { useGame } from '../game/store';
import { haversineM } from '../game/xp';
import { interestBySlug } from '../game/interests';
import type { NearbyPlace } from '../lib/supabase';

const RADAR_M = 600;

/** Circular radar: a second, non-interactive map locked to the player, with blips for places in range. */
export function Radar({ places, main }: { places: NearbyPlace[]; main: MLMap | null }) {
  const el = useRef<HTMLDivElement>(null);
  const mini = useRef<MLMap | null>(null);
  const player = useGame((s) => s.player);
  const discoveries = useGame((s) => s.discoveries);

  useEffect(() => {
    ensurePmtiles();
    mini.current = new MLMap({ container: el.current!, style: basemapStyle(), center: player, zoom: 14, interactive: false, attributionControl: false });
    return () => mini.current?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!main) return;
    const sync = () => mini.current?.jumpTo({ bearing: main.getBearing() });
    main.on('rotate', sync);
    return () => void main.off('rotate', sync);
  }, [main]);

  useEffect(() => { mini.current?.jumpTo({ center: player }); }, [player]);

  const bearing = main?.getBearing() ?? 0;
  const blips = places
    .map((p) => ({ p, d: haversineM(player, [p.lng, p.lat]) }))
    .filter((b) => b.d <= RADAR_M && !discoveries[b.p.id])
    .map(({ p, d }) => {
      const dy = (p.lat - player[1]) * 111320;
      const dx = (p.lng - player[0]) * 111320 * Math.cos((player[1] * Math.PI) / 180);
      const a = Math.atan2(dx, dy) - (bearing * Math.PI) / 180;
      const r = (d / RADAR_M) * 50;
      return { id: p.id, x: 50 + Math.sin(a) * r, y: 50 - Math.cos(a) * r, color: interestBySlug[p.category]?.color ?? '#9aa4b2' };
    });

  return (
    <div className="radar" aria-label="Radar">
      <div ref={el} className="radar-map" />
      <div className="radar-sweep" />
      <svg className="radar-blips" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="25" className="ring" />
        <circle cx="50" cy="50" r="49" className="ring" />
        {blips.map((b) => <circle key={b.id} cx={b.x} cy={b.y} r="2.6" fill={b.color} />)}
        <path d="M50 44 L54 54 L50 51.5 L46 54 Z" className="you" />
      </svg>
      <div className="radar-n" style={{ transform: `rotate(${-bearing}deg)` }}><span>N</span></div>
    </div>
  );
}
