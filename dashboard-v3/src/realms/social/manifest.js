// SOCIAL — the SOCIAL BINDING's in-app face (realm 14). Data arrives live from
// the bridge extension via ctx.hq.getSocial() (data/social/* sidecars), NOT the
// scan bundle — so badge() has nothing in `data` to count and stays null.
export const manifest = {
  id: 'social',
  sigil: '📡',
  lexKey: 'tab_social',
  order: 14,
  badge: () => null,
  enabled: () => true,
};
