// Cosmos space — masonry layout maths for the Feed. Ported by hand (behaviour, not code) from Cosmos Local's
// src/lib/masonryLayout.ts. PURE: numbers in, numbers out; the caller measures the container and passes `width`.
//
//   computeMasonry(ratios, width, minCol, gap) -> { rects:[{x,y,w,h}], height, columns, colWidth }
//     Pinterest placement: each item drops into the currently shortest column, leftmost on ties; the trailing gap is trimmed.
//   layoutGroups(groups, { width, density, headerH, limit }) -> { cards, headers, height, columns, colWidth, shown, total }
//     groups stacked vertically, each with a header slot (skipped for an unlabelled group), cards as dc-lite style maps
//     (plain numbers; the template engine adds px).

/** Column tokens per density. */
export const DENSITY_COLS = Object.freeze({
  compact: Object.freeze({ col: 176, gap: 12 }),
  cozy: Object.freeze({ col: 244, gap: 16 }),
  roomy: Object.freeze({ col: 330, gap: 20 }),
});
export const DENSITIES = Object.freeze(['compact', 'cozy', 'roomy']);

/** Narrow containers collapse to this grid whatever the density. */
export const MOBILE_COLS = Object.freeze({ col: 168, gap: 10 });
export const MOBILE_BREAK = 860;

/** Aspect ratio (w/h) assumed for a work with no usable size. */
export const FALLBACK_RATIO = 3 / 4;

/** Height of a group's header slot, and the pad under a group before the next header. */
export const HEADER_H = 28;
export const SECTION_PAD = 28;

export function computeMasonry(ratios, width, minCol, gap) {
  const columns = Math.max(1, Math.floor((width + gap) / (minCol + gap)));
  const colWidth = (width - gap * (columns - 1)) / columns;
  const heights = new Array(columns).fill(0);
  const rects = new Array(ratios.length);
  for (let i = 0; i < ratios.length; i++) {
    let col = 0;
    for (let c = 1; c < columns; c++) if (heights[c] < heights[col]) col = c;
    const ratio = ratios[i] > 0 ? ratios[i] : FALLBACK_RATIO;
    const h = colWidth / ratio;
    rects[i] = { x: col * (colWidth + gap), y: heights[col], w: colWidth, h };
    heights[col] += h + gap;
  }
  let tallest = 0;
  for (const h of heights) if (h > tallest) tallest = h;
  return { rects, height: tallest > 0 ? tallest - gap : 0, columns, colWidth };
}

/** width / height of a work, or FALLBACK_RATIO when it has no usable size. */
export function ratioOf(work) {
  const w = work && Number(work.width);
  const h = work && Number(work.height);
  return w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? w / h : FALLBACK_RATIO;
}

/** The column token for a width and a density: the mobile grid below MOBILE_BREAK, else the density's. */
export function colsFor(width, density) {
  if (width < MOBILE_BREAK) return MOBILE_COLS;
  return DENSITY_COLS[density] || DENSITY_COLS.cozy;
}

const r2 = (n) => Math.round(n * 100) / 100;
const box = (left, top, width, height) => ({ position: 'absolute', left: r2(left), top: r2(top), width: r2(width), height: r2(height) });

/**
 * @param {{key:string,label:string,works:object[]}[]} groups
 * @param {{width:number, density?:string, headerH?:number, limit?:number}} opts
 *   limit: lay out only the first `limit` works across the groups, in order (a group left with none is dropped).
 *   A header's count is always the group's FULL size.
 */
export function layoutGroups(groups, opts = {}) {
  const width = Number.isFinite(opts.width) && opts.width > 0 ? opts.width : 1;
  const headerH = Number.isFinite(opts.headerH) ? opts.headerH : HEADER_H;
  const { col, gap } = colsFor(width, opts.density);
  let budget = typeof opts.limit === 'number' && !Number.isNaN(opts.limit) ? Math.max(0, opts.limit) : Infinity;
  const cards = [];
  const headers = [];
  let cursor = 0;
  let columns = 1;
  let colWidth = width;
  let total = 0;
  let placedGroups = 0;

  for (const g of Array.isArray(groups) ? groups : []) {
    const all = Array.isArray(g.works) ? g.works : [];
    total += all.length;
    if (budget <= 0 || all.length === 0) continue;
    const part = budget >= all.length ? all : all.slice(0, budget);
    budget -= part.length;
    const m = computeMasonry(part.map(ratioOf), width, col, gap);
    columns = m.columns;
    colWidth = m.colWidth;
    if (placedGroups > 0) cursor += SECTION_PAD;
    placedGroups += 1;
    let top = cursor;
    if (g.label) {
      headers.push({ key: g.key, label: g.label, count: all.length, box: box(0, cursor, width, headerH) });
      top += headerH;
    }
    part.forEach((w, i) => {
      const rc = m.rects[i];
      cards.push({ id: w.id, box: box(rc.x, rc.y + top, rc.w, rc.h) });
    });
    cursor = top + m.height;
  }
  return { cards, headers, height: r2(cursor), columns, colWidth: r2(colWidth), shown: cards.length, total };
}
