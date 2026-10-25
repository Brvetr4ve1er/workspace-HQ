// v5 additions that have no slice in the Claude Design template (Phase 3 P8:
// the "What's new · trailers" overlay). Joined just before toasts.tpl.js, which
// closes the root <div>, so anything here sits inside the app root. Every
// element here is a v5 addition and carries a <!-- v5: reason --> marker.
// Styled with the template's own tokens and the Settings overlay's scrim, card,
// label and button styles; z-index 1070 puts it over Settings (1050), which it
// can be opened from, and under the lightbox (1080) and the dialogs (1100+).
// H5 adds the Save to vault dialog (z-index 1100: a dialog).
export default String.raw`  <!-- v5: "What's new · trailers" overlay (Phase 3 P8); opens once per version, from Settings and from the palette -->
  <sc-if value="{{ whatsNewOpen }}" hint-placeholder-val="{{ false }}">
    <!-- v5: scrim; a click outside the card closes it (Escape too, through closeTop) -->
    <div onClick="{{ closeWhatsNew }}" style="position:fixed;inset:0;z-index:1070;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <!-- v5: the card, same frame as Settings -->
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="What's new" style="width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <!-- v5: title row: title, version, close -->
        <div style="display:flex;align-items:center;gap:10px"><span style="font-size:24px;flex:1">What's new</span><span style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint)">{{ whatsNew.version }}</span><button type="button" onClick="{{ closeWhatsNew }}" aria-label="Close" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
        <!-- v5: section label -->
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">Trailers</div>
        <!-- v5: the two trailers, side by side when there's room -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:8px">
          <sc-for list="{{ whatsNew.trailers }}" as="t" hint-placeholder-count="2">
            <!-- v5: one trailer card -->
            <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
              <sc-if value="{{ t.ok }}" hint-placeholder-val="{{ false }}">
                <!-- v5: the trailer; preload none and no autoplay: nothing loads or plays until you press play -->
                <video preload="none" controls poster="{{ t.poster }}" src="{{ t.src }}" onError="{{ t.failed }}" style="display:block;width:100%;aspect-ratio:16/9;background:var(--ink);border:1px solid var(--frame);border-radius:8px"></video>
              </sc-if>
              <sc-if value="{{ t.missing }}" hint-placeholder-val="{{ true }}">
                <!-- v5: text fallback when the file isn't in this build or won't play -->
                <div style="display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;padding:12px;text-align:center;background:var(--ink);border:1px dashed var(--frame);border-radius:8px;color:var(--muted);font-size:13px">Trailer not bundled in this build</div>
              </sc-if>
              <!-- v5: trailer caption -->
              <div style="font-size:13px;color:var(--muted)">{{ t.title }}</div>
            </div>
          </sc-for>
        </div>
        <!-- v5: honesty note (README.md says the same): the trailers are sample data rendered for the video, and silent until the soundtrack lands -->
        <div style="font-size:12px;color:var(--faint);margin-top:8px">The trailers show sample data, not your scans: the projects, numbers and the question in them are made up. They have no sound yet.</div>
        <!-- v5: section label -->
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--faint);margin-top:18px">What changed in this version</div>
        <!-- v5: the change list (logic/whats-new.js CHANGES, only what this build does) -->
        <div style="display:flex;flex-direction:column;margin-top:6px">
          <sc-for list="{{ whatsNew.changes }}" as="c" hint-placeholder-count="5">
            <!-- v5: one change -->
            <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed var(--frame);font-size:13px"><span style="flex:0 0 auto;color:var(--gold)">✻</span><span style="color:var(--text)">{{ c }}</span></div>
          </sc-for>
        </div>
        <!-- v5: where to find it again -->
        <div style="font-size:12px;color:var(--faint);margin-top:12px">Shown once per update. Settings › What's new · trailers opens it again.</div>
      </div>
    </div>
  </sc-if>

  <!-- v5: Save to vault (Claude Hub H5, spec 2026-10-13 §9 Vault): the local model's draft, editable; nothing is written until Save (or Replace, after it asked) -->
  <sc-if value="{{ vaultOpen }}" hint-placeholder-val="{{ false }}">
    <!-- v5: scrim; only Close, Cancel or Escape dismiss it, so a stray click never drops an edited draft -->
    <div style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <!-- v5: the card, Settings' frame -->
      <div ref="{{ popIn }}" role="dialog" aria-label="Save to vault" style="width:min(760px,100%);max-height:90vh;overflow:auto;background:var(--card);border:1px solid var(--frame-hi);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px;display:flex;flex-direction:column;gap:10px">
        <!-- v5: title row (Ask's "Local model" badge: the draft is the local model's) -->
        <div style="display:flex;align-items:center;gap:10px"><span style="font-size:12px;padding:2px 7px;border:1px solid var(--purple);color:var(--purple)">✦ Local model</span><span style="font-size:20px;flex:1">Save to vault</span><button type="button" onClick="{{ vaultClose }}" aria-label="Close" style="width:34px;height:34px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--muted);font-size:13px;cursor:pointer">×</button></div>
        <!-- v5: drafting -->
        <sc-if value="{{ vaultDrafting }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--muted)">The local model is drafting a summary, decisions, to-dos and links from this chat… Nothing is written yet.</div></sc-if>
        <!-- v5: the draft could not be made: why, and try again -->
        <sc-if value="{{ vaultFailed }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--orange)">{{ vaultError }}</div><div><button type="button" onClick="{{ vaultRetry }}" style="height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Try again</button></div></sc-if>
        <!-- v5: the editable draft, where it will go, who drafted it -->
        <sc-if value="{{ vaultReady }}" hint-placeholder-val="{{ true }}">
          <!-- v5: where the note will go -->
          <div style="font-family:var(--term);font-size:12px;color:var(--text);word-break:break-all">VEEMO CORTEX / {{ vaultRel }}</div>
          <!-- v5: who drafted it, and that nothing is written before Save -->
          <div style="font-size:12px;color:var(--muted)">{{ vaultBasis }}</div>
          <sc-if value="{{ vaultHasExists }}" hint-placeholder-val="{{ false }}"><div style="font-size:12px;color:var(--orange)">{{ vaultExistsNote }}</div></sc-if>
          <!-- v5: the editable draft -->
          <textarea aria-label="Note text" value="{{ vaultDraft }}" onChange="{{ onVaultEdit }}" disabled="{{ vaultSaving }}" spellcheck="false" style="min-height:320px;resize:vertical;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-family:var(--term);font-size:12px;line-height:1.5;padding:10px 12px"></textarea>
          <sc-if value="{{ vaultHasSaveError }}" hint-placeholder-val="{{ false }}"><div role="alert" style="font-size:13px;color:var(--orange)">{{ vaultSaveError }}</div></sc-if>
          <!-- v5: the replace question: only this chat's own note is ever offered, and only these buttons answer it -->
          <sc-if value="{{ vaultAskReplace }}" hint-placeholder-val="{{ false }}"><div role="alertdialog" aria-label="Replace the note" style="padding:10px 12px;border:1px solid var(--orange);border-radius:8px;font-size:13px">Replace the note that is already there? Its current text is overwritten with this draft. <button type="button" data-vault="replace" onClick="{{ vaultReplace }}" style="margin-left:8px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--orange);background:transparent;color:var(--orange);cursor:pointer">Replace</button><button type="button" onClick="{{ vaultKeep }}" style="margin-left:6px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">Keep it</button></div></sc-if>
          <!-- v5: Cancel and Save: the only way the dialog writes -->
          <div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" onClick="{{ vaultClose }}" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--muted);cursor:pointer">Cancel</button><button type="button" data-vault="save" onClick="{{ vaultSave }}" disabled="{{ vaultSaveOff }}" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--purple);background:color-mix(in oklab, var(--purple) 16%, transparent);color:var(--text);cursor:pointer">{{ vaultSaveLabel }}</button></div>
        </sc-if>
        <!-- v5: saved -->
        <sc-if value="{{ vaultSaved }}" hint-placeholder-val="{{ false }}"><div role="status" style="font-size:13px;color:var(--text)">Saved to VEEMO CORTEX / {{ vaultRel }}.</div><div><button type="button" onClick="{{ vaultClose }}" style="height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer">Close</button></div></sc-if>
      </div>
    </div>
  </sc-if>
  <!-- v5: Prompt library P2 — the ONE confirm before Promote writes (spec §6.3), and the clash step (§6.1: a clash becomes <slug>-2.md only after a confirm). Shows the text exactly as it will be written (masked) -->
  <sc-if value="{{ hcOpen }}" hint-placeholder-val="{{ false }}">
    <!-- v5: Promote dialog layout (P2) -->
    <div onClick="{{ hcCancel }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <!-- v5: Promote dialog layout (P2) -->
      <div data-hc="dialog" onClick="{{ hcStop }}" role="dialog" aria-label="Promote to vault" style="width:min(620px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <!-- v5: Promote dialog layout (P2) -->
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Before this writes</div>
        <!-- v5: Promote dialog layout (P2) -->
        <div style="font-size:19px;margin-top:8px">{{ hcHead }}</div>
        <!-- v5: Promote dialog layout (P2) -->
        <div style="font-size:12px;color:var(--muted);margin-top:6px">{{ hcWhere }}</div>
        <sc-if value="{{ hcSingle }}" hint-placeholder-val="{{ false }}"><label style="display:flex;flex-direction:column;gap:4px;margin-top:12px;font-size:11px;color:var(--faint)">Title (the file name comes from it)<input data-hc="title" value="{{ hcTitleVal }}" onChange="{{ hcOnTitle }}" disabled="{{ hcClashPhase }}" style="height:32px;padding:0 10px;background:var(--ink);border:1px solid var(--frame);border-radius:8px;color:var(--text);font-size:13px"></label></sc-if>
        <!-- v5: Promote dialog layout (P2) -->
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px"><sc-for list="{{ hcItems }}" as="i" hint-placeholder-count="2"><div style="border:1px dashed var(--frame);border-radius:8px;padding:8px 10px"><div style="font-size:13px">{{ i.title }}</div><div style="font-family:var(--term);font-size:12px;color:var(--muted);white-space:pre-wrap;margin-top:4px;max-height:9em;overflow:auto">{{ i.text }}</div></div></sc-for></div>
        <sc-if value="{{ hcClashPhase }}" hint-placeholder-val="{{ false }}"><div data-hc="clash" role="status" style="margin-top:12px;font-size:13px;color:var(--gold)">{{ hcClashText }}</div></sc-if>
        <sc-if value="{{ hcDonePhase }}" hint-placeholder-val="{{ false }}"><div data-hc="results" role="status" style="margin-top:12px;display:flex;flex-direction:column;gap:4px"><sc-for list="{{ hcResults }}" as="x" hint-placeholder-count="2"><div style="font-size:12px;color:{{ x.color }}">{{ x.text }}</div></sc-for></div></sc-if>
        <!-- v5: Promote dialog layout (P2) -->
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <!-- v5: Promote dialog button (P2) -->
          <button type="button" data-hc="cancel" onClick="{{ hcCancel }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);cursor:pointer">Close · Esc</button>
          <sc-if value="{{ hcAskPhase }}" hint-placeholder-val="{{ true }}"><button type="button" data-hc="go" onClick="{{ hcGo }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);cursor:pointer">{{ hcGoText }}</button></sc-if>
          <sc-if value="{{ hcSaving }}" hint-placeholder-val="{{ false }}"><span style="align-self:center;font-size:12px;color:var(--muted)">Writing…</span></sc-if>
          <sc-if value="{{ hcCanSaveAs }}" hint-placeholder-val="{{ false }}"><sc-if value="{{ hcClashPhase }}" hint-placeholder-val="{{ false }}"><button type="button" data-hc="save-as" onClick="{{ hcSaveAs }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);cursor:pointer">Save as the new name</button></sc-if></sc-if>
        </div>
      </div>
    </div>
  </sc-if>
  <!-- v5: Prompt library P3 — run modal (spec §6.3): project picker, one field per {{variable}}, four targets; every Claude target says it uses the Claude quota; main fills and sends — the page never sends prompt text -->
  <sc-if value="{{ rnShow }}" hint-placeholder-val="{{ false }}">
    <!-- v5: Run modal layout (P3) -->
    <div onClick="{{ rnDoClose }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <!-- v5: Run modal layout (P3) -->
      <div data-rn="dialog" onClick="{{ rnStopClick }}" role="dialog" aria-label="Run a prompt" style="width:min(620px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--purple);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <!-- v5: Run modal layout (P3) -->
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Run a prompt</div>
        <!-- v5: Run modal layout (P3) -->
        <div style="font-size:19px;margin-top:8px">{{ rnTitle }}</div>
        <!-- v5: Run modal layout (P3) -->
        <div style="margin-top:14px;font-size:11px;color:var(--faint)">Project · {{ rnProjectNote }}</div>
        <sc-if value="{{ rnHasProjects }}" hint-placeholder-val="{{ true }}"><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><sc-for list="{{ rnProjects }}" as="p" hint-placeholder-count="3"><button type="button" data-rn="project" onClick="{{ p.pick }}" aria-pressed="{{ p.pressed }}" style="{{ p.style }}">{{ p.name }}</button></sc-for></div></sc-if>
        <sc-if value="{{ rnNoProjects }}" hint-placeholder-val="{{ false }}"><div style="margin-top:6px;font-size:12px;color:var(--muted)">No WorkspaceHQ projects yet — Chat and Terminal need one; the copy targets work without.</div></sc-if>
        <sc-if value="{{ rnHasFields }}" hint-placeholder-val="{{ true }}"><div style="display:flex;flex-direction:column;gap:8px;margin-top:14px"><sc-for list="{{ rnFields }}" as="f" hint-placeholder-count="2"><label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--faint);font-family:var(--term)">{{ f.label }}<input data-rn="field" value="{{ f.value }}" onChange="{{ f.onChange }}" style="{{ f.style }}"></label></sc-for></div></sc-if>
        <!-- v5: Run modal layout (P3) -->
        <div style="margin-top:14px;font-size:11px;color:var(--faint)">Where</div>
        <!-- v5: Run modal layout (P3) -->
        <div role="radiogroup" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><sc-for list="{{ rnTargets }}" as="t" hint-placeholder-count="4"><button type="button" role="radio" data-rn="target" onClick="{{ t.pick }}" aria-checked="{{ t.pressed }}" style="{{ t.style }}">{{ t.label }}</button></sc-for></div>
        <!-- v5: Run modal layout (P3) -->
        <div style="margin-top:8px;font-size:12px;color:var(--muted)">{{ rnNote }}</div>
        <sc-if value="{{ rnShowMode }}" hint-placeholder-val="{{ true }}"><button type="button" data-rn="mode" onClick="{{ rnFlipMode }}" style="margin-top:8px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-size:12px">{{ rnModeText }}</button></sc-if>
        <sc-if value="{{ rnHasStatus }}" hint-placeholder-val="{{ false }}"><div data-rn="status" role="status" style="{{ rnStatusStyle }}">{{ rnStatusText }}</div></sc-if>
        <!-- v5: Run modal layout (P3) -->
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <!-- v5: Run modal layout (P3) -->
          <button type="button" data-rn="close" onClick="{{ rnDoClose }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);cursor:pointer">Close · Esc</button>
          <!-- v5: Run modal layout (P3) -->
          <button type="button" data-rn="go" onClick="{{ rnDoGo }}" disabled="{{ rnCantGo }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--purple);color:var(--text);border:1px solid var(--purple);font-weight:600;border-radius:8px;font-family:var(--term);cursor:pointer">{{ rnGoLabel }}</button>
        </div>
      </div>
    </div>
  </sc-if>
  <!-- v5: Prompt library P3 — the ONE confirm before a pack is copied into 40_Resources/Prompts (spec §6.3): lists every note, marks the ones already there (kept, never replaced), says what was skipped and why -->
  <sc-if value="{{ rnPackShow }}" hint-placeholder-val="{{ false }}">
    <!-- v5: Pack dialog layout (P3) -->
    <div onClick="{{ rnPackDoCancel }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <!-- v5: Pack dialog layout (P3) -->
      <div data-rp="dialog" onClick="{{ rnStopClick }}" role="dialog" aria-label="Import a prompt pack" style="width:min(620px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--gold);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <!-- v5: Pack dialog layout (P3) -->
        <div style="font-family:var(--term);font-size:11px;letter-spacing:.02em;text-transform:lowercase;font-weight:500;color:var(--muted)">Before this writes</div>
        <!-- v5: Pack dialog layout (P3) -->
        <div style="font-size:19px;margin-top:8px">{{ rnPackTitle }}</div>
        <sc-if value="{{ rnPackIsPlan }}" hint-placeholder-val="{{ false }}"><div style="margin-top:12px;display:flex;flex-direction:column;gap:4px;max-height:40vh;overflow:auto"><sc-for list="{{ rnPackRows }}" as="r" hint-placeholder-count="3"><div data-rp="row" style="display:flex;gap:10px;font-size:13px;border-bottom:1px dashed var(--frame);padding:4px 0"><span style="flex:1;min-width:0">{{ r.title }}</span><span style="font-family:var(--term);font-size:11px;color:var(--faint)">{{ r.name }}</span><span style="font-size:11px;color:var(--muted)">{{ r.tag }}</span></div></sc-for></div></sc-if>
        <sc-if value="{{ rnPackHasSkipped }}" hint-placeholder-val="{{ false }}"><div data-rp="skipped" style="margin-top:8px;font-size:12px;color:var(--muted)">{{ rnPackSkipped }}</div></sc-if>
        <sc-if value="{{ rnPackIsDone }}" hint-placeholder-val="{{ false }}"><div data-rp="done" role="status" style="margin-top:12px;font-size:13px;color:var(--green)">{{ rnPackDoneText }}</div></sc-if>
        <sc-if value="{{ rnPackHasError }}" hint-placeholder-val="{{ false }}"><div data-rp="error" role="status" style="margin-top:12px;font-size:13px;color:var(--tone-red)">{{ rnPackError }}</div></sc-if>
        <sc-if value="{{ rnPackWriting }}" hint-placeholder-val="{{ false }}"><div style="margin-top:12px;font-size:12px;color:var(--muted)">Writing…</div></sc-if>
        <!-- v5: Pack dialog layout (P3) -->
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <!-- v5: Pack dialog layout (P3) -->
          <button type="button" data-rp="close" onClick="{{ rnPackDoCancel }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--card);color:var(--text);border:1px solid var(--frame);border-radius:8px;font-family:var(--term);cursor:pointer">Close · Esc</button>
          <sc-if value="{{ rnPackIsPlan }}" hint-placeholder-val="{{ true }}"><button type="button" data-rp="confirm" onClick="{{ rnPackDoConfirm }}" disabled="{{ rnPackCantConfirm }}" style="height:34px;padding:0 14px;font-size:12px;background:var(--gold);color:#1a0f0a;border:1px solid var(--gold);font-weight:600;border-radius:8px;font-family:var(--term);cursor:pointer">{{ rnPackConfirmLabel }}</button></sc-if>
        </div>
      </div>
    </div>
  </sc-if>
  <!-- v5: AI archive H6 (spec §2/§6.3) — a ZIP dropped in Documents\WorkspaceHQ Imports is offered ONCE; nothing runs until Import -->
  <sc-if value="{{ diShow }}" hint-placeholder-val="{{ false }}"><div data-di="card" role="dialog" aria-label="Import a dropped export" style="position:fixed;right:16px;bottom:16px;z-index:1050;max-width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--purple);border-radius:12px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.35);font-family:var(--term)"><div style="font-size:14px;color:var(--text)">{{ diCard.text }}</div><div style="font-size:12px;color:var(--muted);margin-top:4px">{{ diCard.sub }}</div><div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"><button type="button" data-di="confirm" onClick="{{ diConfirm }}" disabled="{{ diCant }}" title="{{ diCantTip }}" style="height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--purple);background:var(--purple);color:var(--bg);cursor:pointer;font-family:var(--term)">Import</button><button type="button" data-di="dismiss" onClick="{{ diDismiss }}" style="height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--frame);background:transparent;color:var(--text);cursor:pointer;font-family:var(--term)" style-hover="background:var(--frame)">Not now</button><span style="font-size:11px;color:var(--faint)">{{ diMore }}</span></div></div></sc-if>

`;
