// dashboard/claude-hub/redact-more.mjs
// Extra secret-masking rules for the Claude Hub (recall dish, commit 2). Same rule shape as redact.mjs RULES
// ({ name, re, keep? }: the text before the secret is group `keep`, the secret becomes the mask), so redact.mjs can
// append EXTRA_RULES after its own and every new ingest is masked too. Pure, no deps, never throws.
//
// This module must not import redact.mjs (redact.mjs imports this one). maskMore() applies only the rules below;
// callers that want everything run maskSecrets() from redact.mjs first and maskMore() after (or let redact.mjs
// carry EXTRA_RULES once it is wired). Masking twice changes nothing more: every mask starts with a bullet,
// which no rule's value accepts as a first character.
//
// Caveat, stated to the owner in the tool descriptions: these are shape rules. A secret written in plain prose
// with no label can still slip through, and raw text stays in message_fts for rows ingested before the rules.
export const MASK = (name) => `••• secret (${name})`;

// a value that is clearly a placeholder, a variable reference or an already-masked secret is left alone
const NOT_PLACEHOLDER = '(?![•$<{%\\[(])';
// words that follow "password is" / "password:" in ordinary prose ("the password is required")
const PROSE_WORDS = 'required|invalid|incorrect|wrong|correct|empty|missing|optional|hashed|stored|saved|encrypted|valid|never|always|'
  + 'being|used|reset|changed|sent|visible|hidden|unset|blank|none|null|undefined|true|false|same|different|this|that|there|here|'
  + 'then|what|when|fine|strong|weak|long|short|your|their|shown|masked|handled|managed|checked|verified|expired|case|safe|secret|'
  + 'stocke|requis|invalide|incorrect|vide|oublie|valide|jamais|toujours|chiffre|hache|inconnu|aucun|ici|voici|votre|notre';

const SECRET_NAME_END = '(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|SECRET_?KEY|AUTH_?KEY|SERVICE_?ROLE_?KEY|CREDENTIALS?)';

export const EXTRA_RULES = [
  // https://user:pass@host -> scheme and host stay; the userinfo goes
  { name: 'url-credentials', re: /(\b[a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/:@'"<>]+:[^\s/@'"<>•]+(?=@)/gi, keep: 1 },
  // NAME_TOKEN=value, NAME_PASSWORD="value" (upper-case variable names ending in a secret word; the value follows the = directly)
  { name: 'env-secret',
    re: new RegExp('(\\b(?:[A-Z][A-Z0-9_]*_)?' + SECRET_NAME_END + '=["\']?)' + NOT_PLACEHOLDER + '(?:[^\\s"\'`<>]{4,})', 'g'), keep: 1 },
  // password is hunter2 / password: hunter2 / password=hunter2 / mot de passe est hunter2 / mdp : hunter2
  { name: 'password',
    re: new RegExp('(\\b(?:password|passwd|passcode|mot de passe|mdp)(?:\\s+(?:is|est|c[\'’]est)\\s+|[ \\t]*[:=][ \\t]*)["\'`]?)' + NOT_PLACEHOLDER
      + '(?!(?:' + PROSE_WORDS + ')\\b)[^\\s"\'`]{4,}', 'gi'), keep: 1 },
  // api_key: value / "apiKey": "value" / api-key=value
  { name: 'api-key',
    re: new RegExp('(\\bapi[_-]?key["\']?[ \\t]*[:=][ \\t]*["\']?)' + NOT_PLACEHOLDER + '(?!(?:' + PROSE_WORDS + '|your|xxx|test)\\b)[^\\s"\'`,;]{8,}', 'gi'), keep: 1 },
  // token: abc123def456 / secret=abc123def456 (needs a digit and 8+ key characters, so "token: none" is prose)
  { name: 'secret-value',
    re: /(\b(?:secret|token|auth[_-]?token|access[_-]?token|client[_-]?secret)["']?[ \t]*[:=][ \t]*["']?)(?![•$<{%[(])(?=[A-Za-z0-9_\-.+/=]*\d)[A-Za-z0-9_\-.+/=]{8,}/gi, keep: 1 },
  { name: 'firecrawl-key', re: /\bfc-[A-Za-z0-9]{20,}/g },
  { name: 'supabase-key', re: /\b(?:sbp_[A-Za-z0-9]{30,}|sb_secret_[A-Za-z0-9_-]{20,})/g },
  { name: 'telegram-bot-token', re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
];

export function maskMore(input) {
  let text = typeof input === 'string' ? input : '';
  let hits = 0;
  for (const r of EXTRA_RULES) {
    text = text.replace(r.re, (...m) => { hits++; return (r.keep ? m[r.keep] : '') + MASK(r.name); });
  }
  return { text, hits };
}

// ---- masking a search snippet --------------------------------------------------------------------------------------
// Snippets from store.search() wrap hits in control characters (SNIP_START 0x02, SNIP_END 0x03). Those split a key
// and defeat the patterns, so the snippet is masked with the markers stripped. When masking changed anything the
// snippet comes back WITHOUT highlights: a masked secret loses its highlight, never its mask. When nothing changed
// the original (highlighted) snippet is returned.
const MARKERS = /[\u0002\u0003]/g;
const ELLIPSIS = '…';
// an unbroken run of key characters long enough to be (the rest of) a key
const ORPHAN = /^[A-Za-z0-9+/_=-]{20,}$/;

// snippet() cuts at token boundaries, so it can start or end inside a key ("fc-" + body): the prefix that would
// identify the key is outside the window and no pattern can see it. A cut edge that is one long key-like run is dropped.
export function dropCutKeyEdges(text) {
  let t = String(text);
  if (t.startsWith(ELLIPSIS)) {
    const m = /^…\s*(\S+)(\s|$)/.exec(t);
    if (m && ORPHAN.test(m[1])) t = ELLIPSIS + ' ' + t.slice(m[0].length);
  }
  if (t.endsWith(ELLIPSIS)) {
    const m = /(^|\s)(\S+)\s*…$/.exec(t);
    if (m && ORPHAN.test(m[2])) t = t.slice(0, m.index) + (m[1] ? ' ' : '') + ELLIPSIS;
  }
  return t;
}

// maskFn: text -> { text, hits } | string (callers pass redact.mjs maskSecrets; maskMore is always applied after it)
export function maskSnippet(snippet, maskFn) {
  const raw = typeof snippet === 'string' ? snippet : '';
  const plain = dropCutKeyEdges(raw.replace(MARKERS, ''));
  const run = (s) => {
    if (typeof maskFn === 'function') { const r = maskFn(s); s = typeof r === 'string' ? r : (r && typeof r.text === 'string' ? r.text : s); }
    return maskMore(s).text;
  };
  const masked = run(plain);
  const changed = masked !== plain || plain !== raw.replace(MARKERS, '');
  return changed ? masked : raw;
}

// any other text answer (a message, a title): both rule sets, no markers involved
export function maskText(text, maskFn) {
  const s = typeof text === 'string' ? text : '';
  let out = s;
  if (typeof maskFn === 'function') { const r = maskFn(out); out = typeof r === 'string' ? r : (r && typeof r.text === 'string' ? r.text : out); }
  return maskMore(out).text;
}
