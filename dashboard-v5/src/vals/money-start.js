// Money start card + quick line render values (Money › Today). Keys are mst-prefixed — one shared namespace with every
// other surface. Everything arrives finished from main (the preview is main's dry answer: dashboard/money/quicklog.mjs);
// this module only shapes it. Honest states: no bridge · saving · refused (main's words) · previewing nothing yet.
const PLACEHOLDER = '150 cafe · taxi 400 · $12.49 netflix card · hier taxi 400';
const TONE = { log: 'var(--green)', slip: 'var(--orange)', none: 'var(--muted)' };

export function moneyStartVals(ctx) {
  const { S } = ctx;
  const d = S.mst || {}, card = d.card || {}, can = !!(this.hq && this.hq.money && this.hq.money.apply);
  const busy = !!d.saving || !!(S.mny || {}).busy;
  const field = (key) => (card[key] != null ? card[key] : '');
  const onCard = (key) => (e) => this.mstCardField(key, e.target.value);
  const enter = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

  const p = d.preview || null;
  const previewText = !p ? '' : p.kind === 'none' ? (p.reason || 'not a spend line') : p.kind === 'slip' ? `${p.label} → Inbox to confirm: ${p.reason}` : p.label;
  const hasLine = String(d.line || '').trim() !== '';
  return {
    // honest read-only reason: the card and the line are only mounted under a ready money view, but never pretend a write works
    mstReadOnly: !can, mstReadOnlyText: 'Money writes need the desktop app’s money module (hq.money) — nothing here can be saved without it.',

    // ---- start card ----
    mstCashDA: field('cashDA'), onMstCashDA: onCard('cashDA'),
    mstBankDA: field('bankDA'), onMstBankDA: onCard('bankDA'),
    mstCardUSD: field('cardUSD'), onMstCardUSD: onCard('cardUSD'),
    mstFx: field('fx'), onMstFx: onCard('fx'),
    mstPayday: field('payday'), onMstPayday: onCard('payday'),
    mstStartKey: enter(() => this.mstStart()), mstStartGo: () => this.mstStart(),
    mstStartBusy: busy, mstStartLabel: d.saving ? 'Starting…' : 'Start',
    mstHasRefused: !!d.refused, mstRefusedText: d.refused || '',
    mstStartHint: 'Everything is optional except one balance. The rate is DA per 1 USD; payday is a day from 1 to 28. Nothing leaves this PC.',

    // ---- quick line ----
    mstLine: d.line || '', onMstLine: (e) => this.mstLineChange(e.target.value),
    mstLineKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.mstLogLine(); } else if (e.key === 'Escape' && hasLine) { e.preventDefault(); this.mstLineClear(); } },
    mstLineGo: () => this.mstLogLine(),
    mstLineCanSend: hasLine && !busy,
    mstPlaceholder: PLACEHOLDER,
    mstHasPreview: !!p && hasLine, mstPreviewText: previewText, mstPreviewColor: TONE[p && p.kind] || TONE.none,
    mstHasPreviewErr: !!d.previewErr && hasLine && !p, mstPreviewErrText: d.previewErr ? 'Couldn’t read the line · ' + d.previewErr : '',
    mstHasLineError: !!d.lineError, mstLineErrorText: d.lineError || '',
    mstHasNote: !!d.note && !hasLine && !d.lineError, mstNoteText: d.note || '',
  };
}
