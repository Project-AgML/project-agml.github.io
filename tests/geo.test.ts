import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLatLon } from '../src/lib/coordinates';
import { collectSites, countDatasetsByCountry, decodeCountries, isPlaceholderCountry, pointInCountry, toIso3 } from '../src/lib/geo';
import { loadWorldTopology } from '../scripts/generate-geo.mjs';

const root = join(import.meta.dirname, '..');
const shapes = decodeCountries(loadWorldTopology());

describe('parseLatLon', () => {
  test('decimal, DMS, degrees + decimal minutes, and hemisphere letters', () => {
    assert.deepEqual(parseLatLon('23.7654, 90.4449'), { lat: 23.7654, lon: 90.4449 });
    const dms = parseLatLon('23 46 17.652, 90 22 30.2514')!;
    assert.ok(Math.abs(dms.lat - 23.77157) < 1e-4 && Math.abs(dms.lon - 90.37507) < 1e-4);
    const dm = parseLatLon('50 37.51, 6 59.32')!;
    assert.ok(Math.abs(dm.lat - 50.62517) < 1e-4 && Math.abs(dm.lon - 6.98867) < 1e-4);
    assert.ok(parseLatLon('12.5 S, 30.1 W')!.lat < 0);
  });

  test('tolerates stray parentheses and a whitespace separator', () => {
    assert.deepEqual(parseLatLon('18.817435, 74.256013)'), { lat: 18.817435, lon: 74.256013 });
    assert.deepEqual(parseLatLon('23.70925 90.43392'), { lat: 23.70925, lon: 90.43392 });
  });

  test('rejects out-of-range and mangled values', () => {
    assert.equal(parseLatLon('113.618, 23.583'), null);
    assert.equal(parseLatLon('46 4310.3, -96 49 41.5'), null);
    assert.equal(parseLatLon('23 80 43.99, 90 37 83.48'), null);
  });
});

describe('country shapes', () => {
  test('geometries sharing an id are merged (mainland Spain + Canaries)', () => {
    const spain = shapes.get('ESP')!;
    assert.ok(pointInCountry(-3.7, 40.4, spain), 'Madrid');
    assert.ok(pointInCountry(-15.6, 28.0, spain), 'Gran Canaria');
    assert.ok(pointInCountry(-6.41, 38.69, spain), 'Extremadura vineyard site');
  });

  test('coastal sites within tolerance pass; far-away points fail', () => {
    assert.ok(pointInCountry(91.8, 22.3, shapes.get('BGD')!), 'Chittagong');
    assert.equal(pointInCountry(113.95, 35.36, shapes.get('BGD')!), false);
  });
});

describe('collectSites', () => {
  test('verifies, flags swapped pairs, and reports other mismatches', () => {
    const { sites, rejected } = collectSites(
      [
        { name: 'ok', lat_lon: '17.26637, 74.3453593', country: 'India' },
        { name: 'swapped', lat_lon: ['74.3453593, 17.26637'], country: 'India' },
        { name: 'wrong_country', lat_lon: '35.3602, 113.9505', country: 'Bangladesh' },
        { name: 'no_country', lat_lon: '10, 10', country: null },
        { name: 'dupe', lat_lon: ['1.0, 32.5', '1.00001, 32.50001'], country: 'Uganda' },
      ],
      shapes,
    );
    assert.deepEqual(sites.map((s) => [s.dataset, s.verified]), [['ok', true], ['no_country', false], ['dupe', true]]);
    assert.deepEqual(rejected.map((r) => [r.dataset, r.reason]), [['swapped', 'swapped'], ['wrong_country', 'outside-country']]);
  });
});

describe('catalog countries', () => {
  test('every country spelling in the catalog maps to an ISO-3 code that exists on the map', () => {
    const missing = new Set<string>();
    for (const file of ['static/data/datasets.json', 'static/data/hf_datasets.json']) {
      for (const record of JSON.parse(readFileSync(join(root, file), 'utf8')) as { country?: unknown }[]) {
        for (const name of [record.country].flat()) {
          if (typeof name !== 'string' || !name.trim() || isPlaceholderCountry(name)) continue;
          const iso = toIso3(name);
          if (!iso || !shapes.has(iso)) missing.add(name);
        }
      }
    }
    // Add new spellings to COUNTRY_ISO3 in src/lib/geo.ts.
    assert.deepEqual([...missing].sort(), []);
  });

  test('countDatasetsByCountry merges spellings of the same country', () => {
    const counts = countDatasetsByCountry([
      { name: 'a', country: 'United States' },
      { name: 'b', country: ['United States of America', 'Canada'] },
    ]);
    assert.equal(counts.get('USA')?.size, 2);
    assert.equal(counts.get('CAN')?.size, 1);
  });
});
