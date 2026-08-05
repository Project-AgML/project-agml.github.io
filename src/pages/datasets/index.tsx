import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@theme/Layout';
import { useHistory, useLocation } from '@docusaurus/router';
import { DatasetMetadataModal } from '../../components/DatasetMetadataModal';
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown';
import styles from './index.module.css';
import { computeDatasetStats, filterDatasets, formatDisplayLocation, useDatasets } from '../../lib/datasets';
import { useSemanticDatasetSearch } from '../../lib/semanticSearch';

type FilterKind = 'checkbox' | 'dropdown';

type DatasetFilterConfig = {
  key: string;
  label: string;
  field: keyof import('../../lib/datasets').Dataset;
  kind: FilterKind;
  formatOption?: (value: string) => string;
  mode?: 'exact' | 'containsAny';
};

const DATASET_FILTERS: DatasetFilterConfig[] = [
  {
    key: 'ml_task',
    label: 'Task Type',
    field: 'machine_learning_task',
    kind: 'checkbox',
    formatOption: (value) => value.replace(/_/g, ' '),
  },
  {
    key: 'ag_task',
    label: 'Agricultural Task',
    field: 'agricultural_task',
    kind: 'dropdown',
    formatOption: (value) => value.replace(/_/g, ' '),
  },
  {
    key: 'crop_types',
    label: 'Crop',
    field: 'crop_types',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => value.replace(/_/g, ' '),
  },
  {
    key: 'location',
    label: 'Location',
    field: 'location',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => value,
  },
  {
    key: 'environment',
    label: 'Environment',
    field: 'environment',
    kind: 'checkbox',
    formatOption: (value) => value.charAt(0).toUpperCase() + value.slice(1),
  },
  {
    key: 'platform',
    label: 'Platform',
    field: 'platform',
    kind: 'dropdown',
    formatOption: (value) => value,
  },
  {
    key: 'real',
    label: 'Data Type',
    field: 'real_or_synthetic',
    kind: 'checkbox',
    formatOption: (value) => value,
  },
  {
    key: 'augmented_counterpart',
    label: 'Augmented',
    field: 'augmented_counterpart',
    kind: 'checkbox',
    formatOption: (value) => (value === 'yes' ? 'Yes' : 'No'),
  },
];

type FilterKey = (typeof DATASET_FILTERS)[number]['key'];

function toLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function toTitle(value: string) {
  return toLabel(value)
    .split(' ')
    .map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : ''))
    .join(' ');
}

function formatImageCount(count: number | null) {
  if (count == null) return 'Unknown';
  if (count >= 1000) {
    const scaled = (count / 1000).toFixed(1);
    const trimmed = scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled;
    return `${trimmed}k`;
  }
  return count.toLocaleString();
}

function formatBytesDecimal(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const formatted = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  const trimmed = formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
  return `${trimmed} ${units[unitIndex]}`;
}

function taskBadgeClass(task: string | null): string {
  if (!task) return styles.badgeOther;
  if (task.includes('classif')) return styles.badgeClassification;
  if (task.includes('detect')) return styles.badgeDetection;
  if (task.includes('segment')) return styles.badgeSegmentation;
  return styles.badgeOther;
}

