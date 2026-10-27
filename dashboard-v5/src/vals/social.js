// Social tab render values (IPC-CONTRACT 2026-10-27 Social tab): Accounts (the browser extension's platforms + the
// Instagram / Facebook archive), Inbox (moved from Life › Social), Archive (Hub social documents + DM counts), Vault
// (VEEMO CORTEX social notes). Every key starts with so, except the Inbox ones, which keep their Life-era names.
import { ago, hubDocHit, hubDocument } from '../live/adapter.mjs';
import { TITLE_MAX } from '../logic/social-limits.mjs';

const NETWORKS = [['instagram', 'Instagram'], ['facebook', 'Facebook']];
export const KIND_LABEL = {
  profile: 'Profile', posts: 'Posts', comments: 'Comments', likes: 'Likes', saved: 'Saved', 'stories-viewed': 'Stories viewed',
  'story-activity': 'Story activity', threads: 'Threads posts', 'threads-activity': 'Threads activity', connections: 'Connections',
  interests: 'Interests', ads: 'Ads', searches: 'Searches', groups: 'Groups', events: 'Events', marketplace: 'Marketplace',
};
const n0 = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const fmtN = (n) => n0(n).toLocaleString('en-US');
const plural = (n, w) => fmtN(n) + ' ' + w + (n0(n) === 1 ? '' : 's');
const whenIso = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? ago(t) : ''; };

// pure: the Archive's per-network cards from the Hub's socialSummary answer
export function archiveNetworks(summary) {
  const kinds = summary && Array.isArray(summary.kinds) ? summary.kinds : [], dms = summary && Array.isArray(summary.dms) ? summary.dms : [];
  return NETWORKS.map(([origin, label]) => {
    const d = dms.find((x) => x && x.origin === origin) || null;
    const ks = kinds.filter((k) => k && k.origin === origin && k.kind).map((k) => ({ kind: String(k.kind), label: KIND_LABEL[k.kind] || String(k.kind), docs: n0(k.docs) }));
    return { origin, label, dms: d ? n0(d.conversations) : 0, messages: d ? n0(d.messages) : 0, last: d ? whenIso(d.last_at) : '', kinds: ks, has: !!d || ks.length > 0 };
  });
}

