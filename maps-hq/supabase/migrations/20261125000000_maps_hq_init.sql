-- MAPS HQ: owned POI base + interests + per-user progress.
-- Base data: Overture Maps places + OpenStreetMap (ODbL: keep attribution, share-alike on the DB if redistributed).
-- Foursquare OS Places may be stored (Apache-2.0). Google Places is NEVER stored here (ToS): live on screen only.

create extension if not exists postgis with schema extensions;

-- ---------- interests (catalog) ----------
create table public.interests (
  slug        text primary key,
  label       text not null,
  glyph       text,
  color       text,
  -- source category codes that map to this interest, e.g. 'overture:coffee_shop', 'osm:amenity=cafe', 'fsq:13035'
  source_categories text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------- places (owned POI base) ----------
create table public.places (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('overture', 'osm', 'fsq', 'user')),
  source_id    text not null,
  name         text not null,
  category     text not null,            -- primary interest slug (denormalised for fast filtering)
  interest_slugs text[] not null default '{}',
  source_category text,                  -- raw upstream category
  geom         extensions.geography(Point, 4326) not null,
  address      jsonb,
  confidence   real,                     -- Overture confidence / fsq popularity, 0..1
  props        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (source, source_id)
);
create index places_geom_gix      on public.places using gist (geom);
create index places_interests_gin on public.places using gin (interest_slugs);
create index places_category_idx  on public.places (category);

-- ---------- per-user ----------
create table public.user_interests (
  user_id   uuid not null references auth.users (id) on delete cascade,
  slug      text not null references public.interests (slug) on delete cascade,
  weight    real not null default 1,
  primary key (user_id, slug)
);

create table public.user_progress (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  xp             integer not null default 0 check (xp >= 0),
  level          integer not null default 1,
  revealed_cells text[] not null default '{}',   -- fog-of-war cell keys, see src/game/fog.ts
  updated_at     timestamptz not null default now()
);

create table public.discoveries (
  user_id    uuid not null references auth.users (id) on delete cascade,
  place_id   uuid not null references public.places (id) on delete cascade,
  xp_awarded integer not null default 0,
  found_at   timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table public.missions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null default 'visit' check (kind in ('visit', 'collect', 'streak')),
  title       text not null,
  target_place_ids uuid[] not null default '{}',
  reward_xp   integer not null default 50,
  status      text not null default 'active' check (status in ('active', 'done', 'expired')),
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index missions_user_active on public.missions (user_id) where status = 'active';

-- ---------- RLS ----------
alter table public.interests      enable row level security;
alter table public.places         enable row level security;
alter table public.user_interests enable row level security;
alter table public.user_progress  enable row level security;
alter table public.discoveries    enable row level security;
alter table public.missions       enable row level security;

-- catalog + POIs: world-readable, written only by the service role (ingest)
create policy "interests readable" on public.interests for select using (true);
create policy "places readable"    on public.places    for select using (true);

create policy "own interests" on public.user_interests for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own progress read" on public.user_progress for select using ((select auth.uid()) = user_id);
create policy "own discoveries read" on public.discoveries for select using ((select auth.uid()) = user_id);
create policy "own missions read" on public.missions for select using ((select auth.uid()) = user_id);
-- XP-bearing writes go through discover_place() so a client cannot award itself XP.

-- ---------- RPC: nearby places, interest-filtered ----------
create or replace function public.places_nearby(
  p_lng double precision,
  p_lat double precision,
  p_radius_m double precision default 1500,
  p_interests text[] default null,
  p_limit integer default 200
)
returns table (id uuid, name text, category text, lng double precision, lat double precision, distance_m double precision, interest_slugs text[])
language sql stable
set search_path = public, extensions
as $$
  with me as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g)
  select p.id, p.name, p.category,
         st_x(p.geom::geometry), st_y(p.geom::geometry),
         st_distance(p.geom, me.g) as distance_m,
         p.interest_slugs
  from public.places p, me
  where st_dwithin(p.geom, me.g, least(p_radius_m, 10000))
    and (p_interests is null or p.interest_slugs && p_interests)
  order by p.geom <-> me.g
  limit least(p_limit, 500);
$$;

-- ---------- RPC: discover (server-checked distance + XP) ----------
create or replace function public.discover_place(p_place_id uuid, p_lng double precision, p_lat double precision)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  pl  public.places;
  first_in_cat boolean;
  matches boolean;
  gained integer;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into pl from public.places where id = p_place_id;
  if not found then raise exception 'no such place'; end if;
  if st_distance(pl.geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) > 60 then
    raise exception 'too far';
  end if;
  if exists (select 1 from public.discoveries where user_id = uid and place_id = p_place_id) then return 0; end if;

  select not exists (
    select 1 from public.discoveries d join public.places q on q.id = d.place_id
    where d.user_id = uid and q.category = pl.category) into first_in_cat;
  select exists (select 1 from public.user_interests where user_id = uid and slug = pl.category) into matches;
  -- keep in sync with src/game/xp.ts discoveryXp()
  gained := 10 + case when matches then 15 else 0 end + case when first_in_cat then 25 else 0 end;

  insert into public.discoveries (user_id, place_id, xp_awarded) values (uid, p_place_id, gained);
  insert into public.user_progress (user_id, xp) values (uid, gained)
    on conflict (user_id) do update set xp = public.user_progress.xp + gained, updated_at = now();
  return gained;
end;
$$;
revoke all on function public.discover_place(uuid, double precision, double precision) from public, anon;
grant execute on function public.discover_place(uuid, double precision, double precision) to authenticated;
grant execute on function public.places_nearby(double precision, double precision, double precision, text[], integer) to anon, authenticated;
