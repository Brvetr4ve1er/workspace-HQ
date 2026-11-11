// Brief history (dish brief-history, batch 3). <!-- v5: Brief history --> three fragments, dc-lite dialect only (dotted paths, !, ===); every value arrives
// finished from vals/brief-history.js (bhs* keys), which gets them from main's ledger answer.
//   default export  the Operator section: interpolated into tpl/history.tpl.js INSIDE the isTimeline block, above the weeks (no new History sub-view)
//   bhsFooter       one muted line "3 cleared this week · 1 dismissed": interpolated into tpl/brief.tpl.js at the end of the Brief section
//   bhsAllClear     the one-time all-clear card: interpolated into tpl/brief.tpl.js under the empty line
// Nothing here pushes or sends: the only action is "Got it", which tells main the card was shown.
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';

export const bhsFooter = String.raw`                <!-- v5: Brief history footer — cleared and dismissed this week, counted apart -->
                <sc-if value="{{ bhs.bhsFootShow }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted)">{{ bhs.bhsFootText }}</div></sc-if>
`;

export const bhsAllClear = String.raw`                <!-- v5: Brief all-clear — once per clear episode, only after something really resolved -->
                <sc-if value="{{ bhs.bhsCardShow }}" hint-placeholder-val="{{ false }}">
                  <section aria-label="Brief: all clear" style="padding:12px 14px;background:var(--card);border:1px solid var(--green);border-radius:12px;display:flex;flex-direction:column;gap:8px">
                    <div style="font-size:14px;color:var(--green)">{{ bhs.bhsCardTitle }}</div>
                    <div style="font-size:12px;color:var(--muted)">{{ bhs.bhsCardLead }}</div>
                    <div role="list" style="display:flex;flex-direction:column;gap:4px">
                      <sc-for list="{{ bhs.bhsCardLines }}" as="c" hint-placeholder-count="2"><div role="listitem" style="font-size:13px;color:var(--text)">{{ c.text }}</div></sc-for>
                    </div>
                    <div><button type="button" onClick="{{ bhs.bhsCardAck }}" disabled="{{ bhs.bhsCardBusy }}" style="${GOLD}" ${GOLD_HOVER}>{{ bhs.bhsCardAckLabel }}</button></div>
                  </section>
                </sc-if>
`;

export default String.raw`                <!-- v5: Brief history — what the Brief noticed and how each thing ended -->
                <sc-if value="{{ bhs.bhsOpShow }}" hint-placeholder-val="{{ false }}">
                  <section aria-label="Operator: what the Brief noticed" style="display:flex;flex-direction:column;gap:8px">
                    <div style="${LABEL}">{{ bhs.bhsOpHeading }}</div>
                    <sc-if value="{{ bhs.bhsOpOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ bhs.bhsOpOfflineText }}</div></sc-if>
                    <sc-if value="{{ bhs.bhsOpLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ bhs.bhsOpLoadingText }}</div></sc-if>
                    <sc-if value="{{ bhs.bhsOpError }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--red)">{{ bhs.bhsOpErrorText }}</div></sc-if>
                    <sc-if value="{{ bhs.bhsOpHasNotice }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">{{ bhs.bhsOpNoticeText }}</div></sc-if>
                    <sc-if value="{{ bhs.bhsOpEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ bhs.bhsOpEmptyText }}</div></sc-if>
                    <sc-if value="{{ bhs.bhsOpHas }}" hint-placeholder-val="{{ true }}">
                      <div role="list" style="display:flex;flex-direction:column">
                        <sc-for list="{{ bhs.bhsOpRows }}" as="r" hint-placeholder-count="3">
                          <div role="listitem" style="display:flex;gap:12px;align-items:baseline;padding:8px 4px;border-bottom:1px dashed var(--frame);font-size:13px;color:var(--text)"><span aria-hidden="true" style="width:22px;text-align:center;flex:0 0 auto;color:{{ r.glyphColor }}">{{ r.glyph }}</span><span style="flex:1;min-width:0">{{ r.line }}</span></div>
                        </sc-for>
                      </div>
                    </sc-if>
                    <sc-if value="{{ bhs.bhsOpHasSummary }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted)">{{ bhs.bhsOpSummary }}</div></sc-if>
                  </section>
                </sc-if>
`;
