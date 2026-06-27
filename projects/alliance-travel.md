---
id: alliance-travel
title: alliance travel
type: project-subnote
stack: [HTML, CSS, JavaScript, Cloudflare Pages]
completion: 50
level: 1
xp: 88
activity: active
last_commit: 2026-06-08
git_risk: low
security: medium
loc: 39011
files: 83
scan_id: 2026-06-09
tags: [workspacehq, product, static-site, travel, active]
---

# ✈️ alliance travel

> [!success] State — the healthiest product in the portfolio
> 🟢 **Active** (committed today) · 🟢 git risk **low** · 110 commits on a real remote. The only thing holding it at 50% is the missing enrichment pass, not the code. This is the reference for what "good" looks like in WorkspaceHQ.

## What it is
French-language marketing site for **Alliance Travel**, a travel agency in **Bordj Bou Arreridj (BBA), Algeria** (3 branches: BBA La Graf siège, BBA Cité Zehour, M'Sila). Six pages — a homepage hub + five guided-tour landing pages (Le Caire+Sharm, Sharm from Constantine, Istanbul, Azerbaïdjan, Kuala Lumpur). **No backend.** Conversion is a per-page price calculator (DZD) that pre-fills a `wa.me/213…` WhatsApp message, with email + clipboard fallbacks.

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried — pending enrichment) |
| XP / Level | 88 · L1 |
| Activity | 🟢 active · last commit **2026-06-08** (0 days) |
| Git | `github.com/Brvetr4ve1er/alliancetravel34` · branch **`refactor/trim-v26`** · 110 commits · 2 dirty |
| Code | 83 files · **39,011 LOC** · 3 TODO/FIXME |
| Build / Tests | unknown / none present |
| Security | 🟠 medium · 1 secret hit (likely false positive — no real backend keys) |

## Insights
- **Not on `main`.** The active branch is `refactor/trim-v26`. You said in a prior session you wanted a single clean `main`. Until that merge lands, the dashboard keeps reporting the trim branch.
- **Highest LOC of any static project** (39k) — heavy on per-tour assets/content, not logic.
- 2 dirty files: commit or stash to clear the small penalty.
- 1 "secret" is almost certainly the generic-assignment over-reporter (no server side here).

## 🚀 Start it up & preview
No build step. Serve the `site/` folder:

```bash
cd "C:\Users\ROG STRIX\Documents\alliance travel"

# Option A — Python, zero install
python -m http.server 5500 --directory site

# Option B — npx live-reload
npx serve site -p 5501 --no-clipboard
```
Open <http://localhost:5500/>.

### Deploy (Cloudflare Pages)
```bash
npx wrangler pages deploy site --project-name=alliance-travel --branch=main
```

## Next actions
1. Merge `refactor/trim-v26` → `main`, make `main` the single source of truth.
2. Commit the 2 dirty files.
3. Read `docs/HANDOFF.md` (master context), then `docs/DEPLOY.md` for the 30-min go-live.

🔙 [[_Projects Index]]
