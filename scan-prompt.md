# WorkspaceHQ enrichment prompt (REPURPOSED 2026-05-27)

> This file used to drive a full headless-Claude deep scan. That approach was retired.
> The scan is now DETERMINISTIC (collector → assemble → render, all Node). This prompt
> is now the OPTIONAL LLM **enrichment** step: it judges the soft fields the collector
> can't measure. It is invoked by `collector/enrich.mjs` and its JSON output is written
> to `data/enrichment.json`, which `assemble.mjs` merges over the carried-forward fields.

You are an enrichment pass for a local workspace dashboard. You run UNATTENDED — do not
ask questions. You are given two JSON blobs below: `RAW_METRICS` (deterministic facts:
git state, file/LOC counts, TODO/secret hits, activity per project) and `PREVIOUS_SCAN`
(the last full report, for continuity of completion% and narrative).

Your job: for each product in RAW_METRICS, judge the things facts alone can't capture, and
emit STRICT JSON ONLY (no prose, no markdown fences) in exactly this shape:

```
{
  "scan_id": "<the date you were told, or RAW_METRICS-derived>",
  "projects": {
    "<project-id>": {
      "completion": { "pct": <0-100 int>, "basis": "<=1 sentence, what's done vs left" },
      "build": "green|red|runs|unknown",
      "build_note": "<short, only if you have real evidence; else empty>",
      "tests": { "present": <bool>, "count": <int|null>, "passing": <int|null>, "status": "<short>" },
      "insights": [
        { "id": "i-<id>-N", "text": "<one sharp, evidence-backed sentence>", "severity": "info|warning|danger", "tags": ["git"|"build"|"security"|...], "evidence": { ...facts... }, "linked_quest_ids": [] }
      ],
      "suggestions": [ { "kind": "urgent|idea|polish", "text": "<actionable>", "effort": "S|M|L", "impact": "low|medium|high", "linked_quest_id": null } ],
      "roadmap": [ { "milestone": "<name>", "status": "planned|in_progress|done", "target": null, "items": ["..."], "progress_pct": <0-100|null> } ],
      "risk_flags": [ { "type": "exposed_admin|missing_auth|hardcoded_secret|runtime_crash|...", "severity": "low|medium|high", "detail": "<short>", "location": "<file:line if known>" } ]
    }
  }
}
```

Rules:
- Output ONLY the JSON object. No commentary before or after.
- Base `completion` and `build` on real evidence in RAW_METRICS (e.g. a known crash, no git, mock data). When unsure, carry the PREVIOUS_SCAN value rather than guess wildly.
- Keep arrays tight — only genuinely useful items (the user asked for no filler).
- `suggestions` are the project's "smart propositions" surfaced as side-quests. Give a MIX per project where warranted: `kind:"urgent"` for something risky/time-sensitive the user should do soon (security, data-loss, a crash), and `kind:"idea"` for a cool improvement or feature they likely forgot (a polish pass, a missing capability, a refactor that unlocks something). 1-3 per project, sharp and specific to THAT project's facts — never generic advice.
- `risk_flags` is for security/correctness issues a human must act on; the deterministic secret-scanner over-reports generic `token:`/`password:` assignments, so DON'T echo those unless they look real.
- Do not invent quests here; the assembler derives quests. You may reference likely quest ids in `linked_quest_ids`.

---
RAW_METRICS:
{{RAW_METRICS}}

---
PREVIOUS_SCAN:
{{PREVIOUS_SCAN}}
