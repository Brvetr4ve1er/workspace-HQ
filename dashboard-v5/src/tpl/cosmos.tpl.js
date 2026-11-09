// Cosmos screen (v.cosmos, key 0): the Feed. Search, sort, group, density, favourites, hidden, a masonry of every card.
// <!-- v5: cosmos space --> new fragment, joined in src/app.tpl.js after money. dc-lite dialect only: dotted paths, !, ===;
// every number, label and style arrives finished from vals/cosmos.js (the library math is in logic/cosmos-*.mjs).
// The lightbox, the index overlay and the import report live in tpl/cosmos-overlays.tpl.js (joined before extras).
// The style constants below are the exact button/input/label strings money.tpl.js inlines.
// <!-- v5: no window., no fetch --> a fragment only binds to vals; the drop host, the grid width and every action are vals handlers.
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const INPUT = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px;min-width:0';
const CARD = 'padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px';
const ROW = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
const CHIPS = (list, as) => `<sc-for list="{{ ${list} }}" as="${as}" hint-placeholder-count="3"><button type="button" onClick="{{ ${as}.go }}" aria-pressed="{{ ${as}.pressed }}" style="{{ ${as}.style }}">{{ ${as}.label }}</button></sc-for>`;
// a small round button on a card: opacity follows --cos-act, which the card's own hover / focus-within switches on
const ICON = 'display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border-radius:999px;border:1px solid var(--frame-hi);background:color-mix(in oklab,var(--ink) 78%,transparent);color:var(--text);cursor:pointer;font-size:13px;line-height:1;transition:opacity .12s, border-color .15s';
const EYE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

