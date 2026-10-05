// Summon palette (Ctrl+Alt+G / tray › Summon…). Moved out of summon.html's
// inline <script> so the page can carry v5's CSP (script-src 'self').
// Bridge (summon-preload.js): hq.shardSummon(text) · hq.shardSummonCancel().
// Theme is ../satellite-theme.js (loaded first by summon.html), not this file.
// Behaviour is unchanged: Enter summons (main closes the palette and routes the
// text: note / timer / quest / hp / lib / a saved creation / conjure), Esc cancels,
// a click away closes it (main's blur handler).
(function () {
  'use strict';
  const inp = document.getElementById('in');
  const hq = window.hq || {};
  inp.focus();
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inp.value.trim()) { if (hq.shardSummon) hq.shardSummon(inp.value); }
    else if (e.key === 'Escape') { if (hq.shardSummonCancel) hq.shardSummonCancel(); }
  });
  window.addEventListener('DOMContentLoaded', () => inp.focus());
})();
