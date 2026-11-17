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
  const scans = GATE_SCAN_DATES.map((d, i) => scan(d, projects(), { xp: 300 + i * 50, changes: [] }));
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
    gate_fixture: true,   // the boot scenario reads this to prove the page is on invented data
    built_at: GATE_SCAN_DATES[2] + 'T03:05:00Z',
  };
}

export function writeGateData(file) {
  fs.writeFileSync(file, 'window.DATA = ' + JSON.stringify(gateData()) + ';\n');
  return file;
}
