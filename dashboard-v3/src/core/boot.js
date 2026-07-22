// NEXUS boot — also the M0 step-0 ESM spike: this file proves that
// <script type="module"> with NESTED relative imports works over loadFile()
// (file:// origin) in Electron 32 before we port 1,800 lines onto the pattern.
import { bus } from './bus.js';
import { clock } from '../ui/util.js';

const dataOk = typeof window.DATA === 'object' && Array.isArray(window.DATA?.scans);
bus.emit('boot', { at: clock(Date.now()) });

console.log(
  `SPIKE ESM=OK nested-imports=OK bus=${bus.ok ? 'OK' : 'FAIL'} ` +
  `data.js=${dataOk ? `OK(${window.DATA.scans.length} scans)` : 'FAIL'}`
);
