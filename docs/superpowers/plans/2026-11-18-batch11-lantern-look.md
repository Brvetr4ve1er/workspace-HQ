# Batch 11: the Lantern look

Stamp `2026-11-18.batch11`. FREEZE RULE holds: no new space, no new MCP tool, no new view. This batch adds a third look beside the Console skin and the Workbench look. Like the Workbench look, it is tokens, type and pictures on hosts that already exist, with no IPC and no act mark, and it is off by default.

## Why

The owner asked (2026-11-18) to bring the feel of a side project of their own (an original-art fan wiki they made) into WorkspaceHQ: "almost like mapping out a game system on top of the app". The look carries that mood. The game-system parts that would be new things to click (see "Next stage") wait for the act bar, as the freeze says.

Use report read 2026-11-18 (counts only): 117 marks in the last 7 days, 1 act (tasks-board, on 1 day), 20 surfaces never seen, `launcher-workspace` among them. The Open workspace act bar (3 acts on 3 separate days in 7) is read on 2026-11-24 at the earliest. A look is not a view and asks for no act, so it does not wait for that bar.

## What the owner gets

Settings > Appearance gets a third look chip, **Lantern**, beside Console and Workbench. It is chosen only while the Console layer is on, and it is mutually exclusive with both.

- **Field and ink.** Near-black ink, bone text, brass accent, blood red for the rows that need the owner most. A parchment version for the light base.
- **Type.** Headings in an engraved serif, upper case with wide tracking: the stack is `'Cinzel', Georgia, 'Times New Roman', serif`, which uses Cinzel only if the owner has it installed on Windows. Small labels (section kickers, chips, readouts) in the bundled IBM Plex Mono, upper case, tracked, in brass. Body text stays the app's sans. Nothing is downloaded and there is no `@font-face` for a file the app does not have.
- **The deck.** Every project gets its own card on its project page: one of the 22 Major Arcana, picked by a stable hash of the project id, drawn with the owner's own glyphs (see "Art"). The card names are the traditional tarot names (The Fool to The World), which are public domain. A project keeps its card forever because the hash is stable.
- **Five cards for the five Workbench hosts.** The same five hosts and the same real numbers as the Workbench look, each drawn as a tarot card whose bottom line is the readout:
  - clean-board card: The Hermit (lantern glyph), "N CLEARED";
  - Crew header: The Lovers (rings glyph), "N SKILLS";
  - Vault desk header: The High Priestess (eye glyph), "N NOTES" ("N+" when the walk was capped);
  - empty Brief: The Sun, "0 NEED YOU";
  - empty Projects shelf: The World, "N PROJECTS".
- **Sealed cards.** Where the Workbench look draws nothing while a number is not read yet, the Lantern look draws the face-down card back (brass rings on ink, the word SEALED). The back carries no number, so it is never a false 0. Once the number is read, the card turns face up. Under reduced motion it changes without a flip.
- **Blood for urgency.** A high-severity Brief row gets a thin blood-red rule on its leading edge. This is CSS only, and no text changes.

Text, labels and accessible names stay exactly as they are. This look renames nothing.

## Design decisions (made here, not left to the cook)

