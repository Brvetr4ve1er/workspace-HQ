// Overlay: commit dialog (hasCommit).
// Cut verbatim from lines 1019-1041 of src/app.tpl.js @ a8e0bf1. src/app.tpl.js joins
// the fragments in order; tpl.hash.test.mjs checks the joined string.
export default String.raw`  <sc-if value="{{ hasCommit }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ cancelCommit }}" style="position:fixed;inset:0;z-index:1100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px">
      <div onClick="{{ stop }}" ref="{{ popIn }}" role="dialog" aria-label="Commit" style="width:min(640px,100%);max-height:92vh;overflow:auto;background:var(--card);border:1px solid var(--green);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.5);padding:20px 22px">
        <div style="font-size:21px">{{ commit.title }}</div>
        <!-- v5: honest copy (do-commit runs git add -A; main refuses an .env change set) -->
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Commits every changed file (git add -A). Refused if a .env file is in the set.</div>
        <!-- v5: why Commit is disabled (an .env file in the set, with its paths, or the change set couldn't be read) -->
        <sc-if value="{{ commit.hasAlert }}" hint-placeholder-val="{{ false }}"><div role="alert" style="margin-top:10px;padding:8px 10px;font-size:12px;color:var(--red);border:1px solid color-mix(in oklab,var(--red) 45%,transparent);background:color-mix(in oklab,var(--red) 10%,transparent);border-radius:8px;word-break:break-word">{{ commit.alert }}</div></sc-if>
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

`;
