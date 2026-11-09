// Cosmos overlays (cosLbOpen, cosIdxOpen, cosRepOpen): the lightbox, the index overlay and the import report.
// <!-- v5: cosmos overlays --> new fragment, joined in src/app.tpl.js just before extras. dc-lite dialect only (dotted paths, !, ===).
// Stacking: the lightbox is 990 - under the palette (1000, so Ctrl+K still works) and over the ask / activity panels (905-950);
// the index overlay and the import report are 1060 - over settings and the cheat sheet (1050), under What's new (1070).
// Each dialog is a fixed wrapper holding a backdrop sibling (click closes) and the dialog itself, so no click needs stopping.
const BTN = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const BTN_HOVER = 'style-hover="border-color:var(--frame-hi);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const GOLD = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;height:28px;padding:0 10px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);line-height:1;white-space:nowrap;cursor:pointer;transition:transform .12s, background .15s, border-color .15s, filter .15s';
const GOLD_HOVER = 'style-hover="filter:brightness(1.1);transform:translateY(-1px)" style-active="transform:translateY(1px) scale(.98)"';
const DANGER = ';border-color:var(--red);color:var(--red)';
const LABEL = 'font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)';
const INPUT = 'height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:13px;min-width:0';
const CARD = 'padding:14px 16px;background:var(--card);border:1px solid var(--frame);border-radius:12px';
const ROW = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
const X = 'width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer';
const FACT = 'display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:12px';

