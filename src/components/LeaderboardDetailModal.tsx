import { Fragment, useEffect, useState } from 'react';
import Link from '@docusaurus/Link';
import { formatGlobalResultTypeKey, globalResultTypeKey, METRIC_LABELS } from '../lib/performance';
import type { ModelComparisonDetail } from '../lib/performance';
import { toDisplayLabel } from '../lib/labelOverrides';
import styles from './LeaderboardDetailModal.module.css';

function formatRank(rank: number | null, totalModels: number) {
  return rank == null ? null : `#${rank} of ${totalModels}`;
}

function formatScore(value: number) {
  return value.toFixed(3);
}

function formatResultType(entry: { variant: 'zero-shot' | 'fine-tuned' | null; optimized: boolean }) {
  const key = globalResultTypeKey(entry);
  return key ? formatGlobalResultTypeKey(key) : '—';
}

export function LeaderboardDetailModal({
  detail,
  open,
  onClose,
}: {
  detail: ModelComparisonDetail | null;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  useEffect(() => setExpandedKeys(new Set()), [detail]);
  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!open || detail == null) return null;

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h2 id="leaderboard-detail-title" className={styles.title}>
              {detail.model}
              {detail.task ? ` (${toDisplayLabel(detail.task)})` : ''}
            </h2>
            <p className={styles.summaryLine}>
              Ranked by {METRIC_LABELS[detail.metric]} across {detail.datasets.length} dataset
              {detail.datasets.length === 1 ? '' : 's'} shared with all {detail.totalModels} compared models
            </p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close model details">
            ×
          </button>
        </div>

        <p className={styles.sectionTitle}>Datasets contributing to this average ({detail.datasets.length})</p>
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table">
            <div className={styles.tableRow} role="row">
              <span role="columnheader">Dataset</span>
              <span role="columnheader">Split %</span>
              <span role="columnheader">Config</span>
              <span role="columnheader">Scores (rank)</span>
            </div>
            {detail.datasets.map((datasetDetail, index) => {
              const rowKey = `${datasetDetail.dataset}-${index}`;
              const isExpanded = expandedKeys.has(rowKey);
              const scoreLines = (
                [
                  ['F1', 'f1'],
                  ['mAP', 'map'],
                  ['Precision', 'precision'],
                  ['Recall', 'recall'],
                ] as [string, 'f1' | 'map' | 'precision' | 'recall'][]
              )
                .map(([label, category]) => {
                  const score = datasetDetail.scores[category];
                  const rank = formatRank(datasetDetail.ranks[category], detail.totalModels);
                  if (score == null) return null;
                  return [label, formatScore(score), rank] as [string, string, string | null];
                })
                .filter((line): line is [string, string, string | null] => line != null);

              return (
                <Fragment key={rowKey}>
                  <div
                    role="row"
                    tabIndex={0}
                    className={`${styles.tableRow} ${styles.clickableRow}`}
                    onClick={() => toggleExpanded(rowKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleExpanded(rowKey);
                      }
                    }}
                    aria-expanded={isExpanded}
                  >
                    <span role="cell">
                      <div className={styles.datasetCell}>
                        <button type="button" className={styles.datasetName}>
                          {toDisplayLabel(datasetDetail.dataset)}
                          <span className={styles.expandChevron} aria-hidden>
                            {isExpanded ? '▲' : '▾'}
                          </span>
                        </button>
                        <Link
                          className={styles.viewDatasetLink}
                          to={`/datasets?dataset=${encodeURIComponent(datasetDetail.dataset)}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          view dataset
                        </Link>
                      </div>
                    </span>
                    <span role="cell" className={styles.simpleCell}>
                      {datasetDetail.splitBreakdown ?? '—'}
                    </span>
                    <span role="cell" className={styles.simpleCell}>
                      {datasetDetail.datasetConfig ?? '—'}
                    </span>
                    <span role="cell">
                      {scoreLines.length === 0 ? (
                        '—'
                      ) : (
                        <div className={styles.scoresCell}>
                          {scoreLines.map(([label, score, rank]) => (
                            <span key={label}>
                              {label} {score} {rank && <span>({rank})</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className={styles.notesRow}>
                      <p className={styles.notesMeta}>
                        {formatResultType(datasetDetail)} · {datasetDetail.platform ?? 'unknown platform'}
                      </p>
                      <p className={styles.notesText}>{datasetDetail.notes ?? 'No additional notes for this result.'}</p>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
