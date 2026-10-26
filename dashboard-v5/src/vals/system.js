// System render values: machine issues and vitals, workspace clutter.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).
import { SCAN_TIP, SCAN_OFF, OPEN_OFF, machineIssues } from '../logic/system.js';
import { hubCard } from '../logic/claude-hub.js';

// a clutter group lists at most this many items; the rest is counted, not hidden silently
const CLUTTER_ROWS = 12;

export function systemVals(ctx) {
  const { S, H, LIVE, sub, ro } = ctx;
  const fixed = S.fixed || [];
  // ---- system ----
  const all = machineIssues(H.ISSUES, LIVE.llm);
  const issues = all.filter((i) => !fixed.includes(i.id)).map((i) => ({ title: i.title, why: i.why, fix: i.fix, cmd: i.cmd || '—',
    run: async () => {
      if (ro()) return;
      if (!i.safe || !this.hq.healthFix) { this.copy(i.cmd, 'Copied · run it in a terminal (this fix isn’t on the safe list)'); return; }
      // safe-listed fixes can still delete things (%TEMP% purge): show the command, then run.
      // issueId: an ok:true answer hides this issue until Re-examine (logic/sheet.js sheetOk
      // calls logic/system.js markFixed with it)
      this.sheet({ act: 'fix', cmd: i.cmd, fixTitle: i.fix, issueId: i.id, title: i.fix + '?', body: 'Runs this PowerShell command now:\n\n' + i.cmd, ok: 'Run fix', danger: /Remove-Item|-Force|\bdel\b|\brm\b|Stop-Process/i.test(i.cmd) });
    },
    copy: () => this.copy(i.cmd, 'Copied · ' + i.cmd) }));
  // fixes that ran this session; their issues stay hidden until a Re-examine confirms
  const fixedN = all.filter((i) => fixed.includes(i.id)).length;
  const vitals = H.VITALS.map((v) => ({ k: v[0], v: v[1], color: v[2] === 'ok' ? 'var(--green)' : v[2] === 'warn' ? 'var(--orange)' : v[2] === 'bad' ? 'var(--red)' : 'var(--faint)' }));
  if (LIVE.machine) vitals.unshift({ k: 'Now', v: 'CPU ' + Math.round(LIVE.machine.cpu) + '% · RAM ' + Math.round(LIVE.machine.ram) + '%', color: 'var(--blue)' });
  const clutter = H.CLUTTER.filter((c) => !fixed.includes(c.id)).map((c) => {
    const rows = c.rows || [];
    return { title: c.title, detail: c.detail, verb: c.verb, danger: c.danger, safe: !c.danger, act: async () => {
      if (!this.hq) return this.denied();
      // shell.openPath answers '' on success and an error string on failure; main answers false when it refuses
      const r = await this.call(() => this.hq.openRepo('.'), 'Couldn’t open Documents');
      if (r === null) return;
      if (r === false || (typeof r === 'string' && r)) return this.toast('error', 'Couldn’t open Documents' + (typeof r === 'string' ? ' · ' + r : ''));
      this.toast('info', 'Opened Documents · ' + c.detail, { ms: 6000 });
    },
    // one row per item, each with v3's "Note for cleanup" (hq.captureSave('Clean up: …'))
    items: rows.slice(0, CLUTTER_ROWS).map((it) => {
      const text = 'Clean up: ' + it.label, b = this.saveButton(text, 'Note for cleanup', 'Adds “' + text + '” to your ideas — the dashboard will refresh');
      return { label: it.label, note: it.note || '', hasNote: !!it.note, btn: b.btn, off: b.off, tip: b.tip, save: () => this.saveIdea(text, 'Noting for cleanup') };
    }),
    hasItems: rows.length > 0, more: rows.length > CLUTTER_ROWS ? '+' + (rows.length - CLUTTER_ROWS) + ' more not listed' : '', hasMore: rows.length > CLUTTER_ROWS };
  });
  const verdictBad = issues.length > 0;
  const fresh = !!LIVE.pcHealth, examining = !!S.sysExamining, canScan = this.canHealthScan();
  // no pc-health sidecar and nothing flagged: unknown, not "OK" (a Re-examine this session is a check);
  // fixes ran but nothing re-checked: not "OK" either
  const unchecked = !verdictBad && !H.pcScannedAt && !fresh;
  const unconfirmed = !verdictBad && fixedN > 0;
  const when = H.pcScannedAt ? new Date(Date.parse(H.pcScannedAt)).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const hub = hubCard(LIVE.claudeHub, !!this.hq);
  // ---- machine detail panels (pc-health `detail` + `trends`; empty on an older sidecar) ----
  const D = H.MACHINE || {}, list = (x) => (Array.isArray(x) ? x : []);
  const tone = (bad) => (bad ? 'var(--orange)' : 'var(--text)');
  const canOpen = !!(this.hq && this.hq.pcOpenFolder);
  const disk = list(D.disk).map((r) => ({ ...r, open: () => this.openPcFolder(r.path), copy: () => this.copy(r.path, 'Copied · ' + r.path) }));
  const diskWhen = D.diskAt ? new Date(Date.parse(D.diskAt)).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const diskNote = [diskWhen ? 'Measured ' + diskWhen : '', 'your profile and AppData\\Local, folders over 0.25 GB',
    D.diskPartial ? 'stopped at the time limit, so a few folders may be missing' : '',
    D.recycleGB != null ? 'Recycle Bin ' + D.recycleGB + ' GB' : ''].filter(Boolean).join(' · ');
  return {
    isMachine: sub === 'machine', isClutter: sub === 'clutter', issues, hasIssues: issues.length > 0,
    verdict: verdictBad ? issues.length + ' issue' + (issues.length > 1 ? 's' : '') + ' to look at' : unconfirmed ? 'Fixes ran · not re-checked yet' : unchecked ? 'Not checked yet' : 'Machine OK',
    verdictColor: verdictBad ? 'var(--orange)' : unconfirmed ? 'var(--blue)' : unchecked ? 'var(--muted)' : 'var(--green)', verdictHex: verdictBad ? '#e0a35a' : unconfirmed ? '#7aa2d6' : unchecked ? '#a39d92' : '#86b98a',
    verdictSub: (fresh ? 'Re-examined ' + (when || 'this session') : H.pcScannedAt ? 'Checked ' + when + ' with the scan' : 'No machine check yet') + ' · drag the monitor to spin it',
    // Re-examine (v3 Med-Bay): hq.healthScan(), no reload
    sysScan: () => this.reexamine(), sysScanLabel: examining ? 'Scanning…' : 'Re-examine', sysScanOff: examining || !canScan, sysScanTip: canScan ? SCAN_TIP : SCAN_OFF,
    hasFixed: fixedN > 0, fixedNote: fixedN + ' fixed this session · Re-examine to confirm',
    vitals, clutter, hasClutter: clutter.length > 0, noClutter: clutter.length === 0,
    mdRam: list(D.ram), mdCpu: list(D.cpu), mdHasRam: list(D.ram).length > 0, mdHasCpu: list(D.cpu).length > 0, mdHasNow: list(D.ram).length + list(D.cpu).length > 0,
    mdDisk: disk, mdHasDisk: disk.length > 0, mdDiskNote: diskNote, mdCanOpen: canOpen, mdOpenTip: canOpen ? 'Open this folder in Explorer' : OPEN_OFF,
    mdGpus: list(D.gpus), mdHasGpus: list(D.gpus).length > 0, mdLive: list(D.live).map((c) => ({ ...c, color: tone(c.warn) })), mdHasLive: list(D.live).length > 0,
    mdFacts: list(D.facts).map((c) => ({ ...c, color: tone(c.warn) })), mdHasFacts: list(D.facts).length > 0,
    mdStorage: list(D.storage).map((s) => ({ ...s, color: s.ok ? 'var(--green)' : 'var(--orange)' })), mdHasStorage: list(D.storage).length > 0,
    mdTrends: list(D.trends).map((t) => ({ ...t, color: t.bad ? 'var(--orange)' : 'var(--muted)' })), mdHasTrends: list(D.trends).length > 0,
    mdStartup: list(D.startup).join(' · '), mdHasStartup: list(D.startup).length > 0,
    mdUnreadable: list(D.unreadable).join(' · '), mdHasUnreadable: list(D.unreadable).length > 0,
    hubShow: hub.show, hubState: hub.state, hubColor: hub.color, hubDetail: hub.detail, hubSize: hub.size, hubHasSize: !!hub.size, hubBar: hub.bar, hubBarW: hub.barW,
  };
}
