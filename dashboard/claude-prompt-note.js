'use strict';
// Prompt note {{variables}} (spec 2026-10-15 §6.1) — pure, no I/O. Only the variable-parsing half is live:
// the Hub store reads a prompt note's variables through it (store.mjs docRow). The slug/note-writing and
// P3 run-fill halves went with the prompt library (P1–P3, removed 2026-10-28) — restore the full module
// from tag cleanup-base-2026-10-28.
// Shared by the Electron main (require) and the Claude Hub (ESM default import of this CommonJS module).

const VARS_MAX = 20;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]{0,39})\s*\}\}/g;

function variablesOf(meta, body) {
  const out = [];
  const add = (v) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (NAME_RE.test(t) && !out.includes(t) && out.length < VARS_MAX) out.push(t);
  };
  const fm = meta && typeof meta === 'object' ? meta.variables : null;
  if (Array.isArray(fm)) fm.forEach(add);
  else if (typeof fm === 'string') fm.split(',').forEach(add);
  for (const m of String(body == null ? '' : body).matchAll(VAR_RE)) add(m[1]);
  return out;
}

module.exports = { VARS_MAX, VAR_RE, variablesOf };