1. **Pref.** `consoleLayer.look` accepts `''`, `'workbench'` or `'lantern'`. `lookId()` in `logic/console-layer.mjs` accepts the new id. The mutual exclusion stays as it is: choosing a look clears the skin, choosing the skin clears the look, and choosing one look replaces the other. The Ctrl+K theme verb that leaves the look clears it for Lantern too. Export `LANTERN_LOOK = 'lantern'`.
2. **Palettes.** Replace `WORKBENCH_PALETTES` with one table, `LOOK_PALETTES = { workbench: ['signal'], lantern: [] }`. Under Lantern no accent palette does anything; stored palettes stay on disk, inert. Keep `WORKBENCH_PALETTES` exported as an alias if a test imports it.
3. **Who owns `data-hq-look`.** It stays bound from `wbnv.wbnLook` in `tpl/shell.tpl.js`, unchanged, so the template hash for the shell does not move. `wbnv.wbnLook` now means "the effective look id": `'workbench'`, `'lantern'` or `''`. `vals/workbench.js` returns a second frozen constant, `WBN_LANTERN` (`wbnLook: 'lantern'`, `wbnOn: false`, all five pictures the empty art), when the layer is on and the look is Lantern. With the layer off it still returns `WBN_OFF`, so layer-off goldens do not move for `wbnv`.
4. **Sheet.** `styles/lantern.css`, attached only through `layerSheet('lantern', …)` (id `hq-lantern-css`) while the look is chosen. Every rule sits under `[data-hq-look="lantern"]`. The probe link count with Lantern chosen equals the Workbench count with no palette (pin it in `console-layer.test.mjs`).
5. **Values.** One new top-level key, `lntv` (renderVals 989 to 990). `vals/lantern.js` mirrors `vals/workbench.js`: with the look off it returns ONE frozen constant and reads nothing. With it on it reads the five numbers through the existing `workbenchNumbers(S, ctx)` (import it, do not copy it) and memoizes on them. `lntv` = `{ lntOn, cleared, skills, notes, needyou, projects, project }`. Each picture is `{ show, sealed, aria, viewBox, shapes, title, label, roman }`. `show` is true while the look is on. `sealed` is true while the number is null. `project` is the current project page's card, built from the project id the page already holds; it is empty when no project page is open.
6. **Templates.** `tpl/lantern.tpl.js` exports `lntArt(kind)` (same dc-lite dialect as `wbnArt`: dotted paths, `sc-if`/`sc-for`, no `{{ }}` inside a `<style>`). The five hosts that import `wbnArt` also import `lntArt` and place it beside `wbnArt` (they never show together). `tpl/project-page.tpl.js` gets `lntArt('project')` in its header. `tpl/ov-settings.tpl.js` gets the third chip. Template hash re-recorded with attribution. Each new fragment is wrapped in its own `sc-if`, so with the look off there is no node in the page.
7. **Accessibility.** The picture is `aria-hidden`. Its wrapper has `role="img"` and an `aria-label` that starts with the readout ("3 cleared, card: The Hermit"). A sealed card's label is "Not read yet, card face down". The project card's label is "Arcana XVI, The Tower". The flip is a CSS transform inside one `prefers-reduced-motion: no-preference` block that is also scoped to `:root:not([data-hq-reduce])`.
8. **Version card.** BUILD_STAMP `2026-11-18.batch11`. The What's new text says in plain words: "A new look, Lantern: ink, bone and brass, a tarot card for each project. Turn it on under Settings > Appearance."

## Tokens (proposed; the cook verifies them with the contrast tests and may only darken or lighten a value to pass, recording each change in HANDOFF)

Dark base, `[data-hq-look="lantern"][data-hq-theme]`:
`--bg:#0a090b; --bg2:#110f13; --panel:rgba(17,15,19,.92); --card:rgba(24,21,26,.95); --card-hi:#201c22; --ink:#050406; --frame:#2a2529; --frame-hi:#5a4f45; --text:#ece5d6; --muted:#cfc6b4; --faint:#a8a08e; --gold:#d9a84e; --gold-2:#f0c878; --accent-text:#f0c878; --link:#f0c878; --link-hover:#ece5d6; --green:#a3c98e; --red:#e8747a; --orange:#e3a066; --yellow:#e6cf7a; --blue:#94b2dc; --purple:#bba2e0; --cyan:#8cc8c0; --scrim:rgba(5,4,6,.72)`, plus `--lnt-blood:#9e1c24` (fill and rules only, never text), `--lnt-card:#ece5d6`, `--lnt-glyph:#0a090b`, `--lnt-back:#121014`, `--lnt-serif:'Cinzel',Georgia,'Times New Roman',serif`, `--term` and `--px` set to IBM Plex Mono as in workbench.css, and the `--tone-*` aliases as in workbench.css.

