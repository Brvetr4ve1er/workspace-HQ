# Cosmos space (key 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the owner's local gallery becomes the ninth space of WorkspaceHQ, on key `0`, without losing any
curation and without publishing any personal file.

**Spec:** `docs/superpowers/specs/2026-11-07-cosmos-space-design.md` (data rules, id rule, channels, path rules, hold).

**Architecture:**
- Pure ESM modules in `dashboard/cosmos/` (no IO): taxonomy, types, the sticky id map, header-only image size.
- One CommonJS main module `dashboard/cosmos.js` (new file, one-line `main.js` hook with `getWin` and `castSend`) is the only writer of `data/cosmos/`.
- Renderer: dc-lite templates, `cos*` vals keys, a logic mixin, the live store. The library is read on arrival, never at boot.

## Global Constraints

- Frontend lane only: `dashboard/`, `dashboard-v5/`, `mcp/workspacehq/`; `docs/sync/*` and `.gitignore` as `meta:`. Never `collector/`, `schema/`, `spellbook/`, `run-pipeline.ps1`, `scan-prompt.md`.
- **Contract before code:** the `IPC-CONTRACT` section and the `CONTRACT` section for `data/cosmos/` are written before any handler.
- **`data/cosmos/` is gitignored, with `OWNER_DATA` pins, before any code can write there.**
- No network of any kind. No LLM. No new dependency, no download. Nothing leaves the machine.
- The vault is never written by this code.
- Placeholder fixtures only (`alpha-site`, synthetic headers). Never commit `data/` or `docs/audits/`.
- Every renderer call feature-detects `window.hq.cosmos`. Honest states everywhere (spec §7).
- Gates run sequentially with output kept: main-side suites, money, renderer, selftest, cdp-gate.

## Step 1 — rules and ids that never move (this dish; no app code changes)

- [x] Spec reconciled against the current tree (anchors in spec §2).
- [x] `dashboard/cosmos/infer.mjs` (byte-identical port, comments differ) and `types.mjs`.
- [x] `dashboard/cosmos/ids.mjs`: `seedFromManifest`, `assignIds`, `parseIdMap`, `relFromSrc`, `pathKey`, `idFor`, `relFor`.
- [x] `dashboard/cosmos/imagesize.mjs`: `imageSize`, `orientedSize`, `HEADER_BYTES`.
- [x] Tests: `infer.test.mjs`, `ids.test.mjs`, `imagesize.test.mjs`.
- [ ] Owner's answer on publishing the ported code (hold, spec §9).
- [ ] On `main` (does not depend on the answer): `.gitignore` gains `data/cosmos/`; `tools/gitignore-owner-data.test.mjs` `OWNER_DATA` gains `data/cosmos/library.json`, `curation.json`, `curation.json.prev`, `cleanup.json`, `config.json`, `thumbs/x.jpg`, `imports/x.png`, `clips/x.png`.
- [ ] HANDOFF entry on `main`, written before any held commit: the folder `dashboard/cosmos/`, the ignore line, and either the contract sections (yes) or the hold branch name and "never push" (no).
- [ ] Held unless yes: README test line `node --test dashboard/cosmos/*.test.mjs` beside the other test globs (they do not reach subfolders); the `IPC-CONTRACT` and `CONTRACT` sections.

## Step 2 — engine and Feed (one batch, so key 0 opens one batch later instead of two)

- [ ] `dashboard/cosmos.js`: read, apply (intents, atomic writes, `curation.json.prev`), pick-folder, index (walk, headers, thumbnails, hashes, dupes; progress at most 4 a second; cancel), trash (ids; Recycle Bin), reveal, import-files, import-local.
- [ ] Indexer reads the old `idMap` first, seeds from the manifest on the first run, then `assignIds`; skip list keeps `_clips`, `node_modules`, `.git`, `.obsidian`, `.trash`, `.thumbnails`.
- [ ] Preload `cosmos:` group; `main.js` one-line hook; `fake-preload.js` recording fake.
- [ ] NAV[9] (`id: 'cosmos'`, glyph `⬡`); palette cap/hint, cheat sheet `0 – 9`, `hq-icon` glyph.
- [ ] Feed: search, sort, group, density, favourites, hidden, masonry (every card emitted, lazy images), lightbox on layer 1080, index overlay, drag-drop via `webUtils.getPathForFile`.
- [ ] Gates: selftest and cdp-gate carry the render checks with `data:` URI fixtures; one Electron-run check for BGRA colour order and AVIF/WebP coverage.
- [ ] What's new entries `{ text, needs }` with a real logic method name.

## Step 3 — Clusters

- [ ] Plain and smart clusters (live rule), cover, count, add/remove, using the same search grammar as the Feed.

## Step 4 — Cleanup (only after the Feed's real use has been measured)

- [ ] Exact and near-duplicate proposals, junk candidates, dismissals in `cleanup.json`; deletes only through the Recycle Bin path with the partial-failure rule.

## Migration order (the owner, once)

1. Export the backup from the old app first.
2. Index the pictures folder (ids seeded from the old manifest).
3. Import with the manifest; read the report (`missingIds`).
