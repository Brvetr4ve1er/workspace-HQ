---
id: etoile-de-lest
title: etoile de lest
type: project-subnote
pkg_name: etoile-de-lest
stack: [Next.js, PWA, Supabase]
completion: 50
level: 1
xp: 64
activity: active
git_risk: high
security: medium
loc: 11098
files: 131
scan_id: 2026-06-09
red_quest: q-etoile-de-lest-commit
tags: [workspacehq, product, nextjs, pwa, tourism]
---

# ⭐ etoile de lest

> [!danger] State — git initialized, never committed
> 🟢 Active (last modified 2026-06-05) but the repo has **0 commits and no remote**. The `.git` exists but nothing is saved and nothing is backed up. **Red quest `q-etoile-de-lest-commit` (100 XP)**.

## What it is
PWA for **Complexe Touristique L'Étoile de l'Est**, Ain Abid, Constantine, Algeria. This is the **V1 foundation slice**: **Next.js 14** PWA, **bilingual FR/AR (RTL-aware)**, full design system, every spec'd route shipping with realistic **mocked content**, Supabase schema as SQL migrations, and integration points wired to placeholders. Runs in **mock mode** when external env vars are absent (Supabase, Twilio SMS OTP, BaridiMob, CIB, FCM, 360dialog WhatsApp). Path: `etoile de lest/etoile-de-l-st-PWA/`.

## Live metrics (scan 2026-06-09)
| Field | Value |
|---|---|
| Completion | 50% (carried) |
| XP / Level | 64 · L1 |
| Activity | 🟢 active · last modified **2026-06-05** |
| Git | 🔴 `has_git: true` but **0 commits**, **no remote** (flags `no-commits`, `no-remote`) |
| Code | 131 files · **11,098 LOC** · 0 TODO |
| Build / Tests | unknown / none · has `typecheck` script |
| Security | 🟠 medium · 1 secret hit (check `.env.local` / Supabase keys) |

## Insights
- **Highest data-loss risk shape**: git exists so it *feels* tracked, but a single `rm -rf` wipes everything — nothing is committed or pushed.
- **Mock mode is a feature**: it boots with no credentials, so you can preview the whole UX before wiring Supabase/Twilio/payments.
- 1 secret hit → verify `.env*` is in `.gitignore` *before* the first commit.

## 🚀 Start it up & preview
```bash
cd "C:\Users\ROG STRIX\Documents\etoile de lest\etoile-de-l-st-PWA"
npm install
npm run dev          # next dev → http://localhost:3000 (mock mode, no env needed)
```
Checks / prod:
```bash
npm run typecheck    # tsc --noEmit
npm run build && npm start
```

## ✅ Clear the red quest first
```bash
cd "C:\Users\ROG STRIX\Documents\etoile de lest\etoile-de-l-st-PWA"
# confirm .env* is ignored, THEN:
git add -A
git commit -m "Initial commit: Étoile de l'Est PWA V1 foundation"
git remote add origin <your-repo-url>
git push -u origin main
```
Auto-completes when `commits>0 && has_remote`.

🔙 [[_Projects Index]]
