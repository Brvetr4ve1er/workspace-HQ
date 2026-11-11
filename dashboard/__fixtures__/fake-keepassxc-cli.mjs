// A fake `keepassxc-cli` for the Security space tests. Invented data only; never the owner's vault.
// The spawn contract in dashboard/security-vault.js runs a .mjs/.js cli as: process.execPath [thisScript, ...args].
//
// Real shape being imitated:  keepassxc-cli export --format xml -q <vault.kdbx> [--key-file <file>]   (passphrase on STDIN, one line)
//   - prints the KeePass 2 XML export on stdout (the document in HQ_FAKE_KP_XML, else the sibling security-export.xml)
//   - exits 1 with "Invalid credentials" on stderr when stdin is not the invented passphrase
//   - exits 3 when the passphrase it received (or the invented one) appears in process.argv or process.env  <- the stdin-only proof
// HQ_FAKE_KP_MODE (read from the env the vault passes down; never a secret):
//   ok (default) | protected (the first <Value> becomes Protected="True") | localised (non-zero, foreign stderr, empty stdout)
//   | early-exit (exits 1 without reading stdin) | slow (waits 300 ms) | big (endless stdout) | hang (never answers) | bad-args (exit 2)
// HQ_FAKE_KP_RECORD: a file that receives the argv (no secrets) as JSON, for a test to inspect.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INVENTED_PASSPHRASE = 'correct horse example';

const mode = process.env.HQ_FAKE_KP_MODE || 'ok';
const args = process.argv.slice(2);

if (process.env.HQ_FAKE_KP_RECORD) { try { fs.writeFileSync(process.env.HQ_FAKE_KP_RECORD, JSON.stringify(args)); } catch { /* best effort */ } }

if (mode === 'early-exit') { process.stderr.write('Erreur\n'); process.exit(1); }
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'bad-args' || args[0] !== 'export' || !args.includes('xml')) { process.stderr.write('unexpected arguments\n'); process.exit(2); }
else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    const got = input.split('\n')[0].replace(/\r$/, '');
    const hay = JSON.stringify([process.argv, process.env]);
    for (const secret of new Set([INVENTED_PASSPHRASE, got].filter((s) => s.length >= 4))) {
      if (hay.includes(secret)) process.exit(3);   // the passphrase leaked into argv or env
    }
    if (mode === 'localised') { process.stderr.write('Fehler beim Lesen der Datenbank\n'); process.exit(1); }
    if (got !== INVENTED_PASSPHRASE) {
      process.stderr.write('Error while reading the database: Invalid credentials were provided, please try again.\n');
      process.exit(1);
    }
    const emit = () => {
      if (mode === 'big') { const line = 'x'.repeat(65536); const tick = () => { while (process.stdout.write(line)) { /* fill */ } process.stdout.once('drain', tick); }; tick(); return; }
      const file = process.env.HQ_FAKE_KP_XML || path.join(path.dirname(fileURLToPath(import.meta.url)), 'security-export.xml');
      let xml;
      try { xml = fs.readFileSync(file, 'utf8'); } catch { process.stderr.write('fixture missing\n'); process.exit(4); }
      if (mode === 'protected') xml = xml.replace('<Value>', '<Value Protected="True">');
      process.stdout.write(xml, () => process.exit(0));
    };
    if (mode === 'slow') setTimeout(emit, 300); else emit();
  });
}
