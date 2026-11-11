// dashboard/vault-draft.mjs — "Save to vault" with no local model (batch 3, dish vault-template).
// PURE: no clock, no random, no network, no file system, no LLM module. Same input -> same bytes.
//
// templateDraft(conversation, messages, { maxChars, day }) -> { body, basis } | { error }
//   body  = the Markdown that goes after claude-vault.js noteText's frontmatter and "# title" lines:
//             ## Opening request   the first message from the owner, at most 600 characters
//             ## Where it ended    the start of Claude's last message, at most 8 lines and 900 characters
//             one counts line      "<n> messages · chat of <day>"
//   basis = how many chat messages the chat holds (the N in drafted_by: "a template, no model, from N chat messages")
//   Every excerpt (1) passes the Hub's secret masking again (belt and braces: the Hub masks on ingest), (2) is cut,
//   (3) has chat syntax neutralised, (4) is masked once more (a cut cannot expose a half secret) and (5) is rendered
//   as a blockquote, every line prefixed "> ", so chat text can never open a heading, a frontmatter block or a rule
//   in the note, and can never make an Obsidian link.
//
// chooseDraft({ llm, modelPrompt, conversation, messages, template, day }) is the preview() decision, kept here so it
// is testable without Electron: the model first when one answers, the template when none runs (status 'unavailable')
// or when the caller forces it ({ template: true }: llm.run is then never called); a model that RAN and failed keeps
// its error. claude-vault.js calls it and wraps the result with the note path.
import { maskSecrets } from './claude-hub/redact.mjs';

export const OPENING_MAX = 600;      // characters of the owner's first message
export const ENDING_MAX = 900;       // characters of Claude's last message
export const ENDING_LINES = 8;       // lines of Claude's last message
export const NO_MESSAGES = 'that chat has no messages from you or Claude to summarise';   // the existing preview() wording
export const draftedBy = (basis) => 'a template, no model, from ' + (Number(basis) || 0) + ' chat messages';

const cps = (s) => Array.from(s);
const cut = (s, n) => { const a = cps(s); return a.length > n ? a.slice(0, Math.max(0, n - 1)).join('').replace(/\s+$/, '') + '…' : s; };
const mask = (s) => maskSecrets(s).text;

// messages the owner and Claude actually wrote: no tool rows, no sidechains, no empty text (same filter as draftPrompt)
function chatMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant')
    && !m.is_sidechain && typeof m.text === 'string' && m.text.trim());
}

// chat text can never act on the note: a leading "#" or "---" is escaped, [[ stops being a wikilink or embed, a
// tag-looking #word and a %% comment opener stop working in Obsidian, and an HTML-looking "<" is escaped so no tag renders
function neutralise(line) {
  return line
    .replace(/^(\s*)(#{1,6}(?=\s|$)|[-=*_]{3,}\s*$)/, '$1\\$2')   // a heading or a rule line (or a setext underline) stays plain text
    .replace(/\[\[/g, '[ [')
    .replace(/%%/g, '% %')
    .replace(/<(?=[A-Za-z/!?])/g, '\\<')
    .replace(/(^|\s)#(?=[\p{L}_-])/gu, '$1\\#');
}
// every line, blank ones included, gets "> ": the excerpt is one blockquote and ends where the next heading begins
const prefix = (text) => text.split('\n').map((l) => '> ' + l.replace(/\s+$/, '')).join('\n');
const neutraliseAll = (text) => text.split('\n').map(neutralise).join('\n');
export const quoteLines = (text) => prefix(neutraliseAll(String(text).replace(/\r\n?/g, '\n')));

const tidy = (t) => String(t).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// mask -> cut lines -> neutralise -> cut characters (the caps count what lands in the note) -> mask again -> quote
function excerpt(text, maxChars, maxLines) {
  const lines = mask(tidy(text)).split('\n');
  const over = lines.length > maxLines;
  const t = neutraliseAll(lines.slice(0, maxLines).join('\n').replace(/\s+$/, '') + (over ? '…' : ''));
  return prefix(mask(cut(t, maxChars)));
}

function dayOf(c) {
  for (const v of [c && c.started_at, c && c.last_at]) {
    const t = Date.parse(v || '');
    if (Number.isFinite(t)) return new Date(t).toLocaleDateString('en-CA');
  }
  return null;
}

export function templateDraft(conversation, messages, opts) {
  const { maxChars, day } = opts && typeof opts === 'object' ? opts : {};
  const used = chatMessages(messages);
  if (!used.length) return { error: NO_MESSAGES };
  const cap = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : Infinity;
  const first = used.find((m) => m.role === 'user');
  const last = [...used].reverse().find((m) => m.role === 'assistant');
  const when = typeof day === 'string' && day ? day : dayOf(conversation);
  const body = [
    '## Opening request', '',
    first ? excerpt(first.text, Math.min(OPENING_MAX, cap), Infinity) : '> (no message from you in this chat)', '',
    '## Where it ended', '',
    last ? excerpt(last.text, Math.min(ENDING_MAX, cap), ENDING_LINES) : '> (no reply from Claude in this chat)', '',
    used.length + (used.length === 1 ? ' message' : ' messages') + ' · chat of ' + (when || 'an unknown date'), '',
  ].join('\n');
  return { body, basis: used.length };
}

// The preview() decision. `modelPrompt` is draftPrompt(...)'s answer ({ system, prompt, basis }) built by claude-vault.js;
// `llm` is llm-local. Answers { drafted, output, model, basis, modelUnavailable?, modelReason? } or { error }.
export async function chooseDraft({ llm, modelPrompt, conversation, messages, template = false, day, timeoutMs = 120000 } = {}) {
  if (!modelPrompt || !modelPrompt.basis) return { error: NO_MESSAGES };
  if (template === true) return fromTemplate(conversation, messages, day, false);
  const r = await llm.run({ system: modelPrompt.system, prompt: modelPrompt.prompt, timeoutMs });
  if (r && r.status === 'done') return { drafted: 'model', output: r.output, model: r.model || null, basis: modelPrompt.basis };
  if (r && r.status === 'unavailable') return fromTemplate(conversation, messages, day, true, r.reason);
  return { error: 'the local model failed: ' + ((r && r.reason) || 'no answer') };
}
function fromTemplate(conversation, messages, day, modelUnavailable, reason) {
  const t = templateDraft(conversation, messages, { day });
  if (t.error) return { error: t.error };
  const out = { drafted: 'template', output: t.body, model: null, basis: t.basis };
  if (modelUnavailable) { out.modelUnavailable = true; out.modelReason = String(reason || 'no runtime'); }
  return out;
}
