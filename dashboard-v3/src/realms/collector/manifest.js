// COLLECT — the media collector (realm 16, after STUDIO at 15): paste a link,
// see the media a direct link or public page actually exposes, save the source
// file. Badge = downloads in flight or waiting on a decision. lexKey
// tab_collector rides the theme registers (plain/default: COLLECT,
// nightfall: THE RELIQUARY).
import { badgeCount } from './store.js';

export const manifest = {
  id: 'collector',
  sigil: '⇩',
  lexKey: 'tab_collector',
  order: 16,
  badge: () => badgeCount(),
  enabled: () => true,
};
