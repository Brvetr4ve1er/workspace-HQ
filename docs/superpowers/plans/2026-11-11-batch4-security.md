# Batch 4: the Security space (footprint map, health, setup, generator) Implementation Plan

> **For agentic workers:** this plan runs in the WorkspaceHQ kitchen (cook each dish as new files, one integrator per dish in pass order with gates and commits, one taster per dish, one combined fixer), the same flow as batches 1-3. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the owner sees every account and access point as a growing map, knows what to fix, and never needs WorkspaceHQ to hold a secret.

**Architecture:** a pure engine (`dashboard/security-core.mjs`) reduces a KeePassXC export to names and flags in memory; a main-side reader/store (`security-vault.js`, `security-store.js`, `security.js`) runs the owner-installed `keepassxc-cli` on stdin and owns gitignored `data/security/`; the renderer space reads only IPC; MCP and the Brief read only names-and-flags and numbers-only files.

**Tech Stack:** Electron 32 (safeStorage, shell.trashItem, clipboard), Node node:crypto, node:test; v5 dc-lite templates; no new dependency.

**Spec:** docs/superpowers/specs/2026-11-11-security-space-design.md

Date 2026-11-11. Lane: frontend (shared edits announced in docs/sync/HANDOFF.md). Starts after batch 3 ships.

## Global Constraints

- Secrets never enter WorkspaceHQ storage, logs, IPC pushes, MCP, the Brief, the tray or the Bridge; the passphrase goes to keepassxc-cli on stdin only, never argv, env or a temp file.
- The one outbound call: HIBP range GET (5 hex SHA-1 characters, Add-Padding: true), only inside an owner-pressed refresh with the checkbox on.
- Refresh is never at boot, on a timer, or from MCP, the Bridge or a session; main window only.
- safeStorage unavailable -> identity labels stored as null ("locked"), never plaintext.
- Deletes are Recycle-Bin moves of listed plain-export files on the owner's click, never automatic.
- New main-side code in new files; main.js gets one init line. Contract rows (CONTRACT, IPC-CONTRACT) before code.
- Invented fixtures only (example.test, acme.test, alpha-site.test, owner@example.test, passphrase "correct horse example"); public repo.
- No new dependency, no install or download; keys 0-9 unchanged (Security is the 11th destination, no number key).

## Review Focus

- Wrong passphrase, a passphrase with a newline, a missing vault or missing cli: an answer in words, the old map untouched (security-vault tests).
- A very large vault: stdout capped at 64 MB / 60 s, the graph folds past 600 nodes with an exact "+N more" (security-vault, security-space tests).
- Offline during the breach check: "not checked", never "safe" (security-vault, vals/security tests).
- safeStorage unavailable (reinstall, other user): labels "locked", nothing in plaintext (security-store test).
- An entry renamed or deleted in KeePassXC: ids from UUID survive renames; an owner edit whose account vanished shows "not in vault" (security-core, security-store tests).

## Why

Batch 4 builds the Security space from the approved design (docs/superpowers/specs/2026-11-11-security-space-design.md): the owner's account map, health flags, breach check, generator and setup walkthrough. Secrets stay in KeePassXC (PC) + KeePassDX (Android) synced by Syncthing, 2FA codes in Ente Auth; WorkspaceHQ keeps account names and flags only. The one delicate path is the owner-pressed refresh: keepassxc-cli on stdin, parse in memory, reduce, drop. Four dishes: a pure engine, the main-side vault reader and store, the renderer space with the footprint graph, and the Claude/Brief/Reach doors.

## Order

1. **security-core** (M): Security engine: parse-and-drop, flags, identities, the graph model
2. **security-vault** (L): Vault reader and store: keepassxc-cli on stdin, breach check, safeStorage, exports and conflicts
3. **security-space** (L): The Security space: footprint map, health, setup walkthrough, generator
4. **security-doors** (S): Doors: hq_footprint for Claude (names only), counts-only Brief senses, the Reach row

## Pass rules

