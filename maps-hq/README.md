# MAPS HQ

A game map of your real work. Your repos are buildings in a city around your HQ pin, your clients are
districts with a fixer, and every marker is a fact WorkspaceHQ already knows: a Brief row, a quest, an open
scope item, a red build. Click one, read why it is there, press the one verb, and the app opens right there.

It has **no points of its own**. Rank, XP and streak are read from WorkspaceHQ's scan; a district's progress is
a fact (scope items done, buildings standing clean), never a "found" tick. Original look only: no assets,
names or map art from any game or map site.

Phase P1 of the spec ("Surface" layer: ops). Depths (backlog lit by held clears), Sky (goals) and Kūro (Claude
in the map) come next, each after the previous one is used.

## How it runs

The map is served by WorkspaceHQ's local bridge on `127.0.0.1:47821` under `/world/` (`dashboard/world-routes.js`).
Nothing goes to a cloud.

```bash
cd maps-hq && npm install && npm run build   # writes maps-hq/dist, which the bridge serves
node tools/world-url.mjs                     # (from the repo root) prints your map's address, once
```

Open that address and bookmark it. The key is in the URL fragment (`#k=…`), which a browser never sends to a
server; the page moves it into its own storage and strips it from the address bar, so a copied link or a
screenshot never carries it. `/world/state` and `/world/open` refuse any call without it.

`npm run dev` (port 5178) always shows an **invented** city (`src/world/fixture.ts`), never your data.

## Your pins (by hand for now)

`data/world/pins.json` (gitignored). Without it your HQ sits on a placeholder city centre and every repo
lands in the Atelier, the Outskirts (dormant) or its own client district (from your delivery list).

```jsonc
{ "v": 1,
  "hq": { "lng": 0.0, "lat": 0.0, "label": "Studio" },
  "districts": [
    { "id": "acme", "name": "Acme", "kind": "client",          // client | studio | atelier
      "fixer": { "lng": 0.0, "lat": 0.0, "label": "Acme office" }, // the client's real address, set by you
      "projects": ["acme-site", "acme-app"] }                     // project ids from the scan
  ] }
```

## What is on the map

| Marker | Job | From |
|---|---|---|
| diamond | **Contract**: a top Brief row, or a red quest | Brief, quests |
| flame (red) | **Fire**: red build, secrets in plain text, failed deploy, CI red, a session waiting on a tool | Brief senses, build quests |
| circle | **Errand**: orange and yellow quests, lower Brief rows | quests, Brief overflow |
| square | **Commission**: an open item on a client's scope list | delivery |
| bolt | **Quick win**: the daily top 3 pick | scan |
| shield | Fixer (a client's real address) | your pins |
| arch (cyan) | HQ | your pins |

Buildings: height is risk (red build, dirty tree, unpushed work, secrets, open quests; 0 to 10), dashed outline
is a dirty tree, dark red is a red build, low and dark is dormant. Cyan is only you; red is only Fires and red
Contracts. Never on the map: anything from Money or Security, paths, remotes, branch names, commit subjects.

## Tiles

Default: OpenFreeMap (free, no key; your viewport's tiles are fetched from their servers). For no outside
requests at all, set `VITE_BASEMAP=none`, or point `VITE_PMTILES_URL` at your own Protomaps `.pmtiles`. The page's
CSP (set by the bridge) allows only those tile hosts. Brass contour lines from a DEM are planned, not built.

## Code map

```
src/world/types.ts     the /world/state shape (mirror of dashboard/world-project.js)
src/world/model.ts     the city: districts, sticky plots, buildings, jobs, legend (pure, tested)
src/world/source.ts    key handling, /world/state, /world/open, fixture in dev (tested)
src/world/fixture.ts   the invented city
src/map/style.ts       Arcanum basemap styles (OpenMapTiles and Protomaps schemas)
src/map/MapView.tsx    districts, routes, extruded buildings, DOM markers
src/hud/Hud.tsx        rank, the Brief board, legend, selection card
src/hud/Radar.tsx      SVG radar around the camera
```

`npm test` (vitest), `npm run typecheck`, `npm run build`. Bridge side: `node --test dashboard/world-routes.test.mjs`.

## Repo layout

Lives in WorkspaceHQ for now. To make it its own repo later: `git subtree split -P maps-hq -b maps-hq-split`,
push that branch to the new repo, then `git rm -r maps-hq && git submodule add <url> maps-hq`.
Fonts: Cinzel (SIL OFL 1.1, `public/fonts/OFL-Cinzel.txt`), the same files the Lantern look ships.
