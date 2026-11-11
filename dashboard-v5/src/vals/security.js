// Security space: render values. EVERY value rides under ONE top-level key, secv: renderVals sits at 1010 of its 1015-key ceiling, so
// a new space nests (see vals/drift.js, dftv); the template reads {{ secv.secShow }} and friends and nothing else is added at the top.
//
// Two rules the tests pin:
//  1. The key set of secv is the same in every state (every value defined: the template never meets undefined, the selftest's hole
//     check stays quiet), and while the owner is not on the tab this returns ONE frozen module-level object, the same reference on
//     every call: no layout, no memo access (vals run for every tab on every render).
//  2. Honest words. breached === null is 'not checked', never a clean bill; a locked identity says 'locked - refresh to restore'; the
//     hide-from-Claude switch and the generator's copy note carry their exact sentences (logic/security.js). Nothing here claims a
//     thing is guaranteed: the space shows what the vault export said, plus what the owner ticked.
//
// The unlock dialog's input is UNCONTROLLED: nothing here binds its value, and no key of secv holds what was typed.
import { emptySecurity } from '../live/security-slice.mjs';
import { buildMapModel, filterByDate, dateStops, layoutGraph, growthSummary, LOCKED_LABEL, FLAG_ORDER } from '../logic/security-graph.mjs';
import { secInit, secSteps, FLAG_WORDS, HIDE_WORDING, COPY_NOTE, CONFLICT_WORDING, EXPORT_WORDING, TWOFA_OPTIONS, SHEET_LINES } from '../logic/security.js';
import { estimateBits, LIMITS, SET_NAMES } from '../logic/security-generate.mjs';

export const SEC_W = 900;
export const SEC_H = 560;
export const SEC_TEXT = Object.freeze({
  intro: 'A map of your accounts and the addresses behind them. It holds names and flags only: passwords stay in KeePassXC.',
  loading: 'Reading the Security files...',
  offline: 'Security needs the desktop app: nothing can be read or changed without its main process.',
  needVault: 'No map yet. Choose your vault file in Setup, press Refresh and type the passphrase, or add accounts by hand.',
  emptyMap: 'The map is empty. Press Refresh to read the vault, or add accounts by hand.',
  noCli: 'keepassxc-cli was not found, so Refresh cannot read a vault. See Setup.',
  noVaultPath: 'No vault file chosen yet. Choose it in Setup.',
  noVaultFile: 'The chosen vault file was not found. Check the path in Setup.',
  unlockTitle: 'Unlock the vault',
  unlockHelp: 'Type the master passphrase. It is passed to keepassxc-cli on its standard input and the field is emptied as soon as it is sent. This app does not write it anywhere.',
  breachCheck: 'check breaches online (Have I Been Pwned, 5 hash characters leave the PC)',
  breachOff: 'The breach check is off: no network call is made and breach status stays "not checked".',
  genIntro: 'A convenience only. For a real password prefer KeePassXC’s own generator.',
  sheetTitle: 'Emergency sheet',
  sheetHelp: 'Blank lines only. Print it, write the answers by hand and keep the paper somewhere you trust. Nothing from this app is on it.',
  exportsNone: 'No file with a name like a password export was found at the top level of Downloads, Desktop or Documents. The check is by file name only; no file is opened.',
  exportsNever: 'The Downloads, Desktop and Documents folders have not been checked yet.',
  breachNotChecked: 'not checked',
});

const NOOP = () => {};
const STOP = (e) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); };
const E = Object.freeze([]);

