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
//   not dropped data: `system` init, `user` tool-result echoes, and the final
//   `result` event (it duplicates the assistant text already emitted —
//   rendering it would double-print every answer).
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
  return '';   // system / user / result / unknown protocol events: no text
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

module.exports = { parseChunk };
