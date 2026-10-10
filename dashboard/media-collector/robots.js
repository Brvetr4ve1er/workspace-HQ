'use strict';
// Minimal robots.txt reader: group selection by User-agent (our token first,
// then *), longest-match Allow/Disallow. Used ONLY to decide whether to scan
// an HTML page; a parse failure or a missing file means "allowed".
const UA_TOKEN = 'workspacehq-mediacollector';

function parseRobots(text) {
  const groups = [];
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':'); if (i === -1) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  return groups;
}

function matches(rulePath, path) {
  if (rulePath === '') return false;
  // '*' wildcard and '$' end anchor per the REP RFC 9309
  const re = new RegExp('^' + rulePath.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$'));
  return re.test(path);
}

function isAllowed(text, pathname, ua = UA_TOKEN) {
  const groups = parseRobots(text);
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && (ua.includes(a) || a.includes(ua))));
  const star = groups.filter((g) => g.agents.includes('*'));
  const pick = mine.length ? mine : star;
  if (!pick.length) return true;
  let best = null;
  for (const g of pick) for (const r of g.rules) {
    if (!matches(r.path, pathname)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}

module.exports = { parseRobots, isAllowed, UA_TOKEN };
