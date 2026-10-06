# tools/trailer — render the Claude Design trailers to video

The two WorkspaceHQ trailers were made in Claude Design (`WorkspaceHQ v3 Trailer.dc.html`, 30 s, and
`WorkspaceHQ v3 Trailer 2.dc.html`, 61 s). This folder turns them into the video files the app and the
README use, without Design's own exporter ("route B" in the clean-pass plan):

1. **Honesty patch.** The design copy says a few things WorkspaceHQ doesn't do, and it shows real project
   names. `honesty-patch.mjs` copies the design into `.work/site/` and fixes that first (list below).
   Every replacement must match **exactly once**. If the design changes, the script stops with the
   patch id, so you never get a trailer that was only half patched.
2. **Render.** `render-main.js` (Electron) loads the patched page in a window placed off-screen, to the
   left of every display, at scale factor 1. For each frame it seeks the composition with the engine's
   own sync-seek event and captures the 1920×1080 stage. The PNGs are piped to ffmpeg, which writes a
   silent x264 master.
3. **Encode.** `encode.mjs` makes the shipped files from the master: a VP9 WebM under the size cap, an
   MP4 copy and a JPG poster. With `--install` it copies the WebM and the poster into
   `dashboard-v5/media/`.

Nothing in this folder runs inside the app. `out/` and `.work/` are gitignored.

## Needs

- Windows, with `ffmpeg` and `ffprobe` on PATH (built against ffmpeg 8.1).
- Electron from `dashboard/node_modules`: run `npm install` in `dashboard/` once.
- **Network while rendering.** The Claude Design runtime loads React, ReactDOM and Babel from unpkg and
  the IBM Plex Mono font from Google Fonts. The renderer refuses to start if the font doesn't load, so
  you never get frames set in a fallback font.
- The Claude Design export: the folder holding the two `.dc.html` files, `support.js`,
  `animations-v3.jsx`, `tweaks-panel.jsx`, `hq-trailer.jsx`, `hq-trailer2.jsx` and `hq-audio.js`. Pass it
  with `--src`, or set `HQ_TRAILER_SRC`.

Electron must not run as Node. If `ELECTRON_RUN_AS_NODE` is set in your shell, clear it first:
`Remove-Item Env:ELECTRON_RUN_AS_NODE`.

## Run (PowerShell, from the repo root)

```powershell
$src = "$HOME\Documents\WorkspaceHQ Design Kit"          # the Claude Design export
$electron = ".\dashboard\node_modules\electron\dist\electron.exe"

# 1. spike: stills at chosen times, each rendered twice and compared (writes out\*-still-*.png)
& $electron tools\trailer\render-main.js --trailer 1 --src $src --stills 0,15,29.9 --repeat

# 2. full renders → out\hq-trailer-1.master.mp4 / -2.master.mp4 (+ .render.json)
& $electron tools\trailer\render-main.js --trailer 1 --src $src
& $electron tools\trailer\render-main.js --trailer 2 --src $src

# 3. encode, verify, install into dashboard-v5\media\
node tools\trailer\encode.mjs --trailer all --install
```

Options for `render-main.js`:

| option | meaning |
|---|---|
| `--trailer 1\|2` | which trailer |
| `--src <dir>` | the Claude Design export (or `HQ_TRAILER_SRC`) |
| `--outro "<label>"` | replaces the outro pill text in both trailers. Default: keep the design's own labels ("v3 out now" / "v3 · out now"), the owner's choice |
| `--fps <n>` | frame rate, default 30 |
| `--stills a,b,c [--repeat]` | spike mode: PNG stills only. `--repeat` re-renders each still after visiting another time and fails if a single pixel differs |
| `--frames <n>` | render only the first n frames (smoke test; `encode.mjs` refuses partial masters) |
| `--no-gpu` | software compositing |
| `--cdp-port <port>` | open Chrome DevTools Protocol on that port, for debugging |

To look at the patched pages in a browser, run
`node tools/trailer/honesty-patch.mjs --src $src`, then
`node tools/trailer/serve.mjs --port 8765`, and open `http://127.0.0.1:8765/trailer-1.html`.

## Sound

The trailers are sample-based (`hq-audio.js` mixes `assets/audio/*.mp3`), and those samples aren't
part of the export this was built from. So the renders are **silent**, and `encode.mjs` says so on
every run.

