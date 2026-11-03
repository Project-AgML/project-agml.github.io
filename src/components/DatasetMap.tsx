import { useMemo, useState } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { useColorMode } from '@docusaurus/theme-common';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { oklchToRgb, usePlotlyChrome } from '../lib/plotlyChrome';
import { collectSites, countDatasetsByCountry, ISO3_NAME, type CountryShapes, type RejectedSite } from '../lib/geo';
import type { Dataset } from '../lib/datasets';
import { toNameTitleCase } from '../lib/labelOverrides';
import styles from './DatasetMap.module.css';

// World map of where the given datasets were collected:
//  - countries shaded by number of distinct datasets (one green hue, light → dark; log scale since
//    a few countries hold most of the catalog)
//  - collection sites from `lat_lon` as points, but only those that fall inside the dataset's stated
//    country (see collectSites in src/lib/geo.ts); the rest are listed under the map instead.
// Clicking a country calls onSelectCountry; clicking a site opens that dataset.

const REASON_LABEL: Record<RejectedSite['reason'], string> = {
  swapped: 'latitude/longitude look swapped',
  'outside-country': 'outside the listed country',
  unparseable: 'not a readable coordinate',
};

// Sequential ramp, its own steps per theme (dark mode: more = brighter), not an automatic flip.
const RAMP = {
  // Lightest step stays clearly darker/more saturated than the no-data land (--agml-tag-bg).
  light: [oklchToRgb(0.84, 0.09, 150), oklchToRgb(0.66, 0.13, 150), oklchToRgb(0.4, 0.11, 150)],
  dark: [oklchToRgb(0.38, 0.08, 150), oklchToRgb(0.58, 0.13, 150), oklchToRgb(0.85, 0.15, 150)],
};

