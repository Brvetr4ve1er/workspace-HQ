---
id: almaflowclim
title: almaflowclim.fr
type: project-subnote
stack: [HTML, CSS, Static]
completion: 50
level: 1
xp: 60
activity: active
git_risk: high
security: low
loc: 3266
files: 10
scan_id: 2026-06-09
red_quest: q-almaflowclim-gitinit
tags: [workspacehq, product, static-site, hvac, no-git]
---

# ❄️ almaflowclim.fr

> [!danger] State — active but UNVERSIONED
> 🟢 Edited recently (2026-06-02) but 🔴 **no git repo at all** — zero rollback safety. One bad edit and there's no undo. This is **red quest `q-almaflowclim-gitinit` (100 XP)** and the single highest-leverage 2-minute fix in the portfolio.

## What it is
Pure HTML/CSS/JS rebuild of the **AlmaFlowClim** site — an HVAC company in **Gennevilliers (92230), France**. 7 pages, full local SEO, brand-faithful design, **no build step**. AOS v2.3.1 + Motion One v11 + Font Awesome 6.5 + Roboto, all via CDN. Google Maps iframe on contact.

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried) |
| XP / Level | 60 · L1 |
| Activity | 🟢 active · last modified **2026-06-02** |
| Git | 🔴 **none** — `has_git: false` (flag `no-git`) |
| Code | 10 files · **3,266 LOC** · 0 TODO |
| Security | 🟢 low · 0 secrets |

## Insights
- Smallest, cleanest product — 10 files, no secrets, no build. The *only* problem is the missing repo.
- Because there's no build step, hosting is drag-and-drop (Netlify drop, Cloudflare Pages, any static host).

## 🚀 Start it up & preview
```bash
cd "C:\Users\ROG STRIX\Documents\almaflowclim.fr"
python -m http.server 5500
# or:  npx serve . -p 5501 --no-clipboard
```
Open <http://localhost:5500/> (loads `index.html`).

## ✅ Clear the red quest first (do this now)
```bash
cd "C:\Users\ROG STRIX\Documents\almaflowclim.fr"
git init
printf "node_modules/\n.DS_Store\n" > .gitignore
git add -A
git commit -m "Initial commit: almaflowclim.fr static site"
# optional: git remote add origin <url> && git push -u origin main
```
Auto-completes when `has_git && commits>0`.

🔙 [[_Projects Index]]
