/** Small geometry helpers. Pure. */
export type Pt = [number, number]; // [lng, lat]

const M_PER_DEG = 111320;

/** Move `m` metres east and north from a point (fine at city scale). */
export function offset([lng, lat]: Pt, east: number, north: number): Pt {
  const dLat = north / M_PER_DEG;
  const dLng = east / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return [round6(lng + dLng), round6(lat + dLat)];
}

export function polar(origin: Pt, metres: number, bearingDeg: number): Pt {
  const a = (bearingDeg * Math.PI) / 180;
  return offset(origin, Math.sin(a) * metres, Math.cos(a) * metres);
}

export function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** Great-circle distance in metres. */
export function distanceM(a: Pt, b: Pt): number {
  const R = 6371008.8;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b[1] - a[1]);
  const dLng = r(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** FNV-1a, 32 bit. Stable across runs and machines: plots depend on it. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Closed ring of an axis-aligned rectangle centred on c, w by h metres, corners cut by `chamfer` metres. */
export function chamferedRect(c: Pt, w: number, h: number, chamfer = 0): Pt[] {
  const x = w / 2, y = h / 2, k = Math.min(chamfer, x, y);
  const pts: [number, number][] = k > 0
    ? [[-x + k, -y], [x - k, -y], [x, -y + k], [x, y - k], [x - k, y], [-x + k, y], [-x, y - k], [-x, -y + k]]
    : [[-x, -y], [x, -y], [x, y], [-x, y]];
  const ring = pts.map(([e, n]) => offset(c, e, n));
  ring.push(ring[0]);
  return ring;
}
