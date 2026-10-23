import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@theme/Layout';
import { useHistory, useLocation } from '@docusaurus/router';
import { DatasetMetadataModal } from '../../components/DatasetMetadataModal';
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown';
import styles from './index.module.css';
import { computeDatasetStats, datasetGroupKey, filterDatasets, formatPrimaryLocation, isVlmTask, useDatasets } from '../../lib/datasets';
import { toDisplayLabel, toNameTitleCase } from '../../lib/labelOverrides';
import { useSemanticDatasetSearch } from '../../lib/semanticSearch';

type FilterKind = 'checkbox' | 'dropdown';

type DatasetFilterConfig = {
  key: string;
  label: string;
  field: keyof import('../../lib/datasets').Dataset;
  kind: FilterKind;
  formatOption?: (value: string) => string;
  mode?: 'exact' | 'containsAny';
  // Leave VLM (image-text-to-text) datasets' values out of this filter's options.
  excludeVlm?: boolean;
};

const DATASET_FILTERS: DatasetFilterConfig[] = [
  {
    key: 'ml_task',
    label: 'CV Task',
    field: 'machine_learning_task',
    kind: 'checkbox',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'ag_task',
    label: 'Agricultural Task',
    field: 'agricultural_task',
    kind: 'dropdown',
    formatOption: (value) => toDisplayLabel(value),
    // VLM agricultural tasks are free-form and rarely shared across datasets; keep them out of
    // the options until they're standardized to a common set.
    excludeVlm: true,
  },
  {
    key: 'crop_types',
    label: 'Crop',
    field: 'crop_types',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'location',
    label: 'Location',
    field: 'display_location',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'platform',
    label: 'Platform',
    field: 'platform',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'qa_type',
    label: 'QA Type',
    field: 'qa_type',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'modality',
    label: 'Modality',
    field: 'display_modality',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'conversation_type',
    label: 'Conversation Type',
    field: 'conversation_type',
    kind: 'checkbox',
    mode: 'containsAny',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'environment',
    label: 'Environment',
    field: 'environment',
    kind: 'checkbox',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'real',
    label: 'Data Type',
    field: 'real_or_synthetic',
    kind: 'checkbox',
    formatOption: (value) => toDisplayLabel(value),
  },
  {
    key: 'augmented_counterpart',
    label: 'Augmented',
    field: 'augmented_counterpart',
    kind: 'checkbox',
    formatOption: (value) => (value === 'yes' ? 'Yes' : 'No'),
  }
];

type FilterKey = (typeof DATASET_FILTERS)[number]['key'];

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
  if (isVlmTask(task)) return styles.badgeVlm;
  if (task.includes('classif')) return styles.badgeClassification;
  if (task.includes('detect')) return styles.badgeDetection;
  if (task.includes('segment')) return styles.badgeSegmentation;
  return styles.badgeOther;
}

