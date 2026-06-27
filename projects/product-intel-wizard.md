---
id: product-intel-wizard
title: product-intel-wizard
type: project-subnote
stack: [React, Vite, tambo]
completion: 50
level: 1
xp: 78
activity: dormant
last_commit: 2026-02-16
git_risk: low
security: medium
loc: 217361
files: 1267
scan_id: 2026-06-09
tags: [workspacehq, product, react, vite, tambo, dormant, monorepo]
---

# 🪄 product-intel-wizard

> [!warning] State — dormant, and the LOC is misleading
> 💤 **Dormant 112 days** (last commit 2026-02-16) · 🟢 git risk **low**. Reports **217k LOC across 1,267 files**, but that's because the **vendored `tambo/` monorepo** is counted as project code. Your actual app is the small `dashboard/`. Also **24 secret hits** — almost all inside the vendored monorepo.

## What it is
A React + Vite product-intelligence dashboard built on **tambo** (`@tambo-ai/react`) — natural-language UI generation with `zod` schemas. Lives under `ALLIANCE PWA PROTOTYPE/product-intel-wizard/` with **two package.json**:
- `dashboard/` — **your app** (Vite, React, `@tambo-ai/react`, zod)
- `tambo/` — the **full tambo monorepo** vendored in (turbo-managed, SDK + cloud + showcase + docs)

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried) |
| XP / Level | 78 · L1 |
| Activity | 💤 dormant · last commit **2026-02-16** (112 days) |
| Git | `github.com/Brvetr4ve1er/product-intel-wizard` · branch **main** · 6 commits · 2 dirty |
| Code | 1,267 files · **217,361 LOC** · **41 TODO** |
| Build / Tests | unknown / none |
| Security | 🟠 medium · **24 secret hits** (mostly vendored tambo — audit, likely false positives) |

## Insights
- **Vendoring the whole tambo monorepo skews every metric** — LOC, file count, TODOs (41), and the 24 secret hits. Consider replacing the vendored `tambo/` with the published npm SDK so the scan reflects *your* code.
- Most dormant project (112 days). 6 commits total.
- Before any push: scan the **24 secret hits** — if any live in `dashboard/` (not `tambo/`), treat as real and rotate.

## 🚀 Start it up & preview
**Your dashboard app (this is what you want 95% of the time):**
```bash
cd "C:\Users\ROG STRIX\Documents\ALLIANCE PWA PROTOTYPE\product-intel-wizard\dashboard"
npm install
npm run dev          # vite → http://localhost:5173
npm run build        # tsc -b && vite build
npm run preview      # preview the production build
```
Needs a tambo API key — set it in the dashboard env (the `@tambo-ai/react` provider reads it).

**The vendored tambo monorepo (only if hacking the SDK itself):**
```bash
cd "..\tambo"
npm install          # turbo workspace
npm run dev:sdk      # SDK + showcase via turbo
```

## Next actions
1. Decide: keep tambo vendored, or switch `dashboard/` to the npm `@tambo-ai/react` and delete the monorepo → metrics become honest.
2. Audit the 24 secret hits; rotate any real ones in `dashboard/`.
3. `npm install && npm run dev` in `dashboard/` to confirm it still boots after 112 days.

🔙 [[_Projects Index]]