To add the soundtrack, use **Download soundtrack (.wav)** in each trailer's Tweaks panel in Claude
Design. Save the files as `WorkspaceHQ-trailer-1.wav` and `-2.wav` under
`Documents\WorkspaceHQ Design Kit\audio\`, where encode.mjs finds them by itself. Or pass one
explicitly:

```powershell
node tools\trailer\encode.mjs --trailer 1 --audio "D:\path\WorkspaceHQ-trailer-1.wav" --install
```

This does **not** re-render. The VP9 stream is copied from `out\hq-trailer-N.video.webm` and the x264
stream from the master, and only the audio is encoded (Opus in the WebM, AAC in the MP4). It takes a few
seconds. The scene timings are never patched, so the Design soundtrack still lines up.

## What the honesty patch changes

See `honesty-patch.mjs` for the full, commented list. It writes `out/honesty-manifest.json` on every run.

- Real project names become placeholders. They're matched by their position in the design's lists,
  never by the name itself, so this public script doesn't contain them. Afterwards, a denylist built at
  run time from your local scan (`data/latest.json`, `projects/*.md`, read-only) is checked against the
  patched text, and any hit aborts.
- `sk_live_…` and `vault://` key lines become a neutral `PAYMENT_KEY` line. "rotated → vault" and
  "moved to vault · history scrubbed" become **flagged · you rotate it**: HQ flags secrets, it doesn't
  rotate them or rewrite history.
- "Claude answers from your actual repos" becomes **a local model answers from your scan data**. The
  sample question and answer only use facts a scan has.
- The line-by-line diff becomes **changed files + `--stat`**, which is what the commit sheet shows.
  It keeps the same 9 rows, so the beats don't move. Its note says "no .env file in the change set":
  the commit guard refuses `.env` files, it doesn't scan contents for keys.
- The Since-scan rows become changes the scan really reports (`changes_since_prev` in
  `collector/assemble.mjs`): **pushed (was 3 ahead)**, **build recovered**, **gained a remote**,
  **added** and a completed quest's title. Out go CI builds, test runs, git tags and per-project health
  (only the account has a health score), and the rows lose their "5h ago" times, since a change has
  no time of its own. Every row is a good-news row, because the scan only reports good or neutral
  changes. There are still 5 rows, so the beats don't move.
- "welcome back · you were gone 14h 22m" becomes **since the last scan · Oct 5, 08:40**, the label
  the app uses, because nothing tracks time away. The caption "everything that moved while you were
  away" becomes "what changed since the last scan".
- The Next card's "health 86 → 91" after the commit is dropped. It now shows the line count and the
  file count.
- `hq …` CLI commands (there is no `hq` CLI) become UI destinations and keys: **Ctrl+Alt+G**,
  **⟳ Scan now**, Next action, Map, …
- The outro label is set by `--outro`.
- Capture mode sets sound off (no "click to enable sound" chip in frame) and the editor off.

## Outputs (`out/`)

| file | what |
|---|---|
| `hq-trailer-N.master.mp4` | silent x264 master (crf 14, BT.709), straight from the frames |
| `hq-trailer-N.render.json` | render manifest: frames, fps, duration, honesty record, ffmpeg args |
| `hq-trailer-N.video.webm` | VP9 video stream, kept so adding audio is a copy |
| `hq-trailer-N.webm` | shipped trailer (≤ 8 MB for 1, ≤ 15 MB for 2; 720p only if 1080p overflows) |
| `hq-trailer-N.mp4` | master with audio when there is any, for a release |
| `hq-trailer-N.jpg` | 1280 px poster (1: the wordmark, 2: the finished scan) |
| `hq-trailer-N.encode.json` | ffprobe checks: durations within one frame, codecs, caps, audio |

## Tests

`node --test tools/trailer/*.test.mjs` covers the exact-once patching, the outro default, the
denylist rules, the wording a patched trailer must never contain, the Since-scan rows against the
scan's change types, the static server's path containment and the encode budget/duration math. No
Electron, ffmpeg or design export needed. With `HQ_TRAILER_SRC` set, one more test applies the whole
patch list to the design export in memory, so a patch that no longer matches fails there and not
halfway into a render.

## How frames stay deterministic

A capture taken right after the paint can still hold the previous frame, or tiles that are only partly
rastered. So `render-main.js` accepts a frame only when **two captures, two animation frames apart, are
pixel-identical**. The spike gate (`--stills … --repeat`) renders each time twice, with a jump elsewhere
in between, and compares the bitmaps' SHA-256.
