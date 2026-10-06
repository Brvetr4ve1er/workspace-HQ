// SUMMONING realm — Claude command (charter realm 10, M3): session presence
// (MA's hq:claude-sessions), scoped session spawning, and the canvas
// (data/canvas/*.canvas, JSON Canvas, Obsidian-compatible; DATA.canvas snapshot).
import { runningCount } from './session-store.js';

export const manifest = {
  id: 'summoning',
  sigil: '💬',
  lexKey: 'tab_summoning',
  order: 10,
  // Running-session count without hq at manifest scope: badge() reads the
  // cache that view.js feeds from hq (getSessions seed + claude-sessions
  // push). The view also repaints this badge directly on pushes, since the
  // shell only recomputes badges on data:select.
  badge: () => runningCount() || null,
  enabled: () => true,
};
