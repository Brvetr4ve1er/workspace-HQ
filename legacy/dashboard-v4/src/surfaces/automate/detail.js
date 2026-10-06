// detail.js — the inspect-and-run panel for one automation (v4.1 S4).
// Ports the CONTENT of v3's grimoire spell drawer (openSpellDrawer) into a
// standing v4 panel: description, exact command line, source path, schedule,
// usage record, and the real verbs (RUN via the confirm gate, favorite).
//
// Honesty notes carried from the audit:
// - v3's "Open file" button called hq.openFile(origin_path) with one argument;
//   main's containment check rejects every current origin_path (none live under
//   the Documents root), so that control silently no-oped. It is NOT ported.
//   The path is shown as text with a working Copy button instead.
// - Interactive (channeled) runs open a real terminal window — the RUN button's
//   title says so before the click.
//
// XSS: every spell-derived string goes through esc() into innerHTML.
import { el, esc } from '../../ui/util.js';
import { catLabel, srcLabel, kindLabel, isCastable, usageOf } from './catalog.mjs';

const NO_BRIDGE = 'Needs the live app — this preview has no bridge to the main process (window.hq is absent).';

export function createDetailPanel({ hq, alive, onCast, onToggleFav }) {
  const canCast = typeof hq?.castSpell === 'function';
  const canFav = typeof hq?.favoriteSpell === 'function';

  const root = el('section', 'panel automate-detail', `
    <div class="panel-head">
      <span class="panel-title">Detail</span>
      <span class="panel-sub" data-sub></span>
    </div>
    <div class="panel-body" data-body></div>`);
  const bodyEl = root.querySelector('[data-body]');
  const subEl = root.querySelector('[data-sub]');

  function copyBtn(text) {
    const b = el('button', 'btn btn--sm', 'Copy path');
    b.type = 'button';
    b.title = 'Copy the source path to the clipboard.';
    b.onclick = async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; }
      catch {
        // file:// clipboard permission can refuse — fall back to the legacy path
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
      }
      if (!alive()) return;
      b.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { if (alive() && b.isConnected) b.textContent = 'Copy path'; }, 1500);
    };
    return b;
  }

  // spell: the catalog entry. info: { rollup, favorites } (live-normalized).
  function render(spell, info = {}) {
    bodyEl.innerHTML = '';
    if (!spell) {
      subEl.textContent = '';
      bodyEl.appendChild(el('div', 'empty', 'Select an automation in the arsenal to inspect and run it.'));
      return;
    }
    const m = usageOf(info.rollup, spell.id);
    const roll = info.rollup?.[spell.id];
    const isFav = Array.isArray(info.favorites) && info.favorites.includes(spell.id);
    subEl.textContent = `${catLabel(spell.school)} · ${srcLabel(spell.source)} · ${kindLabel(spell.kind)}`;

    const cmd = spell.kind === 'chain'
      ? 'steps: ' + (spell.chain || []).join(' -> ')
      : [spell.command, ...(spell.args || [])].filter(Boolean).join(' ');

    const head = el('div', 'det-head', `
      <span class="det-icon" aria-hidden="true">${esc(spell.icon || '◆')}</span>
      <div class="det-title">
        <div class="det-name">${esc(spell.name)}</div>
        <div class="meta">${m.rank ? `${esc(m.rank)} · used on ${m.days} day${m.days === 1 ? '' : 's'}` : 'never run'}</div>
      </div>`);
    bodyEl.appendChild(head);

    bodyEl.appendChild(el('div', 'body det-desc', esc(spell.tooltip || spell.description || 'No description available.')));
    if (spell.body) bodyEl.appendChild(el('div', 'meta det-body', esc(String(spell.body).slice(0, 1200))));

    if (cmd) {
      bodyEl.appendChild(el('div', 'eyebrow det-sec', 'Command'));
      const pre = el('pre', 'term det-cmd');
      pre.textContent = cmd;
      bodyEl.appendChild(pre);
    }
    const kv = (k, v) => bodyEl.appendChild(el('div', 'meta det-kv', `<b>${esc(k)}</b> ${v}`));
    if (spell.cwd) kv('dir', esc(spell.cwd));
    if (spell.schedule) {
      kv('schedule', `next ${esc(spell.schedule.next_run || '—')} · last ${esc(spell.schedule.last_run || '—')} (result ${esc(String(spell.schedule.last_result ?? '—'))})`);
    }
    if (roll) {
      kv('record', `${Number(roll.lifetime_casts) || 0} run${(Number(roll.lifetime_casts) || 0) === 1 ? '' : 's'} · last ${esc(String(roll.last_cast || '—').slice(0, 16).replace('T', ' '))}`);
    }
    if (spell.origin_path) {
      const src = el('div', 'det-src');
      src.appendChild(el('div', 'mono-path', esc(spell.origin_path)));
      src.appendChild(copyBtn(spell.origin_path));
      bodyEl.appendChild(src);
    }

    // ------------------------------------------------------------- the verbs
    const acts = el('div', 'det-actions');
    const run = el('button', 'btn btn--primary', 'Run');
    run.type = 'button';
    if (!isCastable(spell)) {
      run.disabled = true;
      run.title = 'Plugin reference — documentation, nothing to run.';
    } else if (spell.invalid) {
      run.disabled = true;
      run.title = 'Invalid — broken chain references. Fix the definition, then rescan.';
    } else if (!canCast) {
      run.disabled = true;
      run.title = NO_BRIDGE;
    } else {
      run.title = spell.kind === 'channeled'
        ? 'Interactive — opens a terminal window running this session.'
        : 'Runs after a dry-run confirm: you will see the exact command line first. Output streams into the run log.';
      run.onclick = () => onCast(spell);
    }
    acts.appendChild(run);

    const fav = el('button', 'btn', isFav ? '★ Favorited' : '☆ Favorite');
    fav.type = 'button';
    if (!canFav) {
      fav.disabled = true;
      fav.title = NO_BRIDGE;
    } else {
      fav.title = isFav ? 'Remove from favorites (favorites sort first everywhere).'
                        : 'Pin to favorites — favorites sort first here, in the mini HUD, and in the tray.';
      fav.onclick = () => onToggleFav(spell);
    }
    acts.appendChild(fav);
    bodyEl.appendChild(acts);
  }

  render(null);
  return { el: root, render };
}
