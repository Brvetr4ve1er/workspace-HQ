import { useEffect, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { MapView } from './map/MapView';
import { Radar } from './hud/Radar';
import { XpBar, InterestPicker, Mission } from './hud/Hud';
import { useGame } from './game/store';
import { demoPlaces } from './game/demo';
import { placesNearby, supabase, type NearbyPlace } from './lib/supabase';
import { pickBasemap } from './map/style';
import { haversineM } from './game/xp';

const STEP_M = 25;

export default function App() {
  const [main, setMain] = useState<MLMap | null>(null);
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const interests = useGame((s) => s.interests);
  const player = useGame((s) => s.player);
  const movePlayer = useGame((s) => s.movePlayer);
  const [picking, setPicking] = useState(() => useGame.getState().interests.length === 0);
  const [gps, setGps] = useState(false);

  // Reload places when the player leaves the last loaded area (or interests change).
  useEffect(() => {
    if (anchor && haversineM(anchor, player) < 800) return;
    setAnchor(player);
  }, [player, anchor]);
  useEffect(() => {
    if (!anchor) return;
    let off = false;
    (supabase ? placesNearby(anchor[0], anchor[1], 1500, interests) : Promise.resolve(demoPlaces(anchor, interests)))
      .then((p) => !off && setPlaces(p))
      .catch((e) => { console.warn('[maps-hq] places_nearby failed, using demo data', e); !off && setPlaces(demoPlaces(anchor, interests)); });
    return () => { off = true; };
  }, [anchor, interests]);

  // WASD / arrows move the player relative to the camera bearing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir: Record<string, [number, number]> = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
      const v = dir[e.key.toLowerCase()];
      if (!v || picking) return;
      e.preventDefault();
      const b = ((main?.getBearing() ?? 0) * Math.PI) / 180;
      const east = v[0] * Math.cos(b) + v[1] * Math.sin(b);
      const north = -v[0] * Math.sin(b) + v[1] * Math.cos(b);
      const [lng, lat] = useGame.getState().player;
      movePlayer([lng + (east * STEP_M) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (north * STEP_M) / 111320]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [main, picking, movePlayer]);

  // Real GPS when switched on.
  useEffect(() => {
    if (!gps || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((p) => movePlayer([p.coords.longitude, p.coords.latitude]), () => setGps(false), { enableHighAccuracy: true });
    return () => navigator.geolocation.clearWatch(id);
  }, [gps, movePlayer]);

  return (
    <div className="app">
      <MapView places={places} onMap={setMain} />
      <div className="scanlines" />
      <header className="top">
        <div className="brand">MAPS<span>HQ</span></div>
        <XpBar />
        <div className="top-actions">
          <button className={gps ? 'btn on' : 'btn'} onClick={() => setGps((g) => !g)}>{gps ? 'GPS ●' : 'GPS ○'}</button>
          <button className="btn" onClick={() => setPicking(true)}>Interests</button>
        </div>
      </header>
      <Radar places={places} main={main} />
      <Mission places={places} />
      <footer className="hint">
        WASD / arrows to move · click to travel · {supabase ? 'live POIs' : 'demo POIs (no Supabase env)'} · tiles: {pickBasemap()}
      </footer>
      {picking && <InterestPicker onClose={() => setPicking(false)} />}
    </div>
  );
}
