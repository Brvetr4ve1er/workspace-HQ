# 📖 The Spellbook

Source-of-truth for your hand-authored arsenal. Everything else (Claude skills,
plugins, npm scripts, scheduled tasks, MCP servers) is *discovered* by
`collector/spellbook.mjs` — this directory holds only what you write yourself.

```
spellbook/
  spells/         one .md manifest per custom spell (format below)
  prompts/        long prompt bodies + the enrichment prompt
  overrides.json  rename / hide / re-school / re-tier any discovered spell
```

## Spell manifest format (`spells/*.md`)

```yaml
---
name: Deep Scan            # required — display name
id: deep-scan              # optional — defaults to filename slug.
                           #   Use a discovered id (e.g. script:run-pipeline) to SHADOW it.
command: powershell        # required (unless kind: chain) — an EXECUTABLE, never a shell string
args: ["-ExecutionPolicy","Bypass","-File","{{HQ}}/run-pipeline.ps1"]
cwd: "{{HQ}}"              # {{HQ}} = this repo, {{PROJECTS}} = the projects root
kind: castable             # castable | channeled (opens a terminal) | chain
school: divination         # divination|conjuration|transmutation|abjuration|evocation|illusion|enchantment|restoration
rarity: rare               # common|uncommon|rare|epic|legendary (legendary is manual-only)
icon: 🔮
confirm: true              # force the dry-run confirm on EVERY cast
timeout_min: 15            # kill the cast after this many minutes (default 10)
chain: ["grimoire:deep-scan","grimoire:weekly-saga"]   # kind: chain only — spell ids, no nesting
---
Everything below the frontmatter is the spell's lore/notes, shown in the
detail drawer (and used as the prompt body for prompt-spells).
```

## overrides.json

```json
{
  "skill:aos": { "name": "Scroll Sorcery", "school": "illusion", "rarity": "rare", "icon": "🌀" },
  "task:some-noisy-task": { "hidden": true }
}
```

Precedence everywhere: **override > manifest > LLM enrichment > heuristic**.
