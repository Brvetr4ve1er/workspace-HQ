# MAPS HQ

An interest-adaptive world map with a game layer: pick what you care about, and the map, radar and
objectives bend toward it. Discover places for XP, clear fog of war by moving, level up.
Original look only (neon-noir HUD, circular radar, chamfered panels): no assets, names or map art from
any existing game.

Standalone web app first; it lives in WorkspaceHQ as a git submodule (see *Repo layout*).

## Stack

| Layer | Choice |
|---|---|
| Render | MapLibre GL 6 (Vite + React 19 + TS, Zustand for game state) |
| Tiles | own `.pmtiles` > Protomaps API > MapTiler > OpenFreeMap `dark` (free, no key, the default) |
| Data | Supabase Postgres + PostGIS: `places` (owned POI base), `interests`, `user_*`, `discoveries`, `missions` |
| Base POIs | Overture Maps places + OpenStreetMap (ingest: next step) |
| Enrichment | Foursquare OS Places / Places API (storable) |
| Google Places | live, on screen only, **never stored** (ToS). Not wired yet. |
| Deploy | Vercel (`vercel.json`, framework vite) |

## Run

```bash
npm install
cp .env.example .env.local   # all optional: no env = OpenFreeMap tiles + invented demo POIs
npm run dev                  # http://localhost:5178
npm test                     # progression + fog rules (vitest)
npm run build
```

Controls: WASD / arrows move relative to the camera, click to travel, **GPS** follows the real you,
**Discover** appears within 60 m of the objective.

## Database

```bash
npx supabase start           # local stack (Docker)
npx supabase db reset        # applies migrations + seed.sql (interest catalog)
npx supabase link --project-ref <ref> && npx supabase db push   # remote
```

- `places_nearby(lng, lat, radius_m, interests[], limit)`: KNN + radius, interest-filtered, anon-callable.
- `discover_place(place_id, lng, lat)`: server checks distance (60 m), dedupes, awards XP with the same
  formula as `src/game/xp.ts`. Signed-in users only; clients cannot write XP directly (RLS).
- Checked on a throwaway PostGIS 16: radius/filter/order, 50 XP first find, 0 on repeat, `too far`, anon refused.

## Code map

```
src/map/style.ts      basemap selection (env-driven)
src/map/MapView.tsx   main pitched map: places, player, fog layers
src/hud/Radar.tsx     circular radar (second map + blips, rotates with camera)
src/hud/Hud.tsx       XP bar, interest picker, objective panel
src/game/xp.ts        pure progression + haversine (tested)
src/game/fog.ts       grid fog of war, ~250 m cells (tested)
src/game/store.ts     local-first game state (localStorage; Supabase sync after auth)
src/game/demo.ts      invented POIs for offline play
supabase/migrations   schema, RLS, RPCs
```

## Next

1. Ingest: Overture places (DuckDB over the GeoParquet release, bbox per city) into `places`, mapped to interests via `interests.source_categories`.
2. Auth (Supabase magic link) + sync local progress to `user_progress` / `discover_place`.
3. Missions generator (daily, from `places_nearby` + interests), streaks.
4. Google Places live detail card on tap (display only).

## Repo layout

This folder was scaffolded inside WorkspaceHQ on a branch. To make it its own repo and mount it back as a submodule:

```bash
# from the workspace-HQ root, on this branch
git subtree split --prefix=maps-hq -b maps-hq-export
git push https://github.com/<you>/maps-hq.git maps-hq-export:main
git rm -r maps-hq && git commit -m "meta: maps-hq moves to its own repo"
git submodule add https://github.com/<you>/maps-hq.git maps-hq
```

Data attribution: © OpenStreetMap contributors (ODbL), Overture Maps Foundation, Protomaps / OpenFreeMap.