Light base (parchment), `[data-hq-look="lantern"][data-hq-theme="light"]`:
`--bg:#ece5d6; --bg2:#e4dccb; --panel:rgba(236,229,214,.92); --card:rgba(245,240,228,.96); --card-hi:#fbf8f0; --ink:#ddd3bf; --frame:#c4b79f; --frame-hi:#7a6c58; --text:#1a1517; --muted:#4a4038; --faint:#5f5446; --gold:#7a5414; --gold-2:#5e400c; --accent-text:#6b4a10; --link:#6b4a10; --link-hover:#3e2a06; --green:#3f6a34; --red:#8e1a22; --orange:#8a4f14; --yellow:#6e5a10; --blue:#2f5080; --purple:#5a3f86; --cyan:#2a6460; --scrim:rgba(26,21,23,.3)`, with `--lnt-blood:#8e1a22` and the card tokens the same as the dark base (the cards are bone on every base).

On the light base `--gold` must read as text at 4.5 and take a white label when a control is gold-filled. Follow the existing one-rule-per-sheet pattern that matches the serialized inline style `background: var(--gold);`.

## Art

The owner's wiki page draws 22 symbolic Major Arcana glyphs and a card frame in code (its glyph table `S`, its `cardFront` frame and its `cardBack`). These are the owner's own original drawings, and they may be reused here. The game's names and data may not.

- Copy ONLY the 22 glyph shapes, the card frame and the card back. The source is a saved copy of the owner's page; the run is told where it is, outside the repo (read the `const S = {`, `cardFront` and `cardBack` lines only). Never open or copy its `data.js`, its boss names, area names, its footer or its links. Never write that file's path, the page's web address or any studio name into the repo, a commit message or HANDOFF.
- The glyph keys are in tarot order: door=0 The Fool, infinity=I The Magician, eye=II The High Priestess, cradle=III The Empress, crown=IV The Emperor, chalice=V The Hierophant, rings=VI The Lovers, chariot=VII The Chariot, claws=VIII Strength, lantern=IX The Hermit, wheel=X Wheel of Fortune, scales=XI Justice, hanged=XII The Hanged Man, hourglass=XIII Death, temperance=XIV Temperance, devil=XV The Devil, tower=XVI The Tower, star=XVII The Star, moon=XVIII The Moon, sun=XIX The Sun, bell=XX Judgement, world=XXI The World.
- `logic/lantern-art.mjs` is pure. It holds the 22 glyphs as `path` `d` strings (convert each circle, ellipse and rect to an equivalent path, because the template draws `path` only) in the 120x200 card box. Each shape's colour is a token name (`var(--lnt-glyph)`, `var(--lnt-card)`, `var(--lnt-blood)`, `var(--gold)`), never a hex value. It exports `ARCANA` (22 rows: roman, name, glyph shapes), `cardFor(projectId)` (FNV-1a 32-bit of the id, mod 22), `bindCard(kind, n, capped)` for the five readouts, `bindProject(id)`, `bindSealed()` and `LNT_EMPTY_ART`. Same output shape for every card: `viewBox:'0 0 120 200'`, the frame shapes first, then the glyph.
- The Workbench art test pins "shapes from a fixed primitive table" for `workbench-art.mjs` only. `lantern-art.test.mjs` pins the Lantern table its own way: 22 entries, every `d` parses as path commands only, colours are `var(--…)` only, `cardFor` is stable and spreads over at least 15 of 22 cards across 100 invented ids.

## Never-appears word list

Extend the committed word list that the Workbench and Console tests use (console makers, game titles, mascots) so that it also never finds, anywhere in `dashboard-v5/src`, `dashboard-v5/styles` or the new tests' subject files: the title of the game the owner's wiki is about, its add-on's title, its studio, its publisher, and its place and item names that could leak through the wiki (the city name, the hub dream's name, the currency, the "Insight" stat when written as a game term, the chalice dungeon term). The cook writes these words ONLY into that test's list. That is the one allowed place, and it already holds other game titles.