const FLAG_COLOR = Object.freeze({ breached: 'var(--red)', reused: 'var(--orange)', weak: 'var(--orange)', no2fa: 'var(--gold)', old: 'var(--blue)', 'not-in-vault': 'var(--muted)' });
const EDGE = Object.freeze({
  uses: 'stroke:var(--frame-hi);stroke-width:1.5',
  'signs-in-with': 'stroke:var(--blue);stroke-width:1.5;stroke-dasharray:6 4',
  recovers: 'stroke:var(--green);stroke-width:1.5;stroke-dasharray:2 4',
});
const LEGEND = Object.freeze([
  { kind: 'uses', text: 'uses this address', style: EDGE.uses },
  { kind: 'signs-in-with', text: 'signs in with another account', style: EDGE['signs-in-with'] },
  { kind: 'recovers', text: 'recovers through this address', style: EDGE.recovers },
]);

function blankCard() {
  return {
    show: false, id: '', title: '', host: '', hasHost: false, group: '', hasGroup: false, kindText: '', isAccount: false, isIdentity: false,
    lockedText: '', hasLocked: false, usesText: '', hasUses: false, flags: E, hasFlags: false, noFlagsText: '', breachText: '', hasBreach: false,
    twofa: E, signIn: E, signInNote: '', hasSignInNote: false, recovery: E,
    hidden: false, hideLabel: 'Hide from Claude', hideWording: HIDE_WORDING, onHide: NOOP, archived: false, archiveLabel: '', onArchive: NOOP, close: NOOP,
  };
}

function blank() {
  return {
    secShow: false, secIntro: SEC_TEXT.intro,
    secSubMap: false, secSubHealth: false, secSubSetup: false, secSubGen: false,
    secOffline: false, secOfflineText: SEC_TEXT.offline, secLoading: false, secLoadingText: SEC_TEXT.loading, secHasErr: false, secErrText: '',
    secStatusLine: '', secRefreshOpen: NOOP, secRefreshOff: true, secRefreshLabel: 'Refresh', secRefreshWhy: '', secHasRefreshWhy: false,
    secNote: '', secHasNote: false,
    // map
    secMapEmpty: false, secMapEmptyText: '', secMapReady: false, secViewBox: '0 0 ' + SEC_W + ' ' + SEC_H, secEdges: E, secNodes: E, secLegend: E,
    secNodeCountText: '', secFoldText: '', secHasFold: false, secLockedNote: '', secHasLocked: false,
    secGrowthShow: false, secGrowthText: '', secGrowthAcc: '', secGrowthFlags: '', secGrowthHasPath: false,
    secSliderShow: false, secSliderMax: 0, secSliderVal: 0, secSliderOn: NOOP, secSliderLabel: '', secShowAllShow: false, secShowAll: NOOP,
    secAddAccount: NOOP, secAddIdentity: NOOP, secAddOff: true,
    secFormAccount: false, secFormIdentity: false, secFormErr: '', secHasFormErr: false, secFormBusy: false, secFormSubmit: NOOP, secFormCancel: NOOP,
    secTitleRef: NOOP, secHostRef: NOOP, secIdKindRef: NOOP, secIdValueRef: NOOP, secFormKey: NOOP,
    secCard: blankCard(),
    // health
    secFlagRows: E, secBreachLine: '', secFlagged: E, secHasFlagged: false, secFlaggedMore: '', secHasFlaggedMore: false, secNoFlagsText: '', secHasNoFlags: false,
    secExports: E, secHasExports: false, secExportsNote: '', secExportsScan: NOOP, secConflictShow: false, secConflictText: '', secConflictCount: '',
    // setup
    secSteps: E, secStepsDone: '', secVaultRef: NOOP, secVaultValue: '', secVaultSave: NOOP, secVaultErr: '', secHasVaultErr: false, secVaultKey: NOOP,
    secSheetOpen: false, secSheetTitle: SEC_TEXT.sheetTitle, secSheetHelp: SEC_TEXT.sheetHelp, secSheetLines: E, secSheetPrint: NOOP, secSheetClose: NOOP,
    // unlock dialog
    secDlgOpen: false, secDlgTitle: SEC_TEXT.unlockTitle, secDlgHelp: SEC_TEXT.unlockHelp, secDlgBusy: false, secDlgErr: '', secDlgHasErr: false,
    secDlgBreaches: true, secDlgBreachText: SEC_TEXT.breachCheck, secDlgOffText: SEC_TEXT.breachOff, secDlgOffShow: false, secDlgToggle: NOOP,
    secDlgSubmit: NOOP, secDlgCancel: NOOP, secDlgKey: NOOP, secPassRef: NOOP, secDlgSubmitLabel: 'Refresh', secDlgStop: STOP,
    // generator
    secGenIntro: SEC_TEXT.genIntro, secGenKinds: E, secGenIsChars: false, secGenLenLabel: '', secGenLen: 0, secGenLenMin: 0, secGenLenMax: 0, secGenOnLen: NOOP,
    secGenSets: E, secGenBits: '', secGenDo: NOOP, secGenDoLabel: 'Generate', secGenHasOut: false, secGenOut: '', secGenOutBits: '', secGenCopy: NOOP, secGenClear: NOOP,
    secGenNote: '', secGenHasNote: false, secGenErr: '', secGenHasErr: false, secGenCopyNote: COPY_NOTE,
  };
}

