---
name: Weekly Saga
id: weekly-saga
command: powershell
args: ["-ExecutionPolicy","Bypass","-File","{{HQ}}/run-pipeline.ps1","-Weekly"]
cwd: "{{HQ}}"
kind: castable
school: conjuration
rarity: rare
icon: 📜
confirm: false
timeout_min: 25
---
Runs the full scan and then summons the narrator: the last 7 days of quests,
level-ups and trophies retold as a hype recap — written to the vault and to
the Weekly Saga card on the overview tab.
