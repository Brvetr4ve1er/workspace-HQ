// Brief panel (heads Home) — spec docs/superpowers/specs/2026-11-05-operator-design.md, UI section.
// <!-- v5: Operator Brief --> new fragment, interpolated into tpl/home.tpl.js under the greeting. dc-lite dialect only:
// dotted paths, !, ===; everything arrives finished from vals/brief.js (computed main-side by dashboard/brief-core.mjs).
// Button strings match the other fragments' (money.tpl.js BTN / GOLD).
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const CARD = 'padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px';

export default String.raw`            <!-- v5: Operator Brief — the 1–3 things that need the owner now, ranked main-side -->
            <sc-if value="{{ brfShow }}" hint-placeholder-val="{{ true }}">
              <section aria-label="Brief: what needs you now" style="display:flex;flex-direction:column;gap:10px;margin-bottom:26px;max-width:900px">
                <div style="${LABEL}">brief · what needs you now</div>
                <sc-if value="{{ brfOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">The Brief needs the desktop app’s brief module (hq.brief) — nothing is ranked without it.</div></sc-if>
                <sc-if value="{{ brfError }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--red)">Couldn’t build the brief · {{ brfErrorText }}</div></sc-if>
                <sc-if value="{{ brfLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reading what needs you…</div></sc-if>
                <sc-if value="{{ brfEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--green)">{{ brfEmptyText }}</div></sc-if>
                <sc-if value="{{ brfReady }}" hint-placeholder-val="{{ true }}">
                  <div role="list" style="display:flex;flex-direction:column;gap:8px">
                    <sc-for list="{{ brfItems }}" as="i" hint-placeholder-count="3">
                      <div role="listitem" style="${CARD};display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
                        <span style="{{ i.sevStyle }}">{{ i.sevLabel }}</span>
                        <div style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:3px">
                          <div style="font-size:14px;color:var(--text)">{{ i.text }}</div>
                          <div style="font-size:12px;color:var(--muted)">{{ i.why }}</div>
                          <div style="font-size:11px;color:var(--faint)">{{ i.meta }}</div>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                          <button type="button" onClick="{{ i.act }}" style="${GOLD}" ${GOLD_HOVER}>{{ i.actLabel }}</button>
                          <button type="button" onClick="{{ i.dismiss }}" disabled="{{ brfBusy }}" aria-label="Dismiss until it changes" title="Hidden until the fact behind it changes" style="${BTN}" ${BTN_HOVER}>Dismiss</button>
                        </div>
                      </div>
                    </sc-for>
                  </div>
                  <sc-if value="{{ brfHasMore }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--muted)">{{ brfMoreText }} · dismiss one to see the next</div></sc-if>
                </sc-if>
                <!-- v5: Brief standing line — items unchanged for 3 days step aside here, each still one click from where it is cleared -->
                <sc-if value="{{ brfHasStanding }}" hint-placeholder-val="{{ false }}">
                  <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:12px;color:var(--muted)">
                    <span>{{ brfStandingLead }}</span>
                    <sc-for list="{{ brfStanding }}" as="s" hint-placeholder-count="2">
                      <span style="display:inline-flex;align-items:baseline;gap:8px"><span aria-hidden="true">{{ s.sep }}</span><button type="button" onClick="{{ s.act }}" title="{{ s.tip }}" style="background:none;border:0;padding:0;font:inherit;color:var(--text);text-decoration:underline;text-underline-offset:2px;cursor:pointer;text-align:left">{{ s.text }}</button></span>
                    </sc-for>
                  </div>
                </sc-if>
                <sc-if value="{{ brfHasSourceErrors }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">{{ brfSourceErrorsText }}</div></sc-if>
              </section>
            </sc-if>
`;
