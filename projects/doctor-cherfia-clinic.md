---
id: doctor-cherfia-clinic
title: DOCTOR CHERFIA CLINIC
type: project-subnote
pkg_name: omni-diabetologie
stack: [Next.js, TypeScript, Tailwind, shadcn]
completion: 50
level: 1
xp: 75
activity: active
last_commit: 2026-05-24
git_risk: high
security: low
loc: 16461
files: 155
scan_id: 2026-06-09
red_quest: q-doctor-cherfia-clinic-commit-dirty
tags: [workspacehq, product, nextjs, healthcare, dirty-tree]
---

# 🩺 DOCTOR CHERFIA CLINIC

> [!danger] State — 25 uncommitted files at risk
> 🟢 Active (last commit 2026-05-24) but the repo has **only 1 commit** and **25 dirty files** sitting uncommitted. That's nearly the whole working tree unsaved. **Red quest `q-doctor-cherfia-clinic-commit-dirty` (100 XP)** — commit before you lose work.

## What it is
Next.js + TypeScript + Tailwind + shadcn/ui site (package name **`omni-diabetologie`**) — a **diabetology clinic** UI. PWA-enabled (`@ducanh2912/next-pwa`), Radix UI primitives, `next-sitemap` postbuild. Path: `DOCTOR CHERFIA CLINIC/clinic-ui-/`.

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried) |
| XP / Level | 75 · L1 |
| Activity | 🟢 active · last commit **2026-05-24** (15 days) |
| Git | `github.com/Nisslass/clinic-ui-` · branch **main** · **1 commit** · **25 dirty** (flag `many-dirty`) |
| Code | 155 files · **16,461 LOC** · 0 TODO |
| Build / Tests | unknown / none present |
| Security | 🟢 low · 0 secrets |

## Insights
- **1 commit, 155 files** → almost everything was added in a single initial dump and has drifted since. History is effectively non-existent; you can't diff or roll back.
- Different GitHub owner (`Nisslass`) than your other repos — confirm you have push rights before relying on the remote.
- shadcn + PWA + sitemap = production-shaped; the gap is process (commits), not architecture.

## 🚀 Start it up & preview
```bash
cd "C:\Users\ROG STRIX\Documents\DOCTOR CHERFIA CLINIC\clinic-ui-"
npm install
npm run dev        # next dev → http://localhost:3000
```
Production preview:
```bash
npm run build      # also runs next-sitemap (postbuild)
npm start          # serve the production build
```

## ✅ Clear the red quest first
```bash
cd "C:\Users\ROG STRIX\Documents\DOCTOR CHERFIA CLINIC\clinic-ui-"
git status                       # review the 25 changes
git add -A
git commit -m "Snapshot working tree: clinic UI progress"
git push
```
Auto-completes when `dirty <= 2`.

🔙 [[_Projects Index]]
