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

  // ---- "Log a spend" (money-quicklog): a number at the start or end of the query adds a top row ----
  // The gate below is a COPY of dashboard-v5/src/logic/money-line.js (which copies dashboard/money/quicklog.mjs):
  // dashboard/money-line-parity.test.mjs runs one table of lines through all three, so the year rule can't drift.
  // The row's words come from main's dry preview (hq.money.apply({type:'log-line', dry:true})), never from here.
  // ---- BEGIN amountLine block (copy me) ----
  const MAX_LINE = 200;
  const CATEGORY_WORDS = ['cafe', 'coffee', 'kahwa', 'courses', 'pain', 'food', 'resto', 'snack', 'taxi', 'bus', 'yassir', 'essence', 'tram', 'metro', 'loyer', 'idoom', 'sonelgaz', 'facture', 'pharmacie', 'pharmacy'];
  const AL_SP = '[ \\u00A0\\u202F\\u2009]';
  const AL_NUM = `\\d{1,3}(?:(?:${AL_SP}|[.,])\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?`;
  const AL_TAG_PRE = 'us\\$|usd|\\$|dzd|da|eur|€';
  const AL_TAG_POST = 'dzd|dinars?|da|usd|\\$|dollars?|eur|€';
  const AL_PRE = `(?:(${AL_TAG_PRE})${AL_SP}?)?`;
  const AL_POST = `(?:${AL_SP}?(${AL_TAG_POST})(?![\\p{L}\\d]))?`;
  const AL_START = new RegExp(`^${AL_PRE}(${AL_NUM})${AL_POST}(?=\\s|$)`, 'iu');
  const AL_END = new RegExp(`(?<=^|\\s)${AL_PRE}(${AL_NUM})${AL_POST}$`, 'iu');
  function alParse(raw) {   // parse.mjs's parseAmount: a separator before exactly three digits is thousands, the last one before 1–2 digits is the point
    const s = raw.replace(/[\s   ]/g, '');
    if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;
    const m = /^(.*?)[.,](\d{1,2})$/.exec(s), intPart = m ? m[1] : s, frac = m ? m[2] : '';
    if (!/^\d+(?:[.,]\d{3})*$/.test(intPart)) return null;
    const n = Number(`${intPart.replace(/[.,]/g, '')}${frac ? `.${frac}` : ''}`);
    return Number.isFinite(n) ? n : null;
  }
  function alTag(t) {
    if (!t) return '';
    const x = t.toLowerCase();
    return x === 'da' || x === 'dzd' || x.startsWith('dinar') ? 'DA' : x === 'usd' || x === 'us$' || x === '$' || x.startsWith('dollar') ? 'USD' : 'EUR';
  }
  const alWords = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9$]+/).filter(Boolean);
  function amountLine(text) {
    if (typeof text !== 'string') return null;
    const s0 = text.trim().replace(/\s+/g, ' ');
    if (!s0 || s0.length > MAX_LINE) return null;
    const s = s0.replace(/^(?:hier|yesterday) /i, '').replace(/ (?:hier|yesterday)$/i, '');
    const m = AL_START.exec(s) || AL_END.exec(s);
    if (!m) return null;
    const n = alParse(m[2]);
    if (n === null || n <= 0 || n >= 1e9) return null;
    const pre = alTag(m[1]), post = alTag(m[3]);
    if (pre === 'EUR' || post === 'EUR' || (pre && post && pre !== post)) return null;
    const currency = pre || post, tagged = currency !== '';
    if (!tagged && /^\d{4}$/.test(m[2]) && n >= 1900 && n <= 2099) {
      const rest = alWords(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length));
      if (!rest.some((w) => CATEGORY_WORDS.includes(w))) return null;
    }
    return { amount: Math.round(n * 100) / 100, currency: currency || 'DA', tagged };
  }
  // ---- END amountLine block ----

  // the row's text: the dry preview once it is in, the typed line until then; no accounts yet = the one-minute setup
  function spendText(st, text) {
    if (st && st.setup) return 'Set up Money first (one minute) ›';
    const p = st && st.preview;
    if (p && p.kind === 'log') return 'Log a spend · ' + p.label;
    if (p && p.kind === 'slip') return 'To the Inbox · ' + p.label + ' — ' + p.reason;
    if (p && p.kind === 'none') return 'Log a spend · ' + p.reason;
    return 'Log a spend · ' + String(text || '').trim();
  }
  // the spend row goes on top, except behind an exact spell-name match (that one stays first)
  function withSpendRow(hits, query) {
    const list = Array.isArray(hits) ? hits : [];
    const q = String(query || '').trim().toLowerCase();
    const first = list[0];
    const exact = !!first && [first.name, first.id].some((v) => v != null && String(v).toLowerCase() === q);
    const row = { spend: true };
    return exact ? [first, row, ...list.slice(1)] : [row, ...list];
  }

  const api = { castable, ago, normOutcome, lastRun, pipCount, rank, pickHits, errText, castProblem, amountLine, spendText, withSpendRow };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) boot(root.document, root.hq);

  function boot(doc, hq) {
    const $ = (id) => doc.getElementById(id);
    const has = (name) => !!(hq && typeof hq[name] === 'function');
    let spells = [], tele = { favorites: [], rollup: {} }, hits = [], sel = 0, pending = null, busy = false;
    let spend = null, spendSeq = 0, spendTimer = 0;   // the Log a spend row's state: { setup, preview }
    const hasMoney = () => !!(hq && hq.money && typeof hq.money.apply === 'function' && typeof hq.money.read === 'function');

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
      const q = $('q').value;
      hits = pickHits(spells, tele, q);
      sel = 0;
      closeConfirm();
      say('');
      spend = null;
      spendSeq++;
      clearTimeout(spendTimer);
      if (hasMoney() && amountLine(q)) {
        spend = { setup: false, preview: null };
        hits = withSpendRow(hits, q);
        queueSpend(q);
      }
      draw();
    }
    // 150 ms after the last keystroke: are there accounts? then a dry run for the row's words (writes nothing)
    function queueSpend(q) {
      const mine = spendSeq;
      spendTimer = setTimeout(async () => {
        try {
          const v = await hq.money.read();
          if (mine !== spendSeq || !spend) return;
          if (v && v.error) { spend.preview = { kind: 'none', reason: String(v.error) }; draw(); return; }
          if (!(v && v.view && v.view.hasAccounts)) { spend.setup = true; draw(); return; }
          spend.setup = false;
          const r = await hq.money.apply({ type: 'log-line', text: q, from: 'palette', dry: true });
          if (mine !== spendSeq || !spend) return;
          spend.preview = r && r.preview ? r.preview : r && r.error ? { kind: 'none', reason: String(r.error) } : null;
          draw();
        } catch (e) { /* the typed line stays on the row; Enter shows the real reason */ }
      }, 150);
    }
    // Enter on the spend row: no accounts -> Money > Today; else one log-line, main's note (or its refusal) on the message line
    async function logSpend() {
      const q = $('q').value;
      busy = true;
      say('');
      try {
        const v = await hq.money.read();
        if (v && v.error) { say(String(v.error)); return; }
        if (!(v && v.view && v.view.hasAccounts)) {
          if (has('openAt')) { await hq.openAt({ tab: 'money', sub: 'today' }); hide(); }
          else say('open Money › Today to set it up');
          return;
        }
        const r = await hq.money.apply({ type: 'log-line', text: q, from: 'palette' });
        if (!r || r.error) { say(r && r.error ? String(r.error) : 'no answer from the app'); return; }   // the line stays, to be fixed
        $('q').value = '';
        filter();
        say(r.note || 'logged', 'green');
      } catch (e) { say(errText(e)); }
      finally { busy = false; }
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
        if (s.spend) {   // the Log a spend row (money-quicklog)
          r.appendChild(mk('ic', '₫'));
          r.appendChild(mk('nm', spendText(spend, $('q').value)));
          r.appendChild(mk('meta faint', 'money'));
          r.title = 'enter → log it in Money';
          r.onclick = () => { sel = i; draw(); cast(); };
          L.appendChild(r);
          return;
        }
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
      if (s.spend) { logSpend(); return; }
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
