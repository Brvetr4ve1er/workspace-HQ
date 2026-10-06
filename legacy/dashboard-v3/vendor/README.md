# Vendored dependencies

Local copies of two libraries used by the WAR ROOM realm (Epic B). Vendored
(not CDN-loaded) because the app's CSP is `default-src 'self'` — a `<script
src="https://...">` tag would be blocked. **Do not switch these to a CDN
`<script>` tag; if the CSP ever needs to allow a CDN host, that's a deliberate,
separate change, not a silent swap.**

| File | Library | Version | Source |
|---|---|---|---|
| `three.module.js` | three.js | 0.160.0 | `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js` |
| `anime.es.js` | anime.js | 3.2.2 | `https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.es.js` |

Both are ES modules, imported directly via relative path (`../../vendor/...`)
— no build step, no bundler, matches the rest of `legacy/dashboard-v3/`.

## Refresh commands

From repo root:

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js -o legacy/dashboard-v3/vendor/three.module.js
curl -fsSL https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.es.js       -o legacy/dashboard-v3/vendor/anime.es.js
node --check legacy/dashboard-v3/vendor/anime.es.js && echo "anime ok"
node -e "const s=require('fs').statSync('legacy/dashboard-v3/vendor/three.module.js'); if(s.size<100000) throw new Error('three too small'); console.log('three ok', s.size)"
```

To bump versions, edit the version number in both URLs above, re-run, and
update the table in this file.
