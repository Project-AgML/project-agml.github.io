import { Fragment, useEffect, useMemo, useState } from 'react';
import Layout from '@theme/Layout';
import { computeGlobalLeaderboard, formatGlobalResultTypeKey, globalResultTypeKey, useGlobalPerformance } from '../../lib/performance';
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown';
import styles from './index.module.css';

const MIN_APPEARANCES = 3;
const PAGE_SIZE = 25;

function toLabel(value: string) {
  return value.replace(/_/g, ' ');
}

export default function GlobalLeaderboardPage() {
  const { data: records, loading, error } = useGlobalPerformance();

  const [cropTypes, setCropTypes] = useState<string[]>([]);
  const [mlTasks, setMlTasks] = useState<string[]>([]);
  const [resultTypes, setResultTypes] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);

  const { cropTypeOptions, mlTaskOptions, resultTypeOptions, platformOptions } = useMemo(() => {
    const cropSet = new Set<string>();
    const taskSet = new Set<string>();
    const resultTypeSet = new Set<string>();
    const platformSet = new Set<string>();
    for (const record of records) {
      record.crop_types?.forEach((crop) => cropSet.add(crop));
      if (record.machine_learning_task) taskSet.add(record.machine_learning_task);
      const resultTypeKey = globalResultTypeKey(record);
      if (resultTypeKey) resultTypeSet.add(resultTypeKey);
      if (record.platform) platformSet.add(record.platform);
    }
    return {
      cropTypeOptions: Array.from(cropSet).sort((a, b) => a.localeCompare(b)),
      mlTaskOptions: Array.from(taskSet).sort((a, b) => a.localeCompare(b)),
      resultTypeOptions: Array.from(resultTypeSet).sort(),
      platformOptions: Array.from(platformSet).sort((a, b) => a.localeCompare(b)),
    };
  }, [records]);

  const toggleCropType = (value: string) => {
    setCropTypes((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  const toggleMlTask = (value: string) => {
    setMlTasks((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  const toggleResultType = (value: string) => {
    setResultTypes((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  const togglePlatform = (value: string) => {
    setPlatforms((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  };

  const hasActiveFilters = cropTypes.length > 0 || mlTasks.length > 0 || resultTypes.length > 0 || platforms.length > 0;
  const clearFilters = () => {
    setCropTypes([]);
    setMlTasks([]);
    setResultTypes([]);
    setPlatforms([]);
  };

  const leaderboard = useMemo(
    () => computeGlobalLeaderboard(records, { cropTypes, mlTasks, resultTypes, platforms, minAppearances: MIN_APPEARANCES }),
    [records, cropTypes, mlTasks, resultTypes, platforms]
  );

  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [cropTypes, mlTasks, resultTypes, platforms]);

  const pageCount = Math.max(1, Math.ceil(leaderboard.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedLeaderboard = useMemo(
    () => leaderboard.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [leaderboard, currentPage]
  );

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  useEffect(() => setExpandedKeys(new Set()), [cropTypes, mlTasks, resultTypes, platforms, page]);

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
            <MultiSelectDropdown label="Task type" options={mlTaskOptions} selected={mlTasks} onToggle={toggleMlTask} formatOption={toLabel} />
            <MultiSelectDropdown
              label="Tuned vs not tuned"
              options={resultTypeOptions}
              selected={resultTypes}
              onToggle={toggleResultType}
              formatOption={formatGlobalResultTypeKey}
            />
            <MultiSelectDropdown label="Crop type" options={cropTypeOptions} selected={cropTypes} onToggle={toggleCropType} formatOption={toLabel} />
            <MultiSelectDropdown label="Platform" options={platformOptions} selected={platforms} onToggle={togglePlatform} formatOption={toLabel} />
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
                    <th>CV-task</th>
                    <th>Model name</th>
                    <th>Avg. percentile (mAP@.5)</th>
                    <th>Result type</th>
                    <th>Number of results</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedLeaderboard.map((entry) => {
                    const key = `${entry.model}|||${entry.machineLearningTask ?? ''}`;
                    const isExpanded = expandedKeys.has(key);
                    return (
                      <Fragment key={key}>
                        <tr
                          className={styles.clickableRow}
                          onClick={() => toggleExpanded(key)}
                          aria-expanded={isExpanded}
                        >
                          <td>{entry.machineLearningTask ? toLabel(entry.machineLearningTask) : '—'}</td>
                          <td>
                            <span className={styles.modelName}>{entry.model}</span>
                            <span className={styles.expandChevron} aria-hidden>
                              {isExpanded ? '▾' : '▸'}
                            </span>
                          </td>
                          <td>{entry.averagePercentile.toFixed(1)}</td>
                          <td>{entry.resultType}</td>
                          <td>{entry.appearances}</td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className={styles.detailsCell}>
                              <table className={styles.detailsTable}>
                                <thead>
                                  <tr>
                                    <th>Dataset</th>
                                    <th>Percentile</th>
                                    <th>Result type</th>
                                    <th>Platform</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.datasetDetails.map((detail) => (
                                    <tr key={detail.dataset}>
                                      <td>{toLabel(detail.dataset)}</td>
                                      <td>{detail.percentile.toFixed(1)}</td>
                                      <td>
                                        {detail.variant === 'fine-tuned'
                                          ? 'Fine-tuned'
                                          : detail.variant === 'zero-shot'
                                            ? 'Zero-shot'
                                            : '—'}
                                        {detail.optimized ? ' (optimized)' : ''}
                                      </td>
                                      <td>{detail.platform ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
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
