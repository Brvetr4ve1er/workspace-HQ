-- Interest catalog. Keep slugs in sync with src/game/interests.ts.
insert into public.interests (slug, label, glyph, color, source_categories) values
  ('coffee',     'Coffee',        '☕', '#f2b84b', '{overture:coffee_shop,overture:cafe,osm:amenity=cafe}'),
  ('food',       'Street food',   '🍢', '#ff7a45', '{overture:restaurant,overture:fast_food_restaurant,osm:amenity=restaurant,osm:amenity=fast_food}'),
  ('nightlife',  'Nightlife',     '🌙', '#c77dff', '{overture:bar,overture:night_club,osm:amenity=bar,osm:amenity=nightclub}'),
  ('tech',       'Tech & cowork', '⌘', '#3ae3ff', '{overture:coworking_space,overture:electronics_store,osm:office=coworking}'),
  ('history',    'History',       '🏛', '#d9c7a1', '{overture:museum,overture:landmark_and_historical_building,osm:historic=*}'),
  ('nature',     'Nature',        '🌿', '#5ef08a', '{overture:park,overture:beach,osm:leisure=park,osm:natural=beach}'),
  ('fitness',    'Fitness',       '⚡', '#ff4d6d', '{overture:gym,osm:leisure=fitness_centre}'),
  ('art',        'Art & design',  '✦', '#ff9bd2', '{overture:art_gallery,osm:tourism=gallery}'),
  ('shopping',   'Shopping',      '◆', '#7aa2ff', '{overture:shopping_center,osm:shop=mall}'),
  ('viewpoints', 'Viewpoints',    '▲', '#ffe66d', '{osm:tourism=viewpoint}')
on conflict (slug) do nothing;
