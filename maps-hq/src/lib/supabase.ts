import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null until the env is filled in: the app runs offline on demo data. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export type NearbyPlace = {
  id: string;
  name: string;
  category: string;
  lng: number;
  lat: number;
  distance_m: number;
  interest_slugs: string[];
};

export async function placesNearby(lng: number, lat: number, radiusM: number, interests: string[]): Promise<NearbyPlace[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('places_nearby', {
    p_lng: lng, p_lat: lat, p_radius_m: radiusM, p_interests: interests.length ? interests : null, p_limit: 200,
  });
  if (error) throw error;
  return (data ?? []) as NearbyPlace[];
}
