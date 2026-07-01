import { useEffect, useMemo, useState } from 'react';
import Layout from '@theme/Layout';
import { computeGlobalLeaderboard, useGlobalPerformance } from '../../lib/performance';
import styles from './index.module.css';

const MIN_APPEARANCES = 3;
const PAGE_SIZE = 25;

function toLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.dropdown} data-dropdown={label}>
      <label className={styles.dropdownLabel}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-expanded={open}
        className={styles.dropdownTrigger}
      >
        <span>
          {selected.length === 0
            ? 'All'
            : selected.length === 1
              ? toLabel(selected[0])
              : `${selected.length} selected`}
        </span>
        <span className={styles.dropdownChevron} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.dropdownMenu} role="listbox" aria-multiselectable="true">
          {options.length === 0 && <div className={styles.dropdownEmpty}>No options</div>}
          {options.map((option) => {
            const isSelected = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                className={`${styles.dropdownOption} ${isSelected ? styles.dropdownOptionSelected : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onToggle(option)}
              >
                <span className={styles.dropdownCheckbox} aria-hidden>
                  {isSelected ? '✓' : ''}
                </span>
                {toLabel(option)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GlobalLeaderboardPage() {
  const { data: records, loading, error } = useGlobalPerformance();

  const [cropTypes, setCropTypes] = useState<string[]>([]);
  const [mlTasks, setMlTasks] = useState<string[]>([]);

  const { cropTypeOptions, mlTaskOptions } = useMemo(() => {
    const cropSet = new Set<string>();
    const taskSet = new Set<string>();
    for (const record of records) {
      record.crop_types?.forEach((crop) => cropSet.add(crop));
      if (record.machine_learning_task) taskSet.add(record.machine_learning_task);
    }
    return {
      cropTypeOptions: Array.from(cropSet).sort((a, b) => a.localeCompare(b)),
      mlTaskOptions: Array.from(taskSet).sort((a, b) => a.localeCompare(b)),
    };
  }, [records]);

  const toggleCropType = (value: string) => {
    setCropTypes((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  const toggleMlTask = (value: string) => {
    setMlTasks((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  const hasActiveFilters = cropTypes.length > 0 || mlTasks.length > 0;
  const clearFilters = () => {
    setCropTypes([]);
    setMlTasks([]);
  };

  const leaderboard = useMemo(
    () => computeGlobalLeaderboard(records, { cropTypes, mlTasks, minAppearances: MIN_APPEARANCES }),
    [records, cropTypes, mlTasks]
  );

  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [cropTypes, mlTasks]);

  const pageCount = Math.max(1, Math.ceil(leaderboard.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedLeaderboard = useMemo(
    () => leaderboard.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [leaderboard, currentPage]
  );

  return (
    <Layout title="Model Leaderboard" description="Global model leaderboard aggregated across AgML dataset benchmarks.">
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <p className={styles.heroTag}>AgML Model Leaderboard</p>
            <h1 className={styles.heroTitle}>Global model performance</h1>
            <p className={styles.heroSubtitle}>
              Models are ranked by their average percentile across every dataset leaderboard they appear on.
              Only models with at least {MIN_APPEARANCES} dataset appearances are included.
            </p>
          </div>
        </section>

        <section className={styles.controls}>
          <div className={styles.dropdownRow}>
            <MultiSelectDropdown label="Crop type" options={cropTypeOptions} selected={cropTypes} onToggle={toggleCropType} />
            <MultiSelectDropdown label="Model task" options={mlTaskOptions} selected={mlTasks} onToggle={toggleMlTask} />
          </div>
          {hasActiveFilters && (
            <button type="button" className={styles.clearButton} onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </section>

        <section className={styles.results}>
          {loading && <p className={styles.status}>Loading leaderboard…</p>}
          {error && <p className={styles.status}>Error: {error.message}</p>}
          {!loading && !error && leaderboard.length === 0 && (
            <p className={styles.status}>
              No models have at least {MIN_APPEARANCES} dataset appearances for the current filters.
            </p>
          )}
          {!loading && !error && leaderboard.length > 0 && (
            <>
              <table className={styles.leaderboardTable}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Model</th>
                    <th>Avg. percentile</th>
                    <th>Appearances</th>
                    <th>Datasets</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedLeaderboard.map((entry, index) => (
                    <tr key={entry.model}>
                      <td>{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
                      <td>{entry.model}</td>
                      <td>{entry.averagePercentile.toFixed(1)}</td>
                      <td>{entry.appearances}</td>
                      <td className={styles.datasetsCell}>{entry.datasets.map((name) => toLabel(name)).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
    </Layout>
  );
}
