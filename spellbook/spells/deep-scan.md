---
name: Deep Scan
id: deep-scan
command: powershell
args: ["-ExecutionPolicy","Bypass","-File","{{HQ}}/run-pipeline.ps1"]
cwd: "{{HQ}}"
kind: castable
school: divination
rarity: legendary
icon: 🔮
confirm: false
timeout_min: 20
---
The full WorkspaceHQ divination ritual: sweep every project for git drift,
secrets, TODOs and disk bloat, let the LLM oracle grade completion and risk,
settle the XP ledger, and land a fresh report in the vault. The dashboard
reloads itself when the new latest.json arrives.
