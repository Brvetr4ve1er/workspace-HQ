---
id: crucix
title: Crucix
type: project-subnote
stack: [Node, Express, OSINT]
completion: 50
level: 1
xp: 79
activity: dormant
last_commit: 2026-03-28
git_risk: low
security: medium
loc: 11974
files: 67
scan_id: 2026-06-09
tags: [workspacehq, product, node, osint, dormant]
---

# 🕵️ Crucix

> [!info] State — solid bones, gone quiet
> 💤 **Dormant 71 days** (last commit 2026-03-28) · 🟢 git risk **low** · 111 commits, clean-ish tree. Well-versioned but untouched since late March. No code rot, just neglect.

## What it is
Node/Express **OSINT briefing** engine. Generates intelligence briefings on a schedule (`sweep`/`brief` scripts), synthesizes + injects ideas into a dashboard, and keeps a delta memory store. Multilingual (`lib/i18n.mjs`). Ships a `Dockerfile`.

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried) |
| XP / Level | 79 · L1 |
| Activity | 💤 dormant · last commit **2026-03-28** (71 days) |
| Git | `github.com/calesthio/Crucix` · branch **master** · 111 commits · 1 dirty |
| Code | 67 files · **11,974 LOC** · 0 TODO |
| Build / Tests | unknown / none present |
| Security | 🟠 medium · **4 secret hits** — likely real OSINT/LLM API keys in `.env` |

## Insights
- **4 secret hits + a `.env` loader** (`apis/utils/env.mjs` runs first). These are probably live API keys for the briefing providers — verify `.env` is git-ignored before any push.
- Default port **3117** (`crucix.config.mjs`, overridable via `PORT`).
- Clean architecture: `apis/`, `dashboard/`, `lib/delta` memory manager. Dockerized → easy to revive.

## 🚀 Start it up & preview
```bash
cd "C:\Users\ROG STRIX\Documents\Crucix"
npm install
# create/verify .env (provider API keys) — the server loads it on boot
npm start                 # node server.mjs  → http://localhost:3117
# or
npm run dev               # node --trace-warnings server.mjs
```
Useful scripts: `npm run brief` (generate a briefing), `npm run sweep`, `npm run fresh-start` (clean + start), `npm run diag`.

### Docker
```bash
docker build -t crucix . && docker run -p 3117:3117 --env-file .env crucix
```

## Next actions
1. Confirm `.env` is ignored; rotate keys if it was ever committed.
2. `npm install && npm run diag` to confirm it still boots after 71 days.
3. Commit the 1 dirty file to clear the tree.

🔙 [[_Projects Index]]
