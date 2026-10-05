// Mini HUD (dashboard/mini.html) — v5 clean pass S4. Was mini.html's inline
// script; it lives here so the page can carry v5's CSP (script-src 'self').
// Satellites design: next action · ⚿ secrets / ● uncommitted / ↑ unpushed as
// buttons that deep-link the main window (hq.openAt) · lv · xp · the spell row,
// vitals and kill-servers stay.
// Payload: hq:mini-data / push hq:mini-update (main.js miniPayload). The counts
// and topQuest.projectId are K-6 additions (IPC-CONTRACT "Pending — v5 clean
// pass"): until main sends them a count reads "—" (never a made-up 0) and the
// next action opens the main window the old way.
// Pure helpers are exported for dashboard/mini-cast.test.mjs (same shell as
// satellite-theme.js); the DOM half only runs in a page.
(function (root) {
  'use strict';

  // nav-bridge.js validates these again (tab/sub /^[a-z]{2,16}$/, sort enum)
  const COUNT_ROUTES = {
    secrets: { tab: 'tasks', sub: 'ideas' },
    uncommitted: { tab: 'projects', sort: 'dirty' },
    unpushed: { tab: 'projects' },
  };
  const COUNT_WORDS = {
    secrets: ['secret finding', 'secret findings', 'Tasks › Ideas & risks'],
    uncommitted: ['uncommitted change', 'uncommitted changes', 'Projects, most uncommitted first'],
    unpushed: ['unpushed', 'unpushed', 'Projects'],
  };
  const PROJECT_ID_RE = /^[\w.-]{1,80}$/;   // same rule as nav-bridge.js

  function countRoute(kind) {
    const r = COUNT_ROUTES[kind];
    return r ? Object.assign({}, r) : null;
  }
  // the project the next action belongs to, or null (absent / not a valid id → caller opens the main window plainly)
  function nextActionRoute(quest) {
    const id = quest && typeof quest === 'object' ? quest.projectId : null;
    return typeof id === 'string' && PROJECT_ID_RE.test(id) ? { tab: 'projects', projectId: id } : null;
  }
  // a count the payload really carries, else null — absent/garbage renders "—", never 0
  function countOf(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  }
  function countText(v) {
    const n = countOf(v);
    return n == null ? '—' : String(n);
  }
  // design colours: secrets red, uncommitted/unpushed orange; zero and unknown stay quiet
  function countTone(kind, v) {
    const n = countOf(v);
    if (!n) return 'quiet';
    return kind === 'secrets' ? 'red' : 'orange';
  }
  function countTitle(kind, v) {
    const w = COUNT_WORDS[kind];
    if (!w) return '';
    const n = countOf(v);
    const what = n == null ? `${w[1]}: not reported by this app build` : `${n} ${n === 1 ? w[0] : w[1]}`;
    return `${what} — open ${w[2]}`;
  }
  function levelText(d) {
    if (!d || typeof d !== 'object') return 'lv – · – xp';
    const lv = Number.isFinite(d.level) ? d.level : '–';
    const xp = Number.isFinite(d.xp) ? d.xp : '–';
    return `lv ${lv} · ${xp} xp`;
  }
  function levelTitle(d) {
    if (!d || typeof d !== 'object') return '';
    const parts = [];
    if (Number.isFinite(d.xpToNext) && d.xpToNext > 0 && Number.isFinite(d.level)) parts.push(`${d.xpToNext} xp to lv ${d.level + 1}`);
    else if (d.xpToNext === 0 || d.xpToNext === null) parts.push('max level');
    if (Number.isFinite(d.streak)) parts.push(`${d.streak}-day scan streak`);
    return parts.join(' · ');
  }
  function tierTone(tier) {
    return tier === 'red' || tier === 'orange' || tier === 'yellow' ? tier : 'quiet';
  }
  const clampPct = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0);
  function errText(e) {
    if (!e) return 'unknown error';
    const m = typeof e === 'string' ? e : e.message || String(e);
    return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 160);
  }

  const api = { countRoute, nextActionRoute, countOf, countText, countTone, countTitle, levelText, levelTitle, tierTone, clampPct, errText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) boot(root.document, root.hq);

  function boot(doc, hq) {
    const $ = (id) => doc.getElementById(id);
    const has = (name) => !!(hq && typeof hq[name] === 'function');
    let quest = null, noteTimer = null;

    function note(text, tone) {
      const n = $('note');
      n.textContent = text;
      n.className = 'note ' + (tone || '');
      n.hidden = false;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => { n.hidden = true; }, 6000);
    }
    function showMain() {
      if (!has('showMain')) return;
      Promise.resolve(hq.showMain()).catch((e) => note('could not open WorkspaceHQ: ' + errText(e), 'red'));
    }
    // deep link when we can; a refused/absent openAt still opens the window
    function go(route) {
      if (!route || !has('openAt')) return showMain();
      Promise.resolve(hq.openAt(route)).then((ok) => { if (ok === false) showMain(); }, () => showMain());
    }

    function paint(d) {
      if (!d) {
        quest = null;
        $('qdot').className = 'dot quiet';
        $('qtitle').textContent = 'No scan data — run a scan';
        $('quest').title = 'Open WorkspaceHQ';
        $('qxp').textContent = '';
        paintCounts({});
        $('lv').textContent = levelText(null);
        paintSpells(null);
        return;
      }
      quest = d.topQuest || null;
      if (quest) {
        $('qdot').className = 'dot ' + tierTone(quest.tier);
        $('qtitle').textContent = quest.title || '(untitled quest)';
        const where = nextActionRoute(quest) ? 'open ' + (quest.project || quest.projectId) + ' in Projects' : 'open WorkspaceHQ';
        $('quest').title = (quest.tier ? quest.tier + ' · ' : '') + where;
        $('qxp').textContent = Number.isFinite(quest.xp) ? '+' + quest.xp + ' xp' : '';
      } else {
        $('qdot').className = 'dot green';
        $('qtitle').textContent = 'All quests clear ✓';
        $('quest').title = 'Open WorkspaceHQ';
        $('qxp').textContent = '';
      }
      paintCounts(d);
      $('lv').textContent = levelText(d);
      $('lv').title = levelTitle(d);
      const hp = $('hp');
      hp.textContent = Number.isFinite(d.hp) ? String(d.hp) : '–';
      hp.className = !Number.isFinite(d.hp) ? '' : d.hp < 40 ? 'red' : d.hp < 70 ? 'orange' : 'green';
      paintSpells(d.spells);
    }
    function paintCounts(d) {
      for (const kind of ['secrets', 'uncommitted', 'unpushed']) {
        const b = $('c-' + kind);
        b.querySelector('b').textContent = countText(d[kind]);
        b.className = 'cnt ' + countTone(kind, d[kind]);
        b.title = countTitle(kind, d[kind]);
        b.setAttribute('aria-label', b.title);
      }
    }

    // top-3 spell shortcuts: one click casts; a spell that still needs its
    // dry-run confirm opens the main window (the confirm lives there)
    function paintSpells(list) {
      const box = $('spells');
      box.textContent = '';
      if (!Array.isArray(list) || !list.length) { box.hidden = true; return; }
      box.hidden = false;
      for (const sp of list) {
        if (!sp || sp.id == null) continue;
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'spell';
        b.dataset.id = sp.id;
        b.title = 'Run ' + (sp.name || sp.id);
        // names/icons come from third-party skill frontmatter — textContent only
        const si = doc.createElement('span'); si.className = 'si'; si.textContent = sp.icon || '✴️';
        const sn = doc.createElement('span'); sn.className = 'sn'; sn.textContent = sp.name || sp.id;
        b.append(si, sn);
        b.onclick = (e) => { e.stopPropagation(); cast(sp, b); };
        box.appendChild(b);
      }
    }
    async function cast(sp, b) {
      if (!has('castSpell')) { note('running spells is not available in this window', 'red'); return; }
      const name = sp.name || sp.id;
      b.classList.add('busy');
      let res;
      try { res = await hq.castSpell(sp.id, undefined, { notify: true }); }
      catch (e) { res = { error: errText(e) }; }
      if (res && res.castId) return;   // running — onCastDone settles the chip
      b.classList.remove('busy');
      if (!res) note(name + ': no answer from the app', 'red');
      else if (res.confirm_required) { note(name + ' needs a run confirm — opening WorkspaceHQ'); showMain(); }
      else if (res.error) note(name + ': ' + res.error, 'red');
      else if (res.channeled) note(name + ' opened in a terminal');
    }
    function flash(b, glyph) {
      const si = b.querySelector('.si');
      if (!si) return;
      if (!b.dataset.icon) b.dataset.icon = si.textContent;
      si.textContent = glyph;
      setTimeout(() => { si.textContent = b.dataset.icon; }, 4000);
    }
    if (has('onCastDone')) hq.onCastDone((d) => {
      if (!d) return;
      for (const b of doc.querySelectorAll('.spell')) {
        if (b.dataset.id !== d.spellId) continue;
        b.classList.remove('busy');
        const ok = d.outcome === 'resolved';
        flash(b, ok ? '✓' : '✗');
        if (!ok) note((d.name || d.spellId) + ' failed' + (d.timed_out ? ' (timed out)' : Number.isFinite(d.exit_code) ? ' (exit ' + d.exit_code + ')' : ''), 'red');
      }
    });

    function paintMac(m) {
      if (!m) return;
      const bar = (k, v) => {
        $(k).textContent = Number.isFinite(v) ? v + '%' : '–';
        $(k + 'fill').style.width = clampPct(v) + '%';
        $(k + 'fill').className = v > 85 ? 'hot' : '';
      };
      bar('cpu', m.cpu);
      bar('ram', m.ram);
      const k = $('killsrv');
      if (m.servers > 0) {
        k.hidden = false;
        $('srvn').textContent = m.servers;
        k.title = 'Stop ' + m.servers + ' running dev server' + (m.servers === 1 ? '' : 's');
      } else k.hidden = true;
    }

    $('quest').onclick = () => { const r = nextActionRoute(quest); if (r) go(r); else showMain(); };
    for (const kind of ['secrets', 'uncommitted', 'unpushed']) $('c-' + kind).onclick = (e) => { e.stopPropagation(); go(countRoute(kind)); };
    $('close').onclick = (e) => { e.stopPropagation(); if (has('miniHide')) hq.miniHide(); };
    $('killsrv').onclick = async (e) => {
      e.stopPropagation();
      if (!has('killServers')) return;
      try { const n = await hq.killServers(); note('stopped ' + n + ' dev server' + (n === 1 ? '' : 's')); }
      catch (err) { note('could not stop the dev servers: ' + errText(err), 'red'); }
    };
    if (has('onMiniUpdate')) hq.onMiniUpdate(paint);
    if (has('onMachine')) hq.onMachine(paintMac);
    if (has('getMiniData')) {
      Promise.resolve(hq.getMiniData()).then(paint, (e) => {
        paint(null);
        $('qtitle').textContent = 'HUD data unavailable: ' + errText(e);
      });
    } else paint(null);
  }
})(typeof window !== 'undefined' ? window : null);
