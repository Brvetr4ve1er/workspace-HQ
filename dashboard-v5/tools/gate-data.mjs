// gate-data: an INVENTED window.DATA for the gate's two Electron steps (the selftest and the cdp scenarios).
// dev-main.js loads this file in place of ../dashboard/data.js when HQ_V5_DATA_FILE names it, so a scan landing
// in the owner's running app (which rebakes the real data.js) can never change what a gate run sees.
// Built only from the placeholder builders in src/live/__fixtures__/synthetic.mjs: "Project A" at C:/dev/a, never a real name.
//
//   gateData()          -> the DATA object (scans oldest to newest, spellbook, telemetry, pcHealth)
//   writeGateData(path) -> writes `window.DATA = <json>;` to path (a throwaway profile folder, never data/)
import fs from 'node:fs';
import { proj, scan, spell, spellbook, telemetry, organ, pcHealth } from '../src/live/__fixtures__/synthetic.mjs';

export const GATE_SCAN_DATES = Object.freeze(['2026-10-01', '2026-10-02', '2026-10-03']);

export function gateData() {
  const projects = () => [
    proj('a', { dev: 'npm run dev', pct: 70, commits: 40 }),
    proj('b', { dev: null, pct: 40, gitFlags: ['no-remote-branch'], suggestions: [{ id: 'gap-b-1', title: 'Add a test', kind: 'gap' }] }),
    proj('c', { secrets: 1, pct: 55, dirty: 3 }),
    proj('d', { git: false, pct: 20, state: 'dormant', days: 40 }),
  ];
  const q = (id, project, o = {}) => ({ project_id: project, status: o.status ?? 'open', created: GATE_SCAN_DATES[0], age_days: o.age ?? 2, id: 'q-' + project + '-' + id, title: o.title, tier: o.tier ?? 'yellow', xp: o.xp ?? 50, insight: o.title + '.', evidence: {}, ...(o.status === 'done' ? { completed: GATE_SCAN_DATES[1] } : {}) });
  const quests = () => [
    q('secret', 'c', { title: 'Move the placeholder key out of the project files', tier: 'red', xp: 100, age: 5 }),
    q('tests', 'b', { title: 'Add a first placeholder test', tier: 'yellow' }),
    q('readme', 'a', { title: 'Write the placeholder readme', tier: 'green', xp: 25 }),
    q('git', 'd', { title: 'Put the placeholder project under version control', status: 'done', tier: 'red', xp: 100 }),
  ];
  const scans = GATE_SCAN_DATES.map((d, i) => scan(d, projects(), { xp: 300 + i * 50, changes: [], quests: quests() }));
  const spells = [
    spell('grimoire:scan', { name: 'Deep scan', source: 'grimoire', icon: '◎' }),
    spell('script:tidy', { name: 'Tidy notes', source: 'script', kind: 'castable', command: 'node', args: ['tidy.js'] }),
    spell('script:wipe', { name: 'Wipe cache', source: 'script', kind: 'castable', command: 'node', args: ['wipe.js'], confirm: true }),
    spell('skill:review', { name: 'Review', kind: 'channeled', source: 'skill', command: 'claude', args: ['/review'] }),
  ];
  return {
    scans,
    latest: scans[scans.length - 1],
    spellbook: spellbook(spells),
    telemetry: telemetry([]),
    pcHealth: pcHealth([organ('cpu', { status: 'grace' }), organ('disk', { label: 'Storage', status: 'grace' })], { at: GATE_SCAN_DATES[2] + 'T03:00:00Z' }),
    weeklyRecap: { week_start: '2026-09-26', week_end: '2026-10-03', generated_at: GATE_SCAN_DATES[2] + 'T03:05:00Z', ai_narrative: false, narrative_md: '## Week recap - placeholder week.', stats: { xp_gain: 100, level_start: 3, level_end: 3, health_delta: 1, quests_completed: 1, achievements_unlocked: 0 }, spellcraft: { casts: 0, resolved: 0, fizzled: 0, distinct_spells: 0, spells_known_start: 4, spells_known_end: 4 } },
    gate_fixture: true,   // the boot scenario reads this to prove the page is on invented data
    built_at: GATE_SCAN_DATES[2] + 'T03:05:00Z',
  };
}

export function writeGateData(file) {
  fs.writeFileSync(file, 'window.DATA = ' + JSON.stringify(gateData()) + ';\n');
  return file;
}
