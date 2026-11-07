// Client delivery card render values (project page). Keys are dlv-prefixed — one shared namespace with every other surface.
// The view arrives finished from main (dashboard/delivery.js → hq:delivery:*; counts, milestones, link, update text);
// this module only shapes it. Honest states: no bridge · read failed (and no card held yet) · still loading · ready, and
// inside ready: not a client job · plan mode · client with a scope · client with no scope · a file problem · no link.
// A refused write never blanks a card already shown: a held view wins over a later read error.
const CAND_MAX = 12;
const pad = (s) => String(s == null ? '' : s);
const ago = (iso) => {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return 'age unknown';
  const d = Math.max(0, Date.now() - t), H = 3600e3;
  return d < H ? Math.max(1, Math.round(d / 60e3)) + ' min ago' : d < 24 * H ? Math.round(d / H) + ' h ago' : Math.floor(d / (24 * H)) + ' d ago';
};
const pct = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);
// the progress bar: a thin track (in the template) and this fill, token colours only
const fill = (done, total) => ({ width: pct(done, total) + '%', height: '100%', background: done >= total && total > 0 ? 'var(--green)' : 'var(--accent-text)', borderRadius: 3, transition: 'width .25s' });
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

export function deliveryVals(ctx) {
  const { S, LIVE } = ctx;
  const D = LIVE.delivery || {}, id = S.route && S.route.id;
  const v = id && D.byProject ? D.byProject[id] || null : null;
  const can = !!(this.hq && this.hq.delivery);
  const state = !can ? 'offline' : !v && D.error ? 'error' : !v ? 'loading' : 'ready';
  const ready = state === 'ready';
  const client = ready && !!v.client, plan = ready && v.mode === 'plan';
  const draft = S.dlv || {}, busy = !!S.dlvBusy;
  const cands = ready && Array.isArray(v.candidates) ? v.candidates : [];
  const fileBad = (client || plan) && v.source === 'file' && v.fileState && v.fileState !== 'ok';
  const readOnly = ready && v.source === 'file';
  const hasCounts = (client || plan) && !fileBad && v.total > 0;

  const milestones = hasCounts ? v.milestones.map((m, mi) => ({
    key: mi + ':' + m.name, name: m.name || 'General', countText: m.done + ' of ' + m.total, barStyle: fill(m.done, m.total),
    items: m.items.map((it, ii) => {
      const canToggle = !readOnly && !!it.id && !busy;
      return { key: (it.id || ii) + ':' + mi, text: it.text, mark: it.done ? '[x]' : '[ ]', done: it.done,
        textStyle: { color: it.done ? 'var(--muted)' : 'var(--text)', textDecoration: it.done ? 'line-through' : 'none', fontSize: 13, wordBreak: 'break-word', flex: 1, minWidth: 0 },
        canToggle, toggle: () => this.dlvToggle(it.id), canRemove: !readOnly && !!it.id, remove: () => this.dlvRemove(it.id),
        toggleLabel: (it.done ? 'Mark not done: ' : 'Mark done: ') + it.text, removeLabel: 'Remove: ' + it.text };
    }),
  })) : [];

  const candList = cands.slice(0, CAND_MAX).map((c) => {
    const picked = ready && v.scopeFile === c.rel;
    return { key: c.rel, rel: c.rel, meta: c.done + ' of ' + c.items + ' done', picked, pickLabel: picked ? 'In use' : client ? 'Use as scope' : 'Track as plan',
      pick: () => this.dlvPick(c.rel), pickOff: picked || busy };
  });
  const link = client ? v.link : null;
  const noScope = client && v.source === 'none';
  const scopeHint = 'SCOPE.md in the repo, ' + (cands.length ? 'one of the ' + cands.length + ' checklist files found, ' : '') + 'or a checklist here';

  return {
    dlvOffline: state === 'offline',
    dlvError: state === 'error', dlvErrorText: pad(D.error),
    dlvLoading: state === 'loading',
    dlvReady: ready,
    dlvBusy: busy,

    dlvNotClient: ready && !v.client,
    dlvMarkGo: () => this.dlvMark(true),
    dlvUnmark: () => this.dlvMark(false),

    // plan mode: one honest line from a checklist the owner picked on a project that is not a client job
    dlvIsPlan: plan,
    dlvPlanLine: plan ? (fileBad ? 'Plan file problem' : 'Plan: ' + v.summary) : '',
    dlvIsClient: client,

    dlvSourceLine: ready && v.source !== 'none' ? 'from ' + v.sourceLabel + (v.sourceNote ? ' — ' + v.sourceNote : '') : '',
    dlvReadOnlyNote: readOnly && !fileBad && v.total > 0,
    dlvCanClear: ready && v.source === 'file' && (plan || (client && String(v.scopeFile).toLowerCase() !== 'scope.md')),
    dlvClearGo: () => this.dlvPick(null),

    dlvNoScope: noScope,
    dlvNoScopeText: 'No scope written for this client yet — add the agreed scope from the quote (' + scopeHint + '). Nothing is invented.',
    dlvFileProblem: !!fileBad,
    dlvFileProblemText: fileBad ? 'Can’t read the scope file · ' + pad(v.fileDetail || v.fileState) + '. Nothing is shown from it until it reads.' : '',

    dlvHasCounts: hasCounts,
    dlvCountText: hasCounts ? v.done + ' of ' + v.total + ' done · ' + pct(v.done, v.total) + '%' : '',
    dlvBarStyle: hasCounts ? fill(v.done, v.total) : {},
    dlvMilestones: milestones,

    // add form: the checklist kept in WorkspaceHQ (a file source is read-only, so no form there)
    dlvShowAdd: client && v.source !== 'file',
    dlvDraft: pad(draft.draft), onDlvDraft: (e) => this.dlvField('draft', e.target.value),
    dlvMs: pad(draft.ms), onDlvMs: (e) => this.dlvField('ms', e.target.value),
    dlvAddKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.dlvAdd({ draft: e.target.value }); } },
    dlvAddGo: () => this.dlvAdd(),

    // the repo's own checklist files, offered on every project and adopted only when the owner picks one
    dlvHasCands: ready && cands.length > 0,
    dlvCandsText: plural(cands.length, 'checklist file') + ' found in this repo' + (ready && v.walkTruncated ? ' (the search stopped at its limit)' : ''),
    dlvCands: candList,
    dlvCandsMore: cands.length > CAND_MAX ? '+' + (cands.length - CAND_MAX) + ' more not shown' : '',
    dlvHasCandsMore: cands.length > CAND_MAX,
    dlvNoCands: ready && cands.length === 0 && !v.walkError && v.source !== 'file',
    dlvWalkError: ready && v.walkError ? 'Couldn’t look for checklist files · ' + v.walkError : '',

    // the newest link to send
    dlvHasLink: !!link,
    dlvLinkKind: link ? (link.kind === 'preview' ? 'Preview link' : 'Production link') : '',
    dlvLinkUrl: link ? link.url : '',
    dlvLinkMeta: link ? [link.state, ago(link.at), link.branch].filter(Boolean).join(' · ') : '',
    dlvLinkNote: link && link.kind === 'preview' ? 'May need a Vercel login' : '',
    dlvLinkWarn: link && link.state !== 'ready' ? 'This deploy is ' + link.state + ' — check it before you send it' : '',
    dlvLinkCopy: () => this.dlvCopyLink(link && link.url),
    dlvLinkOpen: () => this.dlvOpenLink(link && link.url),
    dlvNoLink: client && !link,
    dlvNoLinkText: client && !link ? pad(v.linkWhy) : '',

    // the update to paste
    dlvHasUpdate: client && !!v.update,
    dlvUpdateText: client ? pad(v.update) : '',
    dlvUpdateCopy: () => this.dlvCopyUpdate(),
    dlvLastCopy: client && v.update ? (v.lastCopyAt ? 'Last copied ' + ago(v.lastCopyAt) + ' · the next update lists only what is finished since' : 'Not copied yet · nothing is sent, it goes to your clipboard') : '',
  };
}
