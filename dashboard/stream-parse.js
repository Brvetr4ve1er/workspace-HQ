// parseEvents (Claude Hub H3) — structured events for claude-chat.js; see its own comment.
// v4.1 Phase 3 — pure stream-json line parser for the live agent pane.
// `claude -p --output-format stream-json --verbose` emits line-delimited JSON
// events on stdout; session-api.js runs every onOutput chunk through
// parseChunk() before pushing hq:session-output, so the renderer sees clean
// assistant text + one-line tool notices instead of raw JSON.
//
// Contract (IPC-CONTRACT.md, hq:session-output note):
// - parseChunk(buffered, chunk) -> {text, rest}. Pure, CommonJS, no deps,
//   NEVER throws. `buffered` is the previous call's `rest`.
// - assistant events: text blocks pass through (newline-terminated);
//   tool_use blocks become one-line `[tool: <name> <hint>]` notices.
// - A COMPLETE line that is not valid JSON (stderr shares the pipe in
//   claude-sessions, plus CLI banners) passes through verbatim — never
//   dropped. A PARTIAL trailing line (no newline yet) stays in `rest` so the
//   next chunk can complete it; keeping malformed lines in `rest` instead
//   would poison the buffer forever, so only incomplete lines wait there.
// - Known protocol events with no user-facing text are filtered BY DESIGN,
//   not dropped data: `system` init and `user` tool-result echoes.
// - The final `result` event is filtered only when the run SUCCEEDED (it
//   duplicates the assistant text already emitted — rendering it would
//   double-print every answer). A FAILED result is emitted as an
//   `[error: <subtype>]` notice: the "duplicate" justification does not hold
//   there, because a run that dies on max-turns / a refusal / an execution
//   error printed no assistant text for it to duplicate. Filtering it left the
//   user with a red "Failed · exit N" chip and no reason — exactly the silent
//   drop this parser is not allowed to do.
const HINT_KEYS = ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'prompt', 'description'];
const HINT_MAX = 80;

function oneLine(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > HINT_MAX ? t.slice(0, HINT_MAX - 1) + '…' : t;
}

// Short human hint for a tool call: the most path/command-like string input.
function toolHint(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of HINT_KEYS) {
    if (typeof input[k] === 'string' && input[k].trim()) return oneLine(input[k]);
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) return oneLine(v);
  }
  return '';
}

// One parsed stream-json event -> renderer text ('' when the event carries
// nothing user-facing). Defensive on every field: events come from an
// external process and may not match any expected shape.
function textFromEvent(ev) {
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    let out = '';
    for (const block of ev.message.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        out += block.text.endsWith('\n') ? block.text : block.text + '\n';
      } else if (block.type === 'tool_use') {
        const name = typeof block.name === 'string' && block.name ? block.name : 'tool';
        const hint = toolHint(block.input);
        out += (hint ? `[tool: ${name} ${hint}]` : `[tool: ${name}]`) + '\n';
      }
    }
    return out;
  }
  // --include-partial-messages deltas (not passed today; handled leniently
  // so turning them on later needs no parser change)
  if (ev.type === 'stream_event') {
    const d = ev.event && ev.event.delta;
    if (d && d.type === 'text_delta' && typeof d.text === 'string') return d.text;
    return '';
  }
  // The run's verdict. Success duplicates what the assistant already said, so
  // it stays filtered; failure is the run's ONLY structured diagnostic, so it
  // is surfaced. `is_error` is authoritative; the `error*` subtype test is a
  // belt-and-braces fallback for a payload that carries one without the flag.
  // Deliberately NOT `subtype !== 'success'`: a future benign subtype must not
  // be announced to the user as an error.
  if (ev.type === 'result') {
    const sub = typeof ev.subtype === 'string' && ev.subtype ? ev.subtype : '';
    if (ev.is_error !== true && !/^error/i.test(sub)) return '';
    let out = `[error: ${sub || 'result'}]\n`;
    // `result` is absent on some failures (max-turns) — the notice above is
    // the diagnostic in that case, so never gate the whole branch on it.
    if (typeof ev.result === 'string' && ev.result.trim()) {
      out += ev.result.endsWith('\n') ? ev.result : ev.result + '\n';
    }
    return out;
  }
  return '';   // system / user / unknown protocol events: no text
}

function parseChunk(buffered, chunk) {
  const s = String(buffered ?? '') + String(chunk ?? '');
  let text = '';
  let start = 0;
  let idx;
  while ((idx = s.indexOf('\n', start)) !== -1) {
    let line = s.slice(start, idx);
    start = idx + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);   // CRLF (claude.cmd on Windows)
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { ev = undefined; }
    if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
      try { text += textFromEvent(ev); } catch { text += line + '\n'; }
    } else {
      text += line + '\n';   // complete non-JSON (or non-object JSON) line: raw pass-through
    }
  }
  return { text, rest: s.slice(start) };
}

// Claude Hub H3 (spec §8): structured events for the in-app chat engine (claude-chat.js).
// Same buffering contract as parseChunk; parseChunk itself is unchanged. With
// --include-partial-messages the text arrives as stream_event text_deltas AND again in the
// complete `assistant` line, so text comes only from the deltas and `assistant` lines
// contribute only their tool_use blocks (one render, never two).
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function eventsFrom(ev) {
  if (ev.type === 'system') {
    return ev.subtype === 'init' && typeof ev.session_id === 'string' && ev.session_id ? [{ kind: 'session', sessionId: ev.session_id }] : [];
  }
  if (ev.type === 'stream_event') {
    const d = ev.event && typeof ev.event === 'object' ? ev.event.delta : null;
    return d && typeof d === 'object' && d.type === 'text_delta' && typeof d.text === 'string' && d.text ? [{ kind: 'delta', text: d.text }] : [];
  }
  if (ev.type === 'assistant') {
    const content = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
    const out = [];
    for (const b of content) {
      if (!b || typeof b !== 'object' || b.type !== 'tool_use') continue;
      out.push({ kind: 'tool', name: typeof b.name === 'string' && b.name ? b.name : 'tool', hint: toolHint(b.input) });
    }
    return out;
  }
  if (ev.type === 'result') {
    const u = ev.usage && typeof ev.usage === 'object' ? ev.usage : null;
    const subtype = typeof ev.subtype === 'string' ? ev.subtype : '';
    return [{
      kind: 'result',
      sessionId: typeof ev.session_id === 'string' && ev.session_id ? ev.session_id : null,
      usage: u ? { in: num(u.input_tokens), out: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) } : null,
      isError: ev.is_error === true || /^error/i.test(subtype),
      subtype,
      result: typeof ev.result === 'string' ? ev.result : '',
    }];
  }
  return [];
}

function parseEvents(buffered, chunk) {
  const s = String(buffered ?? '') + String(chunk ?? '');
  const events = [];
  let start = 0;
  let idx;
  while ((idx = s.indexOf('\n', start)) !== -1) {
    let line = s.slice(start, idx);
    start = idx + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { ev = undefined; }
    if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
      try { events.push(...eventsFrom(ev)); } catch { events.push({ kind: 'raw', text: line }); }
    } else {
      events.push({ kind: 'raw', text: line });
    }
  }
  return { events, rest: s.slice(start) };
}

module.exports = { parseChunk, parseEvents };

