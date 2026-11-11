// The app door, app side (dish brief-mailbox; the pure rules are intent-core.mjs). A file mailbox under data/intents/ that lets a Claude
// session (through the MCP tool hq_brief_dismiss, mcp/workspacehq/app-door.mjs) ask the RUNNING app to dismiss one Brief row.
// No IPC, no port, nothing a session can reach but a file; the app answers in a file, and says "done" only when it really changed something.
//
//   create({ dataDir, getBrief, dismissKey, audit?, log?, now?, pid?, fsImpl? }) → { start(), stop(), sweep(), recover(), writeHeartbeat(), dirs }
//   init({ dataDir, brief, log?, watch?, sweepMs?, heartbeatMs?, ... })          → create() + start(): the one line main.js calls after briefApi is made
//
//     getBrief()        → the CURRENT brief (brief.js's current()): { items, overflow, standing } | null          (sync or async)
//     dismissKey(key)   → { changed } — brief.js's dismiss path (the same one hq:brief:dismiss takes), settled like the IPC handler  (sync or async)
//     audit             → { record(fields), read() → { entries } }   default: dashboard/assist-audit.mjs on dataDir (the existing shared log)
//     log(line)         → one app-log line; codes and counts only, never a ref, key, id or item text
//     now()             → ms
//
// Per pass: at most 10 request files are examined; a name that is not <32 hex>.json, a symlink and a directory are ignored and counted and never
// touched; the size, age and date checks run before anything is applied; a request is CLAIMED by renaming it to <id>.taken (the second claimant gets
// ENOENT and does nothing); then the decision table (cap, one top-three row, not urgent), then dismissKey, and the answer file says ok:true ONLY
// when dismissKey reported changed:true. A <id>.taken found at start is NEVER re-run: it is answered "interrupted, it may have run" and audited so.
// The answer is written atomically (temp then rename); answers older than an hour are swept; the heartbeat is written every 20 s and removed at quit.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

let coreP = null;
const core = () => coreP || (coreP = import(pathToFileURL(path.join(__dirname, 'intent-core.mjs')).href));
let auditP = null;
const auditMod = () => auditP || (auditP = import(pathToFileURL(path.join(__dirname, 'assist-audit.mjs')).href));

