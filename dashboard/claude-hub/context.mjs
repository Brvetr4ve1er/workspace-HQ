// dashboard/claude-hub/context.mjs
// Ask grounding from the Claude Hub index (spec 2026-10-13 §6 contextFor, §9 Ask; phase H5).
// An Ask question → a block of snippets from past chats that fits a character budget, for the LOCAL model only.
// Pure apart from store.contextHits(). The index holds only masked text (redact.mjs runs before anything is
// stored) and the FTS snippet() call uses empty markers, so no control marker and no unmasked secret reaches a prompt.
export const CONTEXT_MAX = 8000;   // ceiling on budgetChars
export const MAX_CHATS = 6;        // chats per block
export const PER_CHAT = 2;         // snippets per chat: one long session can't fill the block
export const HITS = 60;            // FTS rows read before grouping
export const HEADER = 'CLAUDE HISTORY (snippets of your past Claude chats from the local index: what was said then, not proof it is still true. Cite a chat you use as "from chat <title>, <date>".)';
const STOP = new Set((
  'the and for with that this what which when where from have has had does did done about into your you are was were will would should could '
  + 'there their them then than just only also more most some such very whats how why who whom can not any all our out get got '
  + 'claude chat chats conversation conversations session sessions said say tell told talk talked '
  + 'dans les des une est pour que qui avec sur pas plus sont mais quoi comment pourquoi quel quelle quels quelles ces cette mes tes ses nous vous ils elles').split(/\s+/));
const SOURCE = { code: 'Claude Code', web: 'claude.ai' };

// the searchable words of a question: runs of letters/digits, lower-cased, ≥ 3 characters, not a stop word, ≤ 8 unique
export function keywords(q) {
  const words = String(q == null ? '' : q).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return [...new Set(words.filter((w) => [...w].length >= 3 && !STOP.has(w)))].slice(0, 8);
}
// OR, not AND: a question is a sentence ("what did I decide about the release plan"), and ANDing every word finds
// nothing. bm25 sums the per-term scores, so a message that holds more of the words still ranks first. Each term is
// quoted and holds only letters and digits, so the MATCH string is always valid FTS5: no NEAR / OR / * / - from the
// question survives as syntax.
export const contextMatch = (words) => (Array.isArray(words) && words.length ? words.map((w) => '"' + w + '"*').join(' OR ') : null);
// YYYY-MM-DD in local time (the day the owner saw), or 'unknown date'
export const localDay = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-CA') : 'unknown date'; };
// one line: control characters (snippet markers included) and runs of whitespace become one space; ≤ n code points
const flat = (s, n) => {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cps = [...t];
  return cps.length > n ? cps.slice(0, n - 1).join('') + '…' : t;
};

// rows (store.contextHits, best first) → { text, chars, cites, hits, words, note? }; text.length ≤ the budget, always
export function formatContext(rows, { words = [], budgetChars = 0 } = {}) {
  const budget = Math.max(0, Math.min(CONTEXT_MAX, Math.floor(Number(budgetChars) || 0)));
  const base = { text: '', chars: 0, cites: [], hits: [], words };
  if (budget < HEADER.length + 60) return { ...base, note: 'no room in the context budget' };
  let text = HEADER;
  const push = (line) => { if (text.length + 1 + line.length > budget) return false; text += '\n' + line; return true; };
  const done = (extra) => ({ ...base, ...extra, text, chars: text.length });
  if (!words.length) { push('- the question has no searchable keywords'); return done({ note: 'no searchable keywords' }); }
  const chats = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.conversationId) continue;
    let c = chats.get(r.conversationId);
    if (!c) { if (chats.size >= MAX_CHATS) continue; c = { r, snips: [] }; chats.set(r.conversationId, c); }
    if (c.snips.length < PER_CHAT && flat(r.snippet, 400)) c.snips.push(r);
  }
  const cites = [], hits = [];
  for (const [id, c] of chats) {
    if (!c.snips.length) continue;
    const title = flat(c.r.title, 80) || 'untitled chat';
    const date = localDay(c.r.startedAt || c.r.lastAt || c.r.at);
    const head = '- chat "' + title + '", ' + date + ' · ' + (flat(c.r.projectName, 60) || 'no project') + ' · ' + (SOURCE[c.r.source] || 'Claude');
    const lines = c.snips.map((s) => '  · ' + (s.role === 'user' ? 'you' : 'Claude') + ': ' + flat(s.snippet, 400));
    if (text.length + 1 + head.length + 1 + lines[0].length > budget) break;   // a chat goes in with at least one snippet, or not at all
    push(head);
    for (const l of lines) if (!push(l)) break;
    cites.push('chat ' + title + ', ' + date);
    hits.push({ conversationId: id, title, date, project: c.r.projectName || null, source: c.r.source || null });
  }
  if (!hits.length) {
    if (!chats.size) { push('- no past chats matched: ' + words.join(', ')); return done({ note: 'no past chats matched' }); }
    return done({ note: 'no room in the context budget' });
  }
  return done({ cites, hits });
}

export function contextFor(store, { query = '', budgetChars = 0 } = {}) {
  const words = keywords(query);
  const match = contextMatch(words);
  return formatContext(match ? store.contextHits({ match, limit: HITS }) : [], { words, budgetChars });
}
