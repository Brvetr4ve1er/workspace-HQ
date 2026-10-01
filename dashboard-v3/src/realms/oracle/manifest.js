// ORACLE — chat with the local model (PC-Brain Phase 2). Order 10.5 slots it
// after ASSISTANT (summoning, 10) and before TIMELINE (11), so number keys 1-9
// keep jumping to the same realms they always did.
export const manifest = {
  id: 'oracle',
  sigil: '◉',
  lexKey: 'tab_oracle',
  order: 10.5,
  badge: () => null,
  enabled: () => true,
};
