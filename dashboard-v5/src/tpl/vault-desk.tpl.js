// Life > Notes > the Vault desk: today's daily note read-only, one capture line, the recent note names and Open in Obsidian. <!-- v5: Vault desk -->
// new fragment, interpolated by tpl/life.tpl.js at the head of the Notes branch. It wraps itself in vdkv.on (true only on Life > Notes), so the
// integrator places it without a condition of its own. dc-lite dialect only: dotted paths, !, ===; EVERY value is one key under vdkv, finished by
// vals/vault-desk.js (answer from main: dashboard/vault-desk.js). The note text is bound as TEXT only, never as markup or a style.
// Colours are tokens only (var(--...)); the gold ink #1a0f0a is the one literal, as in the other fragments.
import { wbnArt } from './workbench.tpl.js';   // <!-- v5: Workbench art --> one small illustration, drawn only while the Workbench look is on
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const INPUT = 'flex:1 1 280px;min-width:0;height:30px;padding:0 10px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);font-size:12px';

export default String.raw`                <!-- v5: Life › Notes › Vault desk — today's daily note read-only, one capture line appended to it, the recent note names -->
                <sc-if value="{{ vdkv.on }}" hint-placeholder-val="{{ false }}">
                  <section data-vdk="view" aria-label="Vault desk: today's daily note" style="display:flex;flex-direction:column;gap:12px;padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                    <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span style="font-size:19px">Vault desk</span><span data-vdk="title" style="${LABEL}">{{ vdkv.noteTitle }}</span><span style="flex:1"></span><sc-if value="{{ vdkv.canOpen }}" hint-placeholder-val="{{ false }}"><button type="button" data-vdk="open" onClick="{{ vdkv.open }}" style="${BTN}" ${BTN_HOVER}>Open in Obsidian</button></sc-if><button type="button" data-vdk="refresh" onClick="{{ vdkv.refresh }}" disabled="{{ vdkv.refreshOff }}" style="${BTN}" ${BTN_HOVER}>{{ vdkv.refreshLabel }}</button></div>
                    ${wbnArt('notes')}
                    <sc-if value="{{ vdkv.offline }}" hint-placeholder-val="{{ false }}"><div data-vdk="offline" style="font-size:13px;color:var(--muted)">{{ vdkv.offlineText }}</div></sc-if>
                    <sc-if value="{{ vdkv.loading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Reading today’s note…</div></sc-if>
                    <sc-if value="{{ vdkv.error }}" hint-placeholder-val="{{ false }}"><div role="status" data-vdk="error" style="font-size:13px;color:var(--red)">Couldn’t read the vault · {{ vdkv.errorText }}</div></sc-if>
                    <sc-if value="{{ vdkv.ready }}" hint-placeholder-val="{{ true }}">
                      <div style="display:flex;flex-direction:column;gap:12px">
                        <div data-vdk="where" style="font-size:12px;color:var(--faint)">{{ vdkv.where }}</div>
                        <sc-if value="{{ vdkv.hasStateWords }}" hint-placeholder-val="{{ false }}"><div data-vdk="state" style="font-size:13px;color:var(--muted)">{{ vdkv.stateWords }}</div></sc-if>
                        <sc-if value="{{ vdkv.hasNote }}" hint-placeholder-val="{{ true }}"><pre data-vdk="note" tabindex="0" role="region" aria-label="Today’s note" style="margin:0;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--term);font-size:12px;line-height:1.5;color:var(--text);padding:10px 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px">{{ vdkv.noteText }}</pre></sc-if>
                        <sc-if value="{{ vdkv.emptyNote }}" hint-placeholder-val="{{ false }}"><div data-vdk="empty-note" style="font-size:13px;color:var(--muted)">{{ vdkv.emptyNoteText }}</div></sc-if>
                        <sc-if value="{{ vdkv.truncated }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--faint)">{{ vdkv.truncatedText }}</div></sc-if>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input data-vdk="line" value="{{ vdkv.line }}" onChange="{{ vdkv.onLine }}" onKeyDown="{{ vdkv.onKey }}" disabled="{{ !vdkv.canType }}" aria-label="Capture a line into today's note" placeholder="Capture a line, press Enter" autocomplete="off" style="${INPUT}"><button type="button" data-vdk="send" onClick="{{ vdkv.send }}" disabled="{{ !vdkv.canSend }}" style="${GOLD}" ${GOLD_HOVER}>{{ vdkv.sendLabel }}</button></div>
                        <div style="font-size:12px;color:var(--faint)">{{ vdkv.lineNote }}</div>
                        <sc-if value="{{ vdkv.hasRecent }}" hint-placeholder-val="{{ true }}">
                          <div style="display:flex;flex-direction:column;gap:6px">
                            <span style="${LABEL}">{{ vdkv.recentLabel }}</span>
                            <div role="list" data-vdk="recent" style="display:flex;flex-direction:column">
                              <sc-for list="{{ vdkv.recent }}" as="n" hint-placeholder-count="3"><div role="listitem" data-vdk="recent-row" style="padding:6px 4px;border-bottom:1px dashed var(--frame);font-size:13px;word-break:break-word">{{ n.name }}</div></sc-for>
                            </div>
                          </div>
                        </sc-if>
                      </div>
                    </sc-if>
                  </section>
                </sc-if>
`;
