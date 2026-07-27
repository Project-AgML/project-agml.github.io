import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Layout from '@theme/Layout';
import {
  computeGlobalLeaderboard,
  useGlobalPerformance,
} from '../../lib/performance';
import type { GlobalLeaderboardEntry } from '../../lib/performance';
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown';
import { LeaderboardDetailModal } from '../../components/LeaderboardDetailModal';
import styles from './index.module.css';

const MIN_APPEARANCES = 3;
const PAGE_SIZE = 25;

type SortField = 'f1' | 'map' | 'precision' | 'recall';

function toLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function shortTaskLabel(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes('classif')) return 'Classification';
  if (lower.includes('detect')) return 'Detection';
  if (lower.includes('segment')) return 'Segmentation';
  return toLabel(value);
}

function percentileValue(entry: GlobalLeaderboardEntry, field: SortField) {
  switch (field) {
    case 'f1':
      return entry.avgF1Percentile;
    case 'map':
      return entry.avgMapPercentile;
    case 'precision':
      return entry.avgPrecisionPercentile;
    case 'recall':
      return entry.avgRecallPercentile;
  }
}

function taskBadgeClass(task: string | null): string {
  if (!task) return styles.badgeOther;
  if (task.includes('classif')) return styles.badgeClassification;
  if (task.includes('detect')) return styles.badgeDetection;
  if (task.includes('segment')) return styles.badgeSegmentation;
  return styles.badgeOther;
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

function PercentileCell({ value }: { value: number | null }) {
  if (value == null) {
    return <span className={styles.metricEmpty}>—</span>;
  }
  return (
    <div className={styles.metricCell}>
      <div className={styles.metricBarTrack}>
        <div className={styles.metricBarFill} style={{ width: `${value}%` }} />
      </div>
      <span className={styles.metricLabel}>{value.toFixed(0)}th</span>
    </div>
  );
}

export default function GlobalLeaderboardPage() {
  const { data: records, loading, error } = useGlobalPerformance();

  const [search, setSearch] = useState('');
  const searchDeferred = useDeferredValue(search);
  const [cropTypes, setCropTypes] = useState<string[]>([]);
  const [mlTasks, setMlTasks] = useState<string[]>([]);
  const [tuned, setTuned] = useState<('tuned' | 'not-tuned')[]>([]);
  const [optimizedValues, setOptimizedValues] = useState<('optimized' | 'not-optimized')[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortField>('map');

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

  const toggleValue = <T,>(setter: (updater: (current: T[]) => T[]) => void, value: T) => {
    setter((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  const hasActiveFilters =
    cropTypes.length > 0 || mlTasks.length > 0 || tuned.length > 0 || optimizedValues.length > 0 || platforms.length > 0;
  const clearFilters = () => {
    setCropTypes([]);
    setMlTasks([]);
    setTuned([]);
    setOptimizedValues([]);
    setPlatforms([]);
  };

  const leaderboard = useMemo(
    () =>
      computeGlobalLeaderboard(records, {
        cropTypes,
        mlTasks,
        tuned,
        optimizedValues,
        platforms,
        minAppearances: MIN_APPEARANCES,
      }),
    [records, cropTypes, mlTasks, tuned, optimizedValues, platforms]
  );

  const searched = useMemo(() => {
    const q = searchDeferred.trim().toLowerCase();
    if (!q) return leaderboard;
    return leaderboard.filter(
      (entry) =>
        entry.model.toLowerCase().includes(q) ||
        (entry.machineLearningTask ?? '').toLowerCase().includes(q) ||
        entry.datasets.some((dataset) => dataset.toLowerCase().includes(q))
    );
  }, [leaderboard, searchDeferred]);

  const sorted = useMemo(
    () =>
      [...searched].sort((a, b) => (percentileValue(b, sortBy) ?? -1) - (percentileValue(a, sortBy) ?? -1)),
    [searched, sortBy]
  );

  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [cropTypes, mlTasks, tuned, optimizedValues, platforms, searchDeferred]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedLeaderboard = useMemo(
    () => sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sorted, currentPage]
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedEntry = useMemo(
    () => sorted.find((entry) => `${entry.model}|||${entry.machineLearningTask ?? ''}` === selectedKey) ?? null,
    [sorted, selectedKey]
  );

  const sortHeaderClass = (field: SortField) => `${styles.sortHeader} ${sortBy === field ? styles.sortHeaderActive : ''}`;

  return (
    <Layout title="Model Leaderboard" description="Global model leaderboard aggregated across AgML dataset benchmarks.">
      <div className={styles.page}>
        <LeaderboardDetailModal entry={selectedEntry} open={selectedEntry != null} onClose={() => setSelectedKey(null)} />

        <div className={styles.toolbar}>
          <input
            type="search"
            placeholder="search models, datasets, tasks..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.searchInput}
          />
          <div className={styles.toolbarRight}>
            <span className={styles.resultCount}>{sorted.length.toLocaleString()} models</span>
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
              <MultiSelectDropdown label="Crop" options={cropTypeOptions} selected={cropTypes} onToggle={(value) => toggleValue(setCropTypes, value)} formatOption={toLabel} />
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
            <CheckboxFilterGroup label="Platform" options={platformOptions} selected={platforms} onToggle={(value) => toggleValue(setPlatforms, value)} formatOption={toLabel} />
          </aside>

          <section className={styles.results}>
            {loading && <p className={styles.status}>Loading leaderboard…</p>}
            {error && <p className={styles.status}>Error: {error.message}</p>}
            {!loading && !error && sorted.length === 0 && (
              <p className={styles.status}>
                No models have at least {MIN_APPEARANCES} dataset appearances for the current filters.
              </p>
            )}
            {!loading && !error && sorted.length > 0 && (
              <>
                <div className={styles.tableWrap}>
                  <div className={styles.leaderboardTable} role="table">
                    <div className={styles.tableRow} role="row">
                      <span role="columnheader">CV Task</span>
                      <span role="columnheader">Model</span>
                      <span role="columnheader">
                        <button type="button" className={sortHeaderClass('f1')} onClick={() => setSortBy('f1')}>
                          <span>Avg F1 pctl</span>
                          <span>{sortBy === 'f1' ? '▼' : '▾'}</span>
                        </button>
                      </span>
                      <span role="columnheader">
                        <button type="button" className={sortHeaderClass('map')} onClick={() => setSortBy('map')}>
                          <span>Avg mAP pctl</span>
                          <span>{sortBy === 'map' ? '▼' : '▾'}</span>
                        </button>
                      </span>
                      <span role="columnheader">
                        <button type="button" className={sortHeaderClass('precision')} onClick={() => setSortBy('precision')}>
                          <span>Avg Precision pctl</span>
                          <span>{sortBy === 'precision' ? '▼' : '▾'}</span>
                        </button>
                      </span>
                      <span role="columnheader">
                        <button type="button" className={sortHeaderClass('recall')} onClick={() => setSortBy('recall')}>
                          <span>Avg Recall pctl</span>
                          <span>{sortBy === 'recall' ? '▼' : '▾'}</span>
                        </button>
                      </span>
                      <span role="columnheader">Result type</span>
                      <span role="columnheader"># Results</span>
                    </div>
                    {pagedLeaderboard.map((entry) => {
                      const key = `${entry.model}|||${entry.machineLearningTask ?? ''}`;
                      return (
                        <div
                          key={key}
                          role="row"
                          tabIndex={0}
                          className={`${styles.tableRow} ${styles.clickableRow}`}
                          onClick={() => setSelectedKey(key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedKey(key);
                            }
                          }}
                        >
                          <span role="cell">
                            <span className={`${styles.taskBadge} ${taskBadgeClass(entry.machineLearningTask)}`}>
                              {entry.machineLearningTask ? shortTaskLabel(entry.machineLearningTask) : 'Unknown'}
                            </span>
                          </span>
                          <span role="cell">
                            <span className={styles.modelName}>{entry.model}</span>
                          </span>
                          <span role="cell">
                            <PercentileCell value={entry.avgF1Percentile} />
                          </span>
                          <span role="cell">
                            <PercentileCell value={entry.avgMapPercentile} />
                          </span>
                          <span role="cell">
                            <PercentileCell value={entry.avgPrecisionPercentile} />
                          </span>
                          <span role="cell">
                            <PercentileCell value={entry.avgRecallPercentile} />
                          </span>
                          <span role="cell">{entry.resultType}</span>
                          <span role="cell">{entry.appearances}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {pageCount > 1 && (
                  <div className={styles.pagination}>
                    <button
                      type="button"
                      className={styles.paginationButton}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </button>
                    <span className={styles.paginationStatus}>
                      Page {currentPage} of {pageCount}
                    </span>
                    <button
                      type="button"
                      className={styles.paginationButton}
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      disabled={currentPage === pageCount}
                    >
                      Next
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
