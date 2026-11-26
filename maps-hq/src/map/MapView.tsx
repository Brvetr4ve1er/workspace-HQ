import { useEffect, useRef, useState } from 'react';
import { Map as MLMap, Marker, addProtocol, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
// maplibre v6 ships its worker as a separate ESM file; Vite must emit it as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import { ARC, basemapStyle } from './style';
import { markerSvg } from './markers';
import type { Job, World } from '../world/model';
import { useUi } from '../ui/store';

let pmtilesRegistered = false;
function ensurePmtiles() {
  if (pmtilesRegistered) return;
  setWorkerUrl(workerUrl);
  addProtocol('pmtiles', new Protocol().tile);
  pmtilesRegistered = true;
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function districtsGeo(w: World): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: w.districts.filter((d) => d.ring).map((d) => ({
      type: 'Feature', properties: { id: d.id, kind: d.kind },
      geometry: { type: 'Polygon', coordinates: [d.ring!] },
    })),
  };
}
function routesGeo(w: World): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: w.districts.filter((d) => d.fixer).map((d) => ({
      type: 'Feature', properties: { id: d.id },
      geometry: { type: 'LineString', coordinates: [d.center, d.fixer!] },
    })),
  };
}
function buildingsGeo(w: World): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: w.buildings.map((b) => ({
      type: 'Feature',
      properties: { id: b.projectId, height: b.height, risk: b.risk, smoke: b.smoke, dormant: b.dormant, scaffold: b.scaffold },
      geometry: { type: 'Polygon', coordinates: [b.ring] },
    })),
  };
}

type Props = { world: World; jobs: Job[]; onMap?: (m: MLMap) => void };

export function MapView({ world, jobs, onMap }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const select = useUi((s) => s.select);
  const selected = useUi((s) => s.selected);

  useEffect(() => {
    ensurePmtiles();
    const map = new MLMap({
      container: el.current!, style: basemapStyle(), center: world.hq, zoom: 13.4, pitch: 52, bearing: -14,
      maxPitch: 75, attributionControl: { compact: true },
    });
    mapRef.current = map;
    // 'style.load', not 'load': the work layers must draw even when the tile host is down or blocked
    map.once('style.load', () => {
      map.addSource('districts', { type: 'geojson', data: EMPTY });
      map.addSource('routes', { type: 'geojson', data: EMPTY });
      map.addSource('buildings', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'district-fill', type: 'fill', source: 'districts', paint: { 'fill-color': ARC.plum, 'fill-opacity': 0.42 } });
      map.addLayer({ id: 'district-edge', type: 'line', source: 'districts', paint: { 'line-color': ARC.brass, 'line-width': 1.4, 'line-opacity': 0.75, 'line-dasharray': [4, 2] } });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: { 'line-cap': 'round' }, paint: { 'line-color': ARC.brass, 'line-width': 1.6, 'line-opacity': 0.55, 'line-dasharray': [1, 2.5] } });
      map.addLayer({
        id: 'buildings', type: 'fill-extrusion', source: 'buildings',
        paint: {
          'fill-extrusion-color': ['case',
            ['get', 'smoke'], '#7A3530',
            ['get', 'dormant'], '#1C2A3D',
            ['interpolate', ['linear'], ['get', 'risk'], 0, '#3E5068', 4, '#8C6E35', 10, ARC.brass]],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-opacity': 0.92,
        },
      });
      map.addLayer({ id: 'buildings-scaffold', type: 'line', source: 'buildings', filter: ['==', ['get', 'scaffold'], true], paint: { 'line-color': ARC.brass, 'line-width': 1, 'line-dasharray': [1, 1] } });
      map.on('click', 'buildings', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') select({ kind: 'building', id });
      });
      map.on('mouseenter', 'buildings', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'buildings', () => { map.getCanvas().style.cursor = ''; });
      onMap?.(map);
      setReady(true);
    });
    return () => { setReady(false); markers.current.forEach((m) => m.remove()); map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame the whole city once, on the first world read.
  const framed = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || framed.current) return;
    framed.current = true;
    const pts = [world.hq, ...world.districts.map((d) => d.center), ...world.buildings.map((b) => b.at)];
    const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lng), Math.min(...lat)], [Math.max(...lng), Math.max(...lat)]], { padding: map.getContainer().clientWidth < 720 ? 40 : { top: 140, bottom: 80, left: 300, right: 360 }, pitch: 50, bearing: -14, duration: 0, maxZoom: 15.5 });
  }, [world, ready]);

  // Geometry.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('districts') as GeoJSONSource).setData(districtsGeo(world));
    (map.getSource('routes') as GeoJSONSource).setData(routesGeo(world));
    (map.getSource('buildings') as GeoJSONSource).setData(buildingsGeo(world));
  }, [world, ready]);

  // DOM markers: jobs, fixers, district name cards, HQ. Text goes in through textContent only.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markers.current.forEach((m) => m.remove());
    const out: Marker[] = [];
    const sel = selected?.kind === 'job' ? selected.id : null;

    for (const d of world.districts) {
      const card = document.createElement('div');
      card.className = `district-card k-${d.kind}`;
      const name = document.createElement('div'); name.className = 'dc-name'; name.textContent = d.name;
      const prog = document.createElement('div'); prog.className = 'dc-prog';
      prog.textContent = d.progress.need ? `${d.progress.have}/${d.progress.need} ${d.progress.word}` : 'no repos yet';
      card.append(name, prog);
      out.push(new Marker({ element: card, anchor: 'bottom' }).setLngLat(d.labelAt).addTo(map));
      if (d.fixer) {
        const f = document.createElement('button');
        f.className = 'mk mk-fixer'; f.type = 'button';
        f.innerHTML = markerSvg('fixer', 'brass');
        f.title = d.fixerLabel ?? `${d.name} (fixer)`;
        f.setAttribute('aria-label', f.title);
        out.push(new Marker({ element: f, anchor: 'bottom' }).setLngLat(d.fixer).addTo(map));
      }
    }
    const hq = document.createElement('div');
    hq.className = 'mk mk-hq';
    hq.innerHTML = markerSvg('hq', 'cyan');
    hq.title = world.hqLabel;
    out.push(new Marker({ element: hq, anchor: 'bottom' }).setLngLat(world.hq).addTo(map));

    for (const j of jobs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mk mk-job k-${j.kind} u-${j.urgency}${sel === j.id ? ' is-sel' : ''}`;
      b.innerHTML = markerSvg(j.kind, j.urgency);
      b.title = j.title;
      b.setAttribute('aria-label', j.title);
      b.addEventListener('click', (e) => { e.stopPropagation(); select({ kind: 'job', id: j.id }); });
      out.push(new Marker({ element: b, anchor: 'center' }).setLngLat(j.at).addTo(map));
    }
    markers.current = out;
  }, [world, jobs, ready, selected, select]);

  // Fly to a selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selected) return;
    const at = selected.kind === 'job'
      ? world.jobs.find((j) => j.id === selected.id)?.at
      : world.buildings.find((b) => b.projectId === selected.id)?.at;
    if (at) map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 15.4), duration: 700 });
  }, [selected, ready, world]);

  return <div ref={el} className="map" />;
}
