// Copies MapLibre's map worker into public/, so the web build serves it from our own site (plan D21).
//
// MapLibre GL 6 draws the map in a Web Worker kept in its own file and finds that file with
// import.meta.url, which Metro does not give it. The worker file stands alone (it imports
// nothing), so it is copied here and GlMap.web.tsx points MapLibre at /map/ with setWorkerUrl.
// Same origin, so the site's security policy (worker-src 'self') allows it. Runs before
// `expo export` and `expo start --web`; public/map/ is not committed.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgPath = require.resolve('maplibre-gl/package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const out = join(here, '..', 'public', 'map');
mkdirSync(out, { recursive: true });
copyFileSync(join(dirname(pkgPath), 'dist', 'maplibre-gl-worker.mjs'), join(out, 'maplibre-gl-worker.mjs'));
console.log(`map worker: maplibre-gl ${version} copied to public/map/`);
