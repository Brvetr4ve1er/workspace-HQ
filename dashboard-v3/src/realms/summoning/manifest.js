// SUMMONING CIRCLE — Claude command (charter realm 10, M3): session presence
// (MA's hq:claude-sessions), scoped session spawning, and THE CANVAS
// (data/canvas/*.canvas, JSON Canvas, Obsidian-compatible; DATA.canvas snapshot).
export const manifest = {
  id: 'summoning',
  sigil: '🔔',
  lexKey: 'tab_summoning',
  order: 10,
  badge: () => null,   // live badge (running sessions) needs hq push — set by the view
  enabled: () => true,
};
