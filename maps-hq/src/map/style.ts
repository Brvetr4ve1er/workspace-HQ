/**
 * Numidia cartography, Arcanum night: a dark navy land, brass roads, ice labels kept quiet so the work reads first.
 * Two tile schemas are styled by hand: OpenMapTiles (OpenFreeMap, the default, no key) and Protomaps (own .pmtiles).
 * Cyan is reserved for the owner and Kuro, red for Fires and red Contracts, so neither appears in the basemap.
 */
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps';

export const ARC = {
  void: '#0A1420', navy: '#0F1E30', plum: '#13283E', brass: '#E6B450', brassDim: '#8C6E35',
  cyan: '#34D0E8', red: '#FF5A4D', ice: '#EAF1F8', iceDim: '#7F93A8', jade: '#3FBF8F',
} as const;

export type BasemapSource = 'pmtiles' | 'protomaps' | 'openfreemap' | 'none';

const env = import.meta.env as Record<string, string | undefined>;

export function pickBasemap(e: Record<string, string | undefined> = env): BasemapSource {
  if (e.VITE_BASEMAP === 'none') return 'none';
  if (e.VITE_PMTILES_URL) return 'pmtiles';
  if (e.VITE_PROTOMAPS_KEY) return 'protomaps';
  return 'openfreemap';
}

const OMT_ATTR = '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function omtLayers(): LayerSpecification[] {
  const s = 'omt';
  const road = (id: string, classes: string[], color: string, w: [number, number, number, number], opacity = 1): LayerSpecification => ({
    id, type: 'line', source: s, 'source-layer': 'transportation',
    filter: ['in', ['get', 'class'], ['literal', classes]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-opacity': opacity, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], w[0], w[1], w[2], w[3]] },
  });
  return [
    { id: 'bg', type: 'background', paint: { 'background-color': ARC.void } },
    { id: 'landcover', type: 'fill', source: s, 'source-layer': 'landcover', paint: { 'fill-color': ARC.navy, 'fill-opacity': 0.6 } },
    { id: 'park', type: 'fill', source: s, 'source-layer': 'park', paint: { 'fill-color': ARC.plum, 'fill-opacity': 0.7 } },
    { id: 'landuse', type: 'fill', source: s, 'source-layer': 'landuse', paint: { 'fill-color': ARC.navy, 'fill-opacity': 0.5 } },
    { id: 'water', type: 'fill', source: s, 'source-layer': 'water', paint: { 'fill-color': '#06101A' } },
    { id: 'waterway', type: 'line', source: s, 'source-layer': 'waterway', paint: { 'line-color': '#0B1B2B', 'line-width': 1.2 } },
    { id: 'boundary', type: 'line', source: s, 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 4], paint: { 'line-color': ARC.brassDim, 'line-opacity': 0.35, 'line-dasharray': [2, 3] } },
    road('road-minor', ['minor', 'service', 'track', 'path'], ARC.brassDim, [13, 0.3, 18, 6], 0.35),
    road('road-secondary', ['secondary', 'tertiary'], ARC.brassDim, [10, 0.4, 18, 10], 0.6),
    road('road-primary', ['primary', 'trunk'], ARC.brass, [7, 0.5, 18, 14], 0.45),
    road('road-motorway', ['motorway'], ARC.brass, [5, 0.6, 18, 18], 0.65),
    { id: 'rail', type: 'line', source: s, 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': ARC.iceDim, 'line-opacity': 0.3, 'line-width': 1, 'line-dasharray': [3, 3] } },
    {
      id: 'buildings-real', type: 'fill-extrusion', source: s, 'source-layer': 'building', minzoom: 14,
      paint: {
        'fill-extrusion-color': ARC.plum, 'fill-extrusion-opacity': 0.55,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      },
    },
    {
      id: 'place-label', type: 'symbol', source: s, 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'neighbourhood']]],
      layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 13], 'text-letter-spacing': 0.15, 'text-transform': 'uppercase' },
      paint: { 'text-color': ARC.iceDim, 'text-halo-color': ARC.void, 'text-halo-width': 1.4, 'text-opacity': 0.75 },
    },
  ];
}

function arcanumFlavor(): Flavor {
  return {
    ...namedFlavor('dark'),
    background: ARC.void, earth: ARC.void, water: '#06101A', buildings: ARC.plum,
    park_a: ARC.plum, park_b: ARC.plum, wood_a: ARC.navy, wood_b: ARC.navy, scrub_a: ARC.navy, scrub_b: ARC.navy,
    sand: '#16233A', beach: '#16233A', industrial: ARC.navy, school: ARC.navy, hospital: ARC.navy, pedestrian: ARC.navy,
    highway: ARC.brass, major: ARC.brass, link: ARC.brassDim, minor_a: ARC.brassDim, minor_b: ARC.brassDim, other: ARC.brassDim,
    highway_casing_early: ARC.void, highway_casing_late: ARC.void, major_casing_early: ARC.void, major_casing_late: ARC.void,
    railway: ARC.iceDim, boundaries: ARC.brassDim,
    city_label: ARC.iceDim, city_label_halo: ARC.void, subplace_label: ARC.iceDim, subplace_label_halo: ARC.void,
    roads_label_minor: ARC.iceDim, roads_label_minor_halo: ARC.void, roads_label_major: ARC.iceDim, roads_label_major_halo: ARC.void,
    ocean_label: ARC.iceDim, state_label: ARC.iceDim, state_label_halo: ARC.void, country_label: ARC.iceDim,
  };
}

function protomapsStyle(url: string): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sources: { protomaps: { type: 'vector', url, attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' } },
    layers: layers('protomaps', arcanumFlavor(), { lang: 'en' }) as LayerSpecification[],
  };
}

export function basemapStyle(e: Record<string, string | undefined> = env): StyleSpecification {
  switch (pickBasemap(e)) {
    case 'pmtiles': return protomapsStyle(`pmtiles://${e.VITE_PMTILES_URL}`);
    case 'protomaps': return protomapsStyle(`https://api.protomaps.com/tiles/v4.json?key=${e.VITE_PROTOMAPS_KEY}`);
    case 'none': return { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': ARC.void } }] };
    default:
      return {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: OMT_ATTR } },
        layers: omtLayers(),
      };
  }
}
