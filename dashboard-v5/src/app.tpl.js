// The WorkspaceHQ v3 screen, exactly as authored in Claude Design
// ("Workspace HQ remake scope" > WorkspaceHQ v3.dc.html), minus <helmet>
// (its styles live in styles/app.css, its scripts are imported by boot.js).
// Bindings resolve against Component.renderVals() - see src/dc/runtime.js.
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
    <sc-if value="{{ L.scanText }}" hint-placeholder-val="{{ true }}"><span style="color:var(--muted);font-size:12px;white-space:nowrap"><x-import component-from-global-scope="hq-clock" style="color:var(--faint);margin-right:10px" hint-size="40px,1em"></x-import><sc-if value="{{ isScanning }}" hint-placeholder-val="{{ false }}"><x-import component-from-global-scope="hq-spin" verbs="Scanning|Reading git|Counting tests|Enriching" hint-size="auto,1em"></x-import></sc-if><sc-if value="{{ notScanning }}" hint-placeholder-val="{{ true }}"><span>{{ scanLabel }}</span></sc-if></span></sc-if>
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
      <span style="height:30px;min-width:30px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:color-mix(in oklab,var(--gold) 15%,transparent);border:1px solid color-mix(in oklab,var(--gold) 50%,transparent);color:var(--accent-text);font-size:12px;font-weight:600;white-space:nowrap">lv {{ level.l }}</span><x-import component-from-global-scope="hq-ember" days="5" title="5-day scan streak" hint-size="24px,14px"></x-import>
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
            <div style="font-size:14px;color:var(--muted)">The data bundle couldn’t be read. Your place is kept — nothing was lost.</div>
            <div style="font-size:12px;color:var(--text);background:var(--ink);padding:10px 12px;margin:16px 0;white-space:pre-wrap;word-break:break-word">latest.json · Unexpected end of JSON input (line 1, col 48213)</div>
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
        <sc-if value="{{ v.home }}" hint-placeholder-val="{{ true }}">
          <div>
            <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:22px">
              <h1 style="margin:0;font-weight:400;font-size:clamp(26px,3.2vw,37px);line-height:1"><x-import component-from-global-scope="hq-type" text="{{ home.greeting }}" hint-size="auto,1em"></x-import></h1>
              <span style="font-size:14px;color:var(--muted)">{{ home.sub }}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start">
              <div style="flex:1 1 520px;min-width:0;display:flex;flex-direction:column;gap:36px">
                <sc-if value="{{ showSince }}" hint-placeholder-val="{{ false }}">
                  <section ref="{{ popIn }}" style="border:1px dashed var(--frame-hi);border-radius:12px;padding:12px 16px;background:var(--card)">
                    <div style="display:flex;align-items:center;gap:10px"><span style="font-size:12px;color:var(--faint)">› {{ sinceLabel }}</span><span style="flex:1"></span><button onClick="{{ dismissSince }}" style="background:none;border:0;color:var(--faint);font-size:12px;cursor:pointer;font-family:var(--term)">dismiss</button></div>
                    <div style="display:flex;flex-direction:column;margin-top:6px">
                      <sc-for list="{{ since }}" as="x" hint-placeholder-count="4"><button onClick="{{ x.open }}" style="display:flex;gap:10px;align-items:center;padding:5px 0;background:none;border:0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer;text-align:left" style-hover="color:var(--accent-text)"><span style="width:16px;color:{{ x.c }}">{{ x.g }}</span><span>{{ x.t }}</span></button></sc-for>
                    </div>
                  </section>
                </sc-if>
                <sc-if value="{{ home.hasNext }}" hint-placeholder-val="{{ true }}">
                  <section aria-label="Next action" style="position:relative;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 10px 0 -4px var(--ink);padding:22px 24px 20px">
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
                      <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--accent-text)">Next action</span>
                      <span style="font-size:12px;color:var(--faint)">picked by fixed rules · not AI</span>
                      <span style="flex:1"></span>
                      <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ home.next.color }}">{{ home.next.tier }}</span>
                    </div>
                    <div style="font-size:clamp(20px,2.4vw,29px);line-height:1.05;text-wrap:balance"><x-import component-from-global-scope="hq-scramble" intro="" text="{{ home.next.title }}" hint-size="auto,1em"></x-import></div>
                    <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-top:8px;font-size:14px;color:var(--muted)">
                      <button onClick="{{ home.next.open }}" style="background:none;border:0;padding:0;color:var(--link);font-size:14px;cursor:pointer" style-hover="color:var(--link-hover)">{{ home.next.proj }} ▸</button><span>·</span><span style="text-wrap:pretty">{{ home.next.why }}</span>
                    </div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:20px">
                      <button type="button" onClick="{{ home.next.focus }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">◎ Start focus</button>
                      <button type="button" onClick="{{ home.next.done }}" disabled="{{ cantWrite }}" title="{{ writeReason }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ Mark done</button>
                      <button type="button" onClick="{{ home.next.open }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open project</button>
                      <span style="margin-left:auto;font-size:15px;color:var(--accent-text)">+{{ home.next.xp }} xp</span>
                    </div>
                    <sc-if value="{{ cantWrite }}" hint-placeholder-val="{{ false }}"><div style="margin-top:10px;font-size:12px;color:var(--faint)">{{ writeReason }}</div></sc-if>
                    <sc-if value="{{ home.hasAlts }}" hint-placeholder-val="{{ true }}">
                      <div style="margin-top:20px;padding-top:14px;border-top:1px dashed var(--frame);display:flex;flex-direction:column;gap:10px">
                        <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">Or, if that’s too much right now</span>
                        <sc-for list="{{ home.alts }}" as="a" hint-placeholder-count="2">
                          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                            <span style="width:8px;height:8px;background:{{ a.color }};flex:0 0 auto"></span>
                            <span style="flex:1 1 240px;min-width:0;font-size:14px">{{ a.title }} <span style="color:var(--faint)">· {{ a.proj }}</span></span>
                            <button type="button" onClick="{{ a.focus }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">◎ Focus</button>
                            <button type="button" onClick="{{ a.done }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ Done</button>
                          </div>
                        </sc-for>
                      </div>
                    </sc-if>
                  </section>
                </sc-if>
                <sc-if value="{{ home.isRest }}" hint-placeholder-val="{{ false }}">
                  <section style="background:var(--card);border:1px solid var(--green);border-radius:12px;padding:28px 24px;position:relative;overflow:hidden"><x-import component-from-global-scope="hq-obj-viewer" src="model:rocket" mode="ascii" res="110" style="position:absolute;right:10px;top:6px;width:140px;height:140px" hint-size="140px,140px"></x-import>
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--green)">All clear</div>
                    <div style="font-size:clamp(24px,2.9vw,33px);margin-top:10px;line-height:1">Nothing on fire.</div>
                    <div style="font-size:14px;color:var(--muted);margin-top:8px;text-wrap:pretty;padding-right:min(150px,30%)">{{ home.restSub }}</div>
                    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
                      <button type="button" onClick="{{ goTasksIdeas }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Browse ideas</button>
                      <button type="button" onClick="{{ scanNow }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">⟳ Scan now</button>
                    </div>
                  </section>
                </sc-if>

                <section aria-label="Portfolio">
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                    <h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Portfolio<span style="color:var(--faint);font-weight:400"> ─╮</span></h2>
                    <span style="font-size:13px;color:var(--muted)">worst first · {{ home.kpiLine }} · ~{{ home.avg }}% avg <span style="font-size:12px;color:var(--faint);border:1px dotted var(--faint);padding:0 4px">est.</span></span>
                    <span style="flex:1"></span>
                    <button onClick="{{ goProjects }}" style="background:none;border:0;color:var(--link);font-size:13px;cursor:pointer" style-hover="color:var(--link-hover)">All projects ▸</button>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ home.rows }}" as="r" hint-placeholder-count="8">
                      <button onClick="{{ r.open }}" style="width:100%;text-align:left;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer;transition:transform .12s, box-shadow .12s" style-hover="transform:translateY(-2px);border-color:var(--frame-hi)">
                        <span style="width:10px;height:10px;background:{{ r.color }};flex:0 0 auto"></span>
                        <span style="flex:0 0 112px;font-size:15px">{{ r.name }}</span>
                        <span style="flex:1 1 170px;min-width:0;font-size:13px;color:{{ r.reasonColor }}">{{ r.reason }}</span>
                        <span style="display:flex;gap:5px;flex-wrap:wrap">
                          <sc-for list="{{ r.chips }}" as="c" hint-placeholder-count="2"><span style="font-size:12px;padding:1px 6px;border:1px solid var(--frame);color:{{ c.color }};white-space:nowrap">{{ c.text }}</span></sc-for>
                        </span>
                        <span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ r.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ r.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ r.tone }}) 10%,transparent)">{{ r.tag }}</span>
                        <span style="color:var(--faint)">▸</span>
                      </button>
                    </sc-for>
                  </div>
                </section>

                <section aria-label="Changes">
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px">
                    <h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Changes<span style="color:var(--faint);font-weight:400"> ─╮</span></h2>
                    <span style="font-size:13px;color:var(--muted)">since the {{ home.prevLabel }} scan</span>
                  </div>
                  <sc-if value="{{ home.hasChanges }}" hint-placeholder-val="{{ true }}">
                    <div style="display:flex;flex-direction:column;gap:0;border-top:1px dashed var(--frame)">
                      <sc-for list="{{ home.changes }}" as="c" hint-placeholder-count="4">
                        <button onClick="{{ c.open }}" style="display:flex;align-items:center;gap:12px;padding:10px 4px;background:none;border:0;border-bottom:1px dashed var(--frame);color:var(--text);font-family:var(--term);font-size:13px;text-align:left;cursor:pointer" style-hover="background:var(--card)">
                          <span style="width:22px;text-align:center;color:{{ c.c }};font-size:14px">{{ c.g }}</span>
                          <span style="flex:1 1 auto">{{ c.t }}</span>
                          <span style="color:var(--faint);font-size:12px">{{ c.when }}</span>
                        </button>
                      </sc-for>
                    </div>
                  </sc-if>
                  <sc-if value="{{ home.noChanges }}" hint-placeholder-val="{{ false }}">
                    <div style="font-size:14px;color:var(--muted);padding:14px 0;border-top:1px dashed var(--frame)">Nothing moved since the previous scan. Metrics held steady.</div>
                  </sc-if>
                </section>
              </div>

              <aside style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:20px">
                <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:16px">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Trend</span><span style="flex:1"></span>
                    <sc-for list="{{ home.momTabs }}" as="m" hint-placeholder-count="2"><button onClick="{{ m.go }}" style="{{ m.style }}">{{ m.label }}</button></sc-for>
                  </div>
                  <div style="display:flex;align-items:baseline;gap:10px;margin-top:10px"><span style="font-size:36px;line-height:.9"><x-import component-from-global-scope="hq-roll" value="{{ home.mom.value }}" hint-size="auto,1em"></x-import></span><span style="font-size:13px;color:{{ home.mom.deltaColor }}">{{ home.mom.delta }}</span></div>
                  <div style="font-size:12px;color:var(--muted)">{{ home.mom.label }}</div>
                  <svg viewBox="0 0 280 56" preserveAspectRatio="none" style="width:100%;height:56px;display:block;margin-top:12px;overflow:visible"><polyline points="{{ home.mom.pts }}" style="fill:none;stroke:var(--gold);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:bevel"></polyline></svg>
                  <div style="font-size:12px;color:var(--faint);margin-top:6px">{{ home.mom.range }}</div>
                </section>
                <button onClick="{{ goSocial }}" style="text-align:left;display:flex;gap:10px;align-items:center;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer" style-hover="border-color:var(--frame-hi)">
                  <x-import component-from-global-scope="hq-icon" name="bell" size="16" hint-size="16px,16px"></x-import><span style="flex:1">{{ home.social }}</span><span style="color:var(--faint)">▸</span>
                </button>
                <sc-if value="{{ home.hasSuggest }}"><section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Worth a re-run</div>
                  <div style="display:flex;gap:10px;align-items:center;margin-top:10px"><span style="font-size:18px">{{ home.suggest.icon }}</span><div style="flex:1;min-width:0"><div style="font-size:15px">{{ home.suggest.name }}</div><div style="font-size:12px;color:var(--red)">Failed {{ home.suggest.last.ago }} · {{ home.suggest.last.err }}</div></div></div>
                  <div style="margin-top:12px"><button type="button" onClick="{{ runSuggest }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Review &amp; run ▸</button></div>
                </section></sc-if>
                <sc-if value="{{ home.showRecap }}" hint-placeholder-val="{{ false }}">
                  <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                    <div style="display:flex;align-items:center;gap:8px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Weekly recap · {{ home.recapRange }}</span><span style="flex:1"></span><sc-if value="{{ home.recapAi }}"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ AI</span></sc-if></div>
                    <div style="font-size:12px;color:var(--faint);margin-top:6px">{{ home.recapStats }}</div>
                    <sc-if value="{{ home.recapOpen }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--text);margin-top:10px;text-wrap:pretty;white-space:pre-line">{{ home.recapText }}</div></sc-if>
                    <div style="display:flex;gap:8px;margin-top:12px">
                      <button type="button" onClick="{{ toggleRecap }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Read</button>
                      <button type="button" onClick="{{ dismissRecap }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Dismiss</button>
                    </div>
                  </section>
                </sc-if>
              </aside>
            </div>
          </div>
        </sc-if>

        <sc-if value="{{ v.projects }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isGrid }}" hint-placeholder-val="{{ true }}">
              <div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px;align-items:center"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-right:6px">Sort</span>
                  <sc-for list="{{ projSorts }}" as="s" hint-placeholder-count="4"><button onClick="{{ s.go }}" style="{{ s.style }}">{{ s.label }}</button></sc-for><span style="flex:1"></span><button onClick="{{ openOnboard }}" style="height:30px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;border-radius:8px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-family:var(--term);font-size:12px;font-weight:600;cursor:pointer"><x-import component-from-global-scope="hq-icon" name="plus" size="14" hint-size="14px,14px"></x-import>add project</button>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,272px),1fr));gap:20px">
                  <sc-for list="{{ projCards }}" as="c" hint-placeholder-count="8">
                    <button onClick="{{ c.open }}" style="text-align:left;display:flex;flex-direction:column;gap:10px;padding:0 0 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);cursor:pointer;transition:transform .14s cubic-bezier(.22,1.4,.36,1), box-shadow .14s;min-width:0" style-hover="transform:translateY(-4px);border-color:var(--frame-hi)">
                      <span style="display:block;height:5px;background:{{ c.color }}"></span>
                      <span style="display:flex;align-items:center;gap:8px;padding:4px 16px 0"><span style="font-size:19px;flex:1 1 auto;min-width:0">{{ c.name }}</span><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ c.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ c.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ c.tone }}) 10%,transparent)">{{ c.tag }}</span></span>
                      <span style="padding:0 16px;font-size:12px;color:var(--muted)">{{ c.stack }}</span>
                      <span style="padding:0 16px;font-size:15px;color:{{ c.reasonColor }}">{{ c.reason }}</span>
                      <span style="display:flex;gap:5px;flex-wrap:wrap;padding:0 16px"><sc-for list="{{ c.chips }}" as="ch" hint-placeholder-count="2"><span style="font-size:12px;padding:1px 6px;border:1px solid var(--frame);color:{{ ch.color }}">{{ ch.text }}</span></sc-for></span>
                      <span style="display:flex;align-items:center;gap:8px;padding:0 16px"><span style="flex:1;height:6px;background:var(--ink);border-radius:4px"><span style="display:block;height:100%;width:{{ c.pct }}%;background:var(--muted)"></span></span><span style="font-size:12px;color:var(--faint)">{{ c.pct }}% <span style="border:1px dotted var(--faint);padding:0 3px">est.</span></span></span>
                      <span style="display:flex;gap:10px;padding:0 16px;font-size:12px;color:var(--faint)"><span>{{ c.activity }}</span><sc-if value="{{ c.alive }}" hint-placeholder-val="{{ false }}"><svg viewBox="0 0 60 12" style="width:60px;height:12px;align-self:center"><path d="M0 6h20l3-5 4 10 3-5h30" style="fill:none;stroke:var(--green);stroke-width:1.3;stroke-dasharray:70;stroke-dashoffset:70"><animate attributeName="stroke-dashoffset" values="70;0;-70" dur="2.6s" repeatCount="indefinite"></animate></path></svg></sc-if><sc-if value="{{ c.devOn }}" hint-placeholder-val="{{ false }}"><span style="color:var(--green)">● dev :{{ c.port }}</span></sc-if></span>
                    </button>
                  </sc-for>
                </div>
              </div>
            </sc-if>
            <sc-if value="{{ isMap }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
                <div style="flex:1 1 480px;min-width:0;background:var(--panel);border:1px solid var(--frame);border-radius:12px;padding:10px">
                  <svg ref="{{ rise }}" viewBox="20 30 500 330" style="width:100%;height:auto;display:block" role="img" aria-label="Isometric project map · height is risk">
                    <sc-for list="{{ tiles }}" as="tl" hint-placeholder-count="24"><polygon points="{{ tl.pts }}" style="fill:var(--card);fill-opacity:{{ tl.op }};stroke:var(--frame);stroke-width:1"></polygon></sc-for>
                    <sc-for list="{{ towers }}" as="t" hint-placeholder-count="8">
                      <g data-tower="1" onClick="{{ t.open }}" onMouseEnter="{{ t.hover }}" style="cursor:pointer">
                        <polygon points="{{ t.left }}" style="fill:{{ t.color }};fill-opacity:.62;stroke:var(--ink);stroke-width:1.5"></polygon>
                        <polygon points="{{ t.right }}" style="fill:{{ t.color }};fill-opacity:.4;stroke:var(--ink);stroke-width:1.5"></polygon>
                        <polygon points="{{ t.top }}" style="fill:{{ t.color }};stroke:{{ t.stroke }};stroke-width:{{ t.sw }}"></polygon>
                        <sc-for list="{{ t.wins }}" as="w" hint-placeholder-count="0"><rect x="{{ w.x }}" y="{{ w.y }}" width="4" height="5" style="fill:var(--gold-2)"><animate attributeName="opacity" values="1;.15;1" dur="{{ w.dur }}" repeatCount="indefinite"></animate></rect></sc-for>
                        <sc-for list="{{ t.smoke }}" as="m" hint-placeholder-count="0"><circle cx="{{ m.x }}" cy="{{ m.y0 }}" r="3" style="fill:var(--faint)"><animate attributeName="cy" from="{{ m.y0 }}" to="{{ m.y1 }}" dur="2.1s" begin="{{ m.begin }}" repeatCount="indefinite"></animate><animate attributeName="r" values="2;6" dur="2.1s" begin="{{ m.begin }}" repeatCount="indefinite"></animate><animate attributeName="opacity" values=".7;0" dur="2.1s" begin="{{ m.begin }}" repeatCount="indefinite"></animate></circle></sc-for>
                        <text x="{{ t.lx }}" y="{{ t.ly }}" text-anchor="middle" style="font-family:var(--term);font-size:12px;fill:var(--muted)">{{ t.name }}</text>
                      </g>
                    </sc-for>
                  </svg>
                  <div style="display:flex;gap:14px;flex-wrap:wrap;padding:6px 6px 2px;font-size:12px;color:var(--muted)"><span>Height = risk (uncommitted, secrets, no git)</span><span style="color:var(--red)">■ at risk</span><span style="color:var(--orange)">■ needs care</span><span style="color:var(--blue)">■ idle</span><span style="color:var(--green)">■ healthy</span></div>
                </div>
                <div style="flex:1 1 260px;min-width:0;background:var(--card);border:1px solid {{ mapCard.color }};border-radius:12px;padding:16px">
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Hover a tower</div>
                  <div style="display:flex;align-items:center;gap:8px;margin-top:8px"><span style="font-size:22px;flex:1">{{ mapCard.name }}</span><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ mapCard.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ mapCard.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ mapCard.tone }}) 10%,transparent)">{{ mapCard.tag }}</span></div>
                  <div style="font-size:14px;color:{{ mapCard.reasonColor }};margin-top:6px">{{ mapCard.reason }}</div>
                  <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-top:14px;font-size:13px">
                    <span style="color:var(--faint)">Stack</span><span>{{ mapCard.stack }}</span>
                    <span style="color:var(--faint)">Uncommitted</span><span>{{ mapCard.dirtyText }}</span>
                    <span style="color:var(--faint)">Last commit</span><span>{{ mapCard.last }}</span>
                    <span style="color:var(--faint)">Activity</span><span>{{ mapCard.activity }}</span>
                  </div>
                  <div style="margin-top:16px"><button type="button" onClick="{{ mapOpen }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open project ▸</button></div>
                </div>
              </div>
            </sc-if>
            <sc-if value="{{ isArchived }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:10px;max-width:720px">
                <sc-for list="{{ archived }}" as="a" hint-placeholder-count="1">
                  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                    <div style="flex:1 1 220px"><div style="font-size:16px">{{ a.name }}</div><div style="font-size:12px;color:var(--faint)">{{ a.stack }} · {{ a.since }}</div></div>
                    <button type="button" onClick="{{ a.restore }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">↺ Restore</button>
                  </div>
                </sc-for>
                <sc-if value="{{ noArchived }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Nothing archived. Archive a project from its page (⋯ menu) — it’s reversible.</div></sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>

        <sc-if value="{{ v.project }}" hint-placeholder-val="{{ false }}">
          <div>
            <button onClick="{{ pg.back }}" style="background:none;border:0;padding:0;color:var(--link);font-size:13px;cursor:pointer" style-hover="color:var(--link-hover)">← {{ pg.backLabel }}</button>
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:12px 0 6px">
              <h1 style="margin:0;font-weight:400;font-size:clamp(26px,3.2vw,37px);line-height:1"><x-import component-from-global-scope="hq-type" text="{{ pg.name }}" hint-size="auto,1em"></x-import></h1>
              <span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ pg.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ pg.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ pg.tone }}) 10%,transparent)">{{ pg.tag }}</span>
              <span style="font-size:13px;color:var(--faint);white-space:nowrap">{{ pg.fresh }}</span>
            </div>
            <div style="font-size:13px;color:var(--muted)">{{ pg.stack }} · <span style="color:var(--faint)">{{ pg.path }}</span></div>
            <sc-if value="{{ pg.secretAlert }}" hint-placeholder-val="{{ false }}">
              <div style="margin-top:16px;display:flex;gap:10px;align-items:center;padding:10px 14px;background:var(--card);border:1px solid var(--red);border-radius:12px;font-size:13px"><span style="color:var(--red);font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500">Secret</span><span>{{ pg.secretText }}</span></div>
            </sc-if>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:20px;position:relative">
              <button type="button" onClick="{{ pg.resume }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Resume</button>
              <button type="button" onClick="{{ pg.commit }}" disabled="{{ pg.cantCommit }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✎ Commit… ({{ pg.dirty }})</button>
              <button type="button" onClick="{{ pg.dev }}" disabled="{{ pg.noDev }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ pg.devLabel }}</button>
              <button type="button" onClick="{{ pg.openFolder }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open folder</button>
              <button type="button" onClick="{{ pg.snapshot }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Snapshot…</button>
              <button type="button" onClick="{{ pg.toggleMore }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">⋯</button>
              <sc-if value="{{ pg.moreOpen }}" hint-placeholder-val="{{ false }}">
                <div ref="{{ popIn }}" style="position:absolute;top:50px;right:0;z-index:40;min-width:230px;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 14px 30px rgba(0,0,0,.35);padding:6px;display:flex;flex-direction:column">
                  <button onClick="{{ pg.logLearning }}" style="text-align:left;height:38px;padding:0 12px;background:none;border:0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer" style-hover="background:var(--card-hi)">Log a learning</button>
                  <button onClick="{{ pg.logDecision }}" style="text-align:left;height:38px;padding:0 12px;background:none;border:0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer" style-hover="background:var(--card-hi)">Log a decision</button>
                  <button onClick="{{ pg.archive }}" style="text-align:left;height:38px;padding:0 12px;background:none;border:0;border-top:1px dashed var(--frame);color:var(--red);font-family:var(--term);font-size:13px;cursor:pointer" style-hover="background:var(--card-hi)">Archive project…</button>
                </div>
              </sc-if>
            </div>
            <div style="font-size:12px;color:var(--faint);margin-top:8px">{{ pg.resumeHint }}</div>
            <sc-if value="{{ cantWrite }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange);margin-top:4px">{{ writeReason }}</div></sc-if>

            <div style="display:flex;flex-wrap:wrap;gap:28px;margin-top:30px;align-items:flex-start">
              <div style="flex:1 1 480px;min-width:0;display:flex;flex-direction:column;gap:32px">
                <section style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:18px 20px">
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--accent-text);margin-bottom:12px">Where was I?</div>
                  <div style="display:flex;flex-direction:column;gap:8px">
                    <sc-for list="{{ pg.brief }}" as="b" hint-placeholder-count="5">
                      <div style="display:grid;grid-template-columns:62px 1fr;gap:12px;align-items:baseline"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">{{ b.k }}</span><span style="font-size:15px;color:{{ b.color }}">{{ b.v }}<sc-if value="{{ b.est }}" hint-placeholder-val="{{ false }}"> <span style="font-size:12px;color:var(--faint);border:1px dotted var(--faint);padding:0 4px">est.</span></sc-if></span></div>
                    </sc-for>
                  </div>
                  <sc-if value="{{ pg.hasRecent }}" hint-placeholder-val="{{ true }}">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);align-self:center;margin-right:4px">recent</span>
                      <sc-for list="{{ pg.recent }}" as="f" hint-placeholder-count="3"><button onClick="{{ f.open }}" style="height:30px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:12px;cursor:pointer" style-hover="border-color:var(--gold)">{{ f.name }}</button></sc-for>
                    </div>
                  </sc-if>
                </section>

                <section>
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px"><h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Next<span style="color:var(--faint);font-weight:400"> ─╮</span></h2><span style="font-size:13px;color:var(--muted)">{{ pg.nextCount }} · tasks, side-quests and suggestions in one list</span></div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ pg.next }}" as="n" hint-placeholder-count="3">
                      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                        <div style="flex:1 1 280px;min-width:0">
                          <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ n.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ n.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ n.tone }}) 10%,transparent)">{{ n.kind }}</span><sc-if value="{{ n.ai }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ AI</span></sc-if></div>
                          <div style="font-size:15px">{{ n.title }}</div>
                          <div style="font-size:12px;color:var(--muted)">{{ n.why }}</div>
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap">
                          <button type="button" onClick="{{ n.doIt }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Do it</button>
                          <button type="button" onClick="{{ n.claude }}" disabled="{{ cantWrite }}" title="Uses Claude quota" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✦ Send to Claude</button>
                          <sc-if value="{{ n.canDismiss }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ n.dismiss }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Dismiss</button></sc-if>
                        </div>
                      </div>
                    </sc-for>
                    <sc-if value="{{ pg.noNext }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Nothing queued for this project. Nice.</div></sc-if>
                  </div>
                </section>

                <section>
                  <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px"><h2 style="margin:0;font-weight:600;font-size:13px;color:var(--accent-text);letter-spacing:.02em;white-space:nowrap"><span style="color:var(--faint);font-weight:400">╭─ </span>Journal<span style="color:var(--faint);font-weight:400"> ─╮</span></h2><span style="font-size:13px;color:var(--muted)">{{ pg.mirrorNote }}</span></div>
                  <div style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:12px">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"><sc-for list="{{ pg.jKinds }}" as="j" hint-placeholder-count="3"><button onClick="{{ j.go }}" style="{{ j.style }}">{{ j.label }}</button></sc-for></div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                      <input value="{{ journalDraft }}" onChange="{{ onJournal }}" onKeyDown="{{ journalKey }}" placeholder="What happened, what you decided, what you learned…" style="flex:1 1 260px;min-width:0;height:40px;padding:0 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;outline:none">
                      <button type="button" onClick="{{ addJournal }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Add</button>
                    </div>
                  </div>
                  <div style="display:flex;flex-direction:column;margin-top:10px">
                    <sc-for list="{{ pg.journal }}" as="j" hint-placeholder-count="2">
                      <div style="display:flex;gap:12px;align-items:baseline;padding:10px 4px;border-bottom:1px dashed var(--frame)"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ j.color }};width:70px;flex:0 0 auto">{{ j.kind }}</span><span style="flex:1;font-size:14px">{{ j.text }}</span><span style="font-size:12px;color:var(--faint)">{{ j.date }}</span></div>
                    </sc-for>
                    <sc-if value="{{ pg.noJournal }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted);padding:10px 4px">No entries yet. The first one is always the hardest.</div></sc-if>
                  </div>
                </section>
              </div>

              <aside style="flex:1 1 300px;min-width:0;background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Diagnostics</div>
                <div role="tablist" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px"><sc-for list="{{ pg.diagTabs }}" as="d" hint-placeholder-count="5"><button role="tab" onClick="{{ d.go }}" style="{{ d.style }}">{{ d.label }}</button></sc-for></div>
                <sc-for list="{{ pg.diag }}" as="d" hint-placeholder-count="6">
                  <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed var(--frame);font-size:13px"><span style="color:var(--muted);flex:0 0 auto">{{ d.k }}</span><span style="color:{{ d.color }};text-align:right">{{ d.v }}<sc-if value="{{ d.est }}" hint-placeholder-val="{{ false }}"> <span style="font-size:12px;color:var(--faint);border:1px dotted var(--faint);padding:0 3px">est.</span></sc-if></span></div>
                </sc-for>
              </aside>
            </div>
          </div>
        </sc-if>

        <sc-if value="{{ v.tasks }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isRanked }}" hint-placeholder-val="{{ true }}">
              <div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px"><sc-for list="{{ taskFilters }}" as="f" hint-placeholder-count="4"><button onClick="{{ f.go }}" style="{{ f.style }}">{{ f.label }}</button></sc-for></div>
                <div style="display:flex;flex-direction:column;gap:12px">
                  <sc-for list="{{ taskRows }}" as="t" hint-placeholder-count="6">
                    <div>
                      <sc-if value="{{ t.isHeader }}" hint-placeholder-val="{{ false }}">
                        <div style="display:flex;align-items:center;gap:10px;margin:12px 0 0"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">{{ t.label }}</span><span style="flex:1;height:2px;background:var(--frame)"></span><button onClick="{{ t.open }}" style="background:none;border:0;color:var(--link);font-size:13px;cursor:pointer">Open project ▸</button></div>
                      </sc-if>
                      <sc-if value="{{ t.isTask }}" hint-placeholder-val="{{ true }}">
                        <div style="position:relative;display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:14px 16px 14px 22px;background:var(--card);border:1px solid {{ t.ring }};border-radius:12px;opacity:{{ t.opacity }};transition:box-shadow .2s, opacity .3s">
                          <span style="position:absolute;left:0;top:0;bottom:0;width:6px;background:{{ t.color }}"></span>
                          <div style="flex:1 1 320px;min-width:0">
                            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ t.color }}">{{ t.tier }}</span><button onClick="{{ t.open }}" style="background:none;border:0;padding:0;color:var(--link);font-size:12px;cursor:pointer">{{ t.proj }} ▸</button><span style="color:var(--faint);font-size:12px">{{ t.age }}</span></div>
                            <div style="font-size:16px;text-wrap:pretty">{{ t.title }}</div>
                            <div style="font-size:13px;color:var(--muted);margin-top:2px;text-wrap:pretty">{{ t.why }}</div>
                          </div>
                          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                            <span style="font-size:13px;color:var(--accent-text);margin-right:4px">+{{ t.xp }} xp</span>
                            <sc-if value="{{ t.isDone }}" hint-placeholder-val="{{ false }}"><span style="color:var(--green);font-size:14px">✓ Done</span></sc-if>
                            <sc-if value="{{ t.isOpen }}" hint-placeholder-val="{{ true }}">
                              <div style="display:flex;gap:6px;flex-wrap:wrap">
                                <button type="button" onClick="{{ t.focus }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">◎ Focus</button>
                                <button type="button" onClick="{{ t.claude }}" disabled="{{ cantWrite }}" title="Uses Claude quota" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✦ Claude</button>
                                <button type="button" onClick="{{ t.done }}" disabled="{{ cantWrite }}" title="{{ writeReason }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ Done</button>
                              </div>
                            </sc-if>
                          </div>
                        </div>
                      </sc-if>
                    </div>
                  </sc-for>
                </div>
                <sc-if value="{{ noTasks }}" hint-placeholder-val="{{ false }}">
                  <div style="background:var(--card);border:1px solid var(--green);border-radius:12px;padding:26px 24px">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--green)">Board clear</div>
                    <div style="font-size:30px;margin-top:8px;line-height:1">No open tasks.</div>
                    <div style="font-size:14px;color:var(--muted);margin-top:8px">Tasks come from the scan. When it finds something worth doing, it shows up here — no chores to keep the list alive.</div>
                  </div>
                </sc-if>
                <sc-if value="{{ hasCleared }}" hint-placeholder-val="{{ false }}">
                  <div style="margin-top:22px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:12px 14px;border:1px dashed var(--green)">
                    <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--green)">Cleared this session · +{{ clearedXp }} xp</span>
                    <sc-for list="{{ cleared }}" as="c" hint-placeholder-count="1"><span style="font-size:13px;color:var(--muted)">✓ {{ c.title }}</span></sc-for>
                  </div>
                </sc-if>
              </div>
            </sc-if>
            <sc-if value="{{ isIdeas }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:12px">
                <div style="font-size:13px;color:var(--muted)">Side-quests from scan rules and AI suggestions. None of these are obligations.</div>
                <sc-for list="{{ ideaRows }}" as="i" hint-placeholder-count="4">
                  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                    <div style="flex:1 1 320px;min-width:0">
                      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ i.tone }});border:1px solid color-mix(in oklab,var(--tone-{{ i.tone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ i.tone }}) 10%,transparent)">{{ i.kind }}</span><sc-if value="{{ i.ai }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ AI</span></sc-if><button onClick="{{ i.open }}" style="background:none;border:0;padding:0;color:var(--link);font-size:12px;cursor:pointer">{{ i.proj }} ▸</button><span style="font-size:12px;color:var(--faint)">{{ i.meta }} <span style="border:1px dotted var(--faint);padding:0 3px">est.</span></span></div>
                      <div style="font-size:16px">{{ i.title }}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button type="button" onClick="{{ i.doIt }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ i.doLabel }}</button>
                      <button type="button" onClick="{{ i.claude }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✦ Claude</button>
                      <button type="button" onClick="{{ i.dismiss }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Dismiss</button>
                    </div>
                  </div>
                </sc-for>
                <sc-if value="{{ noIdeas }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No ideas or risks right now.</div></sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>
        <sc-if value="{{ v.automations }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isRunnable }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex;flex-direction:column;gap:28px">
                <section>
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:12px">Shelf · pinned</div>
                  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:16px">
                    <sc-for list="{{ shelf }}" as="a" hint-placeholder-count="3">
                      <div style="display:flex;flex-direction:column;gap:8px;padding:14px;background:var(--card);border:1px solid var(--frame);border-radius:12px;transition:transform .14s cubic-bezier(.22,1.4,.36,1)" style-hover="transform:translateY(-3px)">
                        <div style="display:flex;align-items:center;gap:8px"><span style="font-size:19px">{{ a.icon }}</span><span style="font-size:16px;flex:1;line-height:1.05">{{ a.name }}</span></div>
                        <div style="font-size:12px;color:{{ a.lastColor }}">{{ a.last }}</div>
                        <button type="button" onClick="{{ a.run }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Run</button>
                      </div>
                    </sc-for>
                  </div>
                  <sc-if value="{{ noShelf }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Pin up to 8 things you run often with ☆.</div></sc-if>
                </section>
                <section>
                  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Everything runnable</span><span style="flex:1"></span><input value="{{ autoQuery }}" onChange="{{ onAutoQuery }}" placeholder="Filter…" style="width:min(260px,100%);height:36px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;outline:none"></div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ autos }}" as="a" hint-placeholder-count="8">
                      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                        <button onClick="{{ a.pin }}" title="{{ a.pinTitle }}" style="background:none;border:0;color:{{ a.pinColor }};font-size:16px;cursor:pointer;width:28px">{{ a.pinLabel }}</button>
                        <span style="font-size:18px">{{ a.icon }}</span>
                        <div style="flex:1 1 260px;min-width:0"><div style="font-size:15px">{{ a.name }}</div><div style="font-size:12px;color:var(--muted)">{{ a.desc }}</div></div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                          <span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ a.modeTone }});border:1px solid color-mix(in oklab,var(--tone-{{ a.modeTone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ a.modeTone }}) 10%,transparent)">{{ a.mode }}</span>
                          <sc-if value="{{ a.quota }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-gold);border:1px solid color-mix(in oklab,var(--tone-gold) 45%,transparent);background:color-mix(in oklab,var(--tone-gold) 10%,transparent)">quota</span></sc-if>
                          <span style="font-size:12px;color:{{ a.lastColor }};min-width:110px">{{ a.last }}</span>
                          <button type="button" onClick="{{ a.run }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Run</button>
                        </div>
                      </div>
                    </sc-for>
                    <sc-if value="{{ noAutos }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">Nothing runnable matches. The Library has the rest.</div></sc-if>
                  </div>
                </section>
              </div>
            </sc-if>
            <sc-if value="{{ isLibrary }}" hint-placeholder-val="{{ false }}">
              <div style="max-width:760px">
                <div style="font-size:14px;color:var(--muted);margin-bottom:16px;text-wrap:pretty">980 things are catalogued. Only 29 can run from here; plugins and agents are reference only, so they never show a Run button.</div>
                <div ref="{{ barsAnim }}" style="display:flex;flex-direction:column;gap:12px">
                  <sc-for list="{{ lib }}" as="l" hint-placeholder-count="6">
                    <div style="display:grid;grid-template-columns:minmax(110px,160px) 1fr auto;gap:12px;align-items:center">
                      <span style="font-size:14px">{{ l.name }}</span>
                      <span style="height:14px;background:var(--ink);border-radius:4px;position:relative"><span data-bar="1" style="position:absolute;left:0;top:0;bottom:0;width:{{ l.w }}%;background:var(--frame-hi);transform-origin:left"></span></span>
                      <span style="font-size:12px;color:var(--muted);white-space:nowrap">{{ l.total }} · {{ l.why }}</span>
                    </div>
                  </sc-for>
                </div>
              </div>
            </sc-if>
            <sc-if value="{{ isScheduled }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:10px;max-width:760px">
                <sc-for list="{{ scheduled }}" as="s" hint-placeholder-count="3">
                  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px"><div style="flex:1 1 220px"><div style="font-size:16px">{{ s.name }}</div><div style="font-size:12px;color:var(--muted)">{{ s.when }}</div></div><div style="font-size:13px;text-align:right"><div>Next · {{ s.next }}</div><div style="color:var(--green);font-size:12px">{{ s.last }}</div></div></div>
                </sc-for>
              </div>
            </sc-if>
          </div>
        </sc-if>

        <sc-if value="{{ v.claude }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isSessions }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex;flex-direction:column;gap:22px">
                <section style="background:var(--card);border:1px solid var(--purple);border-radius:12px;padding:14px 16px">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">New session</span><span style="flex:1"></span><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-gold);border:1px solid color-mix(in oklab,var(--tone-gold) 45%,transparent);background:color-mix(in oklab,var(--tone-gold) 10%,transparent)">Uses Claude quota</span></div>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:10px"><span style="font-size:12px;color:var(--faint);align-self:center;margin-right:4px">in</span><sc-for list="{{ composerProjs }}" as="p" hint-placeholder-count="8"><button onClick="{{ p.go }}" style="{{ p.style }}">{{ p.label }}</button></sc-for></div>
                  <textarea value="{{ composer }}" onChange="{{ onComposer }}" rows="3" placeholder="What should Claude do? Be specific — it runs inside the project folder." style="width:100%;margin-top:10px;padding:10px 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;resize:vertical;outline:none"></textarea>
                  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:center"><button type="button" onClick="{{ startSession }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Run in app</button><span style="font-size:12px;color:var(--faint)">tracked here · or open in a terminal from the session</span></div>
                </section>
                <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
                  <div style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ sessions }}" as="s" hint-placeholder-count="3">
                      <button onClick="{{ s.go }}" style="{{ s.style }}"><span style="display:flex;gap:8px;align-items:center"><span style="width:7px;height:7px;background:{{ s.color }}"></span><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ s.color }}">{{ s.status }}</span><span style="flex:1"></span><span style="font-size:12px;color:var(--faint)">{{ s.started }}</span></span><span style="font-size:14px">{{ s.title }}</span><span style="font-size:12px;color:var(--muted)">{{ s.proj }}</span></button>
                    </sc-for>
                  </div>
                  <sc-if value="{{ hasDetail }}" hint-placeholder-val="{{ true }}">
                    <div style="flex:2 1 380px;min-width:0;background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:18px;flex:1 1 200px">{{ sessionDetail.title }}</span><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ AI output</span></div>
                      <div style="font-size:12px;color:var(--muted)">{{ sessionDetail.proj }}</div>
                      <div style="margin-top:12px;background:var(--ink);padding:12px;font-size:13px;white-space:pre-wrap;word-break:break-word;min-height:120px"><x-import component-from-global-scope="hq-lines" text="{{ sessionDetail.tail }}" hint-size="100%,1em"></x-import></div>
                      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
                        <sc-if value="{{ sessionDetail.running }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ sessionDetail.stop }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">■ Stop</button></sc-if>
                        <button type="button" onClick="{{ sessionDetail.term }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open in terminal</button>
                      </div>
                    </div>
                  </sc-if>
                </div>
              </div>
            </sc-if>
            <sc-if value="{{ isCanvas }}" hint-placeholder-val="{{ false }}">
              <div>
                <div style="font-size:13px;color:var(--muted);margin-bottom:16px">Live answers Claude pinned for you. Everything here is model output.</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:18px">
                  <sc-for list="{{ canvas }}" as="w" hint-placeholder-count="4">
                    <div style="grid-column:{{ w.span }};display:flex;flex-direction:column;gap:8px;padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px;box-shadow:inset 0 4px 0 {{ w.color }}">
                      <div style="display:flex;gap:8px;align-items:center"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);flex:1">{{ w.title }}</span><span style="font-size:12px;padding:1px 6px;border:1px solid var(--purple);color:var(--purple)">✦ AI</span></div>
                      <sc-if value="{{ w.isStat }}" hint-placeholder-val="{{ false }}"><div><div style="font-size:36px;line-height:1;color:{{ w.color }}">{{ w.value }}</div><div style="font-size:12px;color:var(--muted);margin-top:4px">{{ w.note }}</div></div></sc-if>
                      <sc-if value="{{ w.isList }}" hint-placeholder-val="{{ false }}"><div style="display:flex;flex-direction:column;gap:4px"><sc-for list="{{ w.items }}" as="it" hint-placeholder-count="3"><div style="font-size:13px">▸ {{ it }}</div></sc-for></div></sc-if>
                      <sc-if value="{{ w.isNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;text-wrap:pretty">{{ w.body }}</div></sc-if>
                      <div style="display:flex;gap:6px;margin-top:auto"><button type="button" onClick="{{ w.pin }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Pin to Home</button><button type="button" onClick="{{ w.remove }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Remove</button></div>
                    </div>
                  </sc-for>
                </div>
                <sc-if value="{{ noCanvas }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">Canvas is empty. Ask Claude to “add this to my canvas” during a session.</div></sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>

        <sc-if value="{{ v.history }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isTrends }}" hint-placeholder-val="{{ true }}">
              <div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px"><sc-for list="{{ ranges }}" as="r" hint-placeholder-count="3"><button onClick="{{ r.go }}" style="{{ r.style }}">{{ r.label }}</button></sc-for></div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:18px">
                  <sc-for list="{{ trends }}" as="t" hint-placeholder-count="4">
                    <div style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:14px 16px">
                      <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">{{ t.label }}</div>
                      <div style="display:flex;align-items:baseline;gap:10px;margin-top:8px"><span style="font-size:33px;line-height:.9"><x-import component-from-global-scope="hq-roll" value="{{ t.value }}" hint-size="auto,1em"></x-import></span><span style="font-size:13px;color:{{ t.dColor }}">{{ t.delta }}</span></div>
                      <svg viewBox="0 0 300 70" preserveAspectRatio="none" style="width:100%;height:70px;display:block;margin-top:10px;overflow:visible"><line x1="0" y1="67" x2="300" y2="67" style="stroke:var(--frame);stroke-width:1"></line><polyline points="{{ t.pts }}" style="fill:none;stroke:var(--gold);stroke-width:2;vector-effect:non-scaling-stroke"></polyline></svg>
                      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--faint);margin-top:4px"><span>min {{ t.min }} · max {{ t.max }}</span><span>{{ t.basis }}</span></div>
                    </div>
                  </sc-for>
                </div>
              </div>
            </sc-if>
            <sc-if value="{{ isTimeline }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:26px;max-width:800px">
                <sc-for list="{{ weeks }}" as="w" hint-placeholder-count="3">
                  <section>
                    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding-bottom:8px;border-bottom:2px solid var(--frame)"><span style="font-size:18px">{{ w.w }}</span><span style="font-size:12px;color:var(--muted)">{{ w.stats }}</span></div>
                    <sc-for list="{{ w.ev }}" as="e" hint-placeholder-count="3">
                      <button onClick="{{ e.open }}" style="width:100%;display:flex;gap:12px;align-items:center;padding:9px 4px;background:none;border:0;border-bottom:1px dashed var(--frame);color:var(--text);font-family:var(--term);font-size:13px;text-align:left;cursor:pointer" style-hover="background:var(--card)"><span style="width:22px;text-align:center;color:{{ e.color }}">{{ e.g }}</span><span style="flex:1">{{ e.t }}</span><span style="font-size:12px;color:var(--faint)">{{ e.d }}</span></button>
                    </sc-for>
                    <div style="font-size:12px;color:var(--faint);padding:8px 4px">· {{ w.quiet }} collapsed</div>
                  </section>
                </sc-for>
                <sc-if value="{{ noWeeks }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No events yet. The first scan starts the timeline.</div></sc-if>
              </div>
            </sc-if>
            <sc-if value="{{ isMilestones }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:26px">
                <sc-for list="{{ achGroups }}" as="g" hint-placeholder-count="3">
                  <section>
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:12px">{{ g.label }} · {{ g.count }}</div>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:14px">
                      <sc-for list="{{ g.items }}" as="a" hint-placeholder-count="4">
                        <div style="height:100%;display:flex;flex-direction:column;gap:6px;padding:14px;border-radius:12px;border:1px solid {{ a.ring }};background:var(--card);opacity:{{ a.op }};transition:transform .15s, border-color .15s" style-hover="transform:translateY(-3px)"><div style="font-size:19px;filter:{{ a.filter }}">{{ a.icon }}</div><div style="font-size:12px;font-weight:600">{{ a.name }}</div><div style="font-size:12px;color:var(--muted);text-wrap:pretty">{{ a.desc }}</div><sc-if value="{{ a.hasProgress }}" hint-placeholder-val="{{ false }}"><div style="margin-top:auto;padding-top:6px"><div style="height:4px;border-radius:2px;background:var(--ink);overflow:hidden"><div style="height:100%;width:{{ a.progress }}%;background:var(--gold)"></div></div><div style="font-size:11px;color:var(--faint);margin-top:4px">{{ a.progressLabel }}</div></div></sc-if></div>
                      </sc-for>
                    </div>
                  </section>
                </sc-for>
              </div>
            </sc-if>
          </div>
        </sc-if>

        <sc-if value="{{ v.system }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isMachine }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex;flex-direction:column;gap:26px">
                <section style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;background:var(--card);border:1px solid {{ verdictColor }};border-radius:12px;padding:16px 20px">
                  <x-import component-from-global-scope="hq-obj-viewer" src="model:computer" mode="ascii" accent="{{ verdictHex }}" res="140" style="width:180px;height:180px;flex:0 0 auto" hint-size="180px,180px"></x-import>
                  <div style="flex:1 1 280px;min-width:0">
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ verdictColor }}">Verdict</div>
                    <div style="font-size:clamp(24px,2.9vw,35px);line-height:1;margin-top:8px">{{ verdict }}</div>
                    <div style="font-size:13px;color:var(--muted);margin-top:8px">{{ verdictSub }}</div>
                  </div>
                </section>
                <sc-if value="{{ hasIssues }}" hint-placeholder-val="{{ true }}">
                  <div style="display:flex;flex-direction:column;gap:12px">
                    <sc-for list="{{ issues }}" as="i" hint-placeholder-count="2">
                      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px;box-shadow:inset 5px 0 0 var(--orange)">
                        <div style="flex:1 1 320px;min-width:0;padding-left:6px"><div style="font-size:16px">{{ i.title }}</div><div style="font-size:13px;color:var(--muted)">{{ i.why }}</div><div style="font-size:12px;color:var(--faint);margin-top:4px">Fix · {{ i.fix }} · <span style="color:var(--text)">{{ i.cmd }}</span></div></div>
                        <div style="display:flex;gap:6px"><button type="button" onClick="{{ i.run }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Run fix</button><button type="button" onClick="{{ i.copy }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Copy</button></div>
                      </div>
                    </sc-for>
                  </div>
                </sc-if>
                <section>
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Vitals</div>
                  <div style="display:flex;flex-wrap:wrap;gap:8px"><sc-for list="{{ vitals }}" as="vt" hint-placeholder-count="8"><span style="display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;font-size:13px"><span style="width:7px;height:7px;background:{{ vt.color }}"></span><span style="color:var(--muted)">{{ vt.k }}</span><span>{{ vt.v }}</span></span></sc-for></div>
                </section>
              </div>
            </sc-if>
            <sc-if value="{{ isClutter }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:10px;max-width:800px">
                <sc-for list="{{ clutter }}" as="c" hint-placeholder-count="4">
                  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:12px 14px;background:var(--card);border:1px solid var(--frame);border-radius:12px"><div style="flex:1 1 240px"><div style="font-size:16px">{{ c.title }}</div><div style="font-size:12px;color:var(--muted)">{{ c.detail }}</div></div>
                    <sc-if value="{{ c.danger }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ c.act }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">{{ c.verb }}</button></sc-if>
                    <sc-if value="{{ c.safe }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ c.act }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ c.verb }}</button></sc-if>
                  </div>
                </sc-for>
                <sc-if value="{{ noClutter }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">The workspace is tidy.</div></sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>

        <sc-if value="{{ v.life }}" hint-placeholder-val="{{ false }}">
          <div>
            <sc-if value="{{ isScreen }}" hint-placeholder-val="{{ true }}">
              <div style="max-width:820px">
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px"><sc-for list="{{ lifeRanges }}" as="r" hint-placeholder-count="2"><button onClick="{{ r.go }}" style="{{ r.style }}">{{ r.label }}</button></sc-for></div>
                <sc-if value="{{ hasSites }}" hint-placeholder-val="{{ true }}">
                  <div>
                    <div style="display:flex;gap:30px;flex-wrap:wrap;margin-bottom:20px">
                      <div><div style="font-size:38px;line-height:1">{{ screenTotal }}</div><div style="font-size:12px;color:var(--muted)">in the browser · approx.</div></div>
                      <div><div style="font-size:38px;line-height:1;color:var(--orange)">{{ screenShare }}</div><div style="font-size:12px;color:var(--muted)">{{ screenShareLabel }}</div></div>
                    </div>
                    <div ref="{{ barsAnim }}" style="display:flex;flex-direction:column;gap:10px">
                      <sc-for list="{{ sites }}" as="s" hint-placeholder-count="6">
                        <div style="display:grid;grid-template-columns:minmax(120px,190px) 1fr 70px;gap:12px;align-items:center"><span style="font-size:13px;overflow:hidden;text-overflow:ellipsis">{{ s.name }}</span><span style="height:14px;background:var(--ink);border-radius:4px;position:relative"><span data-bar="1" style="position:absolute;left:0;top:0;bottom:0;width:{{ s.w }}%;background:{{ s.color }};transform-origin:left"></span></span><span style="font-size:13px;text-align:right">{{ s.label }}</span></div>
                      </sc-for>
                    </div>
                    <div style="font-size:12px;color:var(--faint);margin-top:14px">From the browser extension · totals are summed from page visits, so they’re approximate.</div>
                  </div>
                </sc-if>
                <sc-if value="{{ noSites }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No browser data yet. Install the extension to see where time goes.</div></sc-if>
              </div>
            </sc-if>
            <sc-if value="{{ isSocial }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:26px;max-width:820px">
                <section>
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Awaiting your approval</div>
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <sc-for list="{{ posts }}" as="p" hint-placeholder-count="2">
                      <div style="padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px">
                        <div style="display:flex;gap:8px;font-size:12px;color:var(--muted);flex-wrap:wrap"><span style="color:var(--text)">{{ p.handle }}</span><span>· {{ p.where }}</span><span>· staged {{ p.staged }}</span></div>
                        <div style="font-size:15px;margin-top:8px;padding:10px 12px;background:var(--ink);text-wrap:pretty">{{ p.text }}</div>
                        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center"><button type="button" onClick="{{ p.open }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Approve in extension ▸</button><button type="button" onClick="{{ p.skip }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Discard</button><span style="font-size:12px;color:var(--faint)">Nothing posts until you press Send in the browser.</span></div>
                      </div>
                    </sc-for>
                    <sc-if value="{{ noPosts }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--muted)">No drafts waiting.</div></sc-if>
                  </div>
                </section>
                <sc-if value="{{ hasMentions }}" hint-placeholder-val="{{ true }}">
                  <section>
                    <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Mentions</div>
                    <sc-for list="{{ mentions }}" as="m" hint-placeholder-count="3"><div style="display:flex;gap:12px;align-items:baseline;padding:10px 4px;border-bottom:1px dashed var(--frame);font-size:13px;flex-wrap:wrap"><span style="color:var(--accent-text)">{{ m.who }}</span><span style="flex:1 1 240px">{{ m.text }}</span><span style="font-size:12px;color:var(--faint)">{{ m.when }}</span></div></sc-for>
                  </section>
                </sc-if>
                <sc-if value="{{ socialEmpty }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No social data yet. Connect the browser extension to stage posts and see mentions.</div></sc-if>
              </div>
            </sc-if>
            <sc-if value="{{ isNotes }}" hint-placeholder-val="{{ false }}">
              <div style="display:flex;flex-direction:column;gap:26px;max-width:860px">
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:16px">
                  <sc-for list="{{ vaults }}" as="vv" hint-placeholder-count="3">
                    <div style="padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px;display:flex;flex-direction:column;gap:8px">
                      <div style="font-size:18px">{{ vv.name }}</div>
                      <div style="display:flex;height:12px;background:var(--ink);border-radius:4px"><span style="width:{{ vv.aw }}%;background:var(--green)"></span><span style="width:{{ vv.sw }}%;background:var(--frame-hi)"></span></div>
                      <div style="font-size:12px;color:var(--muted)">{{ vv.active }} active this week · {{ vv.stale }} stale · {{ vv.total }} notes</div>
                      <div style="font-size:12px;color:var(--faint)">{{ vv.sync }}</div>
                      <div style="display:flex;gap:6px"><button type="button" onClick="{{ vv.open }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open in Obsidian</button><button type="button" onClick="{{ vv.search }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Search</button></div>
                    </div>
                  </sc-for>
                </div>
                <section>
                  <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">Recent learnings</div>
                  <sc-for list="{{ learnings }}" as="l" hint-placeholder-count="3"><div style="display:flex;gap:12px;padding:10px 4px;border-bottom:1px dashed var(--frame);font-size:13px;flex-wrap:wrap"><span style="flex:1 1 260px">{{ l.t }}</span><span style="color:var(--muted)">{{ l.p }}</span><span style="color:var(--faint);font-size:12px">{{ l.d }}</span></div></sc-for>
                </section>
              </div>
            </sc-if>
          </div>
        </sc-if>

        <sc-if value="{{ v.studio }}" hint-placeholder-val="{{ false }}">
          <div style="display:flex;flex-direction:column;gap:24px">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
              <button type="button" onClick="{{ snip }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✂ Snip</button>
              <button type="button" onClick="{{ record }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">● Record</button>
              <span style="flex:1"></span>
              <sc-for list="{{ studioFilters }}" as="f" hint-placeholder-count="3"><button onClick="{{ f.go }}" style="{{ f.style }}">{{ f.label }}</button></sc-for>
            </div>
            <sc-if value="{{ hasLatest }}" hint-placeholder-val="{{ true }}">
              <button onClick="{{ openLatest }}" style="display:flex;flex-wrap:wrap;gap:16px;align-items:stretch;padding:0;text-align:left;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);cursor:pointer" style-hover="border-color:var(--frame-hi)">
                <span style="flex:2 1 320px;min-height:200px;display:grid;place-items:center;background:repeating-linear-gradient(45deg,var(--panel) 0 12px,var(--card) 12px 24px);color:var(--faint);font-size:13px">{{ latest.name }}</span>
                <span style="flex:1 1 200px;padding:16px;display:flex;flex-direction:column;gap:6px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Latest capture</span><span style="font-size:16px;word-break:break-all">{{ latest.name }}</span><span style="font-size:12px;color:var(--muted)">{{ latest.day }} {{ latest.time }} · {{ latest.size }}</span></span>
              </button>
            </sc-if>
            <sc-for list="{{ days }}" as="d" hint-placeholder-count="2">
              <section>
                <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted);margin-bottom:10px">{{ d.day }}</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr));gap:14px">
                  <sc-for list="{{ d.items }}" as="c" hint-placeholder-count="3">
                    <button onClick="{{ c.open }}" style="display:flex;flex-direction:column;padding:0;text-align:left;background:var(--card);border:1px solid var(--frame);border-radius:12px;color:var(--text);font-family:var(--term);cursor:pointer;transition:transform .14s" style-hover="transform:translateY(-3px);border-color:var(--frame-hi)">
                      <span style="height:110px;display:grid;place-items:center;background:repeating-linear-gradient(45deg,var(--panel) 0 10px,var(--card) 10px 20px);color:var(--faint);font-size:16px;position:relative">▢<sc-if value="{{ c.isRec }}" hint-placeholder-val="{{ false }}"><span style="position:absolute;right:6px;bottom:6px;font-size:12px;padding:1px 6px;background:var(--red);color:#fff">● {{ c.dur }}</span></sc-if></span>
                      <span style="padding:8px 10px;font-size:12px;color:var(--muted);word-break:break-all">{{ c.time }} · {{ c.size }}</span>
                    </button>
                  </sc-for>
                </div>
              </section>
            </sc-for>
            <sc-if value="{{ noCaps }}" hint-placeholder-val="{{ false }}"><div style="font-size:14px;color:var(--muted)">No captures yet. Ctrl Alt S to snip, Ctrl Alt R to record.</div></sc-if>
          </div>
        </sc-if>
        <sc-if value="{{ showPrompt }}" hint-placeholder-val="{{ true }}">
          <button onClick="{{ openPalette }}" style="position:sticky;bottom:16px;z-index:5;margin-top:40px;width:100%;display:flex;align-items:center;gap:10px;height:44px;padding:0 16px;border-radius:12px;background:var(--panel);backdrop-filter:blur(12px);border:1px solid var(--frame);color:var(--muted);font-family:var(--term);font-size:13px;cursor:text;text-align:left;box-shadow:0 10px 30px rgba(0,0,0,.25)" style-hover="border-color:var(--gold)">
            <span style="color:var(--gold);font-weight:600">›</span>
            <span style="flex:1;min-width:0;overflow:hidden;white-space:nowrap"><x-import component-from-global-scope="hq-prompt" hints="{{ promptHints }}" hint-size="auto,1em"></x-import></span>
            <span style="font-size:11px;color:var(--faint)">ctrl k</span>
          </button>
        </sc-if>
        <sc-if value="{{ hasLightbox }}" hint-placeholder-val="{{ false }}">
          <div onClick="{{ closeLightbox }}" style="position:fixed;inset:0;z-index:1080;background:rgba(5,4,9,.85);display:flex;align-items:center;justify-content:center;padding:20px">
            <div onClick="{{ stop }}" ref="{{ popIn }}" style="width:min(820px,100%);background:var(--card);border:1px solid var(--frame-hi);border-radius:12px">
              <div style="height:min(52vh,460px);display:grid;place-items:center;background:repeating-linear-gradient(45deg,var(--panel) 0 14px,var(--card) 14px 28px);color:var(--faint);font-size:15px">{{ lb.name }}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 14px">
                <div style="flex:1 1 200px;min-width:0"><div style="font-size:14px;word-break:break-all">{{ lb.name }}</div><div style="font-size:12px;color:var(--muted)">{{ lb.meta }}</div></div>
                <button type="button" onClick="{{ lbOpen }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open</button>
                <button type="button" onClick="{{ lbCopy }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Copy</button>
                <button type="button" onClick="{{ lbReveal }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Show in folder</button>
                <button type="button" onClick="{{ lbDelete }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">Delete…</button>
              </div>
            </div>
          </div>
        </sc-if>
      </div>
    </main>

    <sc-if value="{{ showAmbient }}" hint-placeholder-val="{{ false }}">
      <aside aria-label="Status" ref="{{ slideIn }}" style="{{ ambientStyle }}">
        <div style="display:flex;align-items:center;justify-content:space-between"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">Status · live</span><sc-if value="{{ ambientOverlayOpen }}" hint-placeholder-val="{{ false }}"><button onClick="{{ toggleAmbientOverlay }}" style="background:none;border:0;color:var(--muted);font-size:15px;cursor:pointer">×</button></sc-if></div>
        <sc-for list="{{ amb }}" as="a" hint-placeholder-count="5">
          <button onClick="{{ a.go }}" style="text-align:left;display:flex;flex-direction:column;gap:3px;padding:11px 12px;background:var(--card);border:1px solid var(--frame);border-radius:12px;cursor:pointer;font-family:var(--term);color:var(--text);transition:transform .12s, box-shadow .12s" style-hover="transform:translateX(-3px);border-color:var(--frame-hi)">
            <span style="display:flex;align-items:center;gap:7px;font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)"><span style="width:7px;height:7px;background:{{ a.color }}"></span>{{ a.label }}</span>
            <span style="font-size:14px;line-height:1.1">{{ a.title }}</span>
            <span style="font-size:12px;color:var(--faint)">{{ a.sub }}</span>
          </button>
        </sc-for>
      </aside>
    </sc-if>
  </div>

  <sc-if value="{{ L.bottomNav }}" hint-placeholder-val="{{ false }}">
    <nav aria-label="Destinations" style="flex:0 0 auto;height:62px;display:flex;background:var(--panel);border-top:1px solid var(--frame);backdrop-filter:blur(10px);position:relative;z-index:30">
      <sc-for list="{{ bottomNav }}" as="b" hint-placeholder-count="5">
        <button onClick="{{ b.go }}" style="flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:none;border:0;cursor:pointer;color:{{ b.color }};font-family:var(--term);font-size:12px"><x-import component-from-global-scope="hq-icon" name="{{ b.icon }}" size="18" hint-size="18px,18px"></x-import><span>{{ b.label }}</span></button>
      </sc-for>
    </nav>
  </sc-if>
  <sc-if value="{{ moreOpen }}" hint-placeholder-val="{{ false }}">
    <div ref="{{ popIn }}" style="position:fixed;left:8px;right:8px;bottom:70px;z-index:900;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">
      <sc-for list="{{ moreNav }}" as="n" hint-placeholder-count="5">
        <button onClick="{{ n.go }}" style="height:46px;display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer"><x-import component-from-global-scope="hq-icon" name="{{ n.id }}" size="16" hint-size="16px,16px"></x-import><span>{{ n.label }}</span></button>
      </sc-for>
    </div>
  </sc-if>
  <sc-if value="{{ scrubOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeScrub }}" style="position:fixed;inset:58px 0 0 0;z-index:880"></div>
    <div ref="{{ popIn }}" style="position:fixed;top:64px;left:12px;z-index:890;width:min(560px,calc(100vw - 24px));background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 18px 40px rgba(0,0,0,.4);padding:16px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Snapshots</span><span style="font-size:12px;color:var(--faint)">90 days · bar = uncommitted files · ← → to scrub</span></div>
      <div style="display:flex;align-items:flex-end;gap:2px;height:50px;margin:14px 0 8px">
        <sc-for list="{{ scrubBars }}" as="b" hint-placeholder-count="90"><button onClick="{{ b.go }}" title="{{ b.title }}" aria-label="{{ b.title }}" style="flex:1 1 0;min-width:2px;height:{{ b.h }}px;background:{{ b.c }};border:0;padding:0;cursor:pointer" style-hover="background:var(--gold-2)"></button></sc-for>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--faint)"><span>{{ scrubFrom }}</span><span>{{ scrubTo }}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px"><sc-for list="{{ scrubQuick }}" as="q" hint-placeholder-count="5"><button onClick="{{ q.go }}" style="{{ q.style }}">{{ q.label }}</button></sc-for><span style="flex:1"></span><button onClick="{{ toggleCompare }}" style="height:30px;padding:0 12px;border-radius:8px;background:var(--card);border:1px solid var(--frame);color:var(--accent-text);font-family:var(--term);font-size:12px;cursor:pointer">⇄ compare</button></div>
      <sc-if value="{{ compareOn }}" hint-placeholder-val="{{ false }}">
        <div style="margin-top:12px;border:1px solid var(--frame);border-radius:10px;padding:10px 12px">
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)"><button onClick="{{ cmpBack }}" style="width:26px;height:26px;border-radius:6px;background:var(--ink);border:1px solid var(--frame);color:var(--text);cursor:pointer">‹</button><span style="flex:1;text-align:center;color:var(--text)">{{ compareLabel }}</span><button onClick="{{ cmpFwd }}" style="width:26px;height:26px;border-radius:6px;background:var(--ink);border:1px solid var(--frame);color:var(--text);cursor:pointer">›</button></div>
          <sc-for list="{{ cmpRows }}" as="c" hint-placeholder-count="5"><div style="display:grid;grid-template-columns:1fr 54px 54px 54px;gap:8px;padding:6px 0;border-bottom:1px dashed var(--frame);font-size:12px"><span style="color:var(--muted)">{{ c.l }}</span><span style="text-align:right">{{ c.a }}</span><span style="text-align:right">{{ c.b }}</span><span style="text-align:right;color:{{ c.c }}">{{ c.d }}</span></div></sc-for>
        </div>
      </sc-if>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--frame)">
        <div><div style="font-size:22px;line-height:1">{{ scrubSel.unc }}</div><div style="font-size:12px;color:var(--muted)">uncommitted</div></div>
        <div><div style="font-size:22px;line-height:1">{{ scrubSel.tasks }}</div><div style="font-size:12px;color:var(--muted)">open tasks</div></div>
        <div><div style="font-size:22px;line-height:1;color:var(--accent-text)">{{ scrubSel.xp }}</div><div style="font-size:12px;color:var(--muted)">xp</div></div>
        <div><div style="font-size:22px;line-height:1">{{ scrubSel.changes }}</div><div style="font-size:12px;color:var(--muted)">changes</div></div>
      </div>
      <div style="font-size:12px;color:var(--faint);margin-top:10px">Showing {{ scrubSel.label }} · every screen follows this date</div>
    </div>
  </sc-if>

  <sc-if value="{{ runsOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeRuns }}" style="position:fixed;inset:0;z-index:910;background:var(--scrim)"></div>
    <aside ref="{{ slideIn }}" aria-label="Activity" style="position:fixed;top:0;right:0;bottom:0;z-index:920;width:min(440px,100vw);background:var(--panel);border-left:1px solid var(--frame);backdrop-filter:blur(10px);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:10px;padding:16px;border-bottom:1px solid var(--frame);backdrop-filter:blur(10px)"><span style="font-size:21px;flex:1">Activity</span><span style="font-size:12px;color:var(--muted)">scans · runs · dev servers · terminals</span><button onClick="{{ closeRuns }}" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
      <div style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:6px"><sc-for list="{{ actTabs }}" as="t" hint-placeholder-count="2"><button onClick="{{ t.go }}" style="{{ t.style }}">{{ t.label }}</button></sc-for></div>
        <sc-if value="{{ isRunsTab }}" hint-placeholder-val="{{ true }}"><div style="display:flex;flex-direction:column;gap:10px">
        <sc-for list="{{ runs }}" as="r" hint-placeholder-count="3">
          <div style="background:var(--card);border:1px solid var(--frame);border-radius:12px;padding:12px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="width:8px;height:8px;background:{{ r.color }}"></span>
              <span style="font-size:14px;flex:1 1 160px">{{ r.name }}</span>
              <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:{{ r.color }}">{{ r.status }}</span>
            </div>
            <div style="font-size:12px;color:var(--faint);margin-top:4px;word-break:break-word">{{ r.started }} · {{ r.meta }}</div>
            <sc-if value="{{ r.isRunning }}" hint-placeholder-val="{{ false }}"><div style="height:6px;background:var(--ink);margin-top:8px;border-radius:4px"><div style="height:100%;width:{{ r.progress }}%;background:var(--gold);transition:width .5s"></div></div></sc-if>
            <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
              <button type="button" onClick="{{ r.toggle }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Output</button>
              <sc-if value="{{ r.canCancel }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ r.cancel }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">Cancel</button></sc-if>
              <sc-if value="{{ r.isDev }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ r.stop }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">■ Stop</button></sc-if>
            </div>
            <sc-if value="{{ r.expanded }}" hint-placeholder-val="{{ false }}"><div style="margin-top:10px;background:var(--ink);padding:10px;font-size:12px;color:var(--text);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto"><x-import component-from-global-scope="hq-lines" text="{{ r.out }}" hint-size="100%,1em"></x-import></div></sc-if>
          </div>
        </sc-for></div></sc-if>
        <sc-if value="{{ isNotesTab }}" hint-placeholder-val="{{ false }}"><div style="display:flex;flex-direction:column">
          <div style="font-size:12px;color:var(--faint);padding-bottom:8px">Only measured, actionable, new events. No reminders.</div>
          <sc-for list="{{ notes }}" as="n" hint-placeholder-count="5"><div style="display:flex;gap:10px;align-items:baseline;padding:9px 2px;border-bottom:1px dashed var(--frame);font-size:13px"><span style="width:7px;height:7px;border-radius:2px;background:{{ n.c }};flex:0 0 auto;transform:translateY(-1px)"></span><span style="flex:1">{{ n.t }}</span><span style="font-size:11px;color:var(--faint);white-space:nowrap">{{ n.d }}</span></div></sc-for>
        </div></sc-if>
      </div>
    </aside>
  </sc-if>

  <sc-if value="{{ askOpen }}" hint-placeholder-val="{{ false }}">
    <aside ref="{{ slideIn }}" aria-label="Ask" style="position:fixed;top:58px;right:0;bottom:0;z-index:905;width:min(420px,100vw);background:var(--panel);border-left:1px solid var(--frame);backdrop-filter:blur(10px);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:2px solid var(--ink)"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ Local model</span><span style="font-size:18px;flex:1">Ask</span><button onClick="{{ closeAsk }}" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
      <div style="padding:10px 16px;font-size:12px;color:var(--faint);border-bottom:1px dashed var(--frame)">Answers come from today’s data only, never the web. Model text stays in this panel.<sc-if value="{{ askPastNote }}" hint-placeholder-val="{{ false }}"> You’re viewing {{ viewedLabel }}; answers are still about today.</sc-if></div>
      <div style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:14px">
        <sc-for list="{{ asks }}" as="a" hint-placeholder-count="1">
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="align-self:flex-end;max-width:85%;background:var(--ink);border:1px solid var(--frame);border-radius:8px;padding:6px 10px;font-size:13px">{{ a.q }}</div>
            <div style="background:var(--card);border:1px solid var(--purple);border-radius:12px;padding:12px">
              <div style="font-size:13px;text-wrap:pretty"><x-import component-from-global-scope="hq-type" text="{{ a.text }}" speed="12" hide-cursor="" hint-size="auto,1em"></x-import></div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
                <sc-for list="{{ a.src }}" as="s" hint-placeholder-count="1"><span style="font-size:12px;padding:1px 6px;border:1px solid var(--frame);color:var(--muted)">grounded in {{ s }}</span></sc-for>
                <sc-if value="{{ a.est }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;padding:1px 6px;border:1px dotted var(--faint);color:var(--faint)">estimate</span></sc-if>
                <sc-if value="{{ a.refusal }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;padding:1px 6px;border:1px solid var(--blue);color:var(--blue)">honest “don’t know”</span></sc-if>
              </div>
            </div>
          </div>
        </sc-for>
      </div>
      <div style="display:flex;gap:8px;padding:12px 16px;border-top:2px solid var(--ink)">
        <input value="{{ askDraft }}" onChange="{{ onAskInput }}" onKeyDown="{{ askKey }}" placeholder="Ask a follow-up…" style="flex:1;min-width:0;height:40px;padding:0 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;outline:none">
        <button type="button" onClick="{{ askSubmit }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Ask</button>
      </div>
    </aside>
  </sc-if>

  <sc-if value="{{ paletteOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closePalette }}" style="position:fixed;inset:0;z-index:1000;background:var(--scrim);display:flex;justify-content:center;align-items:flex-start;padding:10vh 12px 12px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Search and commands" style="width:min(660px,100%);max-height:76vh;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <div style="display:flex;gap:6px;padding:10px 12px 0"><sc-for list="{{ palModeTabs }}" as="m" hint-placeholder-count="2"><button onClick="{{ m.go }}" style="{{ m.style }}">{{ m.label }}</button></sc-for><span style="flex:1"></span><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);align-self:center">Tab switches</span></div>
        <div style="padding:10px 12px;border-bottom:2px solid var(--ink)"><input autoFocus="{{ true }}" value="{{ paletteQuery }}" onChange="{{ onPaletteInput }}" placeholder="{{ palPlaceholder }}" style="width:100%;height:46px;padding:0 14px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:16px;outline:none"></div>
        <sc-if value="{{ palIsGo }}" hint-placeholder-val="{{ true }}">
          <div style="overflow-y:auto;padding:6px 0 10px">
            <sc-for list="{{ palGroups }}" as="g" hint-placeholder-count="3">
              <div>
                <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);padding:10px 14px 4px">{{ g.name }}</div>
                <sc-for list="{{ g.items }}" as="it" hint-placeholder-count="3">
                  <button onClick="{{ it.run }}" onMouseEnter="{{ it.hoverSel }}" style="{{ it.style }}"><span style="width:24px;text-align:center;flex:0 0 auto">{{ it.glyph }}</span><span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ it.label }}</span><span style="font-size:12px;color:var(--faint);flex:0 0 auto">{{ it.hint }}</span></button>
                </sc-for>
              </div>
            </sc-for>
            <sc-if value="{{ palEmpty }}" hint-placeholder-val="{{ false }}"><div style="padding:16px;font-size:13px;color:var(--muted)">No matches. Press Tab to ask the local model instead.</div></sc-if>
          </div>
        </sc-if>
        <sc-if value="{{ palIsAsk }}" hint-placeholder-val="{{ false }}">
          <div style="padding:14px;display:flex;flex-direction:column;gap:8px">
            <div style="font-size:13px;color:var(--muted)">Ask the local model about today’s projects, tasks and scans. Press Enter — the answer opens in the Ask panel with what it’s grounded in.</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><sc-for list="{{ askExamples }}" as="e" hint-placeholder-count="4"><button onClick="{{ e.go }}" style="height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:12px;cursor:pointer" style-hover="border-color:var(--purple)">{{ e.q }}</button></sc-for></div>
          </div>
        </sc-if>
        <div style="display:flex;gap:16px;flex-wrap:wrap;padding:8px 14px;border-top:2px solid var(--ink);font-size:12px;color:var(--faint)"><span>↑↓ move</span><span>Enter open</span><span>Tab Go / Ask</span><span>Esc close</span></div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ hasFocus }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed;inset:0;z-index:950;background:rgba(5,4,9,.9);display:flex;align-items:center;justify-content:center;padding:20px">
      <div ref="{{ popIn }}" role="dialog" aria-label="Focus" style="width:min(680px,100%);text-align:center;color:#e8e6ff">
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:#ffe27a">Focus</div>
        <sc-if value="{{ focus.has }}" hint-placeholder-val="{{ true }}">
          <div>
            <div style="font-size:clamp(22px,3.6vw,35px);line-height:1.05;margin-top:16px;text-wrap:balance">{{ focus.title }}</div>
            <div style="font-size:15px;color:#9a93c9;margin-top:10px">{{ focus.proj }} · {{ focus.why }}</div>
            <div style="font-size:clamp(40px,7.2vw,69px);line-height:1;margin-top:26px;color:#e8e6ff">{{ focus.elapsed }}</div>
            <div style="font-size:12px;color:#5e588a">elapsed · no timer to beat</div>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:24px">
              <button type="button" onClick="{{ focus.done }}" disabled="{{ cantWrite }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ Done · +{{ focus.xp }} xp</button>
              <button type="button" onClick="{{ focus.stop }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Stop (not done)</button>
              <button type="button" onClick="{{ focus.open }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Open project</button>
            </div>
          </div>
        </sc-if>
        <sc-if value="{{ focus.none }}" hint-placeholder-val="{{ false }}"><div><div style="font-size:31px;margin-top:16px">Nothing to focus on.</div><div style="font-size:15px;color:#9a93c9;margin-top:8px">The board is clear. Enjoy it.</div><div style="margin-top:20px"><button type="button" onClick="{{ closeFocus }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Close</button></div></div></sc-if>
        <sc-if value="{{ focus.hasPicker }}" hint-placeholder-val="{{ false }}">
          <div style="margin-top:34px;display:flex;flex-direction:column;gap:6px;align-items:center">
            <span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:#5e588a">Switch to</span>
            <sc-for list="{{ focus.picker }}" as="p" hint-placeholder-count="3"><button onClick="{{ p.go }}" style="display:flex;align-items:center;gap:8px;background:none;border:0;color:#9a93c9;font-family:var(--term);font-size:13px;cursor:pointer" style-hover="color:#e8e6ff"><span style="width:7px;height:7px;background:{{ p.color }}"></span>{{ p.title }}</button></sc-for>
          </div>
        </sc-if>
        <div style="font-size:12px;color:#5e588a;margin-top:26px">Esc or F to leave</div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ hasConfirm }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ cancelConfirm }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Run confirm" style="width:min(560px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Before this runs</div>
        <div style="display:flex;gap:12px;align-items:center;margin-top:10px"><span style="font-size:24px">{{ confirm.icon }}</span><div><div style="font-size:21px;line-height:1">{{ confirm.name }}</div><div style="font-size:13px;color:var(--muted)">{{ confirm.desc }}</div></div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">
          <span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-{{ confirm.kindTone }});border:1px solid color-mix(in oklab,var(--tone-{{ confirm.kindTone }}) 45%,transparent);background:color-mix(in oklab,var(--tone-{{ confirm.kindTone }}) 10%,transparent)">{{ confirm.kind }}</span>
          <sc-if value="{{ confirm.quota }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-gold);border:1px solid color-mix(in oklab,var(--tone-gold) 45%,transparent);background:color-mix(in oklab,var(--tone-gold) 10%,transparent)">Uses Claude quota</span></sc-if>
          <sc-if value="{{ confirm.destructive }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--tone-red);border:1px solid color-mix(in oklab,var(--tone-red) 45%,transparent);background:color-mix(in oklab,var(--tone-red) 10%,transparent)">Changes remote repos · always asks</span></sc-if>
        </div>
        <div style="margin-top:14px;font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">Exact command</div>
        <div style="margin-top:6px;background:var(--ink);padding:10px 12px;font-size:13px;word-break:break-all">{{ confirm.cmd }}</div>
        <div style="margin-top:6px;font-size:12px;color:var(--muted)">in {{ confirm.dir }}</div>
        <sc-if value="{{ confirm.hasSteps }}" hint-placeholder-val="{{ false }}">
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:4px"><sc-for list="{{ confirm.steps }}" as="s" hint-placeholder-count="3"><div style="font-size:13px"><span style="color:var(--accent-text);margin-right:8px">{{ s.n }}.</span>{{ s.s }}</div></sc-for></div>
        </sc-if>
        <div style="margin-top:12px;font-size:12px;color:{{ confirm.lastColor }}">{{ confirm.last }}</div>
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px"><sc-for list="{{ confirm.askOpts }}" as="o" hint-placeholder-count="2"><button onClick="{{ o.go }}" disabled="{{ o.disabled }}" style="display:flex;gap:10px;align-items:center;background:none;border:0;padding:4px 0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer;text-align:left" style-hover="color:var(--accent-text)"><span style="color:var(--accent-text)">{{ o.on }}</span>{{ o.label }}</button></sc-for></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <button type="button" onClick="{{ cancelConfirm }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Cancel · Esc</button>
          <button type="button" onClick="{{ confirmRun }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">▶ Run · Enter</button>
        </div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ hasCommit }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ cancelCommit }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Commit" style="width:min(640px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--green);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="font-size:21px">{{ commit.title }}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Only the ticked files are staged. .env files start unticked.</div>
        <div style="margin-top:14px;max-height:220px;overflow:auto;background:var(--ink);padding:6px">
          <sc-for list="{{ commit.files }}" as="f" hint-placeholder-count="6">
            <button onClick="{{ f.toggle }}" style="width:100%;display:flex;gap:10px;align-items:center;padding:5px 8px;background:{{ f.rowBg }};border-radius:6px;border:0;color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer;text-align:left" style-hover="background:var(--card)"><span style="color:var(--accent-text)">{{ f.on }}</span><span style="color:{{ f.stColor }};width:14px">{{ f.st }}</span><span style="flex:1">{{ f.name }}</span><sc-if value="{{ f.warn }}" hint-placeholder-val="{{ false }}"><span style="color:var(--red);font-size:12px">may hold secrets</span></sc-if></button>
          </sc-for>
          <sc-if value="{{ commit.hasMore }}" hint-placeholder-val="{{ false }}"><div style="padding:5px 8px;font-size:12px;color:var(--faint)">+ {{ commit.more }} more files, all included</div></sc-if>
        </div>
        <div style="margin-top:10px;border:1px solid var(--frame);border-radius:10px;overflow:hidden"><div style="padding:6px 10px;font-size:11px;color:var(--faint);border-bottom:1px solid var(--frame);background:var(--ink)">diff · {{ commit.selName }} · click a file to preview</div><div style="padding:8px 10px;font-size:12px;white-space:pre;overflow-x:auto;max-height:170px"><x-import component-from-global-scope="hq-lines" text="{{ commit.diff }}" hint-size="100%,1em"></x-import></div></div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:14px"><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">Message</span><span style="flex:1"></span><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ AI</span><span style="font-size:12px;color:var(--faint)">{{ commit.drafted }}</span></div>
        <textarea value="{{ commit.msg }}" onChange="{{ commit.onMsg }}" rows="6" style="width:100%;margin-top:6px;padding:10px 12px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px;resize:vertical;outline:none"></textarea>
        <div style="font-size:12px;color:var(--faint);margin-top:6px">{{ commit.cmd }}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">
          <button type="button" onClick="{{ cancelCommit }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Cancel</button>
          <button type="button" onClick="{{ doCommit }}" disabled="{{ commit.none }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:color-mix(in oklab,var(--green) 10%,transparent);color:var(--green);border:1px solid color-mix(in oklab,var(--green) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--green) 20%,transparent);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">✓ {{ commit.okLabel }}</button>
        </div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ hasSheet }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ cancelSheet }}" style="position:fixed;inset:0;z-index:1150;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="alertdialog" style="width:min(500px,100%);background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="font-size:21px;line-height:1.1">{{ sheet.title }}</div>
        <div style="font-size:13px;color:var(--muted);margin-top:10px;text-wrap:pretty;white-space:pre-wrap;overflow-wrap:anywhere">{{ sheet.body }}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap">
          <button type="button" onClick="{{ cancelSheet }}" autoFocus="{{ true }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Cancel</button>
          <sc-if value="{{ sheetDanger }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ sheetOk }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:color-mix(in oklab,var(--red) 10%,transparent);color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="background:color-mix(in oklab,var(--red) 20%,transparent)" style-active="transform:translateY(1px) scale(.98)">{{ sheet.ok }}</button></sc-if>
          <sc-if value="{{ sheetSafe }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ sheetOk }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">{{ sheet.ok }}</button></sc-if>
        </div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ settingsOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeSettings }}" style="position:fixed;inset:0;z-index:1050;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Settings" style="width:min(680px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="display:flex;align-items:center"><span style="font-size:24px;flex:1">Settings</span><button onClick="{{ closeSettings }}" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">Appearance</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><sc-for list="{{ themeOpts }}" as="t" hint-placeholder-count="3"><button onClick="{{ t.go }}" style="{{ t.style }}">{{ t.label }}</button></sc-for></div>
        <div style="display:flex;flex-direction:column;margin-top:14px">
          <sc-for list="{{ settings }}" as="s" hint-placeholder-count="5">
            <div style="display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px dashed var(--frame)"><div style="flex:1;min-width:0"><div style="font-size:15px">{{ s.label }}</div><div style="font-size:12px;color:var(--muted)">{{ s.desc }}</div></div><button onClick="{{ s.toggle }}" role="switch" style="{{ s.style }}">{{ s.state }}</button></div>
          </sc-for>
        </div>
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">Global hotkeys</div>
        <div style="display:flex;flex-direction:column;margin-top:6px">
          <sc-for list="{{ hotkeys }}" as="h" hint-placeholder-count="7"><div style="display:flex;gap:12px;padding:6px 0;font-size:13px"><span style="width:150px;flex:0 0 auto;color:var(--text)">{{ h.k }}</span><span style="flex:1;color:var(--muted)">{{ h.d }}</span><span style="color:{{ h.color }}">{{ h.st }}</span></div></sc-for>
        </div>
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">Export</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px"><button type="button" onClick="{{ exportCard }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Save stat card PNG</button><span style="font-size:12px;color:var(--faint)">measured numbers only</span></div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ cheatOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeCheat }}" style="position:fixed;inset:0;z-index:1050;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Shortcuts" style="width:min(460px,100%);background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;padding:20px 22px">
        <div style="font-size:21px">Keyboard</div>
        <div style="display:flex;flex-direction:column;margin-top:10px"><sc-for list="{{ keys }}" as="k" hint-placeholder-count="7"><div style="display:flex;gap:12px;padding:7px 0;border-bottom:1px dashed var(--frame);font-size:13px"><span style="width:150px;flex:0 0 auto;color:var(--accent-text)">{{ k.k }}</span><span style="color:var(--muted)">{{ k.d }}</span></div></sc-for></div>
        <div style="font-size:12px;color:var(--faint);margin-top:12px">Typing in a field never triggers a shortcut.</div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ hasLevel }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed;inset:0;z-index:1200;background:rgba(5,4,9,.88);display:flex;align-items:center;justify-content:center;padding:16px;perspective:600px">
      <div ref="{{ popIn }}" style="text-align:center;color:#e8e6ff;width:min(460px,100%)">
        <x-import component-from-global-scope="hq-obj-viewer" src="model:trophy" mode="ascii" res="130" style="width:200px;height:160px;margin:0 auto;display:block" hint-size="200px,160px"></x-import>
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:#ffe27a;margin-top:24px">Level up</div>
        <div style="font-size:40px;line-height:1;margin-top:8px">Level {{ lvl.l }} · {{ lvl.t }}</div>
        <div style="margin-top:22px;background:#14102b;border:2px solid #050409;box-shadow:0 0 0 2px #ffd23f;padding:14px 16px;text-align:left">
          <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:#9a93c9;margin-bottom:8px">Since level {{ lvl.l }} − 1 · measured</div>
          <sc-for list="{{ lvl.stats }}" as="s" hint-placeholder-count="4"><div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px"><span style="color:#9a93c9">{{ s.k }}</span><span>{{ s.v }}</span></div></sc-for>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:20px"><button type="button" onClick="{{ closeLevel }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Continue</button><button type="button" onClick="{{ exportCard }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s" style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)">Save card</button></div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ refreshing }}" hint-placeholder-val="{{ false }}">
    <div ref="{{ popIn }}" style="position:fixed;top:66px;left:50%;transform:translateX(-50%);z-index:1250;background:var(--card);border:1px solid var(--gold);border-radius:12px;padding:8px 16px;font-size:13px">⟳ Refreshing · keeping your place</div>
  </sc-if>

  <sc-if value="{{ onboardOpen }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeOnboard }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Add project" style="width:min(560px,100%);background:var(--card-hi);border:1px solid var(--gold);border-radius:14px;padding:20px 22px;box-shadow:0 24px 60px rgba(0,0,0,.5)">
        <div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--faint)">╭─ add project</span><span style="flex:1"></span><sc-for list="{{ ob.dots }}" as="d" hint-placeholder-count="3"><span style="width:18px;height:4px;border-radius:2px;background:{{ d.c }}"></span></sc-for><span style="font-size:11px;color:var(--faint)">{{ ob.stepLabel }}</span></div>
        <sc-if value="{{ ob.s1 }}" hint-placeholder-val="{{ true }}"><div style="margin-top:14px"><div style="font-size:20px"><x-import component-from-global-scope="hq-type" text="Where does it live?" hint-size="auto,1em"></x-import></div><div style="font-size:12px;color:var(--muted);margin-top:4px">A folder on this PC. Nothing is uploaded anywhere.</div><input value="{{ ob.path }}" onChange="{{ obPath }}" style="width:100%;margin-top:12px;height:40px;padding:0 12px;border-radius:8px;background:var(--ink);border:1px solid var(--frame);color:var(--text);font-family:var(--term);font-size:14px;outline:none"><input value="{{ ob.name }}" onChange="{{ obName }}" placeholder="Display name" style="width:100%;margin-top:8px;height:40px;padding:0 12px;border-radius:8px;background:var(--ink);border:1px solid var(--frame);color:var(--text);font-family:var(--term);font-size:14px;outline:none"></div></sc-if>
        <sc-if value="{{ ob.s2 }}" hint-placeholder-val="{{ false }}"><div style="margin-top:14px"><div style="font-size:20px">Detected</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><span style="padding:3px 9px;border-radius:999px;border:1px solid var(--frame);font-size:12px">Next.js</span><span style="padding:3px 9px;border-radius:999px;border:1px solid var(--frame);font-size:12px">TypeScript</span><span style="padding:3px 9px;border-radius:999px;border:1px solid var(--frame);font-size:12px">pnpm</span><span style="padding:3px 9px;border-radius:999px;border:1px solid color-mix(in oklab,var(--green) 50%,transparent);color:var(--green);font-size:12px">git · 1 commit</span></div><div style="font-size:12px;color:var(--muted);margin-top:14px">dev command</div><input value="{{ ob.dev }}" onChange="{{ obDev }}" style="width:100%;margin-top:6px;height:40px;padding:0 12px;border-radius:8px;background:var(--ink);border:1px solid var(--frame);color:var(--text);font-family:var(--term);font-size:14px;outline:none"></div></sc-if>
        <sc-if value="{{ ob.s3 }}" hint-placeholder-val="{{ false }}"><div style="margin-top:14px"><div style="font-size:20px">Main branch</div><div style="font-size:12px;color:var(--muted);margin-top:4px">Tasks warn you when you work on any other branch for long.</div><input value="{{ ob.branch }}" onChange="{{ obBranch }}" style="width:100%;margin-top:12px;height:40px;padding:0 12px;border-radius:8px;background:var(--ink);border:1px solid var(--frame);color:var(--text);font-family:var(--term);font-size:14px;outline:none"></div></sc-if>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
          <button onClick="{{ closeOnboard }}" style="height:34px;padding:0 14px;border-radius:8px;background:var(--card);border:1px solid var(--frame);color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer">Cancel</button>
          <sc-if value="{{ ob.notS1 }}" hint-placeholder-val="{{ false }}"><button onClick="{{ obBack }}" style="height:34px;padding:0 14px;border-radius:8px;background:var(--card);border:1px solid var(--frame);color:var(--text);font-family:var(--term);font-size:13px;cursor:pointer">Back</button></sc-if>
          <sc-if value="{{ ob.notS3 }}" hint-placeholder-val="{{ true }}"><button onClick="{{ obNext }}" style="height:34px;padding:0 14px;border-radius:8px;background:var(--gold);border:1px solid var(--gold);color:#1a0f0a;font-weight:600;font-family:var(--term);font-size:13px;cursor:pointer">Next ›</button></sc-if>
          <sc-if value="{{ ob.s3 }}" hint-placeholder-val="{{ false }}"><button onClick="{{ obFinish }}" style="height:34px;padding:0 14px;border-radius:8px;background:var(--gold);border:1px solid var(--gold);color:#1a0f0a;font-weight:600;font-family:var(--term);font-size:13px;cursor:pointer">✓ Start tracking</button></sc-if>
        </div>
      </div>
    </div>
  </sc-if>
  <div aria-live="polite" style="position:fixed;right:16px;bottom:84px;z-index:1300;display:flex;flex-direction:column;gap:8px;align-items:flex-end;max-width:min(420px,calc(100vw - 32px));pointer-events:none">
    <sc-for list="{{ toasts }}" as="t" hint-placeholder-count="0">
      <div ref="{{ t.ref }}" style="pointer-events:auto;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px;box-shadow:inset 5px 0 0 {{ t.color }}, 0 12px 30px rgba(0,0,0,.35);font-size:13px">
        <sc-if value="{{ t.isProgress }}" hint-placeholder-val="{{ false }}"><span ref="{{ pulse }}" style="width:8px;height:8px;background:var(--gold);flex:0 0 auto"></span></sc-if>
        <span style="flex:1;min-width:0">{{ t.text }}</span>
        <sc-if value="{{ t.hasUndo }}" hint-placeholder-val="{{ false }}"><button onClick="{{ t.undo }}" style="background:none;border:0;color:var(--link);font-size:13px;cursor:pointer">Undo</button></sc-if>
        <sc-if value="{{ t.hasCancel }}" hint-placeholder-val="{{ false }}"><button onClick="{{ t.cancel }}" style="background:none;border:0;color:var(--red);font-size:13px;cursor:pointer">Cancel</button></sc-if>
        <button onClick="{{ t.close }}" aria-label="Dismiss" style="background:none;border:0;color:var(--faint);font-size:13px;cursor:pointer">×</button>
      </div>
    </sc-for>
  </div>
</div>
`;
