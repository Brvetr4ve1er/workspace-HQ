---
id: intel-scraper
title: INTEL SCRAPER (A.G.E.S.)
type: project-subnote
stack: [Python, FastAPI, Playwright, React]
completion: 50
level: 1
xp: 53
activity: stale
git_risk: high
security: low
loc: 6120
files: 39
scan_id: 2026-06-09
red_quest: q-intel-scraper-gitinit
tags: [workspacehq, product, python, fastapi, scraper, no-git]
---

# 🧠 INTEL SCRAPER (A.G.E.S.)

> [!danger] State — lowest XP, no version control
> 🟠 **Stale** (last modified 2026-04-18) · 🔴 **no git repo** · lowest XP in the portfolio (53). **Red quest `q-intel-scraper-gitinit` (100 XP)**.

## What it is
**A.G.E.S. — Autonomous Gathering & Extraction System.** A goal-driven research agent: give it a goal, it plans, scrapes (Playwright), extracts, and builds a knowledge base you can query. Components: `agent_logic/`, `scraper_engine/`, `knowledge_base/`, `db_manager/`, a **FastAPI** backend (`api_server.py`, uvicorn **port 8000**), a CLI (`main.py`), and a **React + Vite** UI in `ui/`. Documented in `ARCHITECTURE.md`, `PROJECT_DOCUMENTATION.md`, `ROADMAP.md`.

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried) |
| XP / Level | 53 · L1 |
| Activity | 🟠 stale · last modified **2026-04-18** |
| Git | 🔴 **none** — `has_git: false` (flag `no-git`) |
| Code | 39 files · **6,120 LOC** · 0 TODO |
| Build / Tests | unknown / none (has `_smoke_pr34.py` smoke script) |
| Security | 🟢 low · 0 secrets |

## Insights
- **Most documented, least tracked**: three architecture/roadmap docs but no git — all that design context has no history.
- Two runtimes: **Python backend** (FastAPI/Playwright) + **React/Vite UI** — they install separately.
- Playwright needs its browser binaries (`playwright install`) after pip install.

## 🚀 Start it up & preview
**Backend (API):**
```bash
cd "C:\Users\ROG STRIX\Documents\INTEL SCRAPER"
python -m venv .venv && .venv\Scripts\activate     # PowerShell
pip install -r requirements.txt
playwright install                                  # browser binaries
python api_server.py        # uvicorn → http://localhost:8000  (docs at /docs)
```
**CLI mode (no server):**
```bash
python main.py --goal "Find Japan visa requirements for Algerian design students"
python main.py --query "What documents are needed for a Japan visa?"
python main.py --list
```
**UI (React/Vite):**
```bash
cd "INTEL SCRAPER\ui"
npm install
npm run dev                 # vite → http://localhost:5173
```

## ✅ Clear the red quest first
```bash
cd "C:\Users\ROG STRIX\Documents\INTEL SCRAPER"
git init
printf ".venv/\nnode_modules/\nstaging/\n__pycache__/\n" > .gitignore
git add -A
git commit -m "Initial commit: A.G.E.S. intel scraper"
```
Auto-completes when `has_git && commits>0`.

🔙 [[_Projects Index]]
