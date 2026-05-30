import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@theme/Layout';
import { useHistory, useLocation } from '@docusaurus/router';
import { DatasetMetadataModal } from '../../components/DatasetMetadataModal';
import styles from './index.module.css';
import { filterDatasets, formatDisplayLocation, useDatasets } from '../../lib/datasets';

const CHIP_CLASSES = `${styles.chip} ${styles.chipBase}`;

type FilterKind = 'dropdown' | 'chips';

type DatasetFilterConfig = {
  key: string;
  label: string;
  field: keyof import('../../lib/datasets').Dataset;
  kind: FilterKind;
  formatOption?: (value: string) => string;
  chipLabel?: string;
  mode?: 'exact' | 'containsAny';
};

const DATASET_FILTERS: DatasetFilterConfig[] = [
  {
    key: 'ml_task',
    label: 'Task',
    chipLabel: 'Task',
    field: 'machine_learning_task',
    kind: 'chips',
    formatOption: (value) => value.replace(/_/g, ' '),
  },
  {
    key: 'ag_task',
    label: 'Ag task',
    field: 'agricultural_task',
    kind: 'dropdown',
    formatOption: (value) => value.replace(/_/g, ' '),
  },
  {
    key: 'environment',
    label: 'Environment',
    chipLabel: 'Environment',
    field: 'environment',
    kind: 'chips',
    formatOption: (value) => value.charAt(0).toUpperCase() + value.slice(1),
  },
  {
    key: 'augmented_counterpart',
    label: 'Augmented counterpart',
    chipLabel: 'Augmented',
    field: 'augmented_counterpart',
    kind: 'chips',
    formatOption: (value) => (value === 'yes' ? 'Yes' : 'No'),
  },
  {
    key: 'crop_types',
    label: 'Crop type',
    chipLabel: 'Crop type',
    field: 'crop_types',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => value.replace(/_/g, ' '),
  },
  {
    key: 'location',
    label: 'Location',
    chipLabel: 'Location',
    field: 'location',
    kind: 'dropdown',
    mode: 'containsAny',
    formatOption: (value) => value,
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
    label: 'Data',
    chipLabel: 'Data',
    field: 'real_or_synthetic',
    kind: 'chips',
    formatOption: (value) => value,
  },
];

type FilterKey = (typeof DATASET_FILTERS)[number]['key'];

type ActiveFilterChip = {
  key: FilterKey;
  value: string;
  label: string;
};

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