function create({ dataDir, getBrief, dismissKey, audit, log, now = () => Date.now(), pid = process.pid, fsImpl } = {}) {
  const f = fsImpl || fs;
  const root = path.join(dataDir, 'intents');
  const inbox = path.join(root, 'inbox');
  const answers = path.join(root, 'answers');
  const hbFile = path.join(root, 'app.json');
  const note = (line) => { try { if (typeof log === 'function') log(line); } catch { /* a log line never fails the door */ } };
  const aud = audit || {
    record: async (fields) => (await auditMod()).record(dataDir, fields),
    read: async () => (await auditMod()).read(dataDir),
  };

  let timers = [], watcher = null, started = false;

  function ensureDirs() { f.mkdirSync(inbox, { recursive: true }); f.mkdirSync(answers, { recursive: true }); }
  function writeAtomic(file, text) {
    const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    try { f.writeFileSync(tmp, text); f.renameSync(tmp, file); }
    catch (e) { try { f.unlinkSync(tmp); } catch { /* never written */ } throw e; }
  }
  const unlink = (file) => { try { f.unlinkSync(file); return true; } catch { return false; } };
  const exists = (file) => { try { f.lstatSync(file); return true; } catch { return false; } };

  async function writeAnswer(id, obj) {
    try { ensureDirs(); const C = await core(); writeAtomic(path.join(answers, C.answerName(id)), JSON.stringify(obj)); return true; }
    catch { note('intent: answer not written'); return false; }
  }

  async function writeHeartbeat() {
    if (!started) return false;
    try { ensureDirs(); const C = await core(); writeAtomic(hbFile, JSON.stringify(C.heartbeatBody(pid, now()))); return true; }
    catch { return false; }
  }

  // a request that cannot be applied: its own answer in words (the door is waiting on it), then the file goes
  async function refuse(C, id, file, r, out) {
    await writeAnswer(id, C.answer(false, r.error, now()));
    unlink(file);
    out.refused += 1;
    note('intent: refused (' + r.code + ')');
  }

  async function applyClaimed(C, id, taken, req, out) {
    let ans;
    try {
      const brief = typeof getBrief === 'function' ? await getBrief() : null;
      const entries = ((await aud.read()) || {}).entries || [];
      const d = C.decide({ req, brief, entries, now: now() });
      if (!d.apply) { ans = C.answer(false, d.error, now()); out.refused += 1; note('intent: refused (' + d.code + ')'); }
      else {
        const t0 = now();
        const r = typeof dismissKey === 'function' ? await dismissKey(d.key) : null;
        if (r && r.changed === true) {
          // the audit line first (the cap counts it), the answer second; a crash between leaves a .taken, which the next start answers "may have run"
          await aud.record({ at: now(), door: 'mcp', tool: C.AUDIT_TOOL, tier: 'note', ok: true, ms: now() - t0, pid });
          ans = C.answer(true, '', now());
          out.applied += 1;
          note('intent: applied (brief.dismiss)');
        } else {
          ans = C.answer(false, C.WORDS.movedOn, now());   // a dismissal that did nothing is never reported as done
          out.refused += 1;
          note('intent: refused (no-change)');
        }
      }
    } catch {
      ans = C.answer(false, C.WORDS.failed, now());
      out.refused += 1;
      note('intent: failed');
    }
    await writeAnswer(id, ans);
    unlink(taken);
  }

  async function handle(C, id, name, out) {
    const file = path.join(inbox, name);
    let st;
    try { st = f.lstatSync(file); } catch { return; }                     // gone: another claimant, or the door's own cleanup
    if (!st.isFile()) { out.ignored += 1; return; }                       // a symlink or a directory is never followed, read or removed
    const t = now();
    const meta = C.checkFileMeta({ isFile: true, size: st.size, mtimeMs: st.mtimeMs }, t);
    if (!meta.ok) return refuse(C, id, file, meta, out);
    let text;
    try { text = f.readFileSync(file, 'utf8'); } catch { return; }
    const v = C.validateRequest(text, st.mtimeMs, t);
    if (!v.ok) return refuse(C, id, file, v, out);
    const taken = path.join(inbox, C.takenName(id));
    try { f.renameSync(file, taken); } catch { out.lost += 1; return; }    // ENOENT: someone else claimed it first — do nothing
    return applyClaimed(C, id, taken, v.req, out);
  }

  async function sweepAnswers(C) {
    let names; try { names = f.readdirSync(answers); } catch { return; }
    const t = now();
    for (const n of names) {
      const isAns = /^[0-9a-f]{32}\.answer\.json$/.test(n), isTmp = n.endsWith('.tmp');
      if (!isAns && !isTmp) continue;
      const file = path.join(answers, n);
      let st; try { st = f.lstatSync(file); } catch { continue; }
      if (!st.isFile()) continue;
      if (isAns ? C.isOldAnswer(st.mtimeMs, t) : C.isOldTmp(st.mtimeMs, t)) unlink(file);
    }
  }

  async function pass() {
    const C = await core();
    const out = { examined: 0, applied: 0, refused: 0, ignored: 0, lost: 0, deferred: 0 };
    let ents;
    try { ents = f.readdirSync(inbox, { withFileTypes: true }); } catch { ents = null; }
    if (ents) {
      ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const ent of ents) {
        const p = C.parseName(ent.name);
        if (!p) { out.ignored += 1; continue; }                           // foreign name: counted, never touched
        if (p.kind === 'taken') continue;                                 // in flight, or left from a crash (recover() handles those at start)
        if (p.kind === 'tmp') {                                           // the door's half-written file: only an old orphan goes
          const file = path.join(inbox, ent.name);
          try { const st = f.lstatSync(file); if (st.isFile() && C.isOldTmp(st.mtimeMs, now())) unlink(file); } catch { /* gone */ }
          continue;
        }
        if (!ent.isFile()) { out.ignored += 1; continue; }                // symlink / directory under a request's name
        if (out.examined >= C.LIMITS.maxExamine) { out.deferred += 1; continue; }
        out.examined += 1;
        await handle(C, p.id, ent.name, out);
      }
    }
    await sweepAnswers(C);
    return out;
  }

  // one pass at a time within this process: a burst of watcher events cannot run two applies side by side
  let chain = Promise.resolve();
  function sweep() {
    const p = chain.then(pass, pass);
    chain = p.then(() => {}, () => {});
    return p.catch(() => ({ examined: 0, applied: 0, refused: 0, ignored: 0, lost: 0, deferred: 0, error: true }));
  }

  // at start: a request found claimed was in flight when the app stopped; it may or may not have run, so it is NEVER run again
  async function recover() {
    const C = await core();
    let ents; try { ents = f.readdirSync(inbox, { withFileTypes: true }); } catch { return 0; }
    let n = 0;
    for (const ent of ents) {
      const p = C.parseName(ent.name);
      if (!p || p.kind !== 'taken') continue;
      const file = path.join(inbox, ent.name);
      if (!ent.isFile()) continue;
      if (!exists(path.join(answers, C.answerName(p.id)))) {              // a request that was already answered finished; only its leftover goes
        await writeAnswer(p.id, C.answer(false, C.WORDS.interrupted, now()));
        try { await aud.record({ at: now(), door: 'mcp', tool: C.AUDIT_TOOL, tier: 'note', ok: false, reason: C.MAY_HAVE_RUN, pid }); } catch { /* the audit is a log */ }
        note('intent: found a claimed request at start (may have run)');
        n += 1;
      }
      unlink(file);
    }
    return n;
  }

  async function start({ watch = true, sweepMs, heartbeatMs } = {}) {
    if (started) return;
    started = true;
    const C = await core();
    try { ensureDirs(); } catch { note('intent: data/intents could not be created'); }
    await writeHeartbeat();
    await recover();
    await sweep();
    if (!started) return;   // stopped while starting
    const every = (fn, ms) => { if (ms > 0) { const h = setInterval(fn, ms); if (h.unref) h.unref(); timers.push(h); } };
    every(() => { sweep(); }, sweepMs === undefined ? C.LIMITS.sweepEveryMs : sweepMs);
    every(() => { writeHeartbeat(); }, heartbeatMs === undefined ? C.LIMITS.heartbeatEveryMs : heartbeatMs);
    if (watch) {
      let debounce = null;
      try {
        watcher = f.watch(inbox, () => { clearTimeout(debounce); debounce = setTimeout(() => { sweep(); }, 60); if (debounce.unref) debounce.unref(); });
        watcher.on && watcher.on('error', () => {});
      } catch { watcher = null; }       // the 5 s sweep still finds it
    }
  }

  // quit: no more passes, and the heartbeat goes, so a door answers "the app is closed" at once instead of waiting out a minute
  function stop() {
    for (const h of timers) clearInterval(h);
    timers = [];
    if (watcher) { try { watcher.close(); } catch { /* closed */ } watcher = null; }
    started = false;
    try {
      const j = JSON.parse(f.readFileSync(hbFile, 'utf8'));
      if (j && j.pid === pid) unlink(hbFile);                              // only our own heartbeat
    } catch { /* none to remove */ }
  }

  return { start, stop, sweep, recover, writeHeartbeat, dirs: { root, inbox, answers, hbFile } };
}

function init({ dataDir, brief, getBrief, dismissKey, log, watch = true, sweepMs, heartbeatMs, audit, now, pid } = {}) {
  const d = create({
    dataDir, audit, log, now, pid,
    getBrief: getBrief || (() => (brief && typeof brief.current === 'function' ? brief.current() : null)),
    dismissKey: dismissKey || ((key) => (brief && typeof brief.dismissKey === 'function' ? brief.dismissKey(key) : { changed: false })),
  });
  d.start({ watch, sweepMs, heartbeatMs }).catch(() => {});
  return d;
}

module.exports = { create, init };
