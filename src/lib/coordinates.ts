// Coordinate parsing shared by the dataset modal (formatCoordinateList in datasets.ts) and the
// explorer map (geo.ts). Kept free of React/Docusaurus imports so it can be unit-tested directly.

// `lat_lon` entries come from source metadata in decimal ("23.7654, 90.4449"), DMS
// ("23 46 17.652, 90 22 30.2514") or degrees + decimal minutes ("50 37.51, 6 59.32") form,
// optionally with a trailing hemisphere letter.
function parseCoordPart(part: string): number | null {
  const trimmed = part.trim();

  const dms = trimmed.match(/^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?\s*([NSEW])?$/i);
  if (dms) {
    const [, degStr, minStr, secStr, dir] = dms;
    const deg = Math.abs(Number(degStr));
    // Minutes/seconds above 60 mean the text isn't really DMS (e.g. a mangled "46 4310.3").
    if (Number(minStr) >= 60 || (secStr != null && Number(secStr) >= 60)) return null;
    const value = deg + Number(minStr) / 60 + Number(secStr ?? 0) / 3600;
    // Compare the raw text rather than the parsed number: Number("-0") < 0 is false in JS,
    // which would silently drop the sign on values like "-0 28 59" (just south of the equator).
    const negative = degStr.trim().startsWith('-') || (dir != null && /[SW]/i.test(dir));
    return Number.isFinite(value) ? (negative ? -value : value) : null;
  }

  const decimal = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*([NSEW])?$/i);
  if (decimal) {
    const [, numStr, dir] = decimal;
    const value = Number(numStr);
    if (!Number.isFinite(value)) return null;
    return dir != null && /[SW]/i.test(dir) ? -Math.abs(value) : value;
  }

  return null;
}

// Parses the two numbers in a `lat_lon` entry in the order written, without range checks — so
// callers can tell a swapped pair ("113.618, 23.583") from garbage. Tolerates stray parentheses and
// a plain-whitespace separator between two decimals ("23.709 90.433").
export function parseCoordinatePair(raw: string): { first: number; second: number } | null {
  const cleaned = raw.replace(/[()]/g, ' ').trim();
  let parts = cleaned.split(',');
  if (parts.length === 1) {
    const decimals = cleaned.split(/\s+/);
    if (decimals.length === 2 && decimals.every((d) => /^-?\d+\.\d+$/.test(d))) parts = decimals;
  }
  if (parts.length !== 2) return null;
  const first = parseCoordPart(parts[0]);
  const second = parseCoordPart(parts[1]);
  return first == null || second == null ? null : { first, second };
}

export function parseLatLon(raw: string): { lat: number; lon: number } | null {
  const pair = parseCoordinatePair(raw);
  if (!pair) return null;
  const { first: lat, second: lon } = pair;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
