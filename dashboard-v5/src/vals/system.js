// System render values: machine issues and vitals, workspace clutter.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).

export function systemVals(ctx) {
  const { S, H, LIVE, sub, ro } = ctx;
  // ---- system ----
  const llm = LIVE.llm, llmIssue = llm && (!llm.available || !llm.chatModel) ? [{ id: 'llm', title: llm.available ? 'No local chat model installed' : 'Local model runtime is not running', why: 'Commit drafts fall back to Claude, which uses quota; Ask can’t answer.', fix: llm.available ? 'Pull a chat model with Ollama' : 'Start Ollama', cmd: llm.available ? 'ollama pull qwen2.5:7b-instruct-q4_K_M' : 'ollama serve', safe: false }] : [];
  const issues = H.ISSUES.concat(llmIssue).filter((i) => !S.fixed.includes(i.id)).map((i) => ({ title: i.title, why: i.why, fix: i.fix, cmd: i.cmd || '—',
    run: async () => {
      if (ro()) return;
      if (!i.safe || !this.hq.healthFix) { this.copy(i.cmd, 'Copied · run it in a terminal (this fix isn’t on the safe list)'); return; }
      // safe-listed fixes can still delete things (%TEMP% purge): show the command, then run
      this.sheet({ act: 'fix', cmd: i.cmd, fixTitle: i.fix, title: i.fix + '?', body: 'Runs this PowerShell command now:\n\n' + i.cmd, ok: 'Run fix', danger: /Remove-Item|-Force|\bdel\b|\brm\b|Stop-Process/i.test(i.cmd) });
    },
    copy: () => this.copy(i.cmd, 'Copied · ' + i.cmd) }));
  const vitals = H.VITALS.map((v) => ({ k: v[0], v: v[1], color: v[2] === 'ok' ? 'var(--green)' : v[2] === 'warn' ? 'var(--orange)' : v[2] === 'bad' ? 'var(--red)' : 'var(--faint)' }));
  if (LIVE.machine) vitals.unshift({ k: 'Now', v: 'CPU ' + Math.round(LIVE.machine.cpu) + '% · RAM ' + Math.round(LIVE.machine.ram) + '%', color: 'var(--blue)' });
  const clutter = H.CLUTTER.filter((c) => !S.fixed.includes(c.id)).map((c) => ({ title: c.title, detail: c.detail, verb: c.verb, danger: c.danger, safe: !c.danger, act: () => { if (!this.hq) return this.denied(); this.call(() => this.hq.openRepo('.'), 'Couldn’t open Documents'); this.toast('info', 'Opened Documents · ' + c.detail, { ms: 6000 }); } }));
  const verdictBad = issues.length > 0;
  return {
    isMachine: sub === 'machine', isClutter: sub === 'clutter', issues, hasIssues: issues.length > 0, verdict: verdictBad ? issues.length + ' issue' + (issues.length > 1 ? 's' : '') + ' to look at' : 'Machine OK', verdictColor: verdictBad ? 'var(--orange)' : 'var(--green)', verdictHex: verdictBad ? '#e0a35a' : '#86b98a',
    verdictSub: (H.pcScannedAt ? 'Checked ' + new Date(Date.parse(H.pcScannedAt)).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' with the scan' : 'No machine check yet') + ' · drag the monitor to spin it',
    vitals, clutter, hasClutter: clutter.length > 0, noClutter: clutter.length === 0,
  };
}
