# Cosmos space — design (reconciled for the current tree)

Status: step one of Cosmos on key 0. This document, the data rules, and four pure modules under
`dashboard/cosmos/` land first. Nothing appears on screen yet.

HOLD: the modules ported from the owner's local gallery app have never been published. They live on the
local branch `hold/cosmos-core` (a separate worktree) until the owner says yes. See §9.

## 1. What Cosmos is

The owner's local image and video gallery ("Cosmos Local": a Vite app with a masonry feed, clusters,
tags, favourites, hidden items, duplicate cleanup and a web clipper) becomes a ninth space inside
WorkspaceHQ, on key `0`. Words follow the source app: a saved image or video is an **element**, a
collection is a **cluster**, a smart cluster is one defined by a live rule instead of a list.

This step protects the two things whose loss cannot be undone:

1. **The owner's curation.** Clusters, favourites, hidden flags and title/tag overrides all point at
   element ids. A wrong id silently hands a curated favourite to a different image.
2. **The owner's personal files.** The repo is public. Nothing under `data/cosmos/` may ever be
   committed, and no path, thumbnail or manifest entry from the owner's pictures enters the repo.

The engine, the Feed, the lightbox, indexing and import follow together in the next batch. Clusters
follow, then Cleanup (only after the Feed's real use has been measured).

## 2. Corrections to the port package

The port package (written against an older tree) is read-only reference. These are the corrections for the
current tree; each anchor was checked against the code at `e5cfb56`.

| Port package says | Current tree | Anchor |
|---|---|---|
| a key for the new space | Cosmos is `NAV[9]` on key `0`; the handler already maps `0` to the tenth destination, so **no key-handler edit** | `dashboard-v5/src/app.js:379` |
| glyph | `⬡`. Money already uses `◈` | `dashboard-v5/src/live/catalog.mjs:30` |
| nine destinations assumed in three places | the palette's Go-to cap (`name === 'Go to' ? 9`) and its hint (`String(i + 1)`, which would print `10` for the tenth; it must print `0`), and the cheat sheet row `'1 – 9'` (must read `0 – 9`). Every NAV id also needs an `hq-icon` glyph in `elements/hq-v3.js` | `logic/palette.js:27,52` · `live/catalog.mjs:86` · `elements/hq-v3.js:310` |
| whole-document saves (`saveCuration`, `saveCleanup`) | **validated intents** through one `hq:cosmos:apply`, Money's idiom: ids and timestamps minted in main, size cap, atomic write, `{error}` with owner-facing copy | `docs/sync/IPC-CONTRACT.md:592` (`hq:money:apply`) |
| the library loads at boot | it is read **on arrival** at the space, like Money's refresh | `app.js:162` |
| main hook `init({ ipcMain, app, dataDir, win })` | modules start before the window exists, so the hook takes `getWin` (and a `castSend`), as Money's does | `dashboard/main.js:1247-1250` |
| drag-drop reads `File.path` | Electron 32 has no `File.path`; the renderer calls `webUtils.getPathForFile` in the preload and sends absolute paths for main to copy | Electron 32.3.x |
| `/`, `f`, arrow keys | they stay **global**, except inside the lightbox, which uses the reserved layer 1080 (under dialogs at 1100+) | `tpl/extras.tpl.js:7` |
| jsdom render harness | none. The selftest and cdp-gate carry the render checks with `data:` URI fixtures, plus one Electron-run check for the BGRA colour order and AVIF/WebP coverage | — |
| "what's new" entries | `{ text, needs }` with a real logic method name; Money's false "scrub.js says so" comment is not copied | — |
| one big port dish | three dishes: engine + Feed (lightbox, index, import) together; then Clusters; then Cleanup | §8 |
| migration | the owner exports the backup from the old app, indexes the pictures folder, imports with the manifest, and reads the report | §6 |

## 3. Data on disk — `data/cosmos/` (frontend lane, local only, gitignored)

`dashboard/cosmos.js` (CommonJS, new) will be the only writer. The collector and `build-data` never read
it. Nothing here goes into `window.DATA`, `latest.json` or any scan bundle.

| File | Holds |
|---|---|
| `config.json` | `{ version, root, indexedAt }`. `root: null` means never indexed, which the UI shows differently from an empty library |
| `library.json` | `{ version, generatedAt, root, idMap, works[], dupes }`. `idMap` is the sticky id map of §4 (it must survive every re-index; the indexer reads the old one before it writes, and a library file that fails to parse is moved aside, not overwritten, so the map can be recovered). Each work: `id`, `rel` (root-relative, `/` separators, single-encoded), `title`, `type`, `width`, `height`, `orientation`, `color`, `palette`, `thumb`, `video`, `contentHash`, `perceptualHash`, `tags` (folder names), `createdAt`. Load-bearing: `id`, `rel`, `width`, `height` (a missing pair is written as 1:1 with `thumb: null`, never omitted) |
| `curation.json`, `curation.json.prev` | clusters, favourites, hidden, overrides. The irreplaceable half. `.prev` is the previous good copy, kept on every write |
| `cleanup.json` | dismissed duplicate clusters and junk candidates. Dismissals only; nothing here deletes a file |
| `thumbs/<id>.jpg` | 560 px JPEG thumbnails, rebuildable |
| `imports/` | files dropped onto the Feed, copied in; indexed like any other file |
| `clips/` | reserved for the clipper (later) |

`data/cosmos/` goes into `.gitignore` as a directory pattern (it also covers temp files), with matching
`OWNER_DATA` pins in `tools/gitignore-owner-data.test.mjs`, **before any code can write there**. That
line and its pins reveal nothing and land on `main` regardless of §9.

Writes are atomic (tmp + rename). A file that fails to parse is moved aside as `*.corrupt` and the read
returns an honest `{error}`; it is never overwritten with an empty document.

## 4. Element ids never move

An element id is what every cluster, favourite, hidden flag and override points at. The source app
derived ids by walking the folder: `slug(relative path)`, plus `-x` on a clash, newest file first. That is
only stable while the folder is unchanged. A newer colliding file would take the bare id and push the
curated one to `-x`; ids are cut at 80 characters, so long paths collide; and the pictures folder keeps
growing. Re-deriving ids would hand curated favourites and clusters to the wrong images.

So ids are **written down once and only appended to** (`dashboard/cosmos/ids.mjs`, stored as `idMap` in
`data/cosmos/library.json`):

- `seedFromManifest(manifest)` reads the old app's manifest. Each `/media/…` segment is decoded exactly
  once (a literal `%41` in a file name arrives as `%2541` and comes back as `%41`). Paths compare
  case-insensitively. Every id is kept exactly as the manifest has it, `-x` suffixes and 80-character cuts
  included. Works that cannot be seeded (clips, uploads, undecodable paths, conflicts) are reported, never
  guessed.
- Every known id is kept forever, even for a file that is later deleted or moved, so an id is never given
  to a different file.
- Only never-seen paths get a new id: `slug(rel)`, or `work` when that is empty, plus `-x` while it
  equals any id ever handed out; minted **newest file first**, ties by path. An existing id is never
  re-suffixed.
- The map is plain JSON and round-trips unchanged; a damaged file is read back entry by entry, dropping
  what is malformed or duplicated and counting it.

`dashboard/cosmos/infer.mjs` is a byte-identical port of the source app's `scripts/lib/infer.mjs`
(`slug`, `inferType`, `titleFrom`, `normalizeTag`, the extension sets, `TYPE_RULES`,
`inferTypeFromClip`, `clipTags`); only comments differ. `slug()` is pinned character for character by
`infer.test.mjs`. Clipped elements keep `clip-<hash12>` ids; the clip folder `_clips` stays in the
walker's skip list, because walking it would mint a second slug id for every clip and split the curation.

`dashboard/cosmos/types.mjs` holds `WORK_TYPES` and `TYPE_META` (the type chips inside the space; their
glyphs are the source app's and are separate from the space's NAV glyph). `dashboard/cosmos/imagesize.mjs`
reads width and height from file headers only (PNG, JPEG SOF0–SOF15 plus EXIF orientation, WebP
VP8/VP8L/VP8X, AVIF ispe, GIF, BMP, SVG); it returns null on anything truncated and never throws.

## 5. Channels (rows are written before any handler)

`docs/sync/IPC-CONTRACT.md` gets a dated section, "Cosmos space (rows written before the handler lands)".
Handlers live in `dashboard/cosmos.js`; the preload exposes one `cosmos:` group; every renderer call
feature-detects `window.hq.cosmos`.

| Method | Channel | Args | Returns |
|---|---|---|---|
| `cosmos.read({force?})` | `hq:cosmos:read` | `{ force?: boolean }` | `{ state, config, works, dupes, curation, cleanup, stale? }` or `{ error }`. `state` is `empty` (never indexed) · `ready` · `error`. The renderer keeps what it already had on `{error}` |
| `cosmos.apply(intent)` | `hq:cosmos:apply` | `{ type, … }`, an intent, never an entity or a whole document | `{ view?, note }` after the write landed, or `{ error }` with owner-facing copy, nothing written |
| `cosmos.pickFolder()` | `hq:cosmos:pick-folder` | none | absolute path, or `null` if cancelled |
| `cosmos.index()` | `hq:cosmos:index` | none (the root comes from the last `pick-folder` or `config.json`) | `true` (accepted; progress arrives on the push) or `{ ok:false, reason, message }` |
| `cosmos.cancelIndex()` | `hq:cosmos:cancel-index` | none | `true` |
| `cosmos.trash(ids)` | `hq:cosmos:trash` | element ids | `{ trashed: id[], failed: {id, message}[] }` |
| `cosmos.reveal(id)` | `hq:cosmos:reveal` | element id | `true` or `{ ok:false, message }` |
| `cosmos.importFiles(paths)` | `hq:cosmos:import-files` | absolute paths from a drop (`webUtils.getPathForFile`) | `{ imported: n, skipped: {path, reason}[] }` |
| `cosmos.importFromLocal()` | `hq:cosmos:import-local` | none; main opens its own file dialog for the old app's backup envelope and manifest | `{ clusters, favorites, hidden, overrides, missingIds[], seeded, skipped[] }` or `{ ok:false, reason, message }` |
| `cosmos.onProgress(cb)` | push `hq:cosmos:index-progress` | none | `{ phase: 'walk'\|'thumbs'\|'hashes'\|'dupes', done, total, done_all? }`, at most 4 a second; returns an unsubscribe the space's `stop()` must call |

**Intents** (`apply`; the final list belongs to the engine batch, always validated in main): `favorite`,
`hide`, `tags` (add/remove), `title`, `cluster-save`, `cluster-delete`, `cluster-add`, `cluster-remove`,
`cleanup-dismiss`. Unknown type, unknown id, a payload over 64 KB or a bad field is refused with a message.
Ids and timestamps are minted in main. `curation.json.prev` is refreshed before each write.

### Path rules (normative; this is the security surface)

The renderer is untrusted input. Beyond the intents above:

1. **No client-supplied absolute path for a read or a delete.** `trash` and `reveal` take **ids**; main
   resolves id → `rel` → absolute path against the root in `config.json`. `index`'s root comes from a native
   folder dialog the owner drove; `import-files` copies from arbitrary paths to a destination computed
   entirely in main.
2. **Containment is re-checked after `realpath()`**, so a link inside the root cannot point outside it.
3. **Decode in exactly one place** (`relFromSrc` for manifests). A double decode retargets a delete at a
   different file that still resolves inside the root.
4. **No shell, ever.** Deletes use `shell.trashItem()` (the Recycle Bin), never an unlink or a spawned shell.
5. **Never purge renderer state before main confirms.** `trash` returns what it actually moved; the renderer
   removes only those. A partial failure leaves the survivors and every reference intact.
6. Imported files live under `data/cosmos/imports/`; in the id map their path is `imports:<file name>`
   (a colon cannot appear in a Windows relative path, so it never collides with a real folder).
7. Nothing in this space makes a network call. No bytes leave the machine.

## 6. Migration order (the owner does this once)

1. In the old app, export the backup (the existing `cosmos-local` envelope: `clusters`, `favorites`,
   `hidden`, `overrides`). The curation lives only in that app's browser storage at its dev-server
   address; at any other origin it opens empty, so this export is **not optional** and is done first.
2. In the space, choose the pictures folder and index it. The id map is seeded from the old manifest
   first, so known files keep their ids.
3. Import the backup with the manifest. The report states how many referenced ids were found and lists
   `missingIds`; a silent partial import is the failure worth one line of UI.
4. Known gap: the old backup does not carry the Cleanup dismissals, so dismissed duplicate clusters
   reappear once and can be dismissed again.

## 7. Honest states

Wherever the owner looks: **never indexed** (a call to action, not an empty grid), **indexing** (phase and
counts), **empty after indexing**, **no search results** (with a clear action), **error** (the real message
and what was kept), **stale** (age of the last index), **main process unavailable** (read-only, stated).
Thumbnails that failed render from the original; an element with no hashes is left out of duplicate
detection, not flagged as an error.

## 8. Non-goals for v1

No graph view, no semantic or text search over pixels, no remote access or pairing, no web clipper ingest
yet (the `clip-<hash12>` id namespace is kept so it can come back), no windowed/virtualised feed (every
card is emitted and the browser lazy-loads), no LLM anywhere.

## 9. The hold

The ported modules come from an app with no remote whose port folder was never committed, so committing
them would publish that code for the first time. The owner is asked first.

- With a yes, they land on `main` last, after every other dish.
- Without one, they stay on the local branch `hold/cosmos-core` in a sibling worktree, so the shared tree
  never switches branch: the four modules and their tests, this spec, the plan, the Cosmos
  `CONTRACT` / `IPC-CONTRACT` sections and the README test line. A HANDOFF entry on `main`, written before
  any held commit, names the branch and says never push.
- Holding commits at the tip of `main` would not work: the next push by either lane would publish them.
- If the answer stays no, the modules are rewritten from this design, which costs little.

## 10. Tests

```powershell
node --test dashboard/cosmos/infer.test.mjs dashboard/cosmos/ids.test.mjs dashboard/cosmos/imagesize.test.mjs
node --test tools/gitignore-owner-data.test.mjs
```

All fixtures are invented (`alpha-site`, synthetic headers). No path, thumbnail or manifest entry from the
owner's pictures is in the repo. The source app's own vitest cases run through `dashboard/money/vitest-shim.mjs`
with their assertions unchanged. The full gates stay green on whichever branch holds this: no app code changes.
