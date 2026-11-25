import type { FeatureCollection, Polygon } from 'geojson';

/** Grid fog of war. The world is cut into CELL-degree squares; a cell is clear once the player has been near it. */
export const CELL = 0.0025; // ~250 m at the equator
export const REVEAL_RING = 1; // cells around the player that clear (3x3)
export const MAX_FOG_CELLS = 6000;

export const cellKey = (cx: number, cy: number) => `${cx}:${cy}`;
export const cellOf = (lng: number, lat: number): [number, number] => [Math.floor(lng / CELL), Math.floor(lat / CELL)];

/** Cell keys cleared by standing at lngLat. */
export function revealAround(lng: number, lat: number, ring = REVEAL_RING): string[] {
  const [cx, cy] = cellOf(lng, lat);
  const out: string[] = [];
  for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) out.push(cellKey(cx + dx, cy + dy));
  return out;
}

/** Fog squares for every unrevealed cell inside the bounds. Empty when the view is too wide (fog hides at low zoom). */
export function fogCells(
  bounds: { west: number; south: number; east: number; north: number },
  revealed: ReadonlySet<string>,
): FeatureCollection<Polygon> {
  const [x0, y0] = cellOf(bounds.west, bounds.south);
  const [x1, y1] = cellOf(bounds.east, bounds.north);
  const features: FeatureCollection<Polygon>['features'] = [];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_FOG_CELLS) return { type: 'FeatureCollection', features };
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      if (revealed.has(cellKey(x, y))) continue;
      const w = x * CELL, s = y * CELL, e = w + CELL, n = s + CELL;
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
    }
  }
  return { type: 'FeatureCollection', features };
}
