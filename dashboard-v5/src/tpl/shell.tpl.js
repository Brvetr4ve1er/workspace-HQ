// Shell: root <div>, ascii backdrop, header, the read-only / no-bridge banners, the
// body row with the side rail, <main> and its content column, then the loading /
// error / screen-header states. What opens here closes in ambient.tpl.js (content
// column, <main>, body row) and toasts.tpl.js (root <div>).
// Cut verbatim from lines 5-123 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`<div data-hq-theme="{{ themeName }}" style="position:relative;height:100vh;width:100%;overflow:hidden;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font-family:var(--term);font-size:13px;line-height:1.25">
  <x-import component-from-global-scope="hq-ascii-bg" style="position:absolute;inset:0" hint-size="100%,100%"></x-import>
  <header style="flex:0 0 auto;height:58px;display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--panel);border-bottom:1px solid var(--frame);backdrop-filter:blur(10px);position:relative;z-index:30">
    <button onClick="{{ goHome }}" title="Home" style="background:none;border:0;padding:4px 6px 4px 2px;cursor:pointer;font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--text);display:flex;white-space:nowrap;flex:0 0 auto">
      <span style="color:var(--gold);font-size:18px;margin-right:6px;text-transform:none">✻</span><sc-if value="{{ L.wordmark }}" hint-placeholder-val="{{ true }}"><span style="font-size:14px;font-weight:600;color:var(--text);text-transform:none">workspace-hq</span><span style="font-size:12px;color:var(--faint);margin-left:6px;text-transform:none">v3</span></sc-if>
    </button>
    <button onClick="{{ toggleScrub }}" title="Snapshots · use ← → to scrub" style="{{ dateChipStyle }}">
      <span style="width:8px;height:8px;background:{{ dateDot }};flex:0 0 auto"></span><span>{{ dateChipLabel }}</span><span style="opacity:.6">▾</span>
    </button>
    <sc-if value="{{ L.signals }}" hint-placeholder-val="{{ true }}">
      <div style="display:flex;gap:6px;flex:0 0 auto">
        <sc-for list="{{ signals }}" as="s" hint-placeholder-count="3">
          <button onClick="{{ s.go }}" title="{{ s.title }}" style="{{ s.style }}"><span>{{ s.glyph }}</span><span style="color:var(--text)"><x-import component-from-global-scope="hq-roll" value="{{ s.value }}" hint-size="auto,1em"></x-import></span><sc-if value="{{ L.signalLabels }}" hint-placeholder-val="{{ true }}"><span>{{ s.label }}</span></sc-if></button>
        </sc-for>
      </div>
    </sc-if>
    <sc-if value="{{ L.signalCompact }}" hint-placeholder-val="{{ false }}">
      <button onClick="{{ sigCompact.go }}" title="{{ sigCompact.title }}" style="height:34px;display:flex;align-items:center;gap:8px;padding:0 9px;background:var(--ink);border:2px solid {{ sigCompact.border }};font-family:var(--term);font-size:13px;cursor:pointer;white-space:nowrap;flex:0 0 auto">
        <sc-for list="{{ sigCompact.parts }}" as="s" hint-placeholder-count="3"><span style="color:{{ s.color }}">{{ s.glyph }}<span style="color:var(--text)"><x-import component-from-global-scope="hq-roll" value="{{ s.value }}" hint-size="auto,1em"></x-import></span></span></sc-for>
      </button>
    </sc-if>
    <div style="flex:1 1 auto;min-width:0"></div>
    <sc-if value="{{ L.scanText }}" hint-placeholder-val="{{ true }}"><span style="color:var(--muted);font-size:12px;white-space:nowrap"><x-import component-from-global-scope="hq-clock" style="color:var(--faint);margin-right:10px" hint-size="40px,1em"></x-import><sc-if value="{{ isScanning }}" hint-placeholder-val="{{ false }}"><!-- v5: the scan state from main (Scanning since HH:MM) instead of stage names rotating on a timer --><x-import component-from-global-scope="hq-spin" verbs="{{ scanSpin }}" hint-size="auto,1em"></x-import></sc-if><sc-if value="{{ notScanning }}" hint-placeholder-val="{{ true }}"><span title="{{ scanFreshTip }}">{{ scanLabel }}</span><!-- v5: data overhaul Front A2 — say so when the newest scan is days old --><sc-if value="{{ scanStale }}" hint-placeholder-val="{{ false }}"><span data-fresh="stale" title="{{ scanFreshTip }}" style="color:var(--orange);margin-left:6px">{{ scanStaleText }}</span></sc-if></sc-if></span></sc-if>
    <sc-if value="{{ L.extras }}" hint-placeholder-val="{{ true }}">
      <button onClick="{{ scanNow }}" title="{{ scanTitle }}" aria-disabled="{{ cantWrite }}" style="height:34px;min-width:34px;padding:0 9px;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-family:var(--term);font-size:13px;cursor:pointer;white-space:nowrap;flex:0 0 auto" style-hover="border-color:var(--gold);color:var(--text)"><x-import component-from-global-scope="hq-icon" name="scan" size="16" hint-size="16px,16px"></x-import><sc-if value="{{ L.scanText }}" hint-placeholder-val="{{ true }}"><span>Scan now</span></sc-if></button>
    </sc-if>
    <button onClick="{{ toggleRuns }}" title="Activity &amp; runs" style="height:34px;min-width:34px;padding:0 9px;display:flex;align-items:center;justify-content:center;gap:7px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-family:var(--term);font-size:13px;cursor:pointer;white-space:nowrap;flex:0 0 auto" style-hover="border-color:var(--gold);color:var(--text)">
      <sc-if value="{{ hasRunning }}" hint-placeholder-val="{{ false }}"><span ref="{{ pulse }}" style="width:7px;height:7px;background:var(--gold)"></span></sc-if>
      <x-import component-from-global-scope="hq-icon" name="activity" size="16" hint-size="16px,16px"></x-import><span style="color:var(--text)">{{ running }}</span>
    </button>
    <button onClick="{{ openPalette }}" title="Search &amp; commands · Ctrl K or /" style="height:34px;min-width:34px;padding:0 9px;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-family:var(--term);font-size:13px;cursor:pointer;white-space:nowrap;flex:0 0 auto" style-hover="border-color:var(--gold);color:var(--text)"><x-import component-from-global-scope="hq-icon" name="search" size="16" hint-size="16px,16px"></x-import><sc-if value="{{ L.searchText }}" hint-placeholder-val="{{ true }}"><span>Search</span><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-left:4px">Ctrl K</span></sc-if></button>
    <sc-if value="{{ L.extras }}" hint-placeholder-val="{{ true }}">
      <button onClick="{{ toggleFocus }}" title="Focus · F" style="height:34px;min-width:34px;padding:0 9px;display:flex;align-items:center;justify-content:center;gap:6px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-family:var(--term);font-size:13px;cursor:pointer;white-space:nowrap;flex:0 0 auto" style-hover="border-color:var(--gold);color:var(--text)"><x-import component-from-global-scope="hq-icon" name="focus" size="16" hint-size="16px,16px"></x-import><sc-if value="{{ L.searchText }}" hint-placeholder-val="{{ true }}"><span>Focus</span></sc-if></button>
    </sc-if>
    <sc-if value="{{ showAmbientToggle }}" hint-placeholder-val="{{ false }}">
      <button onClick="{{ toggleAmbientOverlay }}" title="Status rail" style="height:34px;min-width:34px;padding:0 9px;display:flex;align-items:center;justify-content:center;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-family:var(--term);font-size:13px;cursor:pointer;flex:0 0 auto" style-hover="border-color:var(--gold);color:var(--text)"><x-import component-from-global-scope="hq-icon" name="status" size="16" hint-size="16px,16px"></x-import></button>
    </sc-if>
    <div ref="{{ xpRef }}" title="{{ levelTitle }}" style="display:flex;align-items:center;gap:8px;padding:0 4px;flex:0 0 auto">
      <span style="height:30px;min-width:30px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:color-mix(in oklab,var(--gold) 15%,transparent);border:1px solid color-mix(in oklab,var(--gold) 50%,transparent);color:var(--accent-text);font-size:12px;font-weight:600;white-space:nowrap">lv {{ level.l }}</span><!-- v5: real streak of the viewed snapshot (days in a row the scanner ran), not a fixed 5 --><x-import component-from-global-scope="hq-ember" days="{{ streakDays }}" title="{{ streakTitle }}" hint-size="24px,14px"></x-import>
      <sc-if value="{{ L.levelText }}" hint-placeholder-val="{{ true }}">
        <div style="width:116px">
          <div style="display:flex;justify-content:space-between;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap"><span>{{ level.t }}</span><span style="color:var(--accent-text)">{{ displayXp }} xp</span></div>
          <div style="height:6px;background:var(--ink);margin-top:4px;border-radius:4px;overflow:hidden"><div style="height:100%;width:{{ levelBar }}%;background:var(--gold);transition:width .6s cubic-bezier(.22,1,.36,1)"></div></div>
        </div>
      </sc-if>
    </div>
    <sc-if value="{{ L.extras }}" hint-placeholder-val="{{ true }}">
      <button onClick="{{ toggleTheme }}" title="Light / dark" style="height:34px;width:34px;display:flex;align-items:center;justify-content:center;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-family:var(--term);font-size:13px;cursor:pointer;flex:0 0 auto" style-hover="border-color:var(--gold);color:var(--text)"><x-import component-from-global-scope="hq-icon" name="theme" size="16" hint-size="16px,16px"></x-import></button>
    </sc-if>
    <button onClick="{{ openSettings }}" title="Settings" data-x="1" style="height:34px;width:34px;display:flex;align-items:center;justify-content:center;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-family:var(--term);font-size:13px;cursor:pointer;flex:0 0 auto" style-hover="border-color:var(--gold);color:var(--text)"><x-import component-from-global-scope="hq-icon" name="settings" size="16" hint-size="16px,16px"></x-import></button>
  </header>

  <sc-if value="{{ isPast }}" hint-placeholder-val="{{ false }}">
    <div style="flex:0 0 auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:6px 16px;background:var(--bg2);border-bottom:2px solid var(--blue);font-size:13px;position:relative;z-index:25">
      <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--blue)">Read-only</span>
      <span>Viewing {{ viewedLabel }} · write actions are off · machine, runs and social stay live</span>
      <button onClick="{{ backToLive }}" style="margin-left:auto;height:30px;padding:0 12px;background:var(--blue);color:#fff;border:1px solid var(--frame);border-radius:8px;font-family:var(--term);font-size:13px;cursor:pointer">● Back to live</button>
    </div>
  </sc-if>
  <sc-if value="{{ noBridge }}" hint-placeholder-val="{{ false }}">
    <div style="flex:0 0 auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:6px 16px;background:var(--bg2);border-bottom:2px solid var(--orange);font-size:13px">
      <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--orange)">No bridge</span>
      <span>Live bridge missing · showing bundle data · actions that touch files or run commands are disabled</span>
    </div>
  </sc-if>

  <div style="flex:1 1 auto;min-height:0;display:flex;position:relative;z-index:1">
    <sc-if value="{{ L.sideRail }}" hint-placeholder-val="{{ true }}">
      <nav aria-label="Destinations" style="flex:0 0 auto;display:flex;flex-direction:column;gap:4px;padding:12px 8px;overflow-x:hidden;background:var(--panel);border-right:1px solid var(--frame);backdrop-filter:blur(10px);overflow-y:auto;position:relative;z-index:20">
        <sc-for list="{{ nav }}" as="n" hint-placeholder-count="9">
          <div style="display:flex;flex-direction:column"><sc-if value="{{ n.showGroup }}" hint-placeholder-val="{{ false }}"><div style="font-size:10px;color:var(--faint);padding:14px 10px 6px;letter-spacing:.06em">── {{ n.group }}</div></sc-if><sc-if value="{{ n.showDivider }}" hint-placeholder-val="{{ false }}"><div style="height:1px;background:var(--frame);margin:8px 8px"></div></sc-if><button onClick="{{ n.go }}" aria-current="{{ n.current }}" title="{{ n.title }}" style="{{ n.style }}" style-hover="color:var(--text);transform:translateX(2px)">
            <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);width:10px;flex:0 0 auto">{{ n.digit }}</span>
            <span style="width:24px;display:flex;justify-content:center;flex:0 0 auto"><x-import component-from-global-scope="hq-icon" name="{{ n.id }}" size="17" delay="{{ n.delay }}" hint-size="17px,17px"></x-import></span>
            <sc-if value="{{ L.railLabels }}" hint-placeholder-val="{{ true }}"><span style="flex:1 1 auto">{{ n.label }}</span></sc-if>
            <sc-if value="{{ n.hasBadge }}" hint-placeholder-val="{{ false }}"><span style="{{ n.badgeStyle }}">{{ n.badge }}</span></sc-if>
          </button></div>
        </sc-for>
        <div style="flex:1 1 auto;min-height:12px"></div>
        <button onClick="{{ openCheat }}" title="Keyboard shortcuts · ?" style="display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;background:transparent;border:1px dashed var(--frame);color:var(--faint);font-family:var(--term);font-size:13px;cursor:pointer" style-hover="color:var(--text);border-color:var(--frame-hi)"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500">?</span><sc-if value="{{ L.railLabels }}" hint-placeholder-val="{{ true }}"><span>Shortcuts</span></sc-if></button>
      </nav>
    </sc-if>

    <main ref="{{ mainRef }}" style="flex:1 1 auto;min-width:0;overflow-y:auto;overflow-x:hidden;position:relative">
      <div style="max-width:1160px;margin:0 auto;padding:24px clamp(9px,2.2vw,23px) 120px">
        <sc-if value="{{ v.loading }}" hint-placeholder-val="{{ false }}">
          <div style="display:flex;flex-direction:column;gap:20px">
            <div ref="{{ shimmer }}" style="height:44px;width:min(260px,70%);background:var(--card);border-radius:12px"></div>
            <div ref="{{ shimmer }}" style="height:190px;background:var(--card);border-radius:12px"></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:18px">
              <div ref="{{ shimmer }}" style="height:120px;background:var(--card);border-radius:12px"></div>
              <div ref="{{ shimmer }}" style="height:120px;background:var(--card);border-radius:12px"></div>
              <div ref="{{ shimmer }}" style="height:120px;background:var(--card);border-radius:12px"></div>
            </div>
            <div style="color:var(--muted);font-size:13px"><x-import component-from-global-scope="hq-spin" verbs="Reading snapshot|Parsing bundle|Restoring your place" hint-size="auto,1em"></x-import></div>
          </div>
        </sc-if>
        <sc-if value="{{ v.error }}" hint-placeholder-val="{{ false }}">
          <div style="max-width:640px;margin:6vh auto 0;background:var(--card);border:1px solid var(--red);border-radius:12px;padding:24px">
            <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--red)">Couldn’t load this screen</div>
            <div style="font-size:24px;margin:10px 0 6px">{{ screenTitle }} didn’t mount</div>
            <!-- v5: says which case this is (unreadable bundle or no scan yet) --><div style="font-size:14px;color:var(--muted)">{{ errorLead }}</div>
            <!-- v5: the real reason (boot error text, or no scan yet) instead of a sample JSON error --><div style="font-size:12px;color:var(--text);background:var(--ink);padding:10px 12px;margin:16px 0;white-space:pre-wrap;word-break:break-word">{{ errorText }}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button type="button" onClick="{{ retry }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Retry</button>
              <button type="button" onClick="{{ openRuns }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open activity</button>
              <button type="button" onClick="{{ goHome }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Go home</button>
            </div>
          </div>
        </sc-if>
        <sc-if value="{{ v.stdHeader }}" hint-placeholder-val="{{ false }}">
          <div style="margin-bottom:22px">
            <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap"><h1 style="margin:0;font-weight:400;font-size:clamp(24px,2.9vw,33px);line-height:1"><x-import component-from-global-scope="hq-type" text="{{ screenTitle }}" hint-size="auto,1em"></x-import></h1><span style="font-size:14px;color:var(--muted)">{{ screenSub }}</span><sc-if value="{{ hasScreenModel }}" hint-placeholder-val="{{ false }}"><x-import component-from-global-scope="hq-obj-viewer" src="{{ screenModel }}" mode="ascii" res="110" style="width:120px;height:84px;margin-left:auto;align-self:center" hint-size="120px,84px"></x-import></sc-if></div>
            <sc-if value="{{ hasSubTabs }}" hint-placeholder-val="{{ false }}">
              <div role="tablist" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:16px">
                <sc-for list="{{ subTabs }}" as="st" hint-placeholder-count="3"><button role="tab" aria-selected="{{ st.sel }}" onClick="{{ st.go }}" style="{{ st.style }}">{{ st.label }}</button></sc-for>
              </div>
            </sc-if>
          </div>
        </sc-if>
`;
