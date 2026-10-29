# WorkspaceHQ Bridge (Chrome extension)

Sticks WorkspaceHQ to your browser the same way it's stuck to Obsidian: the
Electron app runs a tiny local sync hub, and this extension pushes **what you're
actually looking at** to it. WorkspaceHQ turns that into the **"Working On Now"**
insight on the BASE tab, and leaves a `data/browser-activity.json` artifact that
**Claude can read** for context on what you're building.

```
Chrome tab focus ──▶ background.js ──POST──▶ 127.0.0.1:47821/ingest (main.js)
                                                     │
                                                     ├─▶ data/browser-activity.json
                                                     ├─▶ live IPC ticker → dashboard card
                                                     └─▶ collector/assemble.mjs → latest.json.browser
```

## What it captures

The active tab's **host, page title, URL, and how long you focused it** — only
while a Chrome window is focused and you're not idle (60s idle stops the clock).
Sub-1.5s tab flickers are dropped. Everything stays **on your machine**: it's
POSTed to `127.0.0.1` only, and the app keeps a rolling 3-day window.

**Social feeds, mentions and metrics** (`social.js`). Every 5 minutes the
extension reads the social sites you are **already logged into in an open tab**
(the first open tab per site; no tab, nothing read). The read runs inside that
tab with the site's own session, so the extension never stores a password or
token. Per site:

| Site | What it reads |
|---|---|
| Bluesky | your timeline (author, text, link, like/repost/reply counts), mentions and replies, other notifications, follower/following/post counts |
| Mastodon (the instance you set in the popup) | the same as Bluesky |
| Reddit | your front-page feed (titles), inbox mentions/replies, karma |
| X | your home timeline, follower/following/post counts |
| LinkedIn | notifications |
| Instagram | notifications, follower/following/post counts |
| Threads | follower/post counts |
| Facebook | which account is logged in, nothing else |
| YouTube | notifications |

It also reports each logged-in account's handle and display name. All of it
goes to `127.0.0.1` only: the app keeps the posts and counts in
`data/social/inbox.json` (rolling 7-day window) and the accounts in
`data/social/accounts.json`, and Claude reads them through the MCP tools
(`hq_social_feed`, `hq_social_mentions`, `hq_social_metrics`, `hq_social_status`).

**It also publishes posts, but only ones you approved.** When you click
**approve & send** in the popup, the extension posts that exact text from your
logged-in tab (see *Social posts: approve or skip* below). Nothing is published
any other way. Posting works on Bluesky, Mastodon, Reddit, X and LinkedIn (no
LinkedIn replies yet). Threads and Facebook refuse until a request id is pasted
into `social.js`. Instagram and YouTube refuse: text-only posting isn't
supported there.

Pause anytime from the popup. While paused, no tab activity and no social
reads are sent. Pausing doesn't block a post you approve & send yourself.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right) on.
3. **Load unpacked** → select this `browser-bridge/` folder.
4. Make sure WorkspaceHQ (the Electron app) is running — it opens the ingest
   endpoint on `127.0.0.1:47821` at launch.
5. Click the extension icon: the dot goes green ("live") once the first flush
   lands. The BASE tab's "Working On Now" card fills in within a few seconds,
   and fully on the next scan (per-project attribution).

Works in Edge/Brave too (same folder, `edge://extensions`).

## Security

- Binds `127.0.0.1` only — never reachable off your machine.
- `POST /ingest` requires the `X-HQ-Bridge` header; a malicious web page can't
  send a custom header without a CORS preflight, and the app only approves
  preflight for extension origins — so random pages are blocked, the extension
  (with host-permission) gets through.
- **Optional lockdown:** drop a secret into `data/.bridge-token`, restart the
  app, and paste the same value into the popup's Settings → Token. The endpoint
  then also requires `X-HQ-Token`.

## Social posts: approve or skip

Claude can *stage* a social post (MCP `hq_social_post` / `hq_social_reply`), but
it can't publish one. The popup shows staged posts one at a time ("awaiting
approval · 1 of N") with the full payload, its character and link count, and two
buttons:

