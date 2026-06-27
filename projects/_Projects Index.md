---
type: index
title: WorkspaceHQ — Projects Index
scan_id: 2026-06-09
generated: 2026-06-09
products: 9
health_index: 30
open_red_quests: 6
tags: [workspacehq, index, dashboard]
---

# 🗂️ WorkspaceHQ — Projects

> [!abstract] What this is
> One subnote per tracked product, generated from scan **`2026-06-09`** (`data/latest.json`) and cross-checked against each project's real files. Each note carries the live state (git, activity, risk, LOC) **and** a verified "start it up & preview" tutorial built from the project's actual scripts — not guesses.
>
> The Electron dashboard (`dashboard/`) renders the same data live. These notes are the human-readable companion: open them in Obsidian, follow the wikilinks.

## Account snapshot

| Metric | Value |
|---|---|
| Level | 4 — **Operator** |
| XP | 666 (66 into level · 234 to next) |
| Health index | **30 / 100** (flat 5 days) |
| Scan streak | 5 days |
| Products | 9 · Vaults 3 · Clones 10 |
| Open quests | **6 — all red** |

## Projects at a glance

| Project | Stack | Completion | Activity | Git risk | Red quest? |
|---|---|---|---|---|---|
| [[alliance-travel]] | Static + CF Pages | 50% | 🟢 active (today) | 🟢 low | — |
| [[crucix]] | Node · Express · OSINT | 50% | 💤 dormant (71d) | 🟢 low | — |
| [[almaflowclim]] | Static HTML/CSS | 50% | 🟢 active | 🔴 high | **git init** |
| [[doctor-cherfia-clinic]] | Next.js · TS · shadcn | 50% | 🟢 active (15d) | 🔴 high | **commit 25 files** |
| [[bruns-logistics]] | Python · Flask · HTMX | 50% | 🟠 stale (36d) | 🔴 high | **commit 26 files** |
| [[hamma-sat]] | Node (no-dep) · static | 50% | 🟢 active | 🔴 high | **git init** |
| [[etoile-de-lest]] | Next.js 14 · PWA · Supabase | 50% | 🟢 active | 🔴 high | **commit + push** |
| [[intel-scraper]] | Python · FastAPI · React | 50% | 🟠 stale | 🔴 high | **git init** |
| [[product-intel-wizard]] | React · Vite · tambo | 50% | 💤 dormant (112d) | 🟢 low | — |

> [!warning] The one pattern across the board
> Every project sits at **50% completion** because the LLM enrichment pass has never run (`enricher: null` in the scan). Completion is *carried*, not measured. The real signal right now is **git safety**: 6 of 9 products carry a red quest, and 4 have **no version control or zero commits**. Fix those 6 quests and the health index moves for the first time in 5 days.

## Quest board (all red, 100 XP each)

- [ ] [[almaflowclim]] — put under version control (`git init`)
- [ ] [[hamma-sat]] — put under version control (`git init`)
- [ ] [[intel-scraper]] — put under version control (`git init`)
- [ ] [[etoile-de-lest]] — commit + push (git exists, 0 commits, no remote)
- [ ] [[doctor-cherfia-clinic]] — commit working tree (25 dirty files)
- [ ] [[bruns-logistics]] — commit working tree (26 dirty files)

---
*Refresh: run `run-pipeline.ps1` (or the collector chain) to regenerate `data/latest.json`, then update these notes.*
