// Money for Claude sessions (Settings): one card, one switch, OFF on a fresh install.
// <!-- v5: Money access --> new fragment, interpolated into tpl/ov-settings.tpl.js as ${moneyAccess} (next to ${reach}).
// dc-lite dialect only: dotted paths, !, ===; every value arrives finished from vals/money-access.js.
const HEAD = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px';

export default String.raw`        <!-- v5: Money access — may Claude sessions read Money as words? off until the owner turns it on -->
        <sc-if value="{{ macShow }}" hint-placeholder-val="{{ true }}">
          <section aria-label="Money for Claude sessions" style="display:flex;flex-direction:column;gap:6px">
            <div style="${HEAD}">Money · Claude sessions</div>
            <div style="display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px dashed var(--frame)">
              <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
                <div style="font-size:15px">{{ macTitle }}</div>
                <div style="font-size:12px;color:var(--muted)">{{ macExplain }}</div>
                <div style="font-size:12px;color:var(--muted)">{{ macNever }}</div>
                <div style="font-size:12px;color:var(--orange)">{{ macWarn }}</div>
                <sc-if value="{{ macHasAsked }}" hint-placeholder-val="{{ true }}"><div style="font-size:12px;color:var(--faint)">{{ macAsked }}</div></sc-if>
              </div>
              <button type="button" onClick="{{ macToggle }}" disabled="{{ macSwitchDisabled }}" role="switch" aria-checked="{{ macOn }}" aria-label="{{ macSwitchLabel }}" style="{{ macSwitchStyle }}">{{ macStateText }}</button>
            </div>
            <sc-if value="{{ macOffline }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">{{ macOfflineText }}</div></sc-if>
            <sc-if value="{{ macLoading }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Checking the switch…</div></sc-if>
            <sc-if value="{{ macHasErr }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--red)">{{ macErrText }}</div></sc-if>
          </section>
        </sc-if>
`;
