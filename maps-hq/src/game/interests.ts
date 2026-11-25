/** Seed list; the DB table `interests` is the source of truth once Supabase is wired. Keep slugs in sync with supabase/seed.sql. */
export type Interest = { slug: string; label: string; glyph: string; color: string };

export const INTERESTS: Interest[] = [
  { slug: 'coffee', label: 'Coffee', glyph: '☕', color: '#f2b84b' },
  { slug: 'food', label: 'Street food', glyph: '🍢', color: '#ff7a45' },
  { slug: 'nightlife', label: 'Nightlife', glyph: '🌙', color: '#c77dff' },
  { slug: 'tech', label: 'Tech & cowork', glyph: '⌘', color: '#3ae3ff' },
  { slug: 'history', label: 'History', glyph: '🏛', color: '#d9c7a1' },
  { slug: 'nature', label: 'Nature', glyph: '🌿', color: '#5ef08a' },
  { slug: 'fitness', label: 'Fitness', glyph: '⚡', color: '#ff4d6d' },
  { slug: 'art', label: 'Art & design', glyph: '✦', color: '#ff9bd2' },
  { slug: 'shopping', label: 'Shopping', glyph: '◆', color: '#7aa2ff' },
  { slug: 'viewpoints', label: 'Viewpoints', glyph: '▲', color: '#ffe66d' },
];

export const interestBySlug = Object.fromEntries(INTERESTS.map((i) => [i.slug, i]));