function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  formatOption = (value: string) => value.replace(/_/g, ' '),
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  formatOption?: (value: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(`[data-dropdown=\"${label}\"]`)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [label]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      case 'ArrowDown':
        event.preventDefault();
        setFocusedIndex((index) => (index + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusedIndex((index) => (index - 1 + options.length) % options.length);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (options[focusedIndex] != null) onToggle(options[focusedIndex]);
        break;
      default:
        break;
    }
  };

  return (
    <div className={styles.dropdown} data-dropdown={label}>
      <label className={styles.dropdownLabel}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onKeyDown}
        aria-expanded={open}
        className={styles.dropdownTrigger}
      >
        <span>
          {selected.length === 0
            ? 'All'
            : selected.length === 1
              ? formatOption(selected[0])
              : `${selected.length} selected`}
        </span>
        <span className={styles.dropdownChevron} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.dropdownMenu} role="listbox" aria-multiselectable="true">
          {options.map((option, index) => {
            const isSelected = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                className={`${styles.dropdownOption} ${isSelected ? styles.dropdownOptionSelected : ''}`}
                onClick={() => onToggle(option)}
                onKeyDown={onKeyDown}
                onFocus={() => setFocusedIndex(index)}
              >
                <span className={styles.dropdownCheckbox} aria-hidden>
                  {isSelected ? '✓' : ''}
                </span>
                {formatOption(option)}
              </button>
            );
          })}
        </div>
      )}
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
  const { name, machine_learning_task, agricultural_task, num_images, location } = dataset;
  const mainTask = machine_learning_task || agricultural_task;
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
        <div className={styles.cardDetails}>
          <div className={styles.cardDetail}>
            <span className={styles.cardDetailLabel}>Main task</span>
            <span className={styles.cardDetailValue}>
              {mainTask ? toLabel(mainTask) : 'Unknown'}
            </span>
          </div>
          <div className={styles.cardDetail}>
            <span className={styles.cardDetailLabel}>Images</span>
            <span className={styles.cardDetailValue}>{formatImageCount(num_images)}</span>
          </div>
          <div className={styles.cardDetail}>
            <span className={styles.cardDetailLabel}>Location</span>
            <span className={styles.cardDetailValue}>{formatDisplayLocation(location)}</span>
          </div>
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

  const activeFilterCount = DATASET_FILTERS.reduce((count, filter) => count + selections[filter.key].length, 0);

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

  const removeFilterValue = (key: string, value: string) => {
    setSearchParams((prev) => {
      const current = prev.getAll(key);
      const rest = current.filter((v) => v !== value);
      const nextParams = new URLSearchParams(prev);
      nextParams.delete(key);
      rest.forEach((v) => nextParams.append(key, v));
      return nextParams;
    });
  };

  const hasActiveFilters = Boolean(qDeferred || activeFilterCount);

  const clearFilters = () => {
    setQLocal('');
    setSearchParams(() => new URLSearchParams(), false);
  };

  const safeData = Array.isArray(data) ? data : [];
  const filterOptions = useMemo(
    () =>
      Object.fromEntries(DATASET_FILTERS.map((filter) => [filter.key, getFilterValues(safeData, filter.field)])) as Record<FilterKey, string[]>,
    [safeData]
  );

  const filtered = useMemo(
    () =>
      filterDatasets(safeData, {
        q: qDeferred || undefined,
        fieldFilters: DATASET_FILTERS.map((filter) => ({
          field: filter.field,
          values: selections[filter.key],
          mode: filter.mode,
        })),
      }),
    [safeData, qDeferred, selections]
  );

  const taskTypes = filterOptions.ml_task.length;

  const INITIAL_SHOW = 60;
  const [showCount, setShowCount] = useState(INITIAL_SHOW);
  const [selectedDatasetName, setSelectedDatasetName] = useState<string | null>(null);
  const displayed = useMemo(() => filtered.slice(0, showCount), [filtered, showCount]);
  const hasMore = filtered.length > showCount;
  const selectedDataset = useMemo(
    () => safeData.find((dataset) => dataset.name === selectedDatasetName) ?? null,
    [safeData, selectedDatasetName]
  );
  const topLevelDatasetCount = useMemo(
    () => safeData.filter((dataset) => !dataset.parent_dataset).length,
    [safeData]
  );
  const totalImageCount = useMemo(
    () => safeData.reduce((sum, dataset) => sum + (dataset.num_images ?? 0), 0),
    [safeData]
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

  const activeFilterChips = useMemo(() => {
    const list: ActiveFilterChip[] = [];
    DATASET_FILTERS.forEach((filter) => {
      selections[filter.key].forEach((value) => {
        list.push({
          key: filter.key,
          value,
          label: filter.formatOption ? filter.formatOption(value) : value,
        });
      });
    });
    return list;
  }, [selections]);

  return (
    <Layout title="Dataset Search" description="Browse AgML datasets by task, platform, and modality.">
      <div className={styles.page}>
        <DatasetMetadataModal
          dataset={selectedDataset}
          open={selectedDataset != null}
          onClose={closeDataset}
        />
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <p className={styles.heroTag}>AgML Dataset Hub</p>
            <h1 className={styles.heroTitle}>Search agricultural datasets fast.</h1>
            <p className={styles.heroSubtitle}>
              Filter by task, crop type, environment, location, and platform. Browse the
              AgML datasets and the new Hugging Face-backed entries in one place.
            </p>
            <div className={styles.heroStats}>
              <div className={styles.heroStat}>
                <span>{topLevelDatasetCount.toLocaleString()}</span>
                <span>datasets</span>
              </div>
              <div className={styles.heroStat}>
                <span>{totalImageCount.toLocaleString()}</span>
                <span>images</span>
              </div>
              <div className={styles.heroStat}>
                <span>{taskTypes}</span>
                <span>task types</span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.controls}>
          <div className={styles.searchBlock}>
            <label className={styles.searchLabel} htmlFor="dataset-search">
              Search
            </label>
            <input
              id="dataset-search"
              type="search"
              placeholder="Name, task, platform, location…"
              value={qLocal}
              onChange={(event) => setQLocal(event.target.value)}
              className={styles.searchInput}
            />
          </div>
          <div className={styles.dropdownRow}>
            {DATASET_FILTERS.filter((filter) => filter.kind === 'dropdown').map((filter) => (
              <MultiSelectDropdown
                key={filter.key}
                label={filter.label}
                options={filterOptions[filter.key]}
                selected={selections[filter.key]}
                onToggle={(value) => toggleMultiFilter(filter.key, value)}
                formatOption={filter.formatOption}
              />
            ))}
          </div>
        </section>

        <section className={styles.chipsSection}>
          {DATASET_FILTERS.filter((filter) => filter.kind === 'chips').map((filter) => (
            <div key={filter.key} className={styles.chipGroup}>
              <span className={styles.chipLabel}>{filter.chipLabel ?? filter.label}</span>
              {filterOptions[filter.key].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleMultiFilter(filter.key, value)}
                  className={`${CHIP_CLASSES} ${selections[filter.key].includes(value) ? styles.chipActive : styles.chipInactive}`}
                >
                  {filter.formatOption ? filter.formatOption(value) : value}
                </button>
              ))}
            </div>
          ))}
        </section>

        {hasActiveFilters && (
          <section className={styles.activeFilters}>
            <div className={styles.activeList}>
              {activeFilterChips.map((chip) => (
                <button
                  key={`${chip.key}-${chip.value}`}
                  type="button"
                  className={styles.activeChip}
                  onClick={() => removeFilterValue(chip.key, chip.value)}
                >
                  {chip.label} ×
                </button>
              ))}
            </div>
            <button type="button" className={styles.clearButton} onClick={clearFilters}>
              Clear filters
            </button>
          </section>
        )}

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
    </Layout>
  );
}
