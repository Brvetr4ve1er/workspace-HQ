// Normalize the one volatile output field (scan.date wall-clock) so golden
// diffs reflect logic changes only. Reads a file path, prints normalized JSON.
import { readFileSync } from 'node:fs';
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (doc.scan) doc.scan.date = 'NORMALIZED';
process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
