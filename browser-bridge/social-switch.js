// SOCIAL READ SWITCH (extension 0.9.0) — importScripts'd by background.js (classic SW), after social.js.
//
// The periodic social READ (social.js socialTick: every open, logged-in social tab, every 5 minutes) is OFF until the
// owner turns it on in the popup. Nothing in the app consumes what it reads today, so the default is "not reading".
// One stored setting decides everything: chrome.storage.local 'hq_social_read' = { on, at }. Absent, malformed, or
// anything but on === true is OFF. Posting is NOT governed by this file: socialSend / socialClaim / the outbox keep
// their own gate (a human click on Approve & send), and the popup's manual "sync" button still reads on demand.
//
// Pattern copied from claude-sync.js (claudeEnsureAlarm / claudeSetOn). Nothing runs at load. This file talks only to
// chrome.storage and chrome.alarms and calls socialTick(); it makes no network call and holds no token. Every top-level
// name is socialSw-prefixed: it shares one global scope with background.js, social.js and claude-sync.js.

/* global chrome, SOCIAL_ALARM, SOCIAL_PERIOD_MIN, socialTick */

const socialSwKey = 'hq_social_read';
const socialSwAlarmName = () => (typeof SOCIAL_ALARM === 'string' ? SOCIAL_ALARM : 'social');
const socialSwPeriodMin = () => (typeof SOCIAL_PERIOD_MIN === 'number' ? SOCIAL_PERIOD_MIN : 5);

// The stored setting, normalised. A storage failure reads as OFF (never as "on").
async function socialSwGet() {
  try {
    const o = await chrome.storage.local.get(socialSwKey);
    const v = o && o[socialSwKey];
    if (!v || typeof v !== 'object' || v.on !== true) return { on: false, at: 0 };
    return { on: true, at: Number.isFinite(v.at) ? v.at : 0 };
  } catch { return { on: false, at: 0 }; }
}

// Make the 'social' alarm match the setting: created only while on, otherwise cleared (this also removes an alarm an
// older extension version left behind: the setting is absent after an update, so it reads as OFF).
async function socialSwEnsureAlarm() {
  const s = await socialSwGet();
  if (s.on) chrome.alarms.create(socialSwAlarmName(), { periodInMinutes: socialSwPeriodMin() });
  else await chrome.alarms.clear(socialSwAlarmName());
  return s;
}

// The owner's switch. Returns the state now in force.
async function socialSwSet(on) {
  const next = { on: on === true, at: Date.now() };
  await chrome.storage.local.set({ [socialSwKey]: next });
  await socialSwEnsureAlarm();
  return next;
}

// The periodic/boot read, behind the switch. Off: nothing is read. On: socialTick() (which still honours cfg.paused).
// The popup's manual "sync" calls socialTick() directly: that one is the owner's click.
async function socialSwTick() {
  const s = await socialSwGet();
  if (!s.on) return { read: false, reason: 'off' };
  await socialTick();
  return { read: true };
}
