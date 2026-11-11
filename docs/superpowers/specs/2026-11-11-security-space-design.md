# Security space — design (2026-11-11)

Status: DRAFT, awaiting the owner's approval. Lane: frontend (`dashboard/`, `dashboard-v5/`, `mcp/workspacehq/`), with contract rows in `docs/sync/CONTRACT.md` / `IPC-CONTRACT.md` first.

## Intent

The owner forgets passwords and secrets and loses track of accounts and access points. They want one setup where the **phone unlocks everything** (fingerprint), passwords and 2FA codes are reachable on PC and phone, and a **map of their whole digital footprint** — accounts as bubbles and nodes, growing over time — so no account or access point is ever lost again. Two goals, equal weight: **security** and **enumeration**.

The owner said plainly they do not trust themselves to pick the secure way; the design below was chosen from researched options, and every choice that was the owner's is marked *(owner)*.

## The decided shape

Secrets do **not** live in WorkspaceHQ. A home-built vault would need its own sync, phone app and audited crypto; one mistake exposes every account. Instead:

| Job | Tool | Notes |
|---|---|---|
| Passwords, passkeys, generator, autofill | **KeePassXC** on the PC, **KeePassDX** on Android *(owner: fully offline; Android)* | One encrypted `.kdbx` file the owner owns. KeePassXC 2.7.7+ stores passkeys through KeePassXC-Browser; KeePassDX does fingerprint unlock, Android autofill, TOTP fields and passkeys. |
| Moving the file between PC and phone | **Syncthing**, device to device, no cloud *(owner)* | If both sides edit at once Syncthing leaves a `*.sync-conflict-*` copy: WorkspaceHQ must notice it. |
| 2FA codes | **Ente Auth**, synced end-to-end *(owner)* | Phone + Windows desktop; Ente only sees ciphertext; imports Google Authenticator's export QR. Kept separate from the password file on purpose (one stolen file ≠ both factors). |
| Unlock | **One memorised master passphrase** *(owner)* | KeePassXC/KeePassDX; fingerprint on the phone after first unlock; a printed emergency sheet. |
| The footprint map, health, breach check, setup walkthrough | **New WorkspaceHQ Security space** (this spec) | Holds account **names and flags only**, never a secret. |

The owner installs every tool themselves (Claude never installs or downloads).

## Goals

1. **Setup walkthrough** — a checklist page that turns the table above into steps and shows each step's real state where the app can see it: KeePassXC / `keepassxc-cli` present, a vault file path chosen, Syncthing conflict copies, Ente Auth installed, leftover plain exports. Steps the app cannot see are ticked by the owner and say so ("you ticked this").
   Order matters and is fixed: email account 2FA first (it recovers everything else), then the vault, the emergency sheet, imports, phone, Syncthing, Ente Auth.
