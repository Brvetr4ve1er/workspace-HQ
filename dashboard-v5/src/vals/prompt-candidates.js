// Claude › Prompts › Candidates + the Promote dialog (spec 2026-10-15 §6.3, phase P2). Keys: hc*, isPrLib, isPrCand.
import { candidatesView } from '../live/adapter.mjs';

const TAB_ON = 'height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--purple);background:color-mix(in oklab,var(--purple) 14%,transparent);color:var(--text);cursor:pointer;font-size:12px';
const TAB_OFF = 'height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer;font-size:12px';
const NOTE = 'font-size:13px;color:var(--muted);border:1px dashed var(--frame);border-radius:10px;padding:12px 14px';
const ERR = 'font-size:13px;color:var(--tone-red);border:1px solid color-mix(in oklab,var(--tone-red) 45%,transparent);border-radius:10px;padding:12px 14px';

export function candidatesVals(ctx) {
  const S = this.state, cand = S.prView === 'candidates';
  const v = candidatesView(this.store.live.candidates, { hasBridge: !!this.store.bridge, selected: S.hcSel });
  const cant = !!ctx.cantWrite;
  const rows = v.rows.map((r) => ({ ...r, checkMark: r.selected ? '☑' : '☐',
    toggle: () => this.hcToggle(r.key), promote: () => this.hcAsk(r.key), hide: () => this.hcHide(r.key) }));
  const P = S.promote, single = !!P && P.items.length === 1, n = P ? P.items.length : 0;
  return {
    isPrLib: !cand, isPrCand: cand,
    hcTabLib: () => this.hcView('library'), hcTabCand: () => this.hcView('candidates'),
    hcLibStyle: cand ? TAB_OFF : TAB_ON, hcCandStyle: cand ? TAB_ON : TAB_OFF,
    hcState: v.state, hcText: v.text, hcHasText: !!v.text, hcTextStyle: v.state === 'error' ? ERR : NOTE,
    hcRows: rows, hcHasRows: rows.length > 0, hcPoolNote: v.poolNote, hcHasPool: !!v.poolNote,
    hcSelText: S.hcSel.length ? `${S.hcSel.length} ticked` : 'Tick candidates to promote several at once',
    hcHasSel: S.hcSel.length > 0, hcPromoteSel: () => this.hcAsk(), hcRefresh: () => this.hcLoad(),
    hcBusy: !!this.store.live.candidates.busy, hcCant: cant, hcCantTip: cant ? ctx.writeReason : '',
    hcOpen: !!P, hcSingle: single,
    hcHead: n === 1 ? 'Promote 1 prompt to your vault' : `Promote ${n} prompts to your vault`,
    hcWhere: 'Each becomes a NEW note in 40_Resources/Prompts, written exactly as shown (secrets already masked) — never over an existing note.',
    hcTitleVal: single ? P.items[0].title : '', hcOnTitle: (e) => this.hcTitle(e),
    hcItems: P ? P.items.map((i) => ({ title: i.title, text: i.text })) : [],
    hcAskPhase: !!P && P.phase === 'ask', hcSaving: !!P && P.phase === 'saving',
    hcClashPhase: !!P && P.phase === 'clash', hcDonePhase: !!P && P.phase === 'done',
    hcGo: () => this.hcGo(), hcGoText: n > 1 ? `Promote ${n}` : 'Promote',
    hcClashText: P && P.clash ? (P.clash.next
      ? `A note with this title's file name is already in the Prompts folder. Save this one as ${P.clash.next}? The existing note is not touched.`
      : 'A note with this name is already there, and -2 … -9 too. Cancel and change the title.') : '',
    hcCanSaveAs: !!(P && P.clash && P.clash.next), hcSaveAs: () => this.hcSaveAs(), hcCancel: () => this.hcCancel(),
    hcResults: P ? P.results.map((r) => ({ text: r.ok ? `${r.title} → ${r.name}` : `${r.title}: ${r.error}`, color: r.ok ? 'var(--green)' : 'var(--tone-red)' })) : [],
    hcStop: (e) => { if (e && e.stopPropagation) e.stopPropagation(); },
  };
}
