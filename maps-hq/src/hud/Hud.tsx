import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../game/store';
import { levelFor, levelProgress, haversineM, DISCOVER_RADIUS_M } from '../game/xp';
import { INTERESTS, interestBySlug } from '../game/interests';
import type { NearbyPlace } from '../lib/supabase';

export function XpBar() {
  const xp = useGame((s) => s.xp);
  const found = useGame((s) => Object.keys(s.discoveries).length);
  return (
    <div className="xp">
      <div className="xp-lvl">LV {levelFor(xp)}</div>
      <div className="xp-track"><div className="xp-fill" style={{ width: `${levelProgress(xp) * 100}%` }} /></div>
      <div className="xp-meta">{xp} XP · {found} found</div>
    </div>
  );
}

export function InterestPicker({ onClose }: { onClose: () => void }) {
  const interests = useGame((s) => s.interests);
  const toggle = useGame((s) => s.toggleInterest);
  return (
    <div className="panel picker">
      <h2>Tune your map</h2>
      <p>Pick what you care about. Your radar and missions bend toward it.</p>
      <div className="chips">
        {INTERESTS.map((i) => (
          <button key={i.slug} className={interests.includes(i.slug) ? 'chip on' : 'chip'} style={{ ['--c' as string]: i.color }} onClick={() => toggle(i.slug)}>
            <span>{i.glyph}</span> {i.label}
          </button>
        ))}
      </div>
      <button className="cta" onClick={onClose} disabled={!interests.length}>Drop in</button>
    </div>
  );
}

/** Current objective = nearest undiscovered place matching an interest. In range -> Discover. */
export function Mission({ places }: { places: NearbyPlace[] }) {
  const player = useGame((s) => s.player);
  const interests = useGame((s) => s.interests);
  const discoveries = useGame((s) => s.discoveries);
  const discover = useGame((s) => s.discover);
  const [toast, setToast] = useState<string | null>(null);

  const target = useMemo(() => {
    const pool = places.filter((p) => !discoveries[p.id] && (!interests.length || interests.includes(p.category)));
    return pool.map((p) => ({ p, d: haversineM(player, [p.lng, p.lat]) })).sort((a, b) => a.d - b.d)[0];
  }, [places, player, interests, discoveries]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 1800); return () => clearTimeout(t); }, [toast]);

  return (
    <>
      <div className="panel mission">
        <div className="mission-k">OBJECTIVE</div>
        {target ? (
          <>
            <div className="mission-t">{interestBySlug[target.p.category]?.glyph} {target.p.name}</div>
            <div className="mission-d">{Math.round(target.d)} m · {interestBySlug[target.p.category]?.label ?? target.p.category}</div>
            {target.d <= DISCOVER_RADIUS_M && (
              <button className="cta" onClick={() => { const g = discover(target.p.id, target.p.category); if (g) setToast(`+${g} XP`); }}>Discover</button>
            )}
          </>
        ) : (
          <div className="mission-d">Area cleared. Move to new ground.</div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
