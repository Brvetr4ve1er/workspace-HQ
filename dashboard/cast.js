// Quick-run palette (dashboard/cast.html, Ctrl+Alt+X) — v5 clean pass S5. Was
// cast.html's inline script; it lives here so the page can carry v5's CSP.
// Rows show the last outcome from hq.getSpellTelemetry() rollup —
// "✓ 2d ago" / "✗ failed 2d ago" / "↗ terminal 2d ago" — and errors are shown
// in the palette instead of being swallowed (no spellbook, a cast refused with
// {error}, a rejected IPC call).
// K-6 (IPC-CONTRACT "Pending — v5 clean pass"): rollup[id] gains last_outcome +
// last_exit. Both vocabularies are accepted (ok|failed|channeled and the
// recordCast words resolved|fizzled|channeled). The rollup's last_cast only
// moves on resolved/channeled casts, so a failure is dated only when main sends
// its own time (last_at / last_outcome_at); otherwise it reads "✗ failed".
// Pure helpers are exported for dashboard/mini-cast.test.mjs; the DOM half only
// runs in a page.
(function (root) {
  'use strict';

  const KINDS = ['castable', 'channeled', 'chain'];
  const MAX_ROWS = 12;

  function castable(book) {
    const list = book && Array.isArray(book.spells) ? book.spells : [];
    return list.filter((s) => s && s.id != null && !s.invalid && KINDS.includes(s.kind));
  }
  // "just now" · "5m ago" · "3h ago" · "2d ago"; '' for a missing/unparseable time
  function ago(iso, now) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const m = Math.max(0, Math.round(((Number.isFinite(now) ? now : Date.now()) - t) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    if (m < 1440) return Math.round(m / 60) + 'h ago';
    return Math.round(m / 1440) + 'd ago';
  }
  function normOutcome(o) {
    if (o === 'ok' || o === 'resolved') return 'ok';
    if (o === 'failed' || o === 'fizzled') return 'failed';
    if (o === 'channeled') return 'channeled';
    return null;
  }
  // when the newest outcome happened, if main says so (not part of K-6 yet — see the header)
  const outcomeTime = (r) => (r && (r.last_at || r.last_outcome_at)) || null;
  function lastTime(r) { return outcomeTime(r) || (r && r.last_cast) || null; }

  // the right-hand label of a row: { text, tone: 'green'|'red'|'muted'|'faint', title }
  function lastRun(r, kind, now) {
    const entry = r && typeof r === 'object' ? r : null;
    const o = entry ? normOutcome(entry.last_outcome) : null;
    if (o === 'ok') {
      const a = ago(outcomeTime(entry) || entry.last_cast, now);
      return { text: a ? '✓ ' + a : '✓ ok', tone: 'green', title: 'last run succeeded' };
    }
    if (o === 'failed') {
      const a = ago(outcomeTime(entry), now);
      const exit = Number.isFinite(entry.last_exit) ? ' (exit ' + entry.last_exit + ')' : '';
      const okAgo = ago(entry.last_cast, now);
      return {
        text: a ? '✗ failed ' + a : '✗ failed', tone: 'red',
        title: 'last run failed' + exit + (a ? '' : okAgo ? ' · last success ' + okAgo : ''),
      };
    }
    if (o === 'channeled') {
      const a = ago(outcomeTime(entry) || entry.last_cast, now);
      return { text: a ? '↗ terminal ' + a : '↗ terminal', tone: 'muted', title: 'last run opened in a terminal (no exit code comes back)' };
    }
    const a = ago(entry && entry.last_cast, now);
    if (a) return { text: a, tone: 'faint', title: 'last run ' + a + ' (outcome not reported by this app build)' };
    if (kind === 'channeled') return { text: '↗ opens a terminal', tone: 'faint', title: 'never run from here' };
    return { text: 'not run yet', tone: 'faint', title: 'never run from here' };
  }
  // mastery pips from distinct days cast (same thresholds as before the restyle)
  function pipCount(r) {
    const d = (r && Number.isFinite(r.distinct_days)) ? r.distinct_days : 0;
    return [1, 5, 15, 40, 100].filter((x) => d >= x).length;
  }
  function rank(s, q) {
    const n = String(s.name || s.id).toLowerCase(), i = String(s.id).toLowerCase();
    if (n.startsWith(q)) return 0;
    if (n.includes(q)) return 1;
    if (i.includes(q) || String(s.school || '').toLowerCase().includes(q)) return 2;
    return -1;
  }
  // empty query → favourites, then most recent, then the grimoire; else ranked matches
  function pickHits(spells, tele, query, limit) {
    const max = Number.isFinite(limit) ? limit : MAX_ROWS;
    const list = Array.isArray(spells) ? spells : [];
    const roll = (tele && tele.rollup) || {};
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
      const byId = new Map(list.map((s) => [s.id, s]));
      const fav = ((tele && tele.favorites) || []).map((id) => byId.get(id)).filter(Boolean);
      const rec = list.filter((s) => lastTime(roll[s.id]))
        .sort((a, b) => String(lastTime(roll[b.id])).localeCompare(String(lastTime(roll[a.id]))));
      return [...new Set([...fav, ...rec, ...list.filter((s) => s.source === 'grimoire')])].slice(0, max);
    }
    return list.map((s) => [rank(s, q), s]).filter(([r]) => r >= 0)
      .sort((a, b) => a[0] - b[0]).slice(0, max).map(([, s]) => s);
  }
  function errText(e) {
    if (!e) return 'unknown error';
    const m = typeof e === 'string' ? e : e.message || String(e);
    return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 200);
  }
  // what to tell the user about a castSpell reply that is not a running cast, or null
  function castProblem(res) {
    if (!res || typeof res !== 'object') return 'no answer from the app';
    if (res.error) return String(res.error);
    return null;
  }

  const api = { castable, ago, normOutcome, lastRun, pipCount, rank, pickHits, errText, castProblem };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) boot(root.document, root.hq);

  function boot(doc, hq) {
    const $ = (id) => doc.getElementById(id);
    const has = (name) => !!(hq && typeof hq[name] === 'function');
    let spells = [], tele = { favorites: [], rollup: {} }, hits = [], sel = 0, pending = null, busy = false;

    function say(text, tone) {   // the palette's one message line (errors included)
      const m = $('msg');
      if (!text) { m.hidden = true; m.textContent = ''; return; }
      m.textContent = text;
      m.className = 'msg ' + (tone || 'red');
      m.hidden = false;
    }
    function closeConfirm() { pending = null; $('confirm').hidden = true; }
    function hide() {
      if (!has('hideCastPalette')) return;
      Promise.resolve(hq.hideCastPalette()).catch((e) => say('could not close the palette: ' + errText(e)));
    }

    function filter() {
      hits = pickHits(spells, tele, $('q').value);
      sel = 0;
      closeConfirm();
      say('');
      draw();
    }
    function draw() {
      const L = $('list');
      L.textContent = '';
      $('empty').hidden = hits.length > 0;
      const now = Date.now();
      hits.forEach((s, i) => {
        const r = doc.createElement('div');
        r.className = 'row' + (i === sel ? ' sel' : '');
        r.setAttribute('role', 'option');
        r.setAttribute('aria-selected', i === sel ? 'true' : 'false');
        // names/icons come from third-party skill frontmatter — textContent only
        const mk = (cls, text) => { const sp = doc.createElement('span'); sp.className = cls; sp.textContent = text; return sp; };
        r.appendChild(mk('ic', s.icon || '✴️'));
        r.appendChild(mk('nm', s.name || s.id));
        const roll = tele.rollup && tele.rollup[s.id];
        const p = pipCount(roll);
        if (p) { const pe = mk('pips', '●'.repeat(p)); pe.title = 'mastery: cast on ' + roll.distinct_days + ' distinct day' + (roll.distinct_days === 1 ? '' : 's'); r.appendChild(pe); }
        const last = lastRun(roll, s.kind, now);
        const meta = mk('meta ' + last.tone, last.text);
        meta.title = last.title;
        r.appendChild(meta);
        r.title = [s.school, s.kind === 'channeled' ? 'opens a terminal' : s.kind === 'chain' ? 'chain' : ''].filter(Boolean).join(' · ');
        r.onclick = () => { sel = i; draw(); cast(); };
        L.appendChild(r);
      });
      const cur = L.children[sel];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    async function cast() {
      const s = hits[sel];
      if (!s || busy) return;
      if (!has('castSpell')) { say('running spells is not available in this window'); return; }
      const name = s.name || s.id;
      const hash = pending && pending.id === s.id ? pending.content_hash : undefined;
      busy = true;
      say('');
      let res;
      try { res = await hq.castSpell(s.id, hash, { notify: true }); }
      catch (e) { res = { error: errText(e) }; }
      finally { busy = false; }
      if (res && res.confirm_required && res.preview) {
        pending = res.preview;
        const c = $('confirm');
        c.querySelector('.why').textContent = (pending.changed ? '⚠ changed since you last approved it — ' : 'first run — ') + 'it will run exactly:';
        c.querySelector('.cmd').textContent = [pending.command, ...(pending.args || [])].join(' ');
        c.querySelector('.cwd').textContent = pending.cwd ? 'in ' + pending.cwd : '';
        c.hidden = false;
        return;
      }
      const problem = castProblem(res);
      if (problem) { closeConfirm(); say(name + ': ' + problem); return; }
      hide();   // running (or opened in a terminal); the outcome arrives as a notification
    }
    function move(d) {
      if (!hits.length) return;
      sel = Math.max(0, Math.min(hits.length - 1, sel + d));
      closeConfirm();
      draw();
    }

    $('q').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { move(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
      // a held Enter auto-repeats: it must never approve the dry-run confirm it just opened
      else if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) cast(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (pending) closeConfirm(); else hide(); }
    });
    $('q').addEventListener('input', filter);

    (async () => {
      let book = null;
      try {
        if (!has('getSpellbook')) throw new Error('this window has no spellbook bridge');
        book = await hq.getSpellbook();
      } catch (e) {
        say('could not read the spellbook: ' + errText(e));
        $('empty').textContent = 'no spells loaded';
      }
      if (has('getSpellTelemetry')) {
        try { tele = (await hq.getSpellTelemetry()) || tele; }
        catch (e) { $('stat').textContent = 'last-run status unavailable: ' + errText(e); }
      }
      if (!tele.rollup || typeof tele.rollup !== 'object') tele.rollup = {};
      if (!Array.isArray(tele.favorites)) tele.favorites = [];
      spells = castable(book);
      if (book == null && $('msg').hidden) $('empty').textContent = 'no spellbook yet — run a scan first';
      else if (book && !spells.length) $('empty').textContent = 'the spellbook has no runnable spells';
      const keep = $('msg').hidden ? null : $('msg').textContent;
      filter();
      if (keep) say(keep);
      $('q').focus();
    })();
    root.addEventListener('DOMContentLoaded', () => $('q').focus());
  }
})(typeof window !== 'undefined' ? window : null);
