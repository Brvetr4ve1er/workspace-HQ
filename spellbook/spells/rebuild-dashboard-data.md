---
name: Rebuild Dashboard Data
id: rebuild-dashboard-data
command: node
args: ["{{HQ}}/dashboard/build-data.mjs"]
cwd: "{{HQ}}"
kind: castable
school: transmutation
rarity: common
icon: ♻️
confirm: false
timeout_min: 2
---
Re-bundles every scan sidecar into dashboard/data.js. Cheap and harmless —
the canonical first spell to cast when testing the casting engine.
