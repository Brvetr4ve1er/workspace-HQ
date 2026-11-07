// Reach block in Settings — whether each door to the assistant is open, with its one missing step and a Copy button for commands.
// <!-- v5: Reach --> new fragment, interpolated into tpl/ov-settings.tpl.js under "Global hotkeys". dc-lite dialect only: dotted paths, !, ===;
// everything arrives finished from vals/reach.js (rows computed main-side by dashboard/reach.js). Read-only: nothing here changes a setting.
const HEAD = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px';
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';

export default String.raw`        <!-- v5: Reach — which doors to the assistant are open (phone, every session, browser, tray), read-only -->
        <sc-if value="{{ rchShow }}" hint-placeholder-val="{{ true }}">
          <section aria-label="Reach: which doors to the assistant are open" style="display:flex;flex-direction:column;gap:6px">
            <div style="${HEAD};display:flex;align-items:center;gap:10px"><span style="flex:1">Reach · where the assistant can find you</span><span style="color:var(--muted)">{{ rchSummary }}</span><button type="button" onClick="{{ rchRefresh }}" disabled="{{ rchBusy }}" aria-label="Check the doors again" style="${BTN}" ${BTN_HOVER}>Check again</button></div>
            <sc-if value="{{ rchOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reach needs the desktop app’s reach module (hq.reach) — no door can be checked without it.</div></sc-if>
            <sc-if value="{{ rchError }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--red)">Couldn’t check the doors · {{ rchErrorText }}</div></sc-if>
            <sc-if value="{{ rchLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Checking the doors…</div></sc-if>
            <sc-if value="{{ rchReady }}" hint-placeholder-val="{{ true }}">
              <div role="list" style="display:flex;flex-direction:column">
                <sc-for list="{{ rchRows }}" as="r" hint-placeholder-count="5">
                  <div role="listitem" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;padding:10px 0;border-bottom:1px dashed var(--frame)">
                    <span style="{{ r.stateStyle }}">{{ r.stateText }}</span>
                    <div style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:3px">
                      <div style="font-size:14px;color:var(--text)">{{ r.label }}</div>
                      <div style="font-size:12px;color:var(--muted)">{{ r.detail }}</div>
                      <sc-if value="{{ r.hasNext }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">{{ r.next }}</div></sc-if>
                    </div>
                    <sc-if value="{{ r.hasCopy }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ r.copy }}" aria-label="{{ r.copyAria }}" style="${BTN}" ${BTN_HOVER}>{{ r.copyLabel }}</button></sc-if>
                  </div>
                </sc-for>
              </div>
              <sc-if value="{{ rchStaleError }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">The last check failed · {{ rchErrorText }} · showing the previous rows</div></sc-if>
            </sc-if>
          </section>
        </sc-if>
`;
