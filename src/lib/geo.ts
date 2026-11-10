// Geography for the explorer map: catalog country names → ISO-3 codes, and a check that each
// dataset's `lat_lon` sites actually fall inside the country the dataset claims.
//
// The catalog's coordinates are known to be unreliable (see CLAUDE.md): some pairs are swapped
// ("74.3453593, 17.26637" for a site in India puts it in the Arctic Ocean) and some are reused
// across unrelated entries. Rather than plot those, every site is tested against the polygon of
// the dataset's stated country, using the same world_110m boundaries the map draws
// (static/data/geo/world_110m.json, written by scripts/generate-geo.mjs). Sites that fail are
// reported separately instead of drawn.
//
// Kept free of React/Docusaurus imports so it can be unit-tested directly (tests/geo.test.ts).

import { parseCoordinatePair } from './coordinates';

// Catalog spelling (lowercased) → ISO 3166-1 alpha-3, the ids used by world_110m and by Plotly's
// `locationmode: 'ISO-3'`. Regions and placeholders ("Central Asia", "unknown") are deliberately
// absent. Add a row when a new country spelling appears; tests/geo.test.ts lists unmapped ones.
export const COUNTRY_ISO3: Record<string, string> = {
  algeria: 'DZA', australia: 'AUS', austria: 'AUT', bangladesh: 'BGD', belgium: 'BEL', belize: 'BLZ',
  benin: 'BEN', brazil: 'BRA', 'brunei darussalam': 'BRN', brunei: 'BRN', bulgaria: 'BGR',
  'burkina faso': 'BFA', cameroon: 'CMR', canada: 'CAN', 'central african republic': 'CAF', china: 'CHN',
  colombia: 'COL', croatia: 'HRV', cuba: 'CUB', 'czech republic': 'CZE', czechia: 'CZE',
  "côte d'ivoire": 'CIV', "cote d'ivoire": 'CIV', 'ivory coast': 'CIV', denmark: 'DNK', ecuador: 'ECU',
  estonia: 'EST', ethiopia: 'ETH', finland: 'FIN', france: 'FRA', gabon: 'GAB', germany: 'DEU',
  ghana: 'GHA', greece: 'GRC', 'guinea-bissau': 'GNB', guyana: 'GUY', india: 'IND', indonesia: 'IDN',
  iran: 'IRN', iraq: 'IRQ', israel: 'ISR', italy: 'ITA', japan: 'JPN', kazakhstan: 'KAZ', kenya: 'KEN',
  latvia: 'LVA', madagascar: 'MDG', malawi: 'MWI', malaysia: 'MYS', mexico: 'MEX', morocco: 'MAR',
  mozambique: 'MOZ', netherlands: 'NLD', 'the netherlands': 'NLD', 'new zealand': 'NZL', nigeria: 'NGA',
  norway: 'NOR', pakistan: 'PAK', peru: 'PER', philippines: 'PHL', poland: 'POL', portugal: 'PRT',
  'republic of the congo': 'COG', romania: 'ROU', russia: 'RUS', 'saudi arabia': 'SAU', senegal: 'SEN',
  slovakia: 'SVK', slovenia: 'SVN', 'south africa': 'ZAF', 'south korea': 'KOR', 'republic of korea': 'KOR',
  spain: 'ESP', sweden: 'SWE', switzerland: 'CHE', taiwan: 'TWN', tanzania: 'TZA', thailand: 'THA',
  tunisia: 'TUN', türkiye: 'TUR', turkey: 'TUR', uganda: 'UGA', ukraine: 'UKR', 'united kingdom': 'GBR',
  uk: 'GBR', 'united states': 'USA', 'united states of america': 'USA', usa: 'USA', uzbekistan: 'UZB',
  vietnam: 'VNM', 'viet nam': 'VNM',
};

