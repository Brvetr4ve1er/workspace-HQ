// MED-BAY — PC health anatomy (charter realm 7, M2). Data arrives via the
// struct lane's collector/pc-health.mjs → data/pc-health.json (bundled
// additively as DATA.pcHealth); the realm renders a full empty-state until then.
export const manifest = {
  id: 'medbay',
  sigil: '🫀',
  lexKey: 'tab_medbay',
  order: 7,
  badge: (data) => {
    const organs = data.bundle?.pcHealth?.organs;
    if (!Array.isArray(organs)) return null;
    const sick = organs.filter((o) => o.status === 'blood').length;
    return sick || null;
  },
  enabled: () => true,
};
