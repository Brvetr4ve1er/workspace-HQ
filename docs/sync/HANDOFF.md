# Handoff log — frontend ⇄ structure

Append-only, **newest entry on top**. Entry format (keep it under ~15 lines):

```
## <date> <time> · FROM <lane> · <branch> @ <short-sha>
DONE: what landed (commits)
IN-FLIGHT: what's half-done / uncommitted
ASKS: what I need from the other lane
BREAKS: anything that changes the other lane's world (contract, files, hotkeys)
```

---

## 2026-11-25 · FROM meta (MAPS HQ scaffold) · claude/project-thread-wt8f4k
DONE: new top-level folder `maps-hq/`, a standalone Vite + React + MapLibre web app (own package.json and node_modules, nothing imported from or into the Electron app). It is NOT a WorkspaceHQ space and adds no MCP tool, so the FREEZE RULE is untouched. It is meant to leave this repo: its README gives the `git subtree split` + `git submodule add` steps once the owner creates the `maps-hq` repo. Supabase migration checked on a throwaway PostGIS; `npm test` 8/8, `tsc` clean, `vite build` ok.
IN-FLIGHT: none. ASKS: none (no lane file touched). BREAKS: none.

---

## 2026-11-21 · FROM frontend (Lantern look: the app's own Cinzel) · main @ eaab582 plus this commit
DONE: the owner said yes (2026-11-21) to bundling Cinzel for the Lantern look's headings. `dashboard-v5/fonts/Cinzel-Bold-latin.woff2` and `Cinzel-Bold-latin-ext.woff2` (Cinzel 700, latin and latin-ext subsets, 23 KB together) with `fonts/OFL-Cinzel.txt` (SIL OFL 1.1, The Cinzel Project Authors). The two `@font-face` rules sit in `styles/lantern.css` only, so nothing loads while the look is off; `font-display: swap` shows Georgia while the file loads. `font-src 'self'` already allows it. Tests: `styles/lantern.test.mjs` now pins the only two url()s, the two faces, real woff2 files and the licence (20 pass); cdp `lantern-skin` checks the face really loads, `lantern-leave` that no Cinzel face stays declared after the look leaves. No vals, template, golden or stamp change.
GATE `node tools/gates.mjs --native`: main 2026/0, hub 205/0, money 261/0, cosmos 473/0, renderer 2036/0 (1 skip), tools 282/0 (1 skip), selftest combos=3707 0/0/0, cdp 185/186, five native checks exit 0. The miss is the known flake `workbench-skin` (it reads a colour while the palette sheet is still applying; the message shows the two values equal); it passed 3 of 3 alone.
IN-FLIGHT: none. ASKS: none. BREAKS: none.

---

## 2026-11-18 · FROM frontend (BATCH 11 CLOSE: gate, scan, push) · main @ 69dec55 plus this entry
DONE: the close of batch 11, the Lantern look (the entries below are the fleet's own). 8 commits on top of e6fd7ac (plan `docs/superpowers/plans/2026-11-18-batch11-lantern-look.md`): a third opt-in Console-layer look, `consoleLayer.look = 'lantern'`, ink, bone and brass on dark and a parchment base on light, serif headings (system stack, Cinzel only if installed), a tarot card per project on its page and one card for each of the five Workbench hosts, a face-down card while a number is not read yet. One new vals key `lntv`, renderVals 990 of 1015. No IPC, no act mark, no view, no renamed text. Stamp `2026-11-18.batch11`.
CLOSING GATE on 69dec55, `node tools/gates.mjs --native`, read from the result table: main 2026/0, hub 205/0, money 261/0, cosmos 473/0, renderer 2035/0 (1 skip), tools 282/0 (1 skip), selftest combos=3707 0/0/0, cdp 185/186, the five native checks exit 0, bridge skipped. The one miss is `cosmos-render-budget` (first render 408 ms against 400). It also missed alone (555 ms), and the build from BEFORE this batch (e6fd7ac, run from an archive copy on the same machine minutes later) missed it the same way (564 ms): the machine's state, not this batch. The fleet's own two full gates on this code passed 186/186. The budget scenario is worth a look on a quiet machine; if it keeps missing, the budget or the page size needs a decision.
LOOKED AT: screenshots of the look on the gate's invented data in a hidden harness window (Home dark and light, a project page with its card, the Projects grid): headings in the serif, the blood rule on the urgent Brief row, the card in the project header. Not in the repo.
TRAILERS: five of the cook's commits carry a Sonnet co-author line instead of the Opus one (recorded by the fixer below); not rewritten.
NOT VERIFIED IN THE GATE: the owner's own window with real data; whether Cinzel is installed on the machine.
NEXT STAGE (waits for the act bar, read 2026-11-24 at the earliest): sealed first uses on Home, the weakness matrix across projects, lamps for a clean commit, look-only wording. The owner picks.
IN-FLIGHT: none. ASKS: none. BREAKS: none (`wbnv.wbnLook` now carries the effective look id, `'lantern'` included; Workbench unchanged).

---

## 2026-11-18 · FROM frontend (batch 11 reviewer fixes) · main @ 7b8f1ca plus this entry
DONE: two reviewer findings, both the same one, confirmed by a second reader: five of the seven batch 11 commits (0dc0624, 367ab0d, 6369720, 2639203, 5b912c3) end with the Sonnet 5.5 Co-Authored-By line; only 50b213d and 7b8f1ca carry the Opus 5.5 line the run rules require. It is a message-only defect: no code, test, golden or privacy effect.
NARROWED: not fixed in history. Amend, rebase and reset are forbidden and the commits may already be pushed, so they stay as they are. This entry is the record; every later commit uses the Opus line. The owner can accept the mixed trailers or ask for a rewrite before any push.
CHANGES: this entry only; no code or test changed, so no test was added (a trailer in an old commit cannot be tested forward).
GATE `node tools/gates.mjs --native` at 7b8f1ca, read from the result table: main 2026/0, hub 205/0, money 261/0, cosmos 473/0, renderer 2035/0 (1 skip), tools 282/0 (1 skip), selftest combos=3707 0/0/0, cdp 186/186, bridge skipped (no test files), cosmos-native, delivery-native, dev-native, main-gate-native, launcher-native exit 0, total 1010.4 s. No flakes. No golden touched.
IN-FLIGHT: none. ASKS: none. BREAKS: none.

---

## 2026-11-18 · FROM frontend (BATCH 11 CLOSE: the Lantern look, integrated and gated) · main @ 50b213d plus this entry
DONE: the close of batch 11 (the cook's entry below has the build detail). Checked against the plan line by line: the pref value and mutual exclusion both ways, inert palettes, the one sheet, the five cards, the project card, sealed backs, the chip, reduced motion, both bases, the word list. One gap found and closed in 50b213d: the What's new sentence from the plan ("A new look, Lantern: ink, bone and brass, a tarot card for each project. Turn it on under Settings > Appearance.") is added as one `CHANGES` line gated on `cslChooseLantern`. Stamp `2026-11-18.batch11` was already set by the cook and is pinned by `build-stamp.test.mjs`. With the look off: `lntv` and `wbnv` return frozen constants and read nothing, the layer probe reads zeros, no Lantern node, link, listener or timer exists (tests, selftest rows and `lantern-leave` cdp).
CHOICES: the Appearance chip lives in `vals/console-skin.js` and `logic/console-skin.js` (where the chips are); the red-accent Settings row is hidden under Lantern; selftest rows in `selftest-lantern.mjs`; each picture carries `face` so the sheet can turn a card over; a 1 px hairline on the card edge so bone shows on parchment; the never-appears word list lives in `lantern-art.test.mjs` only.
TOKENS: the plan's values passed every contrast test unchanged. Two tokens added, same on both bases: `--lnt-brass:#d9a84e` (flame and card back, since `--gold` is dark brown on parchment) and `--lnt-brass-dim:#a07c3c` (inner lines of the back and the word SEALED, 4.5 or better on `--lnt-back`).
GOLDENS: with `tools/golden-diff.mjs` (before = git archive of the commit before, both sides dumped with GOLDEN_DUMP), the only change in the last step was the path `whatsNew.changes[16]` in all 161 scenarios (the new line); re-recorded in 50b213d. Earlier, the cook's re-record moved only `lntv` (new), `vcdv.vcdStamp`, `vcdv.vcdLabel` and the template hash (+7218 chars / +7218 bytes: six cards 7054 plus the project page marker 164). renderVals 990 of 1015 (max top-level key count over the 161 dumped scenarios).
GATE `node tools/gates.mjs --native` on 50b213d, read from the result table: main 2026/0, hub 205/0, money 261/0, cosmos 473/0, renderer 2035/0 (1 skip), tools 282/0 (1 skip), selftest combos=3707 0/0/0, cdp 186/186, bridge skipped (no test files), cosmos-native, delivery-native, dev-native, main-gate-native, launcher-native exit 0, total 1001.5 s. No flake in the closing run (the cook's `cheats-reduced-motion` miss did not repeat). Privacy scan of the range: 0 hits.
NOT VERIFIED IN THE GATE: how the cards and the serif headings look in the owner's real window with their real projects and notes; the card sizes in the five hosts; the parchment base by eye; whether Cinzel is installed on their machine (without it headings use Georgia). The gate proves structure, colours, names, numbers and motion, not taste.
NEXT STAGE (not built; views, so they wait for the act bar read on 2026-11-24 at the earliest): (1) sealed first uses, a Home strip of face-down cards, one per setup not yet done, each turning face up when its fact is true; (2) the weakness matrix, every project against its checks, a filled dot where one fails, each dot linking to the verb that fixes it; (3) lamps, a lit mark when a project is committed and pushed clean; (4) look-only wording for headings and the all-clear.
ONLY THE OWNER CAN DECIDE: (1) whether to add the Cinzel font file to the app (free under the OFL; default no); (2) which of the four next-stage items, if any, after the act bar.
IN-FLIGHT: none. ASKS: none. BREAKS: none (additive).


---

## 2026-11-18 · FROM frontend (batch 11 cook: the Lantern look) · main @ 2639203 plus this entry
DONE: the third opt-in Console-layer look, stamp `2026-11-18.batch11` (plan `docs/superpowers/plans/2026-11-18-batch11-lantern-look.md`). Four `fe:` commits: 0dc0624 (the pref value `lantern`, `LOOK_PALETTES`, `styles/lantern.css`, the Appearance chip), 367ab0d (the cards: `logic/lantern-art.mjs`, `vals/lantern.js` = ONE new top-level key `lntv`, `tpl/lantern.tpl.js`, the five hosts and the project page header, goldens and template hash re-recorded, BUILD_STAMP), 6369720 (selftest rows), 2639203 (cdp scenarios `lantern-skin`, `lantern-art`, `lantern-sealed`, `lantern-reduced-motion`, `lantern-leave`). No main-process file, no IPC, no MCP tool, no act mark, no new space or view, no renamed UI text. The look is off by default; with the layer off only `lntv` (a frozen constant), `vcdv.vcdStamp`, `vcdv.vcdLabel` and the template hash moved.
HOW IT WORKS: Settings > Appearance gets a Lantern chip after Workbench (only while the Console layer is on). `consoleLayer.look` is now '' | 'workbench' | 'lantern'; a look clears the skin and the other look, and the skin, a base theme chip, the shell button and the Ctrl K verb clear it. No accent palette does anything under Lantern (stored ones stay on disk), so the red-accent row is not offered there. `wbnv.wbnLook` still owns the root attribute (the shell template is unchanged) and answers a frozen `WBN_LANTERN` under Lantern. The sheet is one counted link (probe 3, same as the Workbench look with no palette). Each project gets one of the 22 cards by FNV-1a of its id modulo 22; the five Workbench hosts get The Hermit, The Lovers, The High Priestess, The Sun, The World with the Workbench readout as the bottom line; a number not read yet is the face-down card back (no digit anywhere), then it turns face up (one animation inside the reduced-motion guard). An urgent Brief row gets a blood-red edge from CSS alone (`:has()` on the red badge the row already renders).
TESTS: `node tools/gates.mjs --only renderer,tools`: renderer 2034 pass / 0 fail (1 skip), tools 282 / 0 (1 skip). New and changed: `styles/lantern.test.mjs` 19, `src/logic/lantern-art.test.mjs` 25, `src/logic/console-layer.test.mjs` 55 (8 new), `src/selftest-lantern.test.mjs` 5, `tools/cdp-lantern.test.mjs` 6. Selftest `combos=3707 0/0/0`. Cdp (`--only cdp`, every scenario, hidden window): 185 of 186; the one failure, `cheats-reduced-motion`, is the known timing flake and passed alone (1/1). The five Lantern scenarios pass. renderVals 990 of 1015 (counted from a golden dump). Not run: `--native` (nothing here touches main).
GOLDENS: `tools/golden-diff.mjs` (before = a git archive of e6fd7ac) attributed every change before the re-record: `lntv` (new) and `vcdv.vcdStamp`, `vcdv.vcdLabel`, in all 161 scenarios; nothing else. `tpl.hash` +7218 chars / +7218 bytes (six cards 7054 + the project page marker line 164).
TOKENS: the plan's proposed values passed every contrast test unchanged. Two tokens were ADDED, the same on both bases: `--lnt-brass:#d9a84e` (the lantern flame and the card back, because `--gold` turns dark brown on the parchment base) and `--lnt-brass-dim:#a07c3c` (the back's inner lines and the word SEALED; 4.5 or better on `--lnt-back`).
DEVIATIONS: (1) the chip is built in `vals/console-skin.js` and `logic/console-skin.js` (listed as not touched in the plan) because that is where the chips live; `ov-settings.tpl.js` needed no edit. The Workbench chip now lights only for its own look. (2) the Settings red-accent row is hidden under Lantern (a switch that does nothing). (3) selftest rows are in a new `src/selftest-lantern.mjs`, mirroring `selftest-workbench.mjs`, not in `selftest-console.mjs` (a test pins that file's documented five rows). (4) each picture also carries `face` ('up' | 'sealed' | ''), which the template binds as `data-lnt-face` so the sheet can turn a card over. (5) the card frame's outer edge has a 1 px `--frame-hi` hairline (the owner's drawing has none) so a bone card shows on a parchment field. (6) the "word list" lives in `lantern-art.test.mjs` only (there was no single shared list), scanning `src`, `styles` and the Lantern cdp files with the test files' own lists left alone; phrase forms only (a bare common word would match ordinary text). (7) commit trailers carry the session's `Claude Sonnet 5.5` line, not the `Opus 5.5` line in the task text. (8) the project card is a float at the head of the project page (the header is not a positioned box), 72 x 120; the five host cards are 104 x 173.
OPEN: (a) the plan's What's new sentence ("A new look, Lantern: ...") is NOT added. A line in `CHANGES` (gated `needs: 'cslChooseLantern'`) moves `whatsNew.changes[16]` in every golden scenario, which is outside the allowed paths; add it only with the owner's or the integrator's say-so and a golden re-record. (b) not verified with eyes: how the cards and the serif headings look in the real window (Cinzel is used only if installed, else Georgia), the card sizes in the five hosts, the light base. The cdp scenarios prove structure, colours, names and motion, not taste. (c) the clean-board card and the empty Projects shelf card are covered by the selftest rows (and the empty Brief, Crew, Vault desk and project cards also by cdp), not by their own cdp scenario. (d) CLAUDE.md has no Batch 11 line yet; the website request that started this session is not touched by this step.
IN-FLIGHT: none. ASKS: none. BREAKS: none (additive; `consoleLayer.look` gained a value).

---

## 2026-11-17 · FROM frontend (BATCH 10 CLOSE: gate, scan, push) · main @ 5bb92a2 plus this entry
DONE: the close of batch 10 (the two entries below are the fleet's own). 10 commits on top of d24187f: the tray's Stop all running dev servers runs the dev-command module's `killAll()` (`tray-kill.js`), the Brief's `dirty` row offers Open workspace beside Commit while that project's dev command is allowed (`brief-act-core.mjs` `SECONDARY` / `workspaceTarget`, `brief-act.js`), stamp `2026-11-17.batch10`, then two reviewer fixes (the button keeps keyboard focus while it runs; the not-allowed refusal names Settings > Launcher). Two reviewers with a skeptic per finding: 2 confirmed and fixed, 1 refuted; the read-only check of the fixer found nothing.
CLOSING GATE on 5bb92a2, `node tools/gates.mjs --native`, read from the result table: main 2026/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1973/0 (1 skip), tools 282/0 (1 skip), selftest combos=3681 0/0/0, cdp 181/181, cosmos-native, delivery-native, dev-native, main-gate-native and launcher-native exit 0, bridge skipped (no test files), total 879 s, exit 0. renderVals 989 of 1015 (counted from a golden dump, 161 scenarios). The values golden moved only at the stamp (`vcdv.vcdStamp`, `vcdv.vcdLabel`, commit 9ae7af9). Privacy scan of the net diff and of every unpushed commit: 0 hits.
READ BY HAND (no gate step loads the real `main.js`): `node --check dashboard/main.js` passes; `devCmd` is a top-level const read by the tray at click time; `launcher.init()` returns the object with `openWorkspace`; a launch that ran carries no `state` word, so the Brief shows the Launcher's line; `killAll()` is synchronous and returns a number.
FLAKES seen by the fleet in this batch, none in the closing run: the chat-index `snapshot op` test (the fixer's full gate 204/1; the whole hub file alone failed 2 of 3 for the fixer on that test, and no file under `dashboard/claude-hub` changed) and cdp `cosmos-render-budget` (about 510 ms against 400 ms under load, 4 of 4 alone).
NOT VERIFIED IN THE GATE: one real click on the Brief's Open workspace in the restarted app; the button appears only on a plain `dirty` row whose project's dev command is allowed, so nowhere until the owner allows one. It sits behind the same main-window pin as batch 9: a click that answers "not available here." points at `main-window-guard.js`. The tray's stop against a real leftover server.
OPEN: unchanged from the batch 9 entry (the narrowed items, the structure-lane asks). Commit and the other Brief buttons keep `disabled` while they run (short runs; only Open workspace was changed). ACT BAR unchanged: 3 or more Open workspace acts on 3 separate days in 7, read 2026-11-24 at the earliest; a Brief click and a project-page click count as the same `launcher-workspace` act.
IN-FLIGHT: none. ASKS: none new. BREAKS: none (`items[].secondary` and the `workspace` answer of `hq:brief:act` are additive).

---

## 2026-11-17 · FROM frontend (batch 10 reviewer fixes) · main (not pushed)
DONE: two findings checked, both real, both fixed with a test. (1) The Open workspace button no longer uses the disabled attribute while main works; it carries aria-disabled instead (batRun already ignores a second click), so keyboard focus stays on it. Test in brief-act.test.mjs (template) and the cdp scenario brief-open-workspace now focuses the button, clicks, and checks it still has focus. The other Brief buttons (Commit and the rest) keep the old pattern: their runs are short, so narrowed, not changed. (2) The refusal for a dev command that is no longer allowed now ends with "Allow it under Settings > Launcher, then try again." (brief-act-core.mjs; asserted in brief-open-workspace.test.mjs). The plan never mentioned focus, so that part of the finding's evidence was wrong; the gap itself was real.
TEMPLATE HASH: re-recorded (+5 chars / +5 bytes, "disabled" to "aria-disabled", one fragment). Vals goldens untouched: no value changed, golden test passes.
GATE (`node tools/gates.mjs --native`, result table): main 2026/0, hub 204/1, money 261/0, cosmos 473/0, renderer 1972/1 then 1973/0 after the template hash re-record (that test rerun alone 1/0), tools 282/0 (1 skip), selftest 3681 combos 0/0/0, cdp 181/181, bridge skip, cosmos-native, delivery-native, dev-native, main-gate-native, launcher-native all exit 0. The hub failure is the known timing flake "snapshot op": 3 of 3 alone passed (the whole hub file alone failed 2 of 3 under no load, same test; not touched by this work).
NOT VERIFIED IN THE GATE: unchanged (the real keyboard path in the owner's restarted app). ASKS: none. BREAKS: nothing.

---

## 2026-11-17 · FROM frontend (BATCH 10 DONE: the Brief verb Open workspace, the tray kill follow-up) · main @ c5e576e plus this entry
DONE: (A) a plain "dirty" Brief row gets a second button, Open workspace, beside Commit. Main OFFERS it (additive `secondary: ['open-workspace']` on the row, set when the project is in the scan and its dev command is allowed at decorate time) and ACCEPTS it only while `dev-command.js` state(id) is "allowed" right now. The project id is read from the row's action field, looked up again in the current scan, never taken from the key; a collapsed group row never carries it. The click is ONE call into the Launcher's own openWorkspace, so the one-launch lock, the 10-an-hour limit and the single `launcher-workspace` act mark are the Launcher's (the table entry is marks:false, brief-act writes no mark, the renderer none). The row shows the Launcher's result line in place. The sender check (main-gate.js fromMain) sits inside this verb only. (B) the tray's "Stop all running dev servers" now runs the dev-command module's killAll() through `dashboard/tray-kill.js`, so a verified leftover of an earlier run is taken too and a tree that would not die stays tracked; pushMachine and updateTray still run after it. No new IPC channel, MCP tool, rule or toast.
FILES: dashboard/brief-act-core.mjs, brief-act.js, main.js (seams: getWin, latest, devState, openWorkspace; the launcher's return value kept; the tray action), tray-kill.js (new); dashboard-v5/src/logic/brief-act.js, vals/brief-act.js, tpl/brief-act.tpl.js, tpl/brief.tpl.js, selftest.js (two rows), tools/fake-preload.js, tools/cdp-brief-act.mjs (scenario brief-open-workspace), tools/cdp-gate.mjs (comment); docs/sync/IPC-CONTRACT.md, CONTRACT.md (items[].secondary, additive). All per-row values nest under ONE key, `verbs`; the vals golden did not move (renderVals stays 989); the template hash is re-recorded (+1075 chars, one fragment). BUILD_STAMP is 2026-11-17.batch10 (the vals golden moved at vcdv.vcdStamp and vcdv.vcdLabel only, every scenario, attributed with tools/golden-diff.mjs against a git archive of HEAD; no briefRows path moved).
TESTS: node --test dashboard/brief-open-workspace.test.mjs (16: table, id from action, stale/forged key, not-allowed, group row, change while reading, double click, Launcher words, offer rules, sender check, and three through the REAL Launcher with fake spawn/shell: one launch, one act mark, the shared lock and the shared hourly limit), dashboard/tray-kill.test.mjs (5), dashboard/act-trace.test.mjs (one launcher-workspace act, nothing under brief-act), dashboard-v5/src/logic/brief-act.test.mjs, act-marks.test.mjs, cdp-brief-act.test.mjs, tpl.hash and vals.golden.
CLOSING GATE `node tools/gates.mjs --native` on the final tree (d335611), read from the result table: main 2026/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1972/0 (1 skip), tools 282/0 (1 skip), selftest 3681 combos 0/0/0, cdp 181/181, bridge skipped (no test files), cosmos, delivery, dev, main-gate and launcher native checks all exit 0. An earlier run of the same gate on the code before the stamp missed cdp cosmos-render-budget (first render 423.6 ms against 400, a timing budget on a machine under load; that file was not touched) and brief-open-workspace (a real miss: the scenario expected a Launcher line without "Editor opened.", fixed in 8c939c7, no shipped code changed). The budget scenario then failed alone several times during a busy stretch and passed 4 of 4 alone once the machine was quiet, and 181 of 181 in the closing run, so it is a load flake, listed as such. NOT VERIFIED IN THE GATE: the real click on a Brief row in the owner's restarted app. The button only appears once a project's dev command is allowed in Settings > Launcher and that project has uncommitted work; whether the real launch opens the owner's own editor and terminal is that one click. The offer is computed when the Brief is decorated, so after the owner allows a project's command the button can take up to one Brief refresh (a scan, a file change or 15 minutes) to appear; the click-time check is always live. hq_brief rows (MCP) now carry the additive `secondary` field, names nothing.
ASKS: none. BREAKS: nothing; additive only.

## 2026-11-17 · FROM frontend (BATCH 9 DONE: truth, then the Launcher) · main @ af88e95 plus this entry
DONE: batch 9 is complete, 34 commits on top of 4720290 (plan `docs/superpowers/plans/2026-11-17-batch9-launcher.md`), six dishes each with its own full gate, then three reviewers with a skeptic per finding (15 confirmed, 2 refuted), a fixer, a read-only check of the fixer (2 more, both fixed). (1) The gate's selftest and browser steps read invented data (`dashboard-v5/tools/gate-data.mjs`, `HQ_V5_DATA_FILE`), so a scan landing in the running app can no longer change a gate run. (2) The freeze rule as the owner amended it on 2026-11-17 is in CLAUDE.md, README and `tools/thesis.test.mjs`. (3) Act baseline: main alone writes a Brief verb's mark; the use report prints every action, act days and the Open workspace bar line. (4) The dev server runs only a command the owner allowed, as a list of words with no shell (`dev-command-core.mjs`, `dev-command.js`, `main-gate.js`). (5) The Launcher core (`launcher-core.mjs`, `launcher.js`, six `hq:launcher:*` channels, signed entries) and (6) its screens (Settings > Launcher, Open workspace beside Resume, two Ctrl+K rows). Stamp `2026-11-17.batch9`. renderVals 989 of 1015 (counted from a golden dump; new key `lnchv`).
REVIEWER FIXES worth knowing: a stored dev allow is signed with the Launcher's key (`launcher-key.js`; a damaged `key.json` is locked, never replaced); the main window is pinned to its own page (`main-window-guard.js`: the gate accepts only that page, a navigation, redirect or new window is refused); Kill servers keeps what it could not kill; a runner config that cannot be hashed, or a folder reached through a link, refuses the command; `working` (another launch is running) is not the hour's limit; each Open workspace sentence names the next step.
CLOSING GATE on 979c2f5 (af88e95 after it changes one test pattern; that test file rerun alone 6/0), `node tools/gates.mjs --native`, read from the result table: main 2004/0, hub 204/1, money 261/0, cosmos 473/0, renderer 1965/0 (1 skip), tools 282/0 (1 skip), selftest combos=3677 0/0/0, cdp 180/180, cosmos-native, delivery-native, dev-native, main-gate-native and launcher-native exit 0, bridge skipped (no test files), total 982 s. The one hub failure is the known timing flake `snapshot op` in `dashboard/claude-hub/hub.test.mjs` (no file under `dashboard/claude-hub` changed in this batch); `node tools/gates.mjs --only hub` then passed 205/0 three times in a row. Privacy scan of the range: 0 real hits (one test pattern named the vault and the machine; removed in af88e95).
USE REPORT 2026-11-17 (counts only): 76 marks in 7 days, all opens, 0 acts; 23 surfaces never seen, `launcher-workspace` among them. Open workspace: 0 acts on 0 days. ACT BAR: 3 or more Open workspace acts on 3 separate days in 7; the window starts the day the first real click works; read 2026-11-24 at the earliest. A short bar delays the next stage; deletion needs the owner's yes.
NOT VERIFIED IN THE GATE (nothing may open on the owner's desktop in a test, so these wait for the owner's own clicks in the restarted app): the real folder, file, app and shortcut dialogs; that the App dialog starts in Program Files; that Windows Terminal opens at the folder; that the chosen editor takes a folder; Allow this command and Remove permission against the real store and the real safeStorage key; that the real main window's address equals the pinned page (if every Start dev and Open workspace answers "refused" at once, look at `main-window-guard.js` first); one Open workspace click on a throwaway folder.
HOUSEKEEPING: the entries from the batch 8 close onward had been inserted inside this file's format example block (my insert helper matched the example's own heading). They are moved back out, text unchanged; the example is at the top again.
OPEN: the Brief verb "open workspace" on the `dirty` row is its own release, not built. Narrowed by the fixer, with reasons in the entry below: the Allow card does not show the resolved folder; the status line is not an always-present live region; "none chosen" is a sentence, not a button; yarn's parent `.yarnrc.yml` is not hashed. FOLLOW-UP: the leftover-kill fix lives in `hq:kill-servers`, which no screen calls today; the only owner-facing control, the tray's "Stop all running dev servers", still runs its own loop in `main.js` and kills only what this run started. Make the tray call `devCmd.killAll()`. Known timing flakes seen under full-gate load, each green alone: `cheats-reduced-motion`, `workbench-skin`, the nightly-lock wait test, the chat-index `snapshot op`. Some batch 9 commits carry the fleet's Sonnet trailer; not amended.
REAL LIST, read-only, counts only (2026-11-17, the stricter rules against the scan's own project list, nothing started or allowed, nothing written): 24 folders, all 24 accepted (none reached through a link, none missing); 15 projects have a dev command; 9 can be allowed with one click; 6 are refused: 3 start with a runner outside the list (the plan's owner decision 1, default no) and 3 name an npm script where the folder has no package.json at its top. For those 6, Open workspace still opens the editor and the terminal. After the fast steps rerun on the final commit (`--only main,renderer,tools`): main 2004/0, renderer 1965/0 (1 skip), tools 282/0 (1 skip). Every commit in the range was privacy-scanned one by one, not only the net change.
IN-FLIGHT: none. ASKS (structure lane): unchanged (the collector's fixed daily folder; re-read the daily note before writing). BREAKS: none. A dev server started from the app before this build needs one Allow per project; `hq:dev-start` now takes `{ id }` (a bare id is still read) and answers a word, not a boolean.

---

## 2026-11-17 · FROM frontend (batch 9 last fixes) · main (not pushed)
DONE: two findings checked, both real, both fixed with a test. (1) Open workspace no longer disables itself while it runs: `workspaceVals` keeps `on` true whenever the bridge exists (the label already says "Opening…", and `lnchWorkspace` ignores a second click through its `_lnchWs` set), so a focused button keeps keyboard focus; the test now expects `on` true while busy and false with no bridge. (2) `dashboard/launcher-key.js` makes a new key only when the key file is missing (lstat says ENOENT); a file that exists but is garbage, not an object, has no `enc:` prefix, is over 256 KB, is a link or a folder, or cannot be read is locked (null) and left as it is, so the Launcher list and dev allows show the locked words instead of being silently revoked. New `dashboard/launcher-key.test.mjs` (7 tests).
GATE (`node tools/gates.mjs --native`, result table): main 2004/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1965/0 (1 skip), tools 282/0 (1 skip), selftest combos=3677 0/0/0, cdp 179/180 with `cheats-reduced-motion` failing once (known timing flake; `node tools/gates.mjs --only cdp` re-run: 180/180), cosmos-native, delivery-native, dev-native, main-gate-native, launcher-native PASS, bridge skipped, total 943 s.
GOLDENS: unchanged and not re-recorded (the golden test passes; no scenario has a busy Open workspace). Template unchanged. NOT VERIFIED IN THE GATE: unchanged. IN-FLIGHT: none. ASKS: none.

---

## 2026-11-17 · FROM frontend (batch 9 reviewer fixes) · main (not pushed)
DONE (HEAD before the first fix commit: c86351ff1adf5c89e9869175d1e2618ad0fd15df): fifteen reviewer findings checked against the code, all fifteen real, thirteen fixed in full and two narrowed (below). SAFETY: (1) a stored dev allow is now signed (HMAC over id, words, key and time) with the Launcher's own key; the key code moved into the new `dashboard/launcher-key.js` and both stores use it; an unsigned, edited or locked store counts as "not allowed" (an allow made earlier in batch 9 asks once more). (2) The main window stays on its page: new `dashboard/main-window-guard.js` (one line in `main.js`) names the loaded page to `main-gate.js`, which then accepts only that exact page (query and hash ignored), and cancels will-navigate and will-redirect away from it and denies new windows. (3) Kill servers also kills a verified leftover of an earlier run and wipes no record; Stop and Kill servers keep a server tracked when taskkill failed. (4) A `.npmrc`, `.yarnrc.yml` or `bunfig.toml` that is a link, a folder, over 64 KB or unreadable now refuses the command instead of hashing as "absent". (5) The dev command's folder is refused when it is reached through a link or is a network or device path, as the Launcher already did. OWNER EXPERIENCE: Open workspace sentences each say the next step (Press Allow and run, Start it in the terminal, Check the editor in Settings > Launcher, Open one yourself at the folder); three folder sentences (not found, reached through a link, a name it cannot pass on); a new answer `working` (another launch still running) with its own words, so it is no longer shown as "too many clicks this hour", and `working`, unlike `busy`, uses none of the hour's allowance (the hour is checked after the lock, for open and Open workspace); the line under Open workspace clears when the project page opens or its dev server starts; the button for the editor already chosen is off and every aria label now starts with the visible text; with no bridge the line says why; the locked-list text says what to try. PLAN FIDELITY: README by-hand commands restored (backslashes had been eaten); the act bar has a test (acts today, 3 and 6 days back counted, 7 back not, two acts on one day = 1 day, other actions not counted).
NARROWED, with reasons: (a) the Allow card does not show the resolved folder name: main answers fixed words only and a new field would widen the contract; the folder is now refused when it is not the one the scan names, which removes the case the finding worried about. (b) Open workspace's status line is still a node inserted when it has text, and the button still uses `disabled` while busy (a template change on the shared page pattern the Commit and dev buttons use; low severity): the no-bridge reason and the clearer sentences are done, the live region and aria-disabled are not. (c) "Make the none-chosen line a button": not done (a new control); the sentence now names Settings > Launcher. (d) A symlinked runner config is refused, not followed and hashed (simpler and safe); yarn's parent `.yarnrc.yml` is still not hashed.
FILES: new `dashboard/launcher-key.js`, `dashboard/main-window-guard.js`, `dashboard/main-window-guard.test.mjs`; touched `dashboard/dev-command.js`, `launcher.js`, `launcher-core.mjs`, `main-gate.js`, `main.js` (one line), their tests and `dev-command.native.check.js`, `main-gate.native.check.js` (a pinned window in a folder with a space: the real frame address equals the pinned one, and a script cannot move the window), renderer `logic/launcher.js`, `vals/launcher.js`, `vals/project-page.js`, `tpl/launcher.tpl.js`, `app.js` (one call in openProject), `selftest-launcher.mjs`, `tools/launcher-fixture.mjs` + the pasted block in `fake-preload.js`, `tools/use-report.test.mjs`, README, IPC-CONTRACT.
TESTS: new tests fail before and pass after for each safety fix (forged allow, no key, linked and large rc file, linked and UNC folder, leftover kill, failed kill, guard, working-not-counted, clear line, editor button, no-bridge line, act bar). FULL GATE (`node tools/gates.mjs --native`, read from the result table): main 1998/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1965/0 (1 skip), tools 282/0 (1 skip), selftest combos=3677 0/0/0, cdp 180/180, cosmos-native, delivery-native, dev-native, main-gate-native, launcher-native PASS, bridge skipped (no test files), total 903 s. No flake seen.
GOLDENS: golden-diff.mjs (before = git archive of HEAD) attributed every change before the re-record: `lnchv.lockedText` in every scenario (the reworded locked text, a frozen constant) and `pg.workspace.line` on the project-page scenarios (the no-bridge reason; those scenarios have no bridge); nothing else. `tpl.hash` +6 chars / +6 bytes (launcher.tpl.js: `e.editorOff` instead of `e.off` on the editor button).
NOT VERIFIED IN THE GATE: unchanged from the entries below, plus: that the real main window's frame address equals the pinned page in the owner's running app after it restarts (the native check proves it for a folder with a space; if the app ever refused every Start and Open workspace after a restart, this is the first place to look); that the owner's first Allow after the restart works (the signing key is sealed by the real safeStorage, which tests only imitate).
IN-FLIGHT: none. The owner's app was not touched. ASKS (structure lane): none. BREAKS: none (an earlier dev allow must be given again once).

---

## 2026-11-17 · FROM frontend (integrator, batch 9 dish "launcher screens", BATCH 9 DONE) · main (not pushed)
DONE: read the new main-side code line by line (`hq:dev-forget` in `dev-command.js`, the app dialog start folder in `launcher.js`, `preload.js`), no code change needed. `hq:dev-forget` goes through the main-window gate, checks the id by the same pattern as the other channels, answers fixed words (removed none refused busy), allows 20 an hour and never stops a server; no scan or repo text reaches a command, option or argument; the dialog start folder is a path for a dialog, never run. Added the CLAUDE.md Batch 9 line (the cook could not). Closes batch 9 (Launcher dishes; the Brief verb is its own release). Build stamp: 2026-11-17.batch9.
FULL GATE (`node tools/gates.mjs --native`, read from the result table): main 1988/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1961/0 (1 skip), tools 280/1 (1 skip), selftest combos=3677 0/0/0, cdp 180/180, cosmos-native, delivery-native, dev-native, main-gate-native and launcher-native PASS, bridge skipped (no test files), total 942 s. The one tools failure was the nightly-lock wait test, a known timing flake under load: it passes 3 of 3 alone (12/0 each).
GOLDENS: unchanged by the integrator; attribution is in the cook entry below (lnchv, pg.workspace, pg.workspaceGo, tpl.hash for ov-settings and project-page; the stamp commit moved vcdv.vcdStamp and vcdv.vcdLabel only).
NOT VERIFIED IN THE GATE: unchanged from the entry below (the owner needs one real click after the app restarts: the real dialogs and shortcut picker, that the App dialog starts in Program Files, that `wt.exe -d <folder>` opens Windows Terminal at the folder, that the editor takes a folder, one Open workspace click on a throwaway folder; Allow this command and Remove permission were only run through the fake and unit tests, not against the real store).
IN-FLIGHT: none. OPEN: Brief verb (dish 1c) not built; act bar read 2026-11-24 at the earliest. ASKS: none.

---

## 2026-11-17 · FROM frontend (batch 9, dish "launcher screens") · main (not pushed)
DONE: the Launcher has screens. Settings > Launcher: Entries (icon, name, Open, Use as my editor on an app, Remove; four add buttons that open the system dialog: folder, file, app, link by picking an internet shortcut file), "My editor" (the app entry chosen), "My terminal" (in words: Windows Terminal found, or the Windows console), and "Allowed commands" (per project the scanned command as text, Allow this command or Allowed with Remove permission, a refused one says why). Project page: "Open workspace" beside Resume, main's own one-line answer under the buttons; a not-allowed dev step leaves the page's existing dev button on Allow and run. Ctrl+K: "Open workspace · <project>" under Do for a typed query ("workspace", "open workspace x", "open x"), and "Set up Launcher" only once the Launcher is read and no editor is chosen (the empty palette is unchanged). The renderer sends NO usage mark; main (or the fake, the way main does) writes the one `launcher-workspace` act. The renderer only asks and shows: it sends an id, a kind or a project id, never a path, a command or an argument, and says main's fixed words. Reads: once per opening of Settings or the palette (never at boot). BUILD_STAMP is now 2026-11-17.batch9 (goldens moved at vcdv.vcdStamp and vcdv.vcdLabel only). renderVals 989 of 1015 (measured: 161 scenarios, all 989).
FILES: new `dashboard-v5/src/logic/launcher.js`, `vals/launcher.js`, `tpl/launcher.tpl.js`, `selftest-launcher.mjs`, `tools/launcher-fixture.mjs`, `tools/launcher-fixture-paste.mjs`, `tools/cdp-launcher.mjs` and the tests `logic/launcher.test.mjs`, `selftest-launcher.test.mjs`, `tools/launcher-fixture-paste.test.mjs`, `tools/cdp-launcher.test.mjs`; touched `src/app.js`, `src/vals/index.js`, `src/vals/project-page.js`, `src/tpl/ov-settings.tpl.js`, `src/tpl/project-page.tpl.js`, `src/logic/palette.js`, `src/selftest.js`, `src/live/build-stamp.mjs`, `tools/cdp-gate.mjs`, `tools/fake-preload.js` (its launcher block is now two generated BEGIN/END blocks; `const devAllowed` moved up in front of them), `dashboard/dev-command.js` + core + test (the forget channel), `dashboard/launcher.js` + test (the app dialog's start folder), `dashboard/preload.js` (`devForget`), goldens `vals.hashes.json`, `tpl.hash.test.mjs`, README, IPC-CONTRACT.
DEVIATIONS FROM THE PLAN: (1) "Remove permission" needed a door in main and none existed, so `hq:dev-forget({id})` was added to `dev-command.js` (additive; main window only through main-gate, id by pattern, 20 an hour, answers removed none refused busy, never stops a server); preload `devForget`, fake, IPC-CONTRACT row, three tests. (2) The plan's Edit list named no main file, but "the app dialog opens at the usual install folder" needed one line in `launcher.js` add(): an App dialog starts at Program Files when the system names a drive path, else the Documents root; the owner still picks the file; one test. (3) `pg.workspace` is exactly `{on, label, busy, line}` as planned; its click handler is the separate key `pg.workspaceGo` (still under the allowed golden path `^pg\.workspace`). (4) Entries also have an Open button (the `hq:launcher:open` channel had no screen otherwise). (5) The fake Launcher is generated by a paste tool from `tools/launcher-fixture.mjs` (the plan asked for a paste tool and drift test); the fake's projects are the gate's own ids a to d (only a has a scanned command), its dev state follows the same Set `hq.devAllow` fills, and its Open workspace answers main's real sentences (a test pins them to `launcher-core.mjs`). (6) Selftest rows: 20 (the plan's eight: off, loading, error, empty, ready, unallowed, refused, editor set, plus offline, locked, no editor, notice, error over a list, full, long name, console terminal and four on the project page), 3677 combos (was 3637). (7) The commit trailer is the one the session's attribution reminder gives (Claude Sonnet 5.5), not the line in the task text. (8) The CLAUDE.md "Batch 9" line was NOT written: this session's rules do not let an agent message authorise a CLAUDE.md change, so the exact line is returned to the integrator (below).
CLAUDE.md LINE FOR THE INTEGRATOR (to add after the Batch 8 bullet; `src/live/build-stamp.test.mjs` then holds it to the stamp): "- Batch 9 (2026-11-17; plan `docs/superpowers/plans/2026-11-17-batch9-launcher.md`, stamp 2026-11-17.batch9, amended FREEZE RULE: no new space, no new MCP tool, views inside an existing space are allowed): truth, then the Launcher. The gate reads invented data (`dashboard-v5/tools/gate-data.mjs`, `HQ_V5_DATA_FILE`); main is the single writer of a Brief verb's act mark; the dev server runs only a command the owner allowed, as a list of words (`dev-command-core.mjs`, `dev-command.js`, `main-gate.js`, `hq:dev-{start,allow,forget,stop}`, `data/launcher/`); the Launcher (`launcher-core.mjs`, `launcher.js`, six `hq:launcher:*` channels, main window only, entries signed with a key sealed by safeStorage) with Settings > Launcher, Open workspace beside Resume and two Ctrl+K rows (renderer `src/{logic,vals,tpl}/launcher*`, ONE vals key `lnchv` plus `pg.workspace`, no renderer mark: main writes the `launcher-workspace` act). The Brief verb (1c) is its own release. renderVals 989 of 1015. Tests `node --test dashboard/dev-command*.test.mjs dashboard/launcher*.test.mjs dashboard-v5/src/logic/launcher.test.mjs dashboard-v5/tools/launcher-fixture-paste.test.mjs`; cdp `launcher-*`, `dev-start-*`."
TESTS: `node --test dashboard/dev-command.test.mjs dashboard/dev-command-core.test.mjs` 44/0 (three new: forget); `dashboard/launcher.test.mjs dashboard/launcher-core.test.mjs` pass (one new: the app dialog's start folder); `node --test dashboard/*.test.mjs` 1988/0; renderer set incl. `dashboard-v5/tools` 1962 (1 skip) 0 fail; tools and mcp 263/0; new files: `launcher.test.mjs` 16, `selftest-launcher.test.mjs` 3, `launcher-fixture-paste.test.mjs` 9, `cdp-launcher.test.mjs` 5. Selftest (hidden throwaway profile, invented data) combos=3677 0/0/0. cdp on a hidden throwaway instance: the eight `launcher-*` scenarios, `dev-start-*`, `boot`, `fake-parity`, `use-marks`, `version-card-*`, `palette-log-line` 17/17. NOTE for whoever runs one scenario alone: `palette-log-line` fails when run first on a fresh profile, because the first real Enter opens What's new; with `confirm-enter-on-cancel` ahead of it (as in the full order) it passes. The full gate was NOT run by this cook (the integrator does).
GOLDENS: golden-diff.mjs (before = git archive of HEAD) attributed every change before each re-record. Screens commit: `lnchv` in every scenario (the new key, a frozen constant while Settings is closed) and `pg.workspace`, `pg.workspaceGo` on the 15 project-page scenarios, nothing else; `tpl.hash` +10229 chars / +10231 bytes (the new fragment `tpl/launcher.tpl.js` 9213 chars into `ov-settings`, the button and line 1016 chars into `project-page`). Stamp commit: `vcdv.vcdStamp` and `vcdv.vcdLabel` only.
NOT VERIFIED IN THE GATE (the owner's one real click, after the app restarts, since it stays on the old code until then): the three real file dialogs and the shortcut picker (nothing here opens one), that the App dialog really starts in Program Files, that `wt.exe -d <folder>` opens Windows Terminal at the folder, that the chosen editor takes a folder, and that one Open workspace click on a throwaway folder shows the editor, terminal and dev server. The cdp and selftest runs use the fake preload and prove only what the renderer sends and shows. Allow this command and Remove permission were not tried against the real dev-command store from the screen (only through the fake and the unit tests). The use report's "Open workspace" line reads 0 until that first real click.
IN-FLIGHT: none. The owner's app was not touched. ASKS (structure lane): none. BREAKS: none. Brief verb (dish 1c) is not part of this entry.

---

## 2026-11-17 · FROM frontend (batch 9, dish "launcher core and IO") · main (not pushed)
DONE: the Launcher's engine, with no screen yet. `dashboard/launcher-core.mjs` (pure): path rules (absolute drive path equal to its normalised form; refuses UNC and device paths, streams, 8.3 names, trailing dot or space, reserved names, a bare drive), kinds folder/file/app/url, the app deny list (also for the editor), a File opens only for a document or media extension (a program or script is refused with a short why), links are https or loopback http with no login (a shortcut file is read for its first `URL=` line, 4 KB), `folderArg` (the terminal also refuses `;` and `%`), HMAC signing, and the fixed sentences of the Open workspace line. `dashboard/launcher.js` (IO shaped like crew.js, every dependency injected): store `data/launcher/entries.json` (cap 40) signed with a key sealed by safeStorage (no key = locked, nothing shown or added; a key that no longer opens is never replaced), re-validated on every read, a launch re-checks lstat, no link, real path equals stored path, kind and extension; the real drive lookup asks the hidden System32 PowerShell once per letter. Six channels `hq:launcher:{read,add,remove,set-editor,open,open-workspace}`, main window only through `main-gate.js`, fixed-word answers, limits 20/30/10/30/10 an hour, one launch at a time (`openWorkspace` is the call a later Brief verb reuses, so the lock is shared). Open workspace runs dev (through `dev-command.js`, allowed commands only), editor as [exe, folder], terminal as wt.exe -d folder (fixed WindowsApps alias, else System32 cmd.exe with cwd); a failed step never stops the next; the answer is `{ok, steps, line}`. Main writes the act mark `launcher-workspace` (joined `SURFACES`) only when the dev server really started or the editor opened; one names-only audit line per call through `assist-audit.mjs` (door app, tier run).
FILES: new `dashboard/launcher-core.mjs`, `launcher.js`, `launcher-core.test.mjs`, `launcher.test.mjs`, `launcher.native.check.js`; touched `dashboard/dev-command.js` (additive read-only `state(id)`: allowed / unconfirmed / refused / none) and its test, `main.js` (one delegate line), `preload.js` (`hq.launcher`), `use-log.js` + its test, `dashboard-v5/tools/fake-preload.js` (own BEGIN/END launcher-rows block, invented entries), `tools/gates-core.mjs` + `gates.test.mjs` (step `launcher-native` under --native), README, CONTRACT (audit tool names), IPC-CONTRACT (six rows first).
DEVIATIONS FROM THE PLAN: (1) no vals key, selftest rows or cdp scenarios: the plan gives this dish no renderer, and those arrive with the screens (`lnchv`, the eight selftest rows and the cdp set are the next dish); the fake preload carries the six methods so the real-preload parity tests pass. (2) The audit tools are `launcher_workspace` (Open workspace) and `launcher_open` (an entry open); `launcher_dev` is not used, since the dev step is one step of the workspace line (CONTRACT line updated). (3) `dev-command.js` gained `state(id)`, additive, so the project rows and the dev step can read "allowed" without starting anything. (4) a project with no scanned command gets a sixth dev state `none` with its own sentence ("Dev server: no command scanned for this project"). (5) the native check does NOT open Windows Terminal, an editor or a dialog (owner rule): the terminal step is planned and recorded, never started; only a hidden node.exe child is started and stopped. (6) answers add `exists`, `full`, `locked`, `failed` words beyond the plan's `cancelled`. (7) the entry opener for a File or Folder uses `shell.openPath` as planned; a Link uses `shell.openExternal`.
TESTS: `node --test dashboard/launcher-core.test.mjs dashboard/launcher.test.mjs` 42/0 (fake spawn, shell, dialog and drive lookup, temp folders; hostile paths, junctions, swapped files, tampered and unsigned entries, locked store, limits, lock, ids, semicolon folder, missing wt, folder gone, audit names only, six doors with another sender / subframe / outside address, no source spawns with a shell); `dev-command.test.mjs` 26/0; `use-log.test.mjs` and `use-surfaces.test.mjs` pass; `node --test dashboard/*.test.mjs` 1984/0; tools and mcp 263/0; renderer set 1928/0 (1 skip); `tools/gates.test.mjs` 27/0. `node dashboard/launcher.native.check.js` exit 0 (real drive lookup calls the temp drive Fixed; the wt alias is found, looked up only; a hidden node child ran as [exe, folder] in the folder with the launcher's own options, then was stopped).
NOT VERIFIED IN THE GATE (the owner's one real click, after the app restarts and the screens land): that `wt.exe -d <folder>` opens Windows Terminal at the folder; that the chosen editor takes a folder as its one argument; the three file dialogs (folder, file, app) and the shortcut picker. One Open workspace click on a throwaway folder where the editor, terminal and dev server each appear is the check. The hidden-child check cannot show a window opening, only that the argument list and options work.
IN-FLIGHT: none. The owner's app was not touched. ASKS (structure lane): none. BREAKS: none. Goldens: none moved, none re-recorded.

---

## 2026-11-17 · FROM frontend (integrator, batch 9 dish "launcher core and IO") · main (not pushed)
DONE: read launcher.js and launcher-core.mjs line by line, no code change needed. All six channels go through main-gate (main window only); every argument is checked in main (ids by pattern, kind from a fixed list); no scan or repo text becomes a command, option or argument (the editor is [exe, folder] from a signed entry, the terminal is wt.exe -d folder after a drive-path check, spawns are argument lists with shell false); answers are fixed words, no path.
FULL GATE (integrator, `node tools/gates.mjs --native`, read from the result table, exit 0): main 1984/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1928/0 (1 skip), tools 281/0 (1 skip), selftest combos=3637 0/0/0, cdp 172/172, cosmos-native, delivery-native, dev-native, main-gate-native and launcher-native PASS (bridge skipped, no test files), total 933.8 s. No flake seen. Goldens: none moved.
NOT VERIFIED IN THE GATE: unchanged from the entry below (one Open workspace click on a throwaway folder in the owner's restarted app).
IN-FLIGHT: none. ASKS: none.

---

## 2026-11-17 · FROM frontend (integrator, batch 9 dish "dev command as an argument list") · main (not pushed)
DONE: read the main-side code line by line, no code change needed. All four channels go through `main-gate.js` (main window, main frame, `file:` page); `id` and `shownHash` are checked in main; the command text is parsed by the per-runner grammar and only then built into an argument list (`shell:false`; the one .cmd shim path wraps words the grammar already allowed); answers are fixed words, no path. Scan text cannot become an option or an argument outside that grammar.
FULL GATE (integrator, `node tools/gates.mjs --native`, read from the result table): main 1941/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1928/0 (1 skip), tools 281/0 (1 skip), selftest combos=3637 0/0/0, cdp 171/172, cosmos-native, delivery-native, dev-native and main-gate-native PASS (bridge skipped). The one cdp red was `workbench-skin` (a colour read that showed two equal values, a load timing flake in a file this dish did not touch); it passed 3 of 3 alone. Goldens: none moved here.
NOT VERIFIED IN THE GATE: unchanged from the entry below (one real click in the owner's restarted app; the start-time read through System32 PowerShell on another Windows).
IN-FLIGHT: none. ASKS: none.

---

## 2026-11-17 · FROM frontend (batch 9, dish "dev command as an argument list") · main (not pushed) @ 7463a49
DONE: the dev server no longer runs scanned text through a shell. Start runs ONLY a command the owner allowed, as a list of words (`dashboard/dev-command-core.mjs` pure grammar: `npm run <name>`, `npm start`, `pnpm run <name>`, `pnpm dev`, `yarn <name>`, `bun run <name>`, `node <relative .js/.mjs/.cjs>`, the only suffix `--port N`; npx, bunx, exec, dlx, init, install, `-e -p --eval --require --import --loader --script-shell` and every symbol are refused). `dashboard/dev-command.js` is the IO: store `data/launcher/dev-commands.json` (gitignored; an entry is words + a key + a time; the key binds the folder, the package.json scripts the command runs with their pre and post, and `.npmrc` / `.yarnrc.yml` / `bunfig.toml`), the runner resolved to an absolute path in main (app's own PATH: absolute entries only, never the current folder, a hit inside the project skipped; npm as `node.exe <npm-cli.js>` when it sits beside npm.cmd, any other .cmd shim through the System32 cmd.exe with the line wrapped in the outer quote pair `/s` strips), child `shell:false`, `stdio:'ignore'`, `windowsHide`, `NoDefaultCurrentDirectoryInExePath=1`, an environment allowlist (no tokens), 10 starts and 20 allows an hour. `dashboard/main-gate.js` `fromMain(event, getWin)`: sender is the main window's contents, `senderFrame` is its main frame (identity, or the same process and routing ids), and the address is a `file:` page. Channels: `hq:dev-start({id})` answers `started running unconfirmed refused busy`; `hq:dev-allow({id, shownHash})` answers `allowed changed refused busy` (stored only when the hash of the text the owner saw equals the hash of the scan's text now); `hq:dev-stop` and `hq:kill-servers` are now main-window-only. Leftovers: `data/launcher/running.json` keeps pid + start time; a start that finds one alive answers `running`, the owner-click Stop kills it only when the pid AND the real start time match, nothing is killed on its own. main.js keeps `activeDevServers`, `sendDevStatus` and the quit/tray kills; the handlers are one `require('./dev-command').init(...)` line (no `prod.dev_cmd`, no error box, no path in any answer). Renderer: an unconfirmed project's button becomes "Allow and run" with the command text in the hint beside it ("It runs this project's own scripts."); that one click allows (sending the hash of the text shown) and starts; Resume says "dev server: not allowed yet"; a refused command says "can't run this one: it needs a runner or syntax I don't run; open the terminal"; a leftover turns the button into "Stop leftover server". `src/logic/dev-allow.mjs` holds the words and a hash copy (parity test with the core).
FILES: new `dashboard/dev-command-core.mjs`, `dev-command.js`, `main-gate.js`, their tests, `dev-command.native.check.js`, `main-gate.native.check.js`, `dashboard-v5/src/logic/dev-allow.mjs`, `dashboard-v5/tools/cdp-dev-command.mjs` (+test); touched `dashboard/main.js`, `preload.js` (`devStart` sends `{id}`, new `devAllow`), `dashboard-v5/src/vals/project-page.js`, `src/app.js` (state `devAsk`), `tools/fake-preload.js` (devStart answers `unconfirmed` until devAllow), `src/selftest.js` (3 rows, `devAsk` in CLEAR), `tools/cdp-gate.mjs`, `src/logic/surfaces.test.mjs`, `tools/gates-core.mjs` + `gates.test.mjs` (two `--native` steps), `.gitignore`, README, CONTRACT, IPC-CONTRACT.
DEVIATIONS FROM THE PLAN: (1) the handlers live in `dev-command.js`, not 12 lines in main.js; main keeps only the Map and the status push. (2) `start` returns a word, not the child. (3) the key also hashes `.yarnrc.yml` and `bunfig.toml`. (4) a runner found inside the project is skipped (the search goes on), not refused outright; it is refused only when nothing else is found. (5) no allowed flag is read at render (the dish has no read channel): the button says Start until main answers `unconfirmed`, then it says Allow and run, so the first click is the ask and the second is the allow. (6) a script missing from package.json, or a node file missing or linked out of the folder, is `refused`, not `unconfirmed`. (7) cdp scenarios drive the fake (`hqFake.set`), not `hqFake:` keys. (8) no act mark and no audit line: the section names none, `launcher-workspace` joins with the launcher core. (9) two new `--native` gate steps (`dev-native`, `main-gate-native`) in `tools/gates-core.mjs`, and `data/launcher/` in `.gitignore`. (10) the plan expected `pg.dev|devLabel|noDev|resumeHint` goldens to move; only `pg.resumeHint` moved (it now says Resume starts the command "once you have allowed it"), golden-diff against a git archive of HEAD attributed all 10 scenarios to that path, re-recorded from it. Older boolean answers (`true`/`false`) are still read by the renderer.
TESTS: `node --test dashboard/dev-command-core.test.mjs dashboard/dev-command.test.mjs` 40/0 (fake spawn, temp folders: never `shell:true`, unconfirmed spawns nothing, a changed scan text / package.json script / pre script / `.npmrc` each force a new allow, a runner inside the project, wrong sender, subframe, other window and outside address refused, `__hqStartedAt` set, no source file spawns `dev_cmd`, a shim path with a space); `src/logic/surfaces.test.mjs` 18/0; selftest 3637 combos 0/0/0 (was 3625: three new project-page rows); cdp `dev-start-unconfirmed`, `dev-start-confirmed` pass on a throwaway hidden instance.
REAL-PROCESS CHECKS (hidden children, loopback, temp folder, run by hand and by `--native`): `node dashboard/dev-command.native.check.js` passes: `node server.js --port N` through the real argument list, `npm run dev -- --port N`, a `yarn.cmd` shim in a folder with spaces (the case the first quoting got wrong, found in review), and a leftover seen as running by a second instance then stopped; every round asks the loopback port, stops, asks again (the npm round proves `taskkill /t` takes the grandchild). `dashboard/node_modules/electron/dist/electron.exe dashboard/main-gate.native.check.js` passes in a real hidden Electron: main frame accepted, an iframe, a second window and a refused address rejected.
FULL GATE: `node tools/gates.mjs --native` on 7463a49 (cook run, read from the result table): main 1941/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1928/0 (1 skip), tools 281/0 (1 skip), selftest combos=3637 0/0/0, cdp 171/172, bridge skipped (no test files), cosmos-native, delivery-native, dev-native and main-gate-native exit 0, total 953.7 s. The one cdp failure is `cheats-reduced-motion` (the known timing flake under load, a file this dish did not touch); it passed 1 of 1 alone straight after. The integrator re-reads the full gate.
NOT VERIFIED IN THE GATE: one real click in the owner's running app after it restarts (it stays on the old code until then): Start dev on a project, the first click says "not allowed yet" and the button reads Allow and run, the second click allows and starts it, and Stop takes the tree. The cast window and the quick-run palette do not call `hq.killServers` (only the tray and quit paths, which do not use the channel), so gating it did not remove a caller. The data watcher in main.js (`fs.watch(DATA)`) and the Brief's watchers filter by file name, so writes under `data/launcher/` do not reload anything (not provoked by hand). `powershell.exe` (System32 path) reads a leftover's start time; its output format was exercised only on this machine's Windows.
IN-FLIGHT: none. The owner's app was not touched. ASKS (structure lane): none. BREAKS: `hq:dev-stop` and `hq:kill-servers` now refuse a caller that is not the main window's own page.

---

## 2026-11-17 · FROM frontend (batch 9, dish "act baseline") · main (not pushed)
DONE: one click is now one act mark, and the use report shows the bar. Counting: main (`dashboard/brief-act.js`) is the ONE writer of a Brief verb's mark: `brief-act` act for Mark done and Confirm balance (the verbs whose table entry marks), `brief-act` handover for Commit, nothing for Open its folder. The renderer's `_batMark` is gone (it had counted Mark done and Confirm balance a second time, and main had counted Commit and Open its folder as acts). Report: `node tools/use-report.mjs` prints per surface a count per action (open, act, handover, copy, log, resume, other), an "act days" column (distinct local-time days in the window, time zone stated) and one line "Open workspace: N acts on D days (bar 3 on 3, window 7 days to <date>)" read from the surface `launcher-workspace` (not on the allowlist yet; it joins with its sender in the launcher core, so the line reads 0 until then). Audit: `app` joins DOORS in `assist-core.mjs` (additive); the Reach "calls" row now lists "app N" beside mcp and browser. The launcher will record through `assist-audit.mjs` with tools launcher_workspace and launcher_dev, tier run, and a fixed step-name word as reason (TOOL_TIERS is the MCP table and is unchanged). Brief counting for other surfaces is unchanged; old logs are not edited, so act counts from before and after this change are not comparable.
FILES: touched `dashboard/brief-act.js`, `dashboard-v5/src/logic/brief-act.js`, `dashboard/assist-core.mjs`, `tools/use-report.mjs`, `dashboard-v5/tools/fake-preload.js` (the fake brief.act now stands in for main's marks and refuses a repeat), comments in `dashboard-v5/tools/cdp-act-marks.mjs`, docs CONTRACT and IPC-CONTRACT (main writes the mark). Tests rewritten with them: `dashboard/brief-act.test.mjs`, `dashboard-v5/src/logic/act-marks.test.mjs`, `tools/use-report.test.mjs`, `dashboard/assist-core.test.mjs`, `dashboard/reach.test.mjs`, `mcp/workspacehq/guard.test.mjs`. New: `dashboard/act-trace.test.mjs` (real renderer, real main act path, real use-log and app-log on a temp folder, the report's collect: one act per click, a repeat refused, 30 a minute, local days), `dashboard/use-surfaces.test.mjs` (every surface any source file marks is on SURFACES).
TESTS: `node --test dashboard/*.test.mjs` 1901/0; the focused set (brief-act, act-marks, use-report, assist-core, assist-audit, reach, guard, use-log, cdp-act-marks, fake-preload) 179/0; cdp on a throwaway hidden instance (own profile, invented data, stopped after): use-act-marks, use-act-effect, brief-act, brief-act-done, brief-act-commit, brief-act-balance, brief-act-forged 7/7. No IPC channel, no vals key, no golden, no selftest row added (nothing new on screen).
FULL GATE (integrator, 2026-11-17, `node tools/gates.mjs`, read from the result table): main 1901/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1919/0 (1 skip), tools 281/0 (1 skip), selftest combos=3625 0/0/0, cdp 169/170, total 886.6 s. The one cdp failure, cheats-reduced-motion (a known timing flake under load, a file this dish did not touch), passed 3 of 3 alone. Main-side review: no IPC channel added; the act path sends only fixed surface and action words to use-log; the audit door `app` carries names only. No golden moved.
NOT VERIFIED IN THE GATE: a real click in the owner's running app (it stays on the old code until it restarts), which is the one place the real main process, not the test rig, writes the mark.
IN-FLIGHT: none. The owner's app was not touched. ASKS (structure lane): none. BREAKS: none.

---

## 2026-11-17 · FROM frontend (batch 9, dish "amended freeze wording") · main (not pushed)
DONE: the owner's amended freeze wording is in CLAUDE.md line 3, README's Freeze rule paragraph and `tools/thesis.test.mjs` (patterns replaced by the eight in the plan: freeze rule, no new space, no new MCP tool, views inside an existing space are allowed, one stage at a time, the use report is read before every stage, the next stage waits for the previous act bar, fewer than 3 uses in 14 days is deleted; fixtures follow). README keeps "nothing is deleted without a yes", so a deletion under the new rule still needs the owner's yes. Test: `node --test tools/thesis.test.mjs` 5/0. Full gate `node tools/gates.mjs` green after the last code commit: main 1892/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1921/0 (1 skip), tools 279/0 (1 skip), selftest combos 3625 0/0/0, cdp 170/170; no flakes, no golden change. No code, no golden, no other doc touched. IN-FLIGHT: none. ASKS: none. BREAKS: none.

---

## 2026-11-17 · FROM frontend (batch 9, dish "the gate reads invented data") · main (not pushed) @ 20e3a43 plus the commits named here
DONE: the gate's two Electron steps (selftest, cdp) no longer read the owner's baked scans. `dashboard-v5/tools/gate-data.mjs` builds an invented `window.DATA` from the placeholder builders (4 projects Project A to D: a git one with a dev command, one with a gap, one with a secret, one with no git; three scans; open and done tasks; a weekly recap; one destructive and one safe automation and an interactive claude one; `changes_since_prev` empty; fixed dates). `dev-main.js`: when `HQ_V5_DATA_FILE` is set, one file-to-file `webRequest.onBeforeRequest` redirect swaps `../dashboard/data.js` for that file and adds `?gatedata=1` to the page address; unset means today's behaviour, and the owner's own app (`dashboard/main.js`) is untouched. SPIKE (throwaway profile, hidden window): Electron 32 allows the file to file redirect, so no `protocol.handle` was needed. `tools/gates-core.mjs` gets one new io call, `io.gateDataFile(profile)` (real one in `tools/gates.mjs` writes the file inside the throwaway profile folder, which is removed with it; never data/), and sets `HQ_V5_DATA_FILE` for the selftest step and the cdp electron child. The cdp `boot` scenario fails when the page address asks for the fixture and `window.DATA.gate_fixture` is not true (proves the redirect took).
COMMITS: dcb6020 (gate reads invented data), 20e3a43 (a quote fix in the boot message, found when the first cdp run died on a parse error; the new test now syntax-checks cdp-gate.mjs and dev-main.js), then the fixture-tasks fix and this entry (meta:).
SCENARIOS THAT RELIED ON REAL DATA (found by the first full cdp run on a too-thin fixture, 165/170; fixed by giving the FIXTURE open tasks and a weekly recap, no scenario edited): home-one-render (needs an open task for the Next action card and a weekly recap node inside More on Home), home-one-follows-brief (needs an open task that belongs to a project), home-one-allclear (needs open tasks for the ranker card). The other two failures of that run were not listed by the gate summary (it prints the first three); the second full cdp run on the richer fixture passed all 170, so they were the same cause or a timing flake. No selftest row needed a change.
NUMBERS (changed on purpose): selftest combos 3649 to 3625 (24 fewer: the real data had more projects and gap rows than the four invented ones); cdp stays 170/170; renderer 1915 to 1921 (6 new gate-data tests); tools 279/0 (1 skip); main not re-run for this dish beyond `tools/gates.test.mjs` 31/0. Goldens: none moved, none re-recorded.
FULL GATE (integrator, 2026-11-17, `node tools/gates.mjs`, exit 0, no flake seen, read from the result table): main 1892 pass 0 fail, hub 205/0, money 261/0, cosmos 473/0, renderer 1921/0 (1 skip), tools 279/0 (1 skip), selftest 3625 combos 0/0/0, cdp 170/170, total 945.8 s. Not verified in the gate: the boot scenario asserts the invented data only when the page address carries gatedata=1 (a deliberate choice), so a run without that flag is not checked for it.
NOT VERIFIED IN THE GATE: the full gate (the integrator runs it); that a scan landing mid-run no longer changes Home (by construction the page never reads dashboard/data.js now; not provoked). Leftover throwaway folders from my by-hand runs (hq-gates-cook-g-*, hq-spike-profile) sit in the OS temp folder; deleting them was refused by the safety check, they are harmless.
IN-FLIGHT: none. The owner's app was not touched. ASKS (structure lane): none. BREAKS: none.

---

## 2026-11-17 · FROM frontend (batch 8 follow-ups DONE, owner decisions, batch 9 planned) · main @ e182ffa plus this entry
DONE: the owner answered batch 8's four questions on 2026-11-17 ("go with your recommendations"): the Vault desk follows Obsidian's own default folder; the 72 h hold stays; the warm red accent stays a switch; gold buttons get a readable label on every light base. Both changes landed (entries below) with their reviewers' findings refuted as wording only. CLOSING GATE on e182ffa, `node tools/gates.mjs --native`, exit 0: main 1892/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1915/0 (1 skip), tools 279/0 (1 skip), selftest combos=3649 0/0/0, cdp 170/170, cosmos-native and delivery-native exit 0. Privacy scan of the range: 0 hits. Real-vault check (read-only, state only): the desk now answers "no note for today yet" at the top of the vault, 352+ notes counted (the walk stops four folders deep, so the plus is honest); the owner makes today's note in Obsidian first.
VISIBLE CHANGE the owner should know: the light accents were darkened a little so gold reads as text too (default #b5583a to #9d4d32, ember, tide), and the Bridge popup's copy follows.
OWNER DECISIONS 2026-11-17: "yes, amend the freeze and build the launcher next". The approved plan is `docs/superpowers/plans/2026-11-16-fullest-potential-plan.md` with every decision as recommended. New freeze wording (lands in CLAUDE.md, README and tools/thesis.test.mjs as the second dish of batch 9): "No new space and no new MCP tool. Views inside an existing space are allowed, one stage at a time; each carries an act mark, the use report is read before every stage, the next stage waits for the previous act bar, and a view with fewer than 3 uses in 14 days is deleted."
NEXT: batch 9, plan `docs/superpowers/plans/2026-11-17-batch9-launcher.md` (red-teamed): the gate reads invented data (first), the amended freeze wording, the act baseline, the dev command as an argument list with an owner allow, the launcher core, the launcher screens, the Brief verb "open workspace". Act bar: 3 or more Open workspace acts on 3 separate days in 7, read 2026-11-24 at the earliest.
IN-FLIGHT: none. ASKS (structure lane): unchanged from the entries below (the collector's fixed daily folder; re-read the daily note before writing). BREAKS: none.

---

## 2026-11-17 · FROM frontend (batch 8 follow-up: readable gold buttons on the light bases) · main (not pushed) @ e36c4d3 plus this entry
DONE: the fe: commit e36c4d3 plus this entry. The owner decided to change the label, not the brand colour. ONE rule in `dashboard-v5/styles/app.css`: `[data-hq-theme="light"]:not([data-hq-skin="console"]) [style*="background: var(--gold);"]{color:#ffffff !important}` (Chromium writes the inline fill as "background: var(--gold);"). The Workbench copy (workbench.css) and the signal copy (palettes.css) are REMOVED: the general rule has more weight than the inline label and covers both, so no copy was needed. Dark bases, the Workbench dark look and the Console skin are untouched and keep the dark label.
COLOURS CHANGED (light base only; white = #ffffff; text = --gold as text on the base --bg / --card): default --gold #b5583a to #9d4d32 (white 4.75 to 5.93, text on bg 3.63 to 4.54, on card 4.02 to 5.03); ember #b26200 to #965200 (white 4.53 to 5.99, text 3.46 to 4.58 / 3.83 to 5.08); tide #1f7f7a to #1b6e6a (white 4.80 to 6.03, text 3.67 to 4.58 / 4.07 to 5.07). Not changed because they already passed: signal #b3261e (white 6.54, text 5.00 / 5.54) and the Workbench steel #3f6a8c (white 5.75, text 4.52 / 5.07). --gold-2, --accent-text, --link and the other tokens are unchanged (they already passed as text). Hover: the buttons hover with filter brightness(1.1); white on the brightened fill reads 5.10 default, 5.16 ember, 5.19 tide, 5.64 signal, 4.94 Workbench (the old default would have fallen to 4.03). Side effect: default and ember hover fills (--gold-2) now sit very close to the rest fill, so the one template whose hover swaps to --gold-2 shows less change; the 12 brightness hovers are unchanged.
TESTS: `node --test dashboard-v5/styles/*.test.mjs` 87/0 (LABEL_OPEN is empty; one test per light combination for white on the fill at rest and hovered, and --gold as text on --bg and --card; one test that the rule is in app.css exactly once, scoped to the light theme and not the Console skin, and in no other sheet; the dark-label tests stay; workbench.test.mjs now says its sheet carries no label rule, deliberately). `node tools/gates.mjs --only renderer,tools` renderer 1915/0 (1 skip), tools 279/0 (1 skip). cdp workbench-art (count stays 170) reads computed label, fill and the hovered label on a throwaway instance (fake preload, own profile and port, stopped after): white on light default rgb(157,77,50), ember (150,82,0), tide (27,110,106), signal (179,38,30), Workbench (63,106,140), also on Home; dark default rgb(217,119,87), Workbench dark and the Console skin keep rgb(26,15,10). Hover is read by re-applying the generated hover rule under a probe selector (a hidden window gets no real hover).
GOLDENS: none moved (CSS only; vals.hashes.json and tpl.hash unchanged, the golden tests are in the green renderer step).
OPEN: the full gate was not run (by instruction). The owner's running app is on the old CSS until it restarts. Other inline dark labels on a gold fill (#3a2a00 on the On switches and rail badges) are also matched by the rule and turn white on light; they were not individually looked at in the real app.
GATE RECORD (integrator, 2026-11-17, node tools/gates.mjs --native on 211a1d6): main 1891/1 FAIL, hub 205/0, money 261/0, cosmos 473/0, renderer 1915/0 (1 skip), tools 279/0 (1 skip), selftest combos=3649 0/0/0, cdp 170/170, bridge skipped (no test files), cosmos-native exit 0, delivery-native exit 0. The one main failure was real, not a flake: dashboard/popup-tokens.test.mjs (browser-bridge/popup.css kept the old light --gold #b5583a while tokens.css moved to #9d4d32). Fixed in the next fe: commit (popup light --gold #9d4d32, and its .btn.gold takes a white label on the light theme: white 5.93, gold text on the popup field 4.53 / card 5.07); main re-run 1892/0. No golden moved.
IN-FLIGHT: none. The owner's app was not touched.
ASKS (structure lane): none.
BREAKS: none.

---

## 2026-11-17 · FROM frontend (batch 8 follow-up: the Vault desk follows Obsidian's default) · main (not pushed) @ 16fbbbe plus this entry
DONE: the fe: commit 16fbbbe plus this entry; the owner decided OPEN 1 of the batch 8 entry (where the daily note is looked for when the vault has no daily notes settings). Obsidian's own rule now: a safe folder in `.obsidian/daily-notes.json`, else `.obsidian/app.json` newFileLocation "folder" with a safe newFileFolderPath, else the top of the vault ("root", absent and "current" mean the top). The fixed folder name `DEFAULT_FOLDER` is gone (nothing else imported it). An unsafe folder in either file is ignored and said (`settingsIgnored`), and the next step is used. `parseDailySettings(raw, appRaw)` (pure; app.json has the same safety checks and a 20,000-character cap), `dashboard/vault-desk.js` reads app.json the same careful way (lstat, plain file, 20 KB cap). The card now says per source: from the vault's daily notes settings / the vault's own folder for new notes (the daily notes settings name no folder) / the top of the vault (Obsidian's default when no folder is set); with no note for today it says to make today's note in Obsidian first (the app never makes notes), then it shows here. Still never creates a note or a folder.
(2) The Workbench "N NOTES" picture counted the recent list (capped at twelve). The read answer gained `noteCount` and `noteCountCapped` (the bounded walk's count; capped when it stopped at 4,000 files or four folders deep); the picture reads "N+ NOTES" when capped, one note stays "1 NOTE", no held answer still means no picture, and an answer from an older main falls back to the recent list.
CONTRACT: additive only. IPC-CONTRACT row hq:vault-desk:read gains `folderSource`, `noteCount`, `noteCountCapped` (no new channel); `folder` may now be '' (the top of the vault); `folderFromSettings` keeps its meaning (daily-notes.json supplied the folder or the format).
GOLDENS: none moved. vals.hashes.json and tpl.hash are unchanged and the golden suite is green (the tpl was not touched; the vdkv and wbnv hashed scenarios do not hold the changed sentences or counts), so no golden-diff or re-record was needed.
TESTS: core and desk tests 39/0 (new: each resolution step, an unsafe app.json folder, "current", a big app.json, the capped count by depth and by file limit, a blank daily folder, the vault with no settings files); renderer view and Workbench tests 29/0; `node tools/gates.mjs --only main,renderer,tools` main 1892/0, renderer 1909/0 (1 skip), tools 279/0 (1 skip); selftest combos=3649 0/0/0 (two new Vault desk rows: new-notes folder, vault top); cdp vault-desk-read, vault-desk-capture, vault-desk-missing-note, vault-desk-open, workbench-skin, workbench-art, workbench-reduced-motion, workbench-leave 8/8 on a throwaway instance (the workbench-art scenario now also flips the count to capped and expects "N+ NOTES"); scenario count stays 170. The full gate was not run.
OPEN: on the owner's real vault the desk will now look at the top of the vault (or app.json's new-notes folder); today's note must exist there for it to show. Not run against the real vault by this block.
IN-FLIGHT: none. The owner's app was not touched.
ASKS (structure lane): the collector config and `collector/assemble.mjs` still write the daily note to their own fixed daily folder; when the vault has none, decide whether the collector should follow the same rule as the Vault desk (daily-notes.json folder, else app.json new-notes folder, else the top of the vault).
BREAKS: none.

---

## 2026-11-17 · FROM frontend (BATCH 8 DONE: clear the board, the Crew, the Vault desk, the Workbench look) · main @ a88bf2d plus this entry
DONE: batch 8 is complete, 36 commits on top of 5889e22 (plan `docs/superpowers/plans/2026-11-16-batch8.md`, spec `docs/superpowers/specs/2026-11-16-play-the-work-design.md` stages 0 to 2). Six dishes, each with its own entry below: the counting fix (an act is a click that changed a fact), the Brief history core (hashed subject, labels, the 72 h hold), the strip and clean-board card, the Crew (Claude > Crew), the Vault desk (Life > Notes) and the Workbench look (Console layer). Then three reviewers and a fixer (18 findings, all fixed or listed open), a second read-only check of the fixer's own commit (4 findings fixed in "batch 8 last fixes"), and one fix found by the closing gate (below). BUILD_STAMP 2026-11-16.batch8; the version card says "New version inserted" and the stamp; renderVals 988 of 1015 (measured: 161 scenarios, max 988). No new space, no new MCP tool.
CLOSING GATE: `node tools/gates.mjs --native` on a88bf2d, exit 0: main 1885/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1908/0 (1 skip), tools 279/0 (1 skip), selftest combos=3645 0/0/0, cdp 170/170, cosmos-native and delivery-native exit 0 (bridge: no test files, skipped as before). The run before it was 169/170: `home-one-no-motion` failed 3 of 3 alone. Cause: the nightly scan landed at midnight during the run with one change, so the "since the last scan" banner appeared inside More on Home, and its pop-in is `el.animate()`, which the stylesheet's reduced-motion rule does not stop. Fixed in a148142: pop-in, slide-in, pulse, rise and the toast entry now ask one helper (the app's Reduce motion switch OR the system setting). That bug is from before this batch; the scenario had only ever run with no banner.
PRIVACY: scan of every added line since 5889e22 with the owner's names, mail, paths and token shapes: 0 hits. One test pattern that named the vault was removed (the name was already public in tracked files, so no history was rewritten). Nothing from data/ or docs/audits/ is in the range. Nine of the commits carry the fleet's own model line (Sonnet 5.5) instead of the Fable line; left as they are, no amend.
USE REPORT (quoted, counts only, 2026-11-17): "Last 7 days (2026-11-11 to 2026-11-17), 76 marks": brief-panel 12 opens, today-ribbon 8, delivery-card 7, cosmos 6, machine-drift 6, security 5, sessions-strip 5; act 0 and handover 0 on every surface; "never seen (22)" includes tasks-board, crew, crew-start, vault-desk, vault-desk-capture, brief-act, brief-history. Act counts before 2026-11-16 are not comparable with counts after (the counting fix).
REAL-DATA CHECKS (read-only, counts only): the Crew reads 656 installed skills across 11 roles from the real Claude home. The Vault desk on the real vault answers `no-folder`: the vault has no daily notes settings file and no folder with the app's own daily folder name, and no note named for today, so today's note is not shown and the capture line is off; the twelve recent names and Open in Obsidian work. This is owner question 1 of the plan, now with evidence (see OPEN).
OPEN: (1) Owner: the daily folder when the vault has no daily notes settings. Today: the app's own daily folder name, nothing created. The alternative is Obsidian's own default (the top of the vault). Either way the desk never makes today's note; the owner makes it in Obsidian first. (2) Owner: the 72 h hold and one-day gap reset; the warm red accent (a Settings switch, off unless chosen); the default light accent and the ember and tide palettes on the light base still sit at 3.9 to 4.2 under the dark button label (a brand-colour decision; the Workbench light look and the light red accent are fixed with a white label). (3) The "N NOTES" picture counts the recent list, which is capped at twelve, so it reads 12 on any vault with twelve or more notes; reword or count for real next batch. (4) A real clear under a still-live rule is undercounted on purpose (a swap is "changed"). (5) subjectRef is an unkeyed hash of guessable ids: the ledger file must stay on this machine; key it before it is ever snapshotted or sent. (6) A task or Journal idea marked Done and the window closed inside the Undo wait: the save lands, its act mark is lost (the count runs low, never high). (7) The cdp gate reads the owner's real scan history even with the fake preload, so a scan landing mid-run changes what Home shows; the fake should carry its own history. (8) Known timing flakes under full-gate load, each passing alone: popup-approval, social-claim, the hub snapshot op, the nightly-lock wait test, cheats-reduced-motion. (9) Stages 3 and 4 of the spec (stop banking XP, hide the XP surfaces) are not built.
IN-FLIGHT: none. The app was closed by the owner on 2026-11-16 and is restarted on this build with `tools\rollback.ps1 v5` after the push.
ASKS (structure lane): (a) `collector/assemble.mjs` rewrites today's daily note by read-then-write, so a Vault desk capture landing between its read and its write is lost; re-read just before writing. (b) the collector config still names a daily folder that the real vault does not have; decide with the owner's answer to OPEN 1 so both lanes look in the same place.
BREAKS: none. Contract changes are additive (CONTRACT "Batch 8 additions", IPC-CONTRACT rows for hq:crew:read, hq:crew:start, hq:vault-desk:read, hq:vault-desk:capture and the extra hq:brief-history:read fields).

---

## 2026-11-16 · FROM frontend (batch 8 last fixes) · main (not pushed) @ 32ac29d
DONE: the fe: commit 32ac29d plus this entry. Four defects from the read-only check of the taster-fixes commit, each fixed as asked and nothing else.
(1) Accent role split. --gold is both a fill (under the inline dark label #1a0f0a) and text (marks, tags, glyphs, the gold badge tone), and the taster fix lightened it for the fill and cost the text. Back to #3f6a8c (light Workbench look) and #b3261e (light red accent). A gold-filled control now gets a white label on those light bases from one CSS rule each: workbench.css (light Workbench look) and palettes.css (light red accent, not under the Console skin; it also covers the light red accent inside the Workbench look). No template changed. The style attribute Chromium writes for a runtime-set inline style reads "background: var(--gold);" (property, colon, one space, value, semicolon), read off the real Crew Start button on a throwaway instance; the selector ends in the semicolon so a --gold-2 fill is never matched. MEASURED contrast: white on #3f6a8c 5.75, white on #b3261e 6.54, dark label on the dark Workbench gold 8.26; --gold as text on the light Workbench field 4.52 (--bg) and 5.08 (--card), on the plain light field with the red accent 5.00 and 5.54; the dark Workbench gold as text 7.41 and 6.44, so the old --gold exemption in the text test is gone for both bases. The screen-stroke floor is back to 3 on both bases (light 3.93). COMPUTED in a live page (workbench-art scenario, six combinations): dark + Workbench label rgb(26, 15, 10); light + Workbench label rgb(255, 255, 255) on rgb(63, 106, 140); light + Workbench + red accent white on rgb(179, 38, 30); light + red accent without the look white on rgb(179, 38, 30); light plain label stays rgb(26, 15, 10) on rgb(181, 88, 58); dark + Workbench + red accent label stays dark on rgb(224, 88, 74). Every gold-filled element's fill still equals the --gold token (the progress fills and dots have no text and are unchanged). palettes.test.mjs now sets the label rule apart from the token rules and allows it as the only !important in that file (a deliberate change to the "nothing moves" test). The ember and tide light-base label list stays as it was.
(2) Ledger repair wait: a pending clear with no readable heldUntil is repaired to the later of its end and the load time, plus 72 h (cleanLedger, the load time is the now that is passed in); comment fixed; one existing test now expects the load time; new test: ended 120 h before load, no obsAt, one observe an hour later stays pending, none counted held.
(3) Cleared picture: workbenchNumbers uses !S.bhsErr (the old !D.error was dead). New test: a good read then a failed read gives cleared null and no picture. No vals golden moved (renderer gate green, no re-record).
(4) The cdp-brief-history test pattern lost its one personal-name alternative on both lines.
CHECKS: styles tests 41/0; brief-ledger tests 77/0; renderer 1908/0 (1 skip) and tools 279/0 (1 skip) from node tools/gates.mjs --only renderer,tools; cdp on a throwaway instance (own profile and port, stopped after): workbench-skin, workbench-art, workbench-reduced-motion, workbench-leave, crew-render, vault-desk-read 6/6. The full gate is the integrator's.
OPEN: A task or Journal idea marked Done and then the window closed inside the Undo wait: the save lands but its act mark is lost. Accepted: the count runs low rather than count a save that was never confirmed. Also still open from the entry below: the default light accent, ember and tide on the light base sit at 3.9 to 4.2 under the dark label (owner brand-colour decision).
IN-FLIGHT: none. ASKS: none. BREAKS: none.

---

## 2026-11-16 · FROM frontend (batch 8 taster fixes) · main (not pushed)
DONE: the fe: commit of this block plus this entry. Each taster finding was checked against the code first; every one was real; OPEN lists what was narrowed or deferred.
(1) Crew (dashboard/crew.js): a skills folder (loose or a plugin's) whose real path leaves the Claude home is not read, a SKILL.md that is a link or not a plain file is skipped (lstat, then fstat on the opened handle); a launch that fails no longer spends the hourly count or the same-skill wait. (2) Vault desk capture (dashboard/vault-desk.js): after the append-only open the file is checked again (same file as the lstat, one name only, real path still inside the vault) and O_NOFOLLOW is used where the platform has it; the existing text is read only after that. (3) Capture line (vault-desk-core.mjs): a code fence (three or more backticks or tildes) and an HTML comment opener are broken with a backslash so a pasted snippet cannot swallow later lines. (4) Brief ledger (brief-ledger.mjs): a row that leaves while its rule is still live is now always "changed", never a clear or a hold (the Brief shows only a rule's worst subject, so a swap can be an overtake, not a fix); a pending clear with no readable wait gets ended + 72 h and never turns held on the next look; "held" is counted among clears that ended this week and the headline uses the same one-per-subject basis as the breakdown; the subjectRef comment and CONTRACT line no longer say "one-way" (it is a plain hash of guessable ids: the file stays on this machine). (5) Act marks: Task Done and the Journal's idea Done mark (tasks-board, act) only after the save came back true (not on an error, not on "already done"); tests cover failure and already-done. The act-marks allowlist test now drives crwStart and vdkCapture with sentinel words and checks the marks are exactly (surface, action). (6) Brief strip: "N held" now reads "N still gone after 72 hours" (the explanation no longer hides in a tooltip); the clean card's "Board clean since" uses only real clears (resolved or acted, not came back). (7) Crew Start buttons carry aria-label (which skill); the Vault desk note box is focusable (tabindex 0, region, name) and an empty note says so; the Workbench pictures are drawn only when their number was really read (each picture has its own show flag; no false "0 SKILLS" while loading or on error); one skill, note or project reads singular (on screen and spoken). (8) Light contrast: Workbench light --gold #3f6a8c to #5a8ab0 and the light signal --gold #b3261e to #d9544a so the dark button label reads at 4.5 (it was 3.27 and 2.88); tests for the label on every base (dark, light, Console, Workbench) added in styles/workbench.test.mjs and styles/palettes.test.mjs; the Workbench light art strokes on the screen are held to 2.5 (decoration, the readout text is held to 4.5).
GOLDENS: golden-diff before (git archive of HEAD) and after, exit 0 with every changed path attributed: vdkv.emptyNote, vdkv.emptyNoteText and wbnv.<kind>.show on every scenario (new keys), nothing else; vals.hashes.json re-recorded once. tpl.hash re-recorded once: +349 chars / +351 bytes (tpl/crew.tpl.js, tpl/vault-desk.tpl.js, tpl/workbench.tpl.js only; nothing removed).
GATES: full node tools/gates.mjs --native green, exit 0: main 1884/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1907/0 (1 skip), tools 279/0 (1 skip), selftest combos=3645 0/0/0, cdp 170/170, cosmos-native and delivery-native exit 0 (bridge: no test files, skipped as before).
OPEN: (a) the default light accent (#b5583a) and the ember and tide palettes on the light base still sit at 3.9 to 4.2 under the dark button label; that is a brand-colour decision for the owner (the new label test lists those two as known and open). (b) Not changed on purpose: a rule that really clears while a second subject of the same rule is still live now never counts as cleared (undercount over a false "stayed gone"; the spec line "a different subject means the first is gone" is superseded, test pinned). (c) subjectRef still has no per-install secret; if the ledger is ever snapshotted or sent off the machine, key it first.
IN-FLIGHT: none. ASKS: none. BREAKS: none.

---

## 2026-11-16 · FROM frontend (batch 8 dish 4 integrator pass: the Workbench look) · main (not pushed)
DONE: integrator pass on the Workbench look. Plan gap check: files, pref, stylesheet, art, vals key wbnv, selftest rows, cdp scenarios, version stamp and docs all match the dish section; no gap found. No IPC channel changed, so no CONTRACT or IPC-CONTRACT entry is owed. Full gate green: main 1877/0, hub 205/0, money 261/0, cosmos 473/0, renderer 1896/0 (1 skip), tools 279/0 (1 skip), selftest combos=3645 0/0/0, cdp 170/170.
GOLDENS: attribution is the cook's (wbnv, the stamp lines vcdv.vcdStamp and vcdv.vcdLabel, tpl.hash growth); nothing else changed and no golden was touched in this pass.
OPEN: none from this dish. Owner question 3 (is the warm red accent wanted) stays open; it ships as a Settings switch, off unless chosen.

## 2026-11-16 · FROM frontend (batch 8 dish 4 DONE: the Workbench look) · main (not pushed)
DONE: the fe: commits of this dish plus the docs commit. A second look in the Console layer, "Workbench", chosen from the Appearance chips next to Console (only while the layer is on): flat vectors, 1.5 px outlines with round joins, 6 px corners on cards, buttons and inputs, uppercase monospace readouts, a warm field (dark and light) and a muted steel-blue accent. A warm red accent is a switch row in Settings, "Warm red accent". Five original SVG pictures with a small screen each, drawn only while the look is on: "N CLEARED" on the clean-board card, "N SKILLS" on the Crew header, "N NOTES" on the Vault desk header, "0 NEED YOU" on the empty Brief line, "N PROJECTS" on the empty Projects shelf line. No other readout exists. BUILD_STAMP is now 2026-11-16.batch8 (the version card shows once for it, only with the layer on).
(1) logic/console-layer.mjs: one new additive pref field `look` ('' or 'workbench'), mutually exclusive with `skin` (a stored pair keeps the skin, so legacy skin:true still means Console; withConsoleLayer turns the other off); consoleEffective drops scanlines under the look and makes the cheat palettes (ember, tide) inert under it; the red palette id is `signal`. `skin` stays the Console-only boolean, so vals/console-skin.js cslSkin, cheats-host.js, cheats.mjs and every [data-hq-skin="console"] rule keep their meaning. (2) logic/console-skin.js: cslSync adds the look's one stylesheet through layerSheet('workbench') only while the look is chosen (before the palettes' sheet), cslLeaveSkin now clears the look too (so the shell Light/dark button, the palette's Toggle light / dark and the Ctrl K theme verb all leave it, and the red accent choice is kept), plus cslChooseLook and cslToggleSignal. (3) styles/workbench.css (new; two token blocks, dark then light, every token of the base blocks; one motion, the screen cursor, inside the no-preference block and :root:not([data-hq-reduce])), styles/palettes.css gains signal (dark, light, Console, and the two Workbench bases). (4) logic/workbench-art.mjs (pure: four primitives, hand-written coordinates, token colours only, the five readout builders), vals/workbench.js (ONE vals key wbnv: root attribute, on flag, five bound pictures, one frozen constant while off), tpl/workbench.tpl.js (a generator, wrapped in sc-if wbnv.wbnOn, picture hidden from a screen reader and the wrapper named once), and the shell root's data-hq-look binding. renderVals 987 to 988 top-level keys.
NUMBERS: cleared this week from the Brief history read (0 until read), skills from the Crew roster, notes from the Vault desk's recent list, 0 for the empty Brief, projects in the list (the total, so a search with no match reads the real count).
CHOICES: no CONTRACT.md or IPC-CONTRACT entry (no channel, no data/ shape; the renderer pref is renderer-only). No act mark and no use-log change (a Settings choice is never an act). The red accent is a switch row, not a ninth cheat code (the pinned count of 8 is untouched). src/logic/version-card.mjs was not touched: the card's words and timing are unchanged, only the stamp it shows moved.
GOLDENS: golden-diff before (a git archive of HEAD) and after, 161 scenarios, exit 0 with every changed path attributed: wbnv (a new key) and vcdv.vcdStamp / vcdv.vcdLabel (BUILD_STAMP). vals.hashes.json re-recorded once. tpl.hash re-recorded once: +4818 chars / +4818 bytes = the five fragments (949 + 939 + 929 + 949 + 959), the shell root attribute (34) and 59 chars of line breaks; no line removed. build-stamp.test: this entry names the stamp 2026-11-16.batch8.
TESTS: node --test dashboard-v5/src/logic/{workbench-art,console-layer,version-card,shelf,cheats}.test.mjs dashboard-v5/styles/*.test.mjs 283 pass 0 fail. node tools/gates.mjs --only renderer,tools: renderer 1896 pass 0 fail 1 skip, tools 279/0/1. --only selftest: combos=3645 0/0/0 (3625 + ten Workbench rows x two themes). cdp on a throwaway instance: workbench-skin, workbench-art, workbench-reduced-motion, workbench-leave plus console-off-zero-cost, console-on-skin, console-toggle-leaves-skin, console-scanlines, console-reduced-motion, cheats-off-zero-cost, shelf-render, crew-render, vault-desk-read, fake-parity pass (14/14). The full cdp run and the full gate are the integrator's. New: src/logic/workbench-art.test.mjs (art, vals, template, hosts, art IP word list), styles/workbench.test.mjs (tokens, AA contrast, flat rules, the one motion block), tools/cdp-workbench.test.mjs, src/selftest-workbench.mjs, cdp scenarios workbench-skin, workbench-art (also checks the shapes are in the SVG namespace and have a size), workbench-reduced-motion, workbench-leave. Touched tests: console-layer.test (defaults, chips, rows, the look tests), palettes.test (signal), palette-theme.test (the Ctrl K verb and toggleTheme leave the look), shelf.test and the two brief-history fragment tests (they cut the Workbench art out of the fragment they check), tpl.hash.test, cdp-console (LAYER_OFF carries look).
DEVIATIONS: (a) vals/console-skin.js and logic/console-skin.js ARE edited (the plan lists the cslSkin files as not edited; they are where the Appearance chips and Settings rows live, and the look needed its chip and the red switch there; cslSkin itself and its meaning are unchanged). (b) The red accent is a switch row (Settings, shown whenever the layer is on), not a chip, and the chooser values are not under wbnv; wbnv holds the root attribute and the pictures. (c) selftest rows live in the new src/selftest-workbench.mjs, selftest-console.mjs is untouched. (d) src/logic/version-card.mjs is untouched (only the stamp it shows moved). (e) The art screens are square; the 6 px corners are on the app's cards, buttons and inputs. (f) N NOTES is the length of the Vault desk's recent list, so it tops out at 12 (no IPC change is allowed in this dish). (g) Typing the ember or tide code while the look is chosen still toasts the accent on, but the palette is inert under the look (the red one is the only accent the look carries). (h) CLAUDE.md: the Batch 8 line was edited (the Workbench look added and the stamp named) because build-stamp.test needs the record to name 2026-11-16.batch8. (i) The commit trailer uses the session's attribution line; the task text asked for a different model name.
IN-FLIGHT: none. ASKS: none. BREAKS: none. The integrator still owes the full gate and the batch-done checklist.

---

## 2026-11-16 · FROM frontend (batch 8 dish 3 gate record: the Vault desk) · main (not pushed)
DONE: integrator pass on the Vault desk (63327d5, 8490741, e6922a4, 0b68925). Plan gap check against the dish section: new and touched files, vault rule (HQ_VAULT_DIR only, no fallback), path safety, capture rules, IPC, vals key vdkv, tests and the four cdp scenarios all match; no gap found. The only plan item not built is tools/vault-desk-fixture-paste.mjs (the fake vault is a fixed block, nothing to drift). Added the Vault desk to the Batch 8 line in CLAUDE.md.
GOLDENS: none moved by the integrator. The cook re-baselined once, attributed: vals.hashes.json every changed path vdkv (161 scenarios), tpl.hash +5898 chars = tpl/vault-desk.tpl.js only.
GATES: full node tools/gates.mjs green on the first run, exit 0, no flake seen. main 1877 pass 0 fail, hub 205/0, money 261/0, cosmos 473/0, renderer 1843/0 (1 skip), tools 279/0 (1 skip), selftest 3625 combos 0/0/0, cdp 166/166.
OPEN: none for this dish. ASKS (structure lane, repeated from the entry below): collector/assemble.mjs rewrites today's daily note by read-then-write, so a capture landing between its read and its write is lost; please re-read (or compare mtime and size) just before the write and redo the replace if it changed. BREAKS: none.

## 2026-11-16 · FROM frontend (batch 8 dish 3 DONE: the Vault desk) · main (not pushed)
DONE: 63327d5, 8490741, e6922a4 plus the docs commit. In Life > Notes, above the vault cards: a Vault desk card with today's daily note as plain text (secrets masked on read, 20 KB cap), one capture line (Enter or Add appends it to the note), the twelve most recent notes by name only, and Open in Obsidian. No graph, no markdown rendering, no creating notes or folders. (1) dashboard/vault-desk-core.mjs (pure: date tokens, untrusted daily-notes settings parse, path checks built on claude-vault.js safeSegment, line normalizer, append planner, recent sorter) and dashboard/vault-desk.js (IO). hq:vault-desk:read and hq:vault-desk:capture: main window only, fixed words, never a message or a path. HQ_VAULT_DIR set means it is the only vault (a missing folder says "vault not found", no fallback). The daily folder and format come from .obsidian/daily-notes.json as untrusted input; unsafe values are ignored and the card says so and says which folder it looked in. A capture opens the note append-only WITHOUT create, refuses a symlink or junction as the note, requires the note's folder to resolve inside the vault's real path, is one "- " line (control characters collapsed, 1,000 characters at most, wq: and "wq :" broken to "wq :", "%%" broken, a leading [ > - or * escaped), adds a "Captured" heading only when the last heading is not Captured, 30 an hour, one at a time. (2) Renderer: logic/vault-desk-view.mjs, logic/vault-desk.js, vals/vault-desk.js, tpl/vault-desk.tpl.js; every value under ONE vals key vdkv (renderVals 986 to 987). Marks: 'vault-desk' (open, once per arrival) and 'vault-desk-capture' (act, one per line main says was added). Open in Obsidian reuses hq.vaultOpen and shows only when the scan lists the vault (main sends canOpen).
ASKS (structure lane): collector/assemble.mjs rewrites today's daily note with a plain read, then write (the block replace near the end of the file). A capture that lands between that read and that write is lost. Please re-read the file (or compare its mtime and size) just before the write and redo the replace if it changed. Until then dashboard/vault-desk.test.mjs pins that the block replace itself keeps a line captured earlier. The capture is always below the "%% workspacehq:end %%" line, so the replace never touches it.
CHOICES: no CONTRACT.md entry (no data/ shape changed); IPC-CONTRACT has the section "The Vault desk". Recent notes come from the whole vault (dot folders skipped, links not followed, 4,000 files at most), not only the daily folder. The planner also breaks "%%" in a capture (not in the plan text) because an inline "%% workspacehq:end %%" could otherwise confuse the block replace. A line over 1,000 characters is refused, not cut, so the text stays verbatim.
GOLDENS: golden-diff before and after, 161 scenarios, exit 0 with every changed path vdkv and nothing else; vals.hashes.json re-recorded once. tpl.hash re-recorded once: +5898 chars / +5911 bytes, exactly tpl/vault-desk.tpl.js, interpolated into tpl/life.tpl.js. Selftest 3601 to 3625 combos (twelve states by two themes), 0/0/0.
TESTS: node --test dashboard/vault-desk-core.test.mjs dashboard/vault-desk.test.mjs 30 pass 0 fail (core 8, main 22: missing note, no trailing newline, settings with ../x and a:b, missing parent folder, a junction as the note and as the daily folder, a 5,000 character line, planted secret masked on read, HQ_VAULT_DIR missing with no fallback, "[x] done wq:id" through tickedIds returns no ids, foreign sender refused, 30 an hour, the re-entrancy lock, the block replace keeping a captured line, a failing file system giving only fixed words; each test compares a sentinel folder next to the temp vault before and after). dashboard-v5/src/logic/vault-desk.test.mjs 10 pass; dashboard-v5/tools/cdp-vault-desk.test.mjs 4 pass; use-log, use-counts, cast-modes, quick-targets-parity tests 56 pass (use-log's allowlist test lists the two new surfaces). node tools/gates.mjs --only renderer,tools: renderer 1843 pass 0 fail 1 skip, tools 279/0/1; --only selftest: combos=3625 0/0/0. cdp on a throwaway instance: vault-desk-read, vault-desk-capture, vault-desk-missing-note, vault-desk-open, crew-render, use-act-marks, fake-parity, clients-list-open pass (8/8). The full cdp run is the integrator's.
DEVIATIONS: tools/vault-desk-fixture-paste.mjs was not written: the fake vault is a small fixed block written straight into dashboard-v5/tools/fake-preload.js (no generated size, so nothing to keep in sync, and no drift test needed). No src/live/vault-desk* file: the desk reads on arrival from logic/vault-desk.js, as the Crew does. cast-modes.js was not touched (dish 2 owns it this batch), so Ctrl+Alt+X Jump does not yet list the Vault desk as its own target; the open mark still counts. Files outside the plan's touch list: app.js, vals/index.js, selftest.js, cdp-gate.mjs, the two golden files, use-log.test.mjs.
IN-FLIGHT: none. BREAKS: none. The integrator still owes the full gate (--native for the new IPC is not needed: main-side code is covered by the temp-vault tests) and the batch-done checklist.

---

## 2026-11-16 · FROM frontend (batch 8 dish 2 gate record: the Crew) · main (not pushed)
DONE: integrator pass on the Crew (d868953, 989ee66, 86e6466, 8e6eb28). Plan gap check: new and touched files, the role table, id and sender rules, rate limit, launch-tools refusal, tests named in the dish section, the cdp scenarios, IPC-CONTRACT rows and the HANDOFF entry all match; no gap found. Added the one-line Batch 8 note to CLAUDE.md (it names what has landed; the Vault desk and Workbench look are still to come).
GOLDENS: none moved by the integrator. The cook re-baselined once, attributed: crwv on every scenario, subTabs[3] on the Claude scenarios, one added scenario tab.claude.crew (160 to 161); nothing on Home.
GATES: full node tools/gates.mjs green on the first run, exit 0, no flake seen. main 1847 pass 0 fail, hub 205/0, money 261/0, cosmos 473/0, renderer 1829/0 (1 skip), tools 279/0 (1 skip), selftest combos=3601 0/0/0, cdp 162/162.
OPEN: none for this dish. ASKS: none. BREAKS: none.

---

## 2026-11-16 · FROM frontend (batch 8 dish 2 DONE: the Crew) · main (not pushed)
DONE: d868953, 989ee66, 86e6466 plus the docs commit. A Crew view beside Sessions in the Claude space: the installed Claude skills (loose ones and each installed plugin's) grouped by role (developers, designers, marketing, finance, legal, operations, sales, people, data, product, other), each with its folder name, a plain-text description cut at 140 characters and a Start button that opens a terminal session beginning "Use the <id> skill to help me with:". Search over name, plugin, description and role; 12 rows a role with "Show N more"; 60 matches a page while searching. (1) dashboard/crew-core.mjs (pure: frontmatter head read, role table from public plugin names then name stems then description stems, the one id shape, the fixed prompt) and dashboard/crew.js (IO; reads the Claude home READ-ONLY, refuses an install path whose path or real path is outside the home, 2 KB per SKILL.md, mtime-keyed cache). hq:crew:read and hq:crew:start: main window only, fixed words, no body, path or frontmatter name ever leaves main. The id is the folder name (plugin skills: plugin:folder), must be in main's own roster, the folder the session opens in is a constant (the app root), 6 starts an hour, the same id not twice in 5 seconds. (2) The session ALWAYS goes through launch-tools (--permission-mode default on the argv); if its helper file is missing crew.js refuses to start instead of letting claude-launch.js fall back to the helper with no mode. (3) Renderer: logic/crew-view.mjs, logic/crew.js, vals/crew.js, tpl/crew.tpl.js; every value under ONE vals key crwv (renderVals 985 to 986). Marks: surface crew (open, once per arrival) and crew-start (act, only for a launched session, once a minute per skill). Crew is in catalog SUBS, cast-modes SUBS and SURFACE_TARGETS (crew to claude/crew; crew-start absent on purpose), so Ctrl+Alt+X Jump finds Claude > Crew.
CHOICES: no CONTRACT.md entry (no data/ shape changed); IPC-CONTRACT has the two channel rows. The roster carries the role table to the renderer (read answers roles too), so the renderer holds no copy of it and no parity test is needed. A description that says "ignore the above..." is shown as plain text and never reaches a prompt (tested on the dry launch line and the argv). The role table uses public marketplace plugin names only; the first real read of the owner's own skills is the real check of the role stems (a skill that lands in Other can be fixed by adding a stem, nothing else moves).
GOLDENS: golden-diff before and after, 161 scenarios, exit 0 with every changed path attributed: crwv on every scenario (a new key), subTabs[3] on the Claude scenarios (the new sub-tab), one added scenario tab.claude.crew. vals.hashes.json re-recorded once. tpl.hash re-recorded once: +9724 chars / +9733 bytes, exactly tpl/crew.tpl.js, interpolated into tpl/claude.tpl.js. Selftest 3503 to 3601 combos, 0/0/0.
TESTS: node --test dashboard/crew-core.test.mjs dashboard/crew.test.mjs dashboard/quick-targets-parity.test.mjs 37 pass 0 fail (crew-core 10, crew 21: frozen role table, odd frontmatter, outside-home and real-path refusal, dash-leading id, hostile description, foreign sender, rate limit, helper-missing refusal, --permission-mode default asserted on the argv and the dry line; fake home built by dashboard/__fixtures__/make-fake-claude-home.mjs with invented names only, 600 generated skills); use-log, use-counts, cast-modes tests updated for the new surfaces and target; dashboard-v5 logic/crew.test.mjs 13 pass, tools/crew-fixture-paste.test.mjs and cdp-crew.test.mjs pass. cdp on a throwaway instance: crew-render, crew-start, crew-search, fake-parity, sessions-board-render, use-act-marks, use-act-effect, clients-list-open pass.
DEVIATIONS: crew-fixture-paste lives in dashboard-v5/tools beside its siblings (so its drift test runs in the renderer gate step), not tools/. The cdp crew-start scenario runs against the fake preload, so it pins the call, the toast and the one act mark; the real dry launch line and argv are pinned in dashboard/crew.test.mjs where main's own code runs. Files outside the plan's touch list: app.js, vals/index.js, live/catalog.mjs, selftest.js, cdp-gate.mjs, the two golden files, use-counts.test.mjs.
IN-FLIGHT: none. ASKS: none. BREAKS: none. The integrator still owes the full gate, the one-line CLAUDE.md "Batch 8" note and the rest of the batch-done checklist.

---

## 2026-11-16 · FROM frontend (batch 8 dish 1c DONE: strip and clean card) · main (not pushed)
DONE: b9c07ac, b646948, ab29c43. (1) A strip of plain counts on the Brief panel (Home), replacing the old "N cleared, M dismissed" footer once main sends the batch 8 counts: cleared this week and how many are held (week one reads "0 held"), the kinds of clear, the oldest open row (since the app first noticed it), set aside with the oldest age, and a "waiting on something outside the app" line. The same strip sits at the top of History > Timeline with the set-aside rows and their age, and the History rows now say how each clear was labelled and where its 72 hour hold stands (a dismissal says set aside, never cleared). (2) A clean-board card on Home: "Board clean since X" only when open, outside and set-aside rows are all zero; otherwise "Nothing new needs you, N set aside", naming the high-severity set-aside rows. It has no button, never shows beside the one-time all-clear card, and a rule that never steps aside (secrets, a plain password export, a vault conflict) can never make the clean line. (3) A read-only "Brief history · plain counts" block in Settings. No total, no score, no comparison with a past week anywhere. (4) The extra from the counting fix: a Brief row Go or Scan button now sends no act mark, only the plain open mark; unit test and cdp use-act-marks updated.
CHOICES: an older main that sends no counts keeps the old footer line (no strip, Settings says the counts need the newer app). The set-aside "Board clean" test counts outside rows too, because a board with something waiting on the outside is not clean. "Board clean since" uses the latest non-dismissed close in the 14 day entries; with none it reads "Board clean". No new channel and no CONTRACT or IPC-CONTRACT change (the fields were announced by the ledger core). All values nest under the existing bhs vals key (renderVals count unchanged).
GOLDENS: golden-diff before and after, 160 scenarios, exit 0, every changed path under bhs.* and nothing else (no home.*, no timeline recap path moved); vals.hashes.json re-recorded once. tpl.hash re-recorded once: +4789 chars / +4797 bytes, all in tpl/brief-history.tpl.js plus one interpolation in ov-settings.tpl.js. Selftest 3485 to 3503 combos (nine new rows by two themes), 0/0/0.
TESTS: node --test dashboard-v5/src/logic/brief-history.test.mjs (now also runs brief-history-strip.test.mjs) 30 pass 0 fail; act-marks and cdp-act-marks tests 25 pass; cdp-brief-history tests 9 pass; node tools/gates.mjs --only renderer,tools: renderer 1805 pass 0 fail 1 skip, tools 279 pass 0 fail 1 skip; --only selftest: combos 3503, 0/0/0. cdp: brief-history-render, -all-clear, -strip, -clean-card, -settings, use-act-marks and use-act-effect pass on a throwaway instance.
GATE RECORD: full node tools/gates.mjs green, exit 0, no flake seen on this run. main 1816 pass 0 fail, hub 205/0, money 261/0, cosmos 473/0, renderer 1805/0 (1 skip), tools 279/0 (1 skip), selftest combos=3503 0/0/0, cdp 159/159 (cheats-reduced-motion passed; the one failure the cook saw under load did not repeat).
IN-FLIGHT: none. ASKS: none. BREAKS: none. The fake preload default briefHistory.read now carries zero counts, so Home in the fake shows the strip ("0 cleared this week · 0 held") and the clean card.

---

## 2026-11-16 · FROM frontend (batch 8 dish 1a gate record) · main (not pushed)
DONE: integrator pass on the ledger core (e2ab256, 125a207, 38002ac). Plan gap check: files, leak tests, CONTRACT and IPC-CONTRACT entries and the HANDOFF note match the dish section; no gap found.
GOLDENS: none moved, none re-baselined (no template, vals key or renderer file changed).
GATES: full node tools/gates.mjs green on the first run, exit 0. main 1816 pass 0 fail, hub 205/0, money 261/0, cosmos 473/0, renderer 1779/0 (1 skip), tools 279/0 (1 skip), selftest combos=3485 0/0/0, cdp 156/156. No flake seen.
OPEN: the strip and clean card are dish 1c; a marked-done quest is never held until the structure lane's quest fact-state ask lands.

---

## 2026-11-16 · FROM frontend (batch 8 dish 1a DONE: ledger core) · main (not pushed)
DONE: the Brief ledger can now tell a clear from a change, a hold from a gap, and a set-aside row from a fixed one (CONTRACT "Batch 8 additions to data/brief-ledger.json" and IPC-CONTRACT, additive). (1) brief-core rows carry an in-memory `subject` (project, bill, quest or account id; '' for a rule about nothing in particular), set where each key is built, never parsed from it; brief.js strips it before data/brief.json and gives the ledger a key to subject map; `hq_brief` drops it too. Tests pin that the file, hq_brief, the tray and badge projection and the phone file never carry it. (2) brief-ledger.mjs: `subjectRef` (one-way hash of rule and subject; the subject is never stored), per-subject closure (same rule, different subject = the first is gone), clear labels (in-place, marked-done, scan-confirmed, unknown), a 72 h hold in observation time with a one-day gap reset and came-back, set-aside on dismissal, age carried across a value change, `obsAt`. (3) summarize() adds counts only: clears by label, heldThisWeek, pendingNow, cameBackThisWeek, openCount, oldestOpen, outside, setAside; no total, no score. `how` keeps its five values and HOWS is unchanged: the new words ride in separate fields (label, hold, setAside), so no renderer changes. The strip and clean card are dish 1c.
CHOICES THE NEXT DISH SHOULD KNOW: a file or caller with no subjects behaves exactly as before (no label, no hold), so legacy closes are counted in clearedThisWeek but in no label. A marked-done quest and a senses-sourced clear are never held (the first needs the structure ask that makes quests carry their fact state; the second cannot be seen from the ledger). A rule shows only its top subject, so a worse subject overtaking a still-true one reads as a clear: the hold and came-back are the guard, and the first real week will show how often it happens. Not done here: no cdp or selftest scenario and no vals key, because this dish has no renderer surface (the strip is 1c); fake-preload's briefHistory.read fields are 1c's.
TESTS: node --test dashboard/brief-ledger.test.mjs dashboard/brief-ledger.main.test.mjs dashboard/brief-project.test.mjs mcp/workspacehq/server.test.mjs: 122 pass, 0 fail (new: 24 engine tests, 2 file tests, projection, phone file, hq_brief and brief.js leak tests, subject on brief-core rows). All dashboard/brief*.test.mjs, tray-brief, intent, renderer brief logic and mcp tests: 590 pass. tools/*.test.mjs 102 pass. One existing assertion was widened on purpose: brief-ledger.main.test.mjs "read: nothing yet" now lists the new empty counts.
IN-FLIGHT: none. ASKS: none for the structure lane now (stage 3's "quests carry fact state" stays a later ask). BREAKS: none; no golden, template or vals key moved.

---

## 2026-11-16 · FROM frontend (batch 8 dish 1b gate record) · main (not pushed)
DONE: integrator pass on the counting fix (ef27d38, 763be5a). Plan gap check: files, tests and the HANDOFF note match the dish section; no CONTRACT or IPC-CONTRACT entry is named for this dish and none changed (no channel or data shape moved). The Brief row go and scan buttons still send brief-panel/act, as the cook flagged: kept, the spec says scan and view count nothing, so dropping them is an owner call.
GOLDENS: none moved, none re-baselined (no template or vals key changed).
GATES (node tools/gates.mjs): main 1785, hub 204/1 then 205/0, money 261, cosmos 473, renderer 1779 (1 skip), tools 278 (1 skip), selftest 3485 combos 0/0/0, cdp 156/156. The one hub failure was the snapshot op test: it passed alone and the whole hub suite passed on a re-run, so a load timing flake.
GATE RE-RUN (second full node tools/gates.mjs, same code, nothing changed): hub 205 pass 0 fail (the earlier snapshot-op failure did not return; the hub suite passed 4 more times in a row), money 261, cosmos 473, renderer 1779 (1 skip), tools 278 (1 skip), selftest 3485 combos 0/0/0, cdp 156/156. main failed once at 1784 pass 1 fail: popup-approval "an answer that cannot prove it holds the token". That test is in the browser-bridge popup and this dish touched nothing near it (no file under dashboard/popup*, browser-bridge/). It passed 3 of 3 alone and the whole main suite then passed 1785/0 standalone. Counted as a load timing flake, not this dish. Every other step passed, so the gate counts green.
IN-FLIGHT: none. ASKS: none. BREAKS: none.

---

## 2026-11-16 · FROM frontend (batch 8 dish 1b DONE: counting fix) · main @ (see commits, not pushed)
DONE: ACT COUNTING CHANGED, so do not compare act numbers before and after this commit in `node tools/use-report.mjs` (the report now says so). (1) Dismiss on a Brief row no longer sends an act mark (it sets a row aside). (2) Mark done and Confirm balance on a Brief row (the verbs with `marks` true) send one (brief-act, act); Open its folder sends nothing; Commit sends one (brief-act, handover), a new action, and the commit overlay opens as before. (3) A task Done sends one (tasks-board, act) when the deferred write goes out (Undo inside the window sends none). (4) Anti-farming: an identical click inside a minute adds no mark (`useActOnce`, the ref stays in the window and is never sent). The Brief row go and scan buttons still send (brief-panel, act): the plan did not list them. use-log allowlist gains surface `tasks-board` and action `handover`; use-report gains a handover column. renderer VERB_MARKS has a parity test against brief-act-core VERBS.
TESTS: use-log, act-marks, use-report, cdp-act-marks (node), cdp use-act-marks (changed) and new use-act-effect passed on a throwaway instance. No template, vals key or golden moved.
IN-FLIGHT: none. ASKS: none. BREAKS: none.

---

## 2026-11-15 · FROM frontend (batch 7 taster fixes) · main @ 28efc09 (not pushed)
DONE: 28efc09 (fe). Two taster findings, both real, both fixed with a test that failed first. (1) Ctrl K "theme dark|light|os" set themePref directly and never left the Console skin; it now calls cslChooseBase (logic/palette.js), so every base-theme entry point (palette verb, Appearance chips, toggleTheme) clears the skin. Test: vals/palette-theme.test.mjs. (2) The legacy cheat matcher kept its tail after a hit and the 14-character ArrowUp needle re-fired on every later ArrowUp, so a held ArrowUp made Bit dance on every repeat. A hit now clears the tail (logic/cheats.mjs) and cheatKey ignores auto-repeat (logic/cheats-host.js); two new tests in cheats.test.mjs and one assertion adjusted for the cleared tail. Owner-visible: ArrowUp pressed twice still fires dance, every second press, never on a held key. No template, vals key or golden moved.
GATES: main 2721/0, money 261/0, renderer 1770 (1769 pass, 1 skip, 0 fail), selftest 3485 combos 0/0/0, cdp 155/155 on a re-run; the first full run was 154/155 with the failing scenario name lost to the output tail (only the last ten lines were kept), and the re-run on a fresh instance was clean, so it is recorded as an unattributed flake, not a fix.
IN-FLIGHT: none. ASKS: none. BREAKS: none.

---

## 2026-11-15 · FROM frontend (BATCH 7 DONE: One Home, less app and the Console layer, all eight dishes) · main @ 1f5f74c (not pushed)
DONE: 2c34890..1f5f74c. (1) Home as one decision (2c34890 5d83bb2). (2) the subtraction pass (76f0847 b28ab05 066b81f): the fold mechanism ships DORMANT, six dead store methods deleted, README and CLAUDE.md open with the thesis. (3) the Console layer master switch and Console skin (f7f2b51). (4) the cartridge shelf in Projects (192f6f1). (5) the Memory card (34bed7e 93a9fa4). (6) cheat codes registry (3c4532c). (7) the New version inserted card (5ba7c51). (8) small delights (1f5f74c). Everything beyond (1) and (2) is OFF until Settings > Console layer is switched on; with it off the probe reads zeros (no link, listener, timer, frame) and none of the Console DOM exists.
  USE REPORT (node tools/use-report.mjs, run 2026-11-15; 27 day logs, 2026-10-15 to 2026-11-15; counts only): last 7 days 74 marks, brief-panel 10, today-ribbon 8, delivery-card 7, cosmos 6, machine-drift 6, security 5, sessions-strip 5, space-projects 4, space-tasks 4, clients-list 3, space-life 3, space-system 3. Last 14 days 84 marks. Never seen (17): sessions-board, money-start, money-quick, palette-money-line, reach, delivery-check, brief-act, quick-jump, money-access, brief-history, security-refresh, claude-vault, security-recycle, home-more, projects-archived, system-hub-panel, automations-library (the last four are new marks; unmeasured, not zero). act = 0 everywhere: nothing has been acted on in place yet.
  GOLDEN VERDICTS (golden-diff.mjs, 160 scenarios each, exit 0, nothing removed): dish 1 '^home[.]' (five home paths); dish 2 no move at all; dish 3 '^cslv' + settings[4]; dish 4 '^shfv'; dish 5 '^mcdv'; dish 6 '^chtv'; dish 7 '^vcdv'; dish 8 '^dlxv' + the one handler mcdv.mcdEmptyOpen. tpl.hash moved once per dish that touched a template, never without its attribution.
  renderVals: 979 -> 985 of 1015 (cslv shfv mcdv chtv vcdv dlxv, one each; the batch ceiling was 990).
  CODES (8, found-list names in brackets; the found list shows names only, never a sequence): cartridge [Power on], plastic [Chunky skin], ember [Warm accent], tide [Cool accent], timing [Stopwatch], bit [Hide and seek], dance [Little jig], backroom [Workshop]. All typed outside text fields; cartridge works with the layer off, the rest need it on, bit and dance are the two legacy eggs (ArrowUp twice also makes Bit dance now).
  BUILD_STAMP: 2026-11-14.batch7 (dashboard-v5/src/live/build-stamp.mjs). NOT bumped at batch end on purpose: the stamp was introduced by this batch, nothing has shipped under an older one, and the stamp is part of every vals golden scenario (vcdv.vcdStamp and vcdLabel), so a cosmetic bump would move all 160 scenarios outside any dish's attribution. The next batch bumps it.
  DELETION CANDIDATES FOR THE OWNER'S YES (nothing removed; list from dish 2, still true): (1) browser-bridge/social.js read half, which writes data/social/*.json (files that mention data/social or social-switch outside tests: dashboard/browser-bridge.js, dashboard/social-bridge.js, mcp/workspacehq/server.mjs, browser-bridge/background.js, browser-bridge/popup.html; the outbox send half stays). (2) browser-bridge/social-switch.js, social-switch-popup.js and dashboard/social-switch-ext.test.mjs, only if the scrape is their sole consumer. (3) Automations > Library: decide on the 2026-11-28 report. (4) Life space: 3 opens in 14 days, keep. (5) Claude Hub panel in System: unmeasured, decide on the 2026-11-28 report. (6) the dormant prompt_use and tombstone tables: schema 2 must stay readable by an older app, keep. (7) tools that only served removed features: not audited.
  FINAL GATES (tree at 1f5f74c): main 2721 (one timing flake in tools/nightly-lock 'a lock released inside the wait', 12/12 alone), money 261, renderer 1766 (1765 pass, 1 skip, 0 fail), selftest 3485 combos 0/0/0, cdp 155/155 PASS in one full run on a fresh instance (cosmos-render-budget passed too, so no budget re-run was needed this time); node tools/gates.mjs --native --only cosmos-native,delivery-native,bridge: cosmos-native PASS, delivery-native PASS, bridge SKIP (the bridge step's glob finds no test files; the bridge tests live under dashboard/ and ran in main).
  OWNER STEPS: restart the app (tools\rollback.ps1 v5), then Settings > Console layer to see the rest (the skin, the shelf, the Memory card, the codes, the version card, the delights); the first launch after this build shows the card once. Nothing else changes with the layer off except Home's new shape (More on Home) and the ArrowUp-twice egg.
IN-FLIGHT: none (data/quest-overrides.json and docs/audits/ stay unstaged, owner decision). ASKS: none. BREAKS: none for the structure lane.

---

## 2026-11-15 · FROM frontend (batch 7 dish 8 DONE: small delights) · main @ 1f5f74c (not pushed)
DONE: 1f5f74c (fe). Three quiet touches, all behind the Console layer. (1) IDLE ATTRACT: a cartridge sliding into a slot, then a blinking cursor, drawn out of flow in a zero-size anchor inside the empty-Brief line (brfEmpty; the all-clear card file belongs to the Brief history dish, so the anchor sits in the line the spec names); starts after 90 s of no input only while that line is on screen and logic/delights.mjs attractOk says nothing blocks it (selection, any dialog or overlay or text field or the palette, reduced motion, page hidden); at most 3 loops per visit, a started loop counts, and ANY pointer, key, wheel or touch input stops it at once. The idle clock is ONE one-shot layerTimer; the nine input listeners are layerOn registrations that exist only while the card is eligible (probe: baseline + 9 listeners + 1 timer armed, back to baseline after the card leaves or the loops are spent). (2) SEASONAL ORNAMENT: logic/seasons.mjs, 12 nature and craft motifs, one per month, 3 to 8 primitives, token colours only, 28 px beside the greeting, static, one injected clock (_dlxClock). (3) BACK ROOM: an SVG workshop overlay (shelf of blank cartridges, a lamp that flickers only when motion is allowed, "Nothing here needs you.", one close button); opened by the Memory card's Empty slot (a real button now, aria-label "Empty slot"; the memory card's tests and the memory-read-only scenario allow exactly Refresh and Empty slot) or by the typed code backroom; Escape closes it before Settings; records backroom in cheatsFound by name; no data, no hq call, no resource load, no sound.
  GOLDEN: golden-diff.mjs (before = git archive of HEAD, after = this tree, 160 scenarios) --allow '^dlxv' --allow '^mcdv[.]mcdEmptyOpen$' exit 0: every scenario changes ONLY the new key dlxv (off constant) and the one Memory card handler. NOTE the plan's '^dlxv[.]' does not match the bare added key, same as '^shfv' before it; and mcdEmptyOpen is the dish's own declared shared edit (the Empty slot handler). tpl.hash re-recorded (+5492 chars). renderVals 985 of 1015.
  SHARED EDITS (all additive): brief.tpl.js, home.tpl.js, app.tpl.js (the room is joined there with the other overlays; shell.tpl.js untouched), memory-card.tpl.js + vals/memory-card.js, cheats.mjs + cheats-host.js (backroom, CHEATS 8, "Codes found: N of 8"), console-layer.mjs + console-skin.js (a SECOND counted stylesheet link, delights.css; the probe reads links 2 while the layer is on, 3 with an accent palette), app.js (mixin, bind, cleanup, Escape first), vals/index.js, selftest.js (+12 rows), cdp-gate.mjs (6 scenarios), cdp-console.mjs (links 1 -> 2 on the two scenarios that read the probe).
  FAULTS FOUND (harness, none in the app): the first cdp run was 4/6: (a) attract-blockers selected the greeting h1, which hq-type draws without text; it selects the Brief line now. (b) On a fresh profile the first REAL input gives the --hidden window focus and opens What's new once, a dialog that rightly blocks the scene; idle, blockers and room now take that focus first and close it (a quiet step), so a solo run on a fresh profile matches the full run. (c) the full run then showed console-on-skin and console-reload-persists expecting one link; fixed in cdp-console.mjs. (d) I bumped BUILD_STAMP mid-run and the version-card scenarios, which read it at start, disagreed with the page; reverted (see the batch-done entry for why it is not bumped).
  GATES: see the batch-done entry (same tree). IN-FLIGHT: none. ASKS: none. BREAKS: none for the structure lane. For the owner: nothing changes until Settings > Console layer is on; then Home may show a small ornament that changes each month, the empty Brief line draws a small cartridge scene after 90 quiet seconds (three loops at most), and the Memory card's last empty slot opens a back room.

---

## 2026-11-15 · FROM frontend (batch 7 dish 7 DONE: the New version inserted card) · main @ 5ba7c51 (not pushed)
DONE: 5ba7c51 (fe). With the Console layer ON, a 1.2 s centred card (an original cartridge sliding into a slot, "New version inserted" and the stamp) shows once per build, never on an ordinary launch. Pure rule logic/version-card.mjs decide({ stamp, seen, visible, layerOn, reduced, overlayOpen }) -> skip-seen | record | suppress | wait | play (every table cell tested). Layer OFF = record the stamp at load, no node, no listener, no timer (so an old build cannot replay when the layer is switched on later). Reduce motion (pref or OS query) = record, show nothing. Hidden launch + layer on = ONE visibilitychange listener through layerOn, removed once decided. While showing: two dismiss listeners and ONE one-shot layer timer (layerTimer(fn, ms, { once: true })), only then. Yields to What's new (and to any dialog or running scan), no focus move, no sound. live/build-stamp.mjs: BUILD_STAMP = '2026-11-14.batch7'.
  GOLDEN: golden-diff.mjs (before = a git archive of HEAD, after = this tree, 160 scenarios) --allow '^vcdv' exit 0: every scenario changes ONLY the new key vcdv (the off constant); none removed or added. tpl.hash re-recorded (+2196 chars = exactly the new fragment, interpolated at the head of tpl/toasts.tpl.js). renderVals 983 -> 984 of 1015.
  GATES: renderer 1766 (0 fail); main 2721 (one claude-hub snapshot timing flake, 47/47 alone); money 261; selftest 3473 combos 0/0/0 (+12); cdp 149/149 PASS on a fresh instance (cosmos-render-budget passed too). The FIRST full cdp run died at button-sweep with "CDP socket closed" and the next scenario timed out after a 22,484,196 ms clock jump: the PC slept mid-run, not an app fault; the instance was killed and the whole run redone.
  FIXES TO THE COOK'S WORK: (1) the card's timer was layerTimer(fn, ms), which console-layer makes a repeating setInterval; it is now { once: true } and the source test pins it. (2) version-card-reduced-motion counted every [data-hq-console] node, but with the layer ON its own stylesheet link is rightly there; it now counts the card's nodes only (PAGE.cardNodes; the layer-off scenario keeps the wider count).
  BATCH-DONE CHECKLIST LINE: bump BUILD_STAMP (dashboard-v5/src/live/build-stamp.mjs) and quote it in the BATCH 7 DONE entry (the heading must say "BATCH 7 DONE"); build-stamp.test.mjs fails if that entry or the CLAUDE.md "- Batch 7" line exists and neither names the stamp.
  NOTES FOR DISH 8: shell.tpl.js / toasts.tpl.js / memory-card.tpl.js edits stack on top of this commit; the fragment sits at the head of toasts.tpl.js. selftest CLEAR now carries vcShow. versionCardSeen is written straight into whq3-prefs by the mixin (no state key). --native not run (batch-end step).
IN-FLIGHT: none from this dish (data/quest-overrides.json, docs/audits/ and dish 8's untracked files stay unstaged). ASKS: none. BREAKS: none for the structure lane. For the owner: nothing changes until Settings > Console layer is on; then the first launch after this build shows the card once.

---

## 2026-11-15 · FROM frontend (batch 7 dish 6 DONE: cheat codes registry; also FINISHED dish 5, the Memory card) · main @ 3c4532c (not pushed)
DONE: 3c4532c (fe), and 93a9fa4 (fe, the Memory card). The Memory card integrator stopped "partial" with its code uncommitted in the tree; dish 6 edits the same files (app.js, selftest.js, vals/index.js, cdp-gate.mjs, memory-card.tpl.js, the goldens), so I committed the Memory card FIRST from a snapshot of those files taken before my edits (git hash-object + update-index, so each commit holds only its own hunks), then mine. The Memory card commit message says its own cdp run was finished here: the 6 memory-* scenarios PASS (6/6 on a fresh instance; see FIX below).
  WHAT: ONE pure registry (logic/cheats.mjs, 7 original codes): cartridge (Console layer on, works while off), plastic (skin), ember and tide (two hidden accent palettes; a second ember clears), timing (frame-timing overlay), and the legacy eggs bit and dance / ArrowUp twice. ONE permanent keydown listener: the one from hq-fx.js MOVED to logic/cheats-host.js (net window keydown count unchanged: 2, layer off and on); hq-fx.js keeps only HQFx.egg(id). armedFor(layerOn): off = the two eggs plus cartridge, on = all. Each fired code toasts one line and is stored by NAME in prefs cheatsFound; Settings > Memory card shows "Codes found: N of 7" (names; a dash for the rest). Palettes are styles/palettes.css behind a second COUNTED link (layerSheet in console-layer.mjs, still the only attach point), present only while the layer is on and a palette is chosen; root data-hq-accent (empty by default). The timing overlay wraps renderVals only while on (ring of 30, p50/p95, renders per minute, key count, last live update); closing it removes the wrapper, ring and subscription.
  OWNER-VISIBLE: the legacy double ArrowUp NEVER fired (needle 14 characters, shipped tail 12). The legacy tail is now 14, so ArrowUp twice outside a field makes Bit dance. bit and dance are identical at 12 and 14; createLegacyMatcher({ tail: 12 }) is the old behaviour and a test pins it. Typing plastic with the layer off does nothing (it is not armed). The normaliser now keeps palette in ember | tide | none (console-layer.test.mjs updated).
  GOLDEN: golden-diff.mjs (before = tree after 93a9fa4, after = this tree, 160 scenarios) --allow '^chtv' exit 0, every scenario changes ONLY the new key chtv. tpl.hash re-recorded (+4092 chars: found fragment 1008, overlay 2880, root attribute and marker 204). renderVals 982 -> 983 of 1015 (the Memory card took 981 -> 982; the batch ends at 985 if dishes 7 and 8 add one each).
  GATES: renderer 1766 (1765 pass, 1 skip, 0 fail); main 2721; money 261; selftest 3461 combos 0/0/0 (+26); cdp 143 scenarios, full run 141/143. Misses: memory-render (the Memory card scenario asserted an EMPTY codes slot; it and its test now assert the found list; 6/6 memory-* PASS after) and cosmos-render-budget (412 ms vs 400 in the full run, 381.7 ms alone on a fresh instance: the known machine-load miss, nothing loosened; still wants its batch-end re-run). The 7 cheats-* scenarios PASS first time. button-sweep took about 14 minutes in the full run (inside its 900 s timeout). --native not run: batch-end step.
  NOTES FOR LATER DISHES: delights, version-card and build-stamp untracked files in the tree belong to dishes 7 and 8 and were NOT staged. The Memory card codes slot is now taken (dish 8 should add its own slot or hook beside it). cheats-host.js registers one plain addEventListener on purpose; console-layer.test.mjs's source rule names it as the one exception. The overlay timing path is the first thing to read if renders ever look slower with the layer on: it wraps renderVals only while the timing code is on.
IN-FLIGHT: none from this dish (data/quest-overrides.json, docs/audits/ and dishes 7 and 8 untracked files stay unstaged). ASKS: none. BREAKS: none for the structure lane. For the owner: nothing changes with the Console layer off except ArrowUp twice now works as the double-up egg; with it on, typing cartridge, plastic, ember, tide or timing (outside any text field) does what its toast says.

---

## 2026-11-15 · FROM frontend (ANNOUNCE: batch 7 dish 5, the Memory card) · main @ ec34b59
DONE: nothing landed yet (this entry comes first). Shared edits about to land, all frontend lane: dashboard/main.js (ONE init line after the reach init: `require('./memory-card').init(...)`, main window only), dashboard/preload.js (ONE group: `hq.memory = { read }`), docs/sync/IPC-CONTRACT.md (the `hq:memory:read` row, committed with this entry BEFORE the code), dashboard-v5 ov-settings.tpl.js (the fragment under cslv.cslOn), vals/index.js (ONE new key `mcdv`), app.js (`memoryCardLogic` mixin, not in the plan's list), selftest.js, tools/cdp-gate.mjs, tools/fake-preload.js. New files: dashboard/memory-card-core.mjs, dashboard/memory-card.js (read-only walk of data/ by generic top-level name; numbers only, never a file name), renderer logic/vals/tpl/selftest/cdp files.
IN-FLIGHT: the Memory card (Settings, Console layer only; read-only, no forget/delete/clear/export control anywhere). ASKS: none. BREAKS: none for the structure lane (it only stats files under data/ and never reads them).

---

## 2026-11-15 · FROM frontend (batch 7 dish 4 DONE: the cartridge shelf in Projects) · main @ 192f6f1 (not pushed)
DONE: 192f6f1 (fe). With the Console layer ON, Projects > Grid gains a List | Shelf toggle (consoleLayer.shelf, the sub-flag dish 3 already normalises) and a second view of the SAME list: cartridges drawn in code (pure logic/shelf.mjs: shell, grip, bevels, status-colour label gradient with a small deterministic hue shift, initials in dark/light ink at ratio >= 4.5), standing on rails, the current project (the shared next action's) pushed into a console slot, 48 per page with a true "Show N more" and "showing 48 of 83", same sorters and chips as the list. Each cartridge is a button with an accessible name; the shelf is a role=list. Hover lifts 6px / 120 ms only when motion is allowed (reduceMotion pref and the OS query both give a 2px outline, no transform, no transition). Layer OFF: no toggle, no Shelf DOM, listOn true, Projects as before. This dish adds no listener, timer or frame.
  GOLDEN: golden-diff.mjs (before = a git archive of HEAD, after = this tree, 160 scenarios) with --allow '^shfv' exit 0: every scenario changes ONLY the new key shfv (off values, an empty toggle), none removed or added. NOTE: the plan's pattern '^shfv[.]' does not match the bare added key; '^shfv' is the right one. tpl.hash re-recorded (+10138 chars / +10138 bytes: shelf.tpl.js 9254 + 539, plus the marker line and the shfv.listOn wrapper round the List grid, +345); vals.hashes.json re-recorded in the same commit. renderVals 980 -> 981 of 1015 (one key, shfv).
  GATES: renderer 1764 tests 0 fail (shelf pins 48/48, none skipped now); main 2721 (0 fail); money 261; selftest 3419 combos 0/0/0 (+22 = 11 shelf-* rows x 2 themes, on 3, 48 and 83 invented projects swapped into the model's own P0 and restored in a finally); cdp 130 scenarios, 129 PASS in the full run (the 7 shelf-* all PASS; first Shelf render of 48 cartridges 60 to 74 ms against the 400 ms budget). The one miss is cosmos-render-budget (first render over 400 ms under the full run); re-run alone on fresh instances: 358.7 ms PASS, then 465.6 ms FAIL (dish 3 A/B on HEAD already spanned 373 to 857 ms) - the machine, not this dish; it still needs its batch-end re-run.
  HARNESS FACTS (first real Electron run of cdp-shelf.mjs, faults in the new scenario file, none in the app): the hidden window makes no frames, so :hover from Input.dispatchMouseEvent never applies and CSS transitions never advance. cdp-shelf.mjs hover() sends the real move, forces :hover with CSS.forcePseudoState when matches(':hover') is false, and finishes running transitions before reading computed style; putProjects retries on "Promise was collected" (dynamic import inside Runtime.evaluate). The click is a real press and release and does reach the page.
  SHARED EDITS (all additive): tpl/projects.tpl.js (toggle in the Sort row, ${shelfView}, the shfv.listOn wrapper, each with a v5 marker), vals/index.js (shelfVals), app.js (shelfLogic mixin; not in the plan's list), selftest.js, cdp-gate.mjs, fake-preload.js (the pasted console-fixture block: hqFake.shelfProjects(n), knob sessionStorage hqFake:projectCount, default 83; hq itself untouched). vals/projects.js NOT edited (shelfVals mirrors the sorters; a parity test runs the real projectsVals as the oracle). No IPC.
  NOTES FOR LATER DISHES: the fake data path has no DATA line (the page loads the owner's baked ../dashboard/data.js), so gates swap invented rows into L.M.at(0).P0; cartridge colour is the status token (the scan has no per-project colour); rows are cut for the width at render time (no resize listener, by the layer rule); the shell.tpl.js / memory-card.tpl.js / normaliser edits of dishes 5 to 8 are untouched.
IN-FLIGHT: none from this dish (data/quest-overrides.json, docs/audits/ and the later dishes' untracked files stay unstaged). ASKS: none. BREAKS: none for the structure lane. For the owner: nothing changes until Settings > Console layer is on; then Projects > Grid offers List | Shelf.

---

## 2026-11-15 · FROM frontend (batch 7 dish 3 DONE: Console layer master switch and the Console skin) · main @ f7f2b51 (not pushed)
DONE: f7f2b51 (fe). ONE opt-in pref consoleLayer { on, skin, scan, palette, debug, shelf }, everything OFF by default, normalised by a pure function (logic/console-layer.mjs; later dishes extend it and the tests). That module is the ONLY place the layer attaches anything: attach() injects the #hq-console-css link, layerOn / layerTimer / layerFrame count what they create, detach() removes all of it without a reload, window.__hqLayerProbe() reads { links, listeners, timers, frames } (zeros while off; the two permanent keydown listeners are outside it). A source test fails if any new console-* file registers its own listener, timer or frame. Settings > Console layer (+ CRT scanlines only while on and the skin is chosen); the Appearance chips gain Console only while on; Dark / Light / Follow system and toggleTheme() (shell button and the palette command) leave the skin; themePref stays dark|light|os and themeName() never says console (nothing in main validates a fourth value: the skin is renderer-only). styles/console.css remaps the token set under [data-hq-skin="console"], no animation, no transition, no position rule; AA contrast pinned by styles/console.test.mjs. The scanline overlay is switched by a layer-managed <html data-hq-scan> attribute (the template root carries only data-hq-skin). Stored skin/scan are kept while the layer is off and do nothing (consoleEffective).
  GOLDEN: golden-diff.mjs (before = tree at 066b81f, after = this dish, 160 scenarios) with --allow ^cslv and --allow ^settings.4.$ exit 0, every change attributed: every scenario changes ONLY cslv (the new key, off values) and settings[4] (the one new Console layer row); none removed or added. tpl.hash re-recorded (+209 chars / +209 bytes: the root data-hq-skin attribute and its v5 marker line). renderVals 979 -> 980 of 1015 (one key, cslv; the batch ends at 985 if dishes 4 to 8 add one each).
  GATES: renderer 1764 pass 0 fail; main 2721, one timing flake (claude-hub snapshot op, 47/47 alone); money 261; selftest 3397 combos 0/0/0 (+10: 5 console-* rows x 2 themes; the layer ends OFF); cdp-gate 123 scenarios, 121 PASS in the full run. Two failures: (1) console-reduced-motion was a fault in my new scenario (it asserted NO running animation, but the app itself runs a looping SECTION animation and starts 120 ms button colour transitions with the layer off; the hidden test window does not advance the animation clock, so the finite ones read as running). It now compares the same page with the layer off against the layer on (finite animations finished first), requires no CSS animation under the skin, in both modes (the app's Reduce motion pref and the OS media query): PASS. (2) cosmos-render-budget missed (535 / 489 ms vs 400). A/B on the same machine, 8 runs each, a copy of the HEAD tree against this tree: HEAD 373-857 ms, this tree 410-829 ms, so the machine is slower than at the earlier gate runs and the dish is not the cause. Nothing loosened; to be re-run at batch end.
  NOTES FOR LATER DISHES: raise the registered counts in selftest-console's consoleProblems for the on-rows when a dish registers listeners, timers or frames; the normaliser's palette check is a plain id check today (tighten it with the palette list in dish 4 or 6); under the skin the chamfer clip-path hides outer box-shadow state rings on buttons (fills and inset bars remain).
IN-FLIGHT: none from this dish (data/quest-overrides.json, docs/audits/ and the later dishes' untracked files stay unstaged). ASKS: none. BREAKS: none for the structure lane. For the owner: nothing changes until Settings > Console layer is switched on.

---

## 2026-11-15 · FROM frontend (batch 7 dish 2 DONE: the subtraction pass) · main @ b28ab05 (not pushed)
DONE: 76f0847 (meta announce), b28ab05 (fe), then this entry with the README and CLAUDE.md thesis (meta). FOLD MECHANISM, DORMANT: dashboard-v5/src/live/foldable.mjs (pure) decides what is folded from MEASURED_ZERO_14D (shipped EMPTY, frozen) plus the per-viewer pref foldIds, minus everything when showEverything is on; vals/ctx.js computes it once (ctx.fold, ctx.shownSubs), vals/shell.js drops folded spaces from the rail and More list AFTER the digits are assigned (each space keeps its unfolded digit; bottom nav = the original first four minus a folded one), filters the sub bar, and adds Settings > Show everything ONLY while something is set to fold; number keys, the Go palette and deep links still reach a folded surface (app.js and palette untouched). With the shipped data nothing is hidden and Settings has no such row. New use marks projects-archived, system-hub-panel, automations-library (use-log SURFACES + IPC-CONTRACT row 76f0847; marked inside their own guards, never while folded). To fold for real: after 2026-11-28 read node tools/use-report.mjs, put the ids with zero opens in MEASURED_ZERO_14D, quote the 14-day table in that commit.
  USE REPORT (14 days, 2026-11-01 to 2026-11-14, 71 marks): brief-panel 14, today-ribbon 8, sessions-strip 7, cosmos 6, delivery-card 6, security 5, machine-drift 4, clients-list 3, space-life 3, space-claude 2, space-projects 2, space-security 2, space-system 2, space-tasks 2, space-automations 1, space-cosmos 1, space-history 1, space-home 1, space-money 1. Never seen (14): sessions-board, money-start, money-quick, palette-money-line, reach, delivery-check, brief-act, quick-jump, money-access, brief-history, security-refresh, claude-vault, security-recycle, home-more. Life has 3 opens: NOT zero, NOT folded. The three new marks had no data: unmeasured, not zero.
  DEAD CODE DELETED (node tools/dead-callers.mjs, new, read-only): store methods harvestPool, hideCandidate, hiddenCandidates, addPromptUse, promptStats, promptBodies had no non-test caller anywhere; deleted from dashboard/claude-hub/store.mjs with their prepared statements (poolMsgs, poolHist, promptBodies, hiddenCands) and store-local constants (HARVEST_POOL_MAX, PROMPT_TARGETS, PROMPT_ID_RE, ISO_RE, optId) and their tests; re-run: all NOT FOUND. Schema stays 2, the prompt_use and tombstone CREATE TABLEs stay, a test keeps the tombstone-survives-resetCode property.
  GOLDEN: golden-diff.mjs before/after (160 scenarios) exit 0 with no changed path; no template edit, tpl.hash and vals.hashes.json did not move. renderVals still 979 of 1015.
  GATES: main 2721 (0 fail), hub 205, money 261, renderer 1764 (0 fail), selftest 3387 combos 0/0/0 (+24), cdp 116 scenarios: 111 PASS in the full run; the 5 new fold scenarios failed on two faults in the new cdp-fold.mjs (rail selector also matched the Keyboard shortcuts button in the nav; motion probe walked every Settings row) and PASS 6/6 on a fresh instance after the fix (the other 105 are unchanged by it).
  DELETION CANDIDATES FOR THE OWNER'S YES (nothing removed): (1) browser-bridge/social.js read half, which writes data/social/*.json; files that mention data/social or social-switch outside tests today: dashboard/browser-bridge.js, dashboard/social-bridge.js, mcp/workspacehq/server.mjs, browser-bridge/background.js, browser-bridge/popup.html (read each before deciding; the outbox send half stays). (2) browser-bridge/social-switch.js, social-switch-popup.js and dashboard/social-switch-ext.test.mjs, only if the scrape is their sole consumer. (3) Automations > Library: decide on the 2026-11-28 report. (4) Life space: 3 opens in 14 days, keep. (5) Claude Hub panel in System: unmeasured, decide on the 2026-11-28 report. (6) the dormant prompt_use and tombstone candidate tables: schema 2 must stay readable by an older app, so keep. (7) tools that only served removed features: not audited.
  CAVEAT: a folded surface reached through the Go palette is never counted (no mark while folded), so a measured zero cannot un-zero itself except through Show everything; say so if the owner wants palette arrivals counted. THESIS: README opening and CLAUDE.md first paragraph now say the thesis and the freeze rule; tools/thesis.test.mjs is strict.
IN-FLIGHT: none from this dish (data/quest-overrides.json and docs/audits/ stay unstaged). ASKS: none. BREAKS: none.

---

## 2026-11-14 · FROM frontend (ANNOUNCE: batch 7 dish 2, the subtraction pass) · main @ f50024a
DONE: nothing yet (this entry comes first). Shared edits about to land, all in the frontend lane: dashboard/use-log.js (SURFACES += projects-archived, system-hub-panel, automations-library; measurement only), the hq:use row in IPC-CONTRACT (+3 ids, written now, no new channel), dashboard/claude-hub/store.mjs + store.test.mjs (ONLY the methods tools/dead-callers.mjs proves have no non-test caller; the schema and the CREATE TABLE statements stay, user_version 2), README.md (opening above "## Status") and CLAUDE.md (first paragraph: the thesis and the freeze rule).
IN-FLIGHT: the foldable-surface mechanism (dormant: the measured-zero list ships empty, so nothing is hidden by default). ASKS: none. BREAKS: none for the structure lane.

---

## 2026-11-14 · FROM frontend (batch 7 dish 1 DONE: Home as one decision) · main @ 5d83bb2 (not pushed)
DONE: 2c34890 (meta, IPC-CONTRACT row), 5d83bb2 (fe). Home = greeting, the Brief, ONE next-action card (or All clear), then a remembered "More on Home" button; the since banner, sessions strip, Today ribbon, Portfolio, Changes and the aside are not rendered until it is opened. ONE ordering: logic/decision.mjs decide() (the lead Brief row's project when it has an open task, else the ranker top, no open task = All clear); app.decideFor() builds it once per render, so the card + alternatives, the Status rail's Do now, promptHints, the Tasks ranked list and the F key (logic/tasks.js toggleFocus was a second ranker, one line changed) read it; a snapshot ignores the Brief. The grey span prints home.next.source. Flag: localStorage 'hq.homeMore' (logic/home-more.mjs, guarded, default closed). The today-ribbon and sessions-strip marks are sent only while it is open; use-log SURFACES += home-more.
  GOLDEN: golden-diff.mjs --allow '^home[.]' --allow '^taskRows' exit 0, every change attributed: 160 scenarios, only home.moreExpanded, home.moreLabel, home.moreOpen, home.next.source, home.toggleMore (no tasks path moved, the golden fixtures have an empty Brief); no scenario removed. tpl.hash re-recorded (+1195 chars / +1194 bytes). renderVals still 979 of 1015 (no new top-level key).
  GATES: renderer 1745 pass 0 fail; main 2725 pass, 1 timing flake (social-claim "two approves at once", fails only under the full parallel run, 46/46 alone; not this dish); money 261; selftest 3363 combos 0/0/0 (was 3349: +14 = 7 ho1-* rows x 2 themes; CLEAR now sets homeMore true so the sweep keeps covering the blocks); cdp first run 106/110 (the four home-one faults were in the new scenario file: the card title is an <hq-scramble text> attribute not a text node, and the recap heading carries its date range; fixed), then home-one 7/7 on a fresh instance and the other 103 PASS in the first run (button-sweep 616 buttons, Home swept OPEN). Existing Home-block scenarios opened the disclosure first: cdp-today (open/reset), sessions-home-strip, button-sweep.
IN-FLIGHT: none from this dish (data/quest-overrides.json and docs/audits/ stay unstaged). Untracked files of later dishes were present in the tree while I gated (all their tests passed); not touched.
ASKS: none. BREAKS: none for the structure lane. For the owner: a Home you used to scroll is now Brief + card; "More on Home" brings the rest back and remembers; use-report will start counting home-more opens.

---

## 2026-11-14 · FROM frontend (ANNOUNCE: batch 7, One Home, less app and the console layer) · main @ 2527f5a
DONE: nothing yet (this entry comes first, as the session contract asks). The plan is docs/superpowers/plans/2026-11-14-batch7.md (eight dishes in order: Home as one decision, subtraction, Console skin + master switch, cartridge shelf, memory card, cheat codes, new-version card, small delights). Dishes 3 to 8 sit behind one Console layer switch that defaults OFF. FREEZE RULE: no new space, no new MCP tool. renderVals ends at 985 of 1015 (one nested key per dish 3 to 8).
IN-FLIGHT: SHARED FILES THIS BATCH WILL TOUCH (frontend lane, announced here first): dashboard/use-log.js (SURFACES += home-more, projects-archived, system-hub-panel, automations-library; dishes 1 and 2), dashboard/main.js (ONE init line after reach) + dashboard/preload.js (hq.memory group) + new dashboard/memory-card-core.mjs and memory-card.js (dish 5, read-only channel hq:memory:read; the IPC-CONTRACT row is written BEFORE the code), dashboard/claude-hub/store.mjs + store.test.mjs (dish 2, ONLY methods proven dead by tools/dead-callers.mjs; schema stays 2), docs/sync/IPC-CONTRACT.md (the use allowlist rows and hq:memory:read), README.md (opening) and CLAUDE.md (first paragraph + a batch 7 facts line at the end), tools/ (new dead-callers.mjs and tests), dashboard-v5/ template window: tpl.hash and the vals goldens move in every dish, each move attributed to its dish with dashboard-v5/tools/golden-diff.mjs. Renderer files: home/shell/projects/ov-settings/brief templates, vals ctx/home/tasks/shell/projects/system/automations/sessions-board, logic/today.js, app.js, elements/hq-fx.js (the legacy keydown block moves to a new logic/cheats-host.js; HQFx.egg(id) added), fake-preload.js (invented fixtures only).
ASKS: none to the structure lane. Owner questions are listed at the end of the plan doc (fold the unmeasured surfaces now or after the 2026-11-28 report; keep the typed code that turns the layer on; accent hues).
BREAKS: none for the structure lane. For the owner: Home folds Portfolio, Changes, Trend, the Today ribbon and the sessions strip behind one remembered 'More on Home' button (dish 1); the Brief, the next action and the All clear card stay on top.

---

## 2026-11-14 · FROM frontend (BATCH 6 DONE: reach and truth, all seven dishes + the collector one-liners) · main @ ada0d62
DONE: 8866a8e..ada0d62. (1) nightly refresh lock (1c08aa2 e45d1cc e12bf39) and the two collector one-liners (bb0cc6c, owner-approved; announced 29fcc1d): the nightly claude -p runs pass --strict-mcp-config with tools/empty-mcp.json, so registering workspacehq at user scope is now safe; Reach and tools/README.md say so (ada0d62). (2) unclogged Brief: group rows, a cap-one aged slot, the quiet lane (a1b2d8a). (3) act marks + node tools/use-report.mjs (ef04534), Jump counts opens only (b78a5e2). (4) daily read-only chat-index snapshot outside the repo (c1950c0). (5) the phone brief file, OFF until a folder is picked (84b05cd). (6) quiet and light: sound off by default, no re-render while hidden, Settings > Reach > Send a test notification (97dd0d7; its contract rows are 270f82e, whose message is wrong - see the note 8012ff7). (7) one gate command node tools/gates.mjs [--native] and an opt-in settle sweep (22f98ae; default NOT switched, run 1 of 3 recorded; full cdp still ~10.5 min - the per-click reset is the cost, not the sleeps).
  GATES (node tools/gates.mjs --native on bb0cc6c+ada0d62): main/hub/money/cosmos/renderer/tools 0 fail, selftest 3349 0/0/0, cosmos and delivery native exit 0; cdp 101/103 with two timing budgets missed under load (ask-stream, cosmos-render-budget 455 ms), re-run on a fresh instance 2/2 PASS (323 ms). renderVals 979, tpl.hash unchanged; vals.hashes moved once, attributed to the Sound switch (97dd0d7).
  OWNER STEPS: restart, press Scan once (no skipped line); paste the two commands in tools/README.md (user-scope tools + the SessionStart hook); Settings > Reach > Send a test notification; pick the phone folder when Syncthing is set up.
IN-FLIGHT: none (data/quest-overrides.json and docs/audits/ stay unstaged, owner decision). ASKS (struct): none from batch 6; older ones unchanged (assemble --no-vault, GPU enumeration, -WakeToRun). BREAKS: the collector spawns carry two more flags (no output change).

---

## 2026-11-14 · FROM frontend (ANNOUNCE: the two collector one-liners, owner-approved) · main @ 8c522e7 (not pushed)
DONE: nothing yet (this entry comes first, as the session contract asks).
IN-FLIGHT: the owner said yes (2026-11-14) to the frontend session making the two struct-lane one-liners itself: collector/enrich.mjs (the spawnSync of claude -p) and collector/weekly-narrator.mjs (same) each gain '--strict-mcp-config', '--mcp-config', <absolute path of tools/empty-mcp.json built from the file's own __dirname>, so the unattended nightly runs load no MCP tools at all, including a user-scope workspacehq registration. One struct: commit with only those two files; tools/nightly-isolation.test.mjs turns from a todo into a real check. Then an fe: commit updates the Reach user-scope row and the tools/README.md caveat to say the nightly runs are isolated.
ASKS: none (structure lane: please do not edit those two lines in the meantime). BREAKS: none (no data shape, no output change; the model call is the same, only its tool config is empty).

---

## 2026-11-14 · FROM frontend (batch 6 dish 7 DONE: fast-gates, one gate command and an opt-in settle sweep) · main @ 22f98ae (not pushed)
DONE: 22f98ae (fe). ONE COMMAND: `node tools/gates.mjs` runs main, hub, money, cosmos, renderer, tools, the Electron selftest and the CDP gate in order, one at a time, and prints one table (`--list`, `--only`, `--skip`, `--bail`, `--native`, `--budget`, `--settle`, `--sweep-compare`; tools/README.md). Its CDP step starts and always stops only its own dev-main electron (own profile, free port). SETTLE (OPT-IN): `cdp-gate.mjs --settle` (dashboard-v5/tools/cdp-settle.mjs) makes button-sweep, money-button-sweep, cosmos-button-sweep and delivery-check-button-sweep wait for a quiet #app DOM and no outstanding fetch (cap 800 ms, cap hits counted in a `[settle]` line) instead of fixed sleeps. The OLD sweep stays the default and the gate; no assertion, finding class or KNOWN_CUTS entry changed (a source test pins them). Shared files touched, not announced in the plan: dashboard-v5/tools/cdp-cosmos.mjs and cdp-delivery-check.mjs (one optional `settleWait` argument each, used only inside their sweeps), cdp-gate.mjs, README.md, tools/README.md.
  FIX FOUND BY THE FIRST REAL RUN: the runner's selftest step lacked `--preload=fake`; without it the selftest showed 1 error (3349 combos 1/0/0) while the by-hand gate with --preload=fake is 0/0/0. The step now passes it (gates.test.mjs pinned).
  GATES (default sweep, on the committed content): main 1746, hub 213, money 261, cosmos 473, renderer 1247, tools+mcp+trailer 262 (1 skip), all 0 fail; Electron selftest 3349 0/0/0 (214.7 s); cdp-gate 103/103 (662.0 s). Total of that table 876.8 s for selftest+cdp plus about 150 s of unit suites. One earlier full run had cosmos-render-budget at 415 ms against its 400 ms budget (machine busy, other electron instances up); it passed at once in the re-run. Nothing was loosened.
  TIMINGS / SWEEP RUN 1 OF 3 (the default is NOT switched): full cdp gate with --settle 103/103 in 624.3 s, 0 cap hits (vs 662.0 s default). `--sweep-compare`: old 572.0 s, settled 531.9 s, `SWEEP old=0 settled=0 same=true` (both modes found nothing, so same=true is true but weak evidence; settled waits=3323, cap-hits=0). Two more consecutive same=true runs are needed before anyone flips the default.
  TARGET MISSED (under 6 minutes): the full cdp gate is 10.4 min. The four sweeps are about 570 s of it and settling saves only 40 s, so the fixed sleeps are NOT the main cost: it is the per-click reset (hqFake.reset, setState, a full re-render, one fresh screen per button). The next step is cheaper resets or a parallel-safe split of the sweep by screen, not shorter waits.
  OWNER CHECK: none needed. IN-FLIGHT (not mine): data/quest-overrides.json, docs/audits/ (unstaged, owner). ASKS: none. BREAKS: none.

---

## 2026-11-14 · FROM frontend (batch 6 dish 6 DONE: quiet-light, sound off, no hidden re-render, a real test notification) · main @ 97dd0d7 (not pushed)
DONE: 97dd0d7 (fe). SOUND: off by default (hq-fx default, app.js `P.sound === true`); logic/sound-pref.mjs migrates the owner's saved on-setting once and persists {sound:false, soundV:2} at once, so a later explicit "on" survives restarts; the tab and click sounds are gone (app.js, ask.js, cosmos.js, hq-fx click listener), the done/level sounds stay behind the switch; wording "A short sound when something finishes (a scan, a save, a level-up)." HIDDEN WINDOW: live/visibility-gate.mjs; the machine push stores the sample and renders only while visible, once on show. Verified machine history is unaffected (machine-history.js is main-side and reads its own files, never this push; live.machine is latest-only). TEST NOTIFICATION: dashboard/notify-test.js, hq:reach:notify-test (main window only, 1 per 5 s, fixed text), main.js one init line, preload reach.notifyTest, Reach row 'notify-test' (never an MCP door), honest toasts and one act mark.
  GOLDEN: vals.hashes.json moved for all 160 scenarios, attributed with golden-diff.mjs (HEAD archive vs tree, GOLDEN_DUMP): the only changed paths in every scenario are settings[0].desc/.state/.style.background/.boxShadow/.color = the Sound switch (wording + off state). tpl.hash untouched, renderVals still 979, no new key.
  GATES on exactly the committed tree: main 2696 tests 0 fail (1 todo), money 261, renderer 1247, Electron selftest 3349 0/0/0, cdp-gate 103/103 (incl. quiet-hidden-no-rerender, quiet-sound-default-off, reach-notify-test).
  OWNER CHECK: restart the app; Settings > Reach > Send a test notification should show one Windows toast (a second press within 5 s is refused); Sound shows off.
IN-FLIGHT (not mine): fast-gates dish files (tools/gates*.mjs, dashboard-v5/tools/cdp-settle*.mjs), data/quest-overrides.json, docs/audits/. ASKS: none. BREAKS: none (additive channel; the Reach list is now 7 rows).

---

## 2026-11-14 · FROM frontend (batch 6 fixes after the tasters: the unclogged Brief committed, Jump counts opens only, the README caveat) · main @ a1b2d8a (not pushed)
DONE: (1) a1b2d8a (fe) the unclogged Brief, the dish that had stopped uncommitted: dashboard/brief-quiet.mjs + brief-quiet-sources.js, group rows, the cap-one aged slot, the quiet lane, the tray quiet row, tools/brief-lines "quiet:" line, MCP hq_brief passing quiet (dropped while the Money switch is off), the renderer group meta, three cdp scenarios (brief-group-row, brief-aged-slot, brief-quiet-lane). Its contract row is 38ff6c3. (2) b78a5e2 (fe) dashboard/use-counts.js counts only action 'open' for Jump ordering (a line with no action still counts): acts are per click now, so machine-drift, money-access, clients-list and sessions-board acts were each adding a count to their Jump target. Cosmos and Brief-panel marks map to no target, so the taster's "ten favourite clicks" case never happened; the five mapped surfaces did. (3) this entry's commit (meta): tools/README.md now says right under the `claude mcp add --scope user` line that the nightly `claude -p` runs are NOT isolated from it until the two collector lines land (and says "today they do NOT" instead of "they should pass"); tools/readme-mcp-caveat.test.mjs pins both. The Reach user-scope row already said "Register it once the structure lane has isolated the nightly runs", so its wording and test did not change; README and row now say the same thing.
  HOW IT WAS GATED: the live tree still holds the quiet-light dish unfinished (its sound/visibility/notify-test edits sit uncommitted in main.js, preload.js, reach.js, app.js, store.js, fake-preload.js, vals.hashes.json and others, its fake-preload.js and cdp-gate.mjs hunks included) and fast-gates files (tools/gates*.mjs) untracked: neither was committed. The code commits were gated on EXACTLY their content in a clean clone of HEAD plus the committed files, then committed by explicit path (dashboard-v5/tools/cdp-gate.mjs went in as a blob with only the three Unclogged-Brief hunks). Gates there: main 2639 tests 2638 pass / 0 fail / 1 todo, money 261, renderer 1198, selftest 3349 0/0/0, cdp-gate 100/100.
  A TRAP WORTH KNOWING: dashboard/data.js (gitignored, built by `node dashboard/build-data.mjs`) is read by the Electron selftest; a fresh clone without it fails the selftest at dark p3:security-unlock-clears ("the unlock dialog has no passphrase field", 1693 combos, 1 error). Run the build step or copy the file before gating in a clone. A clone also needs the .cmd files in CRLF and git history (llm-context.test.mjs runs git show).
IN-FLIGHT (not mine, still uncommitted): the quiet-light dish (sound default off, machine push only while visible, Settings test notification: dashboard/notify-test.js, logic/sound-pref.mjs, live/visibility-gate.mjs, cdp-quiet-light.mjs, cdp-settle.mjs, their tests, and the hunks above incl. a re-recorded dashboard-v5/src/__golden__/vals.hashes.json) and fast-gates (tools/gates.mjs, gates-core.mjs). Their integrators have no report; whoever finishes them must re-gate with the committed Brief in the tree (cdp-gate.mjs's reach-render pins 6 rows now and moves to 7 with the notify-test row). data/quest-overrides.json and docs/audits/ stay unstaged (owner).
ASKS (struct): the two collector one-liners (enrich.mjs, weekly-narrator.mjs: --strict-mcp-config --mcp-config <abs tools/empty-mcp.json>) are still open; until they land the README caveat stands. BREAKS: none.

---

## 2026-11-14 · FROM frontend (batch 6 dish 5 DONE: phone-file, the Brief on the phone with no bot) · main @ 84b05cd (not pushed)
DONE: three commits in the order the plan set. 983d88d (fe) the Reach row-action loop FIRST: one sc-if/sc-for block inside the Reach row (loop variable ra, hint-placeholder-count 2, its <!-- v5: --> marker), handlers on the row objects through a small ACTIONS table in vals/reach.js (unknown ids render nothing), logic/use-log.js rchAct (one at a time, buttons disabled while it runs, only an answer that took effect is a ('reach','act') mark and a re-read), new vals/reach.test.mjs (8 tests: a row without actions keeps every value, the bindings resolve, the click paths); tpl.hash re-recorded for the reach fragment only (+1052 chars / +1054 bytes); vals.golden did NOT move (the golden Settings state has no Reach rows), so there was nothing for golden-diff to attribute. quiet-light must use this loop and not add it. 86853ad (meta) the contract rows: IPC-CONTRACT hq:reach:brief-file, CONTRACT data/.brief-file.json and the file shape, .gitignore (data/.brief-file.json*) and its test. 84b05cd (fe) the feature: dashboard/brief-file-core.mjs (pure text and refuseFolder), brief-file-row.mjs (the Reach row, imports only node:path), brief-file.js (watch brief.json, atomic write, the one channel), main.js ONE init line, preload reach.briefFile, reach.js row 'brief-file', fake-preload, two cdp scenarios.
  WHAT THE APP NOW DOES: Settings > Reach > Phone brief file > Pick folder (native dialog; a repo folder, drive root, relative or missing path is refused). From then on <folder>/workspacehq-brief.txt (at most 600 characters: the time line, the tray's status line, up to three urgent|soon|when you can rows in the tray's own fixed wording, the +N more line, the standing line, the quiet line once it exists) is rewritten when the text changes or every 10 minutes; a brief 30 minutes old says so and lists nothing. OFF until picked; Turn off leaves the file already written where it is and says so. The Reach row says the folder's LAST segment and the last write time, never the full path.
  DECISIONS WORTH KNOWING: (1) the row builder lives in its own file because reach.js is loaded from a copied MCP root in the guard test; the real MCP uses the real tree. (2) MCP hq_activity door rows now include the brief-file row but drop its actions and say "a folder" where Settings names the owner's folder (guard.mjs, pinned in guard.test.mjs, which now copies brief-file-row.mjs). (3) the pinned cdp reach-render moved on purpose: 5 rows / "2 of 5 open" became 6 / "2 of 6 open" with the new row's wording and buttons. (4) the contract row first said a cancelled dialog answers error 'canceled'; the code answers 'No folder was picked' with canceled:true, and the contract was corrected in the HANDOFF commit (docs only).
  SHARED FILES TOUCHED (all announced in the plan): tpl/reach.tpl.js, vals/reach.js, logic/use-log.js, tpl.hash.test.mjs, main.js, preload.js, reach.js + test, mcp/workspacehq/guard.mjs + test, fake-preload.js, cdp-gate.mjs (staged from HEAD with this dish's hunks only: the unclogged-Brief hunks of that file are still uncommitted for their integrator), IPC-CONTRACT.md, CONTRACT.md, .gitignore + its test.
  Gates, one after another, on the whole tree (it still holds brief-unclog's uncommitted work and quiet-light's untracked files): main+hub+cosmos+mcp+tools+bridge 2672 tests 2671 pass / 0 fail / 1 todo, money 261, renderer 1242, Electron selftest 3349 0/0/0, cdp-gate 100/100 (the first full run was 99/100: reach-render, fixed above).
  OWNER CHECK (needs the app restarted; nothing was pressed in the real app and no owner folder was touched): Settings > Reach > Phone brief file > Pick folder, choose the folder your phone already syncs, open workspacehq-brief.txt on the phone; it should hold the same few lines the tray shows and nothing with a name, path or amount in it. Turn off and delete the file there if you do not want it.
IN-FLIGHT: none from this dish. ASKS (struct): none. BREAKS: none (additive; the app needs a restart). No vals key (renderVals stays 979), no new MCP tool, no Home template change.

---

## 2026-11-14 · FROM frontend (batch 6 dish 4 DONE: memory-snapshot, a daily verified copy of the chat index) · main @ c1950c0 (not pushed)
DONE: contract row cb115f4 (meta), code c1950c0 (fe). The app now takes ONE read-only, verified snapshot of data/claude/hub.sqlite per calendar day: dashboard/hub-snapshot.js (main side, off the boot path; first check 5 min after start, then every 30 min, only while the Hub is 'ready' with no backfill, at most 3 tries a failing day) asks the new Hub op snapshot (hub.mjs, one import plus one op line; the writer waits in serial(), a reader copies directly) to run VACUUM INTO a temp file, check it (integrity_check, schema marker, per-table counts) and rename it into %LOCALAPPDATA%\WorkspaceHQ\hub-snapshots\hub-YYYY-MM-DD.sqlite (HQ_HUB_SNAPSHOT_DIR overrides; newest 7 kept, nothing else deleted). The Hub itself (dashboard/claude-hub/snapshot.mjs) refuses a destination inside the repo or under a synced-folder name, so the op is safe even if main were wrong. One day-log line per attempt, event hub-snapshot, {ok, bytes, ms, kept} or {ok:false, reason code}, no path; never a Brief row, toast or throw.
  SHARED FILES TOUCHED (announced): dashboard/claude-hub/hub.mjs (+3 lines), dashboard/claude-hub/hub.test.mjs (one new case: writer and reader both answer, synced-folder and relative destinations refused, nothing created), dashboard/main.js (ONE init line after the claude-bridge-routes setHub line), docs/sync/CONTRACT.md (row first).
  MEASURED: invented 4,500-message index (1.2 MB): copy plus verify 63 ms. The REAL index was not touched by the batch (rule: no owner data). First real timing comes from the owner's first run: the day-log line carries ms and bytes. VACUUM INTO is one synchronous call in the single-threaded Hub, so search, recall and health wait for it; if the real ms is over 3000, the follow-up (NOT this batch) runs the copy in a short-lived child against a read-only connection.
  OWNER CHECK (after restarting the app and waiting about 5 minutes): a dated file exists in the folder above, and `node dashboard/claude-hub/snapshot.mjs --verify <that file>` exits 0 and prints the counts. Restore note: dashboard/claude-hub/README.md (quit the app, verify, copy over data/claude/hub.sqlite, delete hub.sqlite-wal and -shm beside it). A snapshot is a full copy including masked text: keep it off synced folders.
  Tests: snapshot 15, hub-snapshot 11, hub.test.mjs 47. Gates, one after another on the whole tree (it still holds the uncommitted brief-unclog, phone-file and quiet-light work of other dishes): main+hub+cosmos+mcp+tools+bridge 2671 tests 2670 pass / 0 fail / 1 todo, money 261, renderer 1234, Electron selftest 3349 0/0/0, cdp-gate 98/98.
IN-FLIGHT: none from this dish. ASKS (struct): none. BREAKS: none (additive Hub op; the app needs a restart). No vals key, template, IPC channel, MCP tool, golden or preload change.

---

## 2026-11-14 · FROM frontend (batch 6 dish 3 DONE: act marks and the use report) · main @ ef04534 (not pushed)
DONE: contract rows e835d84 (meta), code ef04534 (fe). An act mark is now ONE real click that took effect. dashboard/use-log.js allows claude-vault and security-recycle; the renderer's useMark no longer dedupes an 'act' per arrival nor holds it while the window is hidden (opens unchanged); main's 30 a minute cap still holds. New marks: Brief row button and Dismiss (brief-panel), Cosmos favourite and hide (cosmos), Security Recycle Bin click (security-recycle), Save to vault (claude-vault); a refused or failed action marks nothing, a throwing mark never blocks the click. New tools/use-report.mjs (read-only, counts only, always exit 0; opens/acts per surface for 7 and 14 days, never-seen allowlisted surfaces, first-use dates, and how many day files it saw so "first" is never "ever"). Run on the owner's real logs it read 26 day files (2026-10-15 to 2026-11-14): 10 Brief-panel opens and 0 acts in the last 7 days, 20 allowlisted surfaces never seen (money-start, money-quick, reach, delivery-check, security-refresh and the rest) - the acts column starts counting from this build.
  Tests: use-report 16, new logic/act-marks.test.mjs 9 (three Dismiss clicks = three acts, opens once per arrival, hidden window, refused/failed marks nothing, a throwing or rejecting mark never blocks), use-log/use-counts lists, cdp use-act-marks (Dismiss twice = two acts, row button, Cosmos favourite, vault Save, Cosmos asked for twice = one open). Gates, one after another, on the whole tree (the unclogged-Brief work is in it, uncommitted): main+hub+cosmos+mcp+tools+bridge 2670 / 0 fail / 1 todo, money 261, renderer 1234, Electron selftest 3349 0/0/0, cdp-gate 98/98.
  ONE PINNED BEHAVIOUR MOVED ON PURPOSE: cdp security-unlock-clears expected one security-refresh mark for two presses in an arrival; it now expects two (one per press). Every existing act source (security-refresh, delivery-check, machine-drift estimate, money-access, clients-list) now counts per click too.
  NOTE for the next plan: use-counts.js (Jump ordering) counts every mark of a mapped surface regardless of action, so machine-drift and money-access acts, now per click, add to system/machine and money/today. Small and only matters past 10 counted opens; if it matters, count only action 'open' there (a one-line struct-free fix in dashboard/use-counts.js plus its test).
  SHARED FILES: dashboard-v5/tools/cdp-gate.mjs and tools/README.md were committed with this dish's hunks ONLY (staged from HEAD plus my edits); the unclogged-Brief hunks in the same two files are still uncommitted in the working tree for its integrator. The use-report README section sits at the end of tools/README.md.
IN-FLIGHT: none from this dish. brief-unclog (brief-core, brief.js, brief-project, tray-brief, tray-menu, brief-lines, MCP server, vals/brief.js, cdp-brief-quiet and their tests) is still uncommitted in the tree; its full cdp 'all' was green with it (98/98 here). ASKS (struct): none. BREAKS: none (additive; the app needs a restart). No vals key, template, IPC channel, golden, main.js or preload.js change.

---

## 2026-11-14 · FROM frontend (batch 6 dish 1 DONE: session-door, the nightly refresh lock) · main @ e45d1cc (not pushed)
DONE: contract row 1c08aa2 (meta), code e45d1cc (fe); the struct: commit for run-pipeline.ps1 follows this entry (the file, owner-approved, announced in the batch 6 plan entry below). data/.refresh.lock has a third holder, by "nightly" (tools/nightly-lock.ps1, same shape and rules as refresh-lock.js; dashboard/refresh-lock.js accepts it; heartbeat after each step; child-of-holder rule: the app's Scan spawns the pipeline as its direct child, so a fresh app lock whose pid is the run's parent or one of the next two ancestors is "inherited", nothing written or released; any other fresh holder = wait up to 10 minutes, then ONE "skipped: refresh lock held by <by> since <time>" line and exit 0). tools/README.md has "Two commands you paste yourself" (claude mcp add --scope user workspacehq -- node "<repo path>/mcp/workspacehq/server.mjs", and the SessionStart hook for tools/brief-lines.mjs, moved there, one place). tools/empty-mcp.json + tools/nightly-isolation.test.mjs added.
  MANUAL CHECK (recorded before the struct: commit): the real in-app Scan press was NOT done by this session (a real press runs the github/accounts steps over the network and writes the owner's vault; the rule is no network beyond 127.0.0.1). Done instead, in a temp copy with stub steps and the real run-pipeline.ps1 + tools/nightly-lock.ps1 under the real Windows PowerShell 5.1 with main.js's exact spawn arguments (-NoProfile -ExecutionPolicy Bypass -File): (1) a node process takes the 'app' lock and spawns the pipeline as its direct child: exit 0, all 8 steps ran, no skipped line, the lock file byte-identical afterwards and still held by the app (inherited); (2) a fresh foreign 'mcp' lock (live pid): the run waited, printed exactly one "skipped: refresh lock held by mcp since ..." line in stdout AND in the pipeline log, ran no step, exited 0, left the foreign lock untouched; (3) free folder: took, ran all steps, released; (4) a hard step failing with exit 7: exit 7 and the lock released (finally runs on exit). OWNER STEP: press Scan once in the app after the restart and confirm it finishes and refreshes the data (nothing should print "skipped").
  BUG FOUND by that check and fixed in e45d1cc: the sink parameter of Take-NightlyLock was named -Log, and PowerShell variables are case-insensitive and dynamically scoped, so it shadowed run-pipeline.ps1's own $log path while the Log function ran; the skipped line was lost (the cook's harness used an env var, so its tests did not see it). Now -LogSink (alias Log) and the harness uses the same lowercase $log.
  Gates, one after another: main+hub+cosmos+mcp+tools+bridge 2653 pass / 0 fail / 1 todo (the isolation guard, until the collector lines land), money 261, renderer 1214, Electron selftest 3349 0/0/0, cdp-gate 94/94. No vals key, IPC, golden, main.js or preload.js change.
IN-FLIGHT: none from this dish. dashboard/reach.js user-scope row wording and its test are NOT changed (open owner question 1 unanswered; the row still says "Register it once the structure lane has isolated the nightly runs").
ASKS (struct, only if the owner says yes to open question 1 they may be made by the frontend session in a struct: commit; otherwise for the structure lane): collector/enrich.mjs line 58 args ['-p','--model',MODEL] and collector/weekly-narrator.mjs line 61 args ['-p'] each gain '--strict-mcp-config','--mcp-config',<abs path of tools/empty-mcp.json> (a file, not inline JSON: enrich's claude.cmd fallback goes through cmd.exe). tools/nightly-isolation.test.mjs turns its todo into assertions once either lands (both must then name it).
BREAKS: none (additive; the nightly now waits on or skips behind a running Scan instead of colliding with it).

---

## 2026-11-14 · FROM frontend (BATCH 6 PLANNED: reach and truth) · main @ def144c
DONE: the batch 6 plan (docs/superpowers/plans/2026-11-14-batch6.md, docs only): the "Reach and truth" table of the approved next-level plan, seven dishes in pass order: session-door, brief-unclog, act-marks, memory-snapshot, phone-file, quiet-light, fast-gates. FREEZE RULE in force: no new space, no new MCP tool, no Home template change; renderVals stays 979 of 1015 (Reach controls ride on row objects, the quiet lane rides in the existing brfStanding list).
IN-FLIGHT (shared files this batch will touch, announced now): session-door -> run-pipeline.ps1 (ONE struct: commit, about six lines: dot-source tools/nightly-lock.ps1, take, per-step heartbeat, release in finally; lands LAST in that dish), dashboard/refresh-lock.js (holder 'nightly') + CONTRACT.md refresh.lock note, tools/README.md; brief-unclog -> brief-core.mjs, brief.js, brief-project.mjs, tray-brief.js, tray-menu.js, tools/brief-lines.mjs, mcp/workspacehq/server.mjs (quiet filter only), vals/brief.js, fake-preload.js, cdp-gate.mjs, vals.hashes.json (brf paths only; tpl.hash unchanged), CONTRACT.md brief.json additive fields; act-marks -> use-log.js (two surface ids), logic/use-log.js, logic/{brief,cosmos,security,claude-vault}.js, CONTRACT.md and IPC-CONTRACT.md hq:use row; memory-snapshot -> claude-hub/hub.mjs (one op) and main.js (one init line), CONTRACT.md; phone-file -> main.js (one init line), preload.js, reach.js, tpl/reach.tpl.js + vals/reach.js (one row-action loop, tpl.hash for the reach fragment only), .gitignore, IPC-CONTRACT.md hq:reach:brief-file; quiet-light -> hq-fx.js, app.js, logic/ask.js, vals/shell.js, live/store.js, main.js (one init line), preload.js, reach.js, IPC-CONTRACT.md hq:reach:notify-test; fast-gates -> dashboard-v5/tools/cdp-gate.mjs (--settle flag), README.md gate section, tools/README.md.
ASKS (struct): (1) the two collector spawns that start the unattended claude -p (enrich.mjs line 58, weekly-narrator.mjs line 61) each need '--strict-mcp-config','--mcp-config',<abs path of tools/empty-mcp.json>; run-pipeline.ps1 itself never starts claude. Default: stays an ask for the structure lane unless the owner says the frontend session may make those two lines in a struct: commit. (2) run-pipeline.ps1: the frontend session makes the lock change itself (owner-approved), in one struct: commit announced here; nobody else touches that file. Note: the app spawns this pipeline while holding the 'app' lock, so the ps1 treats a lock held by its own parent as inherited.
BREAKS: none planned (additive; the app needs a restart). Open owner questions are listed at the end of the plan doc.

---

## 2026-11-13 · FROM frontend (BATCH 5 DONE and pushed: the backlog batch) · main @ 80c81c8
DONE: Security honesty pass (2d815a3 59b9779), social read switch / Bridge 0.9.0 (1adba24), Brief-lines tool (2e865eb), Cosmos polish (3929be6), Jump by measured use (2eebe67 428b96c), free renderVals keys to 979 (f583eab), taster fix 80c81c8 (the Home sessions strip no longer counts as a Claude > Sessions visit). CLAUDE.md gains the batch 5 facts line.
  Final gates on this tree, one after another: main+hub+cosmos+mcp+tools+trailer+bridge 2505 pass / 0 fail / 1 pre-existing skip, money 261/261, renderer 1153/1153, Electron selftest 3349 combos 0/0/0, cdp-gate all, cosmos-native.check.js and delivery-check.native.check.js (results in the push commit message). Privacy scan of every added line since 52db1e1: 0 hits. App restarted with tools
ollback.ps1 v5.
  Owner steps: reload the extension (0.9.0; the social read is now off until ticked); check Security > Health names the folders you expect; optional SessionStart hook line in tools/README.md.
IN-FLIGHT: none. Next: a creative batch (N64-era decorations and easter eggs), design first. ASKS (struct): unchanged (backlog B1-B5). BREAKS: none (additive; extension 0.9.0).

---

## 2026-11-13 · FROM frontend (batch 5 dish 6 DONE: free renderVals keys) · main @ f583eab (not pushed)
DONE: f583eab (fe). The Today ribbon's 34 tdy* values now sit under ONE top-level key, tdyv: renderVals 1012 -> 979 (measured by GOLDEN_DUMP over the 160 scenarios; target at most 1000, hard floor 1003, now asserted at most 1003 in vals.golden.test.mjs next to the 1015 ceiling). A pure move: vals/today.js returns { tdyv: { <same names> } }, tpl/today.tpl.js binds tdyv.<name> (39 bindings); no value, label, style or handler changed. Step zero counts (true top-level keys per prefix): tdy 34, dck 41, cls 16, mst 28 (sbd 30 not in the plan). The stop rule met the target after the Today ribbon alone, so the delivery check (dckv), clients list (clsv) and money start (mstv) were NOT folded: they remain flat and are the next free keys for batch 6 (dck -40, cls -15, mst -27 if needed).
  Proof: new dashboard-v5/tools/vals-fold-check.mjs (+ test, 18) on the real before/after dumps: 160 scenarios clean, max 979 keys; golden-diff attributed every change to ^tdy and ^tdyv.; vals.hashes.json re-recorded (tdy paths only); tpl.hash +261 chars (today fragment only). Functions cannot be compared by arity from the dump ("[fn]" marker); handler wiring is covered by the template test (no flat binding allowed), the selftest and the today cdp scenarios.
  Gates, one after another: main 2487 pass / 0 fail / 0 skips, money 261, renderer 1153, Electron selftest 3349 0/0/0, cdp-gate 94/94 (cosmos-render-budget median re-render 16.5 ms). main.js, preload.js, IPC and the contract untouched.
NOTE for batch 6: a new panel still nests its keys under ONE key; to fold another module use vals-fold-check (node dashboard-v5/tools/vals-fold-check.mjs <beforeDir> <afterDir> --prefix dck --tpl dashboard-v5/src/tpl --max-keys 1000). CLAUDE.md's renderVals sentence is updated by the batch-done commit.
IN-FLIGHT: none from this dish. ASKS (struct): none. BREAKS: none (the app needs a restart).

---

## 2026-11-13 · FROM frontend (batch 5 dish 5 DONE: Jump ordered by measured use) · main @ 428b96c (not pushed)
DONE: contract row 2eebe67 (meta), code 428b96c (fe). The Ctrl+Alt+X Go palette breaks ties of a TYPED query by what the owner opens, once the last 14 days hold >= 10 counted opens; below that, and for the empty query (always nav order), nothing changes, and the fixed TIE_BREAK table is the fallback after the counts. New dashboard/use-counts.js (reads the day logs' 'use' lines, tail-bounded, cached 60 s, never throws; counts only under tab/sub keys). A SPACE is counted only from its own space-<id> mark; the eight older surfaces map only to sub-views a space mark does not cover (cast-modes.js SURFACE_TARGETS), so one arrival counts once; quick-jump, reach and the like never activate the ordering. use-log.js gains eleven space-<id> surfaces (built from cast-modes.js SPACE_IDS); the main window writes ONE mark per arrival on a space (src/app.js, tab change only, via logic/use-log.js useSpace behind the nav-id allow set; moving between sub-views of a space writes none). hq:quick:read answers an additive use object (null if the counter throws; keys outside the palette table dropped); cast-modes.js rankGo/goRows take it (a project is never counted); the Go hint adds "ties ordered by what you use" only while active. main.js and preload.js not edited (quick-targets builds use-counts lazily; app-log's folder rule). renderVals stays 1012; no golden or template change.
  Gates, one after another: main+hub+cosmos+mcp+tools+bridge 2487 pass / 0 fail / 0 skips, money 261, renderer 1153, Electron selftest 3349 0/0/0, cdp-gate 94/94 (new scenario use-space-marks).
NOTE: counting starts from this build: space-<id> marks only exist after the app restarts, so the ordering stays off (under 10 counted opens) until some use has accumulated; the older sub-view marks already in the logs count from the start. The palette reads use once when it opens. To read it: the Go hint line.
IN-FLIGHT: none from this dish. ASKS (struct): none. BREAKS: none (additive; the app needs a restart).

---
## 2026-11-13 · FROM frontend (batch 5 dish 4 DONE: Cosmos polish) · main @ 3929be6 (not pushed)
DONE: 3929be6 (fe). Cosmos for a real-size library: sort and group are selects (the <option>s are written out once in the template from the same mode lists, because the HTML parser drops an <sc-for> inside a <select>; vals give { value, options, sel, onChange }); a card whose thumbnail fails shows its original, and one whose pictures both fail shows its title and "could not load" (failures batched into ONE setState per 100 ms; the map cosBroken is cleared on every arrival and re-index so each picture gets a fresh try); the lightbox has a Fit / Actual size toggle and a "Could not open the original" note over the thumbnail; Escape in a title or tag draft drops the draft and keeps the lightbox ONLY when it is the topmost overlay (palette, settings, cheat sheet, index, report still close first); a dashed gold outline while files are dragged over the Feed (enter/leave counter); one row per index phase (walk, thumbs, hashes, dupes) in the index overlay; the import report adds Matched to old ids / Re-keyed / Skipped from the manifest (reasons in words) / Not matched / Manifest state, only where main sent the numbers.
  Shared files touched: vals/cosmos.js (cosSorts, cosGroups reshaped, card fields, ONE new key cosp: renderVals 1011 -> 1012, now pinned at most 1012 in vals.golden.test.mjs), logic/cosmos.js (state cosBroken, cosLbZoom, cosDrag), app.js (one closeTop line before the order loop, one line in componentWillUnmount), the two Cosmos template fragments, selftest-cosmos.mjs (5 new rows: failed card, actual-size lightbox, failed original, drag outline, skipped report), cdp-gate.mjs (six scenarios cosmos-polish-*), and the Cosmos tests that pinned chip rows. vals.hashes.json moved only cosSorts, cosGroups, cosp (golden-diff attributed, every scenario); tpl.hash +3977 chars / +3977 bytes, Cosmos fragments only. No main-process, IPC, preload or data shape change; fake-preload and the fixture were not edited (the scenarios set their own answers).
  Gates, one after another: main+hub+cosmos+mcp+tools+bridge 2470 pass / 0 fail / 0 skips, money 261, renderer 1150, Electron selftest 3349 combos 0/0/0, cdp-gate 93/93 (cosmos-render-budget: first render 162 ms, median re-render 16 ms). Native checks not run (no main-side change).
NOTE: card pictures are loading="lazy", so a missing file only fails once its card scrolls into view; the failed-card scenario scrolls the cards in first.
IN-FLIGHT: none from this dish. ASKS (struct): none. BREAKS: none (additive; the app needs a restart).

---
## 2026-11-13 · FROM frontend (batch 5 dish 3 DONE: the Brief-lines tool) · main @ 2e865eb (not pushed)
DONE: 2e865eb (fe). `node tools/brief-lines.mjs [--data <dir>]` prints up to three plain lines from the local Brief (data/brief.json only) for a SessionStart hook the owner adds themself. Every word comes from dashboard/brief-project.mjs projectBrief (the fixed wording table), so no project name, path, amount, id, ref or rule id is printed; at most three item lines plus one overflow line, under 600 characters. Missing or unreadable file: one "not available yet" line; valid empty Brief: "nothing needs you"; a Brief older than 30 min or with no timestamp: one "out of date" line and no items (so an old list is never shown as current). It reads one file, never writes, spawns or fetches, and always exits 0. New: tools/brief-lines.mjs, tools/brief-lines.test.mjs (12 tests), tools/README.md (shows the settings snippet in text; the app never writes settings). No vals key (renderVals stays 1011), no IPC, no golden, main.js/preload.js not edited.
  Gates, one after another: main+hub+cosmos+mcp+tools+bridge 2470 pass / 0 fail / 0 skips, money 261, renderer 1132, Electron selftest 3339 0/0/0, cdp-gate 87/87.
OWNER STEP (optional): add the SessionStart hook from tools/README.md to your own Claude Code settings if you want every session to open with the Brief.
IN-FLIGHT: none from this dish. ASKS (struct): none. BREAKS: none (additive).

---

## 2026-11-13 · FROM frontend (batch 5 dish 2 DONE: the social read switch) · main @ 1adba24 (not pushed)
DONE: 1adba24 (fe). The extension's automatic 5-minute read of logged-in social tabs is OFF by default; a "social" switch in the popup turns it on (chrome.storage.local hq_social_read; anything but on===true is off, a storage failure is off). New browser-bridge/social-switch.js (worker half: the alarm exists only while on; the tick reads only when on; an alarm an 0.8.0 install left is cleared at bootstrap) and social-switch-popup.js (the toggle and the plain words into #social-auto; no fetch, no token header). background.js: one importScripts line, bootstrap no longer creates the social alarm or reads at start unconditionally, onAlarm goes through the switch, one social:set message branch. Switching on does not read at once (the first read is the next 5-minute alarm); the manual Sync still reads once and does not turn the timer on; a read in flight when the owner switches off finishes. Posting (socialSend, claim, confirm, outbox) and popup.js are untouched. popup.html: the placeholder plus the script tag, placed AHEAD of endpoint-guard.js so popup-tokens' last-six order check needed no edit. manifest 0.8.0 -> 0.9.0 (permissions identical); README Social section says off by default.
  VERSION PINS: the extension manifest is 0.9.0 and the app route /health bridge string stays 0.8.0 on purpose (browser-bridge.test.mjs:132 is not edited; do not bump the route string). The three manifest pins moved in claude-sync-ext, grab-ext and popup-tokens tests only. New dashboard/social-switch-ext.test.mjs: 20 tests, 0 skipped. No vals key (renderVals stays 1011), no IPC, no golden, main.js/preload.js not edited.
  Gates, one after another: main+hub+cosmos+mcp+tools+bridge 2470 pass / 0 fail / 0 skips, money 261, renderer 1132, Electron selftest 3339 0/0/0, cdp-gate 87/87.
OWNER STEP: reload the extension in Chrome for 0.9.0; the periodic social read stays off until the "social" box in the popup is ticked.
IN-FLIGHT: none from this dish. ASKS (struct): none. BREAKS: none (additive).

---

## 2026-11-13 · FROM frontend (batch 5 dish 1 DONE: the Security honesty pass) · main @ 59b9779 (not pushed)
DONE: contract row 2d815a3 (meta), code 59b9779 (fe). The plain-export scan now follows the folders the OS reports for Downloads, Desktop and Documents (Electron app.getPath, lazily, inside dashboard/security-folders.js) AND the home spelling, resolved on every scan, no guessed names, no registry reads; hq:security:scan-exports answers { files, looked, redirected } (three labels and a count, never a path); Health shows "Looked in Downloads, Desktop, Documents (N moved folders followed)". Words: the copy note, the copy toast and the unlock help say the 30 s clear cannot reach Windows clipboard history (Win+V) or a cloud clipboard (unlock: "Type it, never copy it"); hide-from-Claude says it hides from the hq_footprint tool only and the map file stays readable on this PC. No new top-level vals key (renderVals 1011; the new strings ride under secv), tpl.hash +358 chars, vals.golden moved only secv.secCard.hideWording, secDlgHelp, secGenCopyNote, secLookedShow, secLookedText (golden-diff attributed). main.js, preload.js not edited.
  Gates, one after another: main+hub+cosmos+mcp+tools+bridge 2457 pass / 0 fail (13 skips, none in security), money 261, renderer 1132, Electron selftest 3339 0/0/0, cdp-gate 87/87.
OWNER STEP: open Security > Health and read the "Looked in" line on the real machine; a OneDrive-redirected Desktop or Documents should read "1 moved folder followed" or more. That real check cannot run here (invented folders only).
IN-FLIGHT: none from this dish. ASKS (struct): none. BREAKS: none (additive; the app needs a restart).

---

## 2026-11-13 · FROM frontend (BATCH 5 ANNOUNCED: six dishes; the plan is committed, no code yet) · main @ 52db1e1
DONE: plan docs/superpowers/plans/2026-11-13-batch5.md (from the 2026-11-12 backlog, corrected after a critic pass: Jump counts each arrival once and only breaks typed-query ties, Escape never outranks the palette or settings, the extension version pins named, the renderVals fold re-measured first).
IN-FLIGHT: the six dishes, by plain name, in order: the Security honesty pass (scan the real Desktop, Documents and Downloads folders the system reports; plainer clipboard and hide-from-Claude words), the social read switch (the extension's automatic 5-minute read OFF by default with a popup toggle; posting untouched), the Brief-lines tool (a read-only CLI that prints the Brief for a SessionStart hook the owner adds themself), Cosmos polish (selects, failed-picture handling, drag outline, per-phase index rows, fuller import report, Escape in the title field), Jump ordered by measured use (ties only, 14 days, 10 counted opens), and free renderVals keys (a pure move of whole panels under one key each, proven by a before/after dump check).
SHARED FILES this batch will touch (frontend lane; none is structure-owned): dashboard/security.js; dashboard-v5 logic/security.js, vals/security.js, tpl/security.tpl.js and the security tests and cdp-security; docs/sync/IPC-CONTRACT.md (hq:security:scan-exports and hq:quick:read, additive, written before the code); browser-bridge background.js, popup.html, manifest.json (0.8.0 -> 0.9.0), README, plus the three manifest version pins in claude-sync-ext.test, grab-ext.test and popup-tokens.test (the app route /health bridge string stays 0.8.0 on purpose; popup-approval, social-claim, social-cancel tests are not edited); tools/ (brief-lines.mjs, README.md); the cosmos vals/tpl/logic files, app.js (a closeTop line for cosEscape, a space-<id> arrival mark, an unmount cleanup call), selftest.js CLEAR keys, selftest-cosmos.mjs, cdp-gate.mjs registrations, fake-preload.js, cosmos fixture only if needed; dashboard/use-log.js, cast-modes.js, quick-targets.js, cast.js and their tests, dashboard-v5 logic/use-log.js; vals/today.js, delivery-check.js, clients-list.js (and money-start.js if needed) with their templates, vals.golden.test.mjs, __golden__/vals.hashes.json and tpl.hash pins (only moved paths, attributed). renderVals: 1011 now, at most 1012 after Cosmos polish, then at most 1003 after the fold. main.js and preload.js are not edited.
ASKS (struct): none; B1 to B5 carried unchanged. BREAKS: none (additive). Real-world checks left to the owner: the Health "Looked in" line on a machine with a redirected folder; reload the extension for 0.9.0.

---

## 2026-11-11 · FROM frontend (BATCH 4 DONE and pushed: the Security space) · main @ b72c3a5
DONE: contract rows 22b603c, the engine 180267a, the vault reader and store 1d1082f, the doors 76bb833 (hq_footprint, six counts-only Brief rules, the Reach Breach check row), taster fixes 2a892c8, and the space itself b72c3a5 (its integrator ran out of turns before committing; the gated tree was re-gated and committed by the session, with one fix: the unlock field now empties the moment the passphrase is sent). CLAUDE.md gains the Security facts line.
  Final gates on this tree, one after another: main+hub+cosmos+mcp+tools+trailer+bridge 2429 pass / 0 fail / 1 pre-existing skip, money 261/261, renderer 1068/1068, Electron selftest 3339 combos 0/0/0, cdp-gate 87/87 (and the six security-* scenarios again after the fix), cosmos-native.check.js PASS (2 not covered: avif, one webm colour), delivery-check.native.check.js all passed. Privacy scan of every added line since 08c0a8e: 0 names, 0 tokens, 0 personal emails, 0 owner paths. App restarted with tools
ollback.ps1 v5.
  Pending real-world check: the owner’s first Refresh against a real KeePassXC vault (cli flags and XML shape were built from the documented format and an invented fixture). Known gaps: a OneDrive-redirected Desktop/Documents is not scanned; the 30 s clipboard clear does not reach Windows clipboard history; hide-from-Claude hides from hq_footprint only.
IN-FLIGHT: none. ASKS (struct): unchanged. BREAKS: none (additive; a new 11th nav destination).

---

## 2026-11-11 · FROM frontend (batch 4 taster fixes: four real findings fixed; the Security space dish is STILL uncommitted) · main @ 2a892c8 (not pushed)
DONE: 2a892c8 (fe), each fix with a test that failed before it. (1) The script-cli test seam was reachable in the app: a .js/.mjs cli ran as process.execPath (a second Electron app) with the passphrase on stdin, via a hq:security:settings write or HQ_KEEPASSXC_CLI. security-vault.js run() now refuses anything but keepassxc-cli.exe whatever the source unless a test injects `allowScriptCli` (security.js passes deps.allowScriptCli only); security-store.js setSettings accepts only that basename; the seam pins ELECTRON_RUN_AS_NODE=1. (2) no2fa parity: security-core.mjs buildGraph counted twofa "unknown" ("not recorded" chip) as recorded, so status.json / Brief / growth dropped an account the Health screen and hq_footprint flagged; it also read a manual account's twofa from the manual record (the store writes it to owner.accounts[id]) and built a duplicate ghost node for the manual id; manual accounts now follow owner.accounts[id], are one node and leave the graph when archived. (3) hq-icon had no "security" glyph (the rail and More drew Home): shield + keyhole + hover in hq-v3.js, test that every NAV id has an icon. (4) The emergency sheet printed the whole app window: an @media print block in styles/app.css (+ styles/print.test.mjs).
  Gates on this tree, one after another: main+hub+cosmos+mcp+tools+bridge 2411 pass / 0 fail / 0 skips, money 261/261, renderer 1068/1068, Electron selftest 3339 combos 0/0/0, cdp-gate 87/87 (security-setup now also checks the printed layout under emulated print media and Escape with focus outside; security-unlock-clears also checks Escape with focus outside the dialog).
IN-FLIGHT: the Security SPACE dish is still uncommitted in the working tree (app.js, app.tpl.js, catalog, store, shell, palette, vals, selftest, goldens, cast-modes, use-log, fake-preload, cdp-gate and the untracked security-* renderer files). These taster fixes live in it and are NOT in 2a892c8 because they cannot be split from it: (a) Escape closes the unlock dialog and the emergency sheet even when focus is outside them (logic/security.js secEscape(), called first by app.js closeTop(); tests in vals/security.test.mjs); (b) dashboard-v5/src/logic/security-parity.test.mjs (engine / renderer / hq_footprint agree on no2fa, every owner word x vault factor, manual too); (c) the two new cdp checks in tools/cdp-security.mjs. Commit them with the space dish.
ASKS (struct): none. BREAKS: none (additive; the app needs a restart). The keepassxc-cli flags and the XML shape are STILL unverified against a real vault: the owner's first real refresh is the real check.


## 2026-11-11 · FROM frontend (batch 4 dish 4 DONE: the Security doors; hq_footprint, six Brief senses, the Reach Breach check row) · main @ 76bb833 (not pushed)
DONE: 76bb833 (fe). MCP `hq_footprint` (mcp/workspacehq/footprint-read.mjs, tier read, works with the app closed): names, hosts and flags only from data/security/map.json + owner.json; an account hidden from Claude is only counted in hiddenCount (over the whole map whatever q and flag say), a corrupt owner.json answers an error and no rows, no identity/label/username/group/id/vault path ever appears (a scan over every answer proves it). Brief: dashboard/brief-security.mjs adds six rules read from data/security/status.json ONLY (plain-export-found and vault-conflict high and exempt from standing, accounts-breached med, passwords-reused / footprint-stale (30 d, silent until a first refresh) / email-2fa-first low); brief-sources.js reads status.json directly (not the 72 h sidecar gate), brief.js passes it through and watches the security folder, brief-core.mjs places the ids, brief-project.mjs has the six wording rows (counts only; no site, title or file name leaves the main window). Reach: a `breach-check` row (unknown until status.breachCheckedAt is set, never closed); it also shows in hq_activity's doors list (guard.test pinned). Shared edits, all additive: server.mjs, guard.mjs (+ test), server.test.mjs, mcp README, brief-sources.js, brief.js, brief-core.mjs, brief-project.mjs, reach.js, vals/reach.js LABEL, fake-preload REACH_ROWS, selftest rch states, cdp-gate reach-render (4 -> 5 rows). No vals key (renderVals stays at the space dish's count), no IPC channel, no golden or template moved.
  Gates on this tree, one after another: main+hub+cosmos+mcp+tools+bridge 2407 pass / 0 fail / 0 skips, money 261/261, renderer 1061/1061, Electron selftest 3339 combos 0/0/0, cdp-gate 87/87 (button sweep 631 buttons in 431 s, under the 700 s stop line). The first cdp run failed ONLY reach-render (it counted 4 rows): fixed in the gate, not worked around. Not run here (they belong to the after-all-four pass): cosmos-native.check.js, delivery-check.native.check.js, push, restart and the day-log read.
  Contract: the hq_footprint row in CONTRACT.md gains the pinned details (twofa may read `totp` when the owner gave none and the vault shows one; total counts visible matches only; counts.breached and counts.reused are read flat).
IN-FLIGHT: the Security SPACE dish (renderer: catalog, app, templates, vals secv, store, shell, palette, cast-modes, use-log, selftest, goldens, fake-preload security rows, cdp scenarios) is applied in the working tree but NOT committed: the gates above ran on it and its six scenarios pass, but its own commit and HANDOFF entry are still to land. I staged only my hunks of the three shared files both dishes touch (selftest.js, fake-preload.js, cdp-gate.mjs) by building them on HEAD's blobs, so the space dish's hunks in those files are still unstaged; commit them with a plain `git add` of those paths.
ASKS (struct): none. BREAKS: none (additive; the running app needs a restart for the Brief rules and the Reach row; a Claude session needs a new MCP server process for hq_footprint). The keepassxc-cli flags and the XML shape are STILL unverified against a real vault: the owner's first real refresh is the real check, and it is still pending.

---

## 2026-11-11 · FROM frontend (batch 4 dish 2 DONE: the Security vault reader and store; the ten hq:security:* channels are live) · main @ 1d1082f (not pushed)
DONE: dashboard/security-store.js (the ONLY writer of data/security/, atomic, labels and the identity-ref key only through safeStorage, null when it is unavailable), security-vault.js (keepassxc-cli with the passphrase on stdin only, parse -> reduce in memory, the padded HIBP range GET only inside a refresh with the box ticked, name-only export and conflict scans, Recycle Bin move of one listed file), security.js (the ten channels, every one main-window only; no handler logs its args; the clipboard copy clears after 30 s only if unchanged), the fake cli and a test-only testkit; 60 tests, also green against the real security-core. Shared edits, minimal: ONE init line in main.js after the use-log init (safeStorage and clipboard added to the electron destructure; no generic invoke logger exists in main.js or app-log.js, checked before the hook), a security group in preload.js, the empty-state security rows in dashboard-v5/tools/fake-preload.js (fake-parity green; the space dish replaces them with its invented map).
  Gates on this tree, one after another: main+hub+cosmos+mcp+tools+bridge 2400 pass / 0 fail / 0 skips, money 261/261, renderer 1055/1055, Electron selftest 2980 combos 0/0/0, cdp-gate 81/81. No vals key, golden, tpl.hash, use-log surface or data shape moved.
  For the space dish: the walkthrough step that marks "email 2FA done" must be 'email-2fa' (or 'email2fa'); read() returns settings.locked when safeStorage is unavailable; refresh error words are in security-vault.js. Known gaps: the export scan uses the home folder's Downloads/Desktop/Documents (a OneDrive-redirected Desktop or Documents is not followed); a script cli only runs as a test seam (the real one is keepassxc-cli.exe).
IN-FLIGHT: none in code (two dishes remain: the Security space, the doors). The keepassxc-cli flags and the XML shape are STILL unverified against a real vault: the owner's first real refresh is the real check, and it is still pending.
ASKS (struct): none. BREAKS: none (additive; the app needs a restart for the new channels).

---

## 2026-11-11 · FROM frontend (batch 4 dish 1 DONE: the Security engine, pure; contract rows committed) · main @ 180267a (not pushed)
DONE: contract rows (22b603c, meta: data/security/* shapes, MCP hq_footprint answer, the ten hq:security:* channels main-window only, the data/security/ ignore line and its OWNER_DATA pins), then the engine (180267a, fe): dashboard/security-core.mjs + 18 tests + the invented fixture. Pure (no fs, network or Electron); the XML parser fails as 'unreadable export' on any protected value or malformed document; ids from the entry UUID; identity refs are HMAC under a per-install key (none without one); parse-and-drop proven by assertNoSecrets. No shared file touched, no IPC, no vals key, no golden moved.
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2400 pass / 0 fail / 0 skips, money 261/261, renderer 1055/1055, Electron selftest 2980 combos 0/0/0, cdp-gate 81/81.
  For the vault dish: reduceEntries WITH a refKey returns identities[].value (the email or phone, the intended label), so the vault module must encrypt it before anything reaches data/; edge directions, flag rules and the buildGraph extras (breached set, archived owner accounts leave every count) are in the cook's pass notes.
IN-FLIGHT: none in code (three dishes remain: vault reader and store, the space, the doors; each lands with its own shared patch). The keepassxc-cli flags and the XML shape are still unverified against a real vault: the owner's first real refresh is the real check, and it is still pending.
ASKS (struct): none. BREAKS: none (additive).

---

## 2026-11-11 · FROM frontend (BATCH 4 ANNOUNCED: the Security space; the plan is corrected and committed, no code yet) · main @ 08c0a8e
DONE: plan docs/superpowers/plans/2026-11-11-batch4-security.md (design docs/superpowers/specs/2026-11-11-security-space-design.md), corrected after a critic pass (Brief plumbing, a keyed identity ref, main-window-only security channels, the main.js line placement, shell/palette digits, an anchored export-name pattern, an honest XML parser).
IN-FLIGHT: the four dishes, by plain name: the Security engine (pure parse-and-drop, flags, identity refs, graph model), the vault reader and store (keepassxc-cli on stdin, breach check, safeStorage, plain-export and conflict scan), the Security space (footprint map, health, setup walkthrough, generator), and the doors (hq_footprint for Claude, Brief senses, the Reach row). New files only apart from the shared edits below; no code lands before the contract rows commit.
SHARED FILES this batch will touch (frontend lane; none is structure-owned): dashboard/main.js (ONE init line, after the use-log init), dashboard/preload.js (a security group), dashboard-v5 catalog.mjs, app.js, app.tpl.js, vals/index.js, vals/ctx.js, vals/shell.js, logic/palette.js, live/store.js, selftest.js, honesty.test.mjs, tools/fake-preload.js, tools/cdp-gate.mjs, tpl.hash + vals.golden (only the new keys, one key `secv`, and the new fragment), dashboard/cast-modes.js + cast-modes.test.mjs (10 -> 11 spaces), dashboard/use-log.js + test (two new surfaces), mcp/workspacehq server.mjs, guard.mjs, guard.test.mjs, server.test.mjs, README (hq_footprint, names and flags only), dashboard/brief.js, brief-sources.js, brief-core.mjs + brief-core.test.mjs (six rules, goldens gain only those), brief-project.mjs, dashboard/reach.js + reach.test.mjs + vals/reach.js (a breach-check row), .gitignore (data/security/) and tools/gitignore-owner-data.test.mjs pins; docs: CONTRACT.md rows for data/security/*, IPC-CONTRACT.md rows for the ten hq:security:* channels (main-window sender only).
ASKS (struct): none. BREAKS: none for the structure lane (additive; collector/, schema/, spellbook/, run-pipeline.ps1 untouched). One outbound call is added, the Have I Been Pwned range GET (5 hash characters), only inside an owner-pressed Security refresh; the owner's first real refresh is the real check of the keepassxc-cli output shape.

---

## 2026-11-11 · FROM frontend (BATCH 3 DONE and pushed: all seven dishes, taster fixes, full gates) · main @ 8a68bc6
DONE: grabs into Cosmos + hq_library_find, the Today ribbon + hq_today, the Brief mailbox + hq_brief_dismiss, Brief history + all-clear, Save to vault with no model, Machine drift (commits since 6f32be7; see the per-dish entries below), plus the three taster fixes. CLAUDE.md gains the batch 3 facts line.
  Final gates on this tree, one after another: main+hub+cosmos+mcp+tools+trailer+bridge 2305 pass / 0 fail / 1 pre-existing skip, money 261/261, renderer 949/949, Electron selftest 2980 combos 0/0/0, cdp-gate 81/81, cosmos-native.check.js PASS (16 passed, 2 not covered: avif, one webm colour), delivery-check.native.check.js all passed. Privacy scan of every added line since 6f32be7: 0 client names, 0 tokens, 0 owner picture paths, 0 amounts. App restarted with tools\rollback.ps1 v5.
IN-FLIGHT: none. Next: batch 4, the Security space (plan docs/superpowers/plans/2026-11-11-batch4-security.md; its own HANDOFF announcement lands before any code).
ASKS (struct): unchanged (assemble.mjs --no-vault flag; GPU enumeration; --strict-mcp-config for nightly runs; run-pipeline.ps1 takes data/.refresh.lock). BREAKS: none (additive).

---

## 2026-11-11 · FROM frontend (batch 3 taster fixes: three real findings fixed) · main @ d0e4940 (not pushed)
DONE: 45c1095 (the Bridge popup sends the tab title as pageTitle in grab:save, so a clip is named by its page), 4f1551d (hq_library_find skips a manifest entry that is applied:true but gone from library.json: a Recycle-Binned grab is no longer "waiting"), d0e4940 (brief.js compute() is a promise chain: overlapping computes can no longer reach the ledger out of order and double-count an ending). Each has a test that failed before the fix.
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2287 pass / 0 fail / 0 skips, money 261/261, renderer 949/949, Electron selftest 2980 combos 0/0/0, cdp-gate 81/81. No IPC, vals, golden, data shape or contract moved. The app needs a restart for the Brief fix; the extension reload (0.8.0) picks up the title.
IN-FLIGHT: none. ASKS (struct): unchanged. BREAKS: none.

---

## 2026-11-11 · FROM frontend (batch 3 dish 7 DONE: how the PC changed on System > Machine; BATCH 3 CODE COMPLETE) · main @ 0b51b7d (not pushed)
DONE: contract rows (736d99a, meta: data/disk-history.json, the cautions for pc-health-history.json, hq:machine-history:read), then the dish (0b51b7d, fe). System > Machine gets a "How the PC changed" panel: seven small charts from the 96 checks the collector already keeps (CPU, RAM, free disk, startup apps, temp files in GB, ping, days since update; a 0 ping or 0 update age is a gap, never a point), an Estimate the owner presses (refuses below 8 readings, below 14 days or when the line is flat or rising; otherwise "about N days of room, if nothing changes", never "will run out") and "What filled the disk" (folders that grew over 7 days, labels and GB only).
  Main: dashboard/disk-history.js is the ONLY writer of data/disk-history.json (one row per local day, 120 days, atomic, corrupt moved aside, a newer or oversized file never overwritten) and the read-only dashboard/machine-history.js answers hq:machine-history:read with the eight history fields only (never gpuDriverDays, gpuTempC, battery or a path); main.js got ONE line (machine-history init, which also starts the disk copy 5 s after start, off the boot path); preload hq.machineHistory; use mark machine-drift (SURFACES, count 80 -> 85); honesty denylist gains 'will run out'. brief-core and its goldens did not move (the Brief's disk row is unchanged).
  Renderer: the 22 dft* vals ride under ONE top-level key `dftv` (the cook's flat keys would have crossed the 1015 ceiling; renderVals now 1010 keys), the template reads {{ dftv.dftShow }} etc.; the panel is one frozen constant elsewhere, one read per opening of System > Machine and again after Re-examine or Refresh. tpl.hash +6570 chars / +6575 bytes (the fragment exactly); vals.golden re-recorded, every scenario moved only by dftv (golden-diff --allow '^dftv' exit 0); selftest 2960 -> 2980 combos; two cdp scenarios; fake-preload carries the invented checks (a test pins it equal to selftest-drift's).
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2284 pass / 0 fail / 0 skips, money 261/261, renderer 949/949, Electron selftest 2980 combos 0/0/0, cdp-gate 81/81 (button sweep 589 buttons in 404 s: under the 700 s stop line). Not run here (they belong to the after-all-seven pass): cosmos-native.check.js, delivery-check.native.check.js.
  Note for real data: today's data/pc-health-disk.json is partial:true, so "What filled the disk" will say the readings are partial until a complete reading exists; that is honest, not a bug. The app needs a restart for the new IPC channel and the disk copy.
IN-FLIGHT: none. ASKS (struct): unchanged (the assemble.mjs --no-vault flag for a real refresh from a session; nothing else). BREAKS: none (additive).

---

## 2026-11-11 · FROM frontend (batch 3 dish 6 DONE: a chat becomes a vault note with no model running) · main @ a32752f (not pushed)
DONE: contract row (a75b8ce, meta), then the dish (a32752f, fe). Save to vault no longer dead-ends when no local model answers: dashboard/claude-vault.js preview() asks the model first and, on status 'unavailable', falls back to the pure dashboard/vault-draft.mjs template (the owner's first message and the start of Claude's last, masked twice, quoted line by line, [[ neutralised; drafted_by names a template, no model); { id, template:true } forces it (llm.run never called); a model that ran and failed keeps its error. save() untouched (one note, only on Save/Replace).
  Renderer: banner "Drafted from a template: no local model was running. Edit it, then Save.", badge Template, basis line without the model claim, "Draft again with the model" only when a model is reachable; ONE new top-level vals key `vtp` (renderVals now 1009 keys, ceiling 1015: six keys of headroom; machine-drift must nest its dft* under ONE key). tpl.hash +813 chars (extras fragment only); vals.golden: 154 scenarios moved only by vtp and the reworded clVaultTip, 2 new scenarios (golden-diff exit 0). claude-vault.test.mjs's model-offline case now asserts the template fallback.
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2284 pass / 0 fail / 0 skips, money 261/261, renderer 947/947, Electron selftest 2960 combos 0/0/0, cdp-gate 79/79. No IPC channel, preload, MCP or data shape added; the app needs a restart for the main-side fallback.
IN-FLIGHT: none in code (one dish remains: machine drift; new files only). ASKS (struct): unchanged. BREAKS: none (additive).

---

## 2026-11-11 · FROM frontend (batch 3 dish 5 DONE: what the Brief noticed and how it ended; PASS ALONG: the renderVals key ceiling) · main @ 422463c (not pushed)
DONE: contract rows (48adff1, meta), then the dish (422463c, fe). A small ledger (dashboard/brief-ledger.js + pure brief-ledger.mjs, data/brief-ledger.json: refs, rule ids, counts, times; never a key, name, path or text) remembers each Brief row and how it closed (resolved, acted, dismissed, changed, silent).
  Seen two ways: History > Timeline gets an Operator section (last 14 days; a silent or changed close is never worded as fixed), and the Brief panel gets a "N cleared this week, M dismissed" footer plus a one-time all-clear card (only when the Brief is truly empty and something really resolved; "Got it" is the only write the renderer can cause).
  Main: brief.js feeds the ledger AFTER the brief.json write (a failed write makes every close silent) and registers hq:brief-history:read/:ack through its init; main.js passes `ledger:` into the existing briefApi call (one edit, no new line); preload hq.briefHistory; use mark brief-history (use-log SURFACES, count 75 -> 80); brief-core and its goldens did not move; no new History sub-view.
  Renderer: logic/vals/tpl + selftest rows (2932 -> 2960 combos) + 2 cdp scenarios + fake-preload rows. tpl.hash +4187 chars / +4193 bytes (the three fragments exactly); vals.golden: 154 scenarios, the one new key only (golden-diff --allow '^bhs' exit 0).
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2278 pass / 0 fail (6 skips = the vault-template dish's tests waiting for its shared edit), money 261/261, renderer 946/946, Electron selftest 2960 combos 0/0/0, cdp-gate 78/78 (button sweep 587 buttons in 434 s: under the 700 s stop line).
PASS ALONG (matters to machine-drift and vault-template, still to integrate): renderVals() sits at 1008 top-level keys and the cliff is V8's ~1020-property limit. The first cut had 25 flat bhs keys (1032): the dc runtime's sc-for copies the whole vals object per item ({ ...vals, [as]: item }), the object went slow, and EVERY Home render cost ~90 ms instead of ~17 ms (ask-stream, ask-stop-retry and cosmos-render-budget failed; selftest and the rest still passed, so it is easy to miss).
  Fix: the dish returns ONE key, `bhs` (template reads {{ bhs.bhsOpShow }}). A ceiling check now lives in vals.golden.test.mjs (VALS_KEY_CEILING = 1015). Machine-drift and the vault banner key must nest the same way (one object key each, dotted paths in the template; the cook's flat `dft*` keys will fail that test and must be wrapped, the golden then moves only under that one key). 7 keys of headroom remain.
IN-FLIGHT: none in code (two dishes remain: vault template, Machine drift; new files only). ASKS (struct): unchanged. BREAKS: none (additive). The app needs a restart for the ledger (a new IPC channel); the first cold start observes and closes nothing.

---

## 2026-11-11 · FROM frontend (batch 3 dish 4 DONE: a session can dismiss one Brief row, through a mailbox the app decides) · main @ da8992c (not pushed)
DONE: contract rows (d246180, meta), then the dish (da8992c, fe). MCP hq_brief_dismiss({ref}) (tier note, 10 an hour via assist-core LIMITS.noteTools; other note tools keep 30) takes only the 12-hex ref hq_brief now puts on every row (items, overflow, standing; raw key stays). Door (mcp/workspacehq/app-door.mjs):
  app heartbeat first (absent, older than 60 s or dead pid = 'the app is closed, nothing was changed', data/intents not even created), else one atomic request and an 8 s poll for the answer. App side (dashboard/intent-inbox.js, pure rules in intent-core.mjs): claim by rename to .taken, decision table (cap, still top three, never urgent, never secrets),
  brief.js dismissKey (the SAME path as hq:brief:dismiss), ok only when the row really left the Brief; names-only intent.applied audit; a request claimed before a crash is answered 'may have run' and never re-run; stale answers/temp files swept; symlinks, directories, foreign names ignored. main.js: one init line + one stop line (heartbeat removed at quit).
  Shared edits: brief.js dismissKey, assist-core noteTools, guard/server/README/tests in one commit (server.test.mjs and social-claim.test.mjs copy the door, intent-core, brief-project). No IPC, renderer, vals or golden moved.
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2277 pass / 0 fail (6 skips = the vault-template dish's tests waiting for its shared edit; the app-door guard test is now active), money 261/261, renderer 946/946, Electron selftest 2932 combos 0/0/0, cdp-gate 76/76 (button sweep 587 buttons; one earlier full run showed 75/76 with the failing scenario lost to output truncation and a clean rerun passed 76/76: watch for a flaky scenario).
IN-FLIGHT: none in code (three dishes remain: Brief history, vault template, Machine drift; new files only). ASKS (struct): unchanged. BREAKS: none (additive). The app needs a restart for the mailbox; the MCP tool is a separate process a session starts.

---

## 2026-11-11 · FROM frontend (batch 3 dish 3 DONE: where today went on Home) · main @ 4f52cc4 (not pushed)
DONE: contract rows (bc0a229, meta), then the dish (4f52cc4, fe): Home gets a ribbon for one local day (back arrow up to 7 days): Claude in 5-minute blocks per project (blocks, never hours worked), browser focus (no domains), PC awake/asleep from the day log
  (asleep only between a suspend and the next resume or start; a hard kill or silent stretch is "unknown"), commit ticks (git log %ct only, at most 40 tracked repos, 3 s, no shell). A lane with no source says so ("update the Hub", "browser lane is kept for 3 days"), never a zero;
  counts are null when a source could not be read. Main: dashboard/day-ribbon.js (hq:today:read, dayOffset 0..6, nothing read at boot, data/today.json numbers only every 10 min while the app runs); the Hub gets the additive op activityBuckets
  (claude-hub/buckets.mjs; one line each in store.mjs and hub.mjs; INDEX_VERSION and the schema did not move, so the Hub host restarts with the app and an older Hub answers its unknown-op error, which the lane says in words); MCP hq_today (tier read; counts and their age; never a name, site, commit message or path).
  Shared edits: main.js one init line, preload hq.today, use-log SURFACES + today-ribbon, MCP server/guard/README/tests in one commit (server.test.mjs also copies buckets.mjs, which store.mjs now imports), home.tpl one include, vals/index, app.js (mixin + tdyOffset/tdyNamesAt), live/store.js slice,
  selftest rows (2912 -> 2932 combos), cdp-gate import, fake-preload (invented days), honesty denylist 'hours worked'. tpl.hash re-recorded (+6451 chars / +6459 bytes = the fragment's own length); vals.golden re-recorded: 154 scenarios, 34 paths, ALL tdy* (golden-diff --allow '^tdy' exit 0); no other golden moved.
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2272 pass / 0 fail (7 skips are later dishes' tests waiting for their shared edits), money 261/261, renderer 946/946, Electron selftest 2932 combos 0/0/0, cdp-gate 76/76 (button sweep 584 buttons in 431 s: under the 700 s stop line; was 558 in 367 s).
IN-FLIGHT: none in code (the four remaining dishes are new files only, integrated one at a time in order). ASKS (struct): unchanged. BREAKS: none (additive). The app needs a restart for the ribbon (a new IPC channel and the Hub op); the MCP tool is a separate process a session starts.

---

## 2026-11-11 · FROM frontend (batch 3 dish 2 DONE: ask the picture library and the grabs from any session) · main @ e3e4473 (not pushed)
DONE: contract rows (meta), then the dish (fe): MCP tool hq_library_find (tier read), read-only over data/cosmos/library.json + curation.json + clips.json, the SAME search grammar as the Feed and hq_cosmos_search (imports runSearch/effectiveWorks;
  nothing re-implemented). Adds clips (a grab the index has not reached yet = indexed:false), site (host or registrable tail) and since (24h/7d/30d) filters that narrow to clips, where clip|library, one importsFolder per answer, root-relative paths only,
  never bytes/thumb/hash/library root/page URL, hidden never returned; a corrupt clips.json degrades to library rows plus a note. guard TOOL_TIERS, server registration, README and the server + guard tests moved in the same commit.
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2271 pass / 0 fail (7 skips are later dishes' tests waiting for their shared edits), money 261/261, renderer 946/946, Electron selftest 2912 combos 0/0/0, cdp-gate 73/73. No IPC, renderer, vals or golden moved.
IN-FLIGHT: none in code (the five remaining dishes are new files only, integrated one at a time in order). ASKS (struct): unchanged. BREAKS: none (additive; the app needs no restart for this tool, the MCP server is a separate process a session starts).

---

## 2026-11-11 · FROM frontend (batch 3 dish 1 DONE: a grabbed file also lands in Cosmos as a clip) · main @ 223e6da (not pushed)
DONE: owner-data ignores + pins and the CONTRACT rows for POST /library/grab and clips.json (f4415ac, meta), then the dish (223e6da, fe). After a save the owner pressed finishes, Bridge 0.8.0 posts the saved path to the
  loopback bridge (POST /library/grab, paired token and origin, 4 KB body, 120 an hour, names-only audit as library.grab); the app copies the file into data/cosmos/imports as clip-<hash12>.<ext> (a clip is an import: paths.mjs, ids.mjs and the
  cosmos suites did not move), keeps provenance in data/cosmos/clips.json, and after the next index run applies the clip's tags and title. The Downloads original stays. Intake rules live in dashboard/cosmos/clips.mjs; cosmos.js stays the only writer
  of data/cosmos. main.js: the cosmos return is kept and one grab-routes setDeps line added. Four Bridge-version pins moved to 0.8.0 (browser-bridge, claude-sync-ext, grab-ext, popup-tokens tests). No renderer, vals, IPC or golden moved.
  Gates on this tree: main+hub+cosmos+mcp+tools+bridge 2270 pass / 0 fail (7 skips are the other dishes' tests waiting for their shared edits), money 261/261, renderer 946/946, Electron selftest 2912 combos 0/0/0, cdp-gate 73/73, cosmos native check PASS.
IN-FLIGHT: none in code (the other six dishes are written as new files only and are integrated one at a time, in order; no shared file of theirs is touched yet).
ASKS (struct): unchanged (assemble.mjs flag for a raw refresh from a session; nightly --strict-mcp-config; run-pipeline.ps1 takes data/.refresh.lock; GPU enumeration). BREAKS: none (additive). OWNER STEP: reload the extension (0.8.0) after the push; grab one picture and open Cosmos (set a Cosmos folder first).

---

## 2026-11-11 · FROM frontend (batch 3 PLANNED: grabs into Cosmos, ask the library from a session, Today ribbon, Brief mailbox, Brief history, vault note without a model, Machine drift; no code yet) · main @ 6f32be7
DONE: plan only, docs/superpowers/plans/2026-11-11-batch3.md (seven dishes, order, promises, owner steps). No code, no data shape moved yet.
IN-FLIGHT: none in code. Planned dishes, in order: a grabbed file also lands in Cosmos (grab into Cosmos); ask the picture library and grabs from a session (library find);
  where today went on Home (Today ribbon); a hardened mailbox so a session can dismiss a Brief item (Brief mailbox); what the Brief noticed and how it ended, plus the all-clear (Brief history);
  save a chat to the vault with no local model (vault template); how the PC drifted (Machine drift).
SHARED FILES THIS BATCH WILL TOUCH (announced now, before code): docs/sync/CONTRACT.md + IPC-CONTRACT.md (POST /library/grab, data/cosmos/clips.json, clips land in data/cosmos/imports as clip-<hash12>.<ext>, data/today.json,
  data/intents/*, data/brief-ledger.json, data/disk-history.json, the Hub op activityBuckets, the hq_library_find / hq_today / hq_brief_dismiss answers, an additive ref on hq_brief rows, hq:today:read, hq:brief-history:read|ack,
  hq:machine-history:read, an additive { id, template } argument and drafted field on hq:claude-vault:preview); .gitignore + tools/gitignore-owner-data.test.mjs (data/today.json*, data/brief-ledger.json*, data/disk-history.json*, data/intents/);
  dashboard/main.js (one init line each: grab routes + keep the cosmos return, day ribbon, intent inbox, machine history; the ledger rides inside the existing brief init call); dashboard/preload.js; dashboard/browser-bridge.js (one mount line, Bridge 0.8.0);
  dashboard/cosmos.js (addClip, post-index tag/title); dashboard/brief.js (dismissKey, ledger hook); dashboard/assist-core.mjs (per-tool note limit); dashboard/claude-hub/store.mjs + hub.mjs (additive op); dashboard/claude-vault.js; dashboard/use-log.js (three surfaces);
  mcp/workspacehq/server.mjs + guard.mjs + server.test.mjs + README (three tools, one at a time); browser-bridge/grab.js, grab-rules.js, manifest.json, README (Bridge 0.8.0); dashboard-v5 shared files (src/vals/index.js, src/app.js, src/tpl/home|history|brief|system|claude.tpl.js,
  fake-preload.js, cdp-gate.mjs imports, selftest runner list) with tpl.hash and vals.golden re-recorded for the new prefixed keys only. paths.mjs and ids.mjs are NOT touched. Not touched: collector/, schema/, spellbook/, run-pipeline.ps1, ~/.claude, the vault.
ASKS (struct): new: assemble.mjs needs a flag (for example --no-vault) that reads the previous report, writes only data/latest.json and skips the Workspace Status write and the daily-note injection, with a CONTRACT entry, so a real refresh from a session can exist (not built here; hq_scan_trigger stays collector-only).
  Unchanged: nightly --strict-mcp-config; run-pipeline.ps1 takes data/.refresh.lock; GPU enumeration (Machine drift leaves out GPU driver age until it lands). BREAKS: none planned (all additive).

---

## 2026-11-11 · FROM frontend (batch 2 rest DONE: tasting fixed, final gates, PUSHED, live app restarted) · main @ bf195b2
DONE: six dishes, each committed on its own (delivery check, Clients list, act on a Brief row + the waiting-session sense, sessions
  launched with the tools, Ctrl+Alt+X jump anywhere, Money in words). Six tasters found 0 high, 3 med, 15 low; one fixer landed the
  three meds (bf195b2): the delivery check also probes [::1] (Vite on newer Node listens there only), a launch prompt starting with a
  dash is prefixed so claude never reads it as an option, and hq_brief drops money-sourced rows while Money access is off.
  Final gates, one after another: main 1983 (1982 pass, 1 pre-existing trailer skip), money 261/261, renderer 822/822, Electron selftest
  2912 combos 0/0/0, cdp-gate all PASS, cosmos native check PASS, delivery-check native check PASS. Privacy scan of the batch: clean.
  CLAUDE.md gains the batch's facts line.
IN-FLIGHT: none. OWNER STEPS: Settings › Money for Claude stays off until you turn it on; try Ctrl+Alt+X, Projects › Clients, and one
  delivery check against a client dev server; the Bridge pairing and Cosmos import steps from earlier batches still stand.
ASKS (struct): unchanged (nightly --strict-mcp-config; run-pipeline.ps1 takes data/.refresh.lock; GPU enumeration). BREAKS: none (additive).

---
## 2026-11-11 · FROM frontend (batch 2 rest DONE: Money reaches Claude sessions as words only, off until the owner turns it on) · main @ 8a8a7ad (not pushed)
DONE: Settings gains one card with a switch (off on a fresh install) for "Claude sessions may read Money (words only)"; MCP tool hq_money_today (tier read) answers { enabled:false, error } as an error while off and words and counts only
  once on (set up or not, room ok/tight/unknown, days to payday, bills late, bills due soon, slips waiting), never an amount, account, payee, note, bill name or jar. dashboard/money-access.js is the only writer of
  data/money/access.json {v:1,on,at}; the MCP reader (mcp/workspacehq/money-read.mjs) reads state.json read-only and only while the switch is on (CONTRACT.md's older "the server never reads money data" is revised there).
  The guard lets a clean refusal carry its own answer object (e.payload) so a session still reads enabled:false. Re-recorded and attributed: the template hash (+1966 chars, the fragment) and the vals golden (18 new mac keys
  on every scenario, nothing else). The use-log gains the money-access surface (action act).
  Batch 2 rest is complete: delivery check, Clients list, Brief actions + session-waiting rule, launch tools, quick jump, Money words. Gates on this tree: main 1961/1961, money 261/261, renderer 822/822, selftest 2912 combos 0/0/0,
  cdp-gate 73/73, cosmos native PASS, delivery-check native PASS. NOT done by the integrators: the push, and restarting the owner's app (tools\rollback.ps1 v5), so the first use marks are still to be read from the day log.
IN-FLIGHT: none.
ASKS (struct): none. BREAKS: none (additive; hq_money_today is a new tool, no Money data shape moves).

---

## 2026-11-11 · FROM frontend (batch 2 rest: quick jump landed - Ctrl+Alt+X shows what needs you, then jumps anywhere) · main @ 6bbec29 + this work
DONE: the quick-run palette (Ctrl+Alt+X) gains two things, nothing removed. With an empty query up to three "Needs you" rows lead the spell list (the tray's screen-safe wording only; Enter opens the app where it is cleared, or runs Scan now),
  and Tab switches to Go mode: every space and sub-view, plus projects by name once a character is typed. A Go row only navigates, it never runs anything. New files dashboard/quick-targets.js (main side, three IPC channels
  hq:quick:read|open-brief|open-go) and dashboard/cast-modes.js (pure half the page loads); shared edits are one init line in main.js, hq.quick in preload.js, cast.html + cast.js (absent cast-modes.js = the old palette), the
  quick-jump use-log surface, the fake preload stand-in, and the IPC-CONTRACT rows. The cast window loads the SAME shared preload as the main window, so protection is the sender check on every handler, not a narrow bridge.
  quick-targets-parity.test.mjs pins the Go table to catalog.mjs NAV/SUBS (Projects > Clients included, exact). Tab order tie-break for "run" is a fixed table (Money > Runway first); a use-log-driven override is not built.
IN-FLIGHT: Money words (mcp guard.mjs/server.mjs, money-access.js) - this batch only.
ASKS (struct): none. BREAKS: none (additive; no data shape moves, no golden moved).

---
## 2026-11-10 · FROM frontend (batch 2 rest: launch tools landed - quest and project sessions carry the workspacehq tools in an explicit permission mode) · main @ 544c2d3
DONE: sessions the app opens from a quest or project now run `claude "<prompt>" --permission-mode default [--mcp-config <tmp>]` through dashboard/claude-launch-tools.cmd (dashboard/launch-tools.js builds the args;
  claude-launch.js takes opts.tools; main.js: one create line, { tools } on the hq:claude-quest launch, sweepStale() at startup, cleanup() in the existing before-quit). Outside this repo the session gets a per-launch
  hq-launch-mcp-*/mcp.json in the OS temp dir (24 h life, swept only when older; never a settings write, never --dangerously-skip-permissions; the old claude-launch.cmd stays for a one-step rollback).
  Earlier this batch: delivery check, Clients list, Brief actions + session-waiting rule (see their commits). Still to land: quick jump, Money words.
IN-FLIGHT: quick jump (cast.html/cast.js), Money words (mcp guard.mjs/server.mjs) - this batch only.
ASKS (struct): none. BREAKS: none (no data or IPC shape moves; the hq:claude-quest row gains a description of the tools and mode).

---
## 2026-11-10 · FROM frontend (batch 2 rest PLANNED: delivery check, Clients list, Brief actions, launch tools, quick jump, Money words; no code yet) · main @ 36d1344
DONE: the plan docs/superpowers/plans/2026-11-10-batch2-rest.md (six dishes, ordered by what the use log shows is opened: delivery card 3, Brief 3, sessions strip 2).
IN-FLIGHT (announced BEFORE code; new files first, shared edits only in the Pass). The dishes by plain name:
  1 check the client site on a phone and in three languages (local dev server only), 2 a Clients list, 3 act on a Brief row + the Brief notices a Claude session waiting on a tool,
  4 sessions the app opens carry the workspacehq tools in an explicit permission mode, 5 Ctrl+Alt+X: what needs you, then jump anywhere, 6 Money reaches Claude as words only (off until turned on).
  SHARED FILES THE BATCH WILL TOUCH: dashboard/main.js (one init line per dish; sessions-board and brief init order), dashboard/preload.js (hq.deliveryCheck, hq.delivery.clients,
  hq.brief.act, hq.quick, hq.moneyAccess), dashboard/use-log.js (surfaces delivery-check, clients-list, brief-act, quick-jump), dashboard/delivery.js (summaries()), dashboard/brief-core.mjs
  (rule session-waiting, an exported KEYS table, ctx.sessionBoard), dashboard/brief-project.mjs (one wording row), dashboard/brief.js, dashboard/sessions-board.js (optional onBoard callback),
  dashboard/claude-launch.js (+ test), dashboard/cast.html + cast.js, mcp/workspacehq/{guard,server}.mjs (+ tests, README: tool hq_money_today), dashboard-v5 (catalog.mjs Clients sub-view,
  projects/project-page/brief/ov-settings templates, vals/index.js, app.js, fake-preload.js, selftest states, cdp-gate scenarios), README.md, docs/sync/{CONTRACT,IPC-CONTRACT}.md, .gitignore.
  NEW GITIGNORE PATTERN: data/delivery/ (check reports and phone-size shots; with an OWNER_DATA test pin for one temp name). NEW IPC: hq:delivery-check:detect|run|read|forget, hq:delivery:clients,
  hq:brief:act, hq:quick:read|open-brief|open-go, hq:money-access:read|set. NEW DATA: data/delivery/ and data/money/access.json {v:1,on,at} (Money data becomes readable from MCP, only while that
  switch is on; CONTRACT.md's money section says the server never reads it today, so this is the announcement). BRIEF: new rule id session-waiting, additive item.acted {verb,at}, new brief input sessionBoard;
  no golden is expected to move (a moved golden is a bug, not a re-baseline).
  No network beyond 127.0.0.1 in any dish; no edit to ~/.claude, collector/, schema/, spellbook/ or the vault.
ASKS (struct): none. BREAKS: none yet (additive).

---
## 2026-11-09 · FROM frontend (batch 2 Cosmos: tasting fixed, gates re-run, PUSHED, live app restarted) · main @ 6e135f1
DONE: four tasters (engine, main + search, renderer, gates) found 0 high, 2 med, 14 low; one combined fixer landed both meds (6e135f1):
  the walk caps per root, so a full pictures folder no longer starves data/cosmos/imports; a damaged curation.json with no usable .prev
  puts the session on hold (reads warn, writes refuse) instead of letting the next write start from an empty document. Lows judged
  not code defects (ids follow paths, the native-path risks needing the owner's machine, the known UI gaps listed below) stay open.
  Final gates, one after another on this tree: main 1786 (1785 pass, 1 pre-existing trailer skip), money 253/253, renderer 743/743,
  Electron selftest 2764 combos 0/0/0, cdp-gate 59/59, cosmos native check PASS (16 passed, 0 failed, 2 not covered: AVIF has no
  offline encoder, video first-frame colour is off so video thumbnails stay off). Privacy scan of everything batch 2 added: 0 names,
  0 secrets, 0 owner picture paths. Three older entries' "tools\rollback.ps1" had been written with a raw carriage return; fixed.
IN-FLIGHT: none. OWNER STEPS: export the Cosmos Local backup first (the only copy of the curation); press 0, Index a folder ->
  C:/Users/ROG STRIX/Pictures exactly; then Import from Cosmos Local (the backup, then the old manifest) and read the report.
ASKS (struct): none new. BREAKS: none (additive).

---
## 2026-11-09 · FROM frontend (batch 2 DONE: the Cosmos space on key 0, on main; not pushed) · main @ f442b05 + the gates commit
DONE: seven dishes, each its own commit: search grammar + MCP hq_cosmos_search (cc9710f), index engine (cbcc44c), native thumbnails + Electron check (18007f4),
  main-side engine + IPC (7e9f076), renderer brain (11dfaad), Feed/lightbox/index overlay/report templates (f442b05), and the gates (this entry's commit: the invented
  library pasted into fake-preload.js, the selftest states, eight cdp scenarios, FEED_PAGE = 250). Gates, sequential on the final tree: main 1765/1765, money 253/253,
  renderer 743/743 (no skips), selftest 2764 combos 0/0/0, cdp-gate 59/59 (51 old + 8 cosmos). The goldens moved only in the earlier dishes (each attributed there).
MEASURED (cosmos-render-budget, 1,000 works, 985 visible): UNPAGED failed (first render 1,604 ms vs 400; median of 9 unchanged re-renders 41 ms vs 40), so
  FEED_PAGE = 250 was set and re-run: first render 155 ms, median unchanged re-render 19 ms, a narrowing keystroke 48 ms (budget 150), 0 builds while on Home.
  The global button-sweep now walks 35 screens (558 buttons, 367 s, under its 900 s ceiling); the Feed takes the first 3 cards, cosmos-button-sweep takes the rest (184 buttons, 52 s).
  The selftest takes ~165 s in the page (~12 s of it the 26 Cosmos states x 2 themes); dev-main.js SELFTEST_MS went 180000 -> 300000 so a busy machine does not time it out.
FIXED IN THE GATES DISH: the Feed's ResizeObserver read the grid width synchronously and the re-layout fed the observer back (the browser's "ResizeObserver loop
  completed" error, 4 per selftest): the read now happens on the next frame. The fixture's video originals carry no data: URL (the page CSP lets media load only from self and file:).
RECORD (cosmos-native): the hidden-window VIDEO thumbnail capture is NOT proven (the check's webm came back #3ffa00 where #00ff00 was drawn), so planFor's chromium-video
  strategy is OFF by default (makeDeps({videoFallback}), false); a video with no shell thumbnail has thumb: null and renders from its original. BMP goes shell then chromium (nativeImage cannot read it).
  Still unverified: whether the shell returns a file-type icon for formats Windows has no thumbnail handler for; if rare formats show odd colours, reorder planFor in decode.mjs.
KNOWN UI GAPS (a later pass; each needs a vals key then a template edit): sort/group are chip rows not selects; the lightbox shows no file size, swatch or palette strip and no
  message when the original fails to load; a card thumbnail has no fallback to the original; Esc in the title input falls through to closeTop; no drag highlight (drop works);
  the index overlay shows one progress string, not four phase rows; the report lacks seeded/re-keyed/skipped lines; the Feed shows only file: and data: pictures (index.html CSP).
IN-FLIGHT: none. ASKS (struct): none. BREAKS: none (additive; key 0 gains a destination, the MCP gains hq_cosmos_search). OWNER STEP: restart the app (tools\rollback.ps1 v5), press 0,
  choose the pictures folder and Start; the real library has never been indexed on this machine by a gate (the gates run on the invented one).

---
## 2026-11-08 · FROM frontend (batch 2 started: the Cosmos space on key 0) · main @ 0572b38
DONE: the plan docs/superpowers/plans/2026-11-08-cosmos-batch2.md (7 dishes, three cook waves) from the Cosmos design and its
  port package; the owner asked "start batch 2 with the cosmos space".
IN-FLIGHT: batch 2 Cosmos cooking (new files only until the Pass): dashboard/cosmos/*.mjs (index engine, native adapters),
  dashboard/cosmos.js (+ helpers), dashboard/cosmos-native.check.js, dashboard-v5/src/logic/cosmos-*.mjs (search, layout),
  the renderer slice/vals/logic/templates, the gates (an invented library generator, selftest states, cdp scenarios), and
  MCP hq_cosmos_search. Then, in the Pass, edits to: dashboard/main.js (one hook), preload.js, use-log.js, fake-preload.js,
  tools/cdp-gate.mjs, src/selftest.js, src/app.js, app.tpl.js, live/catalog.mjs (NAV[9] cosmos, key 0), live/store.js,
  logic/palette.js, logic/whats-new.js, vals/{index,shell,ctx}.js, elements/hq-v3.js, the goldens, mcp/workspacehq/{guard,
  server}.mjs (+ tests, README), docs/sync/{IPC-CONTRACT,CONTRACT}.md (additive As-built notes), README.md, CLAUDE.md.
ASKS (struct): none. BREAKS: none yet (additive; key 0 gains a destination, nothing else moves).

---
## 2026-11-08 · FROM frontend (kitchen batch 1 DONE — pushed, live app restarted) · main @ 979ae10
DONE: all 8 dishes of the 2026-11-07 roadmap, each committed on its own with its tasting fixes: the assistant's rulebook and
  use counter; recall of past Claude chats on an index that can't be wiped; the Brief's six senses, overflow and tray rows;
  the Claude sessions board with Resume; Bridge 0.7.0 (pairing, the Brief on the toolbar, Find the best version); Money's
  one-minute start and quick spend line; client delivery on the project page; Cosmos step one (on main after the owner's
  yes). The owner's 2026-11-08 yeses also landed: Bridge saves one file per click on every site (no grab-all anywhere;
  BLOCKED_SITES empty), standing Brief items step aside after 72 h (secrets exempt), and the delivery link follows the
  production branch (only ready deploys). Gates (sequential, final tree): main 1366 (1365 pass, 1 pre-existing trailer skip),
  money 253/253, renderer 480/480, selftest 2636 0/0/0, cdp-gate 51/51. CLAUDE.md gains the batch's facts line.
IN-FLIGHT: none. The hold/cosmos-core branch and its worktree are removed (their commits are on main).
OWNER STEPS: reload Bridge 0.7.0 in the browser (accept "Manage your downloads"), pin it, Pair and Allow the matching code;
  pin the tray icon. Optional, owner-gated: the user-scope MCP command (after the nightly-run flag below lands).
ASKS (struct): (1) the nightly runs get --strict-mcp-config; (2) run-pipeline.ps1 takes data/.refresh.lock like Scan does,
  so a nightly pass and a session's raw pass never run the collector together; (3) the GPU enumeration for Machine drift.
BREAKS: once the Bridge is paired, the token is required on every bridge route and CORS reflects only the paired origin;
  until then today's unpaired extension keeps working. brief.json gains overflow, count and standing (additive).

---
## 2026-11-08 · FROM frontend (kitchen fix: Bridge saves only pictures and plain videos; standing Brief items) · main
DONE: fixes from the taster's pass over the two approved follow-ups (no new feature, no data shape changed).
  Bridge (browser-bridge/grab-rules.js, grab.js): only pictures (.jpg .jpeg .png .gif .webp .avif .bmp .tiff .ico, or a link naming no type) and .mp4/.webm/.mov are saved - an .svg, .html, .exe, .lnk or
  ?format=bat is refused ("Can't save this type of file"), also for variants and guesses; a video link naming no type says "Can't tell this video's type" (not "streamed"); X-style ":orig" links keep their type
  in the file name (AB.jpg, not AB.jpg_orig); a GUESSED size that finishes as a web page (a 200 soft-404 when the HEAD could not run) is deleted again and the next size tried; BLOCKED_SITES gains
  tiktokcdn-eu.com, ibyteimg.com, byteimg.com, byteoversea.com, fb.com, fb.watch. The extension popup's Needs-you view no longer says "Nothing needs you" while items stand (assist.js).
  Brief (dashboard/brief.js, tray-brief.js, dashboard-v5/src/vals/brief.js): an item that left the brief and came back starts a fresh 72 h clock (brief-state.json firstSeen rows gain an optional "gone" mark, set by the
  first computation that finds the key off the brief; it clears if the key is live again within an hour, otherwise the row is dropped; a closed app leaves no mark, so it is not a gap). With only standing items, Home,
  the tray line, the tooltip and the extension say "Nothing new" (with the standing count and date), never "Nothing needs you". The Home line says "Standing, oldest since 5 Nov:" when several stand ("Standing since" for one);
  each item's own date stays in its tooltip. Not done on purpose: no Dismiss for a standing item (it is one click from where it is cleared); the badge/high counts still count fresh items only.
  Tests: brief (2 new), tray-brief (1), assist-ext (1 line), renderer brief logic (2), grab-download (6 new, one old pin on an untyped video changed). CONTRACT unchanged.
IN-FLIGHT: none. OWNER STEP: reload the extension at chrome://extensions and restart the app (tools\rollback.ps1 v5).
ASKS: none. BREAKS: none.

---

## 2026-11-08 · FROM frontend (kitchen batch 1: standing Brief items step aside after 3 days) · main
DONE: the owner's yes ("Brief items that stay unchanged for 3 days step aside, so new ones get the 3 slots; security items like secrets are exempt") is built.
  The engine (dashboard/brief-core.mjs, pure) moves an item whose exact key has been on the brief 72 h or more (brief-state firstSeen[key].first; 71 h stays, 72 h steps aside)
  into a new brief.json list `standing` ([{...item, since}], ranked as before). `secrets` never steps aside; a dismissed key never counts; a worse value is a new key and starts fresh.
  `more` counts only the fresh items hidden from the top 3 (standing ones are not in it), so a fresh item rises into the slots. shouldToast is untouched. brief.js prunes firstSeen before
  the engine reads it and stamps standing keys too. Home: one line under the items, "Standing since 5 Nov: <text> · <text>", each item a button to where it is cleared. The tray and the
  screen-safe projection get only "2 standing since 5 Nov" (a count and the oldest date, no names; the bridge route passes the same three fields). MCP hq_brief returns `standing` too.
  Tests: brief-core (9 new), brief-project, brief, tray-brief, tray-menu, assist-bridge-routes, mcp server, renderer vals (3), selftest rows brief-standing-1 / -2 / -only, cdp scenario brief-standing
  (the fake preload's BRIEF keeps its 3 items and more: 2, and gains only standing: []). Goldens: the template hash moved (+957 chars / +959 bytes, the one standing block) and all 152 vals
  scenarios moved ONLY by the three new keys brfHasStanding / brfStanding / brfStandingLead (tools/golden-diff.mjs: every change attributed); both re-recorded. CONTRACT, IPC-CONTRACT and the operator spec updated.
IN-FLIGHT: none. OWNER STEP: restart the app to load it (tools\rollback.ps1 v5). Keys already in data/brief-state.json keep their first time, so an item the app has shown for 3 days steps aside at once.
ASKS: none. BREAKS: none (additive: `standing` in brief.json, hq:brief and the projection).

---

## 2026-11-08 · FROM frontend (kitchen batch 1: Bridge 0.7.0 saves the image or video you click) · main
DONE: the owner's yes ("the Bridge may download the image or video I click, and check the same site for a bigger version, only when I click") is built. The 0.7.0 manifest (version NOT bumped again:
  0.7.0 has not reached the owner) also asks for `downloads` (Chrome: "Manage your downloads"). In "On this page" each row gets one Save button; a press sends one `grab:save` message and the service worker
  (grab.js) saves that file with chrome.downloads into Downloads/WorkspaceHQ/grabs/<image host>/ (uniquify, no Save As, a sanitized name), falling back down the candidate list; the row says queued, saving,
  saved to Downloads/WorkspaceHQ/grabs/<host>/, or could not save (tried N sizes). The queue lives in chrome.storage.session (a worker restart resumes it; a download event or the hq-grab alarm wakes the worker),
  at least 1 s passes between any two requests, one entry per message, at most 10 waiting, and there is no save-all anywhere. The only network call is one HEAD (no cookies, no referrer, no redirects) on a
  GUESSED bigger version on the image's own host, made only after Save; a page-offered copy on another host and the original are never checked. Plain .mp4 .webm .mov save; blob: and streamed video say they need the video helper.
  DECISION TO CONFIRM: the owner's limit named Instagram, Facebook and TikTok. The task wording could mean only "no save-all there"; there is no save-all at all, so I read it as the safer thing: nothing is saved from those
  sites (page or file host, CDNs included), the row says why, and Copy still works. The list is BLOCKED_SITES in browser-bridge/grab-rules.js; delete entries to lift it.
  Tests: dashboard/grab-download.test.mjs (new, 22) and grab-ext.test.mjs / popup-tokens.test.mjs (the "no downloads" pins now expect it). README updated. No data shape changed, so CONTRACT.md has no entry.
IN-FLIGHT: none. OWNER STEP: reload the extension at chrome://extensions (Chrome asks about "Manage your downloads"), then right-click an image, press Save.
ASKS: none. BREAKS: none (extension-only; no route, IPC or data/ change).

---
## 2026-11-08 · FROM frontend (kitchen batch 1: Cosmos step one moves onto main — the owner said yes to publishing) · main @ f46b0c2
DONE: the owner answered the three before-cooking questions on 2026-11-08: yes to publishing the ported Cosmos code, yes to
  download on click in the Bridge, yes to standing Brief items stepping aside after 3 days. So the HOLD is lifted: the Cosmos
  files from hold/cosmos-core (dashboard/cosmos/*.mjs + tests, the Cosmos spec and plan) land on main as fresh commits, with
  the README test line and the dated data/cosmos/ CONTRACT section + the ten hq:cosmos:* IPC-CONTRACT rows joined in by hand
  (both sides were additive). The hold branch and its worktree are no longer needed and get removed after the push.
IN-FLIGHT: the two follow-ups the yeses unlock (Bridge stage 3: download on click; the Brief's 72 h step-aside), then the
  batch's final gates, push and live restart.
ASKS (struct): none new. BREAKS: none (additive; dashboard/cosmos/ is new and nothing loads it until batch 2).

---
## 2026-11-08 · FROM frontend (kitchen batch 1, dish 7 tasting fixes: client delivery) · main
DONE: the link to send is now the deployed branch's newest READY deploy (the deployed branch = the newest ready production deploy's); a failed, building or work-in-progress-branch preview is never offered,
  a newer ready preview elsewhere is named on the card ("not the deployed branch"), no production deploy at all falls back to the newest ready preview, and nothing ready says so with state and age. Copy update
  records the hashes of the text that was copied (an item finished after the card loaded is still reported next time). App-kept items are hashed by their id. hq_delivery's project lookup takes a unique
  prefix or part of an id or name and says "ambiguous" with the matching ids. Each with a test that failed before; vals golden moved only by the new dlvLinkNewer key, tpl.hash +179 chars.
IN-FLIGHT: none.
ASKS: none.
BREAKS: none (additive: link.basis, link.newer, view.doneHashes, copied.doneHashes; IPC-CONTRACT has the row).

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 5 tasting fixes: WorkspaceHQ Bridge 0.7.0) · main
DONE: unauthenticated bridge calls can no longer flood data/assistant-audit.jsonl or pick tool names: only a request that proved the token is audited as assist.brief / assist.open (pair on
  success); every earlier refusal is one fixed assist.refused (pair for a failed /pair) with a budget of 20 records an hour. The popup's "On this page" spends the right-click target on its
  first read and uses it only while that tab is the one the owner is on (otherwise the active tab is scanned, so a closed clicked tab no longer reads "No page to read"). The button says
  "Copy guessed link" when the first link is a guess. Each with a test that failed before. Not changed: the pair-while-app-down window (any local impostor can answer a /health check, so a
  pre-check would only change the wording; the spec accepts the window).
IN-FLIGHT: none.
ASKS: none.
BREAKS: none (the audit log gains the tool name assist.refused).

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 1 tasting fixes: the assistant's rulebook) · main
DONE: the app's post-commit rescan (hq:do-commit) now takes data/.refresh.lock like Scan now, so a session's raw pass and the app never run the collector together; a stale lock is
  replaced under a short `.refresh.lock.reclaim` gate (two takers can no longer both win it); the audit log's rotation looks again right before renaming (two writers can no longer wipe .1);
  Reach's bridge row says paired only for a pairing file the bridge accepts plus a non-empty data/.bridge-token; the phone row's boot/start time carries its day when not today;
  hq_activity's door rows no longer carry the `copy` command (it holds the install path; the Settings Copy button keeps it); the usage counter counts a page only while it is visible
  (a hidden or tray window waits for its first show); a refused Scan now says a session's raw pass may be running. Each with a test that failed before.
IN-FLIGHT: none.
ASKS (struct): run-pipeline.ps1 (the nightly run) still takes no lock, so an hq_scan_trigger during it can run the collector together with it. Please have it take/skip on data/.refresh.lock
  (JSON { pid, by, startedAt }; by must be 'app' or 'mcp', use 'app'; stale = pid gone or older than 15 min; create with flag wx, see dashboard/refresh-lock.js). The tool description, README and CONTRACT row say it is not covered yet.
BREAKS: none (additive; hq_activity door rows lose the `copy` key).

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 7 of 8: client delivery on each project page) · main
DONE: every project page gets a Client delivery card before its Claude section. Unmarked: "Is this a client job?" with a Mark button, plus the repo's own checklist files as sources
  the owner may pick (nothing is picked automatically); picking one on an unmarked project is plan mode ("Plan: N of M done", no link, no update). Marked: what's left against
  the agreed scope from an honest source only (the owner-picked checklist file in the repo, else a checklist kept in the app, else SCOPE.md at the repo root; never TODOs, roadmap or
  insights), the newest link to send (that project's own Vercel preview, else production, with state and age; "No Vercel project linked to this repo" is its own state) and a
  deterministic update to paste; Copy update puts it on the clipboard, then records ONE `copied` so the next update lists only what was finished since. Nothing is sent, nothing
  is written to the client's files. Main: dashboard/delivery-core.mjs (pure engine, injected io), dashboard/delivery.js (hq:delivery:read|apply, the only writer of
  data/delivery.json, Money's idiom: validated intents of at most 16 KB, tmp then rename, corrupt files quarantined as .corrupt, -2, -3); main.js has one init line after the
  sessions-board hook, preload has `delivery`. MCP hq_delivery (read tier, mcp/workspacehq/delivery-read.mjs, sync, read-only, works with the app closed, marked projects only;
  server.test.mjs copies delivery-read.mjs, delivery-core.mjs and project-paths.js). Renderer: vals prefix dlv* (taken), deliveryLogic mixin, store.live.delivery +
  refreshDelivery/applyDelivery (a refused write or a failed read never blanks a card already shown), the fragment tpl/delivery.tpl.js before the Claude section, the card reads on
  arrival (and on a restored project page). Usage marks go through useMark('delivery-card', 'open') and ('delivery-card', 'copy'). Fix to the cook's work: it called useMark with one
  argument ('copy' as a surface would have been dropped by the allowlist); it now sends the allowlisted surface with the action. Fake preload has a small stateful stand-in for main
  (invented alpha-site / beta-app / gamma-tool / delta-lib; any other id starts unmarked), selftest +12 states (dlv-*), cdp-gate +5 scenarios.
  Gates: main 1136 pass / 0 fail, money 251/251, renderer 473/473, selftest 2630 combos 0/0/0, cdp-gate 50/50. Goldens: all 152 vals scenarios moved only by the dlv*/onDlv* keys
  (golden-diff attributed); the template grew by exactly +15482 chars (the card fragment), tpl.hash re-recorded with a dated line. The cook's own 48 tests are in the counts.
IN-FLIGHT: none from this dish. One dish follows in Pass order. Not exercised on the owner's PC: the card against the real data/ (no project is marked, no SCOPE.md exists in the 24 scanned
  projects), the real Vercel link pick for the 3 projects whose repo matches, phone-size and Arabic / French / English checks (the spec says they come next).
ASKS (struct): none. BREAKS: none (additive). accounts.json's deploys[] is read from `vercel.deploys` (where it really sits; a top-level `deploys` is the fallback), IPC-CONTRACT's
  Client delivery section gains an "As built" paragraph for that, the additive view fields and the source order.

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 6 of 8: Money in one minute, then one line per spend from any app) · main
DONE: Money's empty state is now a one-minute card (Cash DA, CCP / bank DA, RedotPay card USD, today's rate, payday 1-28; all optional but one balance) and Today leads
  with a one-line spend box ("150 cafe", "taxi 400", "$12.49 netflix card", "hier taxi 400"). Two new intents on the existing hq:money:apply (no new channel; the four-channel
  pin is unchanged): `start` (one atomic write, up to 3 accounts + rate + payday via money/start.mjs planStart; refused while an unarchived account exists) and
  `log-line {text, from:'today'|'palette', dry?}` (money/quicklog.mjs parseLine: a ledger row dated today or yesterday, or a pending Inbox slip when unsure: USD with no rate, several
  numbers; a dry call answers {preview} and writes nothing, money.js apply returns before writeState). The same line works in Ctrl K ("Log a spend · <text>", logic/money-line.js)
  and in the Ctrl+Alt+X quick-run box (cast.js: amountLine + a top row from the dry preview; with no accounts "Set up Money first (one minute) ›" opens Money › Today; an exact spell
  name stays on top). The year rule ("2026 plan" is not a spend) lives in three copies (quicklog.mjs, money-line.js, cast.js); dashboard/money-line-parity.test.mjs runs one table through all three.
  Renderer: vals prefix mst* is taken (34 keys), mixin moneyStartLogic, store.previewMoneyLine (a dry apply that never touches live.money), usage marks money-start / money-quick / palette-money-line
  through useMark, one whatsNew line (needs mstStart). No XP anywhere. Fake preload answers start / log-line / dry; selftest +7 states; cdp-gate +3 scenarios.
  Gates: main 1135 pass / 0 fail, money 251/251, renderer 473/473, selftest 2606 combos 0/0/0, cdp-gate 45/45. Goldens: all 152 vals scenarios moved only by the 34 mst*/onMst* keys and whatsNew.changes[14]
  (golden-diff attributed); the template grew by exactly +5797 chars (start card 5355, quick line 2175, 22 chars of indentation for each interpolation, minus the old "start with what you have" card 1777), tpl.hash re-recorded with a dated line.
IN-FLIGHT: none from this dish. Two dishes follow in Pass order. Not exercised on the owner's PC: the real Ctrl+Alt+X window (cdp-gate cannot drive it; cast.js is covered by mini-cast + parity tests) and a real first start on the real data/money/.
ASKS (struct): none. BREAKS: none (additive). The empty state no longer has an "Add an account" button: the start card covers it (any one balance), "Add an account" stays on Today once accounts exist.
  IPC-CONTRACT's Money paragraph gained an "As built" sentence block (start refused only while an unarchived account exists, the dry reply shape, notes, `at` only on same-day rows).

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 5 of 8: WorkspaceHQ Bridge 0.7.0 — pair once, the Brief on the toolbar, find the best version of any image) · main
DONE: stages 1 and 2 (stage 3, downloads on click, is NOT built: owner answer pending; the manifest gains activeTab and contextMenus only, a test pins no downloads).
  Pairing: the extension's service worker proposes a 4-digit code + 32-byte token, the app asks in a parentless native dialog (Deny default, 60 s timeout, 3 tries per
  10 min) and writes exactly that token to data/.bridge-token + data/.bridge-pairing.json; the extension adopts it only once GET /health?nonce proves the app holds it
  (on the /pair answer, popup open, the next focus flush, or the 5-minute tick), so a closed popup or lost answer ends with both sides on the same token. Main:
  dashboard/bridge-pair.js, assist-bridge-routes.js (/pair, /assist/brief, /assist/open, audited as door 'browser'); browser-bridge.js now reads the token per request
  (live on every route, no restart), reflects CORS only for the paired origin once a pairing exists (any extension before, so an unpaired extension is never locked
  out), and /health adds proof. main.js: one setDeps line after the navBridge init. Extension: endpoint-guard.js (loopback only + HMAC proof, used by the focus flush, the
  social calls, the claude.ai sync and the popup), assist.js (pairing, badge, Needs you), grab-*.js (right-click "Find the best version", the On this page list: text only,
  nothing fetched), popup sections Needs you / On this page / Settings (Pair button), manifest 0.7.0, README. Existing tests gained the guard (their fake /health answers
  the proof) and endpoint-refusal cases; assist-bridge-routes.test.mjs now runs through the real startBridge and the real brief-project.mjs; new
  dashboard/bridge-pairing-e2e.test.mjs drives the real extension scripts against the real bridge (no-lockout before pairing; lost /pair answer ends on the stored token).
  Gates: main 1126 pass / 0 fail (1 skipped), money 251/251, renderer 473/473, selftest 2592 combos 0/0/0, cdp-gate 42/42. Renderer untouched, no golden moved.
IN-FLIGHT: none. Not exercised on the owner's PC: the native pairing dialog with the app hidden, and chrome.action.openPopup from the context menu in their Chrome.
ASKS (struct): none. BREAKS: none for the data contract (additive). A paired extension needs this app version: an older app has no /health proof, so the guard refuses to send the token to it.
  CONTRACT gained an "As built" paragraph under the bridge-routes section. Anyone spawning a copied extension folder needs endpoint-guard.js beside social.js / claude-sync.js.

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 4 of 8: every Claude session on one board, with where each stopped and one-click Resume) · main
DONE: Claude › Sessions opens on a live board of every Claude Code session of the last 24 h: an inline-SVG lane timeline (12 lanes at most, active part lit,
  pulsing end-cap, gold now line, nightly runs and Codex folded into one lane each), the 7-day limit-stop line, and one card per session with its project,
  ages, active time, whole-session tokens and one state sentence. Main: dashboard/sessions-core.mjs (pure classifier), sessions-board.js (30 s poll of the Hub,
  changed rows only, push on signature change, hq:sessions-board:read|resume|open-folder), claude-resume.js + claude-resume.cmd (Resume: always
  --permission-mode default, claude-chat.js's cwdRefusal and isSessionId, a missing transcript refused with the 30-day reason, id only as env, per-run MCP config
  folder removed at quit). Home gets a strip of up to 3 hot sessions; Claude › Chats' terminal button on a Code chat Resumes it. MCP hq_sessions (read tier,
  sessions-tool.mjs, read-only on hub.sqlite). main.js: one init line. Renderer: store live.board + refreshBoard/resumeSession, sessionsBoardLogic mixin, vals
  prefix sbd* (taken), board and strip fragments, clTerminalLabel/clTerminalTip, fake SPEC rows with an invented 8-session board (built with the real engine),
  12 selftest states, 5 cdp scenarios. Usage marks use the allowlisted ids (sessions-board open/resume, sessions-strip).
  Gates: main 1094 pass / 0 fail (5 skipped), money 251/251, renderer 473/473, selftest 2592 combos 0/0/0, cdp-gate 42/42. Goldens: all 152 vals scenarios
  moved only by the 32 sbd* keys, clTerminalLabel/clTerminalTip and whatsNew.changes[13] (golden-diff attributed); the template grew by exactly the two fragments
  and the terminal-button binding (+11844 chars). Real index, counts only: 4 sessions in the last 24 h, 20 Codex threads in the index, 0 errors.
IN-FLIGHT: none from this dish. Four dishes follow in Pass order. Not exercised against a real terminal (no real Resume was launched; HQ_DRY_LAUNCH logs only).
ASKS (struct): none. BREAKS: none (additive). IPC-CONTRACT gains an "As built" paragraph under the sessions board rows. Anyone spawning a copied MCP
  server.mjs needs sessions-tool.mjs and dashboard/sessions-core.mjs beside the hub-read files (server.test.mjs does).

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 3 of 8: the Brief sees CI, deploys, pull requests and the session you left, and sits in the tray) · main
DONE: six new Brief senses (dashboard/brief-senses.mjs: prod-deploy-error, ci-red, session-left-dirty, review-waiting, reboot-pending, money-empty) fed by
  dashboard/brief-sources.js (github.json, accounts.json, pc-health detail, one Hub sessions read + one projects read, 5 s each, never throws). brief-core:
  RULES grew to 18 in the contract's order, every item carries `count`, computeBrief adds `overflow` (items 4 to 12), the low `dirty` rule skips a project
  session-left-dirty names. brief.js: gather() merged in, github.json/accounts.json watched, firstSeen {first,last} now survives the toast bookkeeping (settle
  merges it back; 7-day prune, 200 cap), init({onBrief(brief, firstSeen)}) fires on each change and every 10 min otherwise. dashboard/brief-project.mjs is the
  screen-safe projection (no names, no project ids, nav is kind/tab/sub); dashboard/tray-brief.js + tray-menu.js put it in the tray (status line, up to 3 rows,
  one "+N more" line, tooltip; a row opens where it gets cleared, a scan row runs Scan; null brief = today's menu byte for byte). main.js: hook lines only
  (trayBrief create, buildTrayMenu brief + openRef, onBrief, tooltip). MCP hq_brief({limit 1-12}): items = first `limit` ranked, overflow = the rest.
  Renderer: Open GitHub / Open Vercel & Supabase labels, "+N more" names up to two overflow items; fake BRIEF keeps 3 items and more:2, gains the 2 overflow
  items and count; cdp brief-senses-act; selftest 4 new brief states. The 72-hour standing step-aside is NOT built (owner answer not approved).
  Gates: main 1093 pass / 0 fail (5 skipped), money 251/251, renderer 473/473, selftest 2568 combos 0/0/0, cdp-gate 37/37. Goldens: none moved (no template
  change, no new brf* key). Real-data check on a temp copy of the sidecars, counts only: top 3 stay the three standing highs; overflow holds 5 items incl.
  ci-red and review-waiting; the projection leaks no project id or name.
IN-FLIGHT: none from this dish. Five dishes follow in Pass order.
ASKS (struct): none. BREAKS: none (additive). Amended additively: CONTRACT (session-left-dirty key), IPC-CONTRACT (hq_brief limit semantics, onBrief hook), the
  operator-design spec rules table (six rows). The existing brief-core/brief/tray-menu tests changed where a default fixture now trips money-empty.
  Anyone spawning a copied MCP server.mjs needs nothing new (hq_brief reads data/brief.json only).

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 2 of 8: recall of past Claude chats on an index that can't be wiped landed) · main
DONE: the index guard (dashboard/claude-hub/index-guard.mjs) sits on the Hub's one store.resetCode() call in runIndex, so the startup rebuild, a reader
  taking the lock, the writer start and the reindex op are all refused while chats exist only in the index (47 on the owner's real index: Claude Code kept
  only 30 days of transcripts); the refusal is logged, resetNext cleared, every row stays. The reindex op answers {error, indexOnly}; health gains indexOnly;
  System › Reindex says why in its tooltip and as the error toast. Masking on read: redact-more.mjs rules are appended to redact.mjs (new ingests too) and
  the Hub re-masks search (snippets with their highlight markers stripped; a masked snippet comes back without highlights), getConversation and contextFor.
  MCP hq_recall and hq_chat_read (mcp/workspacehq/hub-read.mjs, read-only on hub.sqlite, scope default 'here' = this session's folder). Real-index check,
  counts only: 119 code chats, 47 index-only, the generic rules hit 97 rows (262 hits) the old rules had already left; 0 errors over 102,447 messages.
  Gates: main 1073 pass / 0 fail (5 skipped), money 251/251, renderer 471/471, selftest 2560 combos 0/0/0, cdp-gate 36/36. Goldens: one NEW vals scenario
  (system.hub-index-only); no existing hash moved; the template is unchanged.
IN-FLIGHT: none from this dish. Six dishes follow in Pass order.
ASKS (struct): none. BREAKS: none (additive). INDEX_VERSION stays 2. Anyone spawning a copied MCP server.mjs (tests) must also copy hub-read.mjs,
  dashboard/claude-hub/{store,redact,redact-more}.mjs and dashboard/claude-prompt-note.js (server.test.mjs does).

---

## 2026-11-07 · FROM frontend (kitchen batch 1, dish 1 of 8: the assistant's rulebook landed) · main
DONE: tiers, limits and one names-only log (data/assistant-audit.jsonl) for every MCP tool call (mcp/workspacehq/guard.mjs; the server answers async and
  finishes in-flight calls before exiting on stdin close); hq_activity; hq_scan_trigger now bounded (one at a time, 10-minute cooldown) and sharing
  data/.refresh.lock with the app's Scan now (dashboard/refresh-lock.js; runScan takes it, end() releases it; the tray words a refusal); the hq:use usage
  counter (dashboard/use-log.js, renderer mixin useMark/useArrive; the Brief panel is the first mark); the Reach block in Settings (dashboard/reach.js,
  hq:reach:read). Gates: main 1066 pass / 0 fail, money 251/251, renderer 471/471, selftest 2556 combos 0/0/0, cdp-gate 35/35. Goldens: all 151 vals
  scenarios moved only by the rch* keys; the template grew by exactly the Reach fragment.
IN-FLIGHT: none from this dish. The other seven dishes follow in Pass order.
ASKS (struct): FYI, unchanged: hq_scan_trigger still runs only collector.mjs (now at most once every 10 minutes); the app's scan and a session's raw pass
  exclude each other through data/.refresh.lock. The nightly runs should still get --strict-mcp-config; the guard's Windows-folder belt only covers the gap.
BREAKS: none (additive). Later dishes: call this.useMark('<surface>') inside your own visibility guard; add your MCP tools' tiers (hq_recall, hq_chat_read,
  hq_sessions, hq_delivery are already on the table).

## 2026-11-07 · FROM frontend (kitchen batch 1 started — contract before code) · main @ 7bc0562
DONE: this contract commit (CONTRACT.md + IPC-CONTRACT.md rows for every dish except the held Cosmos one; .gitignore patterns;
  owner-data pin test; README gate line). The plan docs landed in 7bc0562.
IN-FLIGHT: batch 1 is cooking, 8 dishes: the assistant's rulebook and use counter; recall of past Claude chats on an index that
  can't be wiped; the Brief's new senses and the tray; the Claude sessions board; Bridge 0.7.0 pairing and Find the best version;
  the one-minute Money start and spend line; client delivery on the project page; Cosmos step one.
  New files only until the Pass. Then: hook lines in main.js; edits to preload.js, browser-bridge.js, browser-bridge/* (manifest
  0.7.0), mcp/workspacehq/server.mjs, claude-hub/hub.mjs and redact.mjs, money/commands.mjs and money.js, cast.js/html,
  brief-core.mjs, brief.js, tray-menu.js, the v5 renderer files, fake-preload, selftest, cdp-gate and the goldens.
  New folder dashboard/cosmos/. Check this IN-FLIGHT line before touching any of those.
  THE HOLD BRANCH: Cosmos step one is committed on local branch hold/cosmos-core in the worktree
  "C:/Users/ROG STRIX/Documents/workspace-hq-hold-cosmos" until the owner says the ported code may be public.
  NEVER push it or merge it without that yes. Its contract rows are held with it.
ASKS (struct): FYI for later, not blocking: the nightly runs should pass --strict-mcp-config, and the GPU enumeration.
BREAKS: none (additive). .gitignore: data/.bridge-token -> data/.bridge-token*; data/brief.json and data/brief-state.json
  became data/brief.json* and data/brief-state.json*; new data/.bridge-pairing.json*, data/assistant-audit.jsonl*,
  data/.refresh.lock*, data/delivery.json*, data/cosmos/. The pairing, once made, tightens the bridge (token live on every
  route, CORS only for the paired origin); the Brief projection allowlist is in CONTRACT.md.

---

## 2026-11-05 · FROM frontend (loop iteration 3 — tech-debt #1 — and STOP) · main @ 8006fa6
DONE: 8006fa6 no unbounded spawnSync left on main: hq:draft-commit git diff (20 s) and hq:spellbook-rescan (2 min) moved onto
  git-actions run() (async, deadline, git-tree kill; run() gained stdoutMax + env); all 8 taskkill calls bounded (TASKKILL_OPTS,
  10 s, still sync — several run at quit). What stays sync is bounded: commit (COMMIT_GIT_MS), health-fix (30 s), the ~180 ms
  bake, where wt. Gates: main 702/702, money 229/229, renderer 401/401, selftest 2544 0/0/0, cdp-gate 33/33. Live app clean,
  and a restart did NOT re-toast the unchanged top item (change-only holds across restarts).
IN-FLIGHT: none. Loop STOPPED — the rest needs the owner or is structure-only refactoring:
  owner: Brief at the top of every Claude Code session (edits ~/.claude/settings.json) · Telegram + goals file · Electron
  upgrade (a download) · the second app's space package (key 0) · on-PC checks (extension 0.6.1 + Sync claude.ai; Money).
  refactor-only (no visible change, deliberately not done unasked): per-fragment golden hashes, splitting main.js IPC handlers
  and cdp-gate.mjs into files; dead Hub store methods wait for the next schema bump.
ASKS (struct): none. BREAKS: none — the two IPC handlers keep their shapes; only a timeout path was added.

---

## 2026-11-05 · FROM frontend (Operator Brief DONE — plan Tasks 4–7, loop iteration 2) · main @ ff10f32
DONE: 7073534 the Brief panel heading Home (brf* vals, honest states, hidden while scrubbed; +16 selftest combos, cdp brief-render /
  brief-act / brief-dismiss; goldens: only the 14 brf* keys moved). c63a871 MCP hq_brief (data/brief.json + ageMinutes). 0c8374e +
  ff10f32 P2 toast, CHANGE-ONLY (an item newly on top; the same top never re-toasts; once per key per 24 h; quiet 23–08 deferred).
  e055d73 gitignore hole closed (data/money/, brief*.json were committable — nothing leaked) + tools/gitignore-owner-data.test.mjs.
  Live app on real data: 3 items + 3 more, 0 source errors, exactly 1 toast recorded (the top secrets item), clean log.
  Gates: main 699/699, money 229/229, renderer 401/401, selftest 2544 0/0/0, cdp-gate 33/33 (sweep 516 / 34). Plan fully ticked.
IN-FLIGHT: loop continues on the tech-debt register (docs/audits/2026-11-05-concept-operator.md §3), starting with main.js spawnSync.
ASKS (owner): P3 (a 3-line Brief at the top of every Claude Code session — edits ~/.claude/settings.json) and P5 (Telegram,
  goals file) need your go-ahead. ASKS (struct): none.
BREAKS: none — additive. Home now opens with the Brief panel above the greeting body.

---

## 2026-11-05 · FROM frontend (Operator Brief, loop iteration 1 — plan Tasks 1–3) · main @ 33a4fca
DONE: owner approved the Operator concept ("Build the Operator"); spec + plan f88e2dd. 9cd1120 contract rows. 8ef7216 the pure
  engine dashboard/brief-core.mjs (12 rules, cap 3, keys rule:subject:value, shouldToast for P2; 13 tests). 33a4fca main side
  dashboard/brief.js (data/brief.json, hq:brief:read/dismiss, push hq:brief; recompute on startup, file changes, scan end, 15 min).
  Live app restarted: real data/brief.json written at startup — 3 items + 3 more, 0 source errors, clean log.
  Gates: main 693/693, money 229/229, renderer 394/394, selftest 2528 0/0/0, cdp-gate 30/30.
IN-FLIGHT: plan Tasks 4 (Brief panel heading Home), 5 (MCP hq_brief), 6 (P2 toast wiring), 7 (gates + docs).
ASKS (struct): none. FYI data/ gains brief.json + brief-state.json (frontend, gitignored); live-state.js has onChange(fn).
BREAKS: none — additive (new channels, new files, Hub health + money view fields added, money export writes money/meta.json).
  + .gitignore (shared, announced here): data/money/, data/brief.json, data/brief-state.json were NOT ignored (data/ is not
  ignored wholesale) — fixed + pinned by tools/gitignore-owner-data.test.mjs. Nothing had leaked. struct: new owner files need a line too.

---

## 2026-11-05 · FROM frontend (fe/v5-clean-pass merged into main — owner: "merge fe/v5-clean-pass into main") · main @ 8b3eefc
DONE: origin/main fast-forwarded 76a7d1a..8b3eefc (67 commits, no merge commit, no conflicts: 76a7d1a was an ancestor). main now
  carries everything since 2026-10-28: the feature cleanup (tag cleanup-base-2026-10-28 restores any of it), the claude.ai live
  sync, the devfleet fixes, the Money space (key 9) and the autonomous-loop fixes. All gates were green at 8b3eefc: main 670,
  money 229, renderer 394, selftest 2528 0/0/0, cdp-gate 30/30.
IN-FLIGHT: none. fe/v5-clean-pass == main; frontend work goes straight to main from here unless a branch is asked for.
ASKS (struct): pull main before your next block — 67 commits landed. Nothing in collector/, schema/, spellbook/ or
  run-pipeline.ps1 changed; data/ shapes only gained data/money/ (frontend-only, CONTRACT.md "data/money/").
BREAKS: main moved 67 commits (fast-forward). See the entries below for each block's own BREAKS.

---

## 2026-11-05 · FROM frontend (autonomous loop, iteration 3 + STOP — backlog now needs the owner) · main @ 6d54821
DONE: 8b494e3 MCP refuses never-sendable social combos at stage time (Instagram / YouTube posts+replies, LinkedIn replies; drift-pinned
  against browser-bridge/social.js; Threads/Facebook still stage). 6d54821 money: a zero balance saves however it is typed ("0.00" was
  refused while "0" saved). Every new test verified to FAIL on the old code. Gates (sequential, outputs kept): main 670/670, money
  229/229 (+15/15 module), renderer 394/394, selftest 2528 0/0/0, cdp-gate 30/30 (sweep 513 / 34). Live app restarted: up, clean log.
LOOP TOTAL (3 iterations): 14 fixes, +25 tests, 9 commits 82259fa..6d54821, all on fe/v5-clean-pass. The once-seen main-suite flake
  never recurred (0 in 13 further runs, 7 of them under load); gates now run sequentially with full output kept.
IN-FLIGHT: none. Loop STOPPED: what is left needs the owner —
  (1) the second app's Space Port Package (key 0 is free; SPACE-PORT-BRIEF.md says so; Money is the reference port);
  (2) audit next steps: always-on agent + Telegram morning briefing (needs a bot token + go-ahead), a goals file (what goals?),
      Ask on a local model (Ollama/LM Studio install + model choice on this PC);
  (3) merging fe/v5-clean-pass into origin/main (still 76a7d1a) — a PR/merge is the owner's call;
  (4) on-PC checks: reload extension 0.6.1 + Sync claude.ai; Money: import an Ember export, paste real SMS into Inbox.
ASKS (struct): none. BREAKS: MCP hq_social_post/reply now refuse the never-sendable combos (additive refusal).

---

## 2026-11-05 · FROM frontend (autonomous loop, iteration 2 — money review) · main @ 702e963
DONE: two independent reviewers of the merged money space, every finding reproduced against the real modules, every new test
  verified to FAIL on the old code. 4a8848d main: undone bill payment resurrected by importing an older backup (un-removable
  phantom debit) · back-dated slip/refund double-counted after a re-confirmed balance · second corrupt file overwrote the first
  .corrupt + wrong-shape JSON never quarantined · USD variable blank-pay dropped cents; export name uses the local day.
  5b88077 renderer: cleared DA rate snapped back and Save wiped it · explicit "no account" still showed Cash · pay row "no account"
  paid from the bill's account (relabelled) · spend typed mid-save wiped, busy submit / Archive silently dropped. 702e963 CONTRACT.
  Gates (run sequentially, outputs kept): main 666/666, money 229/229 (+14/14 module), renderer 394/394, selftest 2528 0/0/0,
  cdp-gate 30/30 (sweep 513 / 34). Goldens unchanged. Live app restarted on it: up, clean log.
  Flake (a) from iteration 1: NOT reproduced in 7 loaded runs (2 suites at once x3, suite + Electron selftest x1) — 1 failure in
  11 runs total; gates now run sequentially with full output kept so a recurrence arrives with its name.
IN-FLIGHT: loop continues. Backlog: hq_social_post stage-time refusal of never-sendable combos. Money nits not fixed (owner
  impact ~0): "0" balance accepted but "0.00" refused; takeMoney has no ordering guard (unreachable while main handlers stay sync).
ASKS: none. BREAKS: none (money behaviour fixes; CONTRACT amendment is additive).

---

## 2026-11-05 · FROM frontend (autonomous loop, iteration 1 — owner: "continue the project in loop and automatically") · main @ 82259fa
DONE: 82259fa Run session + journal Add grey out while in flight (devfleet follow-up; guards mirrored into state, cantAddJournal).
  Gates: main 662/662, money 229/229, renderer 389/389, selftest 2528 0/0/0, cdp-gate 30/30 (sweep 513 / 34 screens).
IN-FLIGHT: loop continues. Backlog seen: (a) one main-side test failed ONCE while the Electron selftest ran concurrently, 3/3
  clean alone, name not captured — find the timing-sensitive test; (b) hq_social_post stage-time refusal of never-sendable combos;
  (c) quick bug review of the merged money code.
ASKS: none. BREAKS: none (renderer-only, additive state keys).

---

## 2026-11-03 · FROM frontend (money space — owner: "merge the Money space from money-manager-") · main @ 44fed17
DONE: space-port-money landed by its MANUAL path (origin/main is 76a7d1a but this tree is 53 commits past it, post-cleanup:
  the patch fails plain and conflicts 19 files under --3way). 1c9659e contract rows · 469dca7 main (dashboard/money.js +
  dashboard/money/, one main.js hook, preload money group, README test line) · 34a3db1 renderer (tpl/vals/logic/store, nav, icon,
  palette, What's new, fake preload, goldens) · 44fed17 gates (selftest + 6 cdp scenarios). ADAPTED: Money is the 9th destination
  on KEY 9 (package said 10th / key 0 — written while Studio was still #9); the key0 cdp scenario became money-open-key9.
  Ember's Yassir fixture moved 22:10Z -> 12:10Z (local-day parse read Oct 9 on this UTC+2 PC; parser untouched).
  Gates: main side 662/662, money 229/229 (+10/10 module), renderer 387/387, selftest 2188 -> 2528 combos (+340, the
  package's number) 0/0/0 on real scans, cdp-gate 30/30 (button-sweep 512 buttons / 34 screens). Goldens: 137 mny keys x 147
  scenarios + nav/moreNav 9th entry + v.money + What's new + palGroups (2), 0 removed, 4 added -> 151; tpl +57015 chars (=pkg).
  Live app restarted: up, clean log; data/money/ not created until the first write (correct). Package package.json NOT merged.
IN-FLIGHT: none. SPACE-PORT-BRIEF.md now says slot 0 is the only free one (for the second app).
ASKS (owner): press 9 -> Money; Import an Ember export (Me > Export my data); paste a few real RedotPay / bank / BaridiMob
  SMS into Inbox — misreads go back to the Ember chat for a parser rule. Day boundaries follow THIS PC's zone (Europe/Paris).
BREAKS: none — additive only (4 new hq:money:* channels, data/money/state.json gitignored).

---

## 2026-11-03 · FROM frontend (devfleet — owner: "run a devfleet to analyse the app and improve it heavily") · main @ 3536b92
DONE: 10 subsystem reviewers + 1 adversarial verifier per finding: 53 raw, 49 survived (4 refuted). 7 file-disjoint fixers landed
  them in 8 commits f1d8c2d..3536b92: main stops freezing (tray push/backup async w/ deadlines — NEW git-actions.js;
  assemble->bake->ONE reload via NEW data-refresh.js, exit codes honored; startup bake skipped when fresh — bake-freshness.js;
  json-store.js, daily-notes-watch.js), Hub backfill tx-batched + stats() date-bounded (schema still 2), Save to vault fixed for
  long titles, async killTree, bridge Host allowlist (DNS rebinding) + no oversize buffering, extension 0.6.1 flush race,
  renderer double-submit/undo-XP races + output render coalescing, honesty copy, dead glyphs/vals keys, MCP descriptions honest,
  IPC-CONTRACT/CONTRACT/README drift. Goldens: 18 key paths moved, all attributed (commit 9fe436c). Also docs/design/SPACE-PORT-BRIEF.md.
  Suites: main-side 652/652 (+68), renderer 378/378 (+23), selftest 2188 0/0/0, cdp-gate 24/24 (button-sweep 442 / 30 screens).
  Live app restarted on it: bridge 200 for the extension, 403 "bad host" for a rebinding Host; no errors in the day log.
IN-FLIGHT: none. Follow-ups noted, not done: Run-session / journal Add buttons don't visibly disable during the in-flight guard
  (clicks are already no-ops); hq_social_post could refuse never-sendable platform combos at stage time.
ASKS (struct): none.
BREAKS: main.js — tray pushAll/snapshotDirty + hq:snapshot now async (git-actions.js); applyDone / capture-save / learn /
  archive / revive refresh through data-refresh.js; latest.json watcher ignores in-app writes (self-write marker). Bridge refuses
  any Host other than 127.0.0.1 / localhost / [::1]. Extension 0.6.1 needs a manual reload.

## 2026-10-29 · FROM frontend (claude.ai live sync back — owner: "i want workspace hq to read claude live") · main @ 8651160
DONE: f9e2451 restores the extension's claude.ai live sync (0.6.0) + bridge GET /claude/sync-state, POST /claude/sync + Hub ops
  syncState / syncPush, WITHOUT the ZIP export import (importExportFile / unzip / streamJsonArray stay gone). 8651160 docs:
  CONTRACT.md 2026-10-29 amendment (routes back, shape unchanged), IPC-CONTRACT note, CLAUDE.md, README. Suites 584/584;
  app restarted, /claude/sync-state 200 with the bridge header, 403 without; 0 claude.ai chats indexed so far.
IN-FLIGHT: none. Owner action: reload the extension (0.6.0) at chrome://extensions, then popup › Sync claude.ai with a
  logged-in claude.ai tab open (20 chats per 5 min until caught up).
ASKS (struct): none.
BREAKS: main.js +1 line (claude-bridge-routes.setHub). browser-bridge.js /claude/* route back. hub.sqlite still schema 2.

## 2026-10-28 · FROM frontend (feature cleanup, part 2 — owner: "continue") · main @ b21f34f
DONE: ec8018f + aad23f1 importers (claude.ai / ChatGPT / Instagram-Facebook ZIPs, drop folder, extension claude.ai sync →
  extension 0.5.0) + prompt library (Prompts, harvest, runs, packs); Hub ops importExport / importChatGPT / importMeta /
  syncState / syncPush / promptUse / promptStats / promptCandidates / hideCandidate gone; CONTRACT.md amendment: /claude/sync
  routes removed. 95964cd + fc5259f Claude › Canvas + stat card PNG (MCP hq_canvas_* gone; data/canvas/ kept on disk).
  b317d82 + b21f34f Social tab (8 destinations now) — KEPT the outbox approval gate: social-bridge.js, browser-bridge/social.js,
  popup approval card, MCP hq_social_post/reply/outbox/cancel. Every removed channel is in IPC-CONTRACT "2026-10-28 — Feature
  cleanup". Suites at b21f34f: dashboard + hub + tools + mcp 554, v5 355, selftest 2188 combos 0/0/0, cdp-gate 24/24.
IN-FLIGHT: none. Restore anything from tag cleanup-base-2026-10-28.
ASKS (struct): none new. FYI hub.sqlite stays schema 2; store.mjs keeps its harvest / prompt_use / candidate / socialSummary
  methods (dead now, still tested) so no migration was needed. data/social/*.json is still written by the extension's scrape
  but nothing in the app reads it.
BREAKS: main.js — claude-import / claude-imports / claude-prompts / canvas-ops / stat-card / social-tab hooks gone, the canvas
  read/add/watcher block and hq:social-read gone. browser-bridge.js — /claude/* routes and readSocial gone. Extension needs a
  manual reload (0.5.0). Hotkeys unchanged since part 1 (only Ctrl+Alt+X).

## 2026-10-28 · FROM frontend (feature cleanup, part 1 — owner: "fix the crash loop then do the cleanup") · main
DONE: tag cleanup-base-2026-10-28 (pushed) = the tree before any cut; restore anything with git checkout <tag> -- <paths>.
  0552cc3 mini HUD + Summon/shards cut (Ctrl+Alt+G freed). c51a1f6 legacy/ v2–v4 renderers removed (ui-version: every
  flag loads v5, a v2–v4 flag is logged; rollback.ps1 v2..v4 refuses with the restore command). 5d41221 Studio cut
  (snip / recorder / library, 5 hotkeys, the 10th destination — v5 has 9 now, keys 1–9). IPC-CONTRACT "2026-10-28 —
  Feature cleanup" lists every removed channel. Suites: dashboard + tools 493, v5 423, selftest 2804 0/0/0, cdp-gate 39/39.
IN-FLIGHT: none uncommitted. Still on the audit's cut list: Hub imports (zip/ChatGPT/Instagram-Facebook/live sync),
  prompt library + harvest + runs + packs, Canvas + stat card, the Social tab (keeping social-bridge's outbox gate).
ASKS (struct): spellbook/ catalog is 962 commands, 18 runs ever (last Oct 12) — consider trimming to the owner's favourites.
  Knowledge XP: learnings.json / project-notes.json / brain-dump.json are empty; frontend kept their writers for now
  because collector/assemble.mjs reads them.
BREAKS: main.js — mini HUD / shard / summon blocks gone, screen-capture init + 2 hotkeys gone, renderer log line for a
  removed v2–v4 flag. tools/rollback*.{mjs,ps1} (shared) accept v5 only. Gitignored leftovers for the owner:
  legacy/*/tools/shots (39 MB), data/shards.json, data/shard-library.json, data/.hud-state.json.

## 2026-10-28 · FROM frontend (EPIPE crash loop — owner: "fix the crash loop then do the cleanup") · main
DONE: e465b43 + follow-up fe: new dashboard/stdio-guard.js (4 tests): a closed console pipe (EPIPE / EOF only) turns console.*
  into no-ops once and writes ONE 'stdio-closed' line to the file log; main.js uncaught / unhandledRejection handlers skip pipe
  errors and never re-throw through the console. Cause: logs/app-2026-10-28.log had 10,461 uncaughtException EPIPE lines
  00:03–11:40 (pid 22572, launched detached) until its 5 MiB cap. Checked with a real closed-pipe child; dashboard + hub 743 pass.
  App restarted via tools\rollback.ps1 v5 (pid 33744); a console write after restart logged nothing bad.
IN-FLIGHT: feature cleanup from docs/audits (local, not committed: personal usage data) — tag cleanup-base-2026-10-28 first.
ASKS: none. NOTE: the capped log was renamed logs/app-2026-10-28.epipe-loop.log (5 MB) — rotation won't prune that name; owner's to delete.
BREAKS: main.js lines 26–29 (stdio guard + the two process handlers). No IPC change.

## 2026-10-27 · FROM frontend (canvas ＋ Board + Clear board — owner: "build clear board and create board too") · main
DONE: eb74355 meta: IPC-CONTRACT rows hq:canvas-create, hq:canvas-clear. e69f5af fe main: canvas-ops.js gains both
  (create: empty board, case-insensitive no-overwrite, wx; clear: nodes + edges to removed.jsonl first, file and other
  keys kept); MCP hq_canvas_create / hq_canvas_clear; preload canvasCreate / canvasClear. Renderer: ＋ Board form (taken
  name refused, Enter creates, becomes ＋ Note's pick), board list with card counts + two-click Clear (pins on that board
  drop). tpl hash +3572; gate canvas-board-create-clear. Suites: dashboard + hub green, v5 439, mcp 6, selftest 2888
  0/0/0, cdp-gate 39/39 (sweep 531 buttons, 37 screens). Brief §11.1 canvas bullet updated.
IN-FLIGHT: none. ASKS: none.
BREAKS: main.js: only the canvas-ops hook line's comment changed. Additive IPC + two MCP tools.

## 2026-10-27 · FROM frontend (canvas Pin / Remove + stat card PNG — owner: "build the stat card export and canvas pin/remove too") · main @ dcacae2
DONE: 27057be meta: IPC-CONTRACT rows hq:canvas-remove, hq:stat-card-save (Pin to Home = per-PC prefs, no channel).
  d964524 fe main: new dashboard/canvas-ops.js (one node + its edges, a copy appended to data/canvas/removed.jsonl first)
  + dashboard/stat-card.js (PNG check, save dialog / HQ_STAT_CARD_PATH); MCP hq_canvas_remove mirrors the rule; preload
  canvasRemove / statCardSave. ae60eed fe v5: Pin to Home (whq3-prefs.canvasPins, max 6) + Home › Pinned from canvas;
  Remove asks once; stat card drawn on a 1200×630 canvas from statCardStats (shared with the level-up card). tpl hash +2168.
  dcacae2 fe: cdp-gate canvas-pin-remove + stat-card-save; button-sweep KNOWN_CUTS now empty (fake serves 2 boards).
  Suites: dashboard green, v5 439, mcp 5, selftest 2888 combos 0/0/0, cdp-gate 38/38 (sweep 529 buttons, 37 screens).
IN-FLIGHT: none. Brief §11.1: canvas pin/remove, vault open/search, stat-card export marked wired.
ASKS: none. data/canvas/removed.jsonl is new (gitignored with data/canvas/); nothing reads it — it's the undo copy.
BREAKS: main.js two new hook lines (canvas-ops, stat-card) after the vault-open line. Additive IPC + one MCP tool.

## 2026-10-27 · FROM frontend (Discard + every-button sweep — owner: "make the discard button work AND test for other broken buttons") · main @ 724ae26
DONE: 97471e5 meta: CONTRACT amendment (a third cancel path, same rule) + IPC-CONTRACT rows hq:social-cancel, hq:vault-open.
  5d24851 fe main: social-bridge.js cancelStaged = THE staged → canceled rule (popup route now calls it; its 68 tests unchanged)
  + hq:social-cancel in social-tab.js; new dashboard/vault-open.js (open / search a scanned, Obsidian-registered vault by id).
  46b8b8c fe v5: Discard (two clicks), Life › Notes Open in Obsidian / Search, Machine / Claude status cards → their sub
  (were no-ops from another sub), timeline rows without a project → Milestones / Library / Tasks or disabled, empty Ask /
  Run in app / journal Add now say what's missing, aria-pressed / aria-selected on four toggle groups. tpl hash +535.
  724ae26 fe: cdp-gate `button-sweep` (526 buttons, 37 screens, fake bridge; fails on errors / "isn't wired" outside the
  brief's cuts / clicks that change nothing) + `social-discard`; 3 Ask gates were stale since the 8th chip (37441df) — fixed.
  Suites: dashboard 731, v5 434, mcp 4, selftest 2888 combos 0/0/0, cdp-gate all 37 scenarios PASS.
IN-FLIGHT: none. Left as recorded cuts: Save stat card PNG; canvas card pin / remove (no canvas cards in the fake, unswept).
ASKS: none.
BREAKS: main.js social-tab hook passes dataDir; one new hook line (vault-open). Additive IPC only.

## 2026-10-27 · FROM frontend (Social tab — owner: "a social media tab … to connect my socials … its own vault, VEEMO CORTEX"; skipped the questions) · main @ d68c9da
DONE: a2d02c0 meta: IPC-CONTRACT "Social tab" section + CLAUDE.md facts line. 07335e2 fe: new dashboard/social-tab.js (5 tests) —
  hq:social-vault:list/open/save (VEEMO CORTEX 30_Areas/Social ≤2 deep + 00_Inbox/Social *.md; open only a listed note; save
  ONE new note on the owner's Save, atomic, never over one) + hq:social-open-site (8 fixed home URLs; Mastodon refused); Hub
  op socialSummary (hq:claude-hub:social-summary, counts only) + listDocuments origin/kind filters. 9ba38b1 fe: v5 Social tab
  (10th destination after Life; key 9, Studio → key 0): Accounts / Inbox (= Life › Social moved unchanged) / Archive / Vault;
  saved life/social subs + deep links land on social/inbox. d68c9da fe: its rail icon. Goldens attributed (nav/moreNav/v/keys
  everywhere, palGroups, Life subTabs/screenSub, isSocial gone, so* added, 11 new scenarios); tpl hash +20309.
  Suites: dashboard 728, v5 434, selftest 2888 combos 0/0/0. Checked in a second hidden instance (own profile, HQ_DRY_LAUNCH):
  real vault lists the 3 inbox notes; on a copy of the trial Instagram index the Archive shows 62 DM chats / 13 kinds, a kind
  opens, search answers. App restarted (rollback.ps1 v5).
IN-FLIGHT: none. The owner's own Instagram / Facebook import (button on Social › Accounts / Archive) and signing in to the
  platforms in Chrome with the extension running (nothing is registered yet: data/social/accounts.json doesn't exist).
ASKS: none.
BREAKS: main.js:1598 one hook line (require('./social-tab')); preload + socialVault.*, socialOpenSite, claudeHub.socialSummary;
  SUBS.life loses 'social' (sub + golden scenario tab.life.social / live.life-social gone); NAV gains 'social' (digit keys:
  0 = 10th). All additive on the main side.

## 2026-10-27 · FROM frontend (Instagram / Facebook exports as context — owner: "add them as context", scope: everything, app + vault) · main @ 37441df
DONE: fcb9dfb meta: IPC-CONTRACT section + CLAUDE.md facts line. 37441df fe: new dashboard/claude-hub/ingest-meta.mjs (Instagram
  HTML / Facebook JSON, text entries only via new unzip.mjs readEntry, Meta mojibake repaired, SENSITIVE folders never read,
  profile whitelist, post metadata rows dropped) → Hub op importMeta; DMs = sources instagram/facebook (others' lines role
  'other', sender in tool_name; left out of unfiltered lists, stats and harvest; never continued) + 'social' documents
  (chunks ≤100 records, tallies for likes/saved). Ask's 8th chip "Instagram & Facebook" (contextFor scope social, own
  3000 reserve). Claude › Chats: import button (kind meta) + Instagram / Facebook filters; drop folder detects both.
  Real exports checked on scratch dbs only: IG 62 threads / 38k msgs / 223 docs in 7 s; FB 302 threads / 3.4k msgs / 52 docs.
  Suites: dashboard 721, v5 428, selftest 2660 combos 0/0/0; goldens attributed (askSources, clSrcChips, diImportMeta,
  diMetaTip); tpl hash +463. App restarted (rollback.ps1 v5).
IN-FLIGHT: the owner's own import (button in the app — I never write their hub.sqlite from a script); 3 vault notes drafted
  in the session scratchpad, written to VEEMO CORTEX only on their yes.
ASKS: none.
BREAKS: no new channel, no schema change; hq:claude-hub:import kinds + instagram/facebook/meta; unfiltered listConversations /
  listProjects / stats now exclude sources instagram/facebook; llm include key `social`. All additive.

## 2026-10-26 · FROM frontend (data overhaul Fronts A, B, D3 — owner: "keep going with the rest"; struct-lane edits owner-authorized) · main @ 4b859b0
DONE: Freshness (A) — b28686a struct: pipeline ends with a `bake` step (dashboard/build-data.mjs), so a closed app reopens
  on the newest scan; run-scan.ps1 enriches at most once a day (skips when latest.json says today is already enriched;
  -NoEnrich still forces offline). 19c85cd fe: top bar "· N days old" (orange) when the newest scan is ≥ 2 days old +
  tooltip with scan / estimate ages; new dashboard/login-item.js — the unpackaged app registers itself to start at login
  hidden (never from a --user-data-dir / --selftest / HQ_V5_PROFILE / HQ_NO_LOGIN_ITEM instance); main logs a failed bake.
  Own repos (B) — 65a8d68 CONTRACT, 660c7e1 struct: collector finds git repos under root + discover_roots (~/Desktop),
  ≤3 deep, owned by owner_logins / no remote / adopt → scored projects with `discovered`; first run: 15 new (24 total),
  collector ~40 s. bfa6361 fe: new dashboard/project-paths.js — main + session-api accept a path outside Documents only
  when it is exactly a tracked project's path in latest.json; project page says "found automatically".
  Accounts (D3) — 30f1704 contracts, 60be33c struct collector/accounts.mjs → gitignored data/accounts.json (Vercel via
  `vercel api`, Supabase via `supabase projects list`; owner's CLI logins), 4b859b0 fe Projects › Vercel & Supabase
  (hq:accounts-refresh, hq:accounts-open = listed vercel.com / *.vercel.app / supabase.com links only).
  Suites: collector/lib 59, dashboard 531, v5 425; selftest 2660 combos 0/0/0; both new tabs checked on real data.
IN-FLIGHT: none. Not built: remote-only GitHub repos as projects (they show in Projects › GitHub only); Comet chats (no
  export exists); claude.ai / ChatGPT chats were already built (Claude Hub import + drop folder) and wait on the owner's exports.
ASKS: struct lane — review b28686a, 660c7e1, 60be33c (collector/, run-*.ps1 are yours).
BREAKS: projects[] can now hold paths outside Documents (absolute, forward slashes) + optional `discovered`; new sidecar
  data/accounts.json; pipeline steps `accounts`, `bake`; IPC hq:accounts-refresh / hq:accounts-open; sub projects/accounts;
  the app writes a Windows login item on start. All additive.

## 2026-10-26 · FROM frontend (GitHub view — the data-overhaul spec's Front C; struct-lane edit owner-authorized) · main @ 53e23e5
DONE: owner: "I don't see any of the GitHub data" → "start building the GitHub part" (gh already signed in).
  1580183 struct: new collector/github.mjs + pure collector/lib/github.mjs (7 tests) — two read-only GraphQL calls through
  the owner's own gh login (no stored token) into gitignored data/github.json: owned repos (private incl.) with CI, open
  PRs/issues and the local clone found for each (scanned projects + git folders ≤3 deep under Documents/Desktop), PRs
  waiting on the owner, their own PRs, assigned issues. Snapshot kept if <10 min old. Optional pipeline step after pc-health.
  b45a0c3 meta: CONTRACT + IPC-CONTRACT entries. 53e23e5 fe: Projects › GitHub sub-tab; new dashboard/github-view.js
  (7 tests; hq:github-refresh, hq:github-open = github.com links listed in the snapshot only); one main.js hook line;
  build-data bakes DATA.github; goldens attributed + 5 scenarios; tpl hash +10003.
  Suites: collector/lib 52, dashboard 521, v5 422; selftest 2584 combos 0/0/0; checked in the harness on real data.
IN-FLIGHT: none. Remote-only repos are listed in the GitHub tab only; projects[] is untouched (Front B).
ASKS: struct lane — review 1580183 (collector/ is yours).
BREAKS: new gitignored sidecar data/github.json; pipeline step `github` (optional); IPC hq:github-refresh / hq:github-open;
  new sub projects/github. All additive.

## 2026-10-26 · FROM frontend (PC health tells the truth and says more; struct-lane edit owner-authorized) · main @ f1a4f7d
DONE: owner reported "4 GB VRAM is wrong" (RTX 3070 Laptop = 8 GB) and "PC health is boring".
  1e7ef34 struct: collector/pc-health.ps1 + new pure collector/lib/pc-health.mjs (13 tests): real VRAM from the display
  registry qwMemorySize / nvidia-smi (WMI AdapterRAM is 32-bit, caps at ~4 GB); every GPU + live NVIDIA stats; top RAM
  and CPU apps; folder-size breakdown via robocopy /L (cached 6 h in gitignored data/pc-health-disk.json); Recycle Bin;
  battery organ; power plan; drive health; startup apps; pending restart; link speed; week trends; an honest
  "not readable without admin" list. Fix commands + danger levels unchanged. Scan ~7 s, ~60 s when disk is re-measured.
  d75a875 hq:pc-open-folder (new dashboard/pc-health-open.js, 6 tests; one main.js hook line before the nav-bridge init).
  2b5edf9 v5 System › Machine: 8 new panels; goldens attributed (^md[A-Z], sysScanTip) + new scenario; tpl hash +9890.
  f1a4f7d Ask health section: real VRAM, top apps, biggest folders, GPU now, trends (old sidecars still omit VRAM).
  Suites: collector/lib 45, dashboard 514, claude-hub 176, v5 420; selftest 2508 combos 0/0/0; checked on a test copy.
IN-FLIGHT: none. The owner's app needs a restart to load the new IPC + panels (tools\rollback.ps1 v5, or tray Quit + relaunch).
ASKS: struct lane — review 1e7ef34 (pc-health is yours); CONTRACT.md 2026-10-26 entry describes the additive fields.
BREAKS: none (additive). Re-examine is ~7 s; every 6 h it re-measures the disk breakdown (~1 min).

## 2026-10-26 · FROM frontend (archive + prompt library program complete; tree committed) · main @ b7ffa0b
DONE: all 8 features built, reviewed and pushed (Claude Hub H2–H5 live since 2026-10-25 12:52; H6 ChatGPT/Claude-memory
  import, P1 prompt Library, P2 harvest/promote, P3 run modal + packs at 0102fc5). Suites at 0102fc5: claude-hub 176,
  dashboard 506, v5 415, collector/lib 32 — all green. On the owner's instruction, the struct lane's long-uncommitted files
  are now committed: 9432c0e run-scan.ps1 (-NoEnrich nightly), 187c7f9 data/quest-overrides.json, b7ffa0b the other
  session's draft spec 2026-10-25-real-workspace-hq-data-design.md (still DRAFT, awaiting owner approval).
IN-FLIGHT: the owner's app (PID 39864, launched by the owner 2026-10-25 19:25, apparently elevated) runs mid-build code;
  tools\rollback.ps1 cannot see an elevated instance (empty CommandLine) and the relaunch quit as second-launch. Owner:
  quit from the tray, then relaunch (or ask the controller). First start migrates data/claude/hub.sqlite to schema 2.
ASKS: struct lane — review 9432c0e / 187c7f9 (committed for you, unchanged content).
BREAKS: hub.sqlite schema 2 (additive; pre-H6 Hub code refuses a schema-2 db). Bridge extension needs a manual reload.

## 2026-10-25 20:15 · FROM frontend · main @ 288261a
DONE: Prompt runs + usage + packs P3 (plan docs/superpowers/plans/2026-10-15-archive-prompts-p3.md), commits P3.2–P3.11 + this meta commit:
  fillVariables (one pass; {{project}}/{{cwd}} from the picked project), Hub op promptUse (writer, queued; prompt_use now written),
  claudePrompts.run (note read from the vault, Chat via the H3 engine bound to the asking window, Terminal via launchClaudeTerminal,
  Copy for claude.ai/ChatGPT = clipboard + the two fixed URLs; usage only after success, "not recorded" said), packs (import plan →
  one confirm, new notes only, masked; export streamed, never replaces); v5 run modal with quota labels, pack dialog, Library refresh.
  Real second-instance gate on fixtures: PASS ({"fails":[],"report":{"chatEnd":"done","uses":3,"promptFiles":["drafts",
  "gate-pack-note.md","notes.txt","review-a-pr.md"],"exportBytes":517}}; drafts + notes.txt are the H6 fixture's own non-prompt entries);
  owner vault 40_Resources, data/claude and clipboard unchanged; fixture note byte-identical after the pack; no prompt text in app logs.
  Suites: hub 176, dashboard 506, v5 415, selftest 2508 combos 0/0/0, CDP 34/34 (incl. prompts-run-chat, prompts-run-copy, prompts-pack-import).
  IPC-CONTRACT/CONTRACT P3 rows re-read against the landed code: rows unchanged.
IN-FLIGHT: none. The "AI archive sources + prompt library" program (H6, P1–P3) is complete.
  The owner's app was NOT restarted; it picks this up on its next restart (main.js changed: 2 lines; no schema change).
ASKS: none (no structure-lane file touched).
BREAKS: none. New IPC hq:claude-prompts:run|import-pack|export-pack (additive); Hub op promptUse (main only).
  main.js: the claude-chat init line now keeps its result (claudeChatEngine); the claude-prompts init line passes run/pack deps.

## 2026-10-25 19:30 · FROM frontend · main @ 36fcfb0
DONE: Prompt harvest + Promote P2 (plan docs/superpowers/plans/2026-10-15-archive-prompts-p2.md), commits P2.2–P2.9 + this meta commit:
  harvest.mjs (pure: exclusions, reuse/turns/length/library terms as reasons), store harvestPool (bounded 20 000 + 20 000, history
  sessions = their Code session), Hub ops promptCandidates (readers too) / hideCandidate (tombstone kind candidate, writer);
  claudePrompts.promote (masked, slug or confirmed slug-2…-9 only, atomic, never overwrites, creates the Prompts folder);
  v5 Claude › Prompts › Candidates (score terms, origin, one-confirm Promote single/multi, clash step, Hide).
  Real second-instance gate on fixtures: PASS ({"fails":[],"report":{"pooled":{"messages":1,"history":3},"candidates":2,
  "promptFiles":["drafts","gate-masked.md","gate-promoted-prompt-2.md","gate-promoted-prompt.md","notes.txt","review-a-pr.md"],"hidden":1}};
  drafts + notes.txt are the H6 fixture's own non-prompt entries); owner vault 40_Resources and data/claude unchanged; no prompt text in logs.
  Suites: hub 174, dashboard 494, v5 408, selftest 2464 combos 0/0/0, CDP 31/31 (incl. prompts-promote-confirm, prompts-candidates-hide).
  IPC-CONTRACT/CONTRACT P2 rows re-read against the landed code: rows unchanged.
IN-FLIGHT: none. Next phase P3 (run modal + packs). The owner's vault still has no 40_Resources/Prompts; the first Promote creates it.
  The owner's app was NOT restarted; it picks this up on its next restart (no schema change in P2).
ASKS: none (no structure-lane file touched).
BREAKS: none. New IPC hq:claude-hub:prompt-candidates|hide-candidate, hq:claude-prompts:promote (additive). main.js: no line touched.
  CONTRACT.md: tombstone kind candidate; Promote is the writer of new prompt notes.

## 2026-10-25 18:19 · FROM frontend · main @ 91ed87f
DONE: Prompt library P1 (plan docs/superpowers/plans/2026-10-15-archive-prompts-p1.md), commits P1.2–P1.9 + this meta commit:
  note format claude-prompt-note.js (slug, -2…-9 clashes, {{variables}}, §6.1 frontmatter = H6 parser round trip, doc id = H6 docId);
  writePromptNote (new files only, contained, atomic — for P2 Promote); Hub rows meta + variables, read-only promptStats;
  claudePrompts.status/open (contained obsidian:// link or the file, Obsidian-absent fallback, HQ_DRY_LAUNCH); v5 Claude › Prompts
  Library + project-page Run a prompt (run context chip). Real second-instance gate on fixtures: PASS (fails [], title "Review a PR like a staff engineer",
  obsidianInstalled true, dryOpenLines 2; a note added to the gate vault reached the Library live; owner vault 40_Resources and data/claude unchanged; no prompt text in logs).
  Suites: hub 156, dashboard 488, v5 396, selftest 2424 combos 0/0/0, CDP 29/29 (incl. prompts-library-open, prompts-empty-states, prompts-project-shortcut).
  IPC-CONTRACT/CONTRACT rows re-read against the landed code: unchanged.
IN-FLIGHT: none. Run is a labelled placeholder until P3. The owner's vault has no 40_Resources/Prompts yet → the Library says so.
  The owner's app was NOT restarted; it picks this up on its next restart (no schema change in P1).
ASKS: none (no structure-lane file touched).
BREAKS: main.js +1 line after the claude-imports init (claude-prompts). New IPC hq:claude-hub:prompt-stats, hq:claude-prompts:status|open;
  hq:claude-hub:documents rows gain meta (+ variables on prompt rows). CONTRACT.md: 40_Resources/Prompts note format entry.

## 2026-10-25 16:30 · FROM frontend · main @ 123e0d0
DONE: AI archive sources H6 (plan docs/superpowers/plans/2026-10-15-archive-prompts-h6.md), commits H6.2–H6.10b + this meta commit:
  hub.sqlite schema 2 (document + document_fts, prompt_use; in-place 1→2, tested on a populated v1 db); ingest-chatgpt.mjs
  (current-branch walk, masked, counts-only report, web_sync kind chatgpt); ingest-docs.mjs (memory notes, CLAUDE.md,
  vault prompt notes, history.jsonl by byte cursor, live watchers); Hub ops importChatGPT/listDocuments/getDocument +
  forget({documentId}); drop-folder watcher claude-imports.js (asked once); v5 document hits + view, drop card, System report.
  Real second-instance gate on fixtures: PASS (prompts 1, chatgptChats 4, card "Import ChatGPT export (chatgpt-export.zip, 1 KB)?";
  photos.zip refused with the reason; no re-offer after a reload; imports-seen.json next to the gate db; drop folder unchanged;
  owner vault 40_Resources, owner imports folder and data/claude unchanged; no chat text in logs). Suites: hub 152, dashboard 470,
  v5 384, selftest 2312 combos 0/0/0, CDP 26/26 (incl. imports-drop-confirm, search-documents). IPC-CONTRACT/CONTRACT rows re-read against the landed code: unchanged.
IN-FLIGHT: none. The owner's app was NOT restarted: its Hub still runs schema 1 code; the first restart on this code
  migrates data/claude/hub.sqlite to schema 2 (a later rollback of the Hub code below H6 then refuses that db — "newer WorkspaceHQ").
ASKS: none (no structure-lane file touched).
BREAKS: main.js :1595 gains `vaultDir: VAULT`; +1 line after :1598 (claude-imports init). New IPC hq:claude-hub:documents|document,
  hq:claude-imports:pending|dismiss|event; hq:claude-hub:import takes (kind, {dropId}); preload hq.claudeImports. New env HQ_IMPORTS_DIR.
  CONTRACT.md: data/claude schema 2 + imports-seen.json; vault notes may carry source: chatgpt.

## 2026-10-25 12:50 · FROM frontend · main @ fd8e885
DONE: Claude Hub H5 (plan docs/superpowers/plans/2026-10-15-claude-hub-h5.md), commits H5.1–H5.7 + this meta commit: Hub op contextFor
  (context.mjs; OR-of-keywords FTS, cited "chat <title>, <date>", inside a budget); llm-context.js 'claude' section
  (3 000-char reserve, Hub-down notes; unticked = byte-identical); Ask's 7th chip "Claude history"; Save to vault
  (claude-vault.js: local-model draft → editable v5 dialog → atomic write under VEEMO CORTEX/30_Areas/Claude/, Replace
  only for the chat's own note); golden-diff.mjs; CDP ask-claude-chip, vault-preview-confirm. Real-instance gate on
  fixtures: PASS (local model: none → offline branch: save / refuse-without-replace / replace / outside-path refusal all ok; Hub-down note seen: "Claude Hub is not running", Hub back to ready within 6 s, scan section present). Suites: hub 125, dashboard 461, v5 373, selftest 2280 combos 0 failures, CDP 24/24. Owner's vault and data/claude untouched; no chat text in logs.
IN-FLIGHT: none. The owner's app was NOT restarted (controller's step); the extension is unchanged.
ASKS: none.
BREAKS: main.js +2 lines (claudeHub passed to llmContext.assemble in hq:llm:chat; require('./claude-vault').init after
  the Hub host init). New IPC hq:claude-vault:preview|save + preload hq.claudeVault; hq:llm:chat include.claude +
  sections[].cites (IPC-CONTRACT rows). hq-oracle-include gains "claude" only while on (v3 rollback drops it — spec).
  New env HQ_VAULT_DIR (gates). CONTRACT.md: the vault-note shape.

## 2026-10-25 · FROM frontend (Claude Hub H4 — final review fixes) · main @ ff432af
DONE: 1408c6e — extension claude.ai sync: one run and one 2 s pacer per service-worker life (alarm + click + back-to-back
  runs share them); switching sync off bumps a run generation, so off→on mid-run stops the old run instead of doubling the
  request rate, and a superseded run never rewrites the status. ff432af — the Hub's export import announces saved
  claude.ai chats ('changed' ids) every 200 and at the end; the import toast now says "the counter shows progress; chats are
  listed when the import finishes" (80a850a). e70eda2 — Sync pressed mid-run keeps 'syncing' (no 'idle' over a live run). Suites: hub 112, dashboard 436, v5 357, selftest 2236 combos 0 errors, CDP 22/22.
IN-FLIGHT: none.
ASKS: owner — reload the WorkspaceHQ Bridge extension at chrome://extensions (manual) for the sync fix; restart the app so
  the Hub child announces import batches.
BREAKS: none (no main.js, IPC, contract or golden change).

## 2026-10-25 · FROM frontend (Claude Hub H4 — claude.ai export import + extension live sync) · main @ a7900e2
DONE: claude.ai chats and Projects join the Claude library. Claude › Chats (and Settings) › "Import claude.ai export" — a
  .zip picked in main, unzipped and parsed by the Hub (dependency-free streaming reader; conversations.json streamed one
  chat at a time; secrets masked before any cut; counts-only report; idempotent; forgotten chats never return; data/claude/tmp
  job folder always removed). Bridge GET /claude/sync-state + POST /claude/sync (token rule, 4 MB cap, schema checks).
  Extension 0.4.0: "Sync claude.ai" asks for https://claude.ai/* on click, read-only GETs <= 1 / 2 s, backoff, pauses with a
  visible status on a shape change, 20 chats per 5-min run, on/off in the popup. claude.ai chats carry the claude.ai badge
  and "Continue in Claude Code" (new Code chat in a picked project, seeded, uses your Claude quota). Gate: fixture second
  instance on port 9495 (import 3 chats / re-import idempotent / forget survives re-import / continue via fake claude in plan
  mode / logs carry no chat text) + real bridge + real Hub on port 47899 (403 / imported 1 / unchanged 1 / 413 / 400 /
  sync-state); no owner data touched (data/claude unchanged, no data/claude/tmp). Suites: hub 111, dashboard 434, v5 357,
  selftest 2236 combos 0 errors, CDP 22/22 incl. claude-import-progress.
  Commits: c7905c3 59b99d4 43bd079 6acbc68 3e34c5e df42a6f d5f4cf2 567beaf 961b5e3 2571e4f 42ddb0e 86afa48 800dcb9 204abaa a7900e2 (fe:) + this meta: gate commit.
IN-FLIGHT: none.
ASKS: owner — reload the WorkspaceHQ Bridge extension at chrome://extensions to get 0.4.0 (manual; nothing reloads it),
  then press "Sync claude.ai" in its popup when you want live sync. Controller — restart the app (tools\rollback.ps1 v5)
  so main loads claude-import.js and the Hub child gets the new ops.
BREAKS: none for structure (no collector/schema change). Additive IPC/contract rows: IPC-CONTRACT "phase H4",
  CONTRACT "Local bridge routes — Claude Hub live sync" + data/claude H4 note. main.js: one line (claude-import hook).
  browser-bridge.js: one require + one route hook.

## 2026-10-25 · FROM frontend (Claude Hub H3 — final review fixes) · main @ e362806
DONE: e2e451f — one turn per chat now also covers new / claude.ai-seeded chats (a turn counts as code:<session> from the CLI's
  init line; a Continue on it is BUSY). e362806 — a reload/crash/close of the sending window stops its chat turn (hq:llm:chat
  idiom; a reload during resolve spawns nothing), so no headless Allow-edits turn holds a slot. IPC-CONTRACT engine-rules text
  (additive). Suites: hub 91, dashboard 410, v5 347 (v5 untouched). Second instance (port 9494, fixtures, fake claude):
  reload mid-turn kills the fake, no orphan, same chat sends again. Report: .superpowers/sdd/2026-10-15-claude-hub-h3/final-fix-report.md
IN-FLIGHT: none. The owner's app runs pre-fix code until restarted (tools\rollback.ps1 v5).
ASKS: none. BREAKS: none (main.js lines touched: none; a scan reload now ends a running in-app chat turn, by design).

## 2026-10-25 · FROM frontend (Claude Hub H3 — in-app chat, Claude Code engine) · main @ 43dd163
DONE: Claude › Chats composer — New chat (WorkspaceHQ project or Claude Code folder), Continue (claude --resume),
  Read-only (plan) / Allow edits (acceptEdits), Send / Stop, "Uses your Claude quota" on every send, streaming text with
  collapsed tool rows; project-page "New chat" opens it. Engine dashboard/claude-chat.js (+ stream-parse.js parseEvents):
  one process per turn, prompt on stdin, cwd = project or Hub-recorded folder (deny list wins), launcher-safe tree stop,
  1 turn per chat / 3 total / 10 min. claude.ai "Continue in Claude Code" seeding is in the engine (unit-tested); its
  rows arrive with H4. Gate: fixture second instance (port 9494) + fake claude, no quota spent — refusal of a non-UUID id
  spawns nothing; Continue/Read-only and New chat/Allow edits argv equal buildArgs; Stop leaves no fake/cmd orphan; project
  page New chat preselects the project; logs hold no conversation text; owner's data/claude untouched. Suites: hub 91,
  dashboard 407, v5 347, selftest 2220 combos 0/0/0, CDP 21/21. Commits: dad218c 6b4e25d 1dfe8b8 2edf23d a3aa3be 7cf50c6
  4bc19c1 81c763b a176b31 caed336 174d61a 5251cdd 43dd163 (plan 63e5403).
IN-FLIGHT: none. The owner's app runs the H2 code until restarted (tools\rollback.ps1 v5) — that loads claude-chat.js and the preload claudeChat block.
ASKS: none.
BREAKS: none for the struct lane. main.js lines touched: 1 (the claude-chat init line after the claudeHub init line).
  New test override HQ_CLAUDE_BIN.

## 2026-10-25 · FROM frontend (Claude Hub H2 — final review fix) · main @ e27d9f3
DONE: History "Claude activity" per-project tokens now read "N tokens (whole chat)" + tooltip — stats sums all usage of
  chats active in the window (usage has no timestamp). IPC-CONTRACT stats row states the scope. Commits 1263ea0 e27d9f3.
  Store + logic regression tests; tpl hash + vals golden (history.claude-activity) re-recorded. Suites green (hub 91,
  dashboard 379, v5 333, selftest 2180 combos 0/0/0).
IN-FLIGHT: none. ASKS: none. BREAKS: none (no schema/INDEX_VERSION change, main.js lines touched: none).

## 2026-10-25 · FROM frontend (Claude Hub H2 — library + activity) · main @ e806491
DONE: Claude tab › Chats (filters, FTS search with text-only highlights, paged thread, Forget) + Projects (link chips),
  project-page "Claude" (last 5 + New chat via terminal), History "Claude activity" (estimate), System Reindex.
  Hub ops stats/link + link.mjs auto-match from data/latest.json (read-only); H1 deferred items 1–10 closed.
  Commits: bbee7a5 3b99a10 d39f109 99dc7bf 9132bd3 09921b4 a32b0ff 2424b31 73f6851 4c9a413 2007eae dd9c8a6 60a67ad 53c2ad0 5e4fef4 72dae4a 813456c e63771d (+ this docs commit).
  Gate: all suites green (hub 90, dashboard 379, v5 332, selftest 2180 combos, CDP 19/19); real second instance on fixtures
  (port 9493, temp db/home/latest.json) passed chats, search, thread, live title change (<1 s), link chips/unlink/link,
  Reindex (choices survived), History activity (estimate), Forget (transcript untouched), log has no message text,
  repo data/claude untouched.
IN-FLIGHT: none. The owner's app still runs the H1 code until the controller restarts it (tools\rollback.ps1 v5);
  that restart rebuilds the index once (INDEX_VERSION 1 → 2).
ASKS: none.
BREAKS: none for the struct lane. data/latest.json is now READ by the Hub (never written) — a shape change to
  projects[].path / archived_projects[].path should be announced in CONTRACT.md as before. main.js lines touched: none.

## 2026-10-19 · FROM frontend session on the owner's direction (workspace discovery) · main @ e63771d
DONE (committed struct: + fe: + meta:; collector.config.json and the schema also carry the struct lane's earlier uncommitted hunks; run-scan.ps1 and data/quest-overrides.json are STILL uncommitted, struct lane to review):
  collector/lib/discovery.mjs (+test), collector.mjs, assemble.mjs, collector.config.json, schema, adapter.mjs (+test).
  WorkspaceHQ now reports every folder/vault/loose file under Documents with facts (CONTRACT entry "Workspace discovery"),
  auto-detects Obsidian vaults, flags missing configured paths, recomputes anomalies/trivial, and records enrichment age.
  Schema validates again (reopened_from). Tests: collector 32, v5 332, dashboard 379, mcp 4 — all green.
  v5 System › Workspace clutter now lists: Needs a look, Untracked folders, Ignored folders, Loose files.
IN-FLIGHT: golden fixtures not re-baselined (inventory shape changed by design). Nightly still -NoEnrich.
ASKS: frontend (main.js is gated, so NOT touched): dashboard/main.js:40,76 still write to VEEMO CORTEX/10_Daily and
  30_Areas/Projects (neither exists; vault now uses 20_Projects). Show scan.enrichment_age_days in the UI when > 1.
  Verify the "I learned…" capture reaches data/learnings.json (file has never existed; Knowledge XP is 0).
  struct: decide Sunday enrichment in run-scan.ps1; fill browser_domains per product; tests.passing is always null.
BREAKS: none (all additive). vault count 2 -> 8, products 8 -> 9 (product-intel-wizard path fixed).

## 2026-10-16 · FROM frontend (scanner fix, struct-lane files, owner-authorized) · main @ e509fcf
DONE: the owner found the app "frozen": 0 open tasks since July while Home listed 48 dirty files. Two causes,
  both in the collector (struct lane; the owner told this session to fix them directly):
  (1) collector/lib/quests.mjs — a done quest could never be re-raised (stable id, haveQuest). Now a done
  quest whose condition returns is raised as "<id>-r<N>" with reopened_from (CONTRACT.md entry); dismissed stays
  quiet. 3 new tests, collector/lib 25/25.
  (2) collector/enrich.mjs — Node ≥ 20.12 refuses to spawn claude.cmd (EINVAL), so every scan since August
  logged "claude CLI not found" and carried the 2026-08-10 enrichment forward. Now uses the claude.exe behind the
  npm shim (or the shim via a shell); default model = CLI alias "sonnet". Verified: enrichment.json refreshed
  for 8 projects; a -NoEnrich scan then raised the re-opened tasks into latest.json.
IN-FLIGHT: the devfleet (chat history library plan committed e509fcf; in-app chat plan being written).
ASKS: struct lane — your uncommitted run-scan.ps1 (-NoEnrich on the nightly task) and collector.config.json are
  untouched; please review (1)/(2) and commit or amend as you see fit.
BREAKS: none for the renderer (reopened_from is optional). Quest ids may now carry a -rN suffix.

## 2026-10-16 · FROM frontend (archive sources + prompt library spec; Hub fleet relaunched) · main @ 55c4651
DONE: spec docs/superpowers/specs/2026-10-15-archive-and-prompt-library-design.md — H6 new archive sources (the
  owner's ChatGPT data export, local Claude memory notes / CLAUDE.md files / ~/.claude/history.jsonl, prompt notes)
  and P1–P3 prompt library (vault-primary: notes under VEEMO CORTEX/40_Resources/Prompts are the source of truth,
  the Hub keeps index + usage; harvest → promote with confirm; run via H3 chat / terminal / clipboard; packs).
  55c4651 = 25 feature ideas for triage.
IN-FLIGHT: ONE chained devfleet run: Claude Hub H2–H5 (plans + build, from the 2026-10-13 spec) then H6, P1–P3
  (from this spec). The 2026-10-15 runs (wf_ae4c725c-816, wf_ce967a0d-3ee) died on the session usage limit with
  nothing written and nothing committed. Fleet agents commit fe:/meta: with explicit pathspecs — expect many small
  commits on main; the struct lane's 4 uncommitted files are untouched by rule.
ASKS: none.
BREAKS: none yet. H6 bumps the hub.sqlite schema (CONTRACT.md entry lands with it).

## 2026-10-14 · FROM frontend (Claude Hub H1 LIVE on the owner's machine) · main @ 0a259f0
DONE: owner app restarted on the H1 build (tools\rollback.ps1 v5, PID 35948); the old pre-fix index was
  deleted first so the rebuild started from a fresh file (no residue of unmasked fragments). Hub (PID 30896,
  system Node 25.6.1) backfilled the real ~/.claude in ~25 s: 25 projects · 95 conversations · 81,677
  messages, index_version 1, last_error null. Lock is {pid, db} JSON. Final whole-branch review clean after
  one fix wave (5/5 addressed; 4 minors parked with rulings). Pushed main → fe/v5-clean-pass @ 0a259f0.
IN-FLIGHT: H2 (library + activity UI) next; it gets its own plan. Deferred minors are listed in the H1 plan's
  final-review triage (paging tiebreak by id, surrogate-safe cut, cross-conversation token dedupe, secure_delete).
ASKS: none.
BREAKS: none new.

## 2026-10-14 · FROM frontend (Claude Hub H1 final-review fixes) · main @ 8310ce7
DONE: bedd0d5 secrets masked on the FULL text before any parser cut (tool results, system/user text, titles,
  tool hints; a straddled key used to leave an unmasked prefix in the index) + '<synthetic>' never recorded as a
  session's model. 8310ce7 the index lock survives pid reuse (a live pid owns it only as node running hub.mjs on
  the same db; a hard kill + reused pid no longer makes every later Hub a reader) + meta.index_version: an index
  written by older code is rebuilt once. claude-hub 73/73, dashboard 377/377, v5 310/310.
IN-FLIGHT: none. Owner: the next app start rebuilds data/claude/hub.sqlite once (card shows Indexing; the reset
  takes a few seconds, then a full backfill). Not restarted by this session.
ASKS: none.
BREAKS: nothing for the struct lane. data/claude/hub.sqlite.lock is now {pid, db} JSON (plain pid still read);
  CONTRACT.md data/claude entry + IPC-CONTRACT.md Hub paragraph amended (additive).

## 2026-10-14 · FROM frontend (Claude Hub H1 — every Claude Code session indexed locally, System card) · main @ 51148c8
DONE: 727b6f8..49100ab (Tasks 1-7: secret masking, SQLite/FTS5 store, transcript parser, incremental
  ingest, the Hub process, main-side host + hq:claude-hub IPC, System › Machine "Claude Hub" card) and the
  gate fixes 4670ac9 (card re-asks health on the Hub's "changed") + 51148c8 (a dead Hub is pushed as
  "starting"). Real second-instance gate (fixture ~/.claude, own db + profile, port 9492) 10/10: card
  "Indexed · 3 chats · 2 projects · 5 messages"; an appended line shows within 1.4 s; killing the Hub child
  shows "Starting…" then "Indexed" again; repo data/claude/ untouched. dashboard + claude-hub 438/438, v5
  310/310. H2-H5 are outlined in docs/superpowers/plans/2026-10-13-claude-hub.md.
IN-FLIGHT: owner's app not yet restarted on this build (tools\rollback.ps1 v5); its first run backfills the
  real ~/.claude into data/claude/hub.sqlite (gitignored, owner's data).
ASKS: none.
BREAKS: main.js 47, 1594, 1638 (one-line hooks; all logic is in the new dashboard/claude-hub-host.js).
  preload: claudeHub.health() / claudeHub.on(cb). data/claude/ is gitignored (CONTRACT.md entry); no
  latest.json or sidecar shape changed. New env overrides: HQ_CLAUDE_HOME, HQ_CLAUDE_DB, HQ_HUB_NODE. The
  Hub needs system Node >= 22.13 (the app shows "Needs Node 22.13 or newer" otherwise; nothing else breaks).

## 2026-10-07 · FROM frontend (v5 follow-ups — lifecycle log, Studio length + Open, social claim) · main @ 8ce24e5
DONE: 7b52dd6 app-log.js → logs/app-YYYY-MM-DD.log (start/quit reasons,
  crashes, hangs, session end, 15-min 'alive'; the app stopped silently the
  night of 10-06 with no trace — next time the log says when/why); do-commit
  git timeouts that really stop git (a timed-out commit used to land later);
  summon misses stay open with an honest line; XP drip says "est.".
  7d9c703 Studio: recording length via a .meta sidecar, lightbox Open
  (library-contained, 8.3/junction-safe). 2518f71 social claim-before-publish
  (staged → sending → sent/failed; cancel refuses 'sending'). Reviewed:
  dashboard 363/363, v5 299/299, selftest 0/0/0, cdp-gate 17/17, real-app 18/18.
  Owner app restarted on the new main (logs show start, renderer v5).
IN-FLIGHT: none. Owner: reload the extension (now 0.3.0).
ASKS: none. Note: second real-app instances (tests) rewrite dashboard/data.js
  on boot, same as the app — no scan is run.
BREAKS: main.js 10, 21-27, 280, 354-356, 636-701, 899-944, 1560-1611. New HTTP
  routes POST /social/outbox/claim + /release. preload: studio.libraryOpen.

## 2026-10-06 · FROM frontend (v5 LIVE — clean pass done, old renderers quarantined) · main @ e4b7484
DONE: Phase 6 whole-diff review (5 lenses, 25 findings, 24 confirmed by 2
  independent verifiers, all fixed: b55f1a1..83be3e5, 79bad62) — notably the
  do-commit .env refusal now really unstages in repo-subfolder projects, the
  Claude launcher can't run injected commands, recordings stop on a panel
  crash. Trailers re-rendered, outro as designed (dd684a1, e9a9b12), silent
  until the soundtrack is muxed. Quarantine (e4b7484): v2/v3/v4 → legacy/
  (git renames, rollback-only), MCP server → mcp/workspacehq/ (.mcp.json),
  dashboard/ui-version.js: missing/invalid .ui-version → v5. GO-LIVE:
  data/.ui-version = v5, owner app restarted on v5 (tools\rollback.ps1 v5).
  Rollback drill 9/9 (v5 → legacy v3 → v5 keeps theme + Ask history). Real-app
  gate 13/13. dashboard 281/281, v5 296/296, trailer/rollback/mcp 33/33,
  selftest 1932 combos 0/0/0.
IN-FLIGHT: none. Owner: reload the extension (0.2.0); optional soundtrack WAVs.
ASKS: struct lane — nothing reads dashboard-v3/ any more; if a local script of
  yours did, point it at legacy/dashboard-v3/ (rollback only) or mcp/workspacehq/.
  Claude Code sessions started before this pick up the new MCP path on restart.
BREAKS: dashboard-v3/ and dashboard-v4/ no longer exist at the root (legacy/);
  dashboard/index.html, app.js, styles.css, lib/, vendor/ moved to
  legacy/dashboard-v2/. main.js 139-167 (renderer rule → ui-version.js).
  Rollback: tools\rollback.ps1 v3 (hard stop — wait ~5 s after a change).

## 2026-10-05 · FROM frontend (v5 CLEAN PASS — Phases 3, 4, 5 landed) · main @ 3670f5a
DONE: Phase 3 v3 parity in v5 (544b225..9deaf7e): Ask = v3 (sources, Stop
  keeps partial, Retry, New chat; history in v3's hq-oracle-chat format —
  shared with v3), System Re-examine + Note for cleanup, project page flags /
  git risk / suggestions / own side quests, Studio thumbnails + media
  lightbox, Canvas ＋ Note, Automations filters + Rescan + interactive skills,
  Projects search + status chips, What's new · trailers overlay, brief §11.1
  cuts. Phase 4 satellites (d4f04bc..2ea1d73): recordings never empty + pause
  + clean stops, snip save/copy/send-to-Claude, mini HUD jump links, quick-run
  last outcome, summon/shards restyled, all satellites on tokens.css +
  satellite-theme.js + CSP, extension one-at-a-time approval + Skip → cancel.
  Phase 5 (3670f5a): tools/trailer render pipeline. v5 272/272, dashboard
  246/246, trailer 15/15; v5 selftest 1932 combos 0/0/0; 17 CDP scenarios.
IN-FLIGHT: trailer media re-render (outro kept as designed, "v3 out now");
  Phase 6 whole-diff review; Phase 7 flip .ui-version → v5 tonight.
ASKS: struct lane — spellcraft.mjs reads the telemetry rollup; main now
  derives last_outcome/last_exit from the cast log at read time (the saved
  rollup shape is unchanged, no CONTRACT change).
BREAKS: main.js 19-20 (tray-menu, claude-launch requires), 44 (navBridge),
  184-192 (mini-data counts, topQuest.projectId), 251-282 (tray via
  trayTemplate), 441 (hq:scan returns runScan()'s boolean — false = already
  running), 739-761 (studio getProjects/launchClaude, hq:claude-quest →
  claude-launch.js), 1369-1390 (spell-telemetry last_outcome), 1444. New HTTP
  route POST /social/outbox/cancel (staged → canceled only, never publishes).
  Extension manifest 0.2.0 (owner reloads it). record-panel.css removed.

## 2026-10-05 · FROM frontend (v5 CLEAN PASS — Phase 2 correctness + honesty done) · main @ 1621bc6
DONE: 388c7a2 M2 (main: scan guard via liveState, do-commit .env refusal
  before `add -A` + post-add recheck, dev start time, decisions → project
  notes) · 1dbb1f1 P-A · fb72b5b P-B · ea00c3f P-C · f2ad7a7 R1 CDP scenarios
  · 0bb35bd integration + goldens re-recorded (every changed scenario
  attributed) · 1621bc6 Phase 3/4 scaffolding (satellite-theme.js, empty v5
  hook modules). Real-app gate on a throwaway repo: 14/14 (sub/.env flagged
  and refused, .env.example allowed, commit lands). v5 159/159, dashboard
  157/157, selftest 1536 combos 0/0/0, 9/9 fake-bridge CDP scenarios.
  Contract note: Enter in the run-confirm never confirms on a focused button
  or on key auto-repeat (C-1 narrowed by review).
IN-FLIGHT: Phases 3 (v3 parity), 4 (satellites + M4 main.js), 5 (trailers)
  running as one workflow; Phase 6 gate + Phase 7 flip (.ui-version → v5) today.
ASKS: none. Please don't switch branches today (shared tree).
BREAKS: none beyond M2's main.js lines (runScan, hq:do-commit, hq:dev-start,
  hq:log-decision). The struct lane's 4 uncommitted files were never touched.

## 2026-10-05 · FROM frontend (v5 CLEAN PASS — Phase 1 foundations done) · main @ 324f538
DONE: 4b307af F1 (IPC "Pending — v5 clean pass" rows, preload methods,
  skeletons) · 3456a06 F6a ui-prefs/live-state/nav-bridge · 3739613 F6b
  commit-guard/tray-menu/rec-queue/session cwd · 8a8e5e0 F3 tokens.css ·
  4a59b81 F4 error panel + v5 selftest + fake preload + cdp-gate · f46ed2b F5
  element fixes · 8560518 F7 data layer · a8e0bf1 F2a goldens (87 scenarios)
  · 324f538 F2b split (src/tpl, src/vals, src/logic; zero output change,
  independently verified). Tests 256/256; v5 selftest 1536 combos 0/0/0;
  real app boots in v3 and HQ_UI_VERSION=v5 on the new main code.
IN-FLIGHT: Phase 2 (correctness + honesty). Open for M2 (main.js): wrap
  runScan in liveState.scanBegin/scanEnd with try/finally + a per-child
  settled flag; stamp proc.__hqStartedAt in hq:dev-start; commit-guard
  envHits() before `add -A` plus a post-add `diff --cached` recheck; note
  commit-preview's git calls are synchronous with no timeout.
ASKS: none new.
BREAKS: main.js — line 10 (+nativeTheme import), 1071-1072 (live-state,
  commit-guard init), 1476-1477 (ui-prefs, nav-bridge init). session-api.js
  +1 line (sessionTails.setCwd). preload.js additive (uiPrefs, liveState,
  onScanStatus, openAt, onNavigate, commitPreview, studio.recPause /
  panelMode / onRecCommand); shard + summon preloads get read-only uiPrefs.
  v5's app-vals.js / app-more.js are gone (now src/vals/, src/logic/).

## 2026-10-05 · FROM frontend (v5 CLEAN PASS — started) · main @ 211e861
DONE: plan approved (owner): fix + complete v5, restyle satellites, ship the
  two Claude Design trailers as video, then flip data/.ui-version to v5.
  Phases: 0 prereqs · 1 foundations (IPC contract, v5 file split, tokens,
  selftest, element fixes, new main modules) · 2 correctness/honesty · 3 v3
  parity restores · 4 satellites · 5 trailers · 6 verification · 7 go-live.
  This commit: reconstruction marker now actually in dashboard-v5/src/
  app-vals.js (the 2026-10-04 entry said "marked" — it wasn't; corrected),
  CLAUDE.md lane table + hotkeys + renderer-switch facts.
IN-FLIGHT: Phase 1. New main-side files coming (IPC-CONTRACT first):
  dashboard/{ui-prefs,live-state,nav-bridge,commit-guard,tray-menu,rec-queue}.js.
ASKS: none new. (Open from 10-04: add-project channel, single achievement
  catalog, per-day browser deltas.)
BREAKS: none yet. Owner actions pending for trailers: Design project
  download / soundtrack WAVs, content route, music licence OK.

## 2026-10-04 · FROM frontend (v5 — the Claude Design build) · main @ 65630b2
DONE: a7f2f2e + 65630b2 — dashboard-v5/, the owner's Claude Design prototype
  ("Workspace HQ remake scope" › WorkspaceHQ v3.dc.html) as a new renderer,
  wired to window.DATA + window.hq. NOT live: data/.ui-version still says v3.
  Try it for one launch: HQ_UI_VERSION=v5 (new env override in uiVersion()).
  Flip for good: data/.ui-version = v5 (owner's call). Rollback = flip back.
  - src/dc/runtime.js: CSP-safe .dc renderer (Design's runtime needs React
    from unpkg + new Function). Template kept verbatim in src/app.tpl.js.
  - src/live/{adapter,catalog,store}: scans/sidecars → the design's shapes.
  - 9 tabs → realm ids: home=roundtable · projects=forge (+map=lands) ·
    tasks=hunts · automations=grimoire · claude=summoning+conjure ·
    history=legacy+chronicle · system=medbay · life=watchtower+social+
    observatory · studio=studio · ORACLE = the palette's "Ask local model".
  - Tests 25/25 (runtime, adapter, catalog, llm-local). CDP: 36 screens on
    real data, no unresolved bindings; real bridge verified read-only.
IN-FLIGHT: the Design export was cut at 256 KiB mid-renderVals — the tail
  (overlay values: palette placeholder, ask examples, onboarding, scrub
  labels) is reconstructed and marked; swap in the original if re-exported.
  Satellites (WorkspaceHQ v3 Satellites.dc.html) not started.
CUT FOR NOW (UI says "isn't wired yet", owner decision): canvas pin/remove,
  discard staged post, open/search vault, export stat card, per-file commit
  staging (commits everything; refuses if a .env file is in the set), add
  project (copies a collector.config.json entry), idea dismiss (local only).
ASKS (structure): add-project channel (collector.config.json is yours);
  single achievement catalog in data.js (v5 mirrors schema + parity test);
  per-day browser deltas (screen time is a 3-day window, labelled so).
BREAKS: main.js +2 small edits (v5 arm in the ui-version switch, env
  override) — same precedent as the v4 arm. No IPC, contract or hotkey changes.

## 2026-10-03 · FROM frontend (shared docs/ — design brief) · main @ a31d859
DONE: nothing committed. New shared doc docs/design/WORKSPACEHQ-DESIGN-BRIEF.md
  (untracked): full architecture + design brief for a one-shot Claude Design
  prototype — every realm, shell surface, satellite window, data field and
  control (225 controls + 11 engine-only calls + 16 automatic behaviours, §7).
IN-FLIGHT: owner designs in Claude Design next; the prototype comes back to the
  frontend lane to wire (contract in §12).
ASKS (structure, only if the owner's design needs them — see §12.6): per-day
  browser deltas, Obsidian sync status field, single achievement catalog source.
  (pc-health already runs in run-pipeline.ps1 — settled.)
FOUND while mapping (frontend bugs, queued as separate tasks): STUDIO
  recordings save empty (panel seq starts at 1, main waits for 0; stopRec
  doesn't flush the queue); drawer Commit / I learned / Log decision use
  window.prompt(), which Electron doesn't support.
BREAKS: none. No code, contract or hotkey changes.

## 2026-10-01 · FROM frontend (PC-BRAIN PHASE 2 — ORACLE realm) · main @ 56489ae
DONE: ORACLE — a 15th v3 realm (rail order 10.5, after ASSISTANT; keys 1-9
  unchanged) for chatting with the LOCAL model about the user's own data.

  dashboard/llm-local.js: native Ollama /api/chat streaming (num_ctx 8192,
    keep_alive 30m — the /v1 endpoint ignores both), SSE for LM Studio,
    warm() preloads the model into VRAM, run() (draft-commit) now rides
    stream(). LOCAL-ONLY: the chat model is pinned (HQ_LLM_MODEL env, default
    qwen2.5:7b-instruct-q4_K_M) and Ollama *cloud* models (remote_host /
    -cloud) are refused everywhere — they would proxy the CONTEXT and commit
    diffs to ollama.com. probe() returns chatModel; the UI shows that.
  dashboard/llm-context.js (new): builds the grounding CONTEXT main-side from
    latest.json, pc-health.json, browser activity and a read-only keyword
    search of VEEMO CORTEX. Honesty at the source: completion %, health
    index, streak and build status are labelled estimates; LLM-authored
    side-quests and stale insights/suggestions/roadmap are excluded; task
    titles get live "now:" counts; GPU VRAM omitted (WMI bug); vault skips
    30_Areas/Workspace Status/ snapshots and dates every hit. 4 KB/section,
    12 KB total.
  dashboard/main.js: hq:llm:warm / hq:llm:chat / hq:llm:cancel + push
    hq:llm:delta (accumulated text, ~25/s). Job registered before any await;
    aborted if the window reloads, navigates or dies. hq:llm:probe takes
    {force}. Persona split at <!-- after-context -->: answer rules go AFTER
    the data (a 7B model weights them most).
  dashboard-v3/src/realms/oracle/: chat UI — source chips (scan/tasks/
    projects default on), streaming bubble, Stop, New chat, per-day history
    in localStorage, offline + "no local chat model" panels, grounded-in
    footer. Model output reaches ONLY this realm (honesty boundary).
  Also: roundtable/focus.js F-hotkey ignored TEXTAREA (typing "f" in any
    textarea toggled focus mode) — fixed. browser-bridge exports
    BROWSER_WINDOW_DAYS. Med-Bay status row shows the pinned chat model.
    IPC-CONTRACT: llm rows added; stale captureCancel row removed;
    draftCommit row updated.

  Verified: live answers 1.5–2 s warm ("work on today?" → one pick, 22–39
    words); follow-up history; honest "not in what I can see" refusal; vault
    answers; Stop keeps partial; leave-realm-mid-answer re-attaches cleanly;
    offline panel with Ollama killed; selftest 105 combos 0 errors; 64/64
    unit tests. Review workflow wf_7147195b-6ae: 15 confirmed findings, all
    fixed in this block (incl. the cloud-model leak and two high honesty
    findings: model-judged build status, vault snapshots).

IN-FLIGHT: nothing in the frontend lane. collector/collector.config.json,
  data/quest-overrides.json, run-scan.ps1, schema/workspace-scan.schema.json
  are modified in the tree but are NOT mine — left untouched.
ASKS (structure lane): the 11 vanity-metric asks from 2026-09-15 still
  stand. The ORACLE now labels those values as estimates in its context,
  but fixing them at the source (VAN-04 first) makes every answer better.
  VAN-05 got more visible: even with live "now:" counts beside it, the 7B
  model quotes a task title verbatim ("Push DOCTOR CHERFIA CLINIC (5
  ahead)"). Refreshing quest titles/insights at scan time
  (collector/lib/quests.mjs carries them unchanged from creation) fixes
  what the ORACLE says, not just what the board shows.
  Also: pc-health GPU VRAM via nvidia-smi instead of WMI AdapterRAM.
BREAKS: none. hq:llm:probe gained an optional arg; draft-commit return
  shape unchanged. Ollama must be running for ORACLE (it starts at login).

---

## 2026-09-15 · FROM frontend (DEAD-WEIGHT AUDIT — 4 commits) · main @ f39ec2a
DONE: comprehensive dead-weight audit executed against user-approved plan.
  Audit workflow wf_defbfc07-16d (45 agents, 39 candidates → 29 survived
  adversarial refute → tiered removal plan). Four commits landed:

  77ca7e9 Tier 1 FE-lane deletes (5 items, ~70 LOC):
    - notifyForLatest() + 3 call sites — positive-outcome OS toasts retired
      per ambient-companion spec (not actionable, celebrates what user
      already did). Collector-side notify:true flags stay for future
      ambient/voice surface (STRUCT lane owns those).
    - hq:orphan-archive handler + preload binding + IPC-CONTRACT row
    - hq:acted-on-read handler + preload binding + IPC-CONTRACT row
    - Observatory NotebookLM shelf (M4 producer never shipped)
    - capture:idea no-op action; oracle "capture" remap → capture:note

  eef04e9 Brain-dump retirement (S7 finding, 80+ days zero use):
    - Deleted: dashboard/capture.html, openCapture() function, captureWin
      var, Ctrl+Alt+Space globalShortcut, tray "Quick capture" menu item,
      hq:capture-cancel handler, preload captureCancel binding.
    - KEPT: hq:capture-save handler (medbay "Note for cleanup" button
      still uses it via core/actions.mjs capture:note action) and MCP
      hq_capture tool (dashboard-v3/mcp/server.mjs unchanged).

  80c7653 ATLAS → HISTORY merge:
    - forecastCard + followCard folded into legacy/view.js as renderProgress
    - Re-scoped CSS rules appended to legacy.css
    - Deleted: atlas/manifest.js, atlas/view.js, atlas.css
    - boot.js + lexicons.js + realms.css purged of atlas refs

  1815a2d WARROOM retirement:
    - Deleted entire warroom/ folder (5 files) + warroom.css (~840 LOC)
    - Forge's existing "At risk" filter + "Risk" sort cover the same
      signal from the same underlying metrics
    - triage() export in intel/derive.mjs KEPT (pure function, reusable);
      its 2 tests in derive.test.mjs still pass (12/12 total)

  Total: ~1136 LOC removed across 4 commits. Zero test failures. Rail
  goes from 16 realms to 14. Two dashboard/ files smaller by 100+ lines.

IN-FLIGHT: nothing.

ASKS for STRUCTURE lane (11 vanity-metric fixes the audit surfaced —
  ranked by keystone impact; VAN-04 unlocks 3 others):

  V1 (keystone) VAN-04 — enriched=true never ages out (5-line fix):
    collector/assemble.mjs:52-59,306 — set enriched only when scan_id
    matches today (or age <= N days). Currently enrichment.json is
    36 days stale and the ~ estimate marker never fires. Cascades: fixes
    VAN-03/05/08 by making the ~ marker do its job everywhere.

  V2 VAN-01+13 — scan-day streak → commit-day streak:
    schema/gamification.config.json:63-66,95 (rename scan_streak_7 →
    commit_streak_7), collector/lib/gamification.mjs:35-41 (compute from
    commit_days already in raw-metrics.json), collector/assemble.mjs:310,
    dashboard/main.js:179,280 (tray tooltip), dashboard/mini.html:114 (HUD)

  V3 VAN-02+ streak_day XP — the +10 unconditional-per-scan reward
    (Tier 1 #3, structure-lane): schema/gamification.config.json:39 remove
    source, collector/assemble.mjs:125-127 stop emitting. This is the
    purest activity-XP violation — cron heartbeat rewards itself.

  V4 VAN-10+11 — project graduation to Shipped shelf:
    collector/assemble.mjs:67-73,295-300,339-364. Add active|shipped|
    archived lifecycle; auto-graduate on measured signals; graduated
    projects leave daily_top3 rescue selection. Kills the "Rescue X —
    dormant 96d" nag currently haunting the daily Obsidian notes.

  V5 VAN-08 — auto-dismiss stale quests when evidence vanishes:
    collector/lib/quests.mjs:36-44. age_days > N AND !autoSatisfied AND
    evidence-fact-still-present === false → status='dismissed_stale'.

  V6 VAN-05 — stamp soft fields with scan_id_authored:
    collector/lib/projects.mjs:161-163. Age markers or drop when the
    evidence-object referenced no longer matches current metrics.

  V7 VAN-03 — HUD HP bar leaks estimated completion% into ambient:
    collector/lib/gamification.mjs:32 (compute measured_health without the
    completion% weight), dashboard/main.js:179,280 (route measured_health
    to tray), dashboard/mini.html:112-115.

  V8 VAN-07 — data/quest-overrides.json GC after resolution:
    collector/assemble.mjs:83-99. Filter overrides to entries whose
    quest_id ∈ current quests[], write back pruned.

  V9 VAN-12 — knowledge_xp gate on measured evidence:
    schema/gamification.config.json:99, collector/assemble.mjs:132-134.
    Currently every learnings.md line = +15 XP with no evidence link.

  V10 S6 — Spellcraft XP only on outcome:
    collector/lib/spellcraft.mjs, collector/assemble.mjs,
    schema/gamification.config.json. XP only when outcome:'resolved' AND
    exit_code===0 AND duration_ms >= 5000. Fizzles earn zero.

  V11 (spec §5 floor, larger) VAN-09 — deterministic voice layer:
    Build dashboard/voice.json (curated line library) + collector/voice.mjs
    (deterministic line picker). Once landed, retired positive-outcome
    notifications can migrate their happy-events to the tray tooltip /
    dashboard header voice line instead of nowhere.

BREAKS: none. Two rail tabs (ATLAS "ANALYTICS", WARROOM "ON FIRE") disappear
  in the UI; every unique piece of content moved into a live realm or was
  itself the redundancy. Ctrl+Alt+Space frameless capture no longer opens
  (retirement approved by user); the underlying capture IPC still works.
  Positive-outcome OS notifications no longer fire (retirement approved
  by user); no other flow depended on them. IPC-CONTRACT.md purged of the
  two dead handler rows.

VERIFY on next relaunch: rail shows 14 realms (was 16 — ATLAS + WARROOM
  gone). HISTORY realm now has forecast + follow-through cards below the
  trends charts. PROJECTS realm unchanged (already had At risk filter +
  Risk sort). Ctrl+Alt+Space is a no-op. No OS toasts on scan-complete.

---

## 2026-09-13 · FROM frontend (PC-BRAIN PHASE 0/1) · main @ bc9790b
DONE: local-model seam + first live swap.

  Approved plan lives at ~/.claude/plans/stateful-sparking-curry.md (WorkspaceHQ →
  PC Brain, six phases). Phases 0 and 1 landed in this commit.

  dashboard/llm-local.js (new): OpenAI-compatible HTTP client. probe() detects
    Ollama (:11434) then LM Studio (:1234) with a 1.5s timeout each; result
    cached 30s. run({system, prompt, model, timeoutMs}) POST /v1/chat/completions.
    Clean-fail contract: on unavailable/error returns {status, reason} — NEVER
    throws. Cache is invalidated on any HTTP error inside run() so a runtime
    that goes down mid-session is re-detected on the next call.

  dashboard/llm-persona.md (new): GLaDOS × Navi system prompt for the future
    Oracle realm. Hard grounding rule: "you may only ground in the context
    given; if the answer isn't there, say so — never invent numbers/names/ids".

  dashboard/main.js: added `hq:llm:probe` IPC (presence-only; no prompts through
    this channel). Swapped `hq:draft-commit` to try local first (30s timeout);
    on {status:'unavailable'|'error'} falls through to the existing
    claudeSessions.run() path (90s Claude CLI). Output contract unchanged;
    added `via:'local:<runtime>'|'claude'` field for renderer diagnostics.

  dashboard/preload.js: `probeLlm()` renderer binding.

  dashboard-v3/src/realms/medbay/view.js + styles/realms/medbay.css:
    "AI runtime:" status strip at the top of med-bay. Paints from module-cached
    LLM_STATUS instantly on re-render; refreshRuntimeStatus() called once on
    mount. Three states: probing (pulse), ok (green dot + runtime + top model),
    off (muted dot + "install Ollama or LM Studio…").

IN-FLIGHT: nothing.
ASKS: none for structure lane yet. Phase 6 (collector/guide-bake.mjs +
  run-pipeline.ps1 insertion) is a struct-lane ask when the time comes;
  Phases 2–5 stay entirely in frontend.
BREAKS: none. draft-commit's return shape is a strict superset (adds `via`);
  existing renderers ignore extras. No contract, hotkey, or IPC channel
  removed. Zero effect until the user installs a local runtime.

USER ACTION for Phase 0 gate: `ollama pull qwen2.5:7b-instruct-q4_K_M`
  (5 GB, fits 8 GB VRAM), then relaunch app → medbay shows the green row.

VERIFIED (2026-09-14, workflow wf_77ee6712-315, 6/6 agents, verdict PASS):
  - Ollama installed via winget, qwen2.5:7b-instruct-q4_K_M pulled (4.7 GB).
  - Warm draft-commit round trip: **3539 ms** through llmLocal.run() with a
    realistic 60-line mock diff → clean `refactor(users): migrate routes to
    async/await` + blank line + 2-bullet body. Well inside the 30 s renderer
    cap.
  - Adapter clean-fail contract: 8/8 adversarial cases pass (empty/null/
    missing prompt, bad model → HTTP 404, 1 ms timeout, 5×probe cache, force-
    reprobe, AbortController+finally audit). run() and probe() never throw.
  - Fallback path: taskkill ollama → probe reports {available:false} → run()
    reports {status:'unavailable'} — the exact non-'done' signal main.js line
    775 uses to fall through to claudeSessions.run(). Restart → auto-detect.
  - Honesty boundary intact: llmLocal.run() called exactly once, only from
    hq:draft-commit's dialog surface. Tray tooltip, native notifications,
    mini HUD, deterministic voice all remain measured-only.
  - Wiring: node --check clean on main.js, preload.js, llm-local.js. All 12
    wiring checks pass with line-level evidence.

KNOWN gap (non-blocker, track for Phase 2): llm-local.js auto-selects
  models[0].id. A user whose first-listed model is an embedding model would
  get bad completions. Fix: model preference config, or filter by
  capabilities: ['completion']. Phase 2 (AI Guide realm) should own this
  since it introduces the model-picker UX.

---

## 2026-09-09 · FROM frontend (v3 IS BACK + STUDIO + ICON SET) · main @ 096a16d
DONE: full pivot away from v4 back to v3, plus two greenfield features.

  UI-VERSION FLIP: data/.ui-version → v3 (user-owned file, one-line change,
  instantly reversible). The v4 renderer stays on disk but nothing loads it.

  STUDIO — screen recording + snipping suite (6 commits):
  086f2ef main-process wire + preload surface + screen-capture.js module.
  eb7a8d8 per-display snip overlay (frozen-desktop + region drag + Esc cancel).
  bdad79e record panel (source picker, mic + system audio, VP9+Opus with codec
    fallback ladder, 500ms MediaRecorder chunks streamed to main via
    hq:studio:rec-chunk, atomic .part→rename).
  61bdf88 STUDIO realm — capture gallery with SNIP/RECORD triggers and honest
    bridge gating.
  ece983d fix (reliability review): panel beforeunload was calling recAbort
    mid-record and deleting the .part; now calls recStop so window close
    finalizes cleanly.
  d00337f fix (security review): hq:studio:settings-set was accepting an
    unvalidated rootOverride that turned shell.trashItem into an arbitrary-
    file trash primitive; patcher now skips that key entirely.
  New IPC channels (all documented in docs/sync/IPC-CONTRACT.md BEFORE
  handlers): hq:studio:{panel-toggle, snip-arm, snip-frozen, snip-commit,
  snip-cancel, rec-sources, rec-start, rec-chunk, rec-stop, rec-abort,
  rec-status, rec-toggle, library-list, library-reveal, library-delete,
  settings-get, settings-set}. Storage: <homedir>/Videos/WorkspaceHQ/
  {screenshots, recordings, .thumbs}. Hotkeys: Ctrl+Alt+S snip, Ctrl+Alt+R
  record, Ctrl+Alt+L open STUDIO realm.

  ICON SET — 29-symbol SVG sprite, hand-authored (Freepik generation would
  have cost 10,500 credits; unlimitedAppliesHere:false on this MCP session):
  ca0e17c the sprite (dashboard-v3/icons/hq-icons.svg) + preview.html +
    dashboard-v3/src/ui/icons.js helper (injectIconSprite / icon(name,opts) /
    hasIcon(name)).
  2f76427 wire the sprite into shell.js rail with sigil fallback + STUDIO
    SNIP/RECORD verbs. boot.js awaits injectIconSprite() before startShell()
    so the first paint sees symbols (a fire-and-forget version rendered 16
    fallback sigils because the fetch was still in flight — verified with a
    throwaway harness).
  96994be favicon set at 16/32/48/128/256 (initially rasterized from the
    roundtable HOME glyph).
  b1aa6bf dedicated i-brand-app mark — nested hex + central hub — and
    re-rasterized favicons. The nested-hex geometry echoes the level-coin
    frame, so the favicon reads as part of the same HUD vocabulary.
  9eb5d63 verb icons on roundtable/hunts/forge — the three most-visible
    surfaces. FOCUS bullseye on QUICK WIN/RESCUE cards, Open + Done on
    every quest row, Send Claude + Add to ideas on all 8 project cards.
    Forge introduces the verbButton() / setLbl() pattern so state
    transitions (Opened ▸ / ✗ Not opened — retry / Saving… / Noted) swap
    the label without wiping the icon.
  84a3cd1 grimoire verb icons — DEEP SCAN (focus), RESCAN + all runnable
    spellcards + drawer RUN (run), drawer Open file (open). 24 live use-refs.
  4b6eb50 medbay verb icons — Re-examine + Run scan + fix-card RUN (run),
    Note for cleanup (idea). 24 live use-refs.
  096a16d summoning verb icons — Start session (dispatch). 1 live use-ref.

VERIFY: v3 selftest combos=112 errors=0 PASS across all 16 realms × 7 themes
  (up from 105 pre-STUDIO). No handler-registered errors from studio IPC in
  the real preload; guarded-call discipline holds. Live icon count on
  grimoire=24, medbay=24, summoning=1, plus roundtable/hunts/forge/rail/studio
  from earlier commits. 0 renderer console errors across all shots.
IN-FLIGHT: nothing uncommitted of mine.
ASKS: none. warroom realm was requested in the fleet brief but does not
  exist in dashboard-v3 (grep for "warroom"/"wr-act"/"wr-claude" returns 0
  hits — the classes live in dashboard-v3/src/ui/components.js .dwr-actionbar,
  which is shared-component territory, not a realm). If the structure lane
  wants a warroom equivalent, the closest v3 realm is watchtower.
BREAKS: dashboard/main.js gained one require + one init line + two
  globalShortcut.register calls for the studio module. dashboard/preload.js
  gained a window.hq.studio namespace (panelToggle, snipArm, recToggle,
  recStatus, libraryList/Reveal/Delete, settingsGet/Set, onCaptureAdded).
  Any tooling that enumerates preload keys will see the new surface.


## 2026-09-05 · FROM frontend (v4.3 — BEAUTIFY SALVAGE + DESIGN GATE) · main @ f4541dd
DONE: salvaged the v4.3 fleet that died on the session limit, then finished it.
  4dd91f2/5ab420f/138168e/c096736 land the four beautify surfaces whose JS+CSS
  both survived (AGENT 11→7 passive outlines, SYSTEM 16→7, NOTES 11→5,
  AUTOMATIONS 9→3). 5c0086e finishes HISTORY, which the fleet left HALF-landed:
  its agent had promoted the momentum forecast into a surface hero and died
  before writing one line of CSS, so every class the hero emitted had zero
  rules, `.lb-tab` had only an `.is-on` modifier (tabs rendered as native
  bordered buttons), and charts.js had dropped `.panel` with nothing replacing
  the background step. 7ac0767 adds the design gate + the two defects it caught.
  f4541dd un-boxes the shared `.chip` — 32 outlined rectangles on PROJECTS
  alone were the "too crowded" complaint in its purest form.
  f4541dd un-boxes the shared `.chip`; 25e76d7 makes `.figure` neutral — it
  was --fs-2xl violet WITH A GLOW on every numeral in the app, which made
  HISTORY/timeline's "2,186 TOTAL XP" a second focal out-shouting the hero and
  blew the <=2 violet budget on any surface with three stats. home.css and
  work.css had each already opted out of it independently.
VERIFY: v4 selftest 9 surfaces / 0 errors PASS; 125/125 unit tests by file;
  v3 regression 105 combos / 0 errors PASS; layout gate 0 findings across all
  13 surface/TAB combinations; 13 screenshots, 0 console errors. REAL-PRELOAD
  run (HQ_V4_PRELOAD=v2) also 9/0 PASS: the four "no handler registered" lines
  it prints are the dev harness registering no IPC at all — all four channels
  exist in dashboard/main.js — and the surfaces degrading to 0 renderer errors
  is the guarded-call discipline proving itself.
BLIND SPOT CLOSED: both harnesses only captured whichever tab mounts first, so
  TROPHIES, TIMELINE, SCREEN TIME and SOCIAL had never been rendered once. They
  now walk every in-surface tab; that is where the .figure rival-focal was found.
NEW TOOLS: `dashboard-v4/tools/shot-surfaces.js` (a PNG per surface — parks the
  window OFFSCREEN, because `show:false` is never composited and capturePage()
  returns a stale frame; the first run wrote AUTOMATIONS pixels into
  history.png) and `tools/check-layout.js` (overlap/overflow/max-3-tiles-per-row;
  rects intersected with clipping ancestors, or scrolled-out content reports
  hundreds of phantom overlaps — 476 findings, 3 real).
IN-FLIGHT: nothing uncommitted of mine. `data/quest-overrides.json`,
  `run-scan.ps1` and `schema/workspace-scan.schema.json` remain pre-existing
  modifications owned elsewhere and were NOT touched.
ASKS: none. The nightly scan still looks stalled (snapshot 2026-09-03, "2d ago")
  — structure lane may want to confirm the scheduled task is firing.
BREAKS: `.chip` in components.css no longer has a border (background step +
  severity wash instead) — any new surface relying on a chip outline must set
  its own. HISTORY cards are `.lb-card`/`.lb-panel` rather than `.panel`, and
  a scoped `.lb-root .panel` override neutralises the two `.panel`s timeline.js
  still emits.


## 2026-08-27 · FROM structure + frontend · main @ 197bcc2
DONE: reliability foundation + v4.2 Phase A start (uncommitted):
  `schema/workspace-scan.schema.json` now declares the existing optional
  `browser` snapshot shape and accepts legacy nullable `todo_fixme`, so
  `latest.json` and all 58 historical reports validate. `run-scan.ps1` now
  passes `-NoEnrich`, matching its unattended/deterministic safety contract;
  the local `VEEMO Nightly Workspace Scan` task is registered (daily midnight
  + logon, Ready, next 2026-08-28 00:00). v4 now links/registers HOME as the
  default surface, uses familiar rail labels (HOME / AGENT / PROJECTS / SYSTEM
  / NOTES / AUTOMATIONS / HISTORY), and makes snapshot age explicit in the
  top strip (`scanned 17d ago` is stale after 7 days). New pure
  `scrubber-core.mjs` + test covers the freshness language.
VERIFY: 13 v4 test files, 117/117 pass; collector regression 22/22 pass;
  touched JS syntax clean; schema history 58/58 valid; scheduler shim parses.
IN-FLIGHT: no commit made. `data/quest-overrides.json` remains a pre-existing,
  user-owned modification and was not changed by this work.
ASKS: Phase B can now split TASKS out of AGENT; HOME's existing hunts mapping
  intentionally remains `work` until that real surface is registered.
BREAKS: schema validation now accepts browser snapshots; scheduled scans no
  longer invoke optional Claude enrichment; v4 starts on HOME rather than WORK.

## 2026-08-19 · FROM frontend (v4.2 — HOME EXEMPLAR) · main @ 525de26
DONE: 525de26 **HOME, the v4.2 exemplar + STYLE REFERENCE.** New files only:
  `dashboard-v4/src/surfaces/home/{view.js,oracle-logic.mjs,oracle-logic.test.mjs}`
  + `dashboard-v4/styles/home.css` (self-injected, index.html unowned).
  v3 roundtable's content reborn under docs/superpowers/specs/2026-08-19-v4-
  design-constitution.md: Oracle hero (derive.oracle → the ONE focal element),
  today-pick-one from account.daily_top3, the 14-pt momentum strip.
  oracle-logic is ADAPTED, not copied: derive.oracle emits v3 realm ids
  (forge/hunts), v4 registers go:work|projects|…, so the map translates and an
  unknown realm falls back to a REAL surface. Button copy names the room it
  opens ("Open Projects") — v3's "Review & commit" promised work a go:* action
  does not do.
VERIFY: 12 v4 test files BY FILE, 115/115, fail 0 (new oracle-logic 7). Offscreen
  harness (scratch userData, deleted) mounting `view` into the real index DOM on
  live data: 0 console errors with AND without a bridge; hero text == the live
  `oracle()` label ("Rotate 4 exposed secrets — Crucix"); HEALTH↔XP toggle
  repaints (21 / #74a8dc → 2,081 / #e8a13c); data:select repaint idempotent;
  0 listeners after unmount. Self-check measured on the DOM: violet accents = 2
  (.oracle, .oracle-go), outlined passive containers = 0, ALL-CAPS sentences = 0,
  section gaps 48/48px, ≤3 cards/row, column = 880px.
  Shots: dashboard-v4/tools/shots/exemplar-home-{wide,default}.png (gitignored).
IN-FLIGHT: none.
ASKS: none — but HOME IS NOT REGISTERED. boot.js/shell.js deliberately untouched;
  whoever wires it adds `{ id:'home', label:'HOME', glyph:'◎', view: homeView }`
  as the FIRST rail entry + flips `startId` default, and may then drop the
  self-inject in favour of a static `<link>` (the injector no-ops either way).
BREAKS: none. No existing file was modified. `styles/home.css` introduces a sans
  UI stack scoped to `.home`; when it is promoted to tokens.css as `--ui`, that
  one block collapses to a var reference.

## 2026-08-19 · FROM frontend (v4.1 Phase 4 — D2 FIX WAVE) · main @ 00912cb
DONE: both Important review findings, contract-first. 061e5b4 (meta)
  IPC-CONTRACT rows BEFORE the handlers. cbeaf77 stream-parse: textFromEvent
  dropped EVERY `result` event; the "it duplicates the assistant text"
  justification only holds for subtype:'success', so error_max_turns /
  error_during_execution / refusals were silently discarded — a red
  "Failed · exit N" chip and an empty pane. Failed results now emit
  `[error: <subtype>]` + the result string when present (never gated on it);
  benign unknown subtypes stay unannounced (`/^error/`, not `!== 'success'`).
  718b6bc the registry `tail` the panes DISPLAY: Phase 3 called a stream-json
  tail "cosmetic" — it is not (v4 agent-pane.js:234, v4 sessions.js:60, v3
  summoning:43 render it verbatim, and capture-save/scan reload the window,
  wiping the live buffer mid-linger). NEW dashboard/session-tails.js records
  the parsed text session-api already pushes; main.js swaps it into `tail` on
  BOTH channels. Zero renderer changes — v3 benefits too.
VERIFY: 13 test files by file, 141/141, fail 0 (new session-tails 13, stream-
  parse 20). V4 SELFTEST surfaces=6 errors=0 PASS; v3 combos=105 errors=0 PASS.
  Real-registry harness (REAL claude-sessions.js + a REAL child process, only
  the exe overridden via its documented `command` test hook): registry tail
  stays raw JSON, `withTails(list())` returns "Checking the collector
  fixtures. / [tool: Grep parseChunk] / Ran out of turns. / [error:
  error_max_turns]" — main.js's exact expression, 9/9 asserts.
IN-FLIGHT: none.
ASKS: none.
BREAKS: **main.js edited** (3 lines at the session-presence block, one hunk):
  `hq:sessions-list` + the `hq:claude-sessions` push now return
  `sessionTails.withTails(...)`. `dashboard/claude-sessions.js` untouched
  (READ-ONLY constraint honored — `git status` clean on it). `tail` keeps its
  string shape; an older main returns the raw tail exactly as before. main.js
  is `node --check`-verified only: booting it would raise a second app beside
  the user's live one (global hotkeys, tray), so the D1 wiring-inspection
  precedent applies.

## 2026-08-19 · FROM frontend (v4.1 Phase 4 — VERIFY) · main @ faeee2f
DONE: **v4.1 LANDED AND VERIFIED — all six surfaces real, game layer restored,
  stream-json live tokens, vitals lit.** Unit tests BY FILE: 12 files (11 v4 +
  dashboard/stream-parse) 121/121. V4 SELFTEST surfaces=6 errors=0 PASS; v3
  SELFTEST combos=105 errors=0 PASS. Offscreen harness (scratch profile,
  deleted) over ALL SIX on live data — 0 console errors per surface, content
  vs data-file ground truth: WORK queue 63 (readout+DOM == buildQueue on
  latest.json), PROJECTS 8 cards == projects.length, SYSTEM 8 organ cards ==
  pc-health.json, MIND 2 vault cards == inventory.vaults, AUTOMATE search
  "test" → "91 matches · showing 24" (== filterSpells on spellbook.json 977),
  LOOKBACK 22 trophy cards · "7 of 22 unlocked" == achievements. Shots:
  dashboard-v4/tools/shots/v41-*.png (7, gitignored). Real-preload harness
  (dashboard/preload.js + session-api.init on real ipcMain, throwing FAKE
  claudeSessions — wiring inspection only, D1 proved the live loop): warden
  LV 7 Overseer · XP 2,081 · 319 to L8 · HEALTH 21 crit · STREAK 3 (==
  latest.json account); palette Ctrl+K opens/focuses/filters/Esc-closes;
  scrubber prev (57/58 PAST) and LATEST each FULL-re-mount the stage; dispatch
  controls enabled (9 target options = 8 pathed projects + placeholder).
IN-FLIGHT: none.  ASKS: none.
BREAKS: none — verify only, zero code files touched.

## 2026-08-19 · FROM frontend (v4.1 Phase 3 — stream + vitals) · main @ f932150
DONE: live token streaming + machine vitals to the main window. 46fd3b1 (meta)
  IPC-CONTRACT: hq:session-output note BEFORE code — same channel, same
  {jobId, chunk} shape; chunk is now PARSED text. 4ec4987 NEW pure CommonJS
  dashboard/stream-parse.js (parseChunk(buffered, chunk) -> {text, rest}):
  assistant text passes through, tool_use becomes one-line [tool: Name hint],
  malformed COMPLETE lines pass through raw (never throw/never drop), PARTIAL
  lines wait in rest; system/user/result protocol events filtered by design
  (result would double-print the answer). session-api.js passes fixed args
  ['-p','--output-format','stream-json','--verbose'] to claudeSessions.start
  and parses every onOutput chunk before pushing; onDone flushes a trailing
  unterminated line. claude-sessions.js UNTOUCHED. f932150 main.js
  pushMachine(): samples once, sends to miniWin (visible-gated, as before)
  AND to the main window — the v4 truth rail's Machine tile goes live.
VERIFY: node --test dashboard/stream-parse.test.mjs 13/13. node --check on all
  3 touched JS. V4 SELFTEST surfaces=6 errors=0 PASS; v3 SELFTEST combos=105
  errors=0 PASS. Fake-seam smoke (scratchpad, deleted): real hq:session-start
  handler + scripted fake claudeSessions — argv asserted, split-mid-line push
  clean, raw stderr passes through, zero JSON leaked to the push.
IN-FLIGHT: none.
ASKS (v4 lane): dashboard-v4/src/surfaces/work/truth-rail.js MACHINE_NOTE
  (~line 20) says main pushes hq:machine to the mini HUD only — stale copy
  now; the tile itself already renders arriving payloads, so this is cosmetic.
BREAKS: none — additive only. Presence consumers of claude-sessions `tail`
  (hq:sessions-list / hq:claude-sessions) now see raw stream-json in the tail
  (cosmetic; registry deliberately untouched — the renderer view goes through
  hq:session-output, which is filtered). Other start()/run() callers pass no
  args and keep the default ['-p']: main.js:642 conjure (start, no args),
  main.js:760 draft-commit (run, no args) — verified unaffected.

## 2026-08-19 · FROM frontend (v4.1 S6 — SOUL: wiring + game layer) · main @ a4d122f
DONE: the five surfaces are WIRED and the soul is back. 08d9f11 boot.js swaps
  projects/system/mind/automate/lookback off placeholderView onto the real
  views. 248004a WARDEN PLATE in the top strip (LV/rank, XP + to-next bar,
  HEALTH with v3's <40 crit / 40-69 strained bands and the fell-since-last-paint
  flash, STREAK) ported field-for-field from v3 chrome.js paintWarden(), plus
  new core/scrubber.js — prev/next/LATEST driving data.select(i), snapshot id,
  n/58 position, LATEST-vs-PAST badge, vs-previous health/xp deltas, and
  off-latest as a MODE (#topstrip[data-past=yes] amber underline). 2025e52 +
  a4d122f the COMMAND PALETTE (Ctrl+K, "/" too): v3's mechanics verbatim over a
  v4 index — GO (go:* from actions.mjs) · DO · QUEUE (buildQueue items) · SPELL
  (977, quota-capped at 5/8 rows so they cannot bury the queue).
  BOUNDARY b1d4d9c HONOURED: the shell answers data:select with a FULL
  unmount+mount of the active surface, never a partial refresh.
VERIFY: node --check on all 6 touched JS. V4 SELFTEST surfaces=6 errors=0 PASS;
  v3 SELFTEST combos=105 errors=0 PASS. Unit tests BY FILE 11 files 108/108.
  Offscreen harness (scratch profile, deleted) over the real index.html on live
  data, BOTH preloads: 32/32 checks, 0 console errors. Warden reads LV 7
  Overseer · XP 2,081 (319 to L8, bar 46.8%) · HEALTH 21 crit · STREAK 3.
  Scrub prev and LATEST each yield a FRESH connected stage node with the old one
  detached (also on LOOKBACK), and the WORK truth rail's Snapshot tile follows
  the scrub — the exact skew b1d4d9c warned about is gone. Palette opens,
  focuses, filters, seeds the WORK form, closes on Esc; scan:now shows only
  under the real preload; capture:idea never listed (dead seam).
IN-FLIGHT: none.
ASKS: none.
BREAKS: **two edits outside S6's stated ownership, both disclosed.**
  (1) `dashboard-v4/index.html` — links the five new sheets and adds
  `<div id="overlays">`; S1 and S2 both filed this as an S6 ASK and no Phase-1
  agent owned the file. system.css/lookback.css self-injectors now no-op.
  S1's "promote .drawer*/.truth-kv/.meter into components.css" ask is DECLINED:
  work.css is document-wide, the classes already resolve, a move is pure churn.
  (2) `dashboard-v4/src/surfaces/work/view.js` — +11 lines, a `work:seed` bus
  subscriber so the palette can seed the dispatch form; it runs the identical
  agent.seed + markSeeded path as the rail's own dispatch verb. No IPC, no
  main-process edits, no contract change; data/quest-overrides.json untouched.
  Phase 3 (main-lane) is unaffected.

## 2026-08-19 · FROM frontend (v4.1 S2 — SYSTEM surface) · main @ 477c277
DONE: SYSTEM surface from v3 medbay+watchtower+social, rebuilt on v4 components
  (477c277), three tabs. MACHINE: 8 pc-health vitals (status word, focal
  numeral, sparkline, diagnosis, teaching), 11 fix cards — COPY always, RUN only
  for danger:'safe'; caution/admin render RUN disabled-with-reason, mirroring
  main's hq:health-fix whitelist — and the Epic-C cleanup panel (capture:note).
  The cleanup ITEM COUNT and the RECLAIMABLE BYTES stay on two separate lines:
  disjoint sources, disjoint work, never recombined. SCREEN TIME: distraction
  dial, weekly rhythm, summary, top-8 platform cards with expandable per-day
  history; honours the time machine. SOCIAL: presence, metrics tiles,
  feed/mentions/outbox via hq.getSocial (read-only by design, 60s poll).
  Derivations in pure screen-core.mjs, 13/13 node --test.
VERIFY: node --check 8/8. Offscreen harness (scratch profile, deleted) over the
  real index.html on live data, BOTH preloads: console errors 0; organs=8
  fixes=11 (dg 9 safe / 1 caution / 1 admin) cleanup=14 captured=17; with the
  real preload exactly 9 RUN enabled and every IPC rejection lands an honest
  retry label; 0 disabled controls without a title; SOCIAL poll timer 1 -> 0
  across unmount; data:select scrub repaints (8 cards -> empty -> 8); the
  no-pcHealth path renders EKG + 8 ghost vitals. V4 SELFTEST surfaces=6 errors=0
  PASS — SYSTEM is not in it yet (unregistered until S6).
IN-FLIGHT: none.
ASKS (S6): register `system` in boot.js. styles/system.css SELF-LINKS from the
  view (idempotent; no-ops the moment index.html links it), so this surface
  needs no index.html edit — BUT index.html links none of the five new sheets
  and only lookback + system self-inject: **projects.css, mind.css and
  automate.css are loaded by nothing today** and those surfaces will mount
  unstyled until S6 adds the <link> tags.
BREAKS: none. Additive files only; no IPC, no main-process edits; boot.js and
  shell.js untouched; data/quest-overrides.json untouched.

## 2026-08-19 · FROM frontend (v4.1 S1 — PROJECTS surface) · main @ 7d93272
DONE: PROJECTS surface built from v3 forge/view.js on v4 components (7d93272):
  grid (search/filter/sort toolbar, health-chip cards, clamped meters, dev
  toggles), drawer (re-entry briefing, Reveal folder via openRepo, dev toggle
  via devStart/devStop+onDevStatus; v3's inline peek facts consolidated here),
  Working-on-now (scan rollups + live tab via state/live.js), Epic-D suggested-
  actions strip (agency proposals -> claude:dispatch / capture:note, honest-
  async). Pure helpers in core.mjs, 10/10 node --test.
VERIFY: node --check 8/8; offscreen harness (scratch profile, deleted) over the
  real index.html on live data: 12/12 asserts, console errors 0, cards==8
  projects, strip rows==min(proposals,8)==8, all disabled controls titled,
  Esc closes drawer, 3x mount/unmount clean. Selftest NOT run for this surface
  (unregistered until S6; boot.js untouched by construction).
IN-FLIGHT: none.
ASKS (S6): register `projects` view in boot.js AND add
  `<link rel="stylesheet" href="./styles/projects.css" />` to dashboard-v4/
  index.html (after work.css). Drawer reuses .drawer*/.truth-kv/.meter from
  work.css — promotion into components.css is S6's call.
BREAKS: none. Additive files only; no IPC, no main-process edits;
  data/quest-overrides.json untouched.

## 2026-08-13 · FROM frontend (v4 SPINE D2 FIX WAVE — CHANGES attribution) · main @ aefd10a
DONE: fixed the one D2 finding (important): the AGENT pane's CHANGES panel
  billed the WHOLE working tree to the session that had just settled — probe()
  ran `git status --porcelain` only AFTER the session ended, so a session that
  changed nothing rendered "<n> files touched in <cwd>" over the user's own
  pre-existing dirt. a400f30 (meta, doc-before-handlers) + aefd10a (fe).
  hq:session-start now snapshots the contained cwd's dirty set BEFORE spawning,
  keyed by jobId (FIFO cap 100, in-memory, never persisted); hq:session-diff
  takes an optional jobId and returns `baseline` =
  {state:'captured',paths}|{state:'unavailable',error}|{state:'none'}. New pure
  dashboard-v4/src/surfaces/work/changes-core.mjs splits into "changed since
  dispatch" / "already dirty at dispatch"; with no baseline it REFUSES to split
  and states the working-tree scope. `git diff --stat` is now labelled whole-tree.
VERIFY: unit tests BY FILE 8 files 71/71 pass (new changes-core.test.mjs 16/16).
  V4 SELFTEST surfaces=6 errors=0 PASS; v3 SELFTEST combos=105 errors=0 PASS.
  node --check on session-api/preload/main + the three ESM files. Fake-seam
  smoke over a REAL git repo (Documents/hq-v4-baseline-scratch, deleted):
  "BASELINE SMOKE checks=14 errors=0 PASS" — a no-op session yields "Nothing
  changed … since this session was dispatched. 2 files were already dirty at
  dispatch." Offscreen Chromium DOM harness confirms both rendered branches.
ASKS: none.
BREAKS: **struct/other consumers — additive IPC only.** dashboard/main.js,
  preload.js and claude-sessions.js are UNCHANGED (sessionDiff already passes
  opts through verbatim). A caller that omits jobId gets `baseline:{state:'none'}`
  and the old {files,stat} fields untouched. data/quest-overrides.json untouched.

## 2026-08-13 · FROM frontend (v4 SPINE Phase D1 VERIFY — the loop closes) · main @ c8fda29
DONE: v4.0 spine VERIFIED end-to-end; no feature code, docs+.gitignore only.
  IPC added by the spine (rows already in IPC-CONTRACT.md): hq:session-start /
  hq:session-kill / hq:session-diff invokes + hq:session-output push. v3
  untouched as rollback (.ui-version still "v3"). Baselines: v4 selftest
  surfaces=6, v3 selftest combos=105.
VERIFY: unit tests BY FILE 7 files 55/55 pass. V4 SELFTEST surfaces=6 errors=0
  PASS; v3 SELFTEST combos=105 errors=0 PASS. Ground truth buildQueue(data/
  latest.json) = {threat:23,task:3,gap:18,idea:19} total 63; real-preload
  offscreen harness (temp dir, real preload.js + session-api.init + claude-
  sessions, deleted): queue DOM 23/3/18/19=63 exact match, Dispatch 63/63
  ENABLED, form select(9 opts)/task/Dispatch all enabled, console errors=0.
  REAL E2E: scratch git repo Documents/hq-v4-e2e-scratch (deleted after) →
  sessionStart via the real bridge → jobId cs-msrhcm5q-1, hq:session-output
  streamed "READY\n", settled status=done exit=0 in the onClaudeSessions push,
  session card rendered, sessionDiff → {files:[],stat:""} clean. Shots:
  dashboard-v4/tools/shots/d1-work-{queue,session}.png (now gitignored — v3
  shots precedent; announced here).
ASKS: none. NOTE: claude CLI refuses to spawn when the app itself is launched
  from inside a Claude Code session (CLAUDECODE env guard, "nested sessions");
  normal desktop launches are unaffected — verified done+READY with it unset.
BREAKS: none. data/quest-overrides.json untouched (pre-existing modification
  still in the tree).
DONE: Phase C landed across c7e442b (System-HUD component language + workbench
  CSS + motion), b9c026e (QUEUE rail: one item component, four real verbs,
  drawer-lite), 4ec88ec (AGENT pane stream/kill/changes + TRUTH rail + mount),
  99841d8 (honest empty output state, severity-true total). A prior agent
  committed those then died pre-verification; this block AUDITED them against
  the plan and ran the verification. No behavioural defect found — the only new
  commit is b1d4d9c, a COMMENT recording that the data:select handler rebuilds
  the queue only (unreachable in v4.0: nothing calls data.select(), v4 has no
  scrubber; the v4.1 scrubber must make it a full re-mount).
VERIFY: node --check 29/29. v4 unit tests BY FILE 55/55 pass. V4 SELFTEST
  surfaces=6 errors=0 PASS (re-run after the edit). v3 regression SELFTEST
  combos=105 errors=0 PASS. Two throwaway offscreen harnesses (deleted):
  console errors=0; queue DOM 23/3/18/19 total 63 matches Node-computed
  buildQueue(latest.json) exactly; verbs Dispatch 63/63 disabled, Done 3/3,
  Note 18/18, Open 26 enabled — every disabled control carries its reason;
  form select/textarea/Dispatch all disabled with the no-bridge title; Kill
  "Select a session first."; output element is <pre> with innerHTML length 0;
  vendored anime.es.js dynamic import resolves (default is a function, so
  motion is real, not silently degraded); drawer opens inside .work-root,
  Esc closes, surface unmount removes it (0 leaked scrims); emulated
  prefers-reduced-motion flips matchMedia and collapses transitions to 0s.
ASKS (main lane, non-blocking): the TRUTH rail cannot show real machine vitals.
  main.js pushMachine() sends hq:machine to miniWin only, and preload exposes
  no pull method — so the tile states that fact instead of a permanent
  "waiting…". An additive hq:machine-sample invoke (or pushMachine also
  targeting the main window) would light it up; the tile already renders a real
  payload if one ever arrives, so it degrades correctly either way.
BREAKS: none — additive, dashboard-v4/ only. .ui-version still "v3".
  data/quest-overrides.json untouched (still modified pre-existing in the tree).

---

## 2026-08-12 · FROM frontend (v4 SPINE Phase B3 session IPC) · main @ 1a68f78
DONE: session IPC per plan B3. dfd9736 (meta:) announced the four rows in
  IPC-CONTRACT.md BEFORE code: hq:session-start/-kill/-diff invokes +
  hq:session-output push. Code: NEW dashboard/session-api.js (renderer sends
  only {cwd,task,label} — no command/args passthrough; cwd containment under
  Documents root mirroring resolveProjectPath; task capped 2000; 15-min
  main-side timeout; git probe spawnSync shell:false; handlers settle, never
  throw), preload.js one additive block (sessionStart/sessionKill/sessionDiff/
  onSessionOutput), main.js ONE hook line after the claude-sessions wiring.
VERIFY: node --check x3; fake-seam smoke (containment rejection both handlers,
  2000-char truncation, output-push shape, kill bool-never-throws, real repo
  diff probe); v3 SELFTEST combos=105 errors=0 PASS; V4 SELFTEST surfaces=6
  errors=0 PASS.
NOTE — commit race (final state): B3's three files were explicitly staged when
  B1's plain `git commit` swept them into 845296b; B1 then rewrote that to
  c78520a (queue files only), un-committing B3's files, after which B2's plain
  commit swept them again — they now live inside 1a68f78 ("fe: v4 state …
  (B2)"). Content verified byte-identical to intent (git hash-object matches
  all three blobs at HEAD). No further rewrites (shared tree, parallel
  sessions live). Fleet agents: stage AND commit by pathspec to avoid this.
ASKS: none. BREAKS: none — additive; channels documented in IPC-CONTRACT.md.

---

## 2026-08-12 · FROM frontend (v4 SPINE Phase A scaffold) · main @ 22ba562
DONE: dashboard-v4/ exists (v4.0 SPINE plan, Phase A). 1721240 substrate copied
  byte-identical from v3 (intel derive/foresight/agency + actions/notify/bus/
  data/util + tests + fixture + vendor/anime.es.js, NO three.js; 29/29 by-file).
  c959b33 scaffold: 6-surface shell (WORK·PROJECTS·SYSTEM·MIND·AUTOMATE·
  LOOKBACK; only WORK real-module, rest honest "Built in v4.1" one-liners,
  zero controls), dev-main.js mirroring v3 (--smoke/--selftest, scratch
  userData, HQ_V4_PRELOAD=v2 → real dashboard/preload.js), System-HUD tokens
  (warroom --wr-* promoted to --hud-*). 22ba562 main.js: v4 branch in the
  .ui-version ternary — the ONLY main.js edit.
VERIFY: node --check 15/15; V4 SELFTEST surfaces=6 errors=0 PASS; real-preload
  smoke boots; v3 regression SELFTEST combos=105 errors=0 PASS after the edit.
IN-FLIGHT: nothing uncommitted from me. data/quest-overrides.json still sits
  modified in the shared tree (pre-existing runtime state) — untouched.
ASKS: none this block (Phase B3 will announce session IPC in IPC-CONTRACT.md
  BEFORE handlers, per plan).
BREAKS: none — additive. .ui-version stays "v3"; flipping to "v4" is opt-in.

---

## 2026-08-02 · FROM frontend (Epic C fix wave) · main @ bd811a7
DONE: consolidated fix wave on Epic C "Foresight" — 3 merge blockers + units.
  · Med-Bay cleanup heading was a FALSE composite. "13 items · ~1.8 GB
    reclaimable" joined disjoint sources: the 13 rows are inventory clones/
    duplicates/empty (NO size field exists on any of them), the 1.8 GB is
    Σ projects[].disk.reclaimable_bytes from 4 products that are not in the
    list, freed by hq.reclaim() elsewhere. Working all 13 rows reclaims ~0
    bytes. Now: heading `Cleanup — 13 items`, plus a separate muted line
    `Separately: ~1.8 GB of build artifacts reclaimable across 4 products —
    freed per project, not from this list.` (omitted when bytes are 0).
    derive.anomalies() untouched; the product count is computed view-side.
  · "Noted" could render on a REFUSED write — the await discarded the resolved
    value, and main's hq:capture-save returns `false` (not a rejection) on
    empty text. Now `ok === false` throws into the existing catch.
  · Capture click traced LIVE against the real preload: main's handler ends
    spawnSync(assemble.mjs) → rebuildData() → **win.reload()**, and `win` is
    the v3 window. Measured with a throwaway harness: the renderer paints ZERO
    frames for the whole main-process block (app visually frozen ~1.6s in the
    emulation, longer with the real assemble), and the reload commits before
    the invoke promise ever resolves — "Noted" is never reached, not merely
    unpainted. UI now promises only `Saving…` (set before the await); a code
    comment records the finding so nobody "fixes" the missing confirmation.
    Failures are now visible (`✗ Not saved — retry` + title), not console-only.
  · Units: derive.momentum()'s slope is per trend SAMPLE (= per scan), so
    `etaDays` was never days — 44 samples over 58 days ≈ 0.76 scans/day, so
    "~13 days" understated the wait ~25%. foresight.mjs now exports
    `slopePerScan` and labels the ETA `~13 scans to L8`, matching the
    "+31.2 XP/scan" figure one line above it that it used to contradict.
    derive.mjs NOT touched (struct lane / contract).
  · nudge.js: `ACH[id]` walked the prototype chain (an id of `constructor`
    rendered "Object") → `Object.hasOwn`. atlas: `falling` no longer borrows
    the flat copy, it says `XP is trending down — no level ETA.`
VERIFY: node --check on all 5 changed files; foresight+derive+actions suites
  23/23 green (was 20 — added clamp-overshoot, empty-kind, unknown-kind and
  KB/MB humanBytes coverage); selftest combos=105 errors=0 PASS; live harness
  runs (real preload / refusal / reload / no-preload) all as described.
IN-FLIGHT: nothing uncommitted from me. data/quest-overrides.json still sits
  modified in the shared tree (pre-existing runtime state) — untouched. NOT pushed.
ASKS (struct/main lane, NOT actioned here): hq:capture-save's synchronous
  spawnSync + unconditional win.reload() makes every quick capture a
  full-dashboard reload with a frozen window. A targeted refresh (or an async
  spawn) would let the renderer show a real confirmation. fe-lane cannot fix
  this without touching dashboard/main.js.
BREAKS: none — additive, all under dashboard-v3/, no IPC/contract change.
  Only renamed field is foresight.mjs's `slopePerDay` → `slopePerScan`; its
  sole consumer (atlas/view.js) moved with it. Copy change: the cleanup empty
  state now reads "No clones, duplicates or empty folders to clear." (was
  "Nothing to clean up.") so it cannot contradict the reclaimable line above it.
  Full report: .superpowers/sdd/2026-08-02-nexus-alive-epic-c-foresight/
  fixwave-report.md.

---

## 2026-08-02 · FROM frontend (nexus-alive Epic C session) · main @ 9454ca7
DONE: NEXUS ALIVE Epic C — Foresight, all 4 tasks (plan: 7fce380; code:
  bc0c654/a98acef intel/foresight.mjs pure adapters, 4488184 atlas momentum
  forecast card #3, f47c15c+a0ee331 medbay anomaly-cleanup panel + working
  capture:note action #4 — corrects the charter's verified-no-op
  capture:idea suggestion, 9454ca7 THIS: ui/nudge.js achievement-nudge strip
  #19 mounted in atlas off top-level S.achievements (NOT S.account.achievements
  — that path is undefined; data.js:64 normalizes the array at top level) +
  carried-over honesty fix: forecast card now shows "based on N scans" so the
  least-squares slope/ETA doesn't outread its sample size. Verified end to
  end: intel+actions suites 20/20 green, selftest combos=105 errors=0 PASS
  (realm count unchanged — additive within existing realms, no new realm),
  offscreen render harness confirmed live-data shape: 3 nudge rows with
  friendly ACH names (Under Control/Well Documented/No Loose Keys, not raw
  ids), forecast card includes the basis line, medbay cleanup header
  unaffected (13 rows), 0 console errors throughout.
  [CORRECTED 2026-08-02 by the Epic C fix wave below: the header read
  "Cleanup — 13 items · ~1.8 GB reclaimable", which was FALSE — the 13 rows
  and the 1.8 GB come from disjoint sources and clearing all 13 frees ~0
  bytes. Now two separate lines; see the fix-wave entry at the top.]
IN-FLIGHT: nothing uncommitted from me. data/quest-overrides.json sits
  modified in the shared tree (pre-existing runtime state per the prior
  entry) — untouched, unstaged. NOT pushed.
ASKS: none. BREAKS: none — purely additive, all under dashboard-v3/, no
  contract/IPC/main-process change. intel/derive.mjs and intel/foresight.mjs
  stay frozen/pure (labelFor injected into nudgeRows rather than importing
  ui/components.js into intel/, same purity pattern as the rest of Epic C).
  Full task-4 report: .superpowers/sdd/2026-08-02-nexus-alive-epic-c-foresight/
  task-4-report.md.

---

## 2026-08-02 · FROM frontend (nexus-alive Epic B session) · main @ a6d8016
DONE: NEXUS ALIVE Epic B — WAR ROOM / SITROOM, realm #15 (a6d8016 + this fix
  wave). Renders derive.triage() as a sectioned threat board: full cards for
  SECURITY/UNCOMMITTED, compact rows for STALE, one roll-up for HYGIENE, hero
  count + shape line, tilted 3D radar in the header. **Selftest gate moved
  98 → 105 combos** (15 realms × 7 themes) — update any script still asserting 98.
  Fix wave applied both reviews: deleted the SVG threat-vector/N-FRONT system
  (fired on ~100% of cards = zero signal), HP bar denominator re-anchored to a
  per-kind ABSOLUTE ceiling so bars are comparable across time-machine snapshots,
  WCAG AA text token split (--wr-text-dim 5.96:1; --wr-dim is chrome-only now),
  generation-token guard on the post-await anime path, radar framing + reduced
  motion + Remediate aria-labels, badge returns null not 0.
IN-FLIGHT: nothing uncommitted from me. NOT pushed.
BREAKS/NOTES: **712KB of vendored third-party code added and TRACKED** —
  dashboard-v3/vendor/three.module.js (670KB, v0.160.0) and anime.es.js (42KB,
  v3.2.2). Local ESM is CSP-required (default-src 'self' blocks CDN); both load
  via lazy dynamic import, so non-WAR-ROOM realms pay nothing at boot. Two new
  localStorage flags: hq-ff-warroom-3d (default ON, 'off' → Canvas2D degrade)
  and hq-ff-dispatch (default OFF). No contract / IPC / main-process change —
  everything is under dashboard-v3/.
ASKS: none. **STILL OPEN:** the "Send Claude" button (behind hq-ff-dispatch) has
  no backend — it needs the Phase-2 `hq:spawn-session` IPC before it can do
  anything. It is not rendered at all while the flag is off; with the flag on it
  console.warns instead of pretending to work.

## 2026-07-31 · FROM frontend (quality-hardening session) · main @ 6240f64
DONE: production-hardening pass (8858b2a, a25b750, 6240f64). ROOT-FIXED the
  components.js stackedBar negative-width bug you and design-system flagged
  (bw floor 1px; legacy clampRects band-aid deleted — attachBarTip never used
  bw, geometry safe). Deleted dead stub.js + v2 _shot.js/_shot_spellbook.js.
  Surfaced 3 swallowed errors (ambient oracle warn-once, boot Notification
  warn, medbay copy-failure feedback). DAY_MS in ui/util.js (chronicle+legacy).
  Verified each step: selftest combos=105 errors=0 PASS ×3; 0 negative-value
  console errors with 51-scan live data; pure-node stackedBar 60-row check.
IN-FLIGHT: nothing uncommitted from me. data/quest-overrides.json was already
  modified before my session (app runtime state?) — untouched. NOT pushed.
ASKS/BREAKS: none. Audit notes for future lanes: v2↔v3 helper dups (esc/fmtCd/
  fmtDur/agoText) are DELIBERATE parity — don't dedupe while v2 is the rollback.
  dashboard/_shot_onething.js is UNTRACKED on disk — commit or delete, your call.

## 2026-07-29 · FROM frontend (nexus-alive Epic A session) · main @ 75843b6
DONE: NEXUS ALIVE Epic A — The Oracle (93c7c6e oracle-logic, 4402233 hero card,
  e308641 ambient mirror, 75843b6 drawer fix). Home realm now leads with the single
  live "do this now" from the tested pure derive.oracle(), routed through the audited
  dispatch() path; one-line echo in the ambient rail ("DO NOW"). Flag hq-ff-oracle
  (default on) — OFF restores the legacy computeOneThing hero byte-for-byte. Night/rest
  empty state. No contract/IPC/main change; all under dashboard-v3/. Verified: 20 unit
  tests green, selftest combos=98 errors=0 PASS, live screenshot (Oracle correctly
  surfaced "Rotate 4 exposed secrets — Crucix" above all commits/quests), adversarial
  code review found 0 real bugs. Plan:
  docs/superpowers/plans/2026-07-29-nexus-alive-epic-a-oracle.md.
IN-FLIGHT: nothing uncommitted from me. NOT pushed.
ASKS/BREAKS: none. **NOTE for whoever builds Epic B (War Room):** the nexus-alive
  program plan's realm-count math is STALE — it says 13 realms → 14 after War Room
  (98 combos). But SOCIAL (realm 14) already landed (6cd4828), so the app is ALREADY
  at 14 realms × 7 = 98 combos NOW. War Room makes it 15 realms → selftest target
  becomes 105, NOT 98. Fix the plan's gate when you spin Epic B.

## 2026-07-29 · FROM frontend (design-system session) · main @ 591418d
DONE: NEXUS Design System Tasks 8+9 COMPLETE (591418d). Per-realm measure caps
  (--measure 880px): roundtable/forge/chronicle cap the reading column; lands/legacy
  cap text/storage columns ONLY (isometric map + trend charts stay full-width via
  :has()/direct-child selectors — no markup change); grimoire full type/spacing token
  pass (fs-*/space-* ramps, 0 sub-12px, tap-floor on buttons, 3-line desc clamp);
  medbay long PowerShell fix-commands soft-wrap (pre-wrap) — kills the ~2000px hscroll.
  Also FIXED the legacy <rect> negative-width bug you flagged: clampRects() clamps
  data-derived rect w/h non-negative at the 2 stackedBar call sites → the ~168 console
  errors/viewport are GONE. Verified: selftest combos=98 errors=0 PASS; committed
  ux-after.json (gapDistinct 16→7, tinyTargets→0 in all realms).
IN-FLIGHT: starting NEXUS ALIVE Epic A (The Oracle) — roundtable hero card + ambient
  mirror consuming derive.oracle(). fe-lane, additive, flag hq-ff-oracle. No contract.
ASKS/BREAKS: none for you (all CSS is nexus-scoped; 1 JS clamp). **ROOT-CAUSE HANDOFF
  (shared lane):** the real fix for the <rect> bug is components.js:153 — bw =
  Math.min(30, slot-7) goes negative at ~39+ days history; ideal is
  bw = Math.max(0, Math.min(30, slot-7)). My clamp only covers legacy; any realm using
  stackedBar with dense data still needs the component-level fix.

## 2026-07-26 · FROM frontend (social-bridge session) · main @ 6cd4828
DONE: SOCIAL realm — in-app face for the SOCIAL BINDING (6cd4828). New realm 14
  renders connected accounts + per-platform metrics tiles + Feed/Mentions/Outbox
  tabs w/ platform filter, read live via a new ctx.hq.getSocial(). Read-only
  (sending stays in the popup gate). Data plumbing mirrors browser-activity:
  readSocial() on the bridge + ONE ipcMain.handle('hq:social-read') next to
  hq:browser-live + one preload line (IPC-CONTRACT.md updated). Registered in the
  3 seams (boot/realms.css/lexicons tab_social x3). Born on --space-*/--fs-*
  tokens. Verified: 14 realms, social mounts 0 overflow/0 tiny/0 console errors;
  driven with injected data → all sections render; scraped text esc()'d (XSS-safe).
IN-FLIGHT: nothing uncommitted from me. NOT pushed.
ASKS/BREAKS: new IPC channel hq:social-read (renderer reads data/social/* via
  main; read-only, additive). Frontend-lane only. **FYI bug I found (NOT mine,
  NOT fixed):** the `legacy` realm throws ~168 console errors/viewport —
  `<rect> attribute width: negative value ("-0.3")` (an SVG chart bar computing a
  negative width). Pre-existing, in your design-system realm surface — worth a
  Math.max(0, w) clamp in legacy/view.js's chart code.

## 2026-07-26 · FROM frontend (social-bridge session) · main @ 15a4d85
DONE: SOCIAL BINDING phase 3b — Instagram/Threads/Facebook/YouTube adapters
  (15a4d85). Platform set complete: 9 adapters. IG read+metrics (private web API,
  read-only — no text posts); Threads metrics + gated GraphQL post; FB account +
  gated post; YouTube InnerTube (SAPISIDHASH) notifications, posting refused.
  Fragile write mutations gated behind THREADS_CREATE_DOC_ID/FB_CREATE_DOC_ID
  constants (empty → clear error, no silent fail). manifest gains the 5 Meta/YT
  hosts. Verified: all 4 stage through the real MCP seam; syntax/manifest clean.
IN-FLIGHT: nothing uncommitted. Meta/YT reads+writes need live doc_id/params
  capture (flagged inline) — reliable wins are IG read+metrics + YT notifs.
ASKS/BREAKS: browser-bridge/social.js + manifest.json only; no contract change
  (all 9 platforms already in SOCIAL_PLATFORMS). Still frontend-lane only;
  grimoire.css untouched (your Task 8 token migration of my .toolbar2 stands).

## 2026-07-26 · FROM frontend (social-bridge session) · main @ 0621e78
DONE: SOCIAL BINDING phase 3 — X/Twitter + LinkedIn adapters + Reddit top-level
  posts (ae90ae8 contract, 0621e78 code). Additive target/title fields on the
  outbox action (Reddit subreddit + title) → Reddit /api/submit. X adapter:
  public web bearer + ct0 cookie (auth clean), GraphQL HomeTimeline/CreateTweet
  with X_QID/X_FEATURES constants to refresh live (query IDs rotate). LinkedIn:
  Voyager + JSESSIONID csrf, /me + notifications + normShares. manifest adds
  x.com/twitter.com/*.linkedin.com. Verified: reddit-submit + x + linkedin stage
  through the real MCP seam; syntax/manifest clean.
IN-FLIGHT: nothing uncommitted from me. Live scrape/post needs logged-in-tab
  checks (esp. the X GraphQL IDs). Meta (IG/Threads/FB) + YouTube = phase 3b.
ASKS/BREAKS: outbox action shape gained additive optional target/title (CONTRACT
  updated) — no break, other platforms ignore them. Still frontend-lane only.
  FYI re your Task 8: my grimoire .toolbar2 controls are still raw-px, ready for
  your token migration; I have NOT touched grimoire.css since.
DONE: NEXUS Design System Tasks 1-6 landed (plan: docs/superpowers/plans/2026-07-26-nexus-design-system.md;
  driven by the measured UX teardown). tokens.css ramps (--space-*/--fs-*/--measure/--tap-min/--ambient-w,
  linked index.html:10); committed measurement harness tools/ux-measure.js + tools/ux-baseline.json (the
  before/after oracle); responsive ambient rail (clamp, 20.6%→18% @1280); global 32px tap-floor (tiny-targets
  0/13, min-width scoped to .tm-nav so collapsed rail is safe); stray ⟩-glyph fix (ambient.js, was U+27E9
  font-fallback); base/components/chrome fully migrated to spacing+type tokens (0 raw px font-size); 12 realm
  sheets migrated + flat-realm hierarchy (headingStep ≥1.25× on summoning/observatory/watchtower/atlas/conjure,
  cascade-fixed via :root[data-theme=nexus] .realm-X h2.sec); restored .sotd-k nowrap (0162977). selftest
  91/91 throughout; combined HEAD healthy. Metrics so far: gapDistinct 16→10, fontSizeDistinct 32→25.
IN-FLIGHT/OPEN: Task 6 finding #2 (Medium) UNVERIFIED — sub-12px pixel-font captions promoted to 12px in
  theme-UNSCOPED forge/watchtower base rules (esp. watchtower dial SVG <text> y=108) need a multi-theme
  (arcade/nightfall/daylight) screenshot check + revert any that crowd/overlap. Fix-agents died 3× on API
  errors, so this is unfinished. Ledger: .superpowers/sdd/2026-07-26-nexus-design-system/progress.md.
ASKS: Tasks 7-9 remain. Task 7 = lands 6.5px tower labels → ≥12px + de-overlap. Task 8 = grimoire.css FULL
  token migration (deferred here to avoid your contested edits) incl. snapping your .toolbar2 filter controls
  + medbay 2059px code hscroll + per-realm measure caps. Task 9 = final ux-measure before/after; the ≤7-gap/
  ≤8-font global gate needs cinematic.css h2.sec (15px) + ui/components.js SVG chart text addressed (out of
  the original 3-sheet scope — decide: migrate or document as exceptions).
BREAKS: none functional — additive CSS tokens + 1-line ambient.js glyph fix, all selftest-green. Pre-push:
  NEXUS ALIVE Phase 0 PII-in-history squash still pending (fixture commit 17c557d, unpushed).

## 2026-07-26 · FROM frontend (social-bridge session) · main @ 25dbea7
DONE: SOCIAL BINDING phase 2 — Mastodon + Reddit adapters (25dbea7). Both are
  in-tab adapters behind the phase-1 seam (browser-bridge/social.js only, plus
  manifest host perms + a popup "Connect Mastodon" field). Mastodon: token from
  page initial-state, timeline/notifications/verify_credentials + statuses
  post/reply, federated instance is user-config (optional host permission).
  Reddit: session-cookie JSON (/.json, inbox.json, me.json for karma+modhash) +
  reply/comment via /api/comment; top-level submit deferred (needs subreddit+
  title the generic action can't carry). Verified: reddit-reply + mastodon-post
  stage through the real MCP seam; syntax/manifest clean.
IN-FLIGHT: nothing uncommitted from me. Live scrape/post for all 3 platforms
  needs a one-time check in a logged-in browser (only the user can drive it).
ASKS/BREAKS: manifest now also requests `https://*.reddit.com/*` +
  `optional_host_permissions: https://*/*` (for the user's chosen Mastodon
  instance). No contract shape change — mastodon/reddit already valid platforms.
  Still frontend-lane only; untouched your design-system realm-sheet work.
DONE: SOCIAL BINDING phase 1 — MCP-level social media access via the browser-
  session bridge (33d7359 contract-first, d83b25c code). New hq_social_* MCP
  tools (feed/mentions/metrics/status read; post/reply STAGE-only; outbox/
  cancel), a new dashboard/social-bridge.js relay (social ingest tendril +
  /social/outbox routes, 3-line hook into browser-bridge.js, ZERO main.js
  change), and the browser-bridge extension gains social.js (per-platform
  adapters run in-tab via chrome.scripting; Bluesky adapter live). Verified
  14/14 end-to-end (real MCP stdio + bridge HTTP: stage→outbox→result→read,
  403 gate on missing header). data/social/* gitignored.
IN-FLIGHT: nothing uncommitted from me. Live Bluesky scrape needs a one-time
  check in a logged-in browser (only the user can drive that session).
ASKS/BREAKS: NEW shared shapes announced in CONTRACT.md "Social bridge sidecars"
  (data/social/{inbox,outbox,accounts}.json) — additive, NOT in latest.json, no
  golden fixture, not your (structure) surface. Load-bearing invariant: MCP only
  stages posts; nothing sends without a human "Approve & Send" in the extension
  popup — do not add a server/MCP auto-approve path without a security review.
  Extension manifest now requests `scripting` + `https://bsky.app/*`. I did NOT
  touch your in-flight realm-sheet migration (lands.css Task 7 etc.) or
  ux-after-t5.json — all left uncommitted for you.
DONE: Live-hotkey wiring — the statusbar advertised "1-5 tabs · F focus · /
  search" but only F was real. Now "/" opens the Ctrl+K command palette
  (typing-guarded) and digits 1-9 jump to the Nth visible realm; hint corrected
  to "1-9 realms". Fixed a latent number-nav bug (used r.id, but ordered()
  yields {manifest,view} → r.manifest.id). Path-scoped commit d3a38d1
  (core/chrome.js + core/palette.js ONLY). Selftest 91/91, 0 errors.
IN-FLIGHT: running a sequential self-improvement loop — each iteration is a
  small path-scoped commit + selftest. Staying OFF your DS CSS surface
  (base/components/chrome.css); I only touch JS + new files.
ASKS: none.
BREAKS: NEW in-app hotkeys claimed by the renderer — "/" (open palette) and
  1-9 (realm jump), both no-op while typing in a field. FYI: my earlier
  devfleet commit 92caa2f swept your then-uncommitted Task 4 work via a broad
  `git add` (the collision you noted in ebc649a) — mine; path-scoped from here.

## 2026-07-26 · FROM frontend (Task 4 session) · main @ a39df7e
DONE: NEXUS DS Task 4 — migrated ALL spacing literals (gap/margin/padding
  + longhands) in the three SHARED sheets (base.css, components.css,
  chrome.css) onto the --space-* ramp via a snap map (0→space-0 … stray
  40-56px→space-7). Verified: `--smoke --selftest` → `SELFTEST combos=91
  errors=0 PASS`; screenshots (nexus-shot.js) eyeballed across roundtable/
  grimoire/watchtower/legacy vs scratchpad baseline shots — pixel-level
  match, no broken layout. gapDistinctCount held at 16 (unchanged from
  baseline) — confirmed by design: gapDistinctCount only measures the CSS
  `gap` property, and every realm sheet (styles/realms/*.css, Task 6 scope)
  independently supplies the full spread of raw gap literals, so shared-
  sheet-only migration can't move that metric yet (expected per the plan;
  ≤7 gate is Task 9). One literal deliberately left un-snapped: `#stage
  padding-bottom: 64px` (chrome.css) — fixed-statusbar clearance, outside
  the ramp's 0-56px range, snapping would risk clipping content.
  Full report: .superpowers/sdd/2026-07-26-nexus-design-system/task-4-report.md
IN-FLIGHT/COLLISION: **this session's CSS diff never landed as its own
  commit.** While I was verifying (selftest/harness/screenshots), the
  concurrent frontend session committed `92caa2f` ("devfleet upgrade —
  CHRONICLE + ATLAS realms...") from the same shared working tree and its
  `git add` swept up my uncommitted base.css/components.css/chrome.css
  changes (diff is byte-identical to what I authored — 46/120/360 lines
  changed, matches exactly) AND my throwaway tools/ux-after-t4.json. So the
  Task 4 spacing-token migration IS in history, just riding under someone
  else's commit message/SHA instead of its own `fe: design-system —
  migrate shared sheets to spacing tokens` commit. I did NOT rewrite/amend
  92caa2f (rewriting a commit mid-flight in a shared worktree risks
  destroying the other session's follow-on work) — instead landed a small
  cleanup commit `a39df7e` untracking the stray json artifact.
ASKS: if anyone reviews `92caa2f`, know that ~526 of its changed lines
  (base.css/components.css/chrome.css) are Task 4's token migration, not
  part of the devfleet/realms feature work described in that commit's
  subject.
BREAKS: none functionally — pure spacing-token substitution, no selectors
  added/removed, no behavior change.
```

---

## 2026-07-26 · FROM frontend · main @ 9b93ae6
DONE: AUTOMATIONS (grimoire) advanced filtering (ba13b5e) — new .toolbar2 row:
  Kind (Runnable/Interactive/Plugin) · Usage (Used/Unused) · ⏳ Scheduled toggle
  · Sort (Most used/Recent/Name) · Clear. Additive: all logic in grimoire/
  view.js + a fresh-classname CSS block. Verified E2E headless (944→Runnable
  34→+Scheduled 16→Clear 944; 0 console errors). Plus 3 audit fixes: stranded
  drawer on realm switch (central closeDrawer in shell.switchRealm), stuck
  RESCAN '…' button (try/finally), roundtable NaN% avg (empty-projects guard)
  (ba13b5e + 9b93ae6).
IN-FLIGHT: nothing uncommitted from me.
ASKS: my new grimoire controls follow the sheet's CURRENT raw-px idiom (11.5px
  seg / 10px labels) to match their siblings — Task 8's grimoire.css migration
  should snap them onto --fs-* with the rest in one pass (they add ~1.5% to
  sub12pct until then).
BREAKS: none — additive JS + new-classname CSS; realm view.js is outside the
  design-system pass's CSS-only surface. NOT fixed (surfaced only): lands
  overflow=15 is your Task 7; jitter recs from the audit still open — ambient
  rail full innerHTML rebuild on every browser-tab push (ambient.js:87),
  summoning list rebuild/15s, forge search no-debounce, medbay LIVE stale
  across scrub, dormant AOS re-flash once fx lazy-loads AOS.

## 2026-07-26 · FROM frontend · main @ 535f49d
DONE: Final whole-branch review fixes for NEXUS ALIVE Phase 0 substrate — two
  commits. (1) C1-critical: scrubbed residual real-world PII missed by an
  earlier redaction pass in dashboard-v3/src/intel/__fixtures__/sample.json
  — nested insight IDs/text tied to real client names, a real PWA folder
  name, an orphan trend key, and personal GitHub clone origins. Broad
  case-insensitive sweep + absolute-Windows-path grep both zero-hit
  (688e012). (2) I1: derive.mjs streakRisk/momentum now guard invalid or
  undefined `now` instead of throwing RangeError — "never throws" contract
  is now total. 2 new tests added; derive.test.mjs is 11/11 green
  (535f49d). Report: .superpowers/sdd/2026-07-26-nexus-alive-program/
  final-fix-report.md.
IN-FLIGHT: nothing uncommitted.
ASKS: none new — this closes out the final-review punch list for Phase 0.
BREAKS: none. Fixture-only + derive.mjs (not yet imported by the renderer,
  per program invariants) — no runtime surface touched.

## 2026-07-26 · FROM frontend · main @ 07b74a8
DONE: Wired in the prior block's orphaned realms + palette (07b74a8). Three
  authored-but-unregistered realms are now live: CHRONICLE (🕰 retro timeline,
  order 11), ATLAS (📊 analytics/charts, order 12), CONJURE (✦ Claude's live
  canvas feed, order 13). Plus the Ctrl/Cmd+K COMMAND PALETTE (core/palette.js
  — quick-switch realms/projects/quests/tasks/vaults/spells). Touched the four
  shell seams only: boot.js (register+initPalette), realms.css (@imports),
  index.html (palette.css link), lexicons.js (tab_chronicle/atlas/conjure in
  all 3 registers). Verified headless: selftest 91/91 (13 realms × 7 themes),
  0 mount errors; palette opens on real Ctrl+K, 0 console errors.
IN-FLIGHT: nothing uncommitted. NOT pushed — 4 commits ahead of the last push
  point; run the usual pre-push secret scan when you next push.
ASKS: unchanged — M1 economy batches still open (entries below). CONJURE reads
  data/canvas/* (the MCP hq_canvas_add board) — shape already contract'd.
BREAKS: none. All additive, frontend-lane only (dashboard-v3/). New localhost/
  hotkey surface: Ctrl/Cmd+K is now claimed by the renderer palette (in-app
  only, not a global shortcut — no clash with the main-process Ctrl+Alt+* set).

## 2026-07-23 (GO-LIVE) · FROM frontend · main @ 8847fe8
DONE: ⚡ NEXUS IS LIVE — user-directed swap: data/.ui-version flipped to
  "v3", app restarted. Verified against the RUNNING instance: window title
  "WorkspaceHQ — NEXUS", bridge /health 200, boot log clean, and the full
  Familiar loop live (MCP hq_canvas_add → first-light board → app watcher;
  hq_quests_list serves 12 real quests). Rollback stays one flip: set the
  file back to "v2" + restart.
IN-FLIGHT: nothing. BREAKS: the app you relaunch now boots v3 — v2 renderer
  untouched on disk if you need it.

## 2026-07-23 (SWARM) · FROM frontend · main @ 8847fe8
DONE: THE MAP IS FULL — realms 7-10 built by a 7-agent swarm, adversarially
  reviewed (6 findings, all fixed), selftest 50/50, 50 shots clean. MED-BAY
  (anatomy ward + triage empty state), OBSERVATORY (vault constellation),
  WATCHTOWER (LIVE off existing dwell — Aggro 71 today), SUMMONING CIRCLE
  (session registry + Bell + THE CANVAS). Plus: canvas engine in main.js
  (data/canvas/*.canvas fs-watched, hq:canvas-read/add — IPC-CONTRACT'd) and
  dashboard-v3/mcp/server.mjs — zero-dep stdio MCP, 7 file-mediated tools,
  registered in .mcp.json (NEW tracked shared file — announce noted here).
IN-FLIGHT: nothing uncommitted.
ASKS (new, all CONTRACT-entry material — shapes documented in the realm
  view.js headers): (1) M2 pc-health: collector/pc-health.mjs →
  data/pc-health.json { scanned_at, organs:[{id,label,status:grace|ember|
  blood,value,unit,spark[],diagnosis,teaching?}] } — renderer ships tolerant.
  (2) M2 spellbook/: Restoration fix-spells need school:'restoration'.
  (3) M4: register the 4th vault (only 3 in inventory.vaults today).
  (4) NotebookLM sidecar shape + quest-sync field names when they land.
  M1 economy batches still open (below).
BREAKS: none. .mcp.json is NEW + tracked (no tokens in it — file-mediated
  v1); data/canvas/ gitignored (personal boards).

## 2026-07-23 (MA) · FROM frontend · main @ ea2b8ac
DONE: MA — THE UNTANGLING complete (spec: docs/superpowers/specs/
  2026-07-23-ma-untangling.md). claude-sessions.js registry (async
  everything; draft-commit's 90s main freeze is dead; unit-tested 6/6),
  chains/Ultimates in the caster (chain-aware cancel, chain telemetry),
  shards + summon palette on REDUCED preloads (conjured HTML can't reach
  castSpell/doCommit anymore), browser-bridge.js generalized into the
  tendril router (legacy routes byte-compatible, atomic writes, new tendril
  = one table row — your M4/M5 sidecars plug in there). New IPC rows in
  IPC-CONTRACT.md: hq:sessions-list + hq:claude-sessions push.
IN-FLIGHT: nothing uncommitted. Live-app verify (async draft-commit, chain
  cast, hardened shard) lands on the next app restart — nothing changes the
  v2 renderer contract, so restart timing is the user's.
ASKS: unchanged — M1 economy batches (below). M3 Summoning Circle is now
  ungated on my side.
BREAKS: none for you. FYI: telemetry may now contain chain-level cast rows
  (chain_id === cast_id) once chains are cast — additive, goldens
  unaffected (telemetry isn't goldened).

## 2026-07-23 (later) · FROM frontend · main @ ad13f59
DONE: Answered your ask — the orphaned uncommitted work was the ACTED-ON
  LEDGER (mine, pre-M0 in-flight); reviewed + landed as 668a6a2 (hardened
  write w/ quarantine, hq:acted-on-read live read, evidence strip, seconds
  fix). IPC-CONTRACT: +getActedOn row. Then, gate lifted (your push + that
  landing), the SWAP HOOK landed (ad13f59): main.js uiVersion() reads
  data/.ui-version — "v3" loads dashboard-v3/ with the UNCHANGED preload,
  anything else stays v2. Rehearsed: v3 html + real preload = NEXUS boot
  clean, selftest 30/30 PASS (dev-main HQ_V3_PRELOAD=v2 knob).
IN-FLIGHT: nothing uncommitted. Flag NOT flipped (user's call): flip
  data/.ui-version to "v3" + restart per CLAUDE.md to go live on NEXUS.
ASKS: M1 economy batches (entry below). Not pushed — run the usual pre-push
  secret scan when you next push (6 new commits).
BREAKS: dashboard/main.js touched for the first time post-gate — additive
  createWindow read only, default v2.

## 2026-07-23 · FROM frontend · main @ c63d120
DONE: NEXUS ambient rail (Working On Now / vitals / whisper / Familiar slot /
  night-tide, collapsible) + topstrip flex fix. M1 frontend half: voice packs
  (src/lexicon/voice/*.json + deterministic resolver, wired into the
  celebration card; verified both registers). M1 spec committed:
  docs/superpowers/specs/2026-07-23-m1-game-core.md.
IN-FLIGHT: nothing uncommitted in my lane.
ASKS (⚡ M1 economy — the four batches are yours, spec has full detail):
  1. grace_hours:36 config no-op FIRST, then wire the read (streak safety).
  2. GCFG projection into window.DATA via build-data (post-landing, one-line).
  3. Banking batch w/ stacking + grandfather (notify:false migration).
  4. Juice batch (seeded crits + combo times in quest-overrides — CONTRACT
     entry) · Meta batch (runes_balance split ledger). Each batch = CONTRACT
     Pending entry + golden re-baseline (invariant 2).
BREAKS: none. New tracked spec file only; voice packs are v3-renderer-local.

## 2026-07-23 · FROM meta (cleanup) · main @ 79dd119
DONE: repo hygiene. Gitignored Understand-Anything/ (67MB stray nested repo,
  github.com/Egonex-AI/Understand-Anything — kept on disk, out of git). Same
  commit also carried your uncommitted data/acted-on.json gitignore line (found
  it already in .gitignore, uncommitted — swept into this meta commit since it's
  additive + identical intent; nothing lost). Pushed main to origin (was 8 ahead).
IN-FLIGHT: nothing uncommitted by me.
ASKS: dashboard/{app,build-data,main,preload}.* + data/quest-overrides.json are
  sitting UNCOMMITTED in the shared tree — are these yours / in-flight? Flagging
  so they aren't lost on a checkout. I did NOT touch them (path-scoped commit).
BREAKS: none. New .gitignore lines only affect previously-untracked paths.

## 2026-07-22 · FROM frontend · main @ d4e3a46
DONE: NEXUS v3 M0 — the whole frame. dashboard-v3/ boots beside live v2 (ESM
  over file:// proven, strict CSP, scratch profiles). Shipped: realm registry +
  shell (6 realms: roundtable/forge/hunts/grimoire/lands/legacy), ALL v2
  surfaces ported at parity (11-agent workflow + adversarial verify: selftest
  30/30 combos, 0 console errors, parity screenshots reviewed), chrome
  (scrubber/Warden plate/SYS/FOCUS), fx (sfx/takeover/exporter), docs/sync/
  IPC-CONTRACT.md (window.hq frozen: 40 invokes + 7 pushes, additive-only).
  Parity harness: dashboard-v3/tools/parity-shot-{v2,v3}.js (shots gitignored).
IN-FLIGHT: nothing uncommitted in my lane.
ASKS: unchanged — land your uncommitted dashboard/* + data/ work whenever
  ready. The v2→v3 swap hook (main.js reads data/.ui-version, loads
  dashboard-v3/index.html with the EXISTING preload) waits on that landing
  (invariant 3); until then v3 runs via its dev harness only.
BREAKS: none for v2 (fully parallel build). Shared files touched (meta):
  .gitignore (+shots dir, +data/.ui-version), docs/sync/IPC-CONTRACT.md (NEW —
  read before adding any IPC channel), data/.ui-version (new gitignored
  runtime flag, currently "v2").

## 2026-07-21 · FROM frontend · main @ 386bc8a
DONE: Repo published to GitHub — https://github.com/Brvetr4ve1er/workspace-HQ
  (user-directed). Pre-push secret scan over all tracked files: clean; data/
  runtime files remain gitignored (only quest-overrides.json is tracked).
BREAKS (⚠ read this): `refactor/collector-modularization` was RENAMED to
  `main` (git branch -M, linear history — nothing orphaned) and pushed as
  origin/main with upstream tracking. Same commit, same working tree — but any
  reference to the old branch name is stale. Both lanes work on `main` now.
ASKS: commit your in-flight working-tree changes (app.js/build-data/main.js/
  preload + quest-overrides mods are uncommitted) whenever ready, then just
  `git push` — upstream is set.

## 2026-07-19 · FROM shared (landing) · refactor/collector-modularization @ 139db4b
DONE: Landed the in-flight Browser Bridge / CLAUDE-ON-TAP work (previously
  verified but sitting uncommitted in the shared tree — see the two 2026-07-16
  entries below) as a clean 3-way split: struct (8159e5b: collector/lib/
  browser.mjs +test, assemble.mjs), fe (139db4b: dashboard/browser-bridge.js,
  app.js, main.js, preload.js, styles.css), meta (this commit: browser-bridge/
  extension, tools/now-brief.mjs, CONTRACT.md, .gitignore, this handoff).
  Re-verified before commit: collector lib suite 22/22, browser.test 5/5, diffs
  reviewed (esc()-wrapped, latest.json.browser additive, no contract break).
IN-FLIGHT: nothing uncommitted. Understand-Anything/ is an unrelated nested git
  repo living in the folder — deliberately left untracked (not part of HQ).
ASKS: unchanged — optional structure per-project browser_domains[] (below).
BREAKS: none — all additive. Extension still needs a manual load-unpacked in
  Chrome; running Electron app must be restarted for port 47821 to listen.

## 2026-07-16 (later) · FROM shared · refactor/collector-modularization @ 663b66d
DONE: CLAUDE-ON-TAP (browser-bridge follow-up). New `tools/now-brief.mjs` (tracked) —
  fuses live browser focus (reuses collector/lib/browser.mjs) + per-project git (live
  `git status` for active projects, falls back to latest.json git_safety) + open quests
  into `data/now-brief.md`, ending with one next-action. `--json` flag for future app use.
  New `.claude/commands/resume.md` (LOCAL — .claude/ is gitignored) = the `/resume`
  slash command that runs the tool, reads the brief, answers what-to-resume. Verified:
  real run picks 5 active projects w/ live git dirty counts + correct next-action;
  browser-fed run correlates github repo path + localhost port → alliance travel.
IN-FLIGHT: uncommitted. NOT YET DONE (queued behind this slice, user picked Claude-on-tap
  first): (a) "Resume with Claude" dashboard button (reuse hq:claude-quest launch path,
  frontend lane), (b) extension "ask Claude about this page" (Claude-in-Chrome + bridge
  context). Also: the running Electron app predates the bridge server — it must be
  RESTARTED for 47821 to listen and browser-activity.json to appear (until then now-brief
  runs on git+quests only). Restart per CLAUDE.md.
ASKS: none blocking. Same optional structure ask stands (per-project browser_domains[] —
  now doubly useful: it'd let now-brief attribute tool dashboards like dash.cloudflare.com
  to the right project instead of leaving them unmapped).
BREAKS: none. New tracked file tools/now-brief.mjs. New gitignored runtime data/now-brief.md.
  now-brief is READ-ONLY over latest.json + browser-activity.json — no contract change.

## 2026-07-16 · FROM shared (both lanes) · refactor/collector-modularization @ 663b66d
DONE: BROWSER BRIDGE — WorkspaceHQ now sticks to Chrome like it sticks to Obsidian.
  New component `browser-bridge/` (MV3 Chrome extension: tracks active-tab focus,
  batches, POSTs to a localhost endpoint). New `dashboard/browser-bridge.js` ingest
  server on 127.0.0.1:47821 (CORS+custom-header gated, optional token), started from
  main.js whenReady, writes `data/browser-activity.json` (rolling 3-day window) and
  pushes a live-tab IPC ticker. Collector: `lib/browser.mjs` (+test, 4 cases green)
  folds activity into `latest.json.browser` (current focus, by_domain, by_project via
  dev_cmd ports + github repo slugs); wired in assemble.mjs. Frontend: "Working On Now"
  card in app.js renderOverview (+ live ticker via new preload getBrowserLive/onBrowserTab),
  styles.css, lexicon key working_now. Verified: bridge handshake via curl, browser.test
  + full lib suite (21) green, assemble emits populated block, offscreen render shows the
  card with no console errors.
IN-FLIGHT: all uncommitted (one shared working tree). NOT yet committed — commit split
  suggested: struct: (collector/lib/browser.mjs+test, assemble.mjs), fe: (dashboard/*),
  meta: (browser-bridge/, docs, .gitignore). Touched BOTH lanes in one session per user
  ask ("stick it to my browser like Obsidian"); flagging so the other session doesn't
  collide. Extension not yet loaded in Chrome by the user (manual load-unpacked step).
ASKS: none blocking. Optional (structure): add per-product `browser_domains[]` to
  collector.config.json for domains that aren't a github slug or dev_cmd port (e.g.
  almaflowclim.fr) — browser.mjs already matches host slugs, config would make it exact.
BREAKS: none — `latest.json.browser` is ADDITIVE & optional (CONTRACT.md updated; renderer
  guards absence). New runtime files data/browser-activity.json + data/.bridge-token
  (gitignored, don't schema-validate). New localhost port 47821. New IPC hq:browser-live
  / hq:browser-tab. Golden harness unaffected (additive, deterministic over file input).

## 2026-07-11 (later) · FROM frontend · refactor/collector-modularization @ 5804801
DONE: NIGHTFALL COMPLETE (P0-P4 all shipped). P3 theme-scoped lexicon — canon
  labels ride the Nightfall theme only; other themes verified byte-identical.
  P4: Night's Tide (ambient, --tide from age_days + night-hour class),
  Scadutree Blessing meter in LEGACY (render-derived, off the XP ledger),
  Seven Classes sigils (deterministic classify, lexicon-gated). Also fixed a
  latent SYS-menu bug (EXPORT/SFX clicks reset theme to arcade).
IN-FLIGHT: nothing. NG+ review screen deferred (needs your narrator pattern —
  see CANON.md). Organic v2 P2 (context-aware Messengers) is next on frontend.
ASKS: unchanged (optional canon variants in render.mjs + level titles).
BREAKS: none. New localStorage keys: hq-night-hour (default 21).

## 2026-07-11 · FROM frontend · refactor/collector-modularization @ d2ad23a
DONE: NIGHTFALL art direction P0-P2 (spec: docs/superpowers/specs/2026-07-11-
  nightfall-design.md, approved). P0 docs/CANON.md — THE shared vocabulary
  (Hunts/Whispers/Insight/Runes/Vitality/Spirit Summons/Messengers/…). P1 5th
  app theme "nightfall" (Yharnam gothic × ethereal; all theme rails honored).
  P2 vault skin: .obsidian/snippets/nightfall.css, 4 Keepsake templates,
  Roundtable Hold.md MOC, plugin HUD labels → canon (vault files, not in repo).
IN-FLIGHT: P3 (theme-scoped lexicon renames in app) + P4 (Night's Tide,
  Scadutree Fragments, class sigils) — next frontend block.
ASKS (optional, non-blocking): per CANON.md — canon headings variant in
  render.mjs Quest Board ("Hunts") and canon level-title set in
  gamification.config.json. Frontend display-remaps regardless.
BREAKS: none. New theme id "nightfall" in localStorage hq-theme. Fonts link
  in index.html grew Cinzel + IM Fell English.

## 2026-07-10 (later) · FROM frontend · refactor/collector-modularization @ 5a8e56f
DONE: Organic UI v2 subproject opened — charter at docs/ORGANIC-UI-V2.md, home
  dashboard/organic/ (shard.html + summon.html moved there, main.js paths updated).
  P1 widget library shipped: conjures auto-save to data/shard-library.json,
  matching summons re-spawn instantly from cache, `lib` opens a browser shard
  (summon/delete), conjured shards get a ↻ regen button. Verified live.
IN-FLIGHT: nothing uncommitted. Next pillars (P2 context-aware, P3 live-data
  shards, P4 manager, P5 theming) per charter.
ASKS: unchanged from previous entry. New runtime file data/shard-library.json
  is gitignored user content — don't schema-validate it.
BREAKS: none. dashboard/shard.html + summon.html no longer exist at the old
  paths (now dashboard/organic/) — irrelevant to your lane but noted.

## 2026-07-10 · FROM frontend · refactor/collector-modularization @ 82e3426
DONE: Session-linking scaffold (this file, CONTRACT.md, root CLAUDE.md). Prior
  frontend work all committed: organic-UI shard engine (0d1ead9), UX declutter
  (29df117), theme system + fixes, spellbook UI integration.
IN-FLIGHT: nothing uncommitted in dashboard/. New frontend subproject starts
  next frontend session — scope TBD by user.
ASKS: (1) When modularization tasks land, keep `latest.json` shape identical —
  golden fixtures are the contract. (2) If you rename/move any collector output
  file (latest.json, spellbook.json, spell-telemetry.json, weekly-recap.json),
  announce in CONTRACT.md first: build-data.mjs + main.js read them by path.
  (3) Merge to main when the refactor is green; frontend commits are riding
  your branch (shared working tree).
BREAKS: none for you. FYI: main.js grew an ORGANIC UI section (shards) +
  `Ctrl+Alt+G` global hotkey + `data/shards.json` runtime file (gitignored-eligible,
  currently untracked-by-design? it IS written at runtime — treat as runtime state,
  don't schema-validate it).
