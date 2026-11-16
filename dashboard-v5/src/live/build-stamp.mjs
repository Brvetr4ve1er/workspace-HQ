// The build stamp: one short string that names the build the owner is running, shown once on the "New version inserted" card
// (src/logic/version-card.mjs) so an update is noticed once, never on an ordinary launch.
//
// Format YYYY-MM-DD.batchN. Bumping it is part of every batch-done checklist (docs/sync/HANDOFF.md): the batch-done entry quotes the
// stamp that shipped, and src/live/build-stamp.test.mjs pins the format and that this stamp is named there. dashboard/package.json
// stays at 0.1.0 (unused): this string is the only version the card reads. Pure constant, nothing else, no imports.
export const BUILD_STAMP = '2026-11-16.batch8';
