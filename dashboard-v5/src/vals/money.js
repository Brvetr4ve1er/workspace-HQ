// money render values (space "money", ported from Ember). Keys are mny-prefixed — one shared
// namespace with every other surface. All money math is done main-side (dashboard/money/view.mjs)
// and arrives finished in LIVE.money.view; this module only shapes it for the template and binds
// handlers (logic/money.js). Snapshot-independent: the time machine never rewinds money (scrub.js says so).
const DRAFTS = { log: { amount: '', currency: 'DA', category: 'Food', accountId: '', note: '' }, paste: { text: '', from: '' } };

export function moneyVals(ctx) {
  const { S, LIVE, sub, tabStyle, live } = ctx;
  const M = LIVE.money || {}, V = M.view, d = S.mny || {}, busy = !!d.busy;
  const can = !!(this.hq && this.hq.money);
  const chip = (on, go, label) => ({ label, go, pressed: on ? 'true' : 'false', style: Object.assign(tabStyle(on), { height: 28, padding: '0 10px', fontSize: 12 }) });
  const field = (form, key) => (d[form] && d[form][key] != null ? d[form][key] : (DRAFTS[form] || {})[key] ?? '');
  const onField = (form, key) => (e) => this.mnyField(form, key, e.target.value);
  const enter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };
  const isToday = sub === 'today' || !sub, isRunway = sub === 'runway', isJars = sub === 'jars', isInbox = sub === 'inbox';
  // honest load states: no bridge (dev harness / selftest) · read failed · still loading · ready
  const state = !can ? 'offline' : M.error ? 'error' : !V ? 'loading' : 'ready';
  const ready = state === 'ready';
  const accts = ready ? V.accounts : [];
  const acctChips = (form, key, cur, onlyCur, emptyLabel) => [{ id: '', name: emptyLabel || 'no account' }].concat(accts.filter((a) => !onlyCur || a.currency === onlyCur)).map((a) => chip(cur === a.id, () => this.mnyField(form, key, a.id), a.name));
  // a draft field the owner touched (even cleared to '') wins over the default: what is shown is what Save sends
  const touched = (form, key) => !!(d[form] && d[form][key] != null);

  // ---- today ----
  const logCur = field('log', 'currency'), logAcct = touched('log', 'accountId') ? d.log.accountId : (accts[0] ? accts[0].id : '');
  const acctForm = d.acct || null;
  const accounts = accts.map((a) => ({ ...a, confirm: () => this.mnyOpen('acct', { id: a.id, name: a.name, currency: a.currency, balance: '' }), archive: () => this.mnyAsk('account-archive', { id: a.id }, 'Archive ' + a.name + '? Its history stays.') }));
  const recent = ready ? V.recent.map((t) => ({ ...t, meta: [t.day, t.account, t.note].filter(Boolean).join(' · '), undo: () => this.mnyApply({ type: 'tx-undo', id: t.id }), canUndo: !t.isBill })) : [];

  // ---- runway ----
  const bill = d.bill || null, pay = d.pay || null;
  const payBill = pay && ready ? V.obligations.find((o) => o.id === pay.id) : null, payBillHasAcct = !!(payBill && payBill.accountId);
  const obligations = ready ? V.obligations.map((o) => ({ ...o, color: o.isLate ? 'var(--red)' : o.isSoon ? 'var(--orange)' : o.isDone ? 'var(--faint)' : 'var(--muted)',
    meta: [o.due, o.dueLabel, o.installment, o.beforePayday > 1 ? o.beforePayday + '× before payday' : ''].filter(Boolean).join(' · '),
    payOpen: !!pay && pay.id === o.id, pay: () => this.mnyOpen('pay', { id: o.id, amount: '', accountId: o.accountId || (accts[0] ? accts[0].id : '') }),
    undo: () => this.mnyApply({ type: 'obligation-unpay', paymentId: o.undoId }), hasUndo: !!o.undoId,
    edit: () => this.mnyOpen('bill', { id: o.id, name: o.name, amount: String(o.rawAmount), currency: o.currency, kind: o.kind, cadence: o.cadence, firstDue: o.firstDue, accountId: o.accountId, installmentTotal: String(o.total), paidBefore: String(o.paidBefore), nextStep: o.nextStep }),
    archive: () => this.mnyAsk('obligation-archive', { id: o.id }, 'Archive ' + o.name + '? Paid history stays in the ledger.') })) : [];
  const billKind = bill ? bill.kind || 'bill' : 'bill', billCad = bill ? bill.cadence || 'monthly' : 'monthly';

  // ---- jars ----
  const move = d.move || null, cover = d.cover || null, jarForm = d.jar || null, payday = d.payday || null;
  const jars = ready ? V.jars.map((j) => ({ ...j, color: j.overspent ? 'var(--red)' : j.reached ? 'var(--green)' : 'var(--gold)',
    status: j.overspent ? 'overspent — cover it from another jar' : j.reached ? 'target reached' : j.onTrack ? 'on track with your payday split' : j.offTrack ? 'your split is below this pace' : '',
    moveOpen: !!move && move.jarId === j.id, coverOpen: !!cover && cover.toJarId === j.id,
    topup: () => this.mnyOpen('move', { jarId: j.id, kind: 'topup', amount: '' }), take: () => this.mnyOpen('move', { jarId: j.id, kind: 'withdraw', amount: '' }),
    coverIt: () => this.mnyOpen('cover', { toJarId: j.id, fromJarId: '', amount: String(Math.ceil(-j.raw)) }),
    coverFrom: V.jars.filter((o) => o.id !== j.id && o.raw > 0).map((o) => chip(!!cover && cover.fromJarId === o.id, () => this.mnyField('cover', 'fromJarId', o.id), o.name + ' · ' + o.balance)),
    edit: () => this.mnyOpen('jar', { id: j.id, name: j.name, target: String(j.targetRaw), targetDate: j.targetDate }),
    archive: () => this.mnyAsk('jar-archive', { id: j.id }, 'Archive the ' + j.name + ' jar? Its moves stay in history.'),
    splitVal: d.split && d.split[j.id] != null ? d.split[j.id] : j.split ? String(j.split) : '', onSplit: (e) => this.mnySplit(j.id, e.target.value) })) : [];

  // ---- inbox ----
  const slips = ready ? V.slips.map((c) => {
    const pick = (d.slip && d.slip[c.id]) || {}, cat = pick.category || c.category, acc = pick.accountId != null ? pick.accountId : (accts.find((a) => a.currency === c.currency) || {}).id || '';
    const armed = !!(d.armed && d.armed[c.id]);
    return { ...c, notesList: c.notes.map((n) => ({ text: n })), hasNotes: c.notes.length > 0, armed, warnLine: armed && c.warn ? 'This looks like ' + c.warn + '. Tap confirm anyway to log it.' : '',
      cats: c.refund ? [] : V.categories.map((k) => chip(cat === k, () => this.mnySlip(c.id, { category: k }), k.toLowerCase())),
      accts: [{ id: '', name: c.refund ? 'just note it' : 'no account' }].concat(accts.filter((a) => !c.refund || a.currency === c.currency)).map((a) => chip(acc === a.id, () => this.mnySlip(c.id, { accountId: a.id }), a.name)),
      confirmLabel: c.refund ? (acc ? 'Add back to balance' : 'Noted') : armed ? 'Confirm anyway' : 'Confirm', rejectLabel: c.warn || c.refund ? 'Not a spend' : 'Reject',
      confirm: () => this.mnyConfirmSlip(c, cat, acc), reject: () => this.mnyApply({ type: 'inbox-reject', id: c.id }) };
  }) : [];

  return {
    mnyOffline: state === 'offline', mnyError: state === 'error', mnyErrorText: M.error || '', mnyLoading: state === 'loading', mnyReady: ready, mnyBusy: busy, mnyNote: d.note || '',
    mnyIsToday: isToday, mnyIsRunway: isRunway, mnyIsJars: isJars, mnyIsInbox: isInbox,
    mnyRetry: () => this.store.refreshMoney(), mnyImport: () => this.mnyImport(), mnyExport: () => this.mnyExport(),
    mnyScrubbed: !live && can, mnyHasAsk: !!d.ask, mnyAskText: d.ask ? d.ask.question : '', mnyAskYes: () => this.mnyAskYes(), mnyAskNo: () => this.mnyAskNo(),
    // today
    mnyNoAccounts: ready && !V.hasAccounts, mnyHasAccounts: ready && V.hasAccounts,
    mnyRoom: ready ? V.room : {}, mnyRoomColor: ready && V.room.tight ? 'var(--orange)' : 'var(--text)', mnyRoomMissing: ready && V.room.missingFx,
    mnyAccounts: accounts, mnyAcctOpen: !!acctForm, mnyAcctTitle: acctForm && acctForm.id ? 'Confirm ' + acctForm.name + ' — what is in it right now?' : 'Add an account',
    mnyAcctName: field('acct', 'name'), onMnyAcctName: onField('acct', 'name'), mnyAcctBalance: field('acct', 'balance'), onMnyAcctBalance: onField('acct', 'balance'), mnyAcctIsNew: !!acctForm && !acctForm.id,
    mnyAcctCur: ['DA', 'USD'].map((c) => chip(field('acct', 'currency') === c || (!field('acct', 'currency') && c === 'DA'), () => this.mnyField('acct', 'currency', c), c === 'USD' ? 'USD (RedotPay)' : 'DA')),
    mnyAcctAdd: () => this.mnyOpen('acct', { name: '', currency: 'DA', balance: '' }), mnyAcctSave: () => this.mnySaveAccount(), mnyAcctKey: enter(() => this.mnySaveAccount()), mnyAcctCancel: () => this.mnyClose('acct'),
    mnyFx: touched('set', 'fx') ? d.set.fx : ready ? V.settings.fx : '', onMnyFx: onField('set', 'fx'), mnyPd: touched('set', 'payday') ? d.set.payday : ready ? V.settings.payday : '', onMnyPd: onField('set', 'payday'),
    mnySetSave: () => this.mnySaveSettings(), mnySetKey: enter(() => this.mnySaveSettings()), mnyNoFx: ready && !V.settings.hasFx,
    mnyLogAmount: field('log', 'amount'), onMnyLogAmount: onField('log', 'amount'), mnyLogNote: field('log', 'note'), onMnyLogNote: onField('log', 'note'), mnyLogKey: enter(() => this.mnyLog()), mnyLogGo: () => this.mnyLog(),
    mnyLogCur: ['DA', 'USD'].map((c) => chip(logCur === c, () => this.mnyField('log', 'currency', c), c)),
    mnyLogCats: ready ? V.categories.map((k) => chip(field('log', 'category') === k, () => this.mnyField('log', 'category', k), k.toLowerCase())) : [],
    mnyLogAccts: acctChips('log', 'accountId', logAcct), mnyRecent: recent, mnyHasRecent: recent.length > 0, mnyNoRecent: ready && recent.length === 0,
    mnyLedgerMore: ready && V.ledgerCount > recent.length ? 'showing the latest ' + recent.length + ' of ' + V.ledgerCount + ' entries' : '',
    // runway
    mnyPayday: ready ? V.payday : '', mnyDaysToPayday: ready ? String(V.daysToPayday) : '', mnyDueBefore: ready ? V.dueBefore : '', mnyDueMissing: ready && V.dueMissing > 0 ? V.dueMissing + ' USD bill(s) not counted — set your DA rate on today' : '',
    mnyObligations: obligations, mnyHasBills: obligations.length > 0, mnyNoBills: ready && obligations.length === 0,
    mnyBillOpen: !!bill, mnyBillTitle: bill && bill.id ? 'Edit ' + (bill.name || 'bill') : 'Add something that repeats', mnyBillAdd: () => this.mnyOpen('bill', { name: '', amount: '', currency: 'DA', kind: 'bill', cadence: 'monthly', firstDue: ready ? V.today : '', accountId: accts[0] ? accts[0].id : '', installmentTotal: '', paidBefore: '0', nextStep: '' }),
    mnyBillName: field('bill', 'name'), onMnyBillName: onField('bill', 'name'), mnyBillAmount: field('bill', 'amount'), onMnyBillAmount: onField('bill', 'amount'), mnyBillDue: field('bill', 'firstDue'), onMnyBillDue: onField('bill', 'firstDue'),
    mnyBillStep: field('bill', 'nextStep'), onMnyBillStep: onField('bill', 'nextStep'), mnyBillTotal: field('bill', 'installmentTotal'), onMnyBillTotal: onField('bill', 'installmentTotal'), mnyBillPaid: field('bill', 'paidBefore'), onMnyBillPaid: onField('bill', 'paidBefore'),
    mnyBillIsInst: billKind === 'installment', mnyBillNotInst: billKind !== 'installment',
    mnyBillKinds: [['bill', 'bill'], ['variable', 'varies'], ['subscription', 'subscription'], ['installment', 'installment']].map(([k, l]) => chip(billKind === k, () => this.mnyField('bill', 'kind', k), l)),
    mnyBillCads: ['monthly', 'weekly', 'yearly', 'once'].map((k) => chip(billCad === k, () => this.mnyField('bill', 'cadence', k), k)),
    mnyBillCur: ['DA', 'USD'].map((c) => chip((field('bill', 'currency') || 'DA') === c, () => this.mnyField('bill', 'currency', c), c)),
    mnyBillAccts: acctChips('bill', 'accountId', field('bill', 'accountId')), mnyBillSave: () => this.mnySaveBill(), mnyBillCancel: () => this.mnyClose('bill'),
    mnyPayAmount: field('pay', 'amount'), onMnyPayAmount: onField('pay', 'amount'), mnyPayAccts: acctChips('pay', 'accountId', field('pay', 'accountId'), null, payBillHasAcct ? 'bill’s account' : ''), mnyPayGo: () => this.mnyPay(), mnyPayKey: enter(() => this.mnyPay()), mnyPayCancel: () => this.mnyClose('pay'),
    // jars
    mnyJars: jars, mnyHasJars: jars.length > 0, mnyNoJars: ready && jars.length === 0, mnyJarOpen: !!jarForm, mnyJarTitle: jarForm && jarForm.id ? 'Edit ' + (jarForm.name || 'jar') : 'New jar',
    mnyJarAdd: () => this.mnyOpen('jar', { name: '', target: '', targetDate: '' }), mnyJarPresets: [['Emergency', '150000'], ['Eid', '30000'], ['Ramadan', '25000'], ['Rentrée', '20000'], ['Bills', '15000']].map(([n, t]) => chip(false, () => this.mnyOpen('jar', { name: n, target: t, targetDate: '' }), n.toLowerCase())),
    mnyJarName: field('jar', 'name'), onMnyJarName: onField('jar', 'name'), mnyJarTarget: field('jar', 'target'), onMnyJarTarget: onField('jar', 'target'), mnyJarDate: field('jar', 'targetDate'), onMnyJarDate: onField('jar', 'targetDate'),
    mnyJarSave: () => this.mnySaveJar(), mnyJarCancel: () => this.mnyClose('jar'),
    mnyMoveAmount: field('move', 'amount'), onMnyMoveAmount: onField('move', 'amount'), mnyMoveLabel: move && move.kind === 'withdraw' ? 'Take out' : 'Add', mnyMoveGo: () => this.mnyMove(), mnyMoveKey: enter(() => this.mnyMove()), mnyMoveCancel: () => this.mnyClose('move'),
    mnyCoverAmount: field('cover', 'amount'), onMnyCoverAmount: onField('cover', 'amount'), mnyCoverGo: () => this.mnyCover(), mnyCoverCancel: () => this.mnyClose('cover'),
    mnySplitTotal: ready ? V.splitTotal : '', mnySplitSave: () => this.mnySaveSplit(), mnyPaydayOpen: !!payday, mnyPaydayStart: () => this.mnyOpen('payday', { amount: '', accountId: accts.find((a) => a.currency === 'DA') ? accts.find((a) => a.currency === 'DA').id : '' }),
    mnyPaydayAmount: field('payday', 'amount'), onMnyPaydayAmount: onField('payday', 'amount'), mnyPaydayAccts: accts.map((a) => chip(field('payday', 'accountId') === a.id, () => this.mnyField('payday', 'accountId', a.id), a.name)),
    mnyPaydayGo: () => this.mnyPaydayRun(), mnyPaydayCancel: () => this.mnyClose('payday'),
    // inbox
    mnyPasteText: field('paste', 'text'), onMnyPasteText: onField('paste', 'text'), mnyPasteFrom: field('paste', 'from'), onMnyPasteFrom: onField('paste', 'from'), mnyPasteGo: () => this.mnyPaste(),
    mnySlips: slips, mnyHasSlips: slips.length > 0, mnyNoSlips: ready && slips.length === 0, mnyHandled: ready && V.handled > 0 ? V.handled + ' handled' : '', mnyClear: () => this.mnyApply({ type: 'inbox-clear' }),
  };
}
