---
id: hamma-sat
title: HAMMA SAT IPTV
type: project-subnote
stack: [Node, Static, WhatsApp checkout]
completion: 50
level: 1
xp: 60
activity: active
git_risk: high
security: low
loc: 4287
files: 8
scan_id: 2026-06-09
red_quest: q-hamma-sat-gitinit
tags: [workspacehq, product, node, iptv, no-git]
---

# 📡 HAMMA SAT IPTV

> [!danger] State — active, no version control
> 🟢 Edited recently (2026-06-06) but 🔴 **no git repo** — **red quest `q-hamma-sat-gitinit` (100 XP)**. Small and clean, so this is a fast win.

## What it is
A **no-dependency** Node IPTV storefront. Responsive customer page, offers from a JSON-backed API, dark "Upscayl-inspired" visual system, **EN/FR/AR** copy with **USD/EUR/DZD** pricing, a **WhatsApp order handoff** (deliberately avoids raw card/CVV collection), and a simple admin dashboard. Server is plain `node:http` on **port 4173** — no npm dependencies at all.

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried) |
| XP / Level | 60 · L1 |
| Activity | 🟢 active · last modified **2026-06-06** |
| Git | 🔴 **none** — `has_git: false` (flag `no-git`) |
| Code | 8 files · **4,287 LOC** · 0 TODO |
| Build / Tests | runs (syntax-checkable) / none |
| Security | 🟢 low · 0 secrets |

## Insights
- **Zero npm deps** → no `npm install` needed; the only step before serving is asset generation.
- Has a built-in `npm run check` (node `--check` over server + site + admin + tools) — cheap CI gate once it's in git.
- Full handoff packet lives in `docs/README.md`.

## 🚀 Start it up & preview
```powershell
cd "C:\Users\ROG STRIX\Documents\HAMMA SAT"
npm run generate:assets    # build images/icons into public/
npm start                  # node server.js → http://localhost:4173
# dev (same entry):  npm run dev
# sanity check:      npm run check
```
Open <http://localhost:4173/>. Admin dashboard is served from the same origin.

## ✅ Clear the red quest first
```bash
cd "C:\Users\ROG STRIX\Documents\HAMMA SAT"
git init
printf "node_modules/\n*.log\n" > .gitignore   # also ignore server.err.log / server.out.log
git add -A
git commit -m "Initial commit: HAMMA SAT IPTV storefront"
```
Auto-completes when `has_git && commits>0`.

🔙 [[_Projects Index]]
