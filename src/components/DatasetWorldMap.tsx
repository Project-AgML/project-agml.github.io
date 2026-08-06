import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import clsx from 'clsx';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import { feature as topofeature } from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './DatasetWorldMap.module.css';
import { useDatasets } from '../lib/datasets';

type CountryFeature = Feature<Geometry, { name: string }>;

const MAP_WIDTH = 960;
const MAP_HEIGHT = 470;
const ANTARCTICA_ID = '010';

// Keys are ISO 3166-1 numeric codes matching the `id` field in the vendored
// world-atlas topology (static/data/countries-110m.json), so counts can be
// joined onto map features without any name-string matching at render time.
const COUNTRY_ID_ALIASES: Record<string, string[]> = {
  '036': ['australia'],
  '050': ['bangladesh'],
  '076': ['brazil'],
  '096': ['brunei'],
  '854': ['burkina faso'],
  '120': ['cameroon'],
  '156': ['china'],
  '170': ['colombia'],
  '384': ['cote d ivoire', 'ivory coast'],
  '208': ['denmark'],
  '818': ['egypt'],
  '231': ['ethiopia'],
  '250': ['france'],
  '276': ['germany'],
  '288': ['ghana'],
  '300': ['greece'],
  '356': ['india'],
  '360': ['indonesia'],
  '364': ['iran'],
  '368': ['iraq'],
  '380': ['italy'],
  '392': ['japan'],
  '404': ['kenya'],
  '428': ['latvia'],
  '458': ['malaysia'],
  '484': ['mexico'],
  '504': ['morocco'],
  '566': ['nigeria'],
  '586': ['pakistan'],
  '604': ['peru'],
  '620': ['portugal'],
  '682': ['saudi arabia'],
  '724': ['spain'],
  '158': ['taiwan'],
  '834': ['tanzania'],
  '764': ['thailand'],
  '788': ['tunisia'],
  '792': ['turkey'],
  '800': ['uganda'],
  '840': ['united states', 'usa', 'u s a', 'united states of america', 'california'],
  '704': ['vietnam'],
};

const ALIAS_TO_COUNTRY_ID = new Map<string, string>();
for (const [countryId, aliases] of Object.entries(COUNTRY_ID_ALIASES)) {
  for (const alias of aliases) ALIAS_TO_COUNTRY_ID.set(alias, countryId);
}

function toTitle(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? word.toUpperCase() : `${word[0].toUpperCase()}${word.slice(1)}`))
    .join(' ');
}

function normalizeLocationText(value: string | null | undefined) {
  if (!value) return null;
  return value.trim().toLowerCase();
}

function inferCountryId(location: string | string[] | null | undefined): string | null {
  if (!location) return null;
  const values = Array.isArray(location) ? location : [location];

  for (const raw of values) {
    const text = normalizeLocationText(raw);
    if (!text || text.includes('worldwide')) continue;

    const parts = text
      .split(/[,/;()]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const canonical = part.replace(/[^a-z0-9]+/g, ' ').trim();
      const countryId = ALIAS_TO_COUNTRY_ID.get(canonical);
      if (countryId) return countryId;
    }
  }

  return null;
}

function getCountryFill(count: number, maxCount: number) {
  if (maxCount <= 1) return '#34a853';
  const ratio = count / maxCount;
  const hue = 140 + Math.round(40 * ratio);
  return `hsl(${hue} 54% 42%)`;
}

type DatasetLink = { name: string; title: string };

