// Summon palette (Ctrl+Alt+G / tray › Summon…). Moved out of summon.html's
// inline <script> so the page can carry v5's CSP (script-src 'self').
// Bridge (summon-preload.js): hq.shardSummon(text) · hq.shardSummonCancel().
// Theme is ../satellite-theme.js (loaded first by summon.html), not this file.
// Enter summons. Main routes the text (note / timer / quest / hp / lib / a saved
// creation / conjure) and ANSWERS before it closes anything (IPC-CONTRACT
// hq:shard-summon): a shard id string = spawned, main closes the palette;
// { ok:false, message } = a built-in with nothing to show ('quest' with no open
// quest, 'quest' / 'hp' before any scan) — the palette stays open and says so in
// its footer (#msg replaces the hint) until the text changes. Esc cancels; a
// click away closes it (main's blur handler).
(function () {
  'use strict';
  const inp = document.getElementById('in');
  const hint = document.getElementById('hint');
  const msg = document.getElementById('msg');   // a live region that stays rendered, so the answer is announced
  const hq = window.hq || {};
  let busy = false, done = false;

  function say(text) {
    if (msg) msg.textContent = text;
    if (hint) hint.hidden = true;
  }
  function unsay() {
    if (msg && msg.textContent) msg.textContent = '';
    if (hint) hint.hidden = false;
  }
  async function summon(text) {
    if (busy || done) return;
    if (!hq.shardSummon) { say('Summon isn’t wired in this window'); return; }
    busy = true;
    try {
      const r = await hq.shardSummon(text);
      if (typeof r === 'string') { done = true; return; }   // spawned: main is closing the palette
      say(r && typeof r === 'object' && typeof r.message === 'string' && r.message ? r.message : 'Nothing to summon for that');
    } catch {
      say('Couldn’t summon that — the app didn’t answer');
    } finally {
      busy = false;
      if (!done) inp.focus();
    }
  }

  inp.focus();
  inp.addEventListener('input', unsay);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { if (!e.repeat && inp.value.trim()) summon(inp.value); }   // a held Enter summons once
    else if (e.key === 'Escape') { if (hq.shardSummonCancel) hq.shardSummonCancel(); }
  });
  window.addEventListener('DOMContentLoaded', () => inp.focus());
})();
