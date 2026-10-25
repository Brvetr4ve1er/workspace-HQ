// dashboard/__fixtures__/fake-claude.js — a stand-in for the Claude Code CLI in tests and gates.
// Placeholder text only. Never contacts anything; records what it was given.
'use strict';
const fs = require('node:fs');
const argv = process.argv.slice(2);
// FAKE_CLAUDE_MODE_FILE (read per run) lets a long-lived gate instance switch modes without a restart
const modeFile = process.env.FAKE_CLAUDE_MODE_FILE;
const mode = (modeFile && fs.existsSync(modeFile) ? fs.readFileSync(modeFile, 'utf8').trim() : '') || process.env.FAKE_CLAUDE_MODE || 'ok';
const ri = argv.indexOf('--resume');
const sid = ri >= 0 ? argv[ri + 1] : '00000000-0000-4000-8000-000000000001';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const delta = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', async () => {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, cwd: process.cwd(), stdin, pid: process.pid }) + '\n');
  if (mode === 'fail') { process.stderr.write('Placeholder failure\n'); process.exit(1); }
  out({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd(), permissionMode: argv[argv.indexOf('--permission-mode') + 1] });
  if (mode === 'hang') {
    delta('Working');
    if (process.env.FAKE_CLAUDE_PIDFILE) fs.writeFileSync(process.env.FAKE_CLAUDE_PIDFILE, String(process.pid));
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'tool') {
    delta('Reading');
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading' }, { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } });
    await sleep(400);
    delta(' done.');
    out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: 'Reading done.', usage: { input_tokens: 6, output_tokens: 40 } });
    process.exit(0);
  }
  const parts = ['Placeholder answer', ' from the fake', ' claude.'];
  for (const p of parts) { delta(p); await sleep(80); }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: parts.join('') }] } });
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, result: parts.join(''), usage: { input_tokens: 6, output_tokens: 40 } });
  process.exit(0);
});
