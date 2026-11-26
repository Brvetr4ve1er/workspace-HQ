// Prints the address of MAPS HQ on this PC (the map lives on the app's local bridge under /world/).
// Open it once and bookmark it: the key rides in the URL fragment, which the browser never sends to a server,
// and the page moves it into its own storage and strips it from the address bar.
//   node tools/world-url.mjs            (the app must have run once since 2026-11-25, or this creates the key)
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = require(path.join(ROOT, 'dashboard', 'world-routes.js'));
routes.setDeps({ dataDir: process.env.HQ_DATA_DIR || path.join(ROOT, 'data'), worldRoot: null, openAt: () => false });
const url = routes.worldUrl();
if (!url) { console.error('data/.world-key is unreadable or damaged. Move it aside and run this again (the old bookmark stops working).'); process.exit(1); }
console.log(url);
