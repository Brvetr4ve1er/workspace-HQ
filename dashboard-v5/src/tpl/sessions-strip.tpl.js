// Home strip: up to 3 Claude Code sessions running, waiting or stopped in the last 2 hours (the Resume Rail's successor).
// <!-- v5: Sessions strip --> new fragment, interpolated into tpl/home.tpl.js right after ${brief}. Absent when there are none
// (sbdStripShow false). dc-lite dialect only; everything arrives finished from vals/sessions-board.js.
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const CARD = 'padding:10px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;cursor:pointer;text-align:left;width:100%;font-family:inherit;color:inherit';

export default String.raw`            <!-- v5: Sessions strip — Claude Code sessions that need a look, from the sessions board -->
            <sc-if value="{{ sbdStripShow }}" hint-placeholder-val="{{ false }}">
              <section aria-label="Claude sessions that need a look" style="display:flex;flex-direction:column;gap:8px;margin-bottom:26px;max-width:900px">
                <div style="${LABEL}">claude sessions · running, waiting or stopped in the last 2 h</div>
                <sc-if value="{{ sbdStripHasNote }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:12px;color:var(--orange)">{{ sbdStripNote }}</div></sc-if>
                <div role="list" style="display:flex;flex-direction:column;gap:8px">
                  <sc-for list="{{ sbdStripCards }}" as="c" hint-placeholder-count="3">
                    <button type="button" role="listitem" onClick="{{ c.go }}" title="Open Claude › Sessions" style="${CARD}" style-hover="border-color:var(--frame-hi)">
                      <span style="{{ c.stateStyle }}">{{ c.stateLabel }}</span>
                      <span style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:3px">
                        <span style="font-size:14px;color:var(--text)">{{ c.title }}</span>
                        <span style="font-size:12px;color:var(--muted)">{{ c.sentence }}</span>
                        <span style="font-size:11px;color:var(--faint)">{{ c.project }} · last active {{ c.ago }}</span>
                      </span>
                    </button>
                  </sc-for>
                </div>
              </section>
            </sc-if>
`;