const LOG_TICKS = [1, 3, 10, 30, 100, 300];

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function DatasetMap({
  datasets,
  shapes,
  selectedCountry,
  onSelectCountry,
  onOpenDataset,
}: {
  datasets: Dataset[];
  shapes: CountryShapes;
  selectedCountry: string | null;
  onSelectCountry: (iso3: string | null) => void;
  onOpenDataset: (name: string) => void;
}) {
  const chrome = usePlotlyChrome();
  const { colorMode } = useColorMode();
  const topojsonBase = useBaseUrl('/data/geo/');
  const [showRejected, setShowRejected] = useState(false);

  const counts = useMemo(() => countDatasetsByCountry(datasets), [datasets]);
  const { sites, rejected } = useMemo(() => collectSites(datasets, shapes), [datasets, shapes]);
  const withSites = useMemo(() => new Set(sites.map((s) => s.dataset)).size, [sites]);
  const withoutCountry = datasets.length - new Set(Array.from(counts.values()).flatMap((s) => Array.from(s))).size;

  const countries = useMemo(
    () => Array.from(counts.entries()).sort((a, b) => b[1].size - a[1].size),
    [counts],
  );
  const maxCount = countries[0]?.[1].size ?? 1;
  const zmax = Math.max(Math.log10(maxCount), 0.5);
  const ticks = LOG_TICKS.filter((t) => t <= Math.max(maxCount, 1));
  const ramp = RAMP[colorMode === 'dark' ? 'dark' : 'light'];

  const data = useMemo(() => {
    const traces: object[] = [
      {
        type: 'choropleth',
        locationmode: 'ISO-3',
        locations: countries.map(([iso]) => iso),
        z: countries.map(([, set]) => Math.log10(set.size)),
        customdata: countries.map(([iso, set]) => [ISO3_NAME[iso] ?? iso, set.size]),
        zmin: 0,
        zmax,
        colorscale: [
          [0, ramp[0]],
          [0.5, ramp[1]],
          [1, ramp[2]],
        ],
        marker: { line: { color: chrome.markerRing, width: 0.6 } },
        colorbar: {
          title: { text: 'Datasets', font: { color: chrome.text, family: chrome.fontFamily, size: 11 } },
          tickvals: ticks.map((t) => Math.log10(t)),
          ticktext: ticks.map(String),
          tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10 },
          outlinewidth: 0,
        },
        hovertemplate: '<b>%{customdata[0]}</b><br>%{customdata[1]} datasets<br><i>click to filter</i><extra></extra>',
        name: 'Datasets per country',
      },
    ];
    if (selectedCountry && counts.has(selectedCountry)) {
      traces.push({
        type: 'choropleth',
        locationmode: 'ISO-3',
        locations: [selectedCountry],
        z: [0],
        colorscale: [
          [0, 'rgba(0,0,0,0)'],
          [1, 'rgba(0,0,0,0)'],
        ],
        showscale: false,
        marker: { line: { color: chrome.tooltipText, width: 2 } },
        hoverinfo: 'skip',
      });
    }
    if (sites.length) {
      traces.push({
        type: 'scattergeo',
        mode: 'markers',
        lon: sites.map((s) => s.lon),
        lat: sites.map((s) => s.lat),
        customdata: sites.map((s) => s.dataset),
        text: sites.map((s) => toNameTitleCase(s.dataset)),
        marker: {
          size: 8,
          color: chrome.tooltipText,
          line: { color: chrome.markerRing, width: 1.5 },
          opacity: 0.9,
        },
        hovertemplate: '<b>%{text}</b><br>%{lat:.3f}, %{lon:.3f}<br><i>click to open</i><extra></extra>',
        name: 'Collection sites',
      });
    }
    return traces;
  }, [countries, counts, sites, selectedCountry, zmax, ticks, ramp, chrome]);

  if (datasets.length === 0) return null;

  return (
    <div className={styles.wrapper}>
      <p className={styles.summary}>
        <span className={styles.legendItem}>
          <span className={styles.swatch} aria-hidden="true" />
          Shaded by datasets per country ({plural(countries.length, 'country', 'countries')})
        </span>
        <span className={styles.legendItem}>
          <span className={styles.dot} aria-hidden="true" />
          {plural(sites.length, 'collection site')} from {plural(withSites, 'dataset')}
        </span>
        {withoutCountry > 0 && <span className={styles.muted}>{plural(withoutCountry, 'dataset')} with no country listed</span>}
      </p>
      <div className={styles.map}>
        <BrowserOnly fallback={<div className={styles.fallback}>Loading map…</div>}>
          {() => {
            // On phones a vertical colorbar eats a third of the width; lay it under the map instead.
            const narrow = window.innerWidth < 600;
            const colorbarLayout = narrow
              ? { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.02, yanchor: 'top', len: 0.7, thickness: 8 }
              : { orientation: 'v', x: 1, len: 0.6, thickness: 10 };
            const plotData = data.map((trace, i) =>
              i === 0 ? { ...trace, colorbar: { ...(trace as { colorbar: object }).colorbar, ...colorbarLayout } } : trace
            );
            const Plotly = require('plotly.js-dist-min');
            const createPlotlyComponent = require('react-plotly.js/factory').default;
            const Plot = createPlotlyComponent(Plotly);
            return (
              <Plot
                data={plotData}
                layout={{
                  autosize: true,
                  margin: { l: 0, r: 0, t: 0, b: narrow ? 40 : 0 },
                  paper_bgcolor: 'transparent',
                  showlegend: false,
                  dragmode: 'pan',
                  geo: {
                    projection: { type: 'natural earth' },
                    showframe: false,
                    showcoastlines: false,
                    showcountries: true,
                    countrycolor: chrome.grid,
                    countrywidth: 0.5,
                    showland: true,
                    landcolor: chrome.tooltipBg,
                    showocean: false,
                    showlakes: false,
                    bgcolor: 'transparent',
                    lataxis: { range: [-57, 84] },
                    resolution: 110,
                  },
                  hoverlabel: {
                    bgcolor: chrome.tooltipBg,
                    bordercolor: chrome.tooltipBorder,
                    font: { color: chrome.tooltipText, family: chrome.fontFamily, size: 11 },
                  },
                  uirevision: 'dataset-map',
                }}
                config={{ displayModeBar: false, responsive: true, scrollZoom: true, topojsonURL: topojsonBase }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
                onClick={(event: { points?: { data: { type: string }; location?: string; customdata?: unknown }[] }) => {
                  const point = event.points?.[0];
                  if (!point) return;
                  if (point.data.type === 'scattergeo' && typeof point.customdata === 'string') onOpenDataset(point.customdata);
                  else if (point.data.type === 'choropleth' && point.location)
                    onSelectCountry(point.location === selectedCountry ? null : point.location);
                }}
              />
            );
          }}
        </BrowserOnly>
      </div>
      <p className={styles.muted}>Scroll to zoom, drag to pan, double-click to reset.</p>

      {rejected.length > 0 && (
        <div className={styles.rejected}>
          <button type="button" className={styles.rejectedToggle} aria-expanded={showRejected} onClick={() => setShowRejected((v) => !v)}>
            <span aria-hidden="true">⚠</span> {plural(rejected.length, 'coordinate')} not shown — they don’t match the dataset’s listed
            country {showRejected ? '▴' : '▾'}
          </button>
          {showRejected && (
            <table className={styles.rejectedTable}>
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>lat_lon</th>
                  <th>Listed country</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map((r, i) => (
                  <tr key={`${r.dataset}-${i}`}>
                    <td>
                      <button type="button" className={styles.linkButton} onClick={() => onOpenDataset(r.dataset)}>
                        {r.dataset}
                      </button>
                    </td>
                    <td className={styles.mono}>{r.raw}</td>
                    <td>{r.countries.map((iso) => ISO3_NAME[iso] ?? iso).join(', ') || '—'}</td>
                    <td>{REASON_LABEL[r.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <details className={styles.tableView}>
        <summary>Table view: datasets per country</summary>
        <table className={styles.rejectedTable}>
          <thead>
            <tr>
              <th>Country</th>
              <th>Datasets</th>
            </tr>
          </thead>
          <tbody>
            {countries.map(([iso, set]) => (
              <tr key={iso}>
                <td>
                  <button type="button" className={styles.linkButton} onClick={() => onSelectCountry(iso)}>
                    {ISO3_NAME[iso] ?? iso}
                  </button>
                </td>
                <td className={styles.mono}>{set.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default DatasetMap;
