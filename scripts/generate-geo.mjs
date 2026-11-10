// Writes static/data/geo/world_110m.json — the world country boundaries Plotly's geo charts use —
// from the copy bundled with the installed plotly.js package (dist/plotly-geo-assets.js).
//
// By default Plotly fetches this file from cdn.plot.ly at runtime. Self-hosting it (the explorer
// map sets `topojsonURL` to /data/geo/) removes that third-party request, keeps the boundaries in
// lockstep with the installed Plotly version, and lets src/lib/geo.ts reuse the same polygons to
// check dataset coordinates against their stated country.
//
// Runs as part of `prestart`/`prebuild`; the output is gitignored.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(projectRoot, 'static', 'data', 'geo', 'world_110m.json');

export function loadWorldTopology() {
  // The UMD bundle assigns `window.Plotly` as a side effect even under CommonJS.
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) globalThis.window = {};
  try {
    const assets = require('plotly.js/dist/plotly-geo-assets.js');
    const topology = assets?.topojson?.world_110m;
    if (!topology) throw new Error('world_110m not found in plotly.js/dist/plotly-geo-assets.js');
    return topology;
  } finally {
    if (!hadWindow) delete globalThis.window;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const topology = loadWorldTopology();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(topology));
  console.log(`[generate-geo] wrote ${path.relative(projectRoot, outPath)}`);
}
