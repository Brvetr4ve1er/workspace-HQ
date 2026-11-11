// A recording fake of window.hq for the v5 dev harness (dev-main.js --preload=fake).
// It exposes every method dashboard/preload.js exposes, with the same nesting,
// so the renderer runs its real code paths with nothing behind them:
//  - every call is recorded as {method, args, at} (functions → '[function]')
//  - writes resolve true and do nothing — except where a v5 caller reads fields of
//    the answer: those resolve main's real success shape (doCommit / rescanSpellbook
//    {ok:true}, healthFix {ok, output}); reads resolve canned shapes that
//    live/adapter.mjs accepts (mostly empty)
//  - push channels keep their callbacks HERE, in the preload world, and fire
//    them on window.hqFake.emit(channel, payload); the channel is the IPC name
//    ('hq:scan-status') or the method path ('onScanStatus', 'llm.onDelta',
//    'studio.onCaptureAdded'). Callbacks and disposers cross contextBridge as
//    proxies, so storing them here and calling them later works.
// window.hqFake = {
//   calls(method?)        recorded calls (copies), optionally for one method path
//   reset(all?)           clear the log + sequences (castSpell, pending chats); all=true also drops set() overrides and prefs
//   emit(channel, data)   push to that channel's subscribers; returns how many were called
//   set(method, value)    from now on that method returns `value` (copied); a function is called with the args;
//                         {__reject:'msg'} rejects; undefined restores the default
//   set(method, value, {persist:true})   also keeps a JSON value for the NEXT page loads of this tab
//                         (sessionStorage 'hqFake:persist'): the preload re-runs on every reload, so this is
//                         how a scenario makes e.g. liveState answer something at boot. reset(true) clears it.
// }
// Canned specials: castSpell asks for confirmation on its first call
// ({confirm_required, preview:{content_hash:'fake-hash-2'}}) and then returns {castId:'c-fake'};
// llm.chat streams three accumulated deltas 100 ms apart through llm.onDelta, then resolves.
'use strict';

const WRITE = 'write', SEND = 'send';
// Operator Brief fixture (placeholder projects): one item per severity, so the panel and its gates see every state
const BRIEF = { v: 1, generatedAt: '2026-11-05T09:00:00.000Z', more: 2, errors: [], standing: [], items: [
  { key: 'secrets:p1:2', rule: 'secrets', severity: 'high', text: 'Project A has 2 secrets in plain sight', why: 'Anyone who can read the repo can read them — rotate, then remove.', source: 'scan', age: 'scan 1 h ago', action: { kind: 'go', tab: 'projects', projectId: 'p1' }, count: 0 },
  { key: 'scan-stale:2026-11-03', rule: 'scan-stale', severity: 'med', text: 'Scan data is 2 days old', why: 'Projects, quests and risks are as of 2026-11-03.', source: 'scan', age: 'scan 2 d ago', action: { kind: 'scan' }, count: 0 },
  { key: 'claude-sync:0:never', rule: 'claude-sync', severity: 'low', text: "claude.ai chats aren't syncing", why: 'None are indexed yet — turn on Sync claude.ai in the browser extension.', source: 'claude', age: 'never synced', action: { kind: 'go', tab: 'claude', sub: 'chats' }, count: 0 },
], overflow: [
  // the two items the '+2 more' stands for (items 4 and 5): placeholder repos and project, no real names
  { key: 'ci-red:owner/placeholder-repo:2026-11-04T10:00:00Z', rule: 'ci-red', severity: 'med', text: 'CI is failing on placeholder-repo and 1 more repo', why: 'The last push to it did not pass its checks.', source: 'github', age: 'github.json 1 h ago', count: 1, action: { kind: 'go', tab: 'projects', sub: 'github' } },
  { key: 'prod-deploy-error:placeholder-site:2026-11-04T09:00:00Z', rule: 'prod-deploy-error', severity: 'high', text: 'placeholder-site failed to deploy to production', why: 'The live site is still on the last good deploy — open the failed one and read its log.', source: 'vercel', age: 'accounts.json 1 h ago', count: 0, action: { kind: 'go', tab: 'projects', sub: 'accounts' } },
] };
// Reach (Settings) fixture: one closed (with its step and a command to copy), one open, one unknown, and the calls row
const REACH_ROWS = [
  { id: 'phone-door', ok: false, detail: 'not running since boot at 08:12', step: 'start remote control in a terminal', who: 'owner', copy: 'claude remote-control' },
  { id: 'user-scope', ok: true, detail: 'workspacehq is registered for every session', who: 'owner' },
  { id: 'bridge', ok: null, detail: 'could not tell (selftest placeholder)', who: 'owner' },
  { id: 'calls', ok: true, detail: '12 calls this week (mcp 12)', who: 'app' },
];
// Sessions board fixture (placeholder projects, invented titles): 8 sessions, one per state, 1 nightly run folded, 2 Codex threads, 1 limit stop.
// Built with dashboard/sessions-core.mjs buildBoard at 2026-11-07T12:00Z, so every card is what the real engine would send; the renderer measures ages from generatedAt.
const SESSIONS_BOARD = {"v":1,"generatedAt":"2026-11-07T12:00:00.000Z","state":"ok","sessions":[{"id":"11111111-1111-4111-8111-111111111111","title":"Build the invoice page","project":{"id":"alpha-site","name":"alpha-site","matched":"confirmed"},"branch":"feat/invoice","cwdLabel":"alpha-site","startedAt":"2026-11-07T09:00:00.000Z","lastAt":"2026-11-07T11:59:20.000Z","activeMin":95,"messages":64,"tokens":{"in":1200,"out":3400,"cacheRead":250000},"state":"running","sentence":"working now · 2 turns this hour","longRun":false,"canResume":false,"canOpen":true,"why":"it is working right now"},{"id":"22222222-2222-4222-8222-222222222222","title":"Migrate the settings store","project":{"id":"beta-app","name":"beta-app","matched":"auto"},"branch":"main","cwdLabel":"beta-app","startedAt":"2026-11-07T10:00:00.000Z","lastAt":"2026-11-07T11:46:00.000Z","activeMin":70,"messages":41,"tokens":{"in":1200,"out":3400,"cacheRead":250000},"state":"waiting-tool","sentence":"asked to run Bash 14 min ago — no result since (a permission prompt, or a long tool)","longRun":false,"canResume":false,"canOpen":true,"why":"it is waiting on a tool or a permission prompt — answer it in its own window","lastTool":"Bash"},{"id":"44444444-4444-4444-8444-444444444444","title":"Why does the build fail?","project":{"id":"alpha-site","name":"alpha-site","matched":"confirmed"},"branch":"main","cwdLabel":"alpha-site","startedAt":"2026-11-07T11:00:00.000Z","lastAt":"2026-11-07T11:35:00.000Z","activeMin":12,"messages":9,"tokens":{"in":1200,"out":3400,"cacheRead":250000},"state":"no-reply","sentence":"your last prompt has no reply","longRun":false,"canResume":false,"canOpen":true,"why":"wait until it has been quiet for 30 minutes"},{"id":"77777777-7777-4777-8777-777777777777","title":"Write the release notes","project":{"id":null,"name":"gamma-tool","matched":"folder"},"branch":"main","cwdLabel":"gamma-tool","startedAt":"2026-11-07T08:00:00.000Z","lastAt":"2026-11-07T10:30:00.000Z","activeMin":45,"messages":30,"tokens":{"in":1200,"out":3400,"cacheRead":250000},"state":"finished","sentence":"finished its turn 2 h ago","longRun":false,"canResume":true,"canOpen":true},{"id":"33333333-3333-4333-8333-333333333333","title":"Refactor the export step","project":{"id":null,"name":"gamma-tool","matched":"folder"},"branch":"refactor/export","cwdLabel":"gamma-tool","startedAt":"2026-11-07T06:00:00.000Z","lastAt":"2026-11-07T09:00:00.000Z","activeMin":38,"messages":27,"tokens":{"in":1200,"out":3400,"cacheRead":250000},"state":"stopped-mid-tool","sentence":"stopped mid-tool: asked to run Edit 3 h ago, no result came back","longRun":false,"canResume":true,"canOpen":true,"lastTool":"Edit"},{"id":"55555555-5555-4555-8555-555555555555","title":"Audit the dependency list","project":{"id":null,"name":"delta-lib","matched":"folder"},"branch":"main","cwdLabel":"delta-lib","startedAt":"2026-11-07T03:00:00.000Z","lastAt":"2026-11-07T06:00:00.000Z","activeMin":150,"messages":88,"tokens":{"in":1200,"out":3400,"cacheRead":250000},"state":"limit","sentence":"stopped at your weekly limit · resets Sun 5 pm","longRun":true,"canResume":true,"canOpen":true,"limitKind":"weekly","resetsAt":"2026-11-08T16:00:00.000Z"},{"id":"88888888-8888-4888-8888-888888888888","title":"Tidy the test fixtures","project":{"id":"alpha-site","name":"alpha-site","matched":"confirmed"},"branch":"chore/fixtures","cwdLabel":"alpha-site","startedAt":"2026-11-06T21:00:00.000Z","lastAt":"2026-11-07T05:00:00.000Z","activeMin":25,"messages":18,"tokens":{"in":1200,"out":3400,"cacheRead":250000},"state":"quiet","sentence":"quiet — no activity 7 h ago","longRun":false,"canResume":true,"canOpen":true},{"id":"66666666-6666-4666-8666-666666666666","title":"Sketch the onboarding flow","project":{"id":"beta-app","name":"beta-app","matched":"auto"},"branch":"main","cwdLabel":"beta-app","startedAt":"2026-11-07T01:00:00.000Z","lastAt":"2026-11-07T04:00:00.000Z","activeMin":55,"messages":33,"tokens":{"in":1200,"out":3400,"cacheRead":250000},"state":"api-error","sentence":"stopped on a connection error","longRun":false,"canResume":true,"canOpen":true}],"nightly":{"count":1,"lastAt":"2026-11-07T01:00:00.000Z"},"codex":{"count":2,"lastAt":"2026-11-04T10:00:00.000Z","recent":[{"title":"Sketch a pricing page","updatedAt":"2026-11-04T10:00:00.000Z"},{"title":"Review the schema","updatedAt":"2026-11-03T16:30:00.000Z"}]},"limitStops":{"days":7,"count":1,"last":{"kind":"weekly","at":"2026-11-07T06:00:00.000Z"}},"counts":{"total":8,"week":9,"running":1,"waiting":1,"stopped":3,"limit":1,"finished":1,"quiet":1}};
// the fake preload is sandboxed (no require of JSON): the money fixture is pasted here (readable copy: tools/money.fake-views.json)
// paste near the top of dashboard-v5/tools/fake-preload.js — generated by space-port-money tests/make-fake-views.mjs, do not edit
const MONEY = {"empty":{"today":"2026-11-03","hasAccounts":false,"accounts":[],"room":{"has":false,"amount":"0 DA","raw":0,"tight":true,"perDay":"0 DA a day","days":"27 days","payday":"30 Nov","holdings":"0 DA","jars":"0 DA","due":"0 DA","missingFx":false},"obligations":[],"dueBefore":"0 DA","dueMissing":0,"daysToPayday":27,"payday":"30 Nov","jars":[],"splitTotal":"0 DA","recent":[],"ledgerCount":0,"slips":[],"handled":0,"categories":["Food","Transport","Fun","Bills","Health","Other"],"settings":{"fx":"","payday":"","hasFx":false}},"full":{"today":"2026-11-03","hasAccounts":true,"accounts":[{"id":"fake-1","name":"Cash","currency":"DA","isUsd":false,"balance":"40,750 DA","balanceRaw":40750,"balanceDA":"","estimate":true,"tag":"estimated","confirmed":"confirmed today","stale":false},{"id":"fake-2","name":"Card","currency":"USD","isUsd":true,"balance":"$118.40","balanceRaw":118.4,"balanceDA":"≈ 29,008 DA","estimate":false,"tag":"as typed","confirmed":"confirmed today","stale":false}],"room":{"has":true,"amount":"12,098 DA","raw":12098,"tight":false,"perDay":"549 DA a day","days":"22 days","payday":"25 Nov","holdings":"69,758 DA","jars":"30,000 DA","due":"27,660 DA","missingFx":false},"obligations":[{"id":"fake-4","name":"Internet","kind":"bill","cadence":"monthly","status":"late","isLate":true,"isSoon":false,"isDone":false,"due":"1 Nov","dueLabel":"2 days late","amount":"2,600 DA","estimate":2600,"currency":"DA","installment":"","beforePayday":1,"nextStep":"","accountId":"fake-1","firstDue":"2026-11-01","rawAmount":2600,"total":"","paidBefore":"","undoId":""},{"id":"fake-5","name":"Video app","kind":"subscription","cadence":"monthly","status":"due_soon","isLate":false,"isSoon":true,"isDone":false,"due":"5 Nov","dueLabel":"due in 2 days","amount":"$12.49","estimate":12.49,"currency":"USD","installment":"","beforePayday":1,"nextStep":"","accountId":"fake-2","firstDue":"2026-11-05","rawAmount":12.49,"total":"","paidBefore":"","undoId":""},{"id":"fake-6","name":"Phone plan","kind":"installment","cadence":"monthly","status":"upcoming","isLate":false,"isSoon":false,"isDone":false,"due":"15 Nov","dueLabel":"due in 12 days","amount":"4,000 DA","estimate":4000,"currency":"DA","installment":"4 of 12","beforePayday":1,"nextStep":"","accountId":"fake-1","firstDue":"2026-11-15","rawAmount":4000,"total":12,"paidBefore":4,"undoId":""},{"id":"fake-3","name":"Rent","kind":"bill","cadence":"monthly","status":"upcoming","isLate":false,"isSoon":false,"isDone":false,"due":"20 Nov","dueLabel":"due in 17 days","amount":"18,000 DA","estimate":18000,"currency":"DA","installment":"","beforePayday":1,"nextStep":"","accountId":"fake-1","firstDue":"2026-11-20","rawAmount":18000,"total":"","paidBefore":"","undoId":""}],"dueBefore":"27,660 DA","dueMissing":0,"daysToPayday":22,"payday":"25 Nov","jars":[{"id":"fake-7","name":"Emergency","balance":"24,000 DA","raw":24000,"hasTarget":true,"target":"150,000 DA","targetRaw":150000,"targetDate":"","pct":16,"reached":false,"overspent":false,"pace":"","onTrack":false,"offTrack":false,"split":5000},{"id":"fake-8","name":"Holiday","balance":"6,000 DA","raw":6000,"hasTarget":true,"target":"30,000 DA","targetRaw":30000,"targetDate":"2027-03-20","pct":20,"reached":false,"overspent":false,"pace":"4,800 DA a month for 5 months","onTrack":false,"offTrack":true,"split":3000}],"splitTotal":"8,000 DA","recent":[{"id":"fake-11","amount":"350 DA","category":"Food","note":"coffee + bread","day":"3 Nov","account":"Cash","isBill":false,"kept":false},{"id":"fake-12","amount":"1,200 DA","category":"Transport","note":"","day":"3 Nov","account":"Cash","isBill":false,"kept":false}],"ledgerCount":2,"slips":[{"id":"fake-13","merchant":"Netflix","amount":"$12.49","approx":"≈ 3,060 DA","day":"2 Nov","sure":100,"notes":[],"warn":"","refund":false,"currency":"USD","category":"Fun","sources":[{"from":"Netflix","text":"Card: Your card was charged USD 12.49 at NETFLIX.COM on 2026-11-02."}],"merged":false},{"id":"fake-14","merchant":"Spotify","amount":"$0.00","approx":"≈ 0 DA","day":"20 Oct","sure":30,"notes":["a promotion, nothing was charged"],"warn":"a promotion rather than a charge","refund":false,"currency":"USD","category":"Fun","sources":[{"from":"Spotify","text":"Spotify: Get 3 months of Premium for $0. Offer ends 20 October."}],"merged":false}],"handled":0,"categories":["Food","Transport","Fun","Bills","Health","Other"],"settings":{"fx":"245","payday":"25","hasFx":true}}};