export default function DatasetWorldMap() {
  const { data, loading } = useDatasets();
  const topologyUrl = useBaseUrl('/data/countries-110m.json');
  const [worldFeatures, setWorldFeatures] = useState<CountryFeature[] | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(topologyUrl)
      .then((res) => res.json())
      .then((topology: Topology) => {
        if (cancelled) return;
        const collection = topofeature(
          topology,
          topology.objects.countries as any
        ) as unknown as FeatureCollection<Geometry, { name: string }>;
        setWorldFeatures(collection.features.filter((f) => f.id !== ANTARCTICA_ID) as CountryFeature[]);
      })
      .catch(() => {
        if (!cancelled) setWorldFeatures([]);
      });
    return () => {
      cancelled = true;
    };
  }, [topologyUrl]);

  const pathGenerator = useMemo(() => {
    if (!worldFeatures || worldFeatures.length === 0) return null;
    const projection = geoNaturalEarth1().fitSize(
      [MAP_WIDTH, MAP_HEIGHT],
      { type: 'FeatureCollection', features: worldFeatures } as FeatureCollection
    );
    return geoPath(projection);
  }, [worldFeatures]);

  const datasetsByCountry = useMemo(() => {
    const grouped = new Map<string, DatasetLink[]>();
    const topLevelDatasets = (Array.isArray(data) ? data : []).filter((dataset) => !dataset.parent_dataset);

    for (const dataset of topLevelDatasets) {
      const countryId = inferCountryId(dataset.location);
      if (!countryId) continue;
      const entry = grouped.get(countryId) ?? [];
      entry.push({ name: dataset.name, title: toTitle(dataset.name) });
      grouped.set(countryId, entry);
    }

    for (const [countryId, datasets] of grouped) {
      grouped.set(
        countryId,
        [...datasets].sort((left, right) => left.title.localeCompare(right.title))
      );
    }

    return grouped;
  }, [data]);

  const maxCount = useMemo(
    () => Math.max(1, ...Array.from(datasetsByCountry.values(), (list) => list.length)),
    [datasetsByCountry]
  );

  const countryCount = datasetsByCountry.size;
  const activeId = hoveredId ?? selectedId;
  const activeDatasets = activeId ? datasetsByCountry.get(activeId) ?? null : null;
  const activeFeature = activeId ? worldFeatures?.find((f) => f.id === activeId) ?? null : null;

  function selectCountry(countryId: string) {
    setSelectedId((prev) => (prev === countryId ? null : countryId));
  }

  function handleCountryKeyDown(event: KeyboardEvent<SVGPathElement>, countryId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectCountry(countryId);
    }
  }

  function handleSvgKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'Escape') setSelectedId(null);
  }

  const isLoading = loading || !worldFeatures || !pathGenerator;

  return (
    <div className={styles.container}>
      <div className={styles.mapCard}>
        <div className={styles.mapHeader}>
          <div>
            <h3 className={styles.title}>Dataset coverage by country</h3>
            <p className={styles.subtitle}>
              {countryCount > 0
                ? `Datasets span ${countryCount} countries. Click or tap a highlighted country to see what's there.`
                : 'Click or tap a highlighted country to see the datasets collected there.'}
            </p>
          </div>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={clsx(styles.legendSwatch, styles.legendSwatchEmpty)} />
              No data
            </span>
            <span className={styles.legendItem}>
              <span className={clsx(styles.legendSwatch, styles.legendSwatchGradient)} />
              More datasets
            </span>
          </div>
        </div>

        <div className={styles.mapLayout}>
          {isLoading ? (
            <div className={styles.mapLoading}>Loading map…</div>
          ) : (
            <svg
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              className={styles.mapSvg}
              role="img"
              aria-label="Interactive map of dataset coverage by country"
              onKeyDown={handleSvgKeyDown}
            >
              <rect
                x="0"
                y="0"
                width={MAP_WIDTH}
                height={MAP_HEIGHT}
                className={styles.mapBackground}
                onClick={() => setSelectedId(null)}
              />
              {worldFeatures!.map((countryFeature) => {
                const countryId = String(countryFeature.id);
                const datasets = datasetsByCountry.get(countryId) ?? null;
                const hasData = Boolean(datasets && datasets.length > 0);
                const isActive = hasData && countryId === activeId;
                const d = pathGenerator!(countryFeature) ?? undefined;

                if (!hasData) {
                  return <path key={countryId} d={d} className={styles.countryPathEmpty} />;
                }

                return (
                  <path
                    key={countryId}
                    d={d}
                    className={clsx(styles.countryPath, isActive && styles.countryPathActive)}
                    style={{ fill: getCountryFill(datasets!.length, maxCount) }}
                    tabIndex={0}
                    role="button"
                    aria-pressed={countryId === selectedId}
                    aria-label={`${countryFeature.properties.name}: ${datasets!.length} dataset${datasets!.length === 1 ? '' : 's'}`}
                    onClick={() => selectCountry(countryId)}
                    onKeyDown={(event) => handleCountryKeyDown(event, countryId)}
                    onMouseEnter={() => setHoveredId(countryId)}
                    onMouseLeave={() => setHoveredId(null)}
                    onFocus={() => setHoveredId(countryId)}
                    onBlur={() => setHoveredId(null)}
                  />
                );
              })}
            </svg>
          )}

          <div className={styles.detailsPane}>
            {isLoading ? (
              <p className={styles.detailsText}>Loading dataset coverage…</p>
            ) : activeFeature && activeDatasets ? (
              <>
                <h4 className={styles.detailsTitle}>{activeFeature.properties.name}</h4>
                <p className={styles.detailsMeta}>
                  {activeDatasets.length} dataset{activeDatasets.length === 1 ? '' : 's'}
                </p>
                <ul className={styles.datasetList}>
                  {activeDatasets.map((dataset) => (
                    <li key={dataset.name}>
                      <Link to={`/datasets?dataset=${encodeURIComponent(dataset.name)}`} className={styles.datasetLink}>
                        {dataset.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className={styles.detailsText}>Click a highlighted country to explore the connected datasets.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
