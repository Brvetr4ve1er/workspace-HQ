// ATLAS — the analytics room (numbers + charts). Order 12 puts it after the
// existing rooms in the rail. No badge (nothing time-sensitive to surface) and
// always enabled: every field it reads has a calm empty state, so it never
// hard-depends on a data block being present.
export const manifest = {
  id: 'atlas',
  sigil: '📊',
  lexKey: 'tab_atlas',
  order: 12,
  badge: () => null,
  enabled: () => true,
};
