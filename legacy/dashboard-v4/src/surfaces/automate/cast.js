// cast.js — the casting seam, ported INTO the AUTOMATE surface (v4.1 S4).
// Source of truth: legacy/dashboard-v3/src/ui/components.js (castSpell / showCastConfirm
// / castlogLine) + legacy/dashboard-v3/src/fx.js (wireCastStream). v4 core is not
// touched: the confirm gate, the run log, and the stream subscriptions all live
// here and die with the surface.
//
// Flow (unchanged from v3): id -> main-process whitelist (hq:spell-cast) ->
// dry-run confirm (the user sees the EXACT command line before it ever runs)
// -> re-invoke with the confirmed content_hash -> output streams in on
// hq:cast-output / hq:cast-done.
//
// UNTRUSTED TEXT: every streamed chunk and every main-process error string
// reaches the DOM through textContent only. The confirm preview's fields go
// through esc() into innerHTML.
//
// LIFECYCLE: createCastEngine() is per-mount. dispose() (pushed into the
// view's teardown) unhooks both stream subscriptions and closes an open
// confirm overlay; the log's DOM lives inside the surface root, so unmount
// removing the root removes it too. Every continuation after an await checks
// alive() before touching anything.
import { el, esc } from '../../ui/util.js';

const MAX_BLOCKS = 20;       // cast blocks kept in the log
const MAX_LINES = 400;       // lines per block (v3's bounded buffer)