/** The frozen "not on this tab" value: the same reference on every call. */
export const SEC_OFF = Object.freeze(blank());
const OFF_V = Object.freeze({ secv: SEC_OFF });

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const dayOf = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '');
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
const flagText = (flags) => flags.map((f) => FLAG_WORDS[f].label).join(', ');
const enterKey = (fn) => (e) => { if (e && e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); fn(); } };

function securityFlat(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  if (!(ctx && ctx.v && ctx.v.security && S.tab === 'security')) return SEC_OFF;
  const sub = (ctx && ctx.sub) || (S.sub && S.sub.security) || 'map';
  const L = (ctx && ctx.LIVE) || this.LIVE || {};
  const SL = L.security || emptySecurity();
  const sec = S.sec || secInit();
  const can = typeof this.secCan === 'function' ? this.secCan() : false;
  const tabStyle = typeof ctx.tabStyle === 'function' ? ctx.tabStyle : () => ({});
  const chip = (on, go, label) => ({ label, go, pressed: on ? 'true' : 'false', style: Object.assign({}, tabStyle(!!on), { height: 28, padding: '0 10px', fontSize: 12 }) });
  const out = Object.assign(blank(), { secShow: true, secSubMap: sub === 'map', secSubHealth: sub === 'health', secSubSetup: sub === 'setup', secSubGen: sub === 'generate' });

  // ---- shared: state, the refresh button, notes ----------------------------------------------------
  const settings = SL.settings || {};
  const vaultPath = typeof settings.vaultPath === 'string' ? settings.vaultPath : '';
  out.secOffline = !can;
  out.secLoading = can && !SL.loaded && !SL.error;
  out.secHasErr = can && !!SL.error;
  out.secErrText = SL.error ? (SL.map ? 'Could not refresh the Security files: ' + SL.error + '. The last copy stays on screen.' : 'Could not read the Security files: ' + SL.error) : '';
  const why = !can ? '' : !SL.loaded ? '' : !SL.cliFound ? SEC_TEXT.noCli : !vaultPath ? SEC_TEXT.noVaultPath : !SL.vaultExists ? SEC_TEXT.noVaultFile : '';
  const dlg = sec.dlg;
  out.secRefreshOff = !can || !SL.loaded || !!why || !!dlg;
  out.secRefreshWhy = why; out.secHasRefreshWhy = !!why;
  out.secRefreshOpen = () => this.secOpenUnlock();
  out.secNote = sec.note || ''; out.secHasNote = !!sec.note;

  // ---- the model (memoised on the slice revision and the slider) -------------------------------------
  const rev = SL.revision, slider = sec.slider;
  let memo = this._secMemo;
  if (!memo || memo.rev !== rev || memo.slider !== slider || memo.snap !== SL.snapshots) {
    const model = buildMapModel({ map: SL.map, owner: SL.owner });
    const stops = dateStops(model);
    const idx = slider === null || stops.length < 2 ? null : Math.min(slider, stops.length - 1);
    const cutoff = idx === null || idx === stops.length - 1 ? null : stops[idx];
    const lay = layoutGraph(filterByDate(model, cutoff), { width: SEC_W, height: SEC_H, iterations: 300 });
    memo = { rev, slider, snap: SL.snapshots, model, stops, idx, cutoff, lay, growth: growthSummary(SL.snapshots) };
    this._secMemo = memo;
  }
  const { model, lay, stops, growth } = memo;
  const C = model.counts;
  const refreshedDay = SL.map ? dayOf(SL.map.refreshedAt) : '';
  out.secStatusLine = (refreshedDay ? 'Last refreshed ' + refreshedDay : 'Never refreshed') + ' · ' + plural(C.accounts, 'account', 'accounts') + ' · ' + plural(C.identities, 'identity', 'identities') + (C.archived ? ' · ' + C.archived + ' archived' : '');

  // ---- map -----------------------------------------------------------------------------------------------
  if (sub === 'map') {
    const sel = sec.sel;
    const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
    const many = lay.nodes.length > 80;
    out.secViewBox = '0 0 ' + SEC_W + ' ' + SEC_H;
    const pos = new Map(lay.nodes.map((n) => [n.id, n]));
    out.secEdges = lay.edges.map((e) => { const a = pos.get(e.a), b = pos.get(e.b); return { x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1), style: EDGE[e.kind] || EDGE.uses }; });
    out.secNodes = lay.nodes.map((n) => {
      const isIdent = n.kind === 'identity', isMore = n.kind === 'more';
      const flags = Array.isArray(n.flags) ? n.flags : [];
      const worst = FLAG_ORDER.find((f) => flags.includes(f));
      const dots = flags.map((f, i) => { const a = (-45 - i * 32) * (Math.PI / 180); return { cx: (n.x + Math.cos(a) * n.r).toFixed(1), cy: (n.y + Math.sin(a) * n.r).toFixed(1), fill: FLAG_COLOR[f] || 'var(--muted)' }; });
      const showLabel = isIdent || isMore || !many || sel === n.id;
      const name = isMore ? n.label : n.label + (n.host && !isIdent ? ' (' + n.host + ')' : '');
      const title = isMore ? n.label + ' accounts are folded into this identity to keep the map readable. Use Health to see them.' : name + (flags.length ? ' · ' + flagText(flags) : '') + (n.archived ? ' · archived' : '') + (n.hidden ? ' · hidden from Claude' : '');
      const dash = n.kind === 'manual' ? '3 3' : n.kind === 'ghost' ? '4 3' : isMore ? '5 4' : 'none';
      const go = isMore ? NOOP : () => this.secSelect(n.id);
      return {
        id: n.id, cx: n.x.toFixed(1), cy: n.y.toFixed(1), r: n.r.toFixed(1),
        fill: isIdent ? 'color-mix(in oklab, var(--gold) 24%, var(--card))' : isMore ? 'var(--ink)' : 'var(--card)',
        stroke: sel === n.id ? 'var(--gold)' : isIdent ? 'var(--gold)' : worst ? FLAG_COLOR[worst] : isMore ? 'var(--muted)' : 'var(--frame-hi)',
        strokeW: sel === n.id ? '3.5' : '1.6', dash, opacity: n.archived ? '0.35' : '1',
        label: short(isIdent && n.locked ? 'locked' : n.label, isIdent ? 22 : 16), showLabel, tx: n.x.toFixed(1), ty: (n.y + n.r + 12).toFixed(1),
        title, dots, hasDots: dots.length > 0, go, key: enterKey(go), selected: sel === n.id, role: isMore ? 'img' : 'button', tab: isMore ? '-1' : '0',
        kindText: isIdent ? 'identity' : isMore ? 'folded' : n.kind === 'manual' ? 'added by hand' : n.kind === 'ghost' ? 'not in vault' : 'account',
      };
    });
    out.secLegend = LEGEND;
    out.secNodeCountText = plural(lay.nodes.length, 'bubble', 'bubbles') + (memo.cutoff ? ' · accounts created on or before ' + memo.cutoff : '');
    out.secHasFold = lay.folded > 0 || lay.clipped > 0;
    out.secFoldText = lay.folded > 0 ? plural(lay.folded, 'account', 'accounts') + ' with the fewest links are folded into “+N more” bubbles (one per identity); the Health list still shows every flagged account.' + (lay.clipped ? ' ' + plural(lay.clipped, 'bubble', 'bubbles') + ' could not be drawn.' : '') : lay.clipped ? plural(lay.clipped, 'bubble', 'bubbles') + ' could not be drawn.' : '';
    const locked = model.nodes.filter((n) => n.kind === 'identity' && n.locked).length;
    out.secHasLocked = locked > 0;
    out.secLockedNote = locked > 0 ? plural(locked, 'identity label is', 'identity labels are') + ' ' + LOCKED_LABEL + '. Labels are kept encrypted; they come back with the next refresh.' : '';
    out.secMapReady = can && model.nodes.length > 0 && lay.nodes.length > 0;
    out.secMapEmpty = can && SL.loaded && model.nodes.length === 0;
    out.secMapEmptyText = !vaultPath && !SL.map ? SEC_TEXT.needVault : SEC_TEXT.emptyMap;

    // growth line + the time slider
    out.secGrowthShow = can && SL.loaded;
    out.secGrowthText = growth.text;
    out.secGrowthAcc = growth.accountsPath; out.secGrowthFlags = growth.flagsPath; out.secGrowthHasPath = !!growth.accountsPath;
    out.secSliderShow = stops.length > 1;
    out.secSliderMax = Math.max(0, stops.length - 1);
    out.secSliderVal = memo.idx === null ? Math.max(0, stops.length - 1) : memo.idx;
    out.secSliderOn = (e) => this.secSlide(e);
    out.secSliderLabel = memo.cutoff ? 'Showing accounts created on or before ' + memo.cutoff : stops.length > 1 ? 'Showing everything (' + stops[0] + ' to ' + stops[stops.length - 1] + ')' : '';
    out.secShowAllShow = !!memo.cutoff; out.secShowAll = () => this.secShowAll();

    // add forms
    out.secAddAccount = () => this.secOpenForm('account'); out.secAddIdentity = () => this.secOpenForm('identity'); out.secAddOff = !can || !SL.loaded;
    out.secFormAccount = sec.form === 'account'; out.secFormIdentity = sec.form === 'identity';
    out.secFormErr = sec.formErr || ''; out.secHasFormErr = !!sec.formErr; out.secFormBusy = !!sec.busy;
    out.secFormSubmit = () => this.secSubmitForm(); out.secFormCancel = () => this.secCloseForm(); out.secFormKey = enterKey(() => this.secSubmitForm());
    out.secTitleRef = this.secRef('title'); out.secHostRef = this.secRef('host'); out.secIdKindRef = this.secRef('idkind'); out.secIdValueRef = this.secRef('idvalue');

    // the side card
    const sn = sel ? nodeById.get(sel) : null;
    if (sn && sn.kind !== 'more') out.secCard = cardFor.call(this, sn, model, SL, chip);
  }

  // ---- health ----------------------------------------------------------------------------------------
  if (sub === 'health') {
    const acc = model.nodes.filter((n) => n.kind !== 'identity' && !n.archived);
    const checkedAny = acc.some((n) => n.kind === 'account' && n.breached !== null);
    const rows = [];
    for (const f of FLAG_ORDER) {
      const key = f === 'not-in-vault' ? 'notInVault' : f;
      const count = C.flags[key];
      let countText = String(count), todo = FLAG_WORDS[f].todo;
      if (f === 'breached') {
        if (!checkedAny) { countText = SEC_TEXT.breachNotChecked; todo = 'Press Refresh with the breach check on. Until it has run, nothing is known about breaches.'; }
        else countText = count + (C.breachUnknown ? ' found · ' + C.breachUnknown + ' ' + SEC_TEXT.breachNotChecked : ' found');
      }
      rows.push({ key: f, label: FLAG_WORDS[f].label, countText, todo, hot: f === 'breached' ? count > 0 : count > 0 });
    }
    out.secFlagRows = rows;
    const st = SL.status || {};
    out.secBreachLine = st.breachCheckedAt ? 'The breach check last finished on ' + (dayOf(st.breachCheckedAt) || 'a recorded day') + '.' : 'The breach check has not finished on any refresh yet: breach status is not checked.';
    const flagged = acc.filter((n) => n.flags.length > 0).sort((a, b) => b.flags.length - a.flags.length || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    out.secFlagged = flagged.slice(0, 200).map((n) => ({ id: n.id, title: n.label, host: n.host, hasHost: !!n.host, flagsText: flagText(n.flags), go: () => this.secGoSelect(n.id) }));
    out.secHasFlagged = flagged.length > 0;
    out.secFlaggedMore = flagged.length > 200 ? 'and ' + (flagged.length - 200) + ' more' : ''; out.secHasFlaggedMore = flagged.length > 200;
    out.secHasNoFlags = can && SL.loaded && flagged.length === 0;
    out.secNoFlagsText = model.nodes.length === 0 ? 'Nothing to check yet: the map is empty.' : 'No flag is raised on any account the app can see.';
    const files = Array.isArray(SL.exports) ? SL.exports : null;
    out.secExports = (files || []).map((f) => ({ name: f.name, dir: f.dir, meta: kb(f.size) + (dayOf(typeof f.mtime === 'string' ? f.mtime : '') ? ' · ' + dayOf(f.mtime) : ''), wording: EXPORT_WORDING, trash: () => this.secTrashExport(f.name, f.dir) }));
    out.secHasExports = !!files && files.length > 0;
    out.secExportsNote = files === null ? (SL.exportsError ? 'The scan could not run: ' + SL.exportsError : SEC_TEXT.exportsNever) : files.length === 0 ? SEC_TEXT.exportsNone : plural(files.length, 'file', 'files') + ' ' + (files.length === 1 ? 'has' : 'have') + ' a name like a password export. A name match is a guess: the file is never opened. If it is one, move it to the Recycle Bin below, then empty the bin yourself.';
    out.secExportsScan = () => (this.store && this.store.scanSecurityExports ? this.store.scanSecurityExports() : null);
    const conflicts = Number.isFinite(st.conflicts) ? st.conflicts : 0;
    out.secConflictShow = conflicts > 0; out.secConflictCount = plural(conflicts, 'conflict copy', 'conflict copies'); out.secConflictText = CONFLICT_WORDING;
  }

  // ---- setup -----------------------------------------------------------------------------------------
  if (sub === 'setup') {
    const steps = secSteps({ settings, status: SL.status, cliFound: SL.cliFound, vaultExists: SL.vaultExists, map: SL.map, exports: SL.exports });
    out.secSteps = steps.map((s) => ({
      id: s.id, n: s.n, title: s.title, help: s.help, owner: s.owner, done: s.done, mark: s.done ? '✓' : '○', markColor: s.done ? 'var(--green)' : 'var(--muted)',
      check: s.check, extra: s.extra, hasExtra: !!s.extra, canTick: s.owner, tickLabel: s.done ? 'Untick' : 'I did this', tick: () => this.secTick(s.id),
      isVault: s.id === 'create-vault', isSheet: s.id === 'emergency-sheet', openSheet: () => this.secOpenSheet(),
    }));
    out.secStepsDone = steps.filter((s) => s.done).length + ' of ' + steps.length + ' steps done';
    out.secVaultRef = this.secRef('vaultpath'); out.secVaultValue = vaultPath; out.secVaultSave = () => this.secSavePath(); out.secVaultKey = enterKey(() => this.secSavePath());
    out.secVaultErr = sec.pathErr || ''; out.secHasVaultErr = !!sec.pathErr;
    out.secSheetOpen = !!sec.sheet;
    out.secSheetLines = SHEET_LINES.map((label) => ({ label, line: '' }));
    out.secSheetPrint = () => this.secPrint(); out.secSheetClose = () => this.secCloseSheet();
  }

  // ---- generator ---------------------------------------------------------------------------------------
  if (sub === 'generate') {
    const g = sec.gen || secInit().gen, chars = g.kind === 'chars';
    out.secGenKinds = [chip(!chars, () => this.secGenKind('words'), 'Passphrase (words)'), chip(chars, () => this.secGenKind('chars'), 'Characters')];
    out.secGenIsChars = chars;
    const lim = chars ? LIMITS.chars : LIMITS.words, len = chars ? g.chars : g.words;
    out.secGenLenLabel = chars ? 'Length: ' + len + ' characters' : 'Length: ' + len + ' words'; out.secGenLen = len; out.secGenLenMin = lim[0]; out.secGenLenMax = lim[1];
    out.secGenOnLen = (e) => this.secGenLength(e);
    const NAMES = { lower: 'a-z', upper: 'A-Z', digits: '0-9', symbols: 'symbols' };
    out.secGenSets = SET_NAMES.map((n) => ({ name: n, label: NAMES[n], checked: !!(g.sets && g.sets[n]), toggle: () => this.secGenSet(n) }));
    const bits = estimateBits(chars ? { kind: 'chars', length: g.chars, sets: g.sets } : { kind: 'words', length: g.words });
    out.secGenBits = bits ? 'about ' + bits + ' bits of entropy' : 'no character kind is on';
    out.secGenDo = () => this.secGenerate(); out.secGenDoLabel = g.out ? 'Generate another' : 'Generate';
    out.secGenHasOut = !!g.out; out.secGenOut = g.out ? g.out.text : ''; out.secGenOutBits = g.out ? 'about ' + g.out.bits + ' bits' : '';
    out.secGenCopy = () => this.secGenCopy(); out.secGenClear = () => this.secGenClear();
    out.secGenNote = g.note || ''; out.secGenHasNote = !!g.note; out.secGenErr = g.err || ''; out.secGenHasErr = !!g.err;
  }

  // ---- the unlock dialog (main window only; the input is uncontrolled and bound to nothing) ---------------
  if (dlg) {
    out.secDlgOpen = true; out.secDlgBusy = !!dlg.busy; out.secDlgErr = dlg.error || ''; out.secDlgHasErr = !!dlg.error;
    out.secDlgBreaches = dlg.breaches !== false; out.secDlgOffShow = dlg.breaches === false; out.secDlgToggle = (e) => this.secToggleBreaches(e);
    out.secDlgSubmit = () => this.secSubmitUnlock(); out.secDlgCancel = () => this.secCancelUnlock();
    out.secDlgKey = (e) => { if (!e) return; if (e.key === 'Enter') { if (e.preventDefault) e.preventDefault(); this.secSubmitUnlock(); } else if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); this.secCancelUnlock(); } };
    out.secDlgSubmitLabel = dlg.busy ? 'Reading the vault...' : 'Refresh';
  }
  out.secPassRef = this.secRef('pass');
  return out;
}

