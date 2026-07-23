// Session cache — the seam that lets manifest.badge() show a live running
// count WITHOUT touching hq at manifest scope (badge(data) is sync by charter;
// hq.getSessions() is async and push-only). view.js is the sole writer (seeds
// from hq.getSessions(), replaces on every hq:claude-sessions push); the
// manifest and the view's own badge repaint are readers.
let sessions = [];

export function setSessions(list) {
  sessions = Array.isArray(list) ? list : [];
}

export function sessionCache() {
  return sessions;
}

export function runningCount() {
  return sessions.filter((s) => s && s.status === 'running').length;
}
