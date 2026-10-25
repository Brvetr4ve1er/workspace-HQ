// dashboard/__fixtures__/make-fake-claude.mjs — builds an npm-shaped claude.cmd that runs fake-claude.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claude.js');
export function makeFakeClaude(dir) {
  const binDir = path.join(dir, 'fakebin');
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, 'claude.cmd');
  fs.writeFileSync(bin, ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
    `"${process.execPath}" "${FAKE}"   %*`, ''].join('\r\n'));
  const log = path.join(dir, 'claude-argv.jsonl');
  const root = process.env.SystemRoot || 'C:\\Windows';
  const env = (extra = {}) => ({
    SystemRoot: root, ComSpec: path.join(root, 'System32', 'cmd.exe'), PATH: `${binDir};${path.join(root, 'System32')}`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD', NoDefaultCurrentDirectoryInExePath: '1', TEMP: os.tmpdir(), TMP: os.tmpdir(), OS: 'Windows_NT',
    FAKE_CLAUDE_LOG: log, ...extra,
  });
  return { bin, binDir, log, env };
}
