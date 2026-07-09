import { round } from './util.mjs';

// Settle Spellbook cast telemetry into XP. Pure; no file I/O — the orchestrator
// reads spellbook.json / spell-telemetry.json and passes them in.
// NOTE: preserves current behavior verbatim, including the deferred bugs in
// docs spec 2026-07-06 §4. Moved from assemble.mjs (renames: spellbookCat->catalog,
// spellTele->telemetry, GCFG.spellcraft->config, TODAY->today).
//
// Grind-proofing by construction: base cast XP pays once per spell per day and is
// capped per day; mastery counts distinct days; each cast settles exactly once
// (watermark carried in account.spellcraft.last_processed_at).
export function settle({ catalog, telemetry, config, prev, today }) {
  const SC = config || {};
  const scTiers = SC.mastery_tiers || [];
  const scRankOf = (days) => { let r = null; for (const t of scTiers) if (days >= t.days) r = t.rank; return r; };
  const scRankIdx = (rank) => scTiers.findIndex((t) => t.rank === rank);

  let spellcraft = null, spellXp = 0, spellOfDay = null;
  const spellcraftEvents = [];   // pushed into changes_since_prev further down
  if (catalog) {
    const catById = new Map(catalog.spells.map((s) => [s.id, s]));
    const prevSC = prev?.account?.spellcraft || null;
    const rollup = telemetry?.rollup || {};
    const casts = telemetry?.casts || [];
    const watermark = prevSC?.last_processed_at || '';
    const fresh = casts.filter((c) => c.started_at > watermark && (c.outcome === 'resolved' || c.outcome === 'channeled'));

    // base cast XP: dedup per spell per day, then cap the day's total
    const perDay = {};
    for (const c of fresh) (perDay[c.started_at.slice(0, 10)] ??= new Set()).add(c.spell_id);
    for (const ids of Object.values(perDay)) spellXp += Math.min(ids.size * (SC.cast_xp ?? 5), SC.cast_xp_daily_cap_total ?? 25);

    // mastery (from rollup distinct-days) + first-cast / rank-up bonuses vs prev scan
    const mastery = {};
    for (const [id, r] of Object.entries(rollup)) {
      if (!catById.has(id)) continue;   // orphaned telemetry (spell removed) earns nothing
      const days = (r.distinct_days || []).length;
      const rank = scRankOf(days);
      if (rank) mastery[id] = { rank, distinct_days: days };
    }
    const prevMastery = prevSC?.mastery || {};
    let newSpellsCast = 0;
    for (const [id, m] of Object.entries(mastery)) {
      const name = catById.get(id)?.name || id;
      if (!prevMastery[id]) { spellXp += SC.first_cast_bonus ?? 15; newSpellsCast++; }
      else if (scRankIdx(m.rank) > scRankIdx(prevMastery[id].rank)) {
        spellXp += SC.mastery_rank_up_xp ?? 20;
        spellcraftEvents.push({ type: 'spell_mastery_up', detail: `🏅 ${name} mastery → ${m.rank} (${m.distinct_days} days)`, impact: 'positive', notify: false });
      }
    }

    // spell-of-the-day bonus: cast yesterday's pick since the last settlement
    let sotdCasts = prevSC?.sotd_casts || 0;
    const prevPick = prevSC?.spell_of_day?.id;
    if (prevPick && fresh.some((c) => c.spell_id === prevPick)) {
      spellXp += SC.spell_of_day_bonus ?? 10;
      sotdCasts++;
      spellcraftEvents.push({ type: 'spell_of_day_cast', detail: `🃏 Spell of the Day cast (+${SC.spell_of_day_bonus ?? 10} bonus XP)`, impact: 'positive', notify: false });
    }

    // today's pick (deterministic): date-hash over a rarity-weighted pool of spells
    // not cast in the last 7 days — the game nudges you toward the unused arsenal.
    const rarityIdx = (r) => Math.max(0, (SC.rarity_order || []).indexOf(r));
    const cutoff = new Date(Date.parse(today) - 7 * 86400000).toISOString();
    const pool = catalog.spells.filter((s) => !s.invalid && (s.kind === 'castable' || s.kind === 'channeled')
      && (!rollup[s.id]?.last_cast || rollup[s.id].last_cast < cutoff));
    if (pool.length) {
      const weighted = pool.flatMap((s) => Array(rarityIdx(s.rarity) + 1).fill(s));
      let h = 0; for (const ch of today) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const pick = weighted[h % weighted.length];
      spellOfDay = { id: pick.id, name: pick.name, icon: pick.icon, school: pick.school, rarity: pick.rarity, bonus_xp: SC.spell_of_day_bonus ?? 10 };
    }

    // collection meters
    const everCastIds = Object.keys(mastery).filter((id) => catById.has(id));
    const perSchool = {};
    for (const s of catalog.spells) {
      const ps = (perSchool[s.school] ??= { known: 0, cast: 0, pct: 0 });
      ps.known++;
    }
    for (const id of everCastIds) {
      const ps = perSchool[catById.get(id).school];
      if (ps) ps.cast++;
    }
    for (const ps of Object.values(perSchool)) ps.pct = ps.known ? round((ps.cast / ps.known) * 100) : 0;
    const lifetimeCasts = Object.values(rollup).reduce((a, r) => a + (r.lifetime_casts || 0), 0);

    const maxWatermark = fresh.reduce((a, c) => (c.started_at > a ? c.started_at : a), watermark);
    spellcraft = {
      spells_known: catalog.counts.total,
      familiars_bound: (catalog.familiars || []).length,
      ever_cast: everCastIds.length,
      ever_cast_pct: catalog.counts.total ? round((everCastIds.length / catalog.counts.total) * 100) : 0,
      per_school: perSchool,
      lifetime_casts: lifetimeCasts,
      mastery,
      sotd_casts: sotdCasts,
      spell_of_day: spellOfDay,
      last_processed_at: maxWatermark,
      xp_settled_this_scan: prev ? spellXp : 0,
    };
    if (newSpellsCast) spellcraftEvents.push({ type: 'spell_learned', detail: `🪄 ${newSpellsCast} spell(s) cast for the first time (+${newSpellsCast * (SC.first_cast_bonus ?? 15)} XP)`, impact: 'positive', notify: false });
    if (prevSC && catalog.counts.total > prevSC.spells_known) {
      spellcraftEvents.push({ type: 'spell_learned', detail: `✨ Arsenal grew: ${prevSC.spells_known} → ${catalog.counts.total} spells known`, impact: 'positive', notify: false });
    }
  }
  return { spellcraft, spellXp, events: spellcraftEvents, spellOfDay };
}
