// CONJURE — Claude's live UI surface (order 13, last in the rail). Claude
// conjures widgets by appending nodes to a canvas board (MCP hq_canvas_add);
// the app fs-watches data/canvas and this realm draws them as a live feed.
// No badge (the feed itself is the signal) and always enabled — it has a
// teaching empty state, so it never hard-depends on a board existing.
export const manifest = {
  id: 'conjure',
  sigil: '✦',
  lexKey: 'tab_conjure',
  order: 13,
  badge: () => null,
  enabled: () => true,
};
