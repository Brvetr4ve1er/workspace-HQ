// agency.mjs — PURE: turns a scan's signal gaps into proposals the UI can act on.
// No imports, no DOM, no Date.now() (same firewall as derive.mjs/foresight.mjs).
//
// A gap is ONLY an explicit `false`. A missing signal means "the scanner didn't
// determine it", which is not the same as "the project lacks it" — proposing
// work off an absent field would invent problems.
const GAPS = [
  { flag: 'has_tests',   gap: 'tests',   label: 'No tests',
    seed: 'Add a test suite to this project and make it pass.',
    capture: 'add a test suite' },
  { flag: 'has_ci',      gap: 'ci',      label: 'No CI',
    seed: 'Set up CI for this project so tests run on every push.',
    capture: 'set up CI' },
  { flag: 'has_readme',  gap: 'readme',  label: 'No README',
    seed: 'Write a README for this project: what it is, how to run it, how to deploy it.',
    capture: 'write a README' },
  { flag: 'has_license', gap: 'license', label: 'No license',
    seed: 'Add an appropriate open-source LICENSE file to this project.',
    capture: 'add a LICENSE' },
];

export function agencyProposals(selected) {
  const out = [];
  for (const p of (selected?.projects || [])) {
    // no path -> hq:claude-quest cannot resolve a cwd, so the row would be inert
    if (!p?.path) continue;
    const sig = p.signals || {};
    for (const g of GAPS) {
      if (sig[g.flag] !== false) continue;
      out.push({
        projectId: p.id,
        projectName: p.name,
        projectPath: p.path,
        gap: g.gap,
        label: g.label,
        seedPrompt: g.seed,
        captureText: `${p.name}: ${g.capture}`,
      });
    }
  }
  return out;
}