SHARED RULES. (1) Before any cook: ONE meta: commit with the HANDOFF entry announcing every shared file this batch touches (main.js one line, preload.js, catalog.mjs, cast-modes.js, app.js, app.tpl.js, vals/index.js, vals/ctx.js, live/store.js, selftest.js, fake-preload.js, cdp-gate.mjs, use-log.js + test, tpl.hash + vals.golden, server.mjs, guard.mjs + test, server.test.mjs, README, brief-sources.js, brief-core.mjs, brief-project.mjs, reach.js + test, vals/reach.js), the .gitignore line data/security/, the OWNER_DATA pins in tools/gitignore-owner-data.test.mjs (data/security/map.json, owner.json, settings.json, status.json, snapshots.jsonl and a .1234.tmp variant of each), the CONTRACT rows (data/security/* shapes exactly as in security-vault's spec: numbers-only status.json, enc: labels, never a secret) and IPC-CONTRACT rows (the ten hq:security:* channels; refresh is main-window-only) plus the MCP hq_footprint answer shape, all before any code. (2) Cooks write only their dish's new files and tests; shared edits go in pass notes as patches. (3) security-core is pure and lands first; security-vault imports it (dynamic import from CommonJS, the idiom brief-sources uses); security-space and security-doors read only the IPC and the files, never the vault. (4) Before the main.js hook the Pass re-checks HANDOFF's top entry says IN-FLIGHT: none. (5) Stage by explicit path; never git add -A; data/quest-overrides.json and docs/audits/ are never staged. (6) THE ONE OUTBOUND CALL is the HIBP range GET inside an owner-pressed refresh with the checkbox on; tests inject fetchRange and never touch the network; every other dish adds no network. (7) Invented fixtures only: example.test, acme.test, alpha-site.test, owner@example.test, the passphrase 'correct horse example'; a privacy scan of everything added must report 0 names, 0 secrets, 0 owner paths. (8) No secret may reach: a log (appLog, console, the day log), an IPC push, a file under data/, a commit, an error message, a test snapshot. The handler for hq:security:refresh never forwards its args to any logger; the Pass greps main.js and dashboard/*.js for a generic ipcMain invoke logger and stops (blocked) if one exists that would see the args. (9) Gate discipline as in batch 3: each dish's gates alone on the tree before the next dish's shared patch; goldens: only sec-prefixed keys, the new fragment and the new Brief rules may move, attributed; the cdp button sweep is re-measured after security-space and the batch STOPS if it passes 700 s. After all four: the full gates one after another (main, money, renderer, Electron selftest 0/0/0, cdp-gate all, cosmos-native.check.js, delivery-check.native.check.js), then push main, restart with tools\rollback.ps1 v5 and read the day log for errors and the first 'security' use mark.

## Tasting promises

- No secret survives a refresh: after a refresh with the fake cli, no password, note, otp value, username or the passphrase appears in any file under data/security/, any log line, any IPC answer other than the main window's decrypted identity labels, or any MCP answer; the passphrase reached the cli on stdin only.
- A wrong passphrase, a missing vault, a missing cli, a timeout or an oversize export each answers in words and leaves the previous map untouched; nothing is written on failure.
- Breach status is never faked: offline or a failed prefix shows 'not checked', the checkbox off makes no network call, and only 5 hex characters of a SHA-1 ever leave the PC with padding requested.
- Claude sees names and flags only: hq_footprint never returns an identity, username, group, id or path, and an account switched to hide-from-Claude appears only as a count; the Brief, tray and Bridge carry counts and rule wording only.
- safeStorage failure never falls back to plaintext: labels become 'locked' and come back on the next refresh.
- Plain export files are found by name at the top level of Downloads, Desktop and Documents, never opened, and only moved to the Recycle Bin on the owner's click per file.
- The map is honest and stable: account ids survive renames, an owner edit whose account vanished shows as 'not in vault' instead of disappearing, the layout is deterministic and folds past 600 nodes with an exact '+N more'.
- The space adds no number key, Ctrl+Alt+X can jump to Security, no golden moves beyond the attributed sec keys, the new fragment and the new Brief rules.

## Owner steps

1. Reply 'go' after batch 3 ships to start cooking.
2. Install KeePassXC yourself (keepassxc.org), create your vault with ONE memorised passphrase, print the emergency sheet from WorkspaceHQ > Security > Setup and write the passphrase on it by hand, keep it somewhere safe.
3. Turn on 2FA for your main email account first (it recovers everything else).
4. Chrome/Edge: export passwords to CSV, import it in KeePassXC (Database > Import > CSV), then use Security > Health to move the plain CSV to the Recycle Bin and empty the bin yourself.
5. Phone: install KeePassDX and Syncthing (or a Syncthing fork) from the Play Store or F-Droid, share the vault folder between PC and phone, unlock once with the passphrase and turn on fingerprint unlock and KeePassDX autofill.
6. Install Ente Auth on phone and PC, create the account, import Google Authenticator's export QR; keep the Ente recovery key on the emergency sheet.
7. In Security > Setup point WorkspaceHQ at the .kdbx file, press Refresh, type the passphrase, and look at the map; flip hide-from-Claude on any account you want private.

## Open questions (defaults are built in)

- Account merge (two entries that are the same account) is not built; archive one instead. Want merge later?
- The graph shows at most 600 nodes and folds the rest per identity. Enough?
- Passkey detection relies on KeePassXC's KPEX_PASSKEY_ attributes and the '(passkey)' title; a passkey made by another app may read as no passkey. Fine?
- Ente Auth's codes are not read by WorkspaceHQ at all, so the 2FA method per account is set by you in the side card (or inferred from the vault's own TOTP/passkey fields). Fine?

## Dishes

### Task 1: security-core (M): Security engine: parse-and-drop, flags, identities, the graph model

Serves: every later dish builds on these pure functions; the no-secret-survives rule is proven here first

**Files:**
- Create: `dashboard/security-core.mjs`
- Create: `dashboard/security-core.test.mjs`
- Create: `dashboard/__fixtures__/security-export.xml`

**Spec and interfaces:** PURE module dashboard/security-core.mjs (no fs, no network, no Electron; crypto from node:crypto only). Exports: (1) parseKeepassXml(xmlText) -> { entries: Array<{ uuid, group, title, username, password, url, notes, otp, attrKeys: string[], created, modified }> , error? } : a small tolerant parser for the KeePass 2 XML that `keepassxc-cli export --format xml` prints (Group/Name nesting, Entry/UUID, Entry/String Key+Value, Entry/Times CreationTime+LastModificationTime, skip History and the Recycle Bin group). Values are unescaped XML entities. It must not throw on a malformed document: it returns { entries: [], error: 'unreadable export' }. (2) reduceEntries(entries, { now, reuseKey }) -> { accounts, identities, hashes } where accounts = Array<{ id, title, host, group, created, modified, totp: boolean, passkey: boolean, strength: 'weak'|'fair'|'strong'|'empty', reuseGroup: number|null, old: boolean }> ; id = 'k-' + first 12 hex of sha256(uuid) (sticky across refreshes and renames); host = URL hostname lower-cased (no path, no query; null when no URL); totp = otp field non-empty or an attribute key 'otp'/'TOTP Seed'; passkey = any attribute key starting 'KPEX_PASSKEY_' or a title ending '(passkey)'; strength from estimateStrength; reuseGroup = small integer shared by entries whose HMAC-SHA256(reuseKey, password) match (null when unique or empty), renumbered 1..n per refresh; old = modified older than 365 days. identities = Array<{ ref, kind: 'email'|'phone', value }> found in usernames (email regex, or phone: 8-15 digits after stripping spaces, dashes, parens and a leading +), ref = 'i-' + 12 hex of sha256(lower-cased value); each account carries identityRef or null. hashes = Map<accountId, sha1HexUpper> for the breach check, which lives only in memory. reduceEntries never returns password, notes, otp, username or the URL path; a test proves it. (3) estimateStrength(password) -> { bits, label }: charset-size x length entropy with penalties (repeats, sequences like abc/123/qwerty, a year 1900-2099, a word from a 200-entry built-in common list); label weak < 50 bits, fair < 80, strong >= 80, 'empty' for ''. (4) breachMatch(sha1Upper, rangeBody) -> boolean: rangeBody is the HIBP range text 'SUFFIX:COUNT' lines, padded lines have count 0 and never match. (5) buildGraph({ accounts, identities, owner }) -> { nodes: Array<{ id, kind: 'identity'|'account'|'manual', label, degree, flags: string[] }>, edges: Array<{ a, b, kind: 'uses'|'signs-in-with'|'recovers' }> } merging owner edits (owner.accounts[id].signInWith, .recoveryRef, .archived, .hiddenFromClaude, .twofa; owner.manual[]). Flags per account: 'weak','reused','breached','no2fa' (twofa 'none' or unknown with no totp/passkey),'old','not-in-vault' (manual, or an owner edit whose id is not in the latest refresh). (6) snapshotOf(map, owner, now) -> { at, accounts, identities, flags: { weak, reused, breached, no2fa, old, notInVault } } numbers only. (7) assertNoSecrets(value, secrets: string[]) -> void throws if any secret string (length >= 4) appears anywhere in JSON.stringify(value).

- [ ] **Step 1: Write the failing tests**
  - parseKeepassXml reads the invented fixture: 6 entries, nested groups as 'Root/Web/Shops', History entries and the Recycle Bin group skipped, &amp; and &lt; unescaped
  - parseKeepassXml on '<KeePassFile><Root>' (truncated) and on '' returns { entries: [], error: 'unreadable export' } without throwing
  - reduceEntries output passes assertNoSecrets against every password, notes, otp and username string in the fixture (the parse-and-drop proof)
  - reduceEntries: two entries sharing a password get the same reuseGroup, a unique one gets null, an empty password gets strength 'empty' and reuseGroup null
  - reduceEntries: account id stays the same when the fixture entry is renamed (id from UUID)
  - reduceEntries: 'owner@example.test' becomes an email identity, '+1 (555) 010-0199' a phone identity, 'plainname' none; identityRef set accordingly
  - reduceEntries: an attribute 'KPEX_PASSKEY_PrivateKeyPEM' sets passkey true; an otp value sets totp true
  - estimateStrength: 'password1' weak, 'Summer2024!' weak (year + common word), a 20-char random mixed string strong, '' empty
  - breachMatch: a suffix present with count 3 -> true; present with count 0 (padding) -> false; absent -> false; lower-case input normalised
  - buildGraph: identity degree counts its accounts; owner signInWith adds a 'signs-in-with' edge; an owner edit for an id missing from accounts yields a 'not-in-vault' node instead of being dropped
  - snapshotOf returns numbers only (every leaf a number or the ISO at string)
- [ ] **Step 2: Run them by file and see them fail** (`node --test <the dish's test files>`)
- [ ] **Step 3: Implement the new files to the interfaces above** (`node --check` every file)
- [ ] **Step 4: Run the dish's tests by file: all green**
- [ ] **Step 5: Pass: apply the shared edits, contract rows already landed, goldens attributed, gates alone on the tree**
- [ ] **Step 6: Commit by explicit path** (`fe:` code, `meta:` the HANDOFF dish-done entry)

### Task 2: security-vault (L): Vault reader and store: keepassxc-cli on stdin, breach check, safeStorage, exports and conflicts

Serves: the owner presses Refresh and the map fills without a secret ever touching disk

**Files:**
- Create: `dashboard/security-store.js`
- Create: `dashboard/security-store.test.mjs`
- Create: `dashboard/security-vault.js`
- Create: `dashboard/security-vault.test.mjs`
- Create: `dashboard/security.js`
- Create: `dashboard/security.test.mjs`
- Create: `dashboard/__fixtures__/fake-keepassxc-cli.mjs`
- Modify (Pass): dashboard/main.js: ONE init line in the same block as delivery/day-ribbon: require('./security').init({ ipcMain, dataDir: DATA, safeStorage, shell, clipboard, appLog, useMark: useLogApi.mark }) (add safeStorage/clipboard to the existing electron destructure only if absent)
- Modify (Pass): dashboard/preload.js: a security group: read, refresh(passphrase, checkBreaches), settings(patch), edit(id, patch), addManual(o), addIdentity(o), walkthrough(stepId, done), scanExports, trashExport(name, dir), copy(text) -> ipcRenderer.invoke('hq:security:*')
- Modify (Pass): .gitignore: data/security/ (already announced in the opening meta commit; this dish only checks it is there)

**Spec and interfaces:** Main-side CommonJS, NEW files only. dashboard/security-store.js: create({ dataDir, crypto: { encrypt(str)->string|null, decrypt(str)->string|null } }) owning data/security/ (gitignored): settings.json { v:1, vaultPath: string|null, keyFilePath: string|null, cliPath: string|null, walkthrough: { [stepId]: { done: boolean, at } } }; map.json { v:1, refreshedAt, accounts (reduceEntries accounts plus breached: boolean|null), identities: Array<{ ref, kind, label: 'enc:<base64>'|null }> }; owner.json { v:1, accounts: { [id]: { signInWith?, recoveryRef?, twofa?: 'ente'|'sms'|'passkey'|'none'|'unknown', hiddenFromClaude?: boolean, archived?: boolean } }, manual: Array<{ id: 'm-<12hex>', title, host }>, identities: Array<{ ref, kind, label: 'enc:...' }> }; snapshots.jsonl (snapshotOf lines, keep the last 400); status.json { v:1, refreshedAt, counts: snapshot flags + accounts + identities, exportsFound: number, conflicts: number, email2faDone: boolean } numbers and booleans only (the Brief reads this, never map.json). Writes are atomic (tmp + rename, the app's existing idiom). Labels go through crypto.encrypt; when it returns null (safeStorage unavailable) the label is stored as null and the UI says 'locked', NEVER plaintext. editAccount(id, patch) accepts only the owner.json keys above (anything else refused), addManual({ title, host }), addIdentity({ kind, value }), setWalkthrough(stepId, done), setSettings(patch) (paths must be absolute; vaultPath must end .kdbx). dashboard/security-vault.js: create({ store, core (the security-core module), spawn, findCli, fetchRange, now, randomBytes }) with refresh({ passphrase, checkBreaches }) -> { ok, accounts, breachChecked, notes[] } | { error }: refuse when passphrase is empty, longer than 1024 or contains \r or \n; refuse when no vaultPath or the file is missing; spawn the cli with args ['export', '--format', 'xml', '-q', vaultPath] plus ['--key-file', keyFilePath] when set, shell:false, windowsHide, env WITHOUT any secret, write passphrase + '\n' to stdin and end it; collect stdout in memory (cap 64 MB, timeout 60 s; over either -> kill, error); never pipe stdout or stderr to a file or log; a non-zero exit maps to fixed words ('wrong passphrase or key file' when stderr mentions invalid credentials, else 'KeePassXC could not open the vault') and stderr is not stored; parse -> reduce (reuseKey = randomBytes(32), dropped after) -> when checkBreaches, unique sha1 prefixes (5 hex) fetched with concurrency 4 through fetchRange(prefix) (header Add-Padding: true, a generic User-Agent 'WorkspaceHQ', 10 s timeout); a failed prefix makes those accounts breached:null and adds the note 'breach check incomplete'; then store map + snapshot + status; every local string holding the export or passwords is released (set to null) before returning; nothing about the passphrase is logged anywhere (the handler never passes its args to appLog). findCli(): HQ_KEEPASSXC_CLI env (tests) -> cliPath setting -> 'keepassxc-cli.exe' on PATH -> %ProgramFiles%\KeePassXC\keepassxc-cli.exe; null when absent. scanExports({ dirs }) -> Array<{ name, dir, size, mtime }>: TOP LEVEL ONLY of Downloads, Desktop and Documents, by file NAME only (never reads contents), names matching /pass(word)?s?|credential|bitwarden_export|1password|keepass.*\.(csv|xml)|ente.?auth|authenticator.*export/i with ext .csv .json .txt .html .xml .1pux, excluding .kdbx. scanConflicts(vaultPath) -> count of '<basename>.sync-conflict-*.kdbx' in the vault's own folder. trashExport(name, dir) -> moves one listed file to the Recycle Bin through the injected trash (shell.trashItem), only if it is in the latest scan list; day-log line with the file name only. dashboard/security.js: init({ ipcMain, dataDir, safeStorage, shell, clipboard, appLog, useMark }) wiring IPC (below), scanExports + scanConflicts 60 s after start and every 6 h (cheap readdir, updates status.json), copy-to-clipboard with a 30 s clear only when the clipboard still holds the same text. Refresh is NEVER at boot, never on a timer, never from MCP, Bridge or a session.

**IPC (contract rows first):**
- `hq:security:read` -> { settings (paths shown), map (accounts, identities with decrypted labels or null), owner, snapshots (last 400), status, cliFound: boolean, vaultExists: boolean }
- `hq:security:refresh` { passphrase, checkBreaches } -> { ok, accounts, breachChecked, notes } | { error } (main window sender only: refuse when event.sender is not the main window's webContents)
- `hq:security:settings` { vaultPath?, keyFilePath?, cliPath? } -> { ok } | { error }
- `hq:security:edit` { id, patch } -> { ok } | { error }
- `hq:security:add-manual` { title, host } -> { ok, id }
- `hq:security:add-identity` { kind, value } -> { ok, ref }
- `hq:security:walkthrough` { stepId, done } -> { ok }
- `hq:security:scan-exports` -> { files: [{ name, dir, size, mtime }] }
- `hq:security:trash-export` { name, dir } -> { ok } | { error }
- `hq:security:copy` { text } -> { ok } (clipboard, cleared after 30 s if unchanged)

- [ ] **Step 1: Write the failing tests**
  - refresh with the fake cli (HQ_KEEPASSXC_CLI = node fake-keepassxc-cli.mjs printing the core fixture when stdin is the invented passphrase 'correct horse example', exit 1 with 'Invalid credentials' otherwise): map.json written, and assertNoSecrets over every file under the temp data/security/ against the fixture's passwords, notes, otp values AND the passphrase
  - the fake cli asserts the passphrase arrived on stdin and NOT in argv or env (it exits 3 if process.argv or process.env contains it); refresh succeeds
  - wrong passphrase -> { error: 'wrong passphrase or key file' }, the previous map.json is untouched byte for byte
  - passphrase containing \n, empty, or 1025 chars -> refused before spawn (spawn spy never called)
  - missing vault file -> error naming 'vault file not found' with no spawn; cli absent -> 'KeePassXC is not installed'
  - stdout over 64 MB or 60 s -> child killed, error, nothing written
  - checkBreaches with a fake fetchRange: matching suffix -> breached true; padded count 0 -> false; one prefix rejecting -> those accounts breached null and note 'breach check incomplete'; never more than 4 in flight; each prefix fetched once
  - checkBreaches false -> fetchRange never called, breached null everywhere
  - store: crypto.encrypt returning null -> identity label stored as null, the plaintext appears nowhere in data/security/
  - store: editAccount refuses an unknown key ('note'), accepts hiddenFromClaude; owner edits survive a refresh that renamed the entry
  - scanExports on a temp tree: top-level 'Chrome Passwords.csv' found, 'sub/Chrome Passwords.csv' not, 'vault.kdbx' not, contents never opened (fs.open spy)
  - scanConflicts counts 'vault.sync-conflict-20261111-101010-ABCDEFG.kdbx' next to 'vault.kdbx'
  - trashExport refuses a name not in the last scan; calls trash once for a listed file
  - copy: clipboard cleared after 30 s with fake timers when unchanged, left alone when the owner copied something else
  - snapshots.jsonl keeps the last 400 lines
  - security.init: hq:security:refresh invoked from a webContents that is not the main window -> { error } and the vault spawn spy is never called; appLog spy never receives the passphrase on success or failure
- [ ] **Step 2: Run them by file and see them fail** (`node --test <the dish's test files>`)
- [ ] **Step 3: Implement the new files to the interfaces above** (`node --check` every file)
- [ ] **Step 4: Run the dish's tests by file: all green**
- [ ] **Step 5: Pass: apply the shared edits, contract rows already landed, goldens attributed, gates alone on the tree**
- [ ] **Step 6: Commit by explicit path** (`fe:` code, `meta:` the HANDOFF dish-done entry)

### Task 3: security-space (L): The Security space: footprint map, health, setup walkthrough, generator

Serves: the owner sees every account and access point as bubbles and nodes, growing over time, and what to fix

**Files:**
- Create: `dashboard-v5/src/logic/security.js`
- Create: `dashboard-v5/src/logic/security-graph.mjs`
- Create: `dashboard-v5/src/logic/security-graph.test.mjs`
- Create: `dashboard-v5/src/logic/security-generate.mjs`
- Create: `dashboard-v5/src/logic/security-generate.test.mjs`
- Create: `dashboard-v5/src/logic/security-words.mjs`
- Create: `dashboard-v5/src/vals/security.js`
- Create: `dashboard-v5/src/vals/security.test.mjs`
- Create: `dashboard-v5/src/tpl/security.tpl.js`
- Create: `dashboard-v5/src/live/security-slice.mjs`
- Create: `dashboard-v5/src/live/security-slice.test.mjs`
- Create: `dashboard-v5/src/selftest-security.mjs`
- Create: `dashboard-v5/tools/cdp-security.mjs`
- Create: `dashboard-v5/tools/cdp-security.test.mjs`
- Modify (Pass): dashboard-v5/src/live/catalog.mjs: NAV entry after cosmos + SUBS row
- Modify (Pass): dashboard/cast-modes.js: SPACES and SUBS rows in lockstep (quick-targets-parity.test.mjs green unchanged)
- Modify (Pass): dashboard-v5/src/app.js: import the logic mixin, default sub security:'map', arrival hook secArrive() like cosArrive (lines near the cosmos ones), logic list entry
- Modify (Pass): dashboard-v5/src/app.tpl.js: import + join tpl/security.tpl.js
- Modify (Pass): dashboard-v5/src/vals/index.js + vals/ctx.js: securityVals and the security flag
- Modify (Pass): dashboard-v5/src/live/store.js: the security slice like cosmos-slice (read on arrival, never at boot)
- Modify (Pass): dashboard-v5/src/selftest.js: runner entry for selftest-security.mjs states (empty, no cli, map with flags, breach not checked, locked labels, unlock dialog, error, walkthrough half done, generator)
- Modify (Pass): dashboard-v5/tools/fake-preload.js: security rows with INVENTED accounts only (example.test, acme.test, alpha-site.test; identities owner@example.test) and a refresh that answers ok for 'correct horse example' and the error otherwise
- Modify (Pass): dashboard-v5/tools/cdp-gate.mjs: import and register makeSecurityScenarios, scenario names in the list
- Modify (Pass): dashboard/use-log.js SURFACES + 'security', 'security-refresh'; use-log.test.mjs pinned array and the line count = SURFACES.length x ACTIONS.length
- Modify (Pass): tpl.hash.test.mjs and vals.golden.test.mjs: re-record ONLY for the new sec keys and the new fragment (attributed with dashboard-v5/tools/golden-diff.mjs; TABS gains 'security'); any other moved path is a bug

**Spec and interfaces:** Renderer, v5 idiom (dc-lite templates, sec-prefixed vals keys, logic mixin, live slice read on arrival never at boot). NAV gains { id: 'security', label: 'Security', glyph: a single non-emoji symbol } as the 11th destination (no number key; keys 0-9 unchanged); SUBS security: [['map','Map'],['health','Health'],['setup','Setup'],['generate','Generator']]; cast-modes.js SPACES/SUBS in lockstep so quick-targets-parity stays green and Ctrl+Alt+X can jump there. MAP: logic/security-graph.mjs PURE layoutGraph({ nodes, edges }, { width, height, iterations = 300 }) -> { nodes: [{ id, x, y, r }], edges: [{ a, b, kind }] }: deterministic force layout (seed positions from a hash of the id, never Math.random), r = 8 + 4*sqrt(degree), clamped inside the box, at most 600 nodes (beyond: the smallest-degree accounts fold into one '+N more' node per identity); SVG fragment with identities as large bubbles, accounts as small ones, edge styles per kind, flag dots on accounts, archived accounts faded; click -> side card (title, host, flags in words, 2FA method select, sign-in-with select, recovery select, hide-from-Claude switch, archive) writing through hq:security:edit; 'Add account' and 'Add identity' forms. GROWTH: a numbers-only growth line from snapshots and a time slider that shows only accounts created on or before the slider date (manual accounts count from when they were added). HEALTH: flag counts with one 'what to do' line each, the list of flagged accounts, breached shown as 'not checked' when null (never as safe), the export-file list with a per-file 'Move to Recycle Bin' button, and conflict copies with the words 'Syncthing made a conflict copy: open both in KeePassXC and merge (Database > Merge)'. SETUP: the walkthrough in this fixed order: email-2fa (owner tick), install-keepassxc (app: cliFound), create-vault (app: vault path set and exists; a path field + Browse through the existing open-dialog idiom if one exists, else a text field), emergency-sheet (owner tick; a printable page with BLANK lines only, never data), import-browser (owner tick; the app shows 'no plain export left' from the scan), phone-keepassdx (owner), syncthing (owner tick; app shows conflict count), ente-auth (owner), import-authenticator (owner), first-refresh (app: refreshedAt set); app-checked steps say what they checked, owner-ticked ones say 'you ticked this'. UNLOCK: the Refresh button opens a dialog in the main window with a password input (autocomplete off, spellcheck off), a 'check breaches online (Have I Been Pwned, 5 hash characters leave the PC)' checkbox default on, and Refresh; the input value is cleared in the same tick the invoke is sent and on cancel/close; errors are shown in words; the dialog never appears in satellites. GENERATOR: logic/security-generate.mjs PURE generate({ kind: 'chars'|'words', length, sets: { lower, upper, digits, symbols } }, randomInt) with randomInt from crypto.getRandomValues and rejection sampling (no modulo bias); words from a built-in list of at least 1024 short common English words (src/logic/security-words.mjs, invented list, no duplicates), default 7 words joined by '-'; chars default 20 with all sets; shows estimated bits; Copy goes through hq:security:copy. Use marks 'security' (open) and 'security-refresh'.

- [ ] **Step 1: Write the failing tests**
  - layoutGraph is deterministic: same input twice -> identical coordinates; every node inside [r, width-r] x [r, height-r]
  - layoutGraph with 900 account nodes on 3 identities returns at most 600 nodes and one '+N more' node per identity whose N adds up
  - generate words: 7 words from the list joined by '-', bits = 7 * log2(list length); chars: length 20 contains at least one of each enabled set; rejection sampling: randomInt is called with a bound and never uses %
  - security-words.mjs has >= 1024 unique lower-case words of 3-8 letters
  - vals/security: breached null renders 'not checked', never 'safe' or 'none'; a locked identity renders 'locked - refresh to restore'
  - security-slice reads nothing at boot (spy) and once per arrival
  - honesty.test.mjs stays green (no 'safe', 'secure' or 'protected' claims in sec copy without a source)
- [ ] **Step 2: Run them by file and see them fail** (`node --test <the dish's test files>`)
- [ ] **Step 3: Implement the new files to the interfaces above** (`node --check` every file)
- [ ] **Step 4: Run the dish's tests by file: all green**
- [ ] **Step 5: Pass: apply the shared edits, contract rows already landed, goldens attributed, gates alone on the tree, cdp scenarios security-map-render, security-node-edit, security-unlock-clears, security-health, security-setup, security-generate**
- [ ] **Step 6: Commit by explicit path** (`fe:` code, `meta:` the HANDOFF dish-done entry)

### Task 4: security-doors (S): Doors: hq_footprint for Claude (names only), counts-only Brief senses, the Reach row

Serves: Claude can help with the footprint without ever seeing a secret, and the Brief says when something needs the owner

**Files:**
- Create: `mcp/workspacehq/footprint-read.mjs`
- Create: `mcp/workspacehq/footprint-read.test.mjs`
- Create: `dashboard/brief-security.mjs`
- Create: `dashboard/brief-security.test.mjs`
- Modify (Pass): mcp/workspacehq/server.mjs, guard.mjs, guard.test.mjs, server.test.mjs, README.md: hq_footprint, all in one commit
- Modify (Pass): dashboard/brief-sources.js: out.security from data/security/status.json
- Modify (Pass): dashboard/brief-core.mjs: the six rule ids + Object.assign of BRIEF_SECURITY_FNS (brief-core goldens: only the new rules may appear, attributed)
- Modify (Pass): dashboard/brief-project.mjs: six WORDING rows
- Modify (Pass): dashboard/reach.js + reach.test.mjs + dashboard-v5/src/vals/reach.js: the breach-check row

**Spec and interfaces:** mcp/workspacehq/footprint-read.mjs: read(dataDir, { q?, flag?, limit = 20 }) reads data/security/map.json + owner.json (never settings.json, never snapshots for paths) and returns { refreshedAt, rows: Array<{ name: title, host, flags: string[], twofa, archived }>, hiddenCount, total, note } with at most 50 rows; hiddenFromClaude accounts are only counted in hiddenCount; identities, labels, usernames, groups, ids and the vault path NEVER appear; q matches title/host case-insensitively (max 100 chars), flag one of weak|reused|breached|no2fa|old|not-in-vault; missing map -> { error: 'the Security map has not been refreshed yet - open WorkspaceHQ > Security' }. server.mjs registers hq_footprint (description says names and flags only); guard.mjs TOOL_TIERS hq_footprint: 'read'; guard.test.mjs read-tier list; README row; server.test.mjs copies footprint-read.mjs into its temp root and pins tier + a seeded answer. dashboard/brief-security.mjs (separate-module pattern like brief-session-waiting.mjs): rules 'plain-export-found' (high, from status.exportsFound > 0, action go('security','health')), 'vault-conflict' (high, status.conflicts > 0), 'accounts-breached' (med, counts.breached > 0), 'passwords-reused' (low, counts.reused > 0), 'footprint-stale' (low, refreshedAt older than 30 days, only when a refresh has happened once), 'email-2fa-first' (low, walkthrough started and email2faDone false); reads ONLY status.json (brief-sources.js gains out.security = sidecar(data/security/status.json)); brief-core RULES + RULE_FNS registration; brief-project.mjs WORDING rows with counts only (e.g. 'A plain password export is sitting in a folder' / '{n} plain password exports are sitting in folders'); no site names anywhere off the main window. dashboard/reach.js: a 'breach-check' row { who: 'owner', ok: null until a refresh with checkBreaches ran, detail 'Have I Been Pwned range check: only when you press Refresh; 5 hash characters leave the PC' }; reach.test.mjs rows.length 5 -> 6 in its three places; vals/reach.js label 'Breach check'.

- [ ] **Step 1: Write the failing tests**
  - footprint-read: a hiddenFromClaude account never appears in rows (name or host) and is counted in hiddenCount
  - footprint-read: JSON of every answer over the seeded fixture contains no identity value, label, username, group, account id or vault path (assertNoSecrets-style scan)
  - footprint-read: flag filter 'breached' returns only breached rows; q of 101 chars refused; no map -> the error words
  - brief-security: exportsFound 1 -> one high 'plain-export-found' item with no file name in text/why; conflicts 0 and counts all 0 -> no items
  - brief-security: footprint-stale only after a first refresh and only past 30 days
  - brief-project: every new rule id has a WORDING row; projected text has no host or title from the fixture
  - reach: breach-check row present, ok null before any checked refresh
- [ ] **Step 2: Run them by file and see them fail** (`node --test <the dish's test files>`)
- [ ] **Step 3: Implement the new files to the interfaces above** (`node --check` every file)
- [ ] **Step 4: Run the dish's tests by file: all green**
- [ ] **Step 5: Pass: apply the shared edits, contract rows already landed, goldens attributed, gates alone on the tree**
- [ ] **Step 6: Commit by explicit path** (`fe:` code, `meta:` the HANDOFF dish-done entry)

