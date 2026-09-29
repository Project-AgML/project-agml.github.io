import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Layout from '@theme/Layout';
import {
  computeModelComparisonDetail,
  computeModelComparisons,
  computeModelOptions,
  METRIC_LABELS,
  useGlobalPerformance,
} from '../../lib/performance';
import type { CategoryComparisons, ModelOption } from '../../lib/performance';
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown';
import { LeaderboardDetailModal } from '../../components/LeaderboardDetailModal';
import { useDatasets } from '../../lib/datasets';
import { toDisplayLabel } from '../../lib/labelOverrides';
import styles from './index.module.css';

type SortField = 'f1' | 'precision' | 'recall';

const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'f1', label: 'Avg F1 rank' },
  { value: 'precision', label: 'Avg Precision rank' },
  { value: 'recall', label: 'Avg Recall rank' },
];

const MATRIX_PAGE_SIZE = 15;
const MODEL_LIST_PAGE_SIZE = 15;

function shortTaskLabel(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes('classif')) return 'Classification';
  if (lower.includes('detect')) return 'Detection';
  if (lower.includes('segment')) return 'Segmentation';
  return toDisplayLabel(value);
}

function formatAvgRank(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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

export default function GlobalLeaderboardPage() {
  const { data: records, loading, error } = useGlobalPerformance();
  const { data: datasets } = useDatasets();

  const [search, setSearch] = useState('');
  const searchDeferred = useDeferredValue(search);
  const [cropTypes, setCropTypes] = useState<string[]>([]);
  const [mlTasks, setMlTasks] = useState<string[]>([]);
  const [agTasks, setAgTasks] = useState<string[]>([]);
  const [tuned, setTuned] = useState<('tuned' | 'not-tuned')[]>([]);
  const [optimizedValues, setOptimizedValues] = useState<('optimized' | 'not-optimized')[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortField>('f1');
  const [breakdownMetric, setBreakdownMetric] = useState<SortField>('f1');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { cropTypeOptions, mlTaskOptions, platformOptions } = useMemo(() => {
    const cropSet = new Set<string>();
    const taskSet = new Set<string>();
    const platformSet = new Set<string>();
    for (const record of records) {
      record.crop_types?.forEach((crop) => cropSet.add(crop));
      if (record.machine_learning_task) taskSet.add(record.machine_learning_task);
      if (record.platform) platformSet.add(record.platform);
    }
    return {
      cropTypeOptions: Array.from(cropSet).sort((a, b) => a.localeCompare(b)),
      mlTaskOptions: Array.from(taskSet).sort((a, b) => a.localeCompare(b)),
      platformOptions: Array.from(platformSet).sort((a, b) => a.localeCompare(b)),
    };
  }, [records]);

  const { agTaskOptions, datasetsByAgTask } = useMemo(() => {
    const agTaskSet = new Set<string>();
    const byAgTask = new Map<string, string[]>();
    for (const dataset of datasets) {
      if (!dataset.agricultural_task) continue;
      agTaskSet.add(dataset.agricultural_task);
      const list = byAgTask.get(dataset.agricultural_task) ?? [];
      list.push(dataset.name);
      byAgTask.set(dataset.agricultural_task, list);
    }
    return {
      agTaskOptions: Array.from(agTaskSet).sort((a, b) => a.localeCompare(b)),
      datasetsByAgTask: byAgTask,
    };
  }, [datasets]);

  const agTaskDatasets = useMemo(() => {
    if (!agTasks.length) return [];
    return agTasks.flatMap((task) => datasetsByAgTask.get(task) ?? []);
  }, [agTasks, datasetsByAgTask]);

  const toggleValue = <T,>(setter: (updater: (current: T[]) => T[]) => void, value: T) => {
    setter((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  const hasActiveFilters =
    cropTypes.length > 0 ||
    mlTasks.length > 0 ||
    agTasks.length > 0 ||
    tuned.length > 0 ||
    optimizedValues.length > 0 ||
    platforms.length > 0;
  const clearFilters = () => {
    setCropTypes([]);
    setMlTasks([]);
    setAgTasks([]);
    setTuned([]);
    setOptimizedValues([]);
    setPlatforms([]);
  };

  const filterOptions = useMemo(
    () => ({
      cropTypes,
      mlTasks,
      tuned,
      optimizedValues,
      platforms,
      datasets: agTaskDatasets,
    }),
    [cropTypes, mlTasks, tuned, optimizedValues, platforms, agTaskDatasets]
  );

  const modelOptions = useMemo(() => computeModelOptions(records, filterOptions), [records, filterOptions]);

  // Filters can shrink the eligible model pool out from under an existing selection — drop any
  // selected model that no longer has a matching result rather than silently comparing stale data.
  useEffect(() => {
    setSelectedIds((current) => {
      const available = new Set(modelOptions.map((option) => option.id));
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
  }, [modelOptions]);

  const visibleModelOptions = useMemo(() => {
    const q = searchDeferred.trim().toLowerCase();
    if (!q) return modelOptions;
    return modelOptions.filter((option) => option.model.toLowerCase().includes(q));
  }, [modelOptions, searchDeferred]);

  // Group the selector list by CV task instead of labeling each row individually — within a
  // group, datasetCount-desc / name order from computeModelOptions is preserved.
  const modelSections = useMemo(() => {
    const groups = new Map<string, { task: string | null; options: typeof visibleModelOptions }>();
    for (const option of visibleModelOptions) {
      const key = option.task ?? '';
      const group = groups.get(key) ?? { task: option.task, options: [] };
      group.options.push(option);
      groups.set(key, group);
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.task == null) return 1;
      if (b.task == null) return -1;
      return shortTaskLabel(a.task).localeCompare(shortTaskLabel(b.task));
    });
  }, [visibleModelOptions]);

  // Flatten sections into a single row list (headers + models) so the whole selector can be
  // paginated without an unbounded DOM — the model list has no other cap now that the old
  // leaderboard's PAGE_SIZE-based pagination is gone.
  const modelListRows = useMemo(() => {
    const rows: ({ kind: 'header'; key: string; task: string | null } | { kind: 'option'; key: string; option: ModelOption })[] = [];
    for (const section of modelSections) {
      rows.push({ kind: 'header', key: `header-${section.task ?? '__none__'}`, task: section.task });
      for (const option of section.options) rows.push({ kind: 'option', key: option.id, option });
    }
    return rows;
  }, [modelSections]);

  const [modelListPage, setModelListPage] = useState(0);
  useEffect(() => {
    setModelListPage(0);
  }, [modelListRows]);

  const modelListTotalPages = Math.max(1, Math.ceil(modelListRows.length / MODEL_LIST_PAGE_SIZE));
  const modelListPageStart = modelListPage * MODEL_LIST_PAGE_SIZE;
  const modelListPageRows = useMemo(() => {
    const slice = modelListRows.slice(modelListPageStart, modelListPageStart + MODEL_LIST_PAGE_SIZE);
    // A section can span a page boundary — if this page starts mid-section, repeat that
    // section's header so the task grouping is never lost.
    if (slice.length && slice[0].kind === 'option') {
      for (let i = modelListPageStart - 1; i >= 0; i--) {
        const prior = modelListRows[i];
        if (prior.kind === 'header') return [prior, ...slice];
      }
    }
    return slice;
  }, [modelListRows, modelListPageStart]);

  const toggleModel = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((v) => v !== id) : [...current, id]));
  };

  const comparisons: CategoryComparisons = useMemo(
    () => computeModelComparisons(records, selectedIds, filterOptions),
    [records, selectedIds, filterOptions]
  );

  const modelOptionById = useMemo(() => new Map(modelOptions.map((option) => [option.id, option])), [modelOptions]);

  const comparisonRows = useMemo(() => {
    const avgRankById = (field: SortField) => new Map(comparisons[field].entries.map((entry) => [entry.id, entry.avgRank]));
    const f1ById = avgRankById('f1');
    const precisionById = avgRankById('precision');
    const recallById = avgRankById('recall');

    return selectedIds
      .map((id) => {
        const option = modelOptionById.get(id);
        return {
          id,
          model: option?.model ?? id,
          task: option?.task ?? null,
          f1: f1ById.get(id) ?? null,
          precision: precisionById.get(id) ?? null,
          recall: recallById.get(id) ?? null,
        };
      })
      .sort((a, b) => {
        const rankA = a[sortBy];
        const rankB = b[sortBy];
        if (rankA == null && rankB == null) return 0;
        if (rankA == null) return 1;
        if (rankB == null) return -1;
        return rankA - rankB;
      });
  }, [selectedIds, comparisons, sortBy, modelOptionById]);

  const hasAnyComparison = SORT_FIELDS.some((field) => comparisons[field.value].datasets.length > 0);
  const currentDatasetCount = comparisons[sortBy].datasets.length;

  const breakdownComparison = comparisons[breakdownMetric];
  // Column order stays fixed (alphabetical by model) regardless of which metric is selected —
  // breakdownComparison.entries is sorted by avgRank, which would otherwise reshuffle columns
  // every time the metric changes.
  const breakdownEntries = useMemo(
    () => [...breakdownComparison.entries].sort((a, b) => a.model.localeCompare(b.model)),
    [breakdownComparison]
  );
  const matrixGridStyle = {
    gridTemplateColumns: `minmax(160px, 1.6fr) repeat(${breakdownEntries.length}, minmax(100px, 1fr))`,
  };

  const [matrixPage, setMatrixPage] = useState(0);
  // A metric switch or a change to the selected/filtered models can shrink or reorder the dataset
  // list out from under the current page — go back to the first page rather than risk stranding
  // the user on a now out-of-range or unrelated page.
  useEffect(() => {
    setMatrixPage(0);
  }, [breakdownComparison]);
  const matrixTotalPages = Math.max(1, Math.ceil(breakdownComparison.datasets.length / MATRIX_PAGE_SIZE));
  const matrixPageStart = matrixPage * MATRIX_PAGE_SIZE;
  const matrixPageDatasets = breakdownComparison.datasets.slice(matrixPageStart, matrixPageStart + MATRIX_PAGE_SIZE);

  const detail = useMemo(
    () =>
      detailId && selectedIds.includes(detailId)
        ? computeModelComparisonDetail(records, detailId, selectedIds, sortBy, comparisons, filterOptions)
        : null,
    [records, detailId, selectedIds, sortBy, comparisons, filterOptions]
  );

  return (
    <Layout title="Model Leaderboard" description="Compare model rankings across shared AgML dataset benchmarks.">
      <div className={styles.page}>
        <LeaderboardDetailModal detail={detail} open={detail != null} onClose={() => setDetailId(null)} />

        <div className={styles.toolbar}>
          <input
            type="search"
            placeholder="search models..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.searchInput}
          />
          <div className={styles.toolbarRight}>
            <span className={styles.resultCount}>{modelOptions.length.toLocaleString()} models</span>
            {hasActiveFilters && (
              <button type="button" className={styles.clearButton} onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className={styles.body}>
          <aside className={styles.sidebar}>
            <CheckboxFilterGroup label="CV Task" options={mlTaskOptions} selected={mlTasks} onToggle={(value) => toggleValue(setMlTasks, value)} formatOption={shortTaskLabel} />
            <div className={styles.filterGroup}>
              <MultiSelectDropdown label="Agricultural Task" options={agTaskOptions} selected={agTasks} onToggle={(value) => toggleValue(setAgTasks, value)} formatOption={toDisplayLabel} />
            </div>
            <div className={styles.filterGroup}>
              <MultiSelectDropdown label="Crop" options={cropTypeOptions} selected={cropTypes} onToggle={(value) => toggleValue(setCropTypes, value)} formatOption={toDisplayLabel} />
            </div>
            <CheckboxFilterGroup
              label="Tuned"
              options={['tuned', 'not-tuned']}
              selected={tuned}
              onToggle={(value) => toggleValue(setTuned, value as 'tuned' | 'not-tuned')}
              formatOption={(value) => (value === 'tuned' ? 'Tuned' : 'Not tuned')}
            />
            <CheckboxFilterGroup
              label="Optimized"
              options={['optimized', 'not-optimized']}
              selected={optimizedValues}
              onToggle={(value) => toggleValue(setOptimizedValues, value as 'optimized' | 'not-optimized')}
              formatOption={(value) => (value === 'optimized' ? 'Optimized' : 'Not optimized')}
            />
            <CheckboxFilterGroup label="Platform" options={platformOptions} selected={platforms} onToggle={(value) => toggleValue(setPlatforms, value)} formatOption={toDisplayLabel} />
          </aside>

          <section className={styles.results}>
            {loading && <p className={styles.status}>Loading leaderboard…</p>}
            {error && <p className={styles.status}>Error: {error.message}</p>}
            {!loading && !error && (
              <div className={styles.compareLayout}>
                <div className={styles.selectorPanel}>
                  <div className={styles.selectorHeader}>
                    <p className={styles.filterGroupLabel}>Select models to compare</p>
                    <div className={styles.selectorHeaderRight}>
                      <span className={styles.resultCount}>{selectedIds.length} selected</span>
                      {selectedIds.length > 0 && (
                        <button type="button" className={styles.clearButton} onClick={() => setSelectedIds([])}>
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={styles.modelList}>
                    {visibleModelOptions.length === 0 ? (
                      <p className={styles.status}>No models match the current filters.</p>
                    ) : (
                      modelListPageRows.map((row) =>
                        row.kind === 'header' ? (
                          <p key={row.key} className={styles.modelSectionHeading}>
                            {row.task ? shortTaskLabel(row.task) : 'Other'}
                          </p>
                        ) : (
                          <label
                            key={row.key}
                            className={`${styles.modelRow} ${selectedIds.includes(row.option.id) ? styles.modelRowSelected : ''}`}
                          >
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={selectedIds.includes(row.option.id)}
                              onChange={() => toggleModel(row.option.id)}
                            />
                            <span className={styles.modelRowName}>{row.option.model}</span>
                            <span className={styles.modelRowMeta}>
                              {row.option.datasetCount} dataset{row.option.datasetCount === 1 ? '' : 's'}
                            </span>
                          </label>
                        )
                      )
                    )}
                  </div>
                  {modelListTotalPages > 1 && (
                    <div className={styles.pagination}>
                      <button
                        type="button"
                        className={styles.paginationButton}
                        onClick={() => setModelListPage((page) => Math.max(0, page - 1))}
                        disabled={modelListPage === 0}
                      >
                        Previous
                      </button>
                      <span className={styles.paginationStatus}>
                        Page {modelListPage + 1} of {modelListTotalPages} · {visibleModelOptions.length} models
                      </span>
                      <button
                        type="button"
                        className={styles.paginationButton}
                        onClick={() => setModelListPage((page) => Math.min(modelListTotalPages - 1, page + 1))}
                        disabled={modelListPage >= modelListTotalPages - 1}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>

                <div className={styles.comparePanel}>
                  {selectedIds.length < 2 ? (
                    <p className={styles.status}>Select at least 2 models on the left to compare their average ranking.</p>
                  ) : !hasAnyComparison ? (
                    <p className={styles.status}>
                      The selected models have no F1, Precision, or Recall results on a shared dataset under the current
                      filters.
                    </p>
                  ) : (
                    <>
                      <div className={styles.compareHeader}>
                        <h2 className={styles.tableHeading}>Average ranking</h2>
                        <span className={styles.resultCount}>
                          {currentDatasetCount} shared dataset{currentDatasetCount === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className={styles.tableWrap}>
                        <div className={`${styles.leaderboardTable} ${styles.compareTable}`} role="table">
                          <div className={styles.tableRow} role="row">
                            <span role="columnheader">#</span>
                            <span role="columnheader">Model</span>
                            {SORT_FIELDS.map((field) => (
                              <span role="columnheader" key={field.value}>
                                <button
                                  type="button"
                                  className={`${styles.sortHeader} ${sortBy === field.value ? styles.sortHeaderActive : ''}`}
                                  onClick={() => setSortBy(field.value)}
                                >
                                  <span>{field.label}</span>
                                  <span>{sortBy === field.value ? '▲' : '▾'}</span>
                                </button>
                              </span>
                            ))}
                          </div>
                          {comparisonRows.map((row, index) => {
                            const hasDetail = row[sortBy] != null;
                            return (
                            <div
                              key={row.id}
                              role="row"
                              tabIndex={hasDetail ? 0 : -1}
                              className={`${styles.tableRow} ${hasDetail ? styles.clickableRow : ''}`}
                              onClick={hasDetail ? () => setDetailId(row.id) : undefined}
                              onKeyDown={
                                hasDetail
                                  ? (event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        setDetailId(row.id);
                                      }
                                    }
                                  : undefined
                              }
                            >
                              <span role="cell" className={styles.rankPosition}>
                                {index + 1}
                              </span>
                              <span role="cell">
                                <span className={styles.modelName}>
                                  {row.model}
                                  {row.task ? ` · ${shortTaskLabel(row.task)}` : ''}
                                </span>
                              </span>
                              {SORT_FIELDS.map((field) => (
                                <span role="cell" className={styles.avgRankValue} key={field.value}>
                                  {row[field.value] == null ? <span className={styles.metricEmpty}>—</span> : formatAvgRank(row[field.value]!)}
                                </span>
                              ))}
                            </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className={styles.matrixSection}>
                        <div className={styles.matrixHeader}>
                          <p className={styles.filterGroupLabel}>Per-dataset breakdown</p>
                          <div className={styles.breakdownMetricTabs} role="tablist" aria-label="Breakdown score">
                            {SORT_FIELDS.map((field) => (
                              <button
                                key={field.value}
                                type="button"
                                role="tab"
                                aria-selected={breakdownMetric === field.value}
                                className={`${styles.breakdownMetricButton} ${breakdownMetric === field.value ? styles.breakdownMetricButtonActive : ''}`}
                                onClick={() => setBreakdownMetric(field.value)}
                              >
                                {METRIC_LABELS[field.value]}
                              </button>
                            ))}
                          </div>
                        </div>

                        {breakdownComparison.datasets.length === 0 ? (
                          <p className={styles.status}>
                            The selected models have no shared {METRIC_LABELS[breakdownMetric]} results to break down.
                          </p>
                        ) : (
                          <>
                            <div className={styles.tableWrap}>
                              <div className={styles.leaderboardTable} role="table">
                                <div className={styles.tableRow} role="row" style={matrixGridStyle}>
                                  <span role="columnheader">Dataset</span>
                                  {breakdownEntries.map((entry) => (
                                    <span role="columnheader" key={entry.id}>
                                      {entry.model}
                                      {entry.task ? ` · ${shortTaskLabel(entry.task)}` : ''}
                                    </span>
                                  ))}
                                </div>
                                {matrixPageDatasets.map((dataset, pageIndex) => {
                                  const datasetIndex = matrixPageStart + pageIndex;
                                  return (
                                    <div className={styles.tableRow} role="row" style={matrixGridStyle} key={dataset}>
                                      <span role="cell">{toDisplayLabel(dataset)}</span>
                                      {breakdownEntries.map((entry) => {
                                        const cell = entry.datasetRanks[datasetIndex];
                                        return (
                                          <span role="cell" key={entry.id}>
                                            {cell.score.toFixed(3)} <span className={styles.matrixRank}>(#{cell.rank})</span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            {matrixTotalPages > 1 && (
                              <div className={styles.pagination}>
                                <button
                                  type="button"
                                  className={styles.paginationButton}
                                  onClick={() => setMatrixPage((page) => Math.max(0, page - 1))}
                                  disabled={matrixPage === 0}
                                >
                                  Previous
                                </button>
                                <span className={styles.paginationStatus}>
                                  Datasets {matrixPageStart + 1}–{Math.min(matrixPageStart + MATRIX_PAGE_SIZE, breakdownComparison.datasets.length)} of{' '}
                                  {breakdownComparison.datasets.length}
                                </span>
                                <button
                                  type="button"
                                  className={styles.paginationButton}
                                  onClick={() => setMatrixPage((page) => Math.min(matrixTotalPages - 1, page + 1))}
                                  disabled={matrixPage >= matrixTotalPages - 1}
                                >
                                  Next
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
