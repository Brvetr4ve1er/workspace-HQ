// scrubber-core.mjs — pure snapshot freshness language for the shell.
// Kept DOM-free so the wording/thresholds stay unit-testable under node.

// Calendar age, rather than elapsed hours: a scan made late last night is one
// day old when the user opens the app this morning, which is the honest thing
// the shell should say. `now` is injected for tests.
export function freshnessForScanId(scanId, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(scanId || ''));
  if (!m || !Number.isFinite(now?.getTime?.())) {
    return { days: null, state: 'unknown', label: 'scan date unavailable' };
  }
  const stamp = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (!Number.isFinite(stamp)) return { days: null, state: 'unknown', label: 'scan date unavailable' };

  const days = Math.max(0, Math.floor((today - stamp) / 86_400_000));
  if (days === 0) return { days, state: 'fresh', label: 'scanned today' };
  if (days === 1) return { days, state: 'fresh', label: 'scanned yesterday' };
  return { days, state: days < 7 ? 'aging' : 'stale', label: `scanned ${days}d ago` };
}
