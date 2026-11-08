// Cosmos space — the element types and their labels. Ported from Cosmos Local's src/data/types.ts (the
// retrogallery repo, read-only) with the TypeScript stripped by hand: the values are unchanged, the
// interfaces became the JSDoc typedefs below, and the two constants are frozen (they are shared by
// main and, later, the renderer's type chips — a stray push would retype the whole library).
// Vocabulary follows the source app: a saved image or video is an "element", a collection is a "cluster".
// No imports, no IO: safe to import anywhere.
//
// Glyph note (spec 2026-11-07-cosmos-space-design.md §3): the space's NAV glyph is ⬡ (◈ is Money's);
// these TYPE_META glyphs label type chips INSIDE the space and stay the source app's (3D is ◈, Logo is ⬡).

/** The eight work types, in the source app's order (chips, group-by-type). */
export const WORK_TYPES = Object.freeze(['3d', 'ui', 'illustration', 'photo', 'logo', 'motion', 'type', 'misc']);

/** Human labels + glyphs for each type (chips, detail view, group headings). */
export const TYPE_META = Object.freeze({
  '3d': Object.freeze({ label: '3D & Render', glyph: '◈' }),
  ui: Object.freeze({ label: 'UI & Product', glyph: '▣' }),
  illustration: Object.freeze({ label: 'Illustration', glyph: '✶' }),
  photo: Object.freeze({ label: 'Photography', glyph: '◉' }),
  logo: Object.freeze({ label: 'Logo & Identity', glyph: '⬡' }),
  motion: Object.freeze({ label: 'Motion', glyph: '➤' }),
  type: Object.freeze({ label: 'Typography', glyph: 'A' }),
  misc: Object.freeze({ label: 'Misc', glyph: '◇' }),
});

/**
 * @typedef {'3d'|'ui'|'illustration'|'photo'|'logo'|'motion'|'type'|'misc'} WorkType
 * @typedef {'portrait'|'landscape'|'square'} Orientation
 * @typedef {{ hex: string, r: number, g: number, b: number, h: number, s: number, l: number }} ColorSig
 *   dominant colour; h in [0,360), s and l in [0,1]
 * @typedef {{ title?: string, tags?: string[] }} WorkOverride   the owner's edits layered over an element
 * @typedef {{ query?: string, tags?: string[] }} ClusterRule
 *   a smart cluster's live rule: `query` uses the search box's grammar, `tags` must ALL be present
 * @typedef {{ id: string, name: string, description?: string, elementIds: string[], createdAt: string,
 *   updatedAt: string, rule?: ClusterRule }} Cluster   with `rule`, membership is live and elementIds is ignored
 *
 * What Cosmos Local wrote, and what the space's import reads (never written by WorkspaceHQ):
 * @typedef {{ id: string, title: string, type: WorkType, src?: string, thumb?: string, width?: number,
 *   height?: number, tags?: string[], createdAt?: string, contentHash?: string, perceptualHash?: string }} ManifestWork
 *   `src` is '/media/<segment>/…', each segment encodeURIComponent'd once (build-manifest.mjs urlFor)
 * @typedef {{ version: number, generatedAt: string, works: ManifestWork[] }} Manifest
 * @typedef {{ app: 'cosmos-local', version: 1, exportedAt: string, clusters: Cluster[],
 *   favorites: Record<string, true>, hidden: Record<string, true>, overrides: Record<string, WorkOverride> }} BackupEnvelope
 */
