// LEGACY — history: trends, memorials, saga, blessing (charter realm 6).
import { achCount } from '../../ui/components.js';

export const manifest = {
  id: 'legacy',
  sigil: '🏆',
  lexKey: 'tab_trends',
  order: 6,
  badge: (data) => (data.selected ? achCount(data.selected) : null),
  enabled: () => true,
};
