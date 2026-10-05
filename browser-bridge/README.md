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

Pause anytime from the popup. Nothing is sent while paused.

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
  is still staged and unchanged. If it is, the extension sends it from your
  logged-in tab. If not, nothing is sent.
- **skip**: `POST /social/outbox/cancel` marks the post `canceled` in the app.
  Skipping never publishes anything.

The header shows **● connected** when the app answers on its endpoint. When it
doesn't, the popup shows *Not connected* and a **check again** button. The popup
follows your OS light/dark setting; it can't read the app's theme choice.

After updating these files, reload the extension at `chrome://extensions`
(click the circular-arrow icon on the card). Chrome doesn't pick up changes to
an unpacked extension on its own.

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