// Display names for ISO codes (first catalog spelling wins, then title-cased).
export const ISO3_NAME: Record<string, string> = {
  BRN: 'Brunei', CZE: 'Czech Republic', CIV: "Côte d'Ivoire", COG: 'Republic of the Congo', GBR: 'United Kingdom',
  KOR: 'South Korea', NLD: 'Netherlands', TUR: 'Türkiye', USA: 'United States', VNM: 'Vietnam',
};
for (const [name, iso] of Object.entries(COUNTRY_ISO3)) {
  ISO3_NAME[iso] ??= name.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Placeholder values that aren't countries and shouldn't be reported as unmapped.
const NON_COUNTRIES = new Set(['unknown', 'worldwide', 'global', 'n/a', 'na', 'none', 'central asia']);

export function toIso3(name: string): string | null {
  return COUNTRY_ISO3[name.trim().toLowerCase()] ?? null;
}

export function isPlaceholderCountry(name: string): boolean {
  return NON_COUNTRIES.has(name.trim().toLowerCase());
}

function asList(value: string | string[] | null | undefined): string[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => typeof v === 'string' && v.trim());
}

export function datasetIso3s(country: string | string[] | null | undefined): string[] {
  return Array.from(new Set(asList(country).map(toIso3).filter((iso): iso is string => iso != null)));
}

// ------------------------------------------------------------------------------------------------
// TopoJSON decoding (just enough for country polygons — avoids pulling in topojson-client/d3-geo)
// ------------------------------------------------------------------------------------------------

type Ring = [number, number][]; // [lon, lat]
type Polygon = Ring[]; // outer ring + holes

interface Topology {
  arcs: [number, number][][];
  transform?: { scale: [number, number]; translate: [number, number] };
  objects: { countries: { geometries: { type: string; id?: string; arcs: unknown; properties?: { ct?: [number, number] } }[] } };
}

export interface CountryShape {
  polygons: Polygon[];
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  centroid: [number, number] | null;
}

export type CountryShapes = Map<string, CountryShape>;

export function decodeCountries(topology: Topology): CountryShapes {
  const { scale, translate } = topology.transform ?? { scale: [1, 1], translate: [0, 0] };
  const arcs: Ring[] = topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      if (topology.transform) {
        x += dx;
        y += dy;
        return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number];
      }
      return [dx, dy] as [number, number];
    });
  });

  const ring = (indexes: number[]): Ring => {
    const out: Ring = [];
    for (const index of indexes) {
      const arc = index < 0 ? arcs[~index].slice().reverse() : arcs[index];
      // Consecutive arcs share their join point; drop the duplicate.
      out.push(...(out.length ? arc.slice(1) : arc));
    }
    return out;
  };

  const shapes: CountryShapes = new Map();
  for (const geometry of topology.objects.countries.geometries) {
    if (!geometry.id) continue;
    const polygons: Polygon[] =
      geometry.type === 'Polygon'
        ? [(geometry.arcs as number[][]).map(ring)]
        : geometry.type === 'MultiPolygon'
          ? (geometry.arcs as number[][][]).map((polygon) => polygon.map(ring))
          : [];
    if (polygons.length === 0) continue;
    // Several geometries can share one id (mainland Spain and the Canaries, Portugal and Madeira,
    // Ecuador and the Galápagos), so merge rather than overwrite. The first geometry is the
    // mainland and supplies the centroid.
    const existing = shapes.get(geometry.id);
    const shape = existing ?? {
      polygons: [],
      bbox: [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number],
      centroid: geometry.properties?.ct ?? null,
    };
    shape.polygons.push(...polygons);
    for (const polygon of polygons)
      for (const [lon, lat] of polygon[0]) {
        shape.bbox[0] = Math.min(shape.bbox[0], lon);
        shape.bbox[1] = Math.min(shape.bbox[1], lat);
        shape.bbox[2] = Math.max(shape.bbox[2], lon);
        shape.bbox[3] = Math.max(shape.bbox[3], lat);
      }
    shapes.set(geometry.id, shape);
  }
  return shapes;
}

function insideRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToRing(lon: number, lat: number, ring: Ring): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = dx || dy ? Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(lon - (x1 + t * dx), lat - (y1 + t * dy)));
  }
  return best;
}

// The 1:110m boundaries are coarse: small islands and deltas can sit just off the simplified
// coastline, so a site within this many degrees (~55 km) of its country's border still counts.
const BORDER_TOLERANCE_DEG = 0.5;

export function pointInCountry(lon: number, lat: number, shape: CountryShape): boolean {
  const [minLon, minLat, maxLon, maxLat] = shape.bbox;
  const t = BORDER_TOLERANCE_DEG;
  if (lon < minLon - t || lon > maxLon + t || lat < minLat - t || lat > maxLat + t) return false;
  for (const polygon of shape.polygons) {
    const [outer, ...holes] = polygon;
    if (insideRing(lon, lat, outer) && !holes.some((hole) => insideRing(lon, lat, hole))) return true;
  }
  return shape.polygons.some((polygon) => distanceToRing(lon, lat, polygon[0]) <= t);
}

// ------------------------------------------------------------------------------------------------
// Sites
// ------------------------------------------------------------------------------------------------

export interface GeoDatasetInput {
  name: string;
  lat_lon: string | string[] | null;
  country: string | string[] | null;
}

export interface Site {
  dataset: string;
  lat: number;
  lon: number;
  // Whether the site was checked against a stated country (false when the dataset names none).
  verified: boolean;
}

export type RejectReason = 'unparseable' | 'swapped' | 'outside-country';

export interface RejectedSite {
  dataset: string;
  raw: string;
  reason: RejectReason;
  countries: string[];
}

export function collectSites(datasets: GeoDatasetInput[], shapes: CountryShapes): { sites: Site[]; rejected: RejectedSite[] } {
  const sites: Site[] = [];
  const rejected: RejectedSite[] = [];
  for (const dataset of datasets) {
    const isos = datasetIso3s(dataset.country).filter((iso) => shapes.has(iso));
    const seen = new Set<string>();
    for (const raw of asList(dataset.lat_lon)) {
      const pair = parseCoordinatePair(raw);
      if (!pair) {
        rejected.push({ dataset: dataset.name, raw, reason: 'unparseable', countries: isos });
        continue;
      }
      if (Math.abs(pair.first) > 90 || Math.abs(pair.second) > 180) {
        const swapped = Math.abs(pair.second) <= 90 && Math.abs(pair.first) <= 180;
        rejected.push({ dataset: dataset.name, raw, reason: swapped ? 'swapped' : 'unparseable', countries: isos });
        continue;
      }
      const parsed = { lat: pair.first, lon: pair.second };
      const key = `${parsed.lat.toFixed(4)},${parsed.lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isos.length === 0) {
        sites.push({ dataset: dataset.name, lat: parsed.lat, lon: parsed.lon, verified: false });
        continue;
      }
      const inside = (lon: number, lat: number) => isos.some((iso) => pointInCountry(lon, lat, shapes.get(iso)!));
      if (inside(parsed.lon, parsed.lat)) {
        sites.push({ dataset: dataset.name, lat: parsed.lat, lon: parsed.lon, verified: true });
      } else {
        // Not auto-corrected: a swapped pair is the likeliest explanation, but it's still a data
        // error to fix at the source, not to paper over on the map.
        const swapped = Math.abs(parsed.lon) <= 90 && inside(parsed.lat, parsed.lon);
        rejected.push({ dataset: dataset.name, raw, reason: swapped ? 'swapped' : 'outside-country', countries: isos });
      }
    }
  }
  return { sites, rejected };
}

// Distinct datasets per ISO-3 country.
export function countDatasetsByCountry(datasets: Pick<GeoDatasetInput, 'name' | 'country'>[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const dataset of datasets) {
    for (const iso of datasetIso3s(dataset.country)) {
      if (!out.has(iso)) out.set(iso, new Set());
      out.get(iso)!.add(dataset.name);
    }
  }
  return out;
}
