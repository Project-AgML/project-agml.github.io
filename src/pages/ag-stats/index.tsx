import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import { AgStatsDetailModal } from '../../components/AgStatsDetailModal';
import { AgStatsTrendChart, MAX_TREND_SERIES } from '../../components/AgStatsTrendChart';
import type { TrendSeries } from '../../components/AgStatsTrendChart';
import {
  formatCount,
  formatYears,
  SOURCE_DOC_PATH,
  SOURCE_SHORT_LABEL,
  useAgStatsCatalog,
  useCaliYield,
  useNassYield,
} from '../../lib/agStats';
import type { AgStatsEntry, AgStatsSource, AgStatsSourceId, CaliYieldData, NassYieldData } from '../../lib/agStats';
import styles from './index.module.css';

const SPATIAL_ORDER = ['National', 'State', 'District', 'County', 'Pixel'];
const TIME_ORDER = ['Daily', 'Weekly', 'Monthly', 'Monthly (in season)', 'Annual', 'Every 5 years', 'Static'];

function ordered(values: Iterable<string>, order: string[]) {
  return Array.from(new Set(values)).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib) || a.localeCompare(b);
  });
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function CheckboxFilterGroup({
  label,
  options,
  selected,
  onToggle,
  formatOption = (value: string) => value,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  formatOption?: (value: string) => string;
}) {
  return (
    <div className={styles.filterGroup}>
      <p className={styles.filterGroupLabel}>{label}</p>
      <div className={styles.filterGroupOptions}>
        {options.map((option) => (
          <label key={option} className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={selected.includes(option)}
              onChange={() => onToggle(option)}
            />
            <span>{formatOption(option)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  active,
  onToggle,
}: {
  source: AgStatsSource;
  active: boolean;
  onToggle: () => void;
}) {
  const stats: [string, string][] = [
    ['Years', `${source.years[0]}–${source.years[1]}`],
    [source.id === 'nass' ? 'Rows' : 'Yield rows', formatCount(source.rows)],
    ['Crops', source.crops.toLocaleString()],
    source.places.states
      ? ['Places', `${source.places.states} states · ${formatCount(source.places.counties ?? 0)} counties`]
      : ['Counties', String(source.places.counties ?? '')],
  ];
  return (
    <article className={`${styles.sourceCard} ${active ? styles.sourceCardActive : ''}`}>
      <div className={styles.sourceCardHeader}>
        <div>
          <p className={styles.sourceRegion}>{source.region}</p>
          <h2 className={styles.sourceName}>{source.name}</h2>
          <code className={styles.sourceModule}>{source.module}</code>
        </div>
        <button type="button" className={styles.clearButton} onClick={onToggle} aria-pressed={active}>
          {active ? 'Showing only this' : 'Filter to this'}
        </button>
      </div>
      <p className={styles.sourceDescription}>{source.description}</p>
      <dl className={styles.sourceStats}>
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <code className={styles.installLine}>{source.install}</code>
      <div className={styles.sourceLinks}>
        <Link to={SOURCE_DOC_PATH[source.id]}>Guide</Link>
        <a href={`https://huggingface.co/datasets/${source.hf_repo}`} target="_blank" rel="noreferrer">
          Hugging Face
        </a>
        {source.paper && (
          <a href={source.paper} target="_blank" rel="noreferrer">
            Paper
          </a>
        )}
        {source.viewer && (
          <a href={source.viewer} target="_blank" rel="noreferrer">
            Map viewer
          </a>
        )}
        <span className={styles.sourceLicense}>{source.license}</span>
      </div>
    </article>
  );
}

function sizeLabel(entry: AgStatsEntry) {
  if (entry.rows != null) return `${formatCount(entry.rows)} rows`;
  if (entry.files != null) return `${formatCount(entry.files)} files`;
  return '—';
}

// Keeps each selected series on the color slot it was given when it was added, so removing one
// series never repaints the others. New series take the lowest free slot.
function useSlottedSelection(initial: string[]) {
  const [selection, setSelection] = useState<{ key: string; slot: number }[]>(() =>
    initial.slice(0, MAX_TREND_SERIES).map((key, slot) => ({ key, slot })),
  );
  const add = useCallback((key: string) => {
    setSelection((current) => {
      if (current.some((s) => s.key === key) || current.length >= MAX_TREND_SERIES) return current;
      const used = new Set(current.map((s) => s.slot));
      let slot = 0;
      while (used.has(slot)) slot += 1;
      return [...current, { key, slot }];
    });
  }, []);
  const remove = useCallback((key: string) => {
    setSelection((current) => current.filter((s) => s.key !== key));
  }, []);
  const reset = useCallback((keys: string[]) => {
    setSelection(keys.slice(0, MAX_TREND_SERIES).map((key, slot) => ({ key, slot })));
  }, []);
  return { selection, add, remove, reset };
}

function SeriesPicker({
  options,
  selected,
  onAdd,
  onRemove,
  label,
  placeholder,
  labelFor,
  missing,
}: {
  options: { key: string; label: string }[];
  selected: { key: string; slot: number }[];
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  label: string;
  placeholder: string;
  // Names selected keys that are not among the options, e.g. a state with no data for this crop.
  labelFor?: (key: string) => string;
  // Selected keys with no data for the current choice. They stay selected, shown muted.
  missing?: Set<string>;
}) {
  const optionLabels = new Map(options.map((o) => [o.key, o.label]));
  const labelOf = { get: (key: string) => optionLabels.get(key) ?? labelFor?.(key) };
  const full = selected.length >= MAX_TREND_SERIES;
  return (
    <div className={styles.control}>
      <span className={styles.controlLabel}>{label}</span>
      <div className={styles.chips}>
        {selected.map((s) => (
          <span
            key={s.key}
            className={styles.chip}
            data-slot={s.slot}
            data-missing={missing?.has(s.key) || undefined}
            title={missing?.has(s.key) ? 'No data for this crop' : undefined}
          >
            <span className={styles.chipSwatch} aria-hidden="true" />
            {labelOf.get(s.key) ?? s.key}
            {missing?.has(s.key) && <span className={styles.chipNote}>no data</span>}
            <button type="button" onClick={() => onRemove(s.key)} aria-label={`Remove ${labelOf.get(s.key) ?? s.key}`}>
              ✕
            </button>
          </span>
        ))}
        <select
          className={styles.select}
          value=""
          disabled={full}
          onChange={(event) => {
            if (event.target.value) onAdd(event.target.value);
          }}
        >
          <option value="">{full ? `Up to ${MAX_TREND_SERIES} series` : placeholder}</option>
          {options
            .filter((o) => !selected.some((s) => s.key === o.key))
            .map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

function TrendTable({ series, unit }: { series: TrendSeries[]; unit: string }) {
  const years = useMemo(() => {
    const set = new Set<number>();
    series.forEach((s) => s.points.forEach(([year]) => set.add(year)));
    return Array.from(set).sort((a, b) => b - a);
  }, [series]);
  const lookup = useMemo(() => series.map((s) => new Map(s.points)), [series]);
  return (
    <div className={styles.trendTableWrap}>
      <table className={styles.trendTable}>
        <thead>
          <tr>
            <th>Year</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year}>
              <td>{year}</td>
              {lookup.map((map, i) => {
                const value = map.get(year);
                return <td key={series[i].key}>{value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.note}>Values in {unit}.</p>
    </div>
  );
}

function NassTrend({ data }: { data: NassYieldData }) {
  const [cropId, setCropId] = useState(data.crops[0]?.id ?? '');
  const [unit, setUnit] = useState<'native' | 'tha'>('native');
  const [showTable, setShowTable] = useState(false);
  // States without data for the chosen crop stay selected, so switching back to a crop that has
  // them restores their lines. The chart, table, and snippet skip them.
  const { selection, add, remove } = useSlottedSelection(['US', 'IA', 'IL', 'NE']);
  const crop = data.crops.find((c) => c.id === cropId) ?? data.crops[0];

  const regionName = useCallback((key: string) => (key === 'US' ? 'United States' : data.states[key] ?? key), [data.states]);
  const options = useMemo(
    () => (crop ? Object.keys(crop.series).map((key) => ({ key, label: regionName(key) })) : []),
    [crop, regionName],
  );
  const missing = useMemo(
    () => new Set(selection.filter((s) => !crop?.series[s.key]).map((s) => s.key)),
    [crop, selection],
  );

  const series: TrendSeries[] = useMemo(
    () =>
      crop
        ? selection
            .filter((s) => crop.series[s.key])
            .map((s) => ({
              key: s.key,
              label: regionName(s.key),
              slot: s.slot,
              points: crop.series[s.key]
                .map(([year, native, tha]) => [year, unit === 'tha' ? tha : native] as [number, number | null])
                .filter((p): p is [number, number] => p[1] != null),
            }))
        : [],
    [crop, selection, unit, regionName],
  );
  const unitLabel = unit === 'tha' ? 't/ha' : titleCase(crop?.unit ?? '').replace(' / ', '/');

  return (
    <>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Crop</span>
          <select className={styles.select} value={crop?.id} onChange={(event) => setCropId(event.target.value)}>
            {data.crops.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.control}>
          <span className={styles.controlLabel}>Unit</span>
          <div className={styles.segmented}>
            <button type="button" className={unit === 'native' ? styles.segmentActive : ''} onClick={() => setUnit('native')}>
              {titleCase(crop?.unit ?? 'NASS unit')}
            </button>
            <button type="button" className={unit === 'tha' ? styles.segmentActive : ''} onClick={() => setUnit('tha')}>
              t/ha
            </button>
          </div>
        </div>
        <SeriesPicker
          label="Regions"
          options={options}
          selected={selection}
          onAdd={add}
          onRemove={remove}
          placeholder="Add a state…"
          labelFor={regionName}
          missing={missing}
        />
      </div>
      <AgStatsTrendChart series={series} yaxisTitle={`Yield (${unitLabel})`} />
      <TableToggle show={showTable} onToggle={() => setShowTable((v) => !v)} />
      {showTable && <TrendTable series={series} unit={unitLabel} />}
      <pre className={styles.trendSnippet}>{nassSnippet(crop?.query ?? '', series.map((s) => s.key))}</pre>
    </>
  );
}

function nassSnippet(query: string, keys: string[]) {
  const states = keys.filter((key) => key !== 'US');
  const lines: string[] = [];
  if (keys.includes('US')) lines.push(`nass.load_yield(${query},\n                level="national")`);
  if (states.length)
    lines.push(`nass.load_yield(${query},\n                level="state", state=[${states.map((key) => `"${key}"`).join(', ')}])`);
  return lines.join('\n');
}

// `county=[]` would match no rows, so with no county selected the snippet loads every county.
function caliSnippet(crop: string, counties: string[]) {
  const cropArg = `crop="${crop.toLowerCase()}"`;
  if (!counties.length) return `cali.load_yield(${cropArg})`;
  return `cali.load_yield(${cropArg},\n                county=[${counties.map((c) => `"${c}"`).join(', ')}])`;
}

function CaliTrend({ data }: { data: CaliYieldData }) {
  const defaultCrop = data.crops.includes('TOMATOES') ? 'TOMATOES' : data.crops[0];
  const [crop, setCrop] = useState(defaultCrop);
  const [showTable, setShowTable] = useState(false);

  // Rows of the chosen crop grouped by county, and the counties ordered by how many years they report.
  const byCounty = useMemo(() => {
    const cropIndex = data.crops.indexOf(crop);
    const map = new Map<string, [number, number][]>();
    for (const [county, c, year, value] of data.rows) {
      if (c !== cropIndex) continue;
      const name = data.counties[county];
      const list = map.get(name) ?? [];
      list.push([year, value]);
      map.set(name, list);
    }
    map.forEach((list) => list.sort((a, b) => a[0] - b[0]));
    return map;
  }, [data, crop]);
  const rankedCounties = useMemo(
    () => Array.from(byCounty.keys()).sort((a, b) => byCounty.get(b)!.length - byCounty.get(a)!.length || a.localeCompare(b)),
    [byCounty],
  );

  const { selection, add, remove, reset } = useSlottedSelection([]);
  useEffect(() => {
    reset(rankedCounties.slice(0, 3));
  }, [rankedCounties, reset]);

  const series: TrendSeries[] = selection
    .filter((s) => byCounty.has(s.key))
    .map((s) => ({ key: s.key, label: s.key, slot: s.slot, points: byCounty.get(s.key)! }));

  const cropLabel = titleCase(crop);
  return (
    <>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span className={styles.controlLabel}>Crop</span>
          <select className={styles.select} value={crop} onChange={(event) => setCrop(event.target.value)}>
            {data.crops.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </select>
        </label>
        <SeriesPicker
          label={`Counties (${rankedCounties.length} report ${cropLabel.toLowerCase()})`}
          options={rankedCounties.map((c) => ({ key: c, label: c }))}
          selected={selection}
          onAdd={add}
          onRemove={remove}
          placeholder="Add a county…"
        />
      </div>
      <AgStatsTrendChart series={series} yaxisTitle="Yield (t/ha)" />
      <TableToggle show={showTable} onToggle={() => setShowTable((v) => !v)} />
      {showTable && <TrendTable series={series} unit="t/ha" />}
      <pre className={styles.trendSnippet}>{caliSnippet(crop, series.map((s) => s.key))}</pre>
    </>
  );
}

function TableToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={styles.linkButton} onClick={onToggle} aria-expanded={show}>
      {show ? 'Hide table' : 'Show as table'}
    </button>
  );
}

function YieldExplorer() {
  const [tab, setTab] = useState<AgStatsSourceId>('nass');
  const nass = useNassYield();
  const cali = useCaliYield();
  const current = tab === 'nass' ? nass : cali;
  return (
    <section className={styles.panel} aria-labelledby="yield-explorer-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="yield-explorer-title" className={styles.panelTitle}>
            Yield trends
          </h2>
          <p className={styles.panelSubtitle}>
            A preview of what the loaders return. Pick a crop and up to {MAX_TREND_SERIES} regions to compare.
          </p>
        </div>
        <div className={styles.segmented} role="tablist">
          {(['nass', 'calicropyield'] as AgStatsSourceId[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? styles.segmentActive : ''}
              onClick={() => setTab(id)}
            >
              {id === 'nass' ? 'USDA NASS (state)' : 'California (county)'}
            </button>
          ))}
        </div>
      </div>
      {current.loading && <p className={styles.status}>Loading yield data…</p>}
      {current.error && <p className={styles.status}>Error: {current.error.message}</p>}
      {tab === 'nass' && nass.data && <NassTrend data={nass.data} />}
      {tab === 'calicropyield' && cali.data && <CaliTrend data={cali.data} />}
    </section>
  );
}

export default function AgStatsPage() {
  const { data, loading, error } = useAgStatsCatalog();

  const [search, setSearch] = useState('');
  const searchDeferred = useDeferredValue(search);
  const [sources, setSources] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [spatial, setSpatial] = useState<string[]>([]);
  const [timeSteps, setTimeSteps] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);

  const entries = data?.entries ?? [];
  const sourceById = useMemo(() => new Map((data?.sources ?? []).map((s) => [s.id, s])), [data]);

  const options = useMemo(
    () => ({
      kinds: ordered(
        entries.map((e) => e.kind),
        ['Table', 'Raster', 'Zarr'],
      ),
      spatial: ordered(
        entries.flatMap((e) => e.spatial_levels),
        SPATIAL_ORDER,
      ),
      timeSteps: ordered(
        entries.map((e) => e.time_step),
        TIME_ORDER,
      ),
    }),
    [entries],
  );

  const toggle = (setter: (updater: (current: string[]) => string[]) => void, value: string) =>
    setter((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));

  const hasActiveFilters = sources.length + kinds.length + spatial.length + timeSteps.length > 0;
  const clearFilters = () => {
    setSources([]);
    setKinds([]);
    setSpatial([]);
    setTimeSteps([]);
  };

  const visible = useMemo(() => {
    const q = searchDeferred.trim().toLowerCase();
    return entries.filter((e) => {
      if (sources.length && !sources.includes(e.source)) return false;
      if (kinds.length && !kinds.includes(e.kind)) return false;
      if (spatial.length && !e.spatial_levels.some((level) => spatial.includes(level))) return false;
      if (timeSteps.length && !timeSteps.includes(e.time_step)) return false;
      if (!q) return true;
      const haystack = [e.name, e.title, e.description, e.method, ...e.columns.map((c) => c.name)].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, searchDeferred, sources, kinds, spatial, timeSteps]);

  const detail = entries.find((e) => e.id === detailId) ?? null;
  const closeDetail = useCallback(() => setDetailId(null), []);

  return (
    <Layout title="Ag Stats" description="Agricultural statistics in AgML: USDA NASS crop statistics and the California Crop Yield Benchmark.">
      <div className={styles.page}>
        <AgStatsDetailModal entry={detail} source={detail ? sourceById.get(detail.source) ?? null : null} onClose={closeDetail} />
        <div className={styles.toolbar}>
          <input
            type="search"
            placeholder="search tables, layers, and columns..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.searchInput}
          />
          <div className={styles.toolbarRight}>
            <span className={styles.resultCount}>
              {visible.length} of {entries.length} tables and layers
            </span>
            {hasActiveFilters && (
              <button type="button" className={styles.clearButton} onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>
        <div className={styles.body}>
          <aside className={styles.sidebar}>
            <CheckboxFilterGroup
              label="Source"
              options={(data?.sources ?? []).map((s) => s.id)}
              selected={sources}
              onToggle={(value) => toggle(setSources, value)}
              formatOption={(value) => SOURCE_SHORT_LABEL[value as AgStatsSourceId] ?? value}
            />
            <CheckboxFilterGroup label="Data type" options={options.kinds} selected={kinds} onToggle={(value) => toggle(setKinds, value)} />
            <CheckboxFilterGroup label="Spatial level" options={options.spatial} selected={spatial} onToggle={(value) => toggle(setSpatial, value)} />
            <CheckboxFilterGroup label="Time step" options={options.timeSteps} selected={timeSteps} onToggle={(value) => toggle(setTimeSteps, value)} />
            <p className={styles.sidebarNote}>
              <code>agml.ag_stats</code> loads agricultural statistics by crop, place, and year. See the{' '}
              <Link to="/docs/ag-stats">Ag Stats guide</Link> for the full API.
            </p>
          </aside>
          <section className={styles.results}>
            {loading && <p className={styles.status}>Loading Ag Stats catalog…</p>}
            {error && <p className={styles.status}>Error: {error.message}</p>}
            {data && (
              <>
                <div className={styles.sourceGrid}>
                  {data.sources.map((source) => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      active={sources.length === 1 && sources[0] === source.id}
                      onToggle={() => setSources((current) => (current.length === 1 && current[0] === source.id ? [] : [source.id]))}
                    />
                  ))}
                </div>

                <section className={styles.panel} aria-labelledby="catalog-title">
                  <div className={styles.panelHeader}>
                    <div>
                      <h2 id="catalog-title" className={styles.panelTitle}>
                        Tables and layers
                      </h2>
                      <p className={styles.panelSubtitle}>Select a row for its columns and a code snippet.</p>
                    </div>
                  </div>
                  <div className={styles.tableWrap}>
                    <div className={styles.catalogTable} role="table" aria-label="Ag Stats tables and layers">
                      <div className={styles.tableRow} role="row">
                        <span role="columnheader">Name</span>
                        <span role="columnheader">Source</span>
                        <span role="columnheader">Type</span>
                        <span role="columnheader">Spatial</span>
                        <span role="columnheader">Time step</span>
                        <span role="columnheader">Years</span>
                        <span role="columnheader">Size</span>
                      </div>
                      {visible.length === 0 && <p className={styles.status}>No tables or layers match the current filters.</p>}
                      {visible.map((entry) => (
                        <div
                          key={entry.id}
                          className={`${styles.tableRow} ${styles.clickableRow}`}
                          role="row"
                          tabIndex={0}
                          onClick={() => setDetailId(entry.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setDetailId(entry.id);
                            }
                          }}
                        >
                          <span role="cell" className={styles.entryName}>
                            <strong>{entry.title}</strong>
                            <code>{entry.method}</code>
                          </span>
                          <span role="cell">{SOURCE_SHORT_LABEL[entry.source]}</span>
                          <span role="cell">
                            <span className={styles.kindBadge} data-kind={entry.kind}>
                              {entry.kind}
                            </span>
                          </span>
                          <span role="cell">{entry.resolution ? entry.resolution : entry.spatial_levels.join(', ')}</span>
                          <span role="cell">{entry.time_step}</span>
                          <span role="cell" className={styles.mono}>
                            {formatYears(entry)}
                          </span>
                          <span role="cell" className={styles.mono}>
                            {sizeLabel(entry)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <YieldExplorer />
                <p className={styles.footnote}>
                  Catalog generated {data.generated} from <code>agml.ag_stats</code> with{' '}
                  <code>scripts/generate_ag_stats.py</code>.
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