// BEGIN cosmos-fixture (generated by tools/cosmos-fixture-paste.mjs; do not edit between the markers)
// Placeholder library for the Cosmos space: 40 works by default, sessionStorage "hqFake:cosmosCount" asks for more (readable copy: tools/cosmos-fixture.mjs).
const fakeCosmos = function fakeCosmos(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const ROOT = 'C:/placeholder-library';
  const AT = '2026-11-05T09:00:00.000Z';
  const TYPES = ['3d', 'ui', 'illustration', 'photo', 'logo', 'motion', 'type', 'misc'];
  // twenty invented tags; 'kiln' is the known tag (every 25th work carries it and no other work does)
  const TAGS = ['kiln', 'harbor', 'lantern', 'meadow', 'copper', 'velvet', 'orbit', 'quartz', 'ember', 'fjord', 'mosaic', 'tundra', 'saffron', 'prism', 'cobalt', 'willow', 'granite', 'nebula', 'pewter', 'thistle'];
  // sixteen hand-picked colours and the family each one falls in (the test checks them against the real taxonomy)
  const COLORS = [['#c0392b', 'RED'], ['#d9541e', 'ORANGE'], ['#e08a1e', 'ORANGE'], ['#e3b505', 'AMBER'], ['#8fbf2a', 'LIME'], ['#2e8b3d', 'GREEN'],
    ['#1a6b52', 'TEAL'], ['#17a398', 'TEAL'], ['#1f9bbf', 'CYAN'], ['#2f5fd0', 'BLUE'], ['#4b3fb5', 'INDIGO'], ['#7a3fb0', 'VIOLET'],
    ['#c2338f', 'MAGENTA'], ['#808080', 'MONO'], ['#1c1c1c', 'MONO'], ['#f2f2f2', 'MONO']];
  const TEAL = [6, 7];
  const NOT_TEAL = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15];
  const ADJ = ['Quiet', 'Copper', 'Hollow', 'Amber', 'Distant', 'Folded', 'Paper', 'Salt', 'Midnight', 'Slow', 'Bright', 'Winter'];
  const NOUN = ['harbor', 'lantern', 'study', 'garden', 'signal', 'tower', 'market', 'bridge', 'pane', 'orbit', 'field', 'relay'];
  const KNOWN = { count: 1000, tag: 'kiln', hex: '#1a6b52', family: 'TEAL', type: 'photo' };
  if (o.describe) {
    return { root: ROOT, indexedAt: AT, types: TYPES.slice(), tags: TAGS.slice(), colors: COLORS.map((c) => ({ hex: c[0], family: c[1] })), known: KNOWN };
  }
  if (typeof o.error === 'string' && o.error) return { error: o.error };

  const never = o.state === 'empty';
  const n = never ? 0 : (o.count == null ? 1000 : Math.max(0, Math.floor(Number(o.count)) || 0));
  const rootNull = never || o.rootNull === true;
  const indexedAt = rootNull ? null : (typeof o.indexedAt === 'string' ? o.indexedAt : AT);

  // ---- the generator ------------------------------------------------------------------------------------
  let s = (0x9e3779b9 ^ (Math.floor(Number(o.seed)) || 0)) >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const ri = (k) => Math.floor(rnd() * k);
  const hex16 = () => { const a = Math.floor(rnd() * 4294967296).toString(16).padStart(8, '0'); const b = Math.floor(rnd() * 4294967296).toString(16).padStart(8, '0'); return a + b; };
  const pad = (v, w) => String(v).padStart(w, '0');
    const enc = (t) => t.replace(/[%<>#]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  // a coloured rectangle as a data: SVG (the root's own background, so the file stays tiny); `label` is drawn when given.
  // vw x vh is the viewBox (the aspect ratio).
  const art = (hex, vw, vh, label) => 'data:image/svg+xml,' + enc("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + vw + ' ' + vh + "' style='background:" + hex + "'"
    + (label ? "><text y='4' font-size='3'>" + label + '</text></svg>' : '/>'));
  const box = (w, h) => { const m = Math.max(w, h); return [Math.max(4, Math.round((w / m) * 40)), Math.max(4, Math.round((h / m) * 40))]; };
  const colorOf = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
    let h = 0;
    if (d !== 0) {
      if (mx === R) h = ((G - B) / d) % 6; else if (mx === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const l = (mx + mn) / 2, sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { hex, r, g, b, h: Math.round(h), s: Math.round(sat * 100) / 100, l: Math.round(l * 100) / 100 };
  };

  // roles: which work plays which part, spread across the library and never twice
  const used = new Set();
  const take = (k, shift, avoid) => {
    const out = [];
    for (let j = 0; j < k && used.size < n; j++) {
      let p = Math.floor((j + shift) * n / k) % n, guard = 0;
      while ((used.has(p) || (avoid && avoid(p))) && guard++ < n) p = (p + 1) % n;
      if (used.has(p)) break;
      used.add(p); out.push(p);
    }
    return out;
  };
  const per = (rate) => (n > 0 ? Math.max(1, Math.round(n * rate)) : 0);
  const isKiln = (p) => p % 25 === 3;
  const role = new Map();
  const mark = (list, r) => list.forEach((p, i) => role.set(p, Object.assign({ i }, r)));
  mark(take(per(0.004), 0.5), { k: 'approx' });
  mark(take(per(0.006), 0.3), { k: 'drop' });
  const junkAt = take(per(0.005), 0.7);
  mark(junkAt, { k: 'junk' });
  const specialTitle = take(3, 0.4);
  mark(specialTitle, { k: 'title' });
  const exactGroups = n > 0 ? per(0.003) : 0, nearGroups = n > 0 ? per(0.004) : 0;
  const exactAt = [], nearAt = [];
  for (let g = 0; g < exactGroups; g++) { const m = take(g === 0 ? 3 : 2, 0.15 + g * 0.31); if (m.length > 1) { exactAt.push(m); mark(m, { k: 'exact', g }); } }
  for (let g = 0; g < nearGroups; g++) { const m = take(2, 0.55 + g * 0.17); if (m.length > 1) { nearAt.push(m); mark(m, { k: 'near', g }); } }
  const overAt = take(per(0.004), 0.2, isKiln);
  const hiddenAt = take(per(0.015), 0.6);
  const favAt = take(per(0.025), 0.1);

  const works = [];
  let imp = 0;
  for (let i = 0; i < n; i++) {
    const rl = role.get(i) || null, kind = rl ? rl.k : '';
    const video = i % 20 === 9 && !rl;
    const num = pad(i + 1, 3);
    const folder = i % 3 === 1 ? 'beta-shots' : 'alpha-site';
    const noun = NOUN[ri(12)], adj = ADJ[ri(12)];
    const type = video ? 'motion' : TYPES[i % 8];
    let title = adj + ' ' + noun, id = folder + '-' + num, rel;
    const ext = video ? 'mp4' : ['png', 'jpg', 'webp', 'jpg'][i % 4];
    rel = folder + '/' + noun + '-' + num + '.' + ext;
    if (kind === 'drop') { imp += 1; id = 'imports-drop-' + imp; rel = 'imports:drop-' + imp + '.png'; title = 'Dropped file ' + imp; }
    if (kind === 'title') {
      if (rl.i === 0) title = 'Very long title for layout testing '.repeat(7).slice(0, 200);
      else if (rl.i === 1) title = 'Say "cheese" & \'smile\' \u{1F680}';
      else { title = 'rough draft #3 100%'; rel = folder + '/rough draft #3 100%.png'; }
    }
    // tags: 1-3 from the non-kiln words, plus 'kiln' on every 25th work
    const tags = [];
    if (isKiln(i)) tags.push('kiln');
    for (let k = 1 + (ri(3) === 0 ? 1 : 0); k > 0; k--) { const t = TAGS[1 + ri(19)]; if (!tags.includes(t)) tags.push(t); }

    // size
    let width, height, approx = false;
    if (kind === 'approx') { width = 1; height = 1; approx = true; rnd(); rnd(); }
    else if (video) { const v = i % 80 === 29; width = v ? 1080 : 1920; height = v ? 1920 : 1080; rnd(); rnd(); }
    else if (kind === 'junk' && rl.i % 5 < 3) { width = 40 + ri(20); height = 40 + ri(16); rnd(); }
    else { height = 600 + ri(1000); width = Math.round(height * (0.5 + rnd() * 1.5)); }
    const orientation = width > height * 1.05 ? 'landscape' : height > width * 1.05 ? 'portrait' : 'square';

    // colour
    let color = null, palette = [];
    if (!approx) {
      let ci;
      if (kind === 'junk' && rl.i % 5 >= 3) ci = 13;
      else if (i % 20 === 5) ci = TEAL[(i / 20 | 0) % 2];
      else ci = NOT_TEAL[ri(14)];
      color = colorOf(COLORS[ci][0]);
      palette = [COLORS[ci][0]];
      if (!(kind === 'junk' && rl.i % 5 >= 3)) for (let k = ri(3); k > 0; k--) { const h2 = COLORS[ri(16)][0]; if (!palette.includes(h2)) palette.push(h2); }
    }

    // when it was made: spread over 40 months (2023-07 .. 2026-10)
    const m = ri(40), yy = 2023 + Math.floor((6 + m) / 12), mm = (6 + m) % 12 + 1;
    const createdAt = yy + '-' + pad(mm, 2) + '-' + pad(1 + ri(28), 2) + 'T' + pad(ri(24), 2) + ':' + pad(ri(60), 2) + ':00.000Z';

    let contentHash = null;
    let perceptualHash = approx ? null : hex16();
    const w = { id, rel, title, type, width, height, orientation, color, palette, thumb: approx ? null : 'thumbs/' + id + '.jpg', video, contentHash, perceptualHash, tags, createdAt };
    if (approx) w.approx = true;
    const fill = color ? color.hex : '#888888';
    const bx = box(width, height);
    // a video's original is not a picture: the page's CSP only lets media load from 'self' and file:, so a data: URI there is a console error the
    // gates count. A video with a thumbnail has no url here (it shows its poster); the real library carries a file: URL, which main makes.
    w.url = video && !approx ? null : art(fill, approx ? 4 : bx[0], approx ? 3 : bx[1], '');
    w.thumbUrl = approx ? null : art(fill, bx[0], bx[1], id);
    works.push(w);
  }

  // duplicates: exact members share a content hash, near members a hash one nibble apart
  const mk = (ids, kinds, reason) => ({ key: ids.slice().sort().join(' '), ids, kinds, keeperId: ids[0], reason });
  const exact = exactAt.map((m) => {
    const base = works[m[0]];
    const hc = hex16(), hp = base.perceptualHash;
    for (const p of m) { works[p].contentHash = hc; works[p].perceptualHash = hp; }
    return mk(m.map((p) => works[p].id), m.map(() => 'exact'), 'Identical file contents');
  });
  const near = nearAt.map((m) => {
    const hp = works[m[0]].perceptualHash;
    works[m[1]].perceptualHash = hp.slice(0, 15) + ((parseInt(hp[15], 16) + 1) % 16).toString(16);
    return mk(m.map((p) => works[p].id), m.map(() => 'near'), 'Visually similar (perceptual hash within 10 bits)');
  });
  const junk = junkAt.map((p, i) => ({ id: works[p].id, reason: i % 5 < 3 ? 'tiny' : 'blank' }));

  // curation: the owner's side (favourites, hidden, four overrides, three clusters - one of them smart)
  const favorites = {}, hidden = {}, overrides = {};
  for (const p of favAt) favorites[works[p].id] = true;
  for (const p of hiddenAt) hidden[works[p].id] = true;
  const edits = [{ title: 'Renamed by the owner' }, { tags: ['ember', 'velvet'] }, { title: 'Second rename', tags: ['quartz'] }, { tags: [] }];
  overAt.forEach((p, i) => { overrides[works[p].id] = edits[i % 4]; });
  const ids = works.map((w) => w.id);
  const stride = (k, off) => { const out = []; for (let j = 0; j < k && j * 7 + off < n; j++) out.push(ids[j * 7 + off]); return out; };
  const clusters = n === 0 ? [] : [
    { id: 'cl-harbor', name: 'Harbor mornings', description: 'A hand-made cluster', elementIds: stride(Math.min(12, Math.ceil(n / 7)), 1), createdAt: '2026-03-02T10:00:00.000Z', updatedAt: '2026-03-02T10:00:00.000Z' },
    { id: 'cl-quiet', name: 'Quiet corners', elementIds: stride(Math.min(7, Math.ceil(n / 9)), 2), createdAt: '2026-04-11T18:30:00.000Z', updatedAt: '2026-05-01T09:00:00.000Z' },
    { id: 'cl-smart-kiln', name: 'Everything kiln', elementIds: [], rule: { tags: ['kiln'] }, createdAt: '2026-06-20T08:15:00.000Z', updatedAt: '2026-06-20T08:15:00.000Z' },
  ];
  const curation = { version: 1, clusters, favorites, hidden, overrides };
  const cleanup = n === 0 ? { version: 1, dismissed: { clusters: {}, candidates: {} } } : { version: 1, dismissed: {
    clusters: { [near.length > 1 ? near[near.length - 1].key : 'retired-group-1 retired-group-2']: '2026-10-20T08:00:00.000Z' },
    candidates: { [junk.length > 1 ? junk[junk.length - 1].id : 'retired-candidate-1']: '2026-10-20T08:00:00.000Z' },
  } };

  return {
    state: never ? 'empty' : 'ready',
    config: { version: 1, root: rootNull ? null : ROOT, indexedAt },
    works,
    dupes: { exact, near, junk },
    curation,
    cleanup,
    rootOk: o.rootOk !== false,
    indexing: o.indexing && typeof o.indexing === 'object' ? { phase: String(o.indexing.phase || 'walk'), done: Number(o.indexing.done) || 0, total: Number(o.indexing.total) || 0, startedAt: AT } : null,
  };
};
// END cosmos-fixture

// storage (optional): a Web Storage for set(…, {persist:true}); the Electron branch passes sessionStorage
function createFake(opts) {
  const storage = opts && opts.storage ? opts.storage : null;
  const PERSIST_KEY = 'hqFake:persist';
  const log = [];
  const subs = new Map();        // channel → Set(callback)
  const alias = new Map();       // method path → channel
  const overrides = new Map();   // method path → value
  const readPersisted = () => { try { const o = JSON.parse((storage && storage.getItem(PERSIST_KEY)) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
  const writePersisted = (o) => { try { if (Object.keys(o).length) storage.setItem(PERSIST_KEY, JSON.stringify(o)); else storage.removeItem(PERSIST_KEY); } catch {} };
  const chats = new Map();       // jobId → {timers, resolve}
  const HUB_AT = '2026-10-04T09:00:00.000Z';
  const HUB_PROJECTS = [
    { id: 'code:C--placeholder-project-a', source: 'code', key: 'C--placeholder-project-a', name: 'project-a', path: 'C:\\placeholder\\project-a', hq_project_id: 'project-a', link_state: 'auto', conversations: 2, last_at: HUB_AT },
    { id: 'code:C--placeholder-project-b', source: 'code', key: 'C--placeholder-project-b', name: 'project-b', path: 'C:\\placeholder\\project-b', hq_project_id: null, link_state: 'none', conversations: 1, last_at: '2026-09-30T08:00:00.000Z' },
  ];
  const HUB_CONVS = [
    { id: 'code:sess-a1', source: 'code', project_id: HUB_PROJECTS[0].id, native_id: 'sess-a1', title: 'Release planning', title_source: 'ai', started_at: '2026-10-04T08:40:00.000Z', last_at: HUB_AT, message_count: 4, cwd: 'C:\\placeholder\\project-a', git_branch: 'main', model: 'claude-placeholder', tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10, active_ms: 120000, forgotten: 0, project_name: 'project-a', hq_project_id: 'project-a' },
    { id: 'code:sess-a2', source: 'code', project_id: HUB_PROJECTS[0].id, native_id: 'sess-a2', title: 'Fix the caf\u00e9 bug \ud83d\ude80', title_source: 'first-prompt', started_at: '2026-10-03T10:00:00.000Z', last_at: '2026-10-03T10:05:00.000Z', message_count: 2, cwd: 'C:\\placeholder\\project-a', git_branch: null, model: null, tokens_in: null, tokens_out: null, tokens_cache_read: null, tokens_cache_write: null, active_ms: 0, forgotten: 0, project_name: 'project-a', hq_project_id: 'project-a' },
  ];
  const hubThread = (id) => {
    const c = HUB_CONVS.find((x) => x.id === id);
    if (!c) return null;
    return { conversation: c, hasMore: false, messages: [
      { id: id + ':u1', conversation_id: id, role: 'user', at: c.started_at, text: 'Plan the release for project-a', tool_name: null, is_sidechain: 0 },
      { id: id + ':a1', conversation_id: id, role: 'assistant', at: c.last_at, text: '[tool: Read README.md]', tool_name: 'Read', is_sidechain: 0 },
      { id: id + ':t1', conversation_id: id, role: 'tool', at: c.last_at, text: '# project-a\nplaceholder readme', tool_name: null, is_sidechain: 0 },
      { id: id + ':a2', conversation_id: id, role: 'assistant', at: c.last_at, text: 'Here is a release plan.', tool_name: null, is_sidechain: 0 },
    ] };
  };
  const HUB_DOCS = [{ id: 'memory:fake1', source: 'memory', path: 'C:\\fake\\.claude\\projects\\p\\memory\\tea.md', title: 'Fake tea rule', project_id: 'code:p', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000, size: 40, origin: null, snippet: 'offer fake \u0002tea\u0003 first', rank: -1 }, { id: 'claude-md:fake2', source: 'claude-md', path: 'C:\\fake\\p\\CLAUDE.md', title: 'CLAUDE.md — p', project_id: 'code:p', project_path: 'C:\\fake\\p', mtime_ms: 1759320000000, size: 30, origin: null, snippet: 'fake \u0002tea\u0003 rules', rank: -0.5 }];
  const HUB_HITS = [
    { messageId: 'code:sess-a1:a2', conversationId: 'code:sess-a1', at: HUB_AT, role: 'assistant', title: 'Release planning', source: 'code', projectId: HUB_PROJECTS[0].id, snippet: 'Here is a \u0002release\u0003 plan.', rank: -2 },
    { messageId: 'code:sess-a2:u1', conversationId: 'code:sess-a2', at: '2026-10-03T10:00:00.000Z', role: 'user', title: 'Fix the caf\u00e9 bug \ud83d\ude80', source: 'code', projectId: HUB_PROJECTS[0].id, snippet: '\u2026pasted \u0002<img src=x onerror=alert(1)>\u0003 <script>release()</script> and \u0002release', rank: -1 },
  ];
  const DEFAULT_PREFS = { theme: 'dark', resolved: 'dark', reduceMotion: false };
  let prefs = { ...DEFAULT_PREFS }, casts = 0;

  // cloneable copy of what crossed the bridge (contextBridge can't copy functions back out)
  const clean = (v, d = 0) => {
    if (typeof v === 'function') return '[function]';
    if (v == null || typeof v !== 'object') return v;
    if (d > 6) return '[deep]';
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return '[bytes ' + v.byteLength + ']';
    if (Array.isArray(v)) return v.map((x) => clean(x, d + 1));
    const o = {};
    for (const k of Object.keys(v)) o[k] = clean(v[k], d + 1);
    return o;
  };
  const record = (method, args) => { log.push({ method, args: clean(args), at: Date.now() }); };
  const push = (channel, payload) => {
    let n = 0;
    for (const cb of [...(subs.get(channel) || [])]) {
      try { cb(payload); n++; } catch (e) { console.error('[hqFake] a ' + channel + ' subscriber threw:', e); }
    }
    return n;
  };

  // ---- the stateful canned answers ----
  const chat = (req) => new Promise((resolve) => {
    const claude = !!(req && req.include && req.include.claude === true);   // H5: a Claude history section, cited
    const jobId = req && req.jobId, parts = ['Fake', 'Fake answer', claude ? 'Fake answer from the fake model, from chat Fake release planning, 2026-10-01.' : 'Fake answer from the fake model.'];
    const job = { resolve, timers: [], sent: '', t0: Date.now() };
    if (jobId) chats.set(jobId, job);
    parts.forEach((text, i) => job.timers.push(setTimeout(() => {
      job.sent = text;
      push('hq:llm:delta', { jobId, text });   // main sends the accumulated text, not the increment
      if (i === parts.length - 1) {
        chats.delete(jobId);
        const sections = [{ label: 'Scan', chars: 10 }].concat(claude ? [{ id: 'claude', label: 'Claude history', chars: 420, clipped: false, cites: ['chat Fake release planning, 2026-10-01'] }] : []);
        resolve({ status: 'done', output: text, sections, model: 'fake-model', ms: 300 });
      }
    }, 100 * (i + 1))));
  });
  // like main (hq:llm:cancel): true when that job was running, false otherwise; the
  // stopped chat answers {status:'cancelled', output:<what had streamed>} — main's
  // stream keeps the partial text (it is '' only when the stop beat the context build)
  const cancelChat = (jobId) => {
    const j = chats.get(jobId);
    if (!j) return false;
    j.timers.forEach(clearTimeout); chats.delete(jobId);
    j.resolve({ status: 'cancelled', output: j.sent, sections: [{ label: 'Scan', chars: 10 }], model: 'fake-model', ms: Date.now() - j.t0 });
    return true;
  };
  // Claude Hub H3 — like main (hq:claude-chat:send/cancel): increments, one end per turn.
  const turns = new Map();
  let turnSeq = 0;
  const chatTurn = (req) => {
    const r = req && typeof req === 'object' ? req : {};
    if (typeof r.text !== 'string' || !r.text.trim()) return { error: 'empty message' };
    const turnId = 'ct-fake-' + (++turnSeq), mode = r.mode === 'edits' ? 'edits' : 'read-only';
    const resumed = typeof r.conversationId === 'string' && r.conversationId.startsWith('code:') ? r.conversationId.slice(5) : null;
    const sessionId = resumed || '00000000-0000-4000-8000-000000000001';
    const steps = [
      { kind: 'session', sessionId, mode }, { kind: 'delta', text: 'Placeholder' }, { kind: 'tool', name: 'Read', hint: 'README.md' },
      { kind: 'delta', text: ' answer from the fake claude.' },
      { kind: 'done', sessionId, mode, usage: { in: 6, out: 40, cacheRead: 0, cacheWrite: 0 }, isError: false, subtype: 'success', result: '', stopped: false },
    ];
    const t = { timers: [], sessionId, mode };
    turns.set(turnId, t);
    steps.forEach((s, i) => t.timers.push(setTimeout(() => {
      if (s.kind === 'done') turns.delete(turnId);
      push('hq:claude-chat:event', { turnId, ...s });
    }, 150 * (i + 1))));
    return resumed ? { turnId, sessionId } : { turnId };
  };
  const cancelTurn = (turnId) => {
    const t = turns.get(turnId);
    if (!t) return false;
    t.timers.forEach(clearTimeout); turns.delete(turnId);
    setTimeout(() => push('hq:claude-chat:event', { turnId, kind: 'done', sessionId: t.sessionId, mode: t.mode, usage: null, isError: false, subtype: '', result: '', stopped: true }), 0);
    return true;
  };

  const cast = () => (casts++ === 0 ? { confirm_required: true, preview: { content_hash: 'fake-hash-2' } } : { castId: 'c-fake' });
  const setPrefs = (patch) => {
    const p = patch && typeof patch === 'object' ? patch : {};
    const next = { ...prefs };
    if (['dark', 'light', 'os'].includes(p.theme)) next.theme = p.theme;
    if (typeof p.reduceMotion === 'boolean') next.reduceMotion = p.reduceMotion;
    next.resolved = next.theme === 'light' ? 'light' : 'dark';   // the fake has no OS theme: 'os' resolves dark
    prefs = next;
    setTimeout(() => push('hq:ui-prefs', prefs), 0);   // main broadcasts after answering
    return prefs;
  };

  // Client delivery fixture: a small stateful stand-in for dashboard/delivery.js, so the project page's card runs its real code paths.
  // Invented projects: alpha-site (a checklist kept in the app + a preview link), beta-app (SCOPE.md, read-only, production link),
  // gamma-tool (plan mode on docs/plan.md), delta-lib (a client job with no scope, two files found, no Vercel project); any other id is
  // not a client job yet (Mark → no scope → add items). Ids and times are minted here, as main does. reset() puts it all back.
  const DLV = (() => {
    const agoIso = (min) => new Date(Date.now() - min * 60e3).toISOString();
    const SEED = () => ({
      'alpha-site': { client: true, scopeFile: null, items: [{ id: 'i-1', text: 'Home page', milestone: 'Design', done: true }, { id: 'i-2', text: 'Gallery', milestone: 'Design', done: false }, { id: 'i-3', text: 'Contact form', milestone: 'Build', done: false }], lastCopyAt: null, link: { kind: 'preview', url: 'https://alpha-site-git-feat-example.vercel.app', state: 'ready', at: agoIso(120), branch: 'feat/gallery' } },
      'beta-app': { client: true, scopeFile: 'SCOPE.md', items: [], lastCopyAt: agoIso(2880), link: { kind: 'production', url: 'https://beta-app.example.vercel.app', state: 'ready', at: agoIso(5000), branch: 'main' }, file: { Setup: [['Repo created', true], ['CI green', true]], Launch: [['Domain pointed', false], ['Go-live check', false]] } },
      'gamma-tool': { client: false, scopeFile: 'docs/plan.md', items: [], lastCopyAt: null, link: null, file: { Phase1: [['Parser', true], ['Exporter', true], ['Docs', false]] } },
      'delta-lib': { client: true, scopeFile: null, items: [], lastCopyAt: null, link: null },
    });
    let S = SEED(), seq = 0;
    const CANDS = { 'beta-app': [{ rel: 'SCOPE.md', items: 4, done: 2 }], 'gamma-tool': [{ rel: 'docs/plan.md', items: 3, done: 2 }], 'delta-lib': [{ rel: 'docs/todo.md', items: 6, done: 1 }, { rel: 'notes/launch.md', items: 3, done: 0 }] };
    const entry = (id) => S[id] || (S[id] = { client: false, scopeFile: null, items: [], lastCopyAt: null, link: null });
    const view = (id) => {
      const e = entry(id), file = e.scopeFile && (S[id].file || (id !== 'beta-app' && id !== 'gamma-tool' ? { General: [['First step', true], ['Second step', false], ['Third step', false]] } : null));
      const fileMs = file ? Object.keys(file).map((n) => ({ name: n, items: file[n].map(([text, done]) => ({ text, done })) })) : null;
      const appMs = []; for (const it of e.items) { const n = it.milestone || 'General'; let m = appMs.find((x) => x.name === n); if (!m) appMs.push(m = { name: n, items: [] }); m.items.push({ id: it.id, text: it.text, done: it.done }); }
      const src = fileMs ? 'file' : e.items.length ? 'app' : 'none', mss = (fileMs || appMs).map((m) => ({ name: m.name, items: m.items, done: m.items.filter((i) => i.done).length, total: m.items.length }));
      const done = mss.reduce((a, m) => a + m.done, 0), total = mss.reduce((a, m) => a + m.total, 0);
      const mode = e.client ? 'client' : e.scopeFile ? 'plan' : 'none';
      const left = mss.flatMap((m) => m.items.filter((i) => !i.done).map((i) => i.text));
      return { projectId: id, client: e.client, mode, source: src, scopeFile: e.scopeFile, sourceLabel: src === 'file' ? e.scopeFile + (/^scope.md$/i.test(e.scopeFile) ? '' : ' — a plan checklist, not the quote') : src === 'app' ? 'a checklist kept in WorkspaceHQ' : '', sourceNote: '',
        fileState: src === 'file' ? 'ok' : null, fileDetail: null, candidates: CANDS[id] || [{ rel: 'docs/plan.md', items: 4, done: 1 }], walkTruncated: false, walkError: null,
        milestones: mss, done, total, summary: done + ' of ' + total + ' done', doneSince: [], link: e.client ? e.link : null, linkWhy: e.link ? null : 'No Vercel project linked to this repo',
        update: e.client && total ? id + ' — update · Still to do (' + left.length + ' of ' + total + '): ' + left.join(', ') + (e.link ? ' · Preview: ' + e.link.url : '') : '', lastCopyAt: e.lastCopyAt };
    };
    return {
      read: (id) => (typeof id === 'string' && id ? view(id) : { error: 'no such project' }),
      apply: (intent) => {
        const id = intent && intent.projectId, e = id && entry(id), t = intent && intent.type;
        if (!e) return { error: 'no such project' };
        if (t === 'mark-client') e.client = !!intent.on;
        else if (t === 'set-scope-file') e.scopeFile = intent.rel || null;
        else if (t === 'item-add') { if (e.items.length >= 200) return { error: 'at most 200 items' }; e.items.push({ id: 'fake-' + (++seq), text: String(intent.text || '').slice(0, 200), milestone: intent.milestone || '', done: false }); }
        else if (t === 'item-toggle') { const it = e.items.find((x) => x.id === intent.id); if (!it) return { error: 'no such item' }; it.done = !it.done; }
        else if (t === 'item-remove') e.items = e.items.filter((x) => x.id !== intent.id);
        else if (t === 'copied') e.lastCopyAt = new Date().toISOString();
        else return { error: 'unknown intent' };
        return view(id);
      },
      // Projects > Clients (hq.delivery.clients): one summary row per client job, counts and words only; the extra 'ghost-job' row is a marked client the latest scan no longer lists.
      clients: () => {
        const NAMES = { 'alpha-site': 'Alpha Site', 'beta-app': 'Beta App', 'delta-lib': 'Delta Lib' };
        const rows = Object.keys(S).filter((id) => S[id].client).map((id) => { const v = view(id), l = S[id].link; return { id, name: NAMES[id] || id, mode: v.mode, done: v.done, total: v.total, linkState: !l ? 'none' : l.state !== 'ready' ? 'not-ready' : l.kind === 'production' ? 'ready-production' : l.kind === 'preview' ? 'ready-preview' : 'not-ready', lastCopyAt: v.lastCopyAt, fileState: v.fileState, inScan: true }; });
        rows.push({ id: 'ghost-job', name: 'ghost-job', mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt: null, fileState: null, inScan: false });
        return { clients: rows, generatedAt: new Date().toISOString(), omitted: 0 };
      },
      reset: () => { S = SEED(); seq = 0; },
    };
  })();

  // Client delivery check fixture (batch 2): a stand-in for dashboard/delivery-check.js so the card runs its real code paths and the gates never start a
  // window. alpha-site has a dev server "answering" (placeholder address); every other project answers nothing. run keeps one fixed report per project
  // (placeholder text only: a wide table, 10 px text, a French page copied from English, four outside requests blocked); forget clears it; reset() puts it back.
  const DCK = (() => {
    let REP = new Map();
    const loop = (u) => /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\/?$/.test(String(u || ''));
    const report = () => ({
      v: 1, at: new Date().toISOString(), origin: '127.0.0.1:5173', phone: { width: 390, height: 844, scale: 3 },
      routes: [{ path: '/', locale: 'en', title: 'Acme Studio', loaded: true, shot: 'x-0.png' }, { path: '/fr', locale: 'fr', title: 'Acme Studio (fr)', loaded: true, shot: 'x-1.png' }],
      findings: [
        { id: 'overflow', level: 'problem', route: '/', text: 'Sideways scroll at 390 px: the page is 900 px wide · widest: table.wide', offenders: ['table.wide'] },
        { id: 'small-text', level: 'heads-up', route: '/', text: '1 piece of visible text under 12 px' },
        { id: 'identical', level: 'heuristic', route: '/fr', text: 'Heuristic: 3 strings on /fr are word for word the same as on /', samples: ['Welcome to Acme'] },
      ],
      counts: { problem: 1, headsUp: 1, heuristic: 1 }, languageSwitch: 'found', blocked: { count: 4, hosts: [{ host: 'fonts.example.test', count: 4 }] }, requestsSeen: 12,
      truncated: { routes: false, requests: false, time: false }, summary: '1 to fix · 1 to look at · 1 heuristic (may be wrong) · 2 pages at 390 px',
      blockedLine: '4 outside requests blocked (fonts.example.test)', notes: [], shots: ['x-0.png', 'x-1.png'],
    });
    return {
      detect: (id) => (typeof id === 'string' && id ? (id === 'alpha-site'
        ? { state: 'ready', startedHere: false, candidates: [{ origin: 'http://127.0.0.1:5173', title: 'Acme Studio' }], hasCommand: true }
        : { state: 'nothing-answering', startedHere: false, candidates: [], hasCommand: id !== 'delta-lib' }) : { error: 'no such project' }),
      run: (id, url) => { if (!id) return { error: 'no such project' }; if (!loop(url)) return { error: 'Only a dev server on this PC can be checked' }; const r = report(); REP.set(id, r); return r; },
      read: (id) => REP.get(id) || null,
      forget: (id) => { REP.delete(id); return { ok: true }; },
      reset: () => { REP = new Map(); },
    };
  })();

  // BEGIN cosmos-rows (generated by tools/cosmos-fixture-paste.mjs; do not edit between the markers)
  // Cosmos space: answers fakeCosmos({count}); count = sessionStorage 'hqFake:cosmosCount' if set, else 40 (the global button sweep walks every screen, so the default is small).
  const COSMOS = (() => {
    const LIBS = new Map();   // count -> the generated answer (made once)
    let cur = null, curCount = -1;   // the curation cosmos.apply edits; hqFake.reset() puts it back
    const countNow = () => {
      try {
        const raw = storage && storage.getItem('hqFake:cosmosCount');
        const v = raw == null || raw === '' ? NaN : Number(raw);
        return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 40;
      } catch (e) { return 40; }
    };
    const lib = (n) => { let l = LIBS.get(n); if (!l) { l = fakeCosmos({ count: n }); LIBS.set(n, l); } return l; };
    const curation = (n) => { if (!cur || curCount !== n) { cur = JSON.parse(JSON.stringify(lib(n).curation)); curCount = n; } return cur; };
    const copy = (n) => JSON.parse(JSON.stringify(curation(n)));
    const read = () => { const n = countNow(); return Object.assign({}, lib(n), { curation: copy(n) }); };
    const norm = (t) => String(t).toLowerCase().trim().replace(/\s+/g, ' ');
    const apply = (intent) => {
      const i = intent && typeof intent === 'object' ? intent : {};
      const n = countNow(), c = curation(n), w = lib(n).works.find((x) => x.id === i.id);
      if (['favorite', 'hide', 'tags', 'title'].includes(i.type)) {
        if (!w) return { error: 'No such element' };
        if (i.type === 'favorite' || i.type === 'hide') {
          const m = i.type === 'favorite' ? c.favorites : c.hidden;
          if (i.on) m[i.id] = true; else delete m[i.id];
        } else {
          const o = c.overrides[i.id] || (c.overrides[i.id] = {});
          if (i.type === 'title') { if (i.title == null || String(i.title).trim() === '') delete o.title; else o.title = String(i.title); }
          else {
            let tags = (Array.isArray(o.tags) ? o.tags : w.tags).slice();
            for (const t of Array.isArray(i.add) ? i.add : []) { const x = norm(t); if (x && !tags.includes(x)) tags.push(x); }
            const gone = (Array.isArray(i.remove) ? i.remove : []).map(norm);
            tags = tags.filter((t) => !gone.includes(t));
            o.tags = tags;
          }
          if (Object.keys(o).length === 0) delete c.overrides[i.id];
        }
      } else if (i.type !== 'import-replace') return { error: 'The fake preload does not do ' + String(i.type) };
      return { view: { curation: copy(n) }, note: 'saved' };
    };
    const trash = (ids) => {
      const works = lib(countNow()).works, trashed = [], failed = [];
      for (const id of Array.isArray(ids) ? ids : []) {
        const w = works.find((x) => x.id === id);
        if (w && String(w.rel).startsWith('imports:')) trashed.push(id); else failed.push({ id, message: 'Only a file dropped into Cosmos can be moved to the Recycle Bin from here' });
      }
      return { trashed, failed };
    };
    const report = () => ({ clusters: 3, favorites: 25, hidden: 15, overrides: 4, found: 40, missingIds: ['alpha-site-9999'], missingCount: 1, conflicts: 0, token: null, seeded: 0, skipped: [], note: 'Imported the placeholder backup' });
    const pathForFile = (f) => (f && typeof f === 'object' && typeof f.fakePath === 'string' ? f.fakePath : '');
    return {
      reset: () => { cur = null; curCount = -1; },
      rows: [
        ['cosmos.read', read], ['cosmos.apply', apply], ['cosmos.pickFolder', () => null], ['cosmos.index', () => true], ['cosmos.cancelIndex', () => true],
        ['cosmos.trash', trash], ['cosmos.reveal', () => true], ['cosmos.importFiles', (paths) => ({ imported: Array.isArray(paths) ? paths.length : 0, skipped: [] })],
        ['cosmos.importFromLocal', report], ['cosmos.pathForFile', { sync: pathForFile }], ['cosmos.onProgress', 'on:hq:cosmos:index-progress'],
      ],
    };
  })();
  // END cosmos-rows

  // Home › Where today went (hq.today.read): an INVENTED day in the shape dashboard/day-core.mjs builds. dayOffset 0..3 = a full day (three
  // invented projects, a browser lane, a sleep, commit ticks); 4..6 = the partial day (no Claude source, browser not kept, no app log); anything
  // else is refused as main refuses it. Same data as placeholderDay in src/selftest-today.mjs (a classic script cannot import it).
  const todayRead = (o) => {
    const n = o && typeof o === 'object' && !Array.isArray(o) ? o.dayOffset : undefined;
    if (!Number.isInteger(n) || n < 0 || n > 6) return { error: 'dayOffset must be a whole number from 0 to 6' };
    const day = ['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04'][n], today = n === 0;
    const blk = (lane, list) => list.map(([a, b]) => ({ lane, kind: 'block', startMin: a, endMin: b }));
    const base = { ok: true, dayOffset: n, day, isToday: today, nowMin: today ? 14 * 60 + 20 : null, tzOffsetMin: 0, generatedAt: day + 'T14:20:00.000Z' };
    if (n >= 4) {
      const ln = (id, kind, state, note) => ({ id, kind, ref: null, state, ...(note ? { note } : {}) });
      return { ...base,
        lanes: [ln('claude', 'claude', 'unavailable', 'Claude lane: update the Hub (this one does not know the day query yet)'), ln('browser', 'browser', 'not-kept', 'browser lane is kept for 3 days'),
          ln('power', 'power', 'unavailable', 'PC lane: no app log for this day (the app was not running, or the log is older than 30 days)'), ln('commits', 'commits', 'ok')],
        spans: [], ticks: [{ lane: 'commits', min: 700, count: 2 }],
        caption: 'Claude blocks unavailable, 2 commits, PC sleep unknown', counts: { claudeBlocks: null, claudeProjects: null, commits: 2, asleepMinutes: null, browserMinutes: null },
        notes: ['Claude lane: update the Hub (this one does not know the day query yet)', 'browser lane is kept for 3 days', 'PC lane: no app log for this day (the app was not running, or the log is older than 30 days)'] };
    }
    const cl = (i, ref, blocks) => ({ id: 'claude-' + i, kind: 'claude', ref, state: 'ok', blocks });
    return { ...base,
      lanes: [cl(1, 'code:alpha-site', 22), cl(2, 'code:beta-app', 11), cl(3, 'code:gamma-notes', 4),
        { id: 'browser', kind: 'browser', ref: null, state: 'ok' }, { id: 'power', kind: 'power', ref: null, state: 'ok' }, { id: 'commits', kind: 'commits', ref: null, state: 'ok' }],
      spans: [...blk('claude-1', [[540, 580], [600, 640], [760, 790]]), ...blk('claude-2', [[620, 660], [800, 830]]), ...blk('claude-3', [[840, 860]]),
        { lane: 'browser', kind: 'focus', startMin: 530, endMin: 560 }, { lane: 'browser', kind: 'focus', startMin: 700, endMin: 735 },
        { lane: 'power', kind: 'awake', startMin: 480, endMin: 690 }, { lane: 'power', kind: 'asleep', startMin: 690, endMin: 750 }, { lane: 'power', kind: 'awake', startMin: 750, endMin: today ? 860 : 1080 },
        { lane: 'power', kind: 'unknown', startMin: 0, endMin: 480 }],
      ticks: [{ lane: 'commits', min: 585, count: 1 }, { lane: 'commits', min: 655, count: 2 }, { lane: 'commits', min: 805, count: 1 }],
      caption: '37 five-minute blocks with Claude across 3 projects, 4 commits, PC asleep 1 h',
      counts: { claudeBlocks: 37, claudeProjects: 3, commits: 4, asleepMinutes: 60, browserMinutes: 65 },
      notes: ['PC lane: stretches with no app log line are shown as unknown, never as asleep'] };
  };

  // [method path, kind]: WRITE resolves true · SEND returns undefined · 'on:<channel>'
  // subscribes · a function is the canned answer. Mirrors dashboard/preload.js
  // top to bottom (tools/cdp-gate.mjs --scenario fake-parity diffs the two).
  let macOn = false;   // the Money-access switch (hq.moneyAccess); control.reset puts it back off
  const SPEC = [
    ['runScan', WRITE], ['openRepo', WRITE], ['openFile', WRITE], ['reclaim', WRITE], ['snapshot', WRITE],
    ['captureSave', WRITE], ['claudeQuest', WRITE],
    ['draftCommit', () => ({ message: 'chore: fake draft', via: 'local:fake' })], ['doCommit', () => ({ ok: true })],
    ['probeLlm', () => ({ available: true, runtime: 'fake', chatModel: 'fake-model' })],
    ['llm.warm', () => ({ status: 'warm', model: 'fake-model' })], ['llm.chat', chat], ['llm.cancel', cancelChat], ['llm.onDelta', 'on:hq:llm:delta'],
    ['uiPrefs.get', () => prefs], ['uiPrefs.set', setPrefs], ['uiPrefs.on', 'on:hq:ui-prefs'],
    ['claudeHub.health', () => ({ state: 'ready', role: 'writer', node: 'v25.6.1', backfill: { done: 3, total: 3 }, counts: { projects: 2, conversations: 3, messages: 5 }, dbBytes: 1048576 })],
    ['claudeHub.projects', () => HUB_PROJECTS], ['claudeHub.conversations', () => HUB_CONVS],
    ['claudeHub.conversation', (id) => hubThread(id)], ['claudeHub.search', () => HUB_HITS],
    ['claudeHub.stats', () => ({ from: '2026-09-06', to: '2026-10-05', tzOffsetMin: 0,
      days: [{ day: '2026-10-03', chats: 1, messages: 2, active_ms: 0 }, { day: '2026-10-04', chats: 1, messages: 4, active_ms: 120000 }],
      projects: [{ project_id: HUB_PROJECTS[0].id, name: 'project-a', chats: 2, tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10 }],
      totals: { chats: 2, active_ms: 120000, tokens_in: 6, tokens_out: 40, tokens_cache_read: 100, tokens_cache_write: 10 } })],
    ['claudeHub.link', WRITE], ['claudeHub.forget', WRITE], ['claudeHub.reindex', () => ({ started: true })],   // hqFake.set('claudeHub.reindex', {error, indexOnly}) answers the Hub's refusal; health may carry indexOnly the same way
    ['claudeHub.documents', () => HUB_DOCS],
    ['claudeHub.document', (id) => { const d = HUB_DOCS.find((x) => x.id === id); return d ? { ...d, text: 'Offer fake tea first.\nFake second line.', meta: null } : null; }],
    ['claudeHub.on', 'on:hq:claude-hub:event'],
    // Claude Hub H5: Save to vault (canned draft; save resolves true and is recorded)
    ['claudeVault.preview', (id) => ({ path: 'C:\\fake-vault\\30_Areas\\Claude\\project-a\\2026-10-01 Fake release planning.md', rel: '30_Areas/Claude/project-a/2026-10-01 Fake release planning.md', exists: false, model: 'fake-model', basis: 4,
      markdown: '---\nsource: claude-code\nconversation: ' + JSON.stringify(String(id)) + '\nproject: "[[project-a]]"\ncreated: 2026-10-16\nchat_date: 2026-10-01\ntitle: "Fake release planning"\ndrafted_by: "local model fake-model, from 4 chat messages"\ntags: [claude]\n---\n\n# Fake release planning\n\nProject: [[project-a]] · chat of 2026-10-01\n\n## Summary\nThe fake release ships Friday.\n\n## Decisions\n- ship Friday\n\n## To-dos\n- [ ] tag\n\n## Links\n- none\n' })],
    ['claudeVault.save', WRITE],
    ['claudeChat.send', chatTurn], ['claudeChat.cancel', cancelTurn], ['claudeChat.on', 'on:hq:claude-chat:event'],
    ['liveState', () => ({ dev: [], casts: [], scan: { state: 'idle' } })], ['onScanStatus', 'on:hq:scan-status'],
    ['openAt', WRITE], ['onNavigate', 'on:hq:navigate'],
    ['commitPreview', () => ({
      files: [{ path: 'src/a.js', status: 'M', env: false }, { path: 'sub/.env', status: '??', env: true }, { path: '.env.example', status: '??', env: false }],
      stat: ' src/a.js | 2 +-', envHits: ['sub/.env'], branch: 'main',
    })],
    ['use', WRITE],   // usage counter (hq:use): recorded, no answer read
    ['reach.read', () => ({ at: '2026-11-07T09:00:00.000Z', rows: REACH_ROWS })],
    ['logDecision', WRITE], ['learn', WRITE], ['archiveProject', WRITE], ['reviveProject', WRITE], ['markQuestDone', WRITE], ['actedOn', WRITE],
    ['healthScan', () => ({ organs: [] })], ['healthFix', () => ({ ok: true, output: 'fake fix ran' })], ['pcOpenFolder', () => true], ['githubRefresh', () => ({ state: 'signed-out', at: '2026-01-01T00:00:00.000Z', error: 'fake' })], ['githubOpen', () => true], ['accountsRefresh', () => ({ v: 1, vercel: { state: 'signed-out', at: '2026-01-01T00:00:00.000Z', error: 'fake' }, supabase: { state: 'no-cli', at: '2026-01-01T00:00:00.000Z', error: 'fake' } })], ['accountsOpen', () => true], ['vaultOpen', (name, how) => ({ ok: true, how })],
    ['getSessions', () => []], ['sessionStart', () => ({ jobId: 'j-fake' })], ['sessionKill', WRITE],
    ['sessionDiff', () => ({ files: [], stat: '' })], ['onSessionOutput', 'on:hq:session-output'], ['onClaudeSessions', 'on:hq:claude-sessions'],
    ['devStart', WRITE], ['devStop', WRITE], ['saveNote', WRITE], ['onDevStatus', 'on:hq:dev-status'],
    ['castSpell', cast], ['cancelCast', WRITE], ['getSpellbook', () => ({ spells: [] })], ['favoriteSpell', WRITE], ['rescanSpellbook', () => ({ ok: true })],
    ['getSpellTelemetry', () => ({ casts: [], favorites: [], confirmed_hashes: {} })], ['hideCastPalette', WRITE],
    ['onCastOutput', 'on:hq:cast-output'], ['onCastDone', 'on:hq:cast-done'],
    ['showMain', WRITE], ['killServers', WRITE], ['onMachine', 'on:hq:machine'],
    ['getBrowserLive', () => null], ['onBrowserTab', 'on:hq:browser-tab'],
    ['brief.read', () => ({ brief: BRIEF })],
    ['brief.dismiss', (key) => ({ brief: Object.assign({}, BRIEF, { items: BRIEF.items.filter((i) => i.key !== key) }) })],
    ['brief.onBrief', 'on:hq:brief'],
    // the quick-run palette's bridge (hq.quick, cast.html only; the main window never calls it): invented rows, no names
    ['quick.read', () => ({ brief: [{ ref: 'aaaaaaaaaaaa', label: 'A project has secrets in plain sight', scan: false }], status: 'ok', projects: [{ id: 'project-a', name: 'Project A' }] })],
    ['quick.openBrief', () => 'go'], ['quick.openGo', () => ({ ok: true })],
    // act in place on a Brief row (hq.brief.act): a placeholder that answers like main's table does. The rule comes from the key's first segment; a key no rule
    // owns (a forged one), a verb of another rule and a bad balance are refused with main's own words. quest-done and confirm-balance answer an acted marker,
    // commit answers { open:'commit', projectId: 'p1' }, open-folder answers { ok }.
    ['brief.act', (key, verb, value) => {
      const VERBS = { 'quest-red': ['quest-done'], 'money-stale': ['confirm-balance'], dirty: ['commit'], 'session-left-dirty': ['commit'], 'session-waiting': ['open-folder'] };
      const rule = typeof key === 'string' ? key.split(':')[0] : '';
      if (!Object.prototype.hasOwnProperty.call(VERBS, rule)) return { error: 'that item is not on the brief any more.' };
      if (!VERBS[rule].includes(verb)) return { error: 'that action is not offered for this item.' };
      if (verb === 'confirm-balance' && !(typeof value === 'string' && /^[0-9\s.,]+$/.test(value.trim()) && /[0-9]/.test(value))) return { error: 'type a balance as a number.' };
      if (verb === 'commit') return { ok: true, open: 'commit', projectId: 'p1' };
      if (verb === 'open-folder') return { ok: true };
      return { ok: true, acted: { verb, at: new Date().toISOString() } };
    }],
    ['sessionsBoard.read', () => ({ board: SESSIONS_BOARD })], ['sessionsBoard.resume', () => ({ ok: true })], ['sessionsBoard.openFolder', () => ({ ok: true })],
    ['sessionsBoard.onBoard', 'on:hq:sessions-board'],
    ['delivery.read', (id) => DLV.read(id)], ['delivery.apply', (intent) => DLV.apply(intent)], ['delivery.clients', () => DLV.clients()],
    ['deliveryCheck.detect', (id) => DCK.detect(id)], ['deliveryCheck.run', (id, url) => DCK.run(id, url)], ['deliveryCheck.read', (id) => DCK.read(id)], ['deliveryCheck.forget', (id) => DCK.forget(id)],
    ['money.read', () => ({ view: MONEY.full })],
    // money in one minute + one line per spend: start / log-line / dry answer with placeholder values; a line main would refuse ('hello') answers its own words
    ['money.apply', (intent) => {
      const t = intent && intent.type;
      if (t === 'log' && !intent.amount) return { error: 'amount needs a number above 0.' };
      if (t === 'start') return { view: MONEY.full, note: 'Money started · 1 account added' };
      if (t === 'log-line') {
        const text = String(intent.text || '').trim();
        if (!/[0-9]/.test(text) || /^hello/i.test(text)) return { error: 'type it like 150 cafe' };
        if (intent.dry) return { preview: { kind: 'log', amount: 150, currency: 'DA', category: 'Food', account: 'Cash', date: '2026-11-05', label: '150 DA · Food · Cash', reason: '' } };
        return { view: MONEY.full, note: 'logged 150 DA · Food · Cash — undo in Recent' };
      }
      return { view: MONEY.full, note: 'saved' };
    }],
    ['money.importFile', () => ({ canceled: true })], ['money.exportFile', () => ({ canceled: true })],
    ['moneyAccess.read', () => ({ on: macOn, lastAskedAt: null })], ['moneyAccess.set', (on) => (typeof on === 'boolean' ? { on: (macOn = on) } : { error: 'on must be true or false' })],   // Settings: Claude sessions may read Money (words only); off, never asked
    ['briefHistory.read', () => ({ entries: [], clearedThisWeek: 0, dismissedThisWeek: 0, allClear: null, notice: '' })], ['briefHistory.ack', () => ({ ok: true, acked: false })],   // Brief history: nothing remembered; no all-clear card is due
    ['today.read', todayRead],   // Home › Where today went: invented days, offsets 0..3 full, 4..6 partial, others refused
    // Cosmos space (hq:cosmos:*): rows generated beside the fixture (the cosmos-rows block above SPEC); pathForFile is SYNCHRONOUS ('' bare, like the real preload)
    ...COSMOS.rows,
  ];

  const answer = (method, kind, args) => {
    try {
      if (overrides.has(method)) {
        const v = overrides.get(method);
        if (typeof v === 'function') return Promise.resolve(v(...args));
        if (v && typeof v === 'object' && '__reject' in v) return Promise.reject(new Error(String(v.__reject)));
        return Promise.resolve(v);
      }
      return Promise.resolve(kind === WRITE ? true : kind(...args));
    } catch (e) { return Promise.reject(e); }
  };
  const make = (method, kind) => {
    if (typeof kind === 'string' && kind.startsWith('on:')) {
      const channel = kind.slice(3);
      alias.set(method, channel);
      return (cb) => {
        record(method, [cb]);
        if (typeof cb !== 'function') return () => {};
        if (!subs.has(channel)) subs.set(channel, new Set());
        subs.get(channel).add(cb);
        return () => { subs.get(channel).delete(cb); };
      };
    }
    if (kind === SEND) return (...args) => { record(method, args); };
    // { sync: fn }: a preload helper that is not an IPC call (cosmos.pathForFile) answers at once, not through a promise; hqFake.set can still override it
    if (kind && typeof kind === 'object' && typeof kind.sync === 'function') return (...args) => { record(method, args); if (overrides.has(method)) { const v = overrides.get(method); return typeof v === 'function' ? v(...args) : v; } return kind.sync(...args); };
    return (...args) => { record(method, args); return answer(method, kind, args); };
  };

  const hq = {};
  for (const [method, kind] of SPEC) {
    const keys = method.split('.');
    let o = hq;
    for (const k of keys.slice(0, -1)) o = o[k] || (o[k] = {});
    o[keys[keys.length - 1]] = make(method, kind);
  }

  const control = {
    calls: (method) => log.filter((c) => !method || c.method === method).map((c) => ({ ...c })),
    reset: (all) => {
      log.length = 0; casts = 0; DLV.reset(); DCK.reset(); COSMOS.reset(); macOn = false;   // the client delivery fixture goes back to its seed
      for (const id of [...chats.keys()]) cancelChat(id);
      for (const t of turns.values()) t.timers.forEach(clearTimeout); turns.clear();   // Claude Hub H3 fake chat turns
      if (all) { overrides.clear(); prefs = { ...DEFAULT_PREFS }; if (storage) writePersisted({}); }
      return true;
    },
    emit: (channel, payload) => push(alias.get(channel) || channel, payload),
    set: (method, value, o) => {
      if (!SPEC.some(([m]) => m === method)) throw new Error('hqFake.set: no such method ' + method);
      const persist = !!(o && o.persist);
      if (persist && !storage) throw new Error('hqFake.set: nowhere to persist (no storage)');
      if (persist && typeof value === 'function') throw new Error('hqFake.set: only JSON values persist across reloads');
      if (value === undefined) overrides.delete(method); else overrides.set(method, value);
      if (persist) { const p = readPersisted(); if (value === undefined) delete p[method]; else p[method] = JSON.parse(JSON.stringify(value)); writePersisted(p); }
      return true;
    },
  };
  // a value persisted by an earlier load of this tab answers from the start (before boot.js reads it)
  for (const [m, v] of Object.entries(readPersisted())) if (SPEC.some(([k]) => k === m)) overrides.set(m, v);
  return { hq, control, methods: SPEC.map(([m]) => m) };
}

// In the renderer's preload world: expose both. Under plain Node (no Electron)
// this file only exports the factory.
let electron = null;
try { electron = require('electron'); } catch {}
if (electron && typeof electron === 'object' && electron.contextBridge) {
  let storage = null;
  try { storage = window.sessionStorage; } catch {}   // per tab, survives Page.reload (set(…, {persist:true}))
  const fake = createFake({ storage });
  electron.contextBridge.exposeInMainWorld('hq', fake.hq);
  electron.contextBridge.exposeInMainWorld('hqFake', fake.control);
}
if (typeof module === 'object' && module && module.exports) module.exports = { createFake };
