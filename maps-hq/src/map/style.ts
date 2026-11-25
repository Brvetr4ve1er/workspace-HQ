import type { StyleSpecification } from 'maplibre-gl';
import { layers, namedFlavor } from '@protomaps/basemaps';

export type BasemapSource = 'pmtiles' | 'protomaps' | 'maptiler' | 'openfreemap';

const env = import.meta.env;

/** Which basemap the current env selects. Order: own PMTiles > Protomaps key > MapTiler key > free fallback. */
export function pickBasemap(e: Record<string, string | undefined> = env): BasemapSource {
  if (e.VITE_PMTILES_URL) return 'pmtiles';
  if (e.VITE_PROTOMAPS_KEY) return 'protomaps';
  if (e.VITE_MAPTILER_KEY) return 'maptiler';
  return 'openfreemap';
}

function protomapsStyle(sourceUrl: string): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/dark',
    sources: {
      protomaps: {
        type: 'vector',
        url: sourceUrl,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', namedFlavor('dark'), { lang: 'en' }),
  };
}

/** A style URL or object for maplibre `style`. */
export function basemapStyle(e: Record<string, string | undefined> = env): string | StyleSpecification {
  switch (pickBasemap(e)) {
    case 'pmtiles':
      return protomapsStyle(`pmtiles://${e.VITE_PMTILES_URL}`);
    case 'protomaps':
      return protomapsStyle(`https://api.protomaps.com/tiles/v4.json?key=${e.VITE_PROTOMAPS_KEY}`);
    case 'maptiler':
      return `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${e.VITE_MAPTILER_KEY}`;
    default:
      return 'https://tiles.openfreemap.org/styles/dark';
  }
}