## Files

New: `styles/lantern.css`, `styles/lantern.test.mjs`, `src/logic/lantern-art.mjs`, `src/logic/lantern-art.test.mjs`, `src/vals/lantern.js`, `src/tpl/lantern.tpl.js`, cdp scenarios `tools/cdp-lantern.mjs` (+ its `.test.mjs` if the cdp tools carry one).
Touch: `logic/console-layer.mjs` (+ test), `vals/workbench.js` (the `WBN_LANTERN` constant), `vals/index.js` (register `lntv`), the five art hosts, `tpl/project-page.tpl.js`, `tpl/ov-settings.tpl.js` (chip) and whatever Settings logic writes `look`, `src/selftest-console.mjs` (Lantern states), `tools/cdp-gate.mjs` (register the scenarios), `live/build-stamp.mjs`, `logic/version-card.mjs`, `src/tpl.hash.test.mjs`, `__golden__/vals.hashes.json`.
Not touched: `console.css`, `cheats.mjs` (still 8 codes), `vals/console-skin.js`, main process files, any IPC.

## Tests and gate

`node --test dashboard-v5/src/logic/{lantern-art,console-layer,workbench-art,version-card,shelf,cheats}.test.mjs dashboard-v5/styles/*.test.mjs`. What they must pin:
- the token contract over both bases;
- contrast of at least 4.5 for text, muted, faint and accent-text on bg and card, on both bases;
- a white label on gold-filled controls on the light base;
- no layout property on a real element, and no `position` on `#tabs` or `.timemachine`;
- motion only inside the reduced-motion guard;
- the probe reads zeros with the layer off, and the pinned link count with Lantern chosen;
- Lantern clears skin and Workbench, and each of them clears Lantern;
- palettes are inert under Lantern;
- the word list never matches;
- the five readouts equal their inputs;
- a sealed card while a number is null;
- the project card is stable for the same id.

CDP: `lantern-skin` (choose it, root carries `data-hq-look="lantern"`, the sheet link is present, the serif applies to a heading), `lantern-art` (the five cards and the project card render on invented gate data with the right readouts and labels), `lantern-sealed` (a number held back shows the back, then the face), `lantern-reduced-motion`, `lantern-leave` (Workbench, the Console skin and turning the layer off each remove the sheet and every Lantern node). The existing `console-*` and `workbench-*` scenarios stay green.

Goldens: with the layer off only `lntv` (new, frozen), `tpl.hash` and the stamp (`vcdv.vcdStamp`, `vcdv.vcdLabel`) move. Each move is checked with `dashboard-v5/tools/golden-diff.mjs`, and the commit names the paths. renderVals 990 of 1015, counted from a golden dump.

Full gate: `node tools/gates.mjs --native`.

## Next stage (NOT built in this batch; for the owner to pick after the act bar is read on 2026-11-24)

These would be new things to click, so they are views and wait for the freeze's act bar:
1. **Sealed first uses.** A strip on Home of face-down cards, one per setup the owner has not done yet (an editor chosen in the Launcher, one dev command allowed, the Security walkthrough, the Money start card, the Bridge paired, the phone brief file). Each turns face up when its fact becomes true, and clicking one goes to where it is set up.
2. **The weakness matrix.** One table of every project against its checks (CI failing, secrets in plain sight, uncommitted work, no deploy), a filled dot where it fails. This is the wiki's matrix applied to the owner's real projects, and each dot links to the verb that fixes it.
3. **Lamps.** A checkpoint mark when a project is committed and pushed clean, shown as a lit lamp on its card.
4. **Words.** Look-only wording for headings ("The hunt" for the Brief, "The lamps are lit" for the all-clear), if the owner wants the voice as well as the look.

## Only the owner can decide

1. Whether to add the Cinzel font file to the app (it is free under the OFL). Default: no; headings use Georgia unless Cinzel is installed on the machine.
2. Which of the four next-stage items, if any, after the act bar.
