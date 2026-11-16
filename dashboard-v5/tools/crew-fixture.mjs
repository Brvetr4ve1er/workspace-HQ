// An INVENTED crew for the fake preload (Claude > Crew): fakeCrew({ count }) answers what hq.crew.read answers. Every name is made up
// (the repo is public). The function is SELF-CONTAINED on purpose: tools/crew-fixture-paste.mjs pastes its source into fake-preload.js
// (which is sandboxed and cannot require anything) and a test keeps the pasted copy equal to this one.
//   count  how many skills (default 24); past the 24 named ones, numbered placeholders fill the rest, spread over the roles
export function fakeCrew({ count = 24 } = {}) {
  const roles = [['developers', 'Developers'], ['designers', 'Designers'], ['marketing', 'Marketing'], ['finance', 'Finance'], ['legal', 'Legal'], ['operations', 'Operations'],
    ['sales', 'Sales'], ['people', 'People'], ['data', 'Data'], ['product', 'Product'], ['other', 'Other']].map((r) => ({ id: r[0], label: r[1] }));
  // [id, role, plugin, description]
  const named = [
    ['alpha-lint', 'developers', '', 'Lints a codebase and fixes the small things it finds.'],
    ['beta-review', 'developers', '', 'Reads a change and lists what to look at first.'],
    ['acme-tests:write-tests', 'developers', 'acme-tests', 'Writes the missing tests for a module.'],
    ['beta-palette', 'designers', '', 'Builds a colour palette and a type scale for a design.'],
    ['acme-design:mood-board', 'designers', 'acme-design', 'Collects a mood board for a visual design.'],
    ['gamma-newsletter', 'marketing', '', 'Writes the weekly newsletter for the shop.'],
    ['acme-seo:meta-check', 'marketing', 'acme-seo', 'Checks page titles and descriptions.'],
    ['gamma-ledger', 'finance', '', 'Reconciles a ledger against the bank lines.'],
    ['acme-ledger:month-close', 'finance', 'acme-ledger', 'Walks through closing the month.'],
    ['delta-clause', 'legal', '', 'Reads a contract and marks the clauses to ask about.'],
    ['delta-runbook', 'operations', '', 'Turns a checklist into a runbook.'],
    ['acme-ops:status-note', 'operations', 'acme-ops', 'Writes a short status note.'],
    ['epsilon-pipeline', 'sales', '', 'Sorts leads by what happens next.'],
    ['zeta-interview', 'people', '', 'Prepares questions for an interview.'],
    ['eta-chart', 'data', '', 'Draws a chart from a table of numbers.'],
    ['acme-data:query-help', 'data', 'acme-data', 'Helps write a query and explains the result.'],
    ['theta-roadmap', 'product', '', 'Drafts a roadmap from a list of ideas.'],
    ['iota-notes', 'other', '', 'Keeps small notes for later.'],
    ['kappa-translate', 'other', '', 'Translates a short text and keeps the tone.'],
    ['lambda-recipe', 'other', '', 'Scales a recipe for more people.'],
    ['mu-trip', 'other', '', 'Plans a day trip on a map.'],
    ['nu-reading', 'other', '', 'Summarises an article in five lines.'],
    ['xi-habits', 'other', '', 'Tracks a small daily habit.'],
    ['omicron-quiz', 'other', '', 'Makes a quiz from some notes.'],
  ];
  const n = Math.max(0, Math.min(5000, Math.floor(Number(count)) || 0));
  const skills = [];
  for (let i = 0; i < n; i++) {
    if (i < named.length) {
      const s = named[i];
      const folder = s[0].indexOf(':') >= 0 ? s[0].split(':')[1] : s[0];
      skills.push({ id: s[0], name: folder, description: s[3], role: s[1], plugin: s[2], canStart: true });
    } else {
      const k = i - named.length, num = String(k).padStart(4, '0');
      skills.push({ id: 'gen-skill-' + num, name: 'gen-skill-' + num, description: 'Generated skill number ' + num + ' for paging checks.', role: roles[k % roles.length].id, plugin: '', canStart: true });
    }
  }
  return { roles, skills, total: skills.length, generatedAt: '2026-11-16T09:00:00.000Z' };
}
