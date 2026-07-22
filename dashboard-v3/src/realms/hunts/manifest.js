// HUNTS — quest board (charter realm 3). Badge = v2's #quest-count.
import { questCount } from '../../ui/components.js';

export const manifest = {
  id: 'hunts',
  sigil: '⚔',
  lexKey: 'tab_quests',
  order: 3,
  badge: (data) => (data.selected ? questCount(data.selected) : null),
  enabled: () => true,
};
