---
id: bruns-logistics
title: BRUNs logistics data scraper
type: project-subnote
stack: [Python, Flask, HTMX, SQLite, ChromaDB]
completion: 50
level: 1
xp: 68
activity: stale
last_commit: 2026-05-03
git_risk: high
security: low
loc: 31641
files: 144
scan_id: 2026-06-09
red_quest: q-bruns-logistics-commit-dirty
tags: [workspacehq, product, python, flask, document-ai, dirty-tree]
---

# 📦 BRUNs logistics data scraper

> [!danger] State — biggest Python app, 26 files uncommitted
> 🟠 **Stale 36 days** (last commit 2026-05-03) · 🔴 **26 dirty files** · **Red quest `q-bruns-logistics-commit-dirty` (100 XP)**. The most substantial backend in the portfolio (31k LOC) is drifting uncommitted.

## What it is
**BRUNs Document Intelligence Platform** — a modular, "Core-First" document AI system that extracts, normalizes, matches and manages structured data from PDFs/images/text. Shared stateless `core/` engine + two isolated domains (**Logistics**: shipping/containers/TAN, and **Travel**: passports/families/IDs with MRZ parser). Backed by **local LLMs (Ollama)** + **Tesseract OCR** + **ChromaDB** semantic search + **SQLite**. UI is **Flask + Jinja + HTMX + DaisyUI** (31-theme picker, no build step) on **port 7845**.

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried) |
| XP / Level | 68 · L1 |
| Activity | 🟠 stale · last commit **2026-05-03** (36 days) |
| Git | `github.com/Brvetr4ve1er/bruns-document-sorter` · branch **main** · 21 commits · **26 dirty** (flag `many-dirty`) |
| Code | 144 files · **31,641 LOC** · 1 TODO |
| Build / Tests | unknown / scan says none — **but `tests/test_phase1..4.py` exist** ⚠️ |
| Security | 🟢 low · 0 secrets |

## Insights
- **Scan undercounts tests.** There are real phase tests (`tests/test_phase1.py` … `test_phase4.py`, `test_imports.py`). The collector's test detector isn't matching them — worth wiring `pytest` so the XP `tests` field stops reading 0.
- Heavy external deps to run: **Tesseract binary** + **Ollama** (or LM Studio/OpenAI/Anthropic via `core/api/llm_config.py`). Ships `INSTALL.bat` / `install.sh` and `install_tesseract.bat`.
- Vendored `tesseract_bin/` + `tessdata/` inflate the file count.

## 🚀 Start it up & preview
First-time install (Windows): run **`INSTALL.bat`**, then **`install_tesseract.bat`**. Then:
```powershell
cd "C:\Users\ROG STRIX\Documents\BRUNs logistics data scraper"
.\START_APP.bat            # creates .venv, launches Flask on port 7845
```
macOS/Linux equivalent:
```bash
./install.sh && ./start.sh   # PORT defaults to 7845 (override BRUNS_API_PORT)
```
Open <http://localhost:7845/>. Pick a domain (Logistics / Travel), upload a PDF, watch HTMX progress.
BI connector: `START_BI_CONNECTOR.bat`. Diagnostics: `DIAGNOSE.bat` / `./diagnose.sh`.

## ✅ Clear the red quest
```bash
cd "C:\Users\ROG STRIX\Documents\BRUNs logistics data scraper"
git add -A && git commit -m "Snapshot: BRUNs platform progress" && git push
```
Auto-completes when `dirty <= 2`.

🔙 [[_Projects Index]]
