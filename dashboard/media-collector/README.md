# media-collector — the COLLECT realm's main-side engine

Paste a link, see the media a direct link or a public page actually exposes,
save the source file with byte-count and SHA-256 verification. Renderer:
`dashboard-v3/src/realms/collector/`. IPC: `hq:media:*` in
`docs/sync/IPC-CONTRACT.md`. Hook: one `init()` line in `dashboard/main.js`.

```sh
cd dashboard && npm install      # adds htmlparser2 (the only new dependency)
npm run test:media               # 55 node:test cases against a local fixture server
```

| Module | Job |
|---|---|
| `index.js` | `init({ipcMain, app, send, getWin})` — registers the channels, owns stores in `<userData>/media-collector/` |
| `url-safety.js`, `net.js` | http(s) only, no credentials, private/loopback/link-local/metadata ranges refused (v4+v6, incl. mapped/NAT64/6to4), DNS pinned to the validated address, every redirect hop re-checked, https→http refused, timeouts, bounded reads, 2 connections per host |
| `source-detector.js`, `sources.js` | host classification + the capability registry the Sources tab renders |
| `html-parse.js`, `sniff.js`, `robots.js` | script-free candidate discovery (img/srcset/picture/video/audio/source, linked files, Open Graph, Twitter cards, JSON-LD), type from bytes, robots.txt |
| `adapters/` | `direct` (ranged probe), `webpage` (one bounded page + bounded probe), `platform` (honest boundaries, no scraping) |
| `download-manager.js`, `file-service.js`, `filenames.js` | queue, pause/resume with Range + If-Range, cancel, bounded retry, ask/skip/rename/replace, Content-Length + SHA-256 check, atomic commit inside the destination |
| `settings.js`, `library.js`, `json-store.js` | validated settings, history with soft delete, atomic writes with corrupt-file quarantine |

**Sources.** Direct media links: supported. Public pages: supported with
limits (one page, no scripts, no crawl). Tumblr and Reddit: authorization
required, not integrated; only their official APIs will be used
(<https://www.tumblr.com/docs/en/api/v2>, <https://www.reddit.com/dev/api/>,
<https://redditinc.com/policies/developer-terms>). Instagram and Facebook:
unavailable; the realm points to their own export flows. YouTube, X, TikTok:
unsupported. When an OAuth adapter lands, tokens go to the OS credential
vault (Electron `safeStorage`), never to disk, logs, or the renderer.

**Out of scope by design.** Login/paywall/CAPTCHA bypass, DRM, cookie or
session import, credential collection, proxy rotation, fingerprint spoofing,
profile crawling, watermark removal, reposting.

Origin: ported from `Brvetr4ve1er/JARVIS` `universal-media-collector/`
(standalone build of the same engine).
