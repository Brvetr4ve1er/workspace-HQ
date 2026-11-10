// Act in place from a Brief row, main side (dish brief-act-waiting; the pure rules are brief-act-core.mjs).
//
//   hq:brief:act ({ key, verb, value? }) → { ok:true, acted:{verb,at} } | { ok:true, open:'commit', projectId } | { ok:true } | { error }
//
// Every effect is an injected seam, so a test drives it with fakes and nothing here reaches the disk, the money file or Explorer itself:
//   getBrief()      → the CURRENT brief (brief.js's last compute, decorated or not)           (sync or async)
//   sources()       → { redQuests:[{id}], staleAccounts:[{id,anchorAt}], waitingSessions:[{id,lastAt}] }  the live records the rules were built from
//   applyDone(ids)  → main.js applyDone: quest-overrides.json + assemble only, never render
//   moneyApply(i)   → the money engine's apply (money.js): one intent, account-save, which re-anchors at now with the typed balance
//   openFolder(id)  → { ok } | { error }: the sessions board's own open-folder rule (shell.openPath only — it never runs anything)
//   useMark(s, a)   → use-log's mark (surface 'brief-act', action 'act': nothing else is logged to the use log)
//   appLog(line)    → one app-log line; rule ids and verbs only, never a name, id, path or amount
//   onActed()       → called after a state-changing verb so the brief re-decorates and pushes (brief.recompute)
//   now()           → ms
//
// A verb that is refused writes nothing and logs nothing with a name. Two clicks on the same key while one is in flight: the second is
// refused (an in-flight guard per key). After the async reads, the key is checked against the brief ONCE MORE before anything is performed
// (a recompute can land between the two). NEVER push, never any outbound action, never a verb for a rule not in the table.
// The acted markers live in memory only: they do not survive an app restart (stated in HANDOFF); a repeated quest-done is then a no-op in
// applyDone and a repeated balance confirm is impossible (confirming re-anchors, so the old key is gone from the brief).
const path = require('path');
const { pathToFileURL } = require('url');

let core = null;
const lib = () => core || (core = import(pathToFileURL(path.join(__dirname, 'brief-act-core.mjs')).href));

const msg = (e) => String((e && e.message) || e).slice(0, 200);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function create({ getBrief, sources, applyDone, moneyApply, openFolder, useMark, appLog, onActed, now = () => Date.now() } = {}) {
  const inflight = new Set();
  let acted = {};
  const log = (line) => { try { if (typeof appLog === 'function') appLog(line); } catch { /* logging never fails a click */ } };
  const mark = () => { try { if (typeof useMark === 'function') useMark('brief-act', 'act'); } catch { /* a usage mark is a bonus */ } };
  const tell = () => { try { if (typeof onActed === 'function') onActed(); } catch { /* a refresh is a courtesy */ } };

  async function act(req) {
    const L = await lib();
    const key = isObj(req) && typeof req.key === 'string' ? req.key : '';
    if (!key || key.length > L.KEY_MAX) return { error: 'unknown item.' };
    if (inflight.has(key)) return { error: 'already working on that one — a moment.' };
    inflight.add(key);
    let rule = '?', verb = isObj(req) && typeof req.verb === 'string' ? req.verb.slice(0, 20) : '?';
    try {
      let brief, src;
      try { brief = await getBrief(); } catch { return { error: 'the brief could not be read.' }; }
      try { src = typeof sources === 'function' ? await sources() : null; } catch { src = null; }
      const t = now();
      acted = L.prune(acted, brief, t);
      const p = L.planAct(req, { brief, sources: src, acted, now: t });
      if (p.error) { log('[brief-act] refused · ' + (Object.keys(L.VERBS).includes(verb) ? verb : 'unknown verb')); return { error: p.error }; }
      rule = p.rule; verb = req.verb;
      // a recompute can land while the sources were read: look again before anything is performed
      let again; try { again = await getBrief(); } catch { again = null; }
      if (!L.findItem(again, key)) { log('[brief-act] refused · ' + rule + ' · ' + verb + ' · changed while reading'); return { error: 'that item changed while you clicked — nothing was done.' }; }

      const plan = p.plan;
      if (plan.kind === 'commit') {
        // performed by the renderer through the existing commit overlay (its .env guard and Commit confirm stay as they are)
        mark(); log('[brief-act] handed over · ' + rule + ' · ' + verb);
        return { ok: true, open: 'commit', projectId: plan.projectId };
      }
      if (plan.kind === 'open-folder') {
        let r;
        try { r = typeof openFolder === 'function' ? await openFolder(plan.sessionId) : { error: 'opening a folder is not available.' }; }
        catch (e) { r = { error: msg(e) }; }
        if (!isObj(r) || r.error) { log('[brief-act] failed · ' + rule + ' · ' + verb); return { error: (isObj(r) && r.error) || 'could not open the folder.' }; }
        mark(); log('[brief-act] done · ' + rule + ' · ' + verb);
        return { ok: true };
      }
      if (plan.kind === 'quest-done') {
        try { if (typeof applyDone !== 'function') throw new Error('marking quests done is not available.'); await applyDone([plan.id]); }
        catch (e) { log('[brief-act] failed · ' + rule + ' · ' + verb); return { error: 'could not mark it done — ' + msg(e) }; }
      } else {   // confirm-balance: the money engine re-validates and re-anchors at now with the typed balance; this adds nothing of its own
        let r;
        try { r = typeof moneyApply === 'function' ? await moneyApply({ type: 'account-save', id: plan.id, balance: plan.balance }) : { error: 'money is not available.' }; }
        catch (e) { r = { error: msg(e) }; }
        if (!isObj(r) || r.error) { log('[brief-act] failed · ' + rule + ' · ' + verb); return { error: (isObj(r) && r.error) || 'that did not save.' }; }
      }
      const at = new Date(now());
      acted = L.markActed(acted, key, verb, at);
      mark(); log('[brief-act] done · ' + rule + ' · ' + verb);
      tell();
      return { ok: true, acted: { verb, at: acted[key].at } };
    } finally { inflight.delete(key); }
  }

  /** The brief with the acted markers added (brief.js calls this before it writes and pushes). Expired and gone markers are pruned first. */
  async function decorate(brief) {
    const L = await lib();
    acted = L.prune(acted, brief, now());
    return L.decorate(brief, acted, now());
  }

  return { act, decorate, _acted: () => ({ ...acted }), _inflight: () => inflight.size };
}

function init({ ipcMain, ...deps } = {}) {
  const a = create(deps);
  if (ipcMain && typeof ipcMain.handle === 'function') ipcMain.handle('hq:brief:act', (_e, req) => a.act(req).catch((e) => ({ error: msg(e) })));
  return a;
}

module.exports = { create, init };
