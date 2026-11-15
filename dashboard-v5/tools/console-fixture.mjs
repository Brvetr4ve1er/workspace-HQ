// Console layer (batch 7) -- the invented project list the Shelf gates run on (selftest states, the cdp scenarios, the fake preload's
// hqFake.shelfProjects()). Every name is made up, every path is the placeholder 'C:/placeholder/...', and the data is deterministic: a
// local counter, no Math.random, no clock, so two calls agree and a test can compute what the screen should say.
//
// fakeShelfProjects(opts) is ONE self-contained function: no imports, no module scope, no globals beyond Math/String/Number/Array.
// That is what lets tools/console-fixture-paste.mjs paste Function.prototype.toString() of it into the sandboxed fake preload (which
// cannot require files; see the MONEY note in fake-preload.js). Keep it that way: console-fixture.test.mjs scans the source.
//
// It returns scan-shaped projects (the latest.json `projects[]` shape that src/live/adapter.mjs toProject() reads, like
// src/live/__fixtures__/synthetic.mjs proj()), so the app's own statusOf() / reasonOf() run on them for real. Status cycles
// ok, care, risk, idle with the index (i % 4 = 0, 1, 2, 3), so any count has every status and the expected counts are arithmetic.
//
// Options (all optional):
//   count   projects to make (default 83: the named budget in cdp-shelf.mjs); a non-number or a negative reads as the default / 0
//   describe:true   returns the tables instead: { defaultCount, cycle, stacks, namePattern, statusCounts(n) }
//
// Why no colour field: the Shelf takes its colour from the row's status token (the scan has no colour of a project's own), so a
// palette here would be dropped by the adapter. The four statuses ARE the palette.
export function fakeShelfProjects(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const DEFAULT = 83;
  const CYCLE = ['ok', 'care', 'risk', 'idle'];
  const STACKS = [['Node'], ['Python'], ['Rust'], ['Static']];
  const A = ['Ka', 'Mel', 'Tor', 'Bri', 'Sal', 'Vex', 'Lum', 'Nor', 'Quin', 'Dar', 'Fen', 'Zor'];
  const B = ['dor', 'ia', 'vik', 'mar', 'len', 'tis', 'ox', 'ara', 'bel', 'sun'];
  const pad = (v, w) => String(v).padStart(w, '0');
  if (o.describe) {
    return {
      defaultCount: DEFAULT, cycle: CYCLE.slice(), stacks: STACKS.map((s) => s.slice()), namePattern: '^(Placeholder|[A-Z][a-z]{3,9}) [0-9]{2,3}$',
      statusCounts: (n) => { const c = { ok: 0, care: 0, risk: 0, idle: 0 }; for (let i = 0; i < n; i++) c[CYCLE[i % 4]]++; return c; },
    };
  }
  const raw = o.count == null ? DEFAULT : Math.floor(Number(o.count));
  const n = Number.isFinite(raw) ? Math.max(0, Math.min(raw, 2000)) : DEFAULT;
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = i + 1, st = CYCLE[i % 4], w = k < 100 ? 2 : 3;
    const name = (k % 10 === 0 ? 'Placeholder' : A[(i * 5) % A.length] + B[(i * 3 + 1) % B.length]) + ' ' + pad(k, w);
    const id = 'ph-' + pad(k, 3);
    out.push({
      id, name, path: 'C:/placeholder/' + id, stack: STACKS[(i * 3) % 4].slice(), dev_cmd: null, canonical_branch: 'main',
      completion: { pct: (i * 37) % 100, basis: 'heuristic' }, level: 1 + (i % 5), xp: 100 + (i % 7) * 10,
      activity: { state: st === 'care' ? 'stale' : st === 'idle' ? 'dormant' : 'active', days_since_commit: st === 'care' ? 30 + (i % 9) : st === 'idle' ? 120 + (i % 30) : (i % 6) },
      metrics: {
        git_safety: { has_git: true, has_remote: true, remote: 'example.test/placeholder/' + id, branch: 'main', commits: 5 + (i % 40), dirty: st === 'risk' ? 1 + (i % 12) : 0, ahead: 0, behind: 0, last_commit_subject: 'chore: placeholder change' },
        code_health: { build: 'unknown', tests: { present: true, count: 2 }, files: 20 + (i % 30), loc: 900 + i * 13, recent_files: ['a.js'] },
        risk_security: st === 'risk'
          ? { secrets_found: 1, flags: [{ type: 'secret', severity: 'high', detail: 'Likely placeholder key', location: '.env:1' }] }
          : { secrets_found: 0, flags: [] },
      },
      disk: { reclaimable_bytes: 0 },
    });
  }
  return out;
}