export function socialVals(ctx) {
  const { S, H, LIVE, cantWrite, writeReason, sub } = ctx;
  const soc = LIVE.social || {}, arch = LIVE.socialArchive || {}, vault = LIVE.socialVault || {};
  const hasBridge = !!this.hq && this.ps() !== 'nobridge';
  // ---- Accounts
  const nets = archiveNetworks(arch.summary);
  const accounts = Array.isArray(soc.ACCOUNTS) ? soc.ACCOUNTS : [], act = soc.ACTIVITY || {};
  const soPlatforms = H.PLATFORMS.map((p) => {
    const a = accounts.find((x) => x.platform === p.id), ac = act[p.id], net = nets.find((x) => x.origin === p.id);
    const who = a ? (a.display ? a.display + ' · ' : '') + (/^fb:/.test(a.handle) ? 'signed in' : '@' + a.handle.replace(/^@/, '')) : '';
    return {
      id: p.id, label: p.label, connected: !!a, notConnected: !a,
      status: a ? 'Connected' : 'Not connected', statusColor: a ? 'var(--green)' : 'var(--faint)',
      who, seen: a && a.since ? 'registered ' + a.since : '',
      activity: ac ? plural(ac.events, 'item') + ' read in the last 7 days' + (ac.mentions ? ' · ' + plural(ac.mentions, 'mention') : '') + (ac.last ? ' · last ' + ac.last : '') : '',
      hasActivity: !!ac,
      archive: net && net.has ? 'Archive: ' + plural(net.dms, 'DM chat') + ' · ' + plural(net.kinds.reduce((s, k) => s + k.docs, 0), 'record group') : '',
      hasArchive: !!(net && net.has),
      hasSite: !!p.site, siteLabel: p.site ? 'Open ' + p.site : '', openSite: () => this.soOpenSite(p.id),
      note: p.site ? '' : 'Set your server in the extension popup',
    };
  });
  const nConn = soPlatforms.filter((p) => p.connected).length;
  // ---- Archive
  // the archive lives in the Claude Hub: say so while it can't answer (an indexing Hub still answers)
  const hubState = LIVE.claudeHub && LIVE.claudeHub.state, hubDown = !arch.summary && !arch.busy && (!hubState || ['starting', 'down', 'no-node'].includes(hubState));
  const hubText = hubState === 'no-node' ? 'The Claude Hub needs Node 22.13 or newer — the archive lives there.' : hubState === 'down' ? 'The Claude Hub is not running — the archive lives there (System › Machine shows why).' : 'The Claude Hub is starting — the archive shows once it answers.';
  const sel = arch.sel, archHas = nets.some((n) => n.has);
  const soNetworks = nets.filter((n) => n.has).map((n) => ({
    label: n.label,
    dmText: n.dms ? plural(n.dms, 'DM chat') + ' · ' + plural(n.messages, 'message') + (n.last ? ' · last ' + n.last : '') : 'No DMs imported',
    hasDms: n.dms > 0, openDms: () => this.soOpenDms(n.origin),
    kinds: n.kinds.map((k) => {
      const on = !!(sel && sel.origin === n.origin && sel.kind === k.kind);
      return { key: n.origin + ':' + k.kind, label: k.label + ' · ' + fmtN(k.docs), pick: () => this.soPick(n.origin, k.kind),
        style: { height: 28, padding: '0 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--term)', fontSize: 12, background: on ? 'color-mix(in oklab, var(--gold) 14%, transparent)' : 'transparent', color: on ? 'var(--accent-text)' : 'var(--text)', border: '1px solid ' + (on ? 'color-mix(in oklab, var(--gold) 55%, transparent)' : 'var(--frame)') } };
    }),
  }));
  const list = Array.isArray(arch.list) ? arch.list.map((r) => hubDocHit(r)) : [];
  const hits = Array.isArray(arch.hits) ? arch.hits.map((r) => hubDocHit(r)) : [];
  // getDocument answers meta {origin, kind}; the badge reads a top-level origin (the list rows carry one)
  const doc = arch.doc || null, d = doc && !doc.loading && !doc.error ? hubDocument({ ...doc, origin: doc.origin || (doc.meta && doc.meta.origin) || null }) : null;
  const archEmpty = !arch.busy && !arch.error && !!arch.summary && !archHas;
  // ---- Vault
  const notes = Array.isArray(vault.notes) ? vault.notes : null;
  const soNotes = (notes || []).map((n) => ({
    key: n.rel, title: n.title || n.name, rel: n.rel, where: n.where === 'inbox' ? '00_Inbox' : '', inInbox: n.where === 'inbox',
    when: Number(n.mtime) > 0 ? ago(Number(n.mtime)) : '', openObsidian: () => this.soOpenNote(n.rel, 'obsidian'), openFile: () => this.soOpenNote(n.rel, 'file'),
  }));
  const title = String(S.soTitle || '');
  return {
    // Accounts
    soPlatforms, soConnText: nConn + ' of ' + H.PLATFORMS.length + ' connected through the browser extension',
    soHowTo: 'To connect one: open it in Chrome, sign in, and keep a tab open. The WorkspaceHQ Bridge extension reads signed-in tabs every 5 minutes, read-only; nothing posts without your Approve & Send in its popup.',
    soNoBridge: !hasBridge, soRefresh: () => this.socialLoad(),
    soArchHint: archHas ? '' : 'Instagram and Facebook can also come in as a full archive: download your information from Meta (HTML for Instagram, JSON for Facebook) and import the ZIP.',
    // Inbox (moved from Life › Social; same keys)
    posts: H.POSTS.map((p) => { const ask = S.soDiscardAsk === p.id, busy = S.soDiscarding === p.id;
      return { handle: p.handle, text: p.text, where: p.where, staged: p.staged, open: () => this.toast('info', 'Approve & send happens in the browser extension popup'),
        skip: () => this.soDiscard(p.id), skipLabel: busy ? 'Discarding…' : ask ? 'Discard for good?' : 'Discard', skipOff: cantWrite || busy,
        skipTip: cantWrite ? writeReason : ask ? 'Click again: it is marked canceled and can never be sent' : 'Cancel this draft (asks once more; nothing is posted)' }; }),
    hasPosts: H.POSTS.length > 0, noPosts: H.POSTS.length === 0, mentions: H.MENTIONS, hasMentions: H.MENTIONS.length > 0, socialEmpty: !soc.connected,
    // Archive
    soArchBusy: !!arch.busy && !arch.summary, soArchErr: arch.error || '', soHasArchErr: !!arch.error,
    soHubDown: hubDown, soHubText: hubText,
    soNetworks, soHasNetworks: soNetworks.length > 0, soArchEmpty: archEmpty,
    soHasSel: !!sel, soSelTitle: sel ? (NETWORKS.find((x) => x[0] === sel.origin) || [, sel.origin])[1] + ' · ' + (KIND_LABEL[sel.kind] || sel.kind) : '',
    soList: list.map((h) => ({ ...h, open: () => this.soOpenDoc(h.id) })), soListLoading: !!sel && !arch.list && !arch.listErr, soListErr: arch.listErr || '', soHasListErr: !!arch.listErr,
    soListEmpty: !!sel && Array.isArray(arch.list) && arch.list.length === 0, soCloseSel: () => this.soPick(sel && sel.origin, sel && sel.kind),
    soQuery: S.soQuery || '', onSoQuery: (e) => this.onSoQuery(e), soSearchKey: (e) => { if (e && e.key === 'Enter') this.soSearch(); },
    soDoSearch: () => this.soSearch(), soDoClear: () => this.soClear(), soSearched: !!S.soSearched,
    soHasHits: hits.length > 0, soHits: hits.map((h) => ({ ...h, open: () => this.soOpenDoc(h.id) })),
    soHitsText: !S.soSearched || !arch.q ? '' : arch.hits && arch.hits.error ? arch.hits.error : hits.length === 1 ? '1 record group matches' : hits.length + ' record groups match',
    soDocOpen: !!doc, soDocLoading: !!(doc && doc.loading), soDocErr: (doc && doc.error) || '', soHasDocErr: !!(doc && doc.error),
    soDoc: d || { title: '', badge: '', when: '', lines: [] }, soHasDoc: !!d, soCloseDoc: () => this.soCloseDoc(),
    // Vault
    soVaultName: vault.vault || 'VEEMO CORTEX', soVaultFolder: (vault.folder || '30_Areas/Social') + '/',
    soNotes, soHasNotes: soNotes.length > 0, soNotesEmpty: !!notes && soNotes.length === 0 && !vault.error,
    soVaultBusy: !!vault.busy && !notes, soVaultErr: vault.error || '', soHasVaultErr: !!vault.error,
    soNoObsidian: !!notes && !vault.obsidian, soObsidianTip: vault.obsidian ? 'Open in Obsidian' : 'Obsidian is not installed (no obsidian:// handler)',
    soFolderNote: notes && !vault.exists ? 'The folder ' + (vault.folder || '30_Areas/Social') + ' is created when you save the first note.' : '',
    soTitle: title, soBody: S.soBody || '', onSoTitle: (e) => this.onSoTitle(e), onSoBody: (e) => this.onSoBody(e), soSave: () => this.soSave(),
    soSaveLabel: S.soSaving ? 'Saving…' : 'Save to ' + (vault.vault || 'VEEMO CORTEX'), soCantSave: cantWrite || !!S.soSaving || !title.trim() || !(this.hq && this.hq.socialVault),
    soSaveTip: cantWrite ? writeReason : 'Writes one new note in ' + (vault.folder || '30_Areas/Social') + '/ — never over an existing one', soTitleMax: TITLE_MAX,
    isSoAccounts: sub === 'accounts', isSoInbox: sub === 'inbox', isSoArchive: sub === 'archive', isSoVault: sub === 'vault',
  };
}