export default String.raw`        <sc-if value="{{ v.cosmos }}" hint-placeholder-val="{{ false }}">
          <!-- v5: the drop host. dragover AND drop call preventDefault (vals), so the window never navigates to a dropped file; the same element is measured for the masonry width -->
          <div data-cos="feed" ref="{{ cosGridRef }}" onDragOver="{{ cosOnDragOver }}" onDrop="{{ cosOnDrop }}" style="display:flex;flex-direction:column;gap:16px;width:100%;min-height:60vh">
            <!-- v5: offline - a plain browser tab has no main process; nothing here can change a file -->
            <sc-if value="{{ cosOffline }}" hint-placeholder-val="{{ false }}"><div data-cos="empty" data-reason="offline" style="font-size:14px;color:var(--muted)">{{ cosOfflineText }}</div></sc-if>
            <sc-if value="{{ !cosOffline }}" hint-placeholder-val="{{ true }}">
              <div style="display:flex;flex-direction:column;gap:16px">
                <!-- v5: toolbar - search, count, what the query was read as, index / import -->
                <section style="display:flex;flex-direction:column;gap:10px">
                  <div style="${ROW}">
                    <input data-cos="search" value="{{ cosQueryText }}" onChange="{{ cosOnSearch }}" aria-label="Search elements" placeholder="word, tag:name, colour, #hex" autocomplete="off" spellcheck="false" style="${INPUT};flex:1 1 260px;max-width:480px">
                    <sc-if value="{{ cosHasQuery }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ cosClear }}" aria-label="Clear search" style="${BTN}" ${BTN_HOVER}>Clear</button></sc-if>
                    <span data-cos="count" aria-live="polite" style="font-size:12px;color:var(--muted)">{{ cosCount }}</span>
                    <sc-if value="{{ cosHasChip }}" hint-placeholder-val="{{ false }}"><span style="display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;white-space:nowrap;color:var(--accent-text);border:1px solid color-mix(in oklab,var(--gold) 45%,transparent);background:color-mix(in oklab,var(--gold) 10%,transparent)">{{ cosChip }}</span></sc-if>
                    <span style="flex:1"></span>
                    <sc-if value="{{ cosIdxFirst }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ cosIndexBtn }}" disabled="{{ cosBusy }}" style="${GOLD}" ${GOLD_HOVER}>Index a folder</button></sc-if>
                    <sc-if value="{{ !cosIdxFirst }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ cosIndexBtn }}" disabled="{{ cosBusy }}" style="${BTN}" ${BTN_HOVER}>Re-index</button></sc-if>
                    <button type="button" onClick="{{ cosImportBtn }}" disabled="{{ cosBusy }}" style="${BTN}" ${BTN_HOVER}>Import from Cosmos Local</button>
                  </div>
                  <!-- v5: sort, group and density are chip rows (the vals give each a go handler, not a select value) -->
                  <div style="${ROW}">
                    <span style="${LABEL}">sort</span>${CHIPS('cosSorts', 'so')}
                    <span style="width:10px"></span><span style="${LABEL}">group</span>${CHIPS('cosGroups', 'gr')}
                  </div>
                  <div style="${ROW}">
                    <span style="${LABEL}">density</span>${CHIPS('cosDensities', 'de')}
                    <span style="width:10px"></span>
                    <sc-if value="{{ cosFavOnly }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ cosToggleFav }}" aria-pressed="true" style="${GOLD}" ${GOLD_HOVER}>favourites only</button></sc-if>
                    <sc-if value="{{ !cosFavOnly }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ cosToggleFav }}" aria-pressed="false" style="${BTN}" ${BTN_HOVER}>favourites only</button></sc-if>
                    <sc-if value="{{ cosShowHiddenOn }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ cosToggleHidden }}" aria-pressed="true" style="${GOLD}" ${GOLD_HOVER}>show hidden</button></sc-if>
                    <sc-if value="{{ !cosShowHiddenOn }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ cosToggleHidden }}" aria-pressed="false" style="${BTN}" ${BTN_HOVER}>show hidden</button></sc-if>
                  </div>
                  <div style="font-size:12px;color:var(--faint)">Drop pictures here to add them</div>
                </section>
                <!-- v5: banners - each is its own honest state, never merged -->
                <sc-if value="{{ cosScrubbed }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--blue)">You’re looking at an older scan — the gallery isn’t part of the scan, so this screen stays live and editable.</div></sc-if>
                <sc-if value="{{ cosBannerRoot }}" hint-placeholder-val="{{ false }}"><div data-cos="banner" data-banner="root" style="${CARD};border-color:var(--orange);font-size:13px">{{ cosBannerRootText }}</div></sc-if>
                <sc-if value="{{ cosBannerStale }}" hint-placeholder-val="{{ false }}"><div data-cos="banner" data-banner="stale" style="${CARD};${ROW};border-color:var(--orange)"><span style="font-size:13px;flex:1 1 220px">{{ cosBannerStaleText }}</span><button type="button" onClick="{{ cosIndexBtn }}" disabled="{{ cosBusy }}" style="${BTN}" ${BTN_HOVER}>Re-index</button></div></sc-if>
                <sc-if value="{{ cosBannerIndexing }}" hint-placeholder-val="{{ false }}"><div data-cos="banner" data-banner="indexing" role="status" style="${CARD};${ROW};border-color:var(--blue)"><span style="font-size:13px;flex:1 1 220px">{{ cosBannerIndexingText }}</span><button type="button" onClick="{{ cosIndexBtn }}" style="${BTN}" ${BTN_HOVER}>Show progress</button><button type="button" onClick="{{ cosBannerCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div></sc-if>
                <sc-if value="{{ cosBannerFailed }}" hint-placeholder-val="{{ false }}"><div data-cos="banner" data-banner="failed" style="font-size:13px;color:var(--red)">{{ cosBannerFailedText }}</div></sc-if>
                <!-- v5: load states - the read failed (the real message, Retry; a kept copy still shows below), or nothing has arrived yet -->
                <sc-if value="{{ cosError }}" hint-placeholder-val="{{ false }}"><div data-cos="empty" data-reason="error" style="${ROW}"><span style="font-size:14px;color:var(--red)">Couldn’t read the library · {{ cosErrorText }}</span><sc-if value="{{ cosErrorKept }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;color:var(--muted)">· {{ cosErrorNote }}</span></sc-if><button type="button" onClick="{{ cosRetry }}" style="${BTN}" ${BTN_HOVER}>Retry</button></div></sc-if>
                <sc-if value="{{ cosLoading }}" hint-placeholder-val="{{ false }}"><div data-cos="empty" data-reason="loading" role="status" style="font-size:14px;color:var(--muted)">{{ cosLoadingText }}</div></sc-if>
                <!-- v5: empty states - no folder yet, an empty library, no match, no favourites: the words come finished from the vals -->
                <sc-if value="{{ cosEmpty }}" hint-placeholder-val="{{ false }}">
                  <div data-cos="empty" data-reason="{{ cosReason }}" style="${CARD};display:flex;flex-direction:column;gap:8px;align-items:flex-start;max-width:560px">
                    <div style="font-size:18px">{{ cosEmptyTitle }}</div>
                    <div style="font-size:13px;color:var(--muted)">{{ cosEmptyText }}</div>
                    <button type="button" onClick="{{ cosEmptyDo }}" style="${GOLD}" ${GOLD_HOVER}>{{ cosEmptyAction }}</button>
                  </div>
                </sc-if>
                <!-- v5: the masonry - every card is emitted and absolutely placed from the memoised layout (box), so a keystroke that narrows nothing moves nothing -->
                <sc-if value="{{ cosHasCards }}" hint-placeholder-val="{{ true }}">
                  <div data-cos="grid" style="{{ cosGridStyle }}">
                    <sc-for list="{{ cosHeaders }}" as="h" hint-placeholder-count="2">
                      <div style="{{ h.box }}"><div data-cos="group" style="display:flex;align-items:baseline;gap:8px;height:100%;border-bottom:1px solid var(--frame);padding-bottom:4px;box-sizing:border-box"><span style="${LABEL};color:var(--text)">{{ h.label }}</span><span style="font-size:11px;color:var(--faint)">{{ h.countText }}</span></div></div>
                    </sc-for>
                    <sc-for list="{{ cosCards }}" as="c" hint-placeholder-count="6">
                      <div style="{{ c.box }}">
                        <!-- v5: the card hovers/focuses as one unit: --cos-act (inherited) fades its two small buttons in; a favourite keeps its star on -->
                        <div style="position:absolute;inset:0;overflow:hidden;border-radius:10px;border:1px solid var(--frame);box-sizing:border-box;background:var(--ink);background:{{ c.bg }}" style-hover="--cos-act:1" style-focus-within="--cos-act:1">
                          <button type="button" data-cos-card data-id="{{ c.id }}" onClick="{{ c.open }}" aria-label="Open {{ c.type }} {{ c.title }}" style="position:absolute;inset:0;width:100%;height:100%;padding:0;margin:0;border:0;background:none;cursor:pointer;display:block;color:var(--muted);font-family:var(--term);font-size:11px;text-align:left;outline-offset:-3px">
                            <sc-if value="{{ c.hasSrc }}" hint-placeholder-val="{{ true }}"><img src="{{ c.src }}" alt="{{ c.alt }}" loading="lazy" decoding="async" draggable="false" style="display:block;width:100%;height:100%;object-fit:cover"></sc-if>
                            <sc-if value="{{ !c.hasSrc }}" hint-placeholder-val="{{ false }}"><span style="display:block;padding:10px;word-break:break-word">{{ c.title }}</span></sc-if>
                          </button>
                          <sc-if value="{{ c.video }}" hint-placeholder-val="{{ false }}"><span aria-hidden="true" style="position:absolute;left:8px;bottom:8px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;background:color-mix(in oklab,var(--ink) 78%,transparent);color:var(--text);font-size:11px;pointer-events:none">▶</span></sc-if>
                          <sc-if value="{{ c.hidden }}" hint-placeholder-val="{{ false }}"><div aria-hidden="true" style="position:absolute;inset:0;background:color-mix(in oklab,var(--ink) 58%,transparent);pointer-events:none"></div><span style="position:absolute;left:8px;top:8px;padding:2px 7px;border-radius:999px;font-size:10px;background:var(--ink);color:var(--muted);border:1px solid var(--frame);pointer-events:none">hidden</span></sc-if>
                          <sc-if value="{{ c.fav }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ c.favGo }}" aria-label="Favourite" aria-pressed="true" title="Remove from favourites" style="position:absolute;top:6px;right:6px;${ICON};color:var(--gold);opacity:1">★</button></sc-if>
                          <sc-if value="{{ !c.fav }}" hint-placeholder-val="{{ true }}"><button type="button" onClick="{{ c.favGo }}" aria-label="Favourite" aria-pressed="false" title="Add to favourites" style="position:absolute;top:6px;right:6px;${ICON};opacity:var(--cos-act,0)">☆</button></sc-if>
                          <button type="button" onClick="{{ c.hideGo }}" aria-label="Hidden" aria-pressed="{{ c.hidden }}" title="Hide or show this element" style="position:absolute;top:6px;right:38px;${ICON};opacity:var(--cos-act,0)">${EYE}</button>
                        </div>
                      </div>
                    </sc-for>
                  </div>
                </sc-if>
                <!-- v5: paging - FEED_PAGE is Infinity today, so this never shows; the control exists for the render budget -->
                <sc-if value="{{ cosHasMore }}" hint-placeholder-val="{{ false }}"><div style="${ROW};justify-content:center"><button type="button" data-cos="more" onClick="{{ cosMore }}" style="${BTN}" ${BTN_HOVER}>{{ cosMoreLabel }}</button><span style="font-size:12px;color:var(--faint)">{{ cosLeft }}</span></div></sc-if>
              </div>
            </sc-if>
          </div>
        </sc-if>
`;
