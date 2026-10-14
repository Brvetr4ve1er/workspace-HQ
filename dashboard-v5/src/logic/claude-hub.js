// dashboard-v5/src/logic/claude-hub.js
// The System card's view of the Claude Hub (spec 2026-10-13 §9 System). Pure; never invents numbers.
const MB = 1048576;
const size = (b) => (Number.isFinite(b) && b > 0 ? (b >= MB ? (b / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB') : '');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function hubCard(h, hasBridge) {
  const none = { show: false, state: '', color: 'var(--muted)', detail: '', size: '', bar: false, barW: '0%' };
  if (!hasBridge) return none;
  if (!h) return { ...none, show: true, state: 'Starting…' };
  const c = h.counts || {};
  const counted = (c.conversations || 0) + (c.projects || 0) > 0
    ? plural(c.conversations || 0, 'chat', 'chats') + ' · ' + plural(c.projects || 0, 'project', 'projects') + ' · ' + plural(c.messages || 0, 'message', 'messages')
    : 'nothing indexed yet';
  if (h.state === 'no-node') return { ...none, show: true, state: 'Needs Node 22.13 or newer (found ' + (h.node || 'none') + ')', color: 'var(--orange)', detail: 'Install Node 22.13+ and restart WorkspaceHQ — nothing else is affected' };
  if (h.state === 'down') return { ...none, show: true, state: 'Not running', color: 'var(--red)', detail: h.error || 'The Claude Hub stopped' };
  if (h.state === 'starting') return { ...none, show: true, state: 'Starting…' };
  if (h.state === 'indexing') {
    const b = h.backfill || {}, total = b.total || 0, done = Math.min(b.done || 0, total);
    // The counts come from the last health() answer and are only re-pulled when the pass ends, so a first backfill shows zeros
    // while sessions are already being read: "nothing indexed yet" would be false there, not merely stale.
    const detail = (c.conversations || 0) + (c.projects || 0) > 0 || done === 0 ? counted : 'counts appear when indexing finishes';
    return { show: true, state: total ? 'Indexing ' + done + ' of ' + total + ' sessions' : 'Indexing…', color: 'var(--blue)', detail,
      size: size(h.dbBytes), bar: total > 0, barW: (total ? Math.round(done / total * 100) : 0) + '%' };
  }
  const reader = h.role === 'reader' ? 'Read-only — another WorkspaceHQ window owns the index · ' : '';
  return { show: true, state: 'Indexed', color: 'var(--green)', detail: reader + counted + (h.lastError ? ' · last error: ' + String(h.lastError).slice(0, 120) : ''), size: size(h.dbBytes), bar: false, barW: '0%' };
}
