import { Fragment, useEffect, useState } from 'react';
import Link from '@docusaurus/Link';
import type { GlobalLeaderboardEntry } from '../lib/performance';
import styles from './LeaderboardDetailModal.module.css';

function toLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatPercentile(value: number | null) {
  return value == null ? null : `${value.toFixed(0)}th pctl`;
}

function formatScore(value: number) {
  return value.toFixed(3);
}

function formatResultType(entry: { variant: 'zero-shot' | 'fine-tuned' | null; optimized: boolean }) {
  const base = entry.variant === 'fine-tuned' ? 'Fine-tuned' : entry.variant === 'zero-shot' ? 'Zero-shot' : '—';
  if (base === '—') return base;
  return entry.optimized ? `${base} (optimized)` : base;
}

function taskBadgeClass(task: string | null): string {
  if (!task) return styles.badgeOther;
  if (task.includes('classif')) return styles.badgeClassification;
  if (task.includes('detect')) return styles.badgeDetection;
  if (task.includes('segment')) return styles.badgeSegmentation;
  return styles.badgeOther;
}

export function LeaderboardDetailModal({
  entry,
  open,
  onClose,
}: {
  entry: GlobalLeaderboardEntry | null;
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
  useEffect(() => setExpandedKeys(new Set()), [entry]);
  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!open || entry == null) return null;

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
            <div className={styles.badgeRow}>
              <span className={`${styles.taskBadge} ${taskBadgeClass(entry.machineLearningTask)}`}>
                {entry.machineLearningTask ? toLabel(entry.machineLearningTask) : 'Unknown task'}
              </span>
              <span className={styles.resultTypeBadge}>{entry.resultType}</span>
            </div>
            <h2 id="leaderboard-detail-title" className={styles.title}>
              {entry.model}
            </h2>
            <p className={styles.summaryLine}>
              {entry.appearances} result{entry.appearances === 1 ? '' : 's'} across {entry.datasets.length} dataset
              {entry.datasets.length === 1 ? '' : 's'}
            </p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close model details">
            ×
          </button>
        </div>

        <p className={styles.sectionTitle}>Datasets included ({entry.datasetDetails.length})</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Split %</th>
                <th>Config</th>
                <th>Scores (percentile)</th>
              </tr>
            </thead>
            <tbody>
              {entry.datasetDetails.map((detail, index) => {
                const rowKey = `${detail.dataset}-${index}`;
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
                    const score = detail.scores[category];
                    const pctl = detail.percentiles[category];
                    if (score == null || pctl == null) return null;
                    return [label, formatScore(score), formatPercentile(pctl)] as [string, string, string];
                  })
                  .filter((line): line is [string, string, string] => line != null);

                return (
                  <Fragment key={rowKey}>
                    <tr className={styles.clickableRow} onClick={() => toggleExpanded(rowKey)} aria-expanded={isExpanded}>
                      <td>
                        <div className={styles.datasetCell}>
                          <button type="button" className={styles.datasetName}>
                            {toLabel(detail.dataset)}
                            <span className={styles.expandChevron} aria-hidden>
                              {isExpanded ? '▲' : '▾'}
                            </span>
                          </button>
                          <Link
                            className={styles.viewDatasetLink}
                            to={`/datasets?dataset=${encodeURIComponent(detail.dataset)}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            view dataset
                          </Link>
                        </div>
                      </td>
                      <td>{detail.splitBreakdown ?? '—'}</td>
                      <td>{detail.datasetConfig ?? '—'}</td>
                      <td>
                        {scoreLines.length === 0 ? (
                          '—'
                        ) : (
                          <div className={styles.scoresCell}>
                            {scoreLines.map(([label, score, pctl]) => (
                              <span key={label}>
                                {label} {score} <span>({pctl})</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className={styles.notesRow}>
                        <td colSpan={4}>
                          {formatResultType(detail)} · {detail.platform ?? 'unknown platform'}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