function getFilterValues(
  datasets: import('../../lib/datasets').Dataset[],
  field: keyof import('../../lib/datasets').Dataset
): string[] {
  const values = datasets.flatMap((dataset) => {
    const value = dataset[field];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
    return [];
  });
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function CheckboxFilterGroup({
  label,
  options,
  selected,
  onToggle,
  formatOption = (value: string) => value.replace(/_/g, ' '),
  counts,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  formatOption?: (value: string) => string;
  counts: Record<string, number>;
}) {
  return (
    <div className={styles.filterGroup}>
      <p className={styles.filterGroupLabel}>{label}</p>
      <div className={styles.filterGroupOptions}>
        {options.map((option) => (
          <label key={option} className={styles.checkboxRow}>
            <span className={styles.checkboxRowLeft}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selected.includes(option)}
                onChange={() => onToggle(option)}
              />
              <span>{formatOption(option)}</span>
            </span>
            <span className={styles.checkboxCount}>{counts[option] ?? 0}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function DatasetCard({
  dataset,
  onOpen,
}: {
  dataset: import('../../lib/datasets').Dataset;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const {
    name,
    machine_learning_task,
    agricultural_task,
    num_images,
    zip_size_bytes,
    augmented_num_images,
    augmented_zip_size_bytes,
    location,
  } = dataset;
  const fileSize = formatBytesDecimal(zip_size_bytes);
  const augmentedFileSize = formatBytesDecimal(augmented_zip_size_bytes);
  const hasAugmented = augmented_num_images != null;

  return (
    <button
      type="button"
      className={styles.cardButton}
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`Open details for ${name}`}
    >
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.cardTitleLink}>{toTitle(name)}</span>
        </h2>
        <div className={styles.cardTags}>
          {machine_learning_task && (
            <span className={`${styles.taskBadge} ${taskBadgeClass(machine_learning_task)}`}>
              {toLabel(machine_learning_task)}
            </span>
          )}
          {agricultural_task && <span className={styles.tag}>{toLabel(agricultural_task)}</span>}
          {location && <span className={styles.tag}>{formatDisplayLocation(location)}</span>}
        </div>
        <div className={styles.cardFooter}>
          <div className={styles.cardFooterRow}>
            <span>{formatImageCount(num_images)} images</span>
            {fileSize && <span>{fileSize}</span>}
          </div>
          {hasAugmented && (
            <div className={`${styles.cardFooterRow} ${styles.cardFooterAugmented}`}>
              <span>augmented: {formatImageCount(augmented_num_images)} images</span>
              {augmentedFileSize && <span>{augmentedFileSize}</span>}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function DatasetBrowserPage() {
  const location = useLocation();
  const history = useHistory();
  const { data, loading, error } = useDatasets();
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedScrollYRef = useRef(0);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const qParam = searchParams.get('q') ?? '';
  const [qLocal, setQLocal] = useState(qParam);
  const qDeferred = useDeferredValue(qLocal);

  useEffect(() => setQLocal(qParam), [qParam]);

  const selections = useMemo(() => {
    const next = {} as Record<FilterKey, string[]>;
    for (const filter of DATASET_FILTERS) {
      next[filter.key] = searchParams.getAll(filter.key);
    }
    return next;
  }, [searchParams]);

  const setSearchParams = useCallback(
    (updater: (params: URLSearchParams) => URLSearchParams, replace = true) => {
      const currentSearch = location.search.startsWith('?')
        ? location.search.slice(1)
        : location.search;
      const next = updater(new URLSearchParams(currentSearch));
      const search = next.toString();
      if (search === currentSearch) return;
      const nextLocation = { ...location, search: search ? `?${search}` : '' };
      if (replace) {
        history.replace(nextLocation);
      } else {
        history.push(nextLocation);
      }
    },
    [history, location]
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchParams((prev) => {
        if (qLocal) prev.set('q', qLocal);
        else prev.delete('q');
        return prev;
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [qLocal, setSearchParams]);

  const toggleMultiFilter = (key: string, value: string) => {
    setSearchParams((prev) => {
      const current = prev.getAll(key);
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const nextParams = new URLSearchParams(prev);
      nextParams.delete(key);
      next.forEach((v) => nextParams.append(key, v));
      return nextParams;
    });
  };

  const activeFilterCount = DATASET_FILTERS.reduce((count, filter) => count + selections[filter.key].length, 0);
  const hasActiveFilters = Boolean(qDeferred || activeFilterCount);

  const clearFilters = () => {
    setQLocal('');
    setSearchParams(() => new URLSearchParams(), false);
  };

  const safeData = Array.isArray(data) ? data : [];
  const stats = useMemo(() => computeDatasetStats(safeData), [safeData]);
  const filterOptions = useMemo(
    () =>
      Object.fromEntries(DATASET_FILTERS.map((filter) => [filter.key, getFilterValues(safeData, filter.field)])) as Record<FilterKey, string[]>,
    [safeData]
  );
  const filterCounts = useMemo(
    () =>
      Object.fromEntries(
        DATASET_FILTERS.map((filter) => [
          filter.key,
          Object.fromEntries(
            filterOptions[filter.key].map((value) => [
              value,
              new Set(
                safeData
                  .filter((dataset) => {
                    const fieldValue = dataset[filter.field] as string | string[] | null | undefined;
                    return Array.isArray(fieldValue) ? fieldValue.includes(value) : fieldValue === value;
                  })
                  .map((dataset) => dataset.parent_dataset ?? dataset.name)
              ).size,
            ])
          ),
        ])
      ) as Record<FilterKey, Record<string, number>>,
    [safeData, filterOptions]
  );

  const fieldFilterConfigs = useMemo(
    () =>
      DATASET_FILTERS.map((filter) => ({
        field: filter.field,
        values: selections[filter.key],
        mode: filter.mode,
      })),
    [selections]
  );

  const { status: semanticStatus, activate: activateSemanticSearch, search: semanticSearch } =
    useSemanticDatasetSearch(safeData);

  // Field filters alone, over the full corpus — computed once and shared by both
  // `substringFiltered` (below) and the semantic re-ranking path, instead of each running its own
  // full-corpus field-filter pass.
  const fieldFilteredOnly = useMemo(
    () => filterDatasets(safeData, { fieldFilters: fieldFilterConfigs }),
    [safeData, fieldFilterConfigs]
  );

  // Instant baseline — exact substring-match behavior. Always computed so results never blank
  // out while the semantic engine (model + index, ~46MB on first activation) is loading, or if
  // it errors.
  const substringFiltered = useMemo(
    () => filterDatasets(fieldFilteredOnly, { q: qDeferred || undefined }),
    [fieldFilteredOnly, qDeferred]
  );

  const [semanticOrder, setSemanticOrder] = useState<{ query: string; names: string[] } | null>(null);

  useEffect(() => {
    const query = qDeferred.trim();
    if (!query || semanticStatus !== 'ready') return;
    let cancelled = false;
    semanticSearch(query).then((names) => {
      if (!cancelled && names) setSemanticOrder({ query, names });
    });
    return () => {
      cancelled = true;
    };
  }, [qDeferred, semanticStatus, semanticSearch]);

  // `semanticRankApplied` is true only if at least one semantically-ranked result actually
  // survived the active field filters into `ordered` — otherwise (e.g. field filters exclude
  // every dataset the semantic engine ranked highly) `ordered` falls through entirely to
  // `substringFiltered`'s plain substring-match order, and the "Ranked by relevance" badge
  // (below) must not claim credit for an ordering it didn't produce.
  const { filtered, semanticRankApplied } = useMemo(() => {
    const query = qDeferred.trim();
    if (!query || semanticOrder?.query !== query) {
      return { filtered: substringFiltered, semanticRankApplied: false };
    }

    // Re-rank by semantic order, but still respect the active structured field filters (already
    // computed above, without `q`, as `fieldFilteredOnly`).
    const byName = new Map(fieldFilteredOnly.map((d) => [d.name, d]));
    const seen = new Set<string>();
    const ordered: typeof substringFiltered = [];
    for (const name of semanticOrder.names) {
      const dataset = byName.get(name);
      if (dataset && !seen.has(name)) {
        ordered.push(dataset);
        seen.add(name);
      }
    }
    const semanticRankApplied = ordered.length > 0;
    for (const dataset of substringFiltered) {
      if (!seen.has(dataset.name)) {
        ordered.push(dataset); // safety net: never regress vs. today's substring results
        seen.add(dataset.name);
      }
    }
    return { filtered: ordered, semanticRankApplied };
  }, [qDeferred, semanticOrder, substringFiltered, fieldFilteredOnly]);

  const INITIAL_SHOW = 60;
  const [showCount, setShowCount] = useState(INITIAL_SHOW);
  const [selectedDatasetName, setSelectedDatasetName] = useState<string | null>(null);

  // Supports deep links like /datasets?dataset=<name> (e.g. from the leaderboard's
  // "view dataset" link) by opening that dataset's modal once its data has loaded.
  const datasetParam = searchParams.get('dataset');
  useEffect(() => {
    if (datasetParam) setSelectedDatasetName(datasetParam);
  }, [datasetParam]);

  const displayed = useMemo(() => filtered.slice(0, showCount), [filtered, showCount]);
  const hasMore = filtered.length > showCount;
  const distinctDatasetCount = useMemo(
    () => new Set(filtered.map((dataset) => dataset.parent_dataset ?? dataset.name)).size,
    [filtered]
  );
  const selectedDataset = useMemo(
    () => safeData.find((dataset) => dataset.name === selectedDatasetName) ?? null,
    [safeData, selectedDatasetName]
  );

  const openDataset = useCallback((datasetName: string, trigger: HTMLButtonElement) => {
    selectedTriggerRef.current = trigger;
    selectedScrollYRef.current = window.scrollY;
    setSelectedDatasetName(datasetName);
  }, []);

  const closeDataset = useCallback(() => {
    setSelectedDatasetName(null);
    window.requestAnimationFrame(() => {
      selectedTriggerRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: selectedScrollYRef.current, left: window.scrollX, behavior: 'auto' });
    });
  }, []);

  useEffect(() => {
    setShowCount(INITIAL_SHOW);
  }, [qDeferred, activeFilterCount]);

  return (
    <Layout title="Dataset Search" description="Browse AgML datasets by task, platform, and modality.">
      <div className={styles.page}>
        <DatasetMetadataModal
          dataset={selectedDataset}
          open={selectedDataset != null}
          onClose={closeDataset}
        />

        <div className={styles.toolbar}>
          <input
            id="dataset-search"
            type="search"
            placeholder="search datasets, tasks, crops..."
            value={qLocal}
            onChange={(event) => setQLocal(event.target.value)}
            onFocus={activateSemanticSearch}
            className={styles.searchInput}
          />
          <div className={styles.toolbarRight}>
            {semanticStatus === 'loading' && (
              <span className={styles.semanticBadge} aria-live="polite">
                Enabling smart search…
              </span>
            )}
            {semanticStatus === 'ready' && qDeferred.trim() && semanticOrder?.query === qDeferred.trim() && semanticRankApplied && (
              <span className={styles.semanticBadge}>Ranked by relevance</span>
            )}
            <span className={styles.resultCount}>{distinctDatasetCount.toLocaleString()} datasets</span>
            <span className={styles.resultCount}>
              {stats.imageCount.toLocaleString()} images · {stats.taskTypeCount} task types
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
            {DATASET_FILTERS.map((filter) =>
              filter.kind === 'checkbox' ? (
                <CheckboxFilterGroup
                  key={filter.key}
                  label={filter.label}
                  options={filterOptions[filter.key]}
                  selected={selections[filter.key]}
                  onToggle={(value) => toggleMultiFilter(filter.key, value)}
                  formatOption={filter.formatOption}
                  counts={filterCounts[filter.key]}
                />
              ) : (
                <div key={filter.key} className={styles.filterGroup}>
                  <MultiSelectDropdown
                    label={filter.label}
                    options={filterOptions[filter.key]}
                    selected={selections[filter.key]}
                    onToggle={(value) => toggleMultiFilter(filter.key, value)}
                    formatOption={filter.formatOption}
                  />
                </div>
              )
            )}
          </aside>

          <section className={styles.results}>
            {loading && <p className={styles.status}>Loading datasets…</p>}
            {error && <p className={styles.status}>Error: {error.message}</p>}
            {!loading && !error && (
              <>
                {filtered.length === 0 ? (
                  <p className={styles.status}>No datasets match the current filters.</p>
                ) : (
                  <div className={styles.cardGrid}>
                    {displayed.map((dataset) => (
                      <DatasetCard key={dataset.name} dataset={dataset} onOpen={(trigger) => openDataset(dataset.name, trigger)} />
                    ))}
                  </div>
                )}
                {hasMore && (
                  <div className={styles.loadMore}>
                    <button
                      type="button"
                      className={styles.loadMoreButton}
                      onClick={() => setShowCount((count) => count + INITIAL_SHOW)}
                    >
                      Load more results
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