- **approve & send**: the extension first asks the app whether that exact post
  is still staged and unchanged, and checks that a logged-in tab for the platform
  is open. Then it **claims** the post on the app (`POST /social/outbox/claim`,
  status `staged → sending`, guarded by a hash of the text you saw). Only after
  the claim succeeds does it send from your logged-in tab, and then it reports
  the outcome (`sent` or `failed`). If the claim is refused (the post was
  skipped, changed or is already being sent, or the app is too old or not
  answering), nothing is sent.
- **skip**: `POST /social/outbox/cancel` marks the post `canceled` in the app.
  Skipping never publishes anything. A post that is already claimed for sending
  can't be skipped (the app answers *already publishing*), so a skip can't race
  a send that has already started.

**A post stuck on `sending`.** If the extension dies mid-send, or the app is
down when the result comes back, the post stays `sending`: it's off the card, and
nobody can skip or claim it. After **10 minutes** you can put it back on the card
by hand, from PowerShell on this PC:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:47821/social/outbox/release `
  -Headers @{ 'X-HQ-Bridge' = '1' } -ContentType 'application/json' -Body '{"id":"<outbox id>"}'
```

(Add `'X-HQ-Token' = '<value of data/.bridge-token>'` to the headers if you set
a token. MCP `hq_social_outbox` shows the id and `claimed_at`.) A release only
returns the post to `staged`. You still have to approve & send it again, and
nothing ever releases on its own. **Check the platform first:** the stuck send
may have gone out, and approving a live post again posts it twice.

The header shows **● connected** when the app answers on its endpoint. When it
doesn't, the popup shows *Not connected* and a **check again** button. The popup
follows your OS light/dark setting; it can't read the app's theme choice.

After updating these files, reload the extension at `chrome://extensions`
(click the circular-arrow icon on the card). Chrome doesn't pick up changes to
an unpacked extension on its own. The claim step needs extension **0.3.0** and a
restarted app. Until you reload, 0.2.0 keeps sending without claiming, and the app
still records its results. A 0.3.0 extension talking to an app that hasn't been
restarted refuses to send and asks you to restart workspace-hq.

## claude.ai live sync (0.6.0, optional)

Off by default. Press **Sync claude.ai** in the popup: Chrome asks once to allow `https://claude.ai/*` (an optional
permission), then the extension reads YOUR claude.ai chats with claude.ai's own page requests — read-only `GET`s, at most
one every 2 s, only while a claude.ai tab is open and you are logged in — and posts them to WorkspaceHQ on this PC
(`POST /claude/sync`). Every 5 minutes it fetches up to 20 changed chats (newest first), so a long history arrives over
a few runs; the popup shows the last sync time and status. It never writes to claude.ai. These requests are not a public
API: on HTTP 429/5xx it backs off; when a response looks different it **pauses** ("claude.ai changed, sync paused") until
you press Sync again. A chat over 4 MB is skipped and counted. Only the first claude.ai organization is synced. Untick
**on** to stop.

History: added in 0.4.0, removed in 0.5.0 (2026-10-28, with the app's importers), back in 0.6.0 (2026-10-29) without the
ZIP export import. Reload the extension at `chrome://extensions` after updating; the app needs a restart for the
`/claude/*` routes.

## How Claude uses it

Two complementary paths:

1. **Live UI control** — the *Claude in Chrome* extension already lets Claude see
   and drive your browser UI (read the page, click, fill, screenshot). That's the
   "give Claude access to my browser" half, and it's separate from this bridge.
2. **Passive work context** — this bridge writes `data/browser-activity.json`
   (top domains, per-project focus, current tab). Point Claude at that file when
   you want it to know *what you've been working on* without narrating it:
   > "Read data/browser-activity.json — what have I been focused on today, and
   > which project should I pick back up?"

The two together: Claude can both *observe* your session (bridge artifact) and
*act* in the browser (Claude in Chrome).
