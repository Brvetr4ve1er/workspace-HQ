// Settings > "Launcher": the owner's folders, files, apps and links (every add opens the system dialog), the editor Open workspace uses, the terminal it
// will use, and the dev commands the owner allowed (Allow this command / Remove permission).
// <!-- v5: Launcher --> new fragment, interpolated into tpl/ov-settings.tpl.js after the Money block; it wraps itself in lnchv.show (ONE vals key), so
// with Settings closed there is no node. dc-lite dialect only: dotted paths, !, ===; everything arrives finished from vals/launcher.js. Tokens only
// (var(--...)); nothing animates.
const HEAD = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px';
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi)"';
const ROW = 'display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--frame);flex-wrap:wrap';
const SUB = 'font-family:var(--term);font-size:11px;color:var(--faint)';

export default String.raw`        <!-- v5: Launcher (batch 9) — your folders, files, apps and links; the editor and terminal Open workspace uses; the dev commands you allowed -->
        <sc-if value="{{ lnchv.show }}" hint-placeholder-val="{{ false }}">
          <section data-lnch="section" aria-label="Launcher" style="display:flex;flex-direction:column;gap:6px">
            <sc-if value="{{ lnchv.offline }}" hint-placeholder-val="{{ false }}"><div data-lnch="offline" style="font-size:13px;color:var(--muted);margin-top:18px">{{ lnchv.offlineText }}</div></sc-if>
            <sc-if value="{{ lnchv.hasBody }}" hint-placeholder-val="{{ true }}">
              <div style="${HEAD};display:flex;align-items:center;gap:10px"><span style="flex:1">{{ lnchv.title }}</span><span data-lnch="summary" style="color:var(--muted)">{{ lnchv.summary }}</span><button type="button" data-lnch="refresh" onClick="{{ lnchv.refresh }}" disabled="{{ lnchv.refreshOff }}" aria-label="Refresh the Launcher" style="${BTN}" ${BTN_HOVER}>{{ lnchv.refreshLabel }}</button></div>
              <div style="font-size:12px;color:var(--muted)">{{ lnchv.note }}</div>
              <sc-if value="{{ lnchv.loading }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--muted)">{{ lnchv.loadingText }}</div></sc-if>
              <sc-if value="{{ lnchv.hasErr }}" hint-placeholder-val="{{ false }}"><div data-lnch="error" role="alert" style="font-size:13px;color:var(--red)">{{ lnchv.errText }}</div></sc-if>
              <sc-if value="{{ lnchv.locked }}" hint-placeholder-val="{{ false }}"><div data-lnch="locked" role="alert" style="font-size:13px;color:var(--orange)">{{ lnchv.lockedText }}</div></sc-if>
              <sc-if value="{{ lnchv.hasNotice }}" hint-placeholder-val="{{ false }}"><div data-lnch="notice" role="status" style="font-size:13px;color:{{ lnchv.noticeColor }}">{{ lnchv.notice }}</div></sc-if>
              <sc-if value="{{ lnchv.ready }}" hint-placeholder-val="{{ true }}">
                <div style="${SUB}">Entries</div>
                <sc-if value="{{ lnchv.hasEntries }}" hint-placeholder-val="{{ true }}">
                  <div data-lnch="entries" style="display:flex;flex-direction:column">
                    <sc-for list="{{ lnchv.entries }}" as="e" hint-placeholder-count="4">
                      <div data-lnch="entry" data-lnch-id="{{ e.id }}" style="${ROW}">
                        <span aria-hidden="true" style="width:18px;text-align:center;color:var(--gold)">{{ e.icon }}</span>
                        <span style="flex:1;min-width:0;font-size:14px;overflow-wrap:anywhere"><span data-lnch="name">{{ e.name }}</span> <span style="${SUB}">{{ e.kindText }}</span><sc-if value="{{ e.hasHost }}" hint-placeholder-val="{{ false }}"> <span style="${SUB}">{{ e.host }}</span></sc-if></span>
                        <sc-if value="{{ e.isApp }}" hint-placeholder-val="{{ false }}"><button type="button" data-lnch="set-editor" onClick="{{ e.setEditor }}" disabled="{{ e.off }}" aria-label="{{ e.editorAria }}" style="${BTN}" ${BTN_HOVER}>{{ e.editorLabel }}</button></sc-if>
                        <button type="button" data-lnch="open" onClick="{{ e.open }}" disabled="{{ e.off }}" aria-label="{{ e.openAria }}" style="${BTN}" ${BTN_HOVER}>{{ e.openLabel }}</button>
                        <button type="button" data-lnch="remove" onClick="{{ e.remove }}" disabled="{{ e.off }}" aria-label="{{ e.removeAria }}" style="${BTN};color:var(--red)" ${BTN_HOVER}>{{ e.removeLabel }}</button>
                      </div>
                    </sc-for>
                  </div>
                </sc-if>
                <sc-if value="{{ !lnchv.hasEntries }}" hint-placeholder-val="{{ false }}"><div data-lnch="empty" style="font-size:13px;color:var(--muted)">{{ lnchv.emptyText }}</div></sc-if>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                  <sc-for list="{{ lnchv.adds }}" as="a" hint-placeholder-count="4"><button type="button" data-lnch="add" data-lnch-kind="{{ a.kind }}" onClick="{{ a.go }}" disabled="{{ a.off }}" aria-label="{{ a.aria }}" style="${BTN}" ${BTN_HOVER}>{{ a.label }}</button></sc-for>
                </div>

                <div style="${SUB};margin-top:12px">{{ lnchv.editorTitle }}</div>
                <div data-lnch="editor" style="font-size:14px">{{ lnchv.editorText }}</div>
                <div style="font-size:12px;color:var(--muted)">{{ lnchv.editorHint }}</div>
                <div style="${SUB};margin-top:8px">{{ lnchv.terminalTitle }}</div>
                <div data-lnch="terminal" style="font-size:14px">{{ lnchv.terminalText }}</div>

                <div style="${SUB};margin-top:12px">{{ lnchv.cmdsTitle }}</div>
                <div style="font-size:12px;color:var(--muted)">{{ lnchv.cmdsNote }}</div>
                <sc-if value="{{ lnchv.hasCmds }}" hint-placeholder-val="{{ true }}">
                  <div data-lnch="cmds" style="display:flex;flex-direction:column">
                    <sc-for list="{{ lnchv.cmds }}" as="c" hint-placeholder-count="3">
                      <div data-lnch="cmd" data-lnch-id="{{ c.id }}" style="${ROW}">
                        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:14px;overflow-wrap:anywhere">{{ c.name }}</span><code data-lnch="cmd-text" style="font-family:var(--term);font-size:12px;color:var(--muted);overflow-wrap:anywhere">{{ c.text }}</code><span data-lnch="cmd-state" style="font-size:12px;color:{{ c.stateColor }}">{{ c.stateText }}</span></span>
                        <sc-if value="{{ c.canAllow }}" hint-placeholder-val="{{ false }}"><button type="button" data-lnch="allow" onClick="{{ c.allow }}" disabled="{{ c.off }}" aria-label="{{ c.allowAria }}" style="${BTN}" ${BTN_HOVER}>{{ c.allowLabel }}</button></sc-if>
                        <sc-if value="{{ c.allowed }}" hint-placeholder-val="{{ false }}"><button type="button" data-lnch="forget" onClick="{{ c.forget }}" disabled="{{ c.off }}" aria-label="{{ c.forgetAria }}" style="${BTN}" ${BTN_HOVER}>{{ c.forgetLabel }}</button></sc-if>
                      </div>
                    </sc-for>
                  </div>
                </sc-if>
                <sc-if value="{{ !lnchv.hasCmds }}" hint-placeholder-val="{{ false }}"><div data-lnch="cmds-empty" style="font-size:13px;color:var(--muted)">{{ lnchv.cmdsEmpty }}</div></sc-if>
              </sc-if>
            </sc-if>
          </section>
        </sc-if>
`;