function getFilterValues(
  datasets: import('../../lib/datasets').Dataset[],
  { field, excludeVlm }: DatasetFilterConfig
): string[] {
  const values = datasets.flatMap((dataset) => {
    if (excludeVlm && dataset.dataset_type === 'vlm') return [];
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

// QA pairs range filter, in thousands. Stored in the URL as `qa_min` / `qa_max`; either is
// omitted while its handle sits at the end of the track.
const QA_MIN_PARAM = 'qa_min';
const QA_MAX_PARAM = 'qa_max';
// Left end of the slider: a log scale can't start at 0.
const QA_SLIDER_MIN = 1;

function parseThousands(value: string | null): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// The slider's handles move on a log scale so small datasets (a few k) and large ones (hundreds
// of k) are equally easy to pick out; values in between snap to 2 significant figures.
const LOG_SLIDER_STEPS = 1000;

function roundToTwoSignificant(n: number): number {
  return n > 0 ? Number(n.toPrecision(2)) : 0;
}

function RangeSliderFilter({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
}) {
  const toPosition = (n: number) =>
    max > min ? Math.round((LOG_SLIDER_STEPS * Math.log(Math.max(n, min) / min)) / Math.log(max / min)) : 0;
  const fromPosition = (position: number) => {
    if (position <= 0) return min;
    if (position >= LOG_SLIDER_STEPS) return max;
    return Math.min(max, Math.max(min, roundToTwoSignificant(min * (max / min) ** (position / LOG_SLIDER_STEPS))));
  };

  // Local while dragging; committed to the URL after a short pause, like the search box.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value[0], value[1]]);
  useEffect(() => {
    if (draft[0] === value[0] && draft[1] === value[1]) return;
    const timeout = setTimeout(() => onChange(draft), 200);
    return () => clearTimeout(timeout);
  }, [draft[0], draft[1]]);

  const [low, high] = draft;
  const pct = (n: number) => (toPosition(n) / LOG_SLIDER_STEPS) * 100;

  return (
    <div className={styles.filterGroup}>
      <p className={styles.filterGroupLabel}>{label}</p>
      <div className={styles.rangeSlider}>
        <div className={styles.rangeTrack} />
        <div className={styles.rangeFill} style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }} />
        <input
          type="range"
          aria-label={`${label} minimum (thousands)`}
          min={0}
          max={LOG_SLIDER_STEPS}
          step={1}
          value={toPosition(low)}
          onChange={(event) => setDraft([Math.min(fromPosition(Number(event.target.value)), high), high])}
        />
        <input
          type="range"
          aria-label={`${label} maximum (thousands)`}
          min={0}
          max={LOG_SLIDER_STEPS}
          step={1}
          value={toPosition(high)}
          onChange={(event) => setDraft([low, Math.max(fromPosition(Number(event.target.value)), low)])}
        />
      </div>
      <div className={styles.rangeLabels}>
        <span>{low}k</span>
        <span>{high}k</span>
      </div>
    </div>
  );
}

// VLM datasets list many agricultural tasks; the card shows the first few, the modal shows all.
const MAX_CARD_AG_TASKS = 2;

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
    num_qa_pairs,
    zip_size_bytes,
    augmented_num_images,
    augmented_zip_size_bytes,
    dataset_type,
  } = dataset;
  const fileSize = formatBytesDecimal(zip_size_bytes);
  const augmentedFileSize = formatBytesDecimal(augmented_zip_size_bytes);
  const hasAugmented = augmented_num_images != null;
  // VLM datasets are sized by QA pairs as well as images.
  const isVlm = dataset_type === 'vlm';
  const agTasks = agricultural_task == null ? [] : [agricultural_task].flat();
  const primaryLocation = formatPrimaryLocation(dataset);

  return (
    <button
      type="button"
      className={styles.cardButton}
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`Open details for ${name}`}
    >
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.cardTitleLink}>{isVlm ? name : toNameTitleCase(name)}</span>
        </h2>
        <div className={styles.cardTags}>
          {machine_learning_task && (
            <span className={`${styles.taskBadge} ${taskBadgeClass(machine_learning_task)}`}>
              {toDisplayLabel(machine_learning_task)}
            </span>
          )}
          {agTasks.slice(0, MAX_CARD_AG_TASKS).map((task) => (
            <span key={task} className={styles.tag}>{isVlm ? toDisplayLabel(task) : task}</span>
          ))}
          {agTasks.length > MAX_CARD_AG_TASKS && (
            <span className={styles.tag}>+{agTasks.length - MAX_CARD_AG_TASKS} more</span>
          )}
          {primaryLocation && <span className={styles.tag}>{primaryLocation}</span>}
        </div>
        <div className={styles.cardFooter}>
          <div className={styles.cardFooterRow}>
            <span>
              {formatImageCount(num_images)} images
              {isVlm && num_qa_pairs != null && <> · {formatImageCount(num_qa_pairs)} QA pairs</>}
            </span>
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

  const qaMinParam = parseThousands(searchParams.get(QA_MIN_PARAM));
  const qaMaxParam = parseThousands(searchParams.get(QA_MAX_PARAM));
  const qaRangeActive = qaMinParam != null || qaMaxParam != null;

  const activeFilterCount =
    DATASET_FILTERS.reduce((count, filter) => count + selections[filter.key].length, 0) + (qaRangeActive ? 1 : 0);
  const hasActiveFilters = Boolean(qDeferred || activeFilterCount);

  const clearFilters = () => {
    setQLocal('');
    setSearchParams(() => new URLSearchParams(), false);
  };

  const safeData = Array.isArray(data) ? data : [];
  const stats = useMemo(() => computeDatasetStats(safeData), [safeData]);
  const filterOptions = useMemo(
    () =>
      Object.fromEntries(DATASET_FILTERS.map((filter) => [filter.key, getFilterValues(safeData, filter)])) as Record<FilterKey, string[]>,
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
                  .map(datasetGroupKey)
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
  const qaSliderMax = useMemo(
    () => Math.ceil(Math.max(0, ...safeData.map((dataset) => dataset.num_qa_pairs ?? 0)) / 1000),
    [safeData]
  );
  const qaRange: [number, number] = [qaMinParam ?? QA_SLIDER_MIN, qaMaxParam ?? qaSliderMax];
  const setQaRange = ([low, high]: [number, number]) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (low > QA_SLIDER_MIN) next.set(QA_MIN_PARAM, String(low));
      else next.delete(QA_MIN_PARAM);
      if (high < qaSliderMax) next.set(QA_MAX_PARAM, String(high));
      else next.delete(QA_MAX_PARAM);
      return next;
    });
  };

  const fieldFilteredOnly = useMemo(() => {
    const out = filterDatasets(safeData, { fieldFilters: fieldFilterConfigs, includeChildren: false });
    if (!qaRangeActive) return out;
    // Datasets without a QA pair count (i.e. vision datasets) drop out once the range is narrowed.
    const low = (qaMinParam ?? 0) * 1000;
    const high = qaMaxParam != null ? qaMaxParam * 1000 : Infinity;
    return out.filter((dataset) => dataset.num_qa_pairs != null && dataset.num_qa_pairs >= low && dataset.num_qa_pairs <= high);
  }, [safeData, fieldFilterConfigs, qaRangeActive, qaMinParam, qaMaxParam]);

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
    () => new Set(filtered.map(datasetGroupKey)).size,
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
            {DATASET_FILTERS.map((filter) => (
              <Fragment key={filter.key}>
              {/* QA Pairs isn't a field filter, so it's slotted in right before Conversation Type. */}
              {filter.key === 'conversation_type' && qaSliderMax > QA_SLIDER_MIN && (
                <RangeSliderFilter label="QA Pairs" min={QA_SLIDER_MIN} max={qaSliderMax} value={qaRange} onChange={setQaRange} />
              )}
              {filter.kind === 'checkbox' ? (
                <CheckboxFilterGroup
                  label={filter.label}
                  options={filterOptions[filter.key]}
                  selected={selections[filter.key]}
                  onToggle={(value) => toggleMultiFilter(filter.key, value)}
                  formatOption={filter.formatOption}
                  counts={filterCounts[filter.key]}
                />
              ) : (
                <div className={styles.filterGroup}>
                  <MultiSelectDropdown
                    label={filter.label}
                    options={filterOptions[filter.key]}
                    selected={selections[filter.key]}
                    onToggle={(value) => toggleMultiFilter(filter.key, value)}
                    formatOption={filter.formatOption}
                  />
                </div>
              )}
              </Fragment>
            ))}
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