// STUDIO — the capture library. Realm 15 (after SOCIAL at 14). No badge (the
// gallery isn't time-sensitive to surface on the rail), always enabled: the
// realm has a calm empty state when no captures exist and when the studio
// bridge is missing, so it never hard-depends on preload IPC being present.
// lexKey is literal 'STUDIO': LX() falls through unknown keys to the key
// itself, so this stays "STUDIO" under every theme without touching the
// shared lexicon tables (frontend-lane owns manifests, not lexicons).
export const manifest = {
  id: 'studio',
  sigil: '🎬',
  lexKey: 'STUDIO',
  order: 15,
  badge: () => null,
  enabled: () => true,
};