export function createCastEngine({ hq, host, alive }) {
  const blocks = new Map();  // castId -> <pre>
  let confirmEl = null;

  // ---------------------------------------------------------------- run log
  const logEl = el('div', 'castlog');
  const emptyEl = el('div', 'empty',
    'No runs yet. Output from casts appears here while AUTOMATE is open — ' +
    'runs started elsewhere (or while you were on another surface) are not replayed.');
  logEl.appendChild(emptyEl);
  const bodyEl = el('div', 'castlog-body');
  logEl.appendChild(bodyEl);

  function blockFor(castId) {
    let pre = castId ? blocks.get(castId) : null;
    if (pre && pre.isConnected) return pre;
    emptyEl.hidden = true;
    const block = el('div', 'cl-block');
    const head = el('div', 'cl-block-head');
    block.appendChild(head);
    pre = el('pre', 'term cl-pre');
    block.appendChild(pre);
    bodyEl.appendChild(block);
    if (castId) blocks.set(castId, pre);
    // bounded: oldest blocks fall off, and their map entries with them
    while (bodyEl.children.length > MAX_BLOCKS) bodyEl.removeChild(bodyEl.firstChild);
    for (const [id, p] of blocks) if (!p.isConnected) blocks.delete(id);
    return pre;
  }

  // One log line. `text` is untrusted (stream chunks, main error strings):
  // textContent only.
  function line(castId, stream, text) {
    const pre = blockFor(castId);
    const ln = el('div', 'cl-' + (stream || 'out'));
    ln.textContent = text;
    pre.appendChild(ln);
    while (pre.childNodes.length > MAX_LINES) pre.removeChild(pre.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Cancel affordance on a running cast's block head (hq.cancelCast kills the
  // child process; the fizzle comes back on hq:cast-done).
  function ensureCancel(castId, spellId) {
    if (typeof hq?.cancelCast !== 'function') return;
    const pre = blocks.get(castId);
    const head = pre?.parentNode?.querySelector('.cl-block-head');
    if (!head || head.querySelector('.cl-cancel')) return;
    const b = el('button', 'btn btn--sm btn--danger cl-cancel', 'Cancel');
    b.type = 'button';
    b.title = 'Kill this run now (it is recorded as fizzled).';
    b.onclick = () => hq.cancelCast(spellId);
    head.appendChild(b);
  }

  function settleBlock(castId, ok) {
    const pre = blocks.get(castId);
    const block = pre?.parentNode;
    if (!block) return;
    block.classList.add(ok ? 'done-ok' : 'done-err');
    block.querySelector('.cl-cancel')?.remove();
  }

  // ------------------------------------------------------------ confirm gate
  function closeConfirm() {
    confirmEl?.remove();
    confirmEl = null;
  }

  function showConfirm(spell, p) {
    closeConfirm();
    const why = p.always_confirm ? 'This automation always asks.'
      : p.changed ? 'WARNING: the command CHANGED since you last approved it.'
      : 'First time running this automation.';
    const cmd = [p.command, ...(p.args || [])].filter(Boolean).join(' ')
      || (p.kind === 'chain' ? '(chain — runs its member automations in order)' : '(no command line)');
    confirmEl = el('div', 'cast-scrim');
    confirmEl.innerHTML = `
      <div class="cast-confirm panel" role="dialog" aria-modal="true" aria-label="Confirm run">
        <div class="panel-head"><span class="panel-title">Run ${esc(p.name)}?</span></div>
        <div class="panel-body">
          <div class="meta">${esc(why)}</div>
          <div class="eyebrow cast-confirm-sec">It will run exactly</div>
          <pre class="term cast-cmd">${esc(cmd)}</pre>
          ${p.cwd ? `<div class="mono-path">in ${esc(p.cwd)}</div>` : ''}
        </div>
        <div class="panel-foot cast-confirm-foot">
          <button class="btn" type="button" data-cancel>Cancel</button>
          <button class="btn btn--primary" type="button" data-go>Run it</button>
        </div>
      </div>`;
    confirmEl.querySelector('[data-cancel]').onclick = closeConfirm;
    confirmEl.onclick = (e) => { if (e.target === confirmEl) closeConfirm(); };
    confirmEl.querySelector('[data-go]').onclick = () => {
      closeConfirm();
      cast(spell, p.content_hash);       // second round-trip carries the approved hash
    };
    host.appendChild(confirmEl);
    confirmEl.querySelector('[data-go]').focus();
  }

  // ------------------------------------------------------------------- cast
  async function cast(spell, confirmedHash) {
    if (typeof hq?.castSpell !== 'function') {
      // RUN controls are disabled without the bridge; this is the belt-and-braces.
      line(null, 'err', 'Casting needs the live app — this preview has no bridge (window.hq.castSpell).');
      return;
    }
    let res;
    try { res = await hq.castSpell(spell.id, confirmedHash); }
    catch (e) { res = { error: String(e?.message || e) }; }
    if (!alive()) return;                // surface torn down mid-flight
    if (!res) return;
    if (res.error) { line(null, 'err', `x ${spell.name}: ${res.error}`); return; }
    if (res.confirm_required) { showConfirm(spell, res.preview); return; }
    if (res.channeled) { line(null, 'sys', `> ${spell.name} — opened in a terminal window (interactive session).`); return; }
    // castable/chain: the stream announces itself on hq:cast-output
  }

  // ---------------------------------------------------------- stream wiring
  // Subscribed per-mount (unlike v3, where fx.js held it app-lifetime): the
  // log is a panel of this surface, so the subscription lives and dies with it.
  function wireStream() {
    const offs = [];
    if (typeof hq?.onCastOutput === 'function') {
      offs.push(hq.onCastOutput((d) => {
        if (!alive() || !d) return;
        const chunk = String(d.chunk ?? '');
        const known = blocks.get(d.castId)?.isConnected;
        if (!known && d.stream === 'sys') line(d.castId, 'sys', chunk);
        else chunk.split(/\r?\n/).forEach((l) => { if (l.trim()) line(d.castId, d.stream, l); });
        if (d.castId) ensureCancel(d.castId, d.spellId);
      }));
    }
    if (typeof hq?.onCastDone === 'function') {
      offs.push(hq.onCastDone((d) => {
        if (!alive() || !d) return;
        const ok = d.outcome === 'resolved';
        const secs = ((Number(d.duration_ms) || 0) / 1000).toFixed(1);
        line(d.castId, ok ? 'ok' : 'err',
          ok ? `OK ${d.name} finished · ${secs}s`
             : `FAILED ${d.name}${d.timed_out ? ' (timeout)' : ` (exit ${d.exit_code})`} · ${secs}s`);
        settleBlock(d.castId, ok);
      }));
    }
    return offs;
  }

  function dispose() {
    closeConfirm();
    blocks.clear();
  }

  return { logEl, cast, line, wireStream, dispose };
}
