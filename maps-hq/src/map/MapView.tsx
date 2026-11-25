import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MLMap, addProtocol, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
// maplibre v6 ships its worker as a separate ESM file; Vite must emit it as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { basemapStyle } from './style';
import { useGame } from '../game/store';
import { fogCells } from '../game/fog';
import { interestBySlug } from '../game/interests';
import type { NearbyPlace } from '../lib/supabase';

let pmtilesRegistered = false;
export function ensurePmtiles() {
  if (pmtilesRegistered) return;
  setWorkerUrl(workerUrl);
  addProtocol('pmtiles', new Protocol().tile);
  pmtilesRegistered = true;
}

type Props = { places: NearbyPlace[]; onMap?: (m: MLMap) => void };

export function MapView({ places, onMap }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const player = useGame((s) => s.player);
  const revealed = useGame((s) => s.revealed);
  const discoveries = useGame((s) => s.discoveries);
  const movePlayer = useGame((s) => s.movePlayer);
  const revealedSet = useMemo(() => new Set(revealed), [revealed]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensurePmtiles();
    const map = new MLMap({
      container: el.current!,
      style: basemapStyle(),
      center: player,
      zoom: 15.5,
      pitch: 55,
      bearing: -12,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on('load', () => {
      map.addSource('fog', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'fog', type: 'fill', source: 'fog', paint: { 'fill-color': '#05070b', 'fill-opacity': 0.72, 'fill-antialias': false } });
      map.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'places-glow', type: 'circle', source: 'places',
        paint: { 'circle-radius': 16, 'circle-color': ['get', 'color'], 'circle-opacity': ['case', ['get', 'found'], 0.06, 0.22], 'circle-blur': 1 },
      });
      map.addLayer({
        id: 'places', type: 'circle', source: 'places',
        paint: {
          'circle-radius': 6, 'circle-color': ['get', 'color'],
          'circle-stroke-color': '#07090d', 'circle-stroke-width': 2,
          'circle-opacity': ['case', ['get', 'found'], 0.35, 1],
        },
      });
      map.addSource('player', { type: 'geojson', data: { type: 'Point', coordinates: player } });
      map.addLayer({ id: 'player-halo', type: 'circle', source: 'player', paint: { 'circle-radius': 22, 'circle-color': '#3ae3ff', 'circle-opacity': 0.18, 'circle-blur': 0.6 } });
      map.addLayer({ id: 'player', type: 'circle', source: 'player', paint: { 'circle-radius': 7, 'circle-color': '#3ae3ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      onMap?.(map);
      setReady(true);
    });
    // Click = travel there (dev / desktop play). Real play uses GPS from the HUD.
    map.on('click', (e: MapMouseEvent) => movePlayer([e.lngLat.lng, e.lngLat.lat]));
    return () => { setReady(false); map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Player + camera follow.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('player') as GeoJSONSource | undefined)?.setData({ type: 'Point', coordinates: player });
    map.easeTo({ center: player, duration: 350 });
  }, [player, ready]);

  // Places layer.
  useEffect(() => {
    const map = mapRef.current;
    const push = () =>
      (map?.getSource('places') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: places.map((p) => ({
          type: 'Feature',
          properties: { id: p.id, name: p.name, color: interestBySlug[p.category]?.color ?? '#9aa4b2', found: !!discoveries[p.id] },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      });
    if (ready) push();
  }, [places, discoveries, ready]);

  // Fog follows the view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const draw = () => {
      const b = map.getBounds();
      (map.getSource('fog') as GeoJSONSource | undefined)?.setData(
        fogCells({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, revealedSet),
      );
    };
    draw();
    map.on('moveend', draw);
    return () => void map.off('moveend', draw);
  }, [revealedSet, ready]);

  return <div ref={el} className="map" />;
}