const PROVIDER = /google|gmail|apple|icloud|github|microsoft|outlook|live.com|facebook|amazon|discord|linkedin|twitter/i;

function cardFor(n, model, SL, chip) {
  const o = (SL.owner && SL.owner.accounts && SL.owner.accounts[n.id]) || {};
  const card = Object.assign(blankCard(), { show: true, id: n.id, title: n.label, close: () => this.secCloseCard() });
  if (n.kind === 'identity') {
    const links = model.edges.filter((e) => e.b === n.id);
    const uses = links.filter((e) => e.kind === 'uses').length, rec = links.filter((e) => e.kind === 'recovers').length;
    card.isIdentity = true;
    card.kindText = (n.identityKind === 'phone' ? 'phone number' : 'email address') + ' (an identity)';
    card.usesText = plural(uses, 'account uses', 'accounts use') + ' it' + (rec ? ' · ' + plural(rec, 'account recovers', 'accounts recover') + ' through it' : '');
    card.hasUses = true;
    card.hasLocked = !!n.locked; card.lockedText = n.locked ? LOCKED_LABEL + '. The label is kept encrypted and could not be read here; the next refresh restores it.' : '';
    return card;
  }
  card.isAccount = true;
  card.host = n.host; card.hasHost = !!n.host; card.group = n.group || ''; card.hasGroup = !!n.group;
  card.kindText = n.kind === 'manual' ? 'added by hand (not in the vault)' : n.kind === 'ghost' ? 'your edit remains, but this account is not in the vault any more' : 'account read from the vault';
  card.flags = n.flags.map((f) => ({ label: FLAG_WORDS[f].label, todo: FLAG_WORDS[f].todo }));
  card.hasFlags = card.flags.length > 0;
  card.noFlagsText = n.archived ? 'Archived: no flags are counted for a closed account.' : 'No flag is raised on this account.';
  card.breachText = n.kind !== 'account' ? 'Breach status: not checked (no password is read for this account).' : n.breached === true ? 'Breach status: found in a breach list at the last check.' : n.breached === false ? 'Breach status: not found in the breach list at the last check.' : 'Breach status: ' + SEC_TEXT.breachNotChecked + '.';
  card.hasBreach = true;
  const cur = typeof o.twofa === 'string' ? o.twofa : 'unknown';
  card.twofa = TWOFA_OPTIONS.map(([value, label]) => chip(value === cur, () => this.secEdit(n.id, { twofa: value }), label));
  // a parent to sign in with: the provider-like accounts on the map (a long picker would not fit a card), the current one always
  const sw = typeof o.signInWith === 'string' ? o.signInWith : '';
  const parents = model.nodes.filter((x) => (x.kind === 'account' || x.kind === 'manual') && x.id !== n.id && !x.archived && (x.id === sw || PROVIDER.test(x.host + ' ' + x.label)))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)).slice(0, 12);
  card.signIn = [chip(!sw, () => this.secEdit(n.id, { signInWith: null }), 'its own sign-in')].concat(parents.map((x) => chip(x.id === sw, () => this.secEdit(n.id, { signInWith: x.id }), short(x.label, 24))));
  card.hasSignInNote = parents.length === 0;
  card.signInNote = parents.length === 0 ? 'No provider account (Google, Apple, GitHub, Microsoft and the like) is on the map yet: add it as an account first.' : '';
  const rc = typeof o.recoveryRef === 'string' ? o.recoveryRef : '';
  card.recovery = [chip(!rc, () => this.secEdit(n.id, { recoveryRef: null }), 'not recorded')].concat(model.nodes.filter((x) => x.kind === 'identity').slice(0, 12).map((x) => chip(x.id === rc, () => this.secEdit(n.id, { recoveryRef: x.id }), short(x.label, 26))));
  card.hidden = !!n.hidden; card.onHide = () => this.secEdit(n.id, { hiddenFromClaude: !n.hidden });
  card.archived = !!n.archived; card.archiveLabel = n.archived ? 'Restore this account' : 'Archive (I closed this account)'; card.onArchive = () => this.secEdit(n.id, { archived: !n.archived });
  return card;
}

/** ONE top-level key (secv). */
export function securityVals(ctx) {
  const flat = securityFlat.call(this, ctx);
  return flat === SEC_OFF ? OFF_V : { secv: flat };
}
