// Stdout / stderr that went away must not crash-loop the app (audit 2026-10-28: 10,461
// uncaughtException EPIPE lines in one night). The app runs hidden and detached, so the
// console's pipe can close under it; every console.* then throws EPIPE, and the old
// uncaughtException handler wrote to that same console — another EPIPE, forever.
//
// guardStdio({ proc?, con?, onBroken? }) → { isBroken(), isPipeError(e), handle(e) }
//   - listens for 'error' on proc.stdout / proc.stderr (an unheard stream 'error' is itself an
//     uncaught exception)
//   - handle(e): a pipe error (EPIPE, EOF — nothing broader, so an unrelated fd bug still gets logged) turns every console method
//     into a no-op ONCE, calls onBroken(e) once (main.js writes one line to the file log), and
//     returns true; anything else returns false so the caller logs it as before
//   The file log (app-log.js) is untouched: it never goes through the console.

const PIPE_CODES = new Set(['EPIPE', 'EOF']);
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'];

const isPipeError = (e) => !!e && PIPE_CODES.has(e.code);

function guardStdio({ proc = process, con = console, onBroken = () => {} } = {}) {
  let broken = false;
  const handle = (e) => {
    if (!isPipeError(e)) return false;
    if (broken) return true;
    broken = true;
    for (const k of CONSOLE_METHODS) if (typeof con[k] === 'function') con[k] = () => {};
    try { onBroken(e); } catch { /* the file log never throws; belt and braces */ }
    return true;
  };
  for (const s of [proc.stdout, proc.stderr]) if (s && typeof s.on === 'function') s.on('error', handle);
  return { isBroken: () => broken, isPipeError, handle };
}

module.exports = { guardStdio, isPipeError };
