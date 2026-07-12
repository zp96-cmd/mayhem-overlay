// Dev CLI wrapper around the shared patch-data pipeline.
// The installed app calls the same core from the Electron main process.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { fetchAllData } = require(path.join(ROOT, 'src', 'main', 'fetch-data-core.js'));

fetchAllData(path.join(ROOT, 'data'), console.log)
  .then((r) => console.log('done:', r))
  .catch((e) => { console.error(e); process.exit(1); });