2. **Imports, guided** — Chrome/Edge password CSV → KeePassXC's own CSV import (KeePassXC does the import, not WorkspaceHQ); Google Authenticator export QR → Ente Auth. After each, the app looks for the plain file (Downloads, Desktop, Documents top level; names like `*Passwords*.csv`, `*password*export*`) and offers to send it to the Recycle Bin — owner click per file, never automatic, never a permanent delete.
3. **Footprint map** — a graph:
   - **identities**: email addresses and phone numbers (the roots);
   - **accounts**: one node per site/app (from the vault's entry titles and URL hosts, plus manual adds);
   - **edges**: account → the identity it uses; account → its "Sign in with Google / Apple / GitHub / Microsoft" parent; account → its recovery identity;
   - **badges** per account: 2FA method (Ente / SMS / passkey / none / unknown), and the health flags below.
   Bubbles sized by how many accounts hang off them (an identity that recovers 40 accounts is big). Click a node → a side card with what the app knows and a "what to do" line. Manual add / edit / merge / archive ("closed this account") so lost and old accounts are enumerated too, not just what is in the vault.
4. **Growth over time** — each refresh appends a numbers-only snapshot (account count, identity count, flag counts); the map has a time slider / growth line so the owner sees the footprint grow and the flags shrink.
5. **Health flags**, computed in memory during a refresh: reused (same password on ≥2 entries), weak (local strength estimate), breached (Have I Been Pwned k-anonymity: only the first 5 hex characters of the SHA-1 leave the PC) *(owner: online check allowed)*, no 2FA recorded, old (unchanged > 1 year), in-map-not-in-vault (an account with no stored login), conflict copy present.
6. **Generator** — passphrase or character password, copied to the clipboard and the clipboard cleared after 30 s if it still holds it. Convenience only; KeePassXC's own generator stays the main one.
7. **Claude sees names, never secrets** *(owner)* — one read-only MCP tool (tier read) answering account names, URL hosts, flags and counts; never a password, TOTP secret, note, username, email or phone number. Each account has a **"hide from Claude"** switch *(owner)*: a hidden account reaches MCP only as part of a count. The Brief gets counts-only senses.

## How a refresh reads the vault (the delicate part)

- The owner presses **Refresh map** in the Security space and types the master passphrase into a field in the **main window only** (never a satellite, tray, Bridge or Ctrl+Alt+X).
- Main process runs the owner-installed `keepassxc-cli` (found on PATH or the KeePassXC install folder; refused if absent) with the vault path, passing the passphrase on **stdin** — never argv, never env, never a temp file. The renderer copy of the passphrase is cleared as soon as it is sent.
- Output is parsed **in memory**. Each password is reduced at once to: a strength score, a SHA-1 for the HIBP prefix call, and a reuse-group number (keyed hash with a per-refresh random key that is never stored). Then every secret string is dropped. TOTP and passkey fields are reduced to "present / absent".
- Persisted (gitignored `data/security/`): entry title, URL host, group path, created/modified dates, flag booleans, owner edits (identities, edges, 2FA method, archive state), snapshots. Usernames / emails are needed for identity edges: they are stored **encrypted at rest with Electron `safeStorage`** (Windows DPAPI) and shown only in the main window.
- A refresh is never automatic, never at boot, never triggered by Claude, a session or the Bridge.

## Brief senses (counts only, through `brief-project.mjs` rules)

- **High**: a plain password export file found on disk; a Syncthing conflict copy of the vault.
- **Normal**: N accounts breached / reused; the map has not been refreshed in 30 days; the walkthrough's first step (email 2FA) is not done.
- No site names, emails or counts of a specific site in any off-window text.

## Non-goals

- Storing, showing or autofilling any password, passkey or 2FA code in WorkspaceHQ.
- Generating TOTP codes (Ente Auth does it).
- Any sync, server or phone app of our own.
- Reading Chrome's / Edge's password store directly, or scraping email to discover accounts (a later idea, not this build).
- Changing passwords on sites for the owner.

## Anti-goals (a build that does any of these has failed even if it works)

- The passphrase, a password or a TOTP secret on disk, in a log, in argv/env, in `data/`, in a commit, in a crash dump the app writes, or in an IPC push.
- Claude, an MCP tool, the Brief, Ask, tray, Bridge or a launched session able to read a secret, a username or an email.
- WorkspaceHQ becoming a second vault the owner starts to rely on.
- Auto-deleting files; any delete that is not a Recycle-Bin move on the owner's click.

## Constraints

- Repo is PUBLIC: fixtures are invented (an invented `.kdbx` made by the tests, invented sites). Never the owner's file.
- New main-side code in NEW files (e.g. `dashboard/security*.js`, pure core `dashboard/security-core.mjs`); `main.js` gets one init line.
- Contract rows before code: `data/security/` shapes in CONTRACT, `hq:security:*` channels in IPC-CONTRACT, the MCP tool in the guard tiers.
- The one outbound call is HIBP's range API (`api.pwnedpasswords.com/range/<5 hex>`), owner-pressed, with padding on; it is listed in Settings › Reach.
- Gates: unit tests for the core, the parse-and-drop path (a test proves no secret string survives into anything persisted or pushed), selftest states, fake-preload rows, cdp scenarios, goldens attributed.

## My calls (owner to check)

- **Placement**: a new top-level "Security" space in the nav. The number keys 0–9 are all taken, so it gets no number key; reachable from the nav and from Ctrl+Alt+X "jump".
- **Ente Auth stays separate** from the vault (not KeePassDX TOTP fields) to keep the two factors apart, even though KeePassDX could hold codes.
- **Usernames/emails** are kept (encrypted with safeStorage) because the identity graph needs them; Claude gets none of them.
- **The graph renderer**: hand-rolled SVG force layout in the v5 template style (no new dependency, no build step).
- **Plain-export detection** scans only the top level of Downloads, Desktop and Documents, by file name, never contents.

- **One CLI call per refresh**: `keepassxc-cli export --format csv` to the child's stdout, read into memory in one pass (one key derivation, seconds, not minutes; `show` per entry would re-derive the key every time). Honest limit, written into the code comment and the walkthrough: JavaScript strings cannot be wiped, so "dropped" means every reference is released right after reduction and nothing is ever written; the child's stdout is never piped to a file or log.
- **Key file**: passphrase-only is the recommended vault setup; if the owner adds a key file, the Security settings take its *path* (passed as `--key-file`, never read by the app).
- **Vault path** is stored in gitignored `data/security/settings.json`, shown only in the main window, never in off-window text, the Brief or MCP.
- **Syncthing conflict scan** looks only in the vault file's own folder for `<name>.sync-conflict-*.kdbx`.
- **Identity links**: a username that looks like an email or phone number links automatically; the rest land in a "which identity?" queue the owner works through, with bulk assign by vault group.
- **safeStorage failure** (Windows reinstall, other user): owner edits are kept keyed by opaque ids; identities show as "locked — refresh to restore labels" until the next refresh re-reads them. Nothing is lost but the labels.
- **Plain-export removal** is `shell.trashItem` in main, main window only, one owner click per file, a day-log line with the file *name* only; it is not an MCP or Bridge action.

## Left to the builder

- Exact strength estimator (simple entropy + common-pattern penalties; no dictionary download).
- Graph layout details, colours, bubble sizing curve, the time-slider look.
- `keepassxc-cli` sub-command choice (`export --format csv` vs `ls`/`show`), as long as the parse-and-drop rule holds.
- The walkthrough's exact wording.