export default String.raw`  <sc-if value="{{ cosLbOpen }}" hint-placeholder-val="{{ false }}">
    <!-- v5: lightbox - one element large, with its facts, tags, title and actions; arrow keys and F act through vals/logic only while it is open -->
    <div data-cos="lightbox" style="position:fixed;inset:0;z-index:990;display:flex;align-items:center;justify-content:center;padding:16px">
      <div data-cos="lb-backdrop" onClick="{{ cosLbClose }}" style="position:absolute;inset:0;background:color-mix(in oklab,var(--ink) 94%,transparent)"></div>
      <div role="dialog" aria-modal="true" aria-label="Cosmos element" tabindex="-1" autoFocus="{{ true }}" style="position:relative;display:flex;flex-wrap:wrap;gap:16px;width:min(1240px,100%);max-height:calc(100vh - 32px);overflow:auto;outline:none">
        <div style="flex:3 1 460px;min-width:0;display:flex;flex-direction:column;gap:10px">
          <!-- v5: the stage - a video plays from the original; an image sits over its saved thumbnail, so a slow or failed original still shows the thumbnail -->
          <div data-cos="lb-stage" style="position:relative;display:grid;place-items:center;height:calc(100vh - 150px);max-height:880px;min-height:240px;overflow:hidden;border-radius:12px;border:1px solid var(--frame);background:var(--ink)">
            <sc-if value="{{ cosLbIsVideo }}" hint-placeholder-val="{{ false }}"><video controls preload="metadata" poster="{{ cosLbPoster }}" src="{{ cosLbSrc }}" aria-label="{{ cosLbAlt }}" style="grid-area:1/1;width:100%;height:100%;object-fit:contain;background:var(--ink)"></video></sc-if>
            <sc-if value="{{ cosLbIsImage }}" hint-placeholder-val="{{ true }}">
              <sc-if value="{{ cosLbFallbackSrc }}" hint-placeholder-val="{{ true }}"><img src="{{ cosLbFallbackSrc }}" alt="" aria-hidden="true" draggable="false" style="grid-area:1/1;width:100%;height:100%;object-fit:contain"></sc-if>
              <img data-cos="lb-image" src="{{ cosLbSrc }}" alt="{{ cosLbAlt }}" decoding="async" draggable="false" style="grid-area:1/1;width:100%;height:100%;object-fit:contain">
            </sc-if>
          </div>
          <div style="${ROW};justify-content:space-between">
            <button type="button" onClick="{{ cosLbPrev }}" disabled="{{ !cosLbHasPrev }}" aria-label="Previous element" style="${BTN}" ${BTN_HOVER}>‹ Previous</button>
            <span data-cos="lb-pos" style="font-size:12px;color:var(--muted)">{{ cosLbPos }}</span>
            <button type="button" onClick="{{ cosLbNext }}" disabled="{{ !cosLbHasNext }}" aria-label="Next element" style="${BTN}" ${BTN_HOVER}>Next ›</button>
          </div>
        </div>
        <div style="flex:1 1 280px;min-width:260px;${CARD};display:flex;flex-direction:column;gap:14px;align-self:flex-start">
          <div style="${ROW}"><span style="${LABEL};flex:1">element</span><button type="button" onClick="{{ cosLbClose }}" aria-label="Close" title="Close · Esc" style="${X}">×</button></div>
          <!-- v5: the title is edited in place - Enter saves, Cancel (or closing) drops the draft -->
          <sc-if value="{{ !cosLbEditing }}" hint-placeholder-val="{{ true }}"><button type="button" data-cos="lb-title" onClick="{{ cosLbEditStart }}" aria-label="Edit title" title="Click to edit the title" style="display:block;width:100%;min-height:28px;padding:0;margin:0;border:0;background:none;color:var(--text);font-family:inherit;font-size:20px;line-height:1.25;text-align:left;cursor:text;word-break:break-word">{{ cosLbTitle }} <span aria-hidden="true" style="font-size:12px;color:var(--faint)">✎</span></button></sc-if>
          <sc-if value="{{ cosLbEditing }}" hint-placeholder-val="{{ false }}"><div style="${ROW}"><input value="{{ cosLbTitleText }}" onChange="{{ cosLbOnTitle }}" onKeyDown="{{ cosLbTitleKey }}" autoFocus="{{ true }}" aria-label="Title" placeholder="title" style="${INPUT};flex:1 1 160px"><button type="button" onClick="{{ cosLbTitleSave }}" disabled="{{ cosLbBusy }}" style="${GOLD}" ${GOLD_HOVER}>Save</button><button type="button" onClick="{{ cosLbTitleCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></div></sc-if>
          <div style="${FACT}">
            <span style="color:var(--faint)">type</span><span>{{ cosLbType }}</span>
            <sc-if value="{{ cosLbDims }}" hint-placeholder-val="{{ true }}"><span style="color:var(--faint)">dimensions</span><span>{{ cosLbDims }}</span></sc-if>
            <sc-if value="{{ cosLbDate }}" hint-placeholder-val="{{ true }}"><span style="color:var(--faint)">created</span><span>{{ cosLbDate }}</span></sc-if>
            <span style="color:var(--faint)">path</span><span data-cos="lb-path" style="word-break:break-all">{{ cosLbFile }}</span>
          </div>
          <!-- v5: tags - chips with a remove button, and one input that adds comma-separated tags -->
          <div style="display:flex;flex-direction:column;gap:8px">
            <span style="${LABEL}">tags</span>
            <sc-if value="{{ cosLbHasTags }}" hint-placeholder-val="{{ true }}"><div style="${ROW};gap:6px"><sc-for list="{{ cosLbTags }}" as="tg" hint-placeholder-count="3"><span style="display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 4px 0 9px;border-radius:999px;font-size:11px;white-space:nowrap;border:1px solid var(--frame);background:var(--ink)">{{ tg.name }}<button type="button" onClick="{{ tg.remove }}" disabled="{{ cosLbBusy }}" aria-label="Remove tag {{ tg.name }}" style="width:18px;height:18px;padding:0;border:0;border-radius:999px;background:none;color:var(--muted);cursor:pointer;font-size:12px;line-height:1">×</button></span></sc-for></div></sc-if>
            <sc-if value="{{ !cosLbHasTags }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;color:var(--faint)">No tags yet</span></sc-if>
            <div style="${ROW}"><input value="{{ cosLbTagText }}" onChange="{{ cosLbOnTag }}" onKeyDown="{{ cosLbTagKey }}" aria-label="Add tags" placeholder="add tags, comma separated" style="${INPUT};flex:1 1 160px"><button type="button" onClick="{{ cosLbTagAdd }}" disabled="{{ cosLbBusy }}" style="${BTN}" ${BTN_HOVER}>Add</button></div>
          </div>
          <div style="${ROW}">
            <button type="button" data-cos="lb-fav" onClick="{{ cosLbFavGo }}" disabled="{{ cosLbBusy }}" aria-pressed="{{ cosLbFav }}" style="${BTN}" ${BTN_HOVER}>{{ cosLbFavLabel }}</button>
            <button type="button" data-cos="lb-hide" onClick="{{ cosLbHideGo }}" disabled="{{ cosLbBusy }}" aria-pressed="{{ cosLbHidden }}" style="${BTN}" ${BTN_HOVER}>{{ cosLbHideLabel }}</button>
            <button type="button" data-cos="lb-reveal" onClick="{{ cosLbReveal }}" style="${BTN}" ${BTN_HOVER}>Open in Explorer</button>
          </div>
          <!-- v5: the Recycle Bin is only offered for files the app itself copied in (cosLbCanTrash); the first click arms a question, only Yes sends -->
          <sc-if value="{{ cosLbCanTrash }}" hint-placeholder-val="{{ false }}">
            <sc-if value="{{ !cosLbTrashAsk }}" hint-placeholder-val="{{ true }}"><div><button type="button" data-cos="lb-trash" onClick="{{ cosLbTrashStart }}" disabled="{{ cosLbBusy }}" style="${BTN}${DANGER}" ${BTN_HOVER}>Move to Recycle Bin</button></div></sc-if>
            <sc-if value="{{ cosLbTrashAsk }}" hint-placeholder-val="{{ false }}"><div data-cos="lb-trash-ask" role="group" aria-label="Confirm Recycle Bin" style="${ROW};padding:10px 12px;border:1px solid var(--red);border-radius:8px"><span style="font-size:13px;flex:1 1 200px">Move this file to the Recycle Bin?</span><button type="button" onClick="{{ cosLbTrashYes }}" disabled="{{ cosLbBusy }}" style="${BTN}${DANGER}" ${BTN_HOVER}>Yes</button><button type="button" onClick="{{ cosLbTrashNo }}" style="${BTN}" ${BTN_HOVER}>No</button></div></sc-if>
          </sc-if>
          <div style="font-size:11px;color:var(--faint)">← → step · F favourite · / search · Esc close</div>
        </div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ cosIdxOpen }}" hint-placeholder-val="{{ false }}">
    <!-- v5: index overlay - pick a folder, start, watch the phases walk, read the summary; closing it never stops a run (Cancel does) -->
    <div data-cos="index" style="position:fixed;inset:0;z-index:1060;display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ cosIdxClose }}" style="position:absolute;inset:0;background:var(--scrim)"></div>
      <div role="dialog" aria-modal="true" aria-label="Index a folder" tabindex="-1" autoFocus="{{ true }}" style="position:relative;width:min(560px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px;display:flex;flex-direction:column;gap:14px;outline:none">
        <div style="display:flex;align-items:center"><span style="font-size:24px;flex:1">Index a folder</span><button type="button" onClick="{{ cosIdxClose }}" aria-label="Close" style="${X}">×</button></div>
        <div style="font-size:13px;color:var(--muted)">Cosmos reads the folder in place and only writes inside this app’s data folder.</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <span style="${LABEL}">folder</span>
          <sc-if value="{{ cosIdxHasFolder }}" hint-placeholder-val="{{ true }}"><div data-cos="idx-folder" style="background:var(--ink);padding:10px 12px;border-radius:8px;font-size:13px;word-break:break-all">{{ cosIdxFolder }}</div></sc-if>
          <sc-if value="{{ !cosIdxHasFolder }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px;color:var(--faint)">No folder chosen yet</div></sc-if>
        </div>
        <div style="${ROW}">
          <button type="button" data-cos="idx-pick" onClick="{{ cosIdxPick }}" style="${BTN}" ${BTN_HOVER}>Choose folder...</button>
          <sc-if value="{{ cosIdxFirst }}" hint-placeholder-val="{{ false }}"><button type="button" data-cos="idx-start" onClick="{{ cosIdxStart }}" disabled="{{ cosIdxStartOff }}" style="${GOLD}" ${GOLD_HOVER}>Start</button></sc-if>
          <sc-if value="{{ !cosIdxFirst }}" hint-placeholder-val="{{ true }}"><button type="button" data-cos="idx-start" onClick="{{ cosIdxStart }}" disabled="{{ cosIdxStartOff }}" style="${GOLD}" ${GOLD_HOVER}>Re-index</button></sc-if>
          <sc-if value="{{ cosIdxRunning }}" hint-placeholder-val="{{ false }}"><button type="button" data-cos="idx-cancel" onClick="{{ cosIdxCancel }}" style="${BTN}" ${BTN_HOVER}>Cancel</button></sc-if>
        </div>
        <sc-if value="{{ cosIdxRunning }}" hint-placeholder-val="{{ false }}"><div data-cos="idx-progress" role="status" aria-live="polite" style="${CARD};border-color:var(--blue);font-size:13px">{{ cosIdxProgress }}</div></sc-if>
        <sc-if value="{{ cosIdxHasSummary }}" hint-placeholder-val="{{ false }}"><div data-cos="idx-summary" style="font-size:13px;color:var(--muted)">{{ cosIdxSummary }}</div></sc-if>
        <div style="${ROW};border-top:1px solid var(--frame);padding-top:12px"><span style="font-size:12px;color:var(--faint);flex:1 1 200px">Coming from the old gallery? Bring its favourites, hidden pictures and edits over.</span><button type="button" onClick="{{ cosIdxImport }}" style="${BTN}" ${BTN_HOVER}>Import from Cosmos Local</button></div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ cosRepOpen }}" hint-placeholder-val="{{ false }}">
    <!-- v5: import report - what the old gallery's backup brought over, what could not be matched, and a two-click replace for entries that differed -->
    <div data-cos="report" style="position:fixed;inset:0;z-index:1060;display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ cosRepClose }}" style="position:absolute;inset:0;background:var(--scrim)"></div>
      <div role="dialog" aria-modal="true" aria-label="Import report" tabindex="-1" autoFocus="{{ true }}" style="position:relative;width:min(620px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px;display:flex;flex-direction:column;gap:14px;outline:none">
        <div style="display:flex;align-items:center"><span style="font-size:24px;flex:1">Import report</span><button type="button" onClick="{{ cosRepClose }}" aria-label="Close" style="${X}">×</button></div>
        <sc-if value="{{ cosRepNote }}" hint-placeholder-val="{{ false }}"><div style="font-size:13px">{{ cosRepNote }}</div></sc-if>
        <div data-cos="rep-lines" style="${FACT};font-size:13px"><sc-for list="{{ cosRepLines }}" as="ln" hint-placeholder-count="6"><span style="color:var(--muted)">{{ ln.label }}</span><span>{{ ln.value }}</span></sc-for></div>
        <sc-if value="{{ cosRepHasMissing }}" hint-placeholder-val="{{ false }}">
          <div style="display:flex;flex-direction:column;gap:6px">
            <span style="font-size:12px;color:var(--orange)">{{ cosRepMissingText }}</span>
            <div style="${ROW};gap:4px 10px"><sc-for list="{{ cosRepMissing }}" as="ms" hint-placeholder-count="3"><code style="font-size:11px;color:var(--faint)">{{ ms.id }}</code></sc-for></div>
          </div>
        </sc-if>
        <div style="font-size:12px;color:var(--faint)">Cleanup dismissals are not in the old backup, so dismissed duplicates will show again once.</div>
        <sc-if value="{{ cosRepConflicts }}" hint-placeholder-val="{{ false }}">
          <div data-cos="rep-conflicts" style="${CARD};display:flex;flex-direction:column;gap:10px">
            <span style="font-size:13px">{{ cosRepConflicts }} entries already here differ; yours were kept</span>
            <sc-if value="{{ cosRepReplaced }}" hint-placeholder-val="{{ false }}"><span style="font-size:12px;color:var(--green)">Replaced with the backup’s.</span></sc-if>
            <sc-if value="{{ cosRepCanReplace }}" hint-placeholder-val="{{ false }}">
              <sc-if value="{{ !cosRepAsk }}" hint-placeholder-val="{{ true }}"><div><button type="button" onClick="{{ cosRepReplaceStart }}" disabled="{{ cosRepBusy }}" style="${BTN}" ${BTN_HOVER}>Replace {{ cosRepConflicts }} entries</button></div></sc-if>
              <sc-if value="{{ cosRepAsk }}" hint-placeholder-val="{{ false }}"><div data-cos="rep-ask" role="group" aria-label="Confirm replace" style="${ROW}"><span style="font-size:13px;flex:1 1 200px">Replace {{ cosRepConflicts }} entries with the backup’s?</span><button type="button" onClick="{{ cosRepReplaceYes }}" disabled="{{ cosRepBusy }}" style="${BTN}${DANGER}" ${BTN_HOVER}>Yes</button><button type="button" onClick="{{ cosRepReplaceNo }}" style="${BTN}" ${BTN_HOVER}>No</button></div></sc-if>
            </sc-if>
          </div>
        </sc-if>
        <div style="${ROW};justify-content:flex-end"><button type="button" onClick="{{ cosRepClose }}" style="${GOLD}" ${GOLD_HOVER}>Done</button></div>
      </div>
    </div>
  </sc-if>

`;
