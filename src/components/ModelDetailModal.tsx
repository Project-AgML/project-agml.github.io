import { useEffect } from 'react';
import Link from '@docusaurus/Link';
import { toDisplayLabel } from '../lib/labelOverrides';
import {
  DATASET_STATUS_LABELS,
  PUBLISHER_LABELS,
  VERIFICATION_LABELS,
  formatMetricValue,
  isUnverified,
  metricLabel,
} from '../lib/models';
import type { ExternalModel, ModelDatasetRef } from '../lib/models';
import styles from './ModelDetailModal.module.css';

function taskBadgeClass(task: string | null): string {
  if (!task) return styles.badgeOther;
  if (task.includes('classif')) return styles.badgeClassification;
  if (task.includes('detect')) return styles.badgeDetection;
  if (task.includes('segment')) return styles.badgeSegmentation;
  return styles.badgeOther;
}

const LINK_LABELS: [keyof ExternalModel['links'], string][] = [
  ['weights', 'Get the weights'],
  ['model_card', 'Model card'],
  ['code', 'Code'],
  ['paper', 'Paper'],
  ['demo', 'Demo'],
];

function statusClass(status: ModelDatasetRef['agml']['status']): string {
  if (status === 'in_agml') return styles.statusInAgml;
  if (status === 'related_in_agml') return styles.statusRelated;
  return styles.statusOther;
}

function DatasetRow({ dataset }: { dataset: ModelDatasetRef }) {
  return (
    <li className={styles.datasetRow}>
      <div className={styles.datasetHeader}>
        <span className={styles.datasetName}>{dataset.name}</span>
        {dataset.roles.map((role) => (
          <span key={role} className={styles.tag}>
            {role === 'eval' ? 'evaluated on' : role === 'train' ? 'trained on' : role}
          </span>
        ))}
        <span className={`${styles.statusPill} ${statusClass(dataset.agml.status)}`}>
          {DATASET_STATUS_LABELS[dataset.agml.status]}
        </span>
      </div>
      {dataset.description && <p className={styles.bodyText}>{dataset.description}</p>}
      <p className={styles.smallText}>
        {dataset.agml.names.map((name, index) => (
          <span key={name}>
            {index > 0 && ' · '}
            <Link to={`/datasets?dataset=${encodeURIComponent(name)}`}>View {name} in AgML</Link>
          </span>
        ))}
        {dataset.agml.names.length > 0 && dataset.link && ' · '}
        {dataset.link && (
          <a href={dataset.link} target="_blank" rel="noreferrer">
            Original source
          </a>
        )}
        {dataset.license && <> · License: {dataset.license}</>}
      </p>
      {dataset.agml.note && <p className={styles.smallText}>{dataset.agml.note}</p>}
    </li>
  );
}

export function ModelDetailModal({
  model,
  open,
  onClose,
}: {
  model: ExternalModel | null;
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

  if (!open || model == null) return null;

  const datasetNames = new Map(model.datasets.map((dataset) => [dataset.id, dataset.name]));
  const detailRows: [string, string | null][] = [
    ['Developer', model.developer],
    ['Source type', PUBLISHER_LABELS[model.publisher_type]],
    ['Architecture', model.architecture],
    ['Framework', model.framework],
    ['Model type', model.model_type],
    ['Modality', model.sensor_modality ? toDisplayLabel(model.sensor_modality) : null],
    ['Platform', model.platform ? toDisplayLabel(model.platform) : null],
    ['License', model.license],
    ['Hosted on', model.hosting],
  ];

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h2 id="model-detail-title" className={styles.title}>
              {model.name}
            </h2>
            <div className={styles.headerBadges}>
              {model.machine_learning_task && (
                <span className={`${styles.taskBadge} ${taskBadgeClass(model.machine_learning_task)}`}>
                  {toDisplayLabel(model.machine_learning_task)}
                </span>
              )}
              {model.agricultural_tasks.map((task) => (
                <span key={task} className={styles.tag}>
                  {toDisplayLabel(task)}
                </span>
              ))}
              <span className={isUnverified(model) ? styles.unverifiedBadge : styles.verifiedBadge}>
                {isUnverified(model) ? 'Not benchmarked by AgML' : 'Benchmarked by AgML'}
              </span>
            </div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close model details">
            ×
          </button>
        </div>

        {isUnverified(model) && (
          <p className={styles.disclaimer}>
            AgML does not host this model and has not benchmarked it. Every number below is copied from the cited
            source ({VERIFICATION_LABELS[model.verification].toLowerCase()}) and is not comparable to the{' '}
            <Link to="/leaderboard">AgML leaderboard</Link>. Check the source's split and protocol before relying on it.
          </p>
        )}

        {model.summary && <p className={styles.bodyText}>{model.summary}</p>}

        <dl className={styles.detailGrid}>
          {detailRows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className={styles.detailItem}>
                <dt className={styles.detailLabel}>{label}</dt>
                <dd className={styles.detailValue}>{value}</dd>
              </div>
            ))}
        </dl>

        <div className={styles.linkRow}>
          {LINK_LABELS.filter(([key]) => model.links[key]).map(([key, label]) => (
            <a
              key={key}
              className={key === 'weights' ? styles.primaryLink : styles.externalLink}
              href={model.links[key]!}
              target="_blank"
              rel="noreferrer"
            >
              {label}
            </a>
          ))}
        </div>

        {model.crop_types.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Crops</h3>
            <div className={styles.badgeWrap}>
              {model.crop_types.map((crop) => (
                <span key={crop} className={styles.tag}>
                  {toDisplayLabel(crop)}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Reported performance (source-reported, unverified)</h3>
          {model.reported_results.length === 0 ? (
            <p className={styles.bodyText}>
              {model.verification === 'metrics_not_transcribed'
                ? 'The source reports metrics, but they were not transcribed here (see reproduction notes). Read them in the paper.'
                : 'The source does not publish evaluation metrics for this model.'}
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Evaluated on</th>
                    <th>Variant</th>
                    <th>Setting</th>
                    <th>Metrics</th>
                    <th>Split / notes</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {model.reported_results.map((result, index) => (
                    <tr key={index}>
                      <td>{(result.eval_dataset && datasetNames.get(result.eval_dataset)) ?? result.eval_dataset ?? '—'}</td>
                      <td>{result.variant ?? '—'}</td>
                      <td>{result.setting ?? '—'}</td>
                      <td>
                        {Object.entries(result.metrics).map(([key, value]) => (
                          <div key={key} className={key === result.primary_metric ? styles.primaryMetric : undefined}>
                            {metricLabel(key)}: {formatMetricValue(value)}
                          </div>
                        ))}
                      </td>
                      <td>
                        {result.split && <div>{result.split}</div>}
                        {result.notes && <div className={styles.smallText}>{result.notes}</div>}
                      </td>
                      <td>
                        {result.source_url ? (
                          <a href={result.source_url} target="_blank" rel="noreferrer">
                            {result.source ?? 'source'}
                          </a>
                        ) : (
                          result.source ?? '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Training &amp; evaluation data</h3>
          <ul className={styles.datasetList}>
            {model.datasets.map((dataset) => (
              <DatasetRow key={dataset.id} dataset={dataset} />
            ))}
          </ul>
        </section>

        {(model.strong_use_cases || model.limitations) && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>When to use it</h3>
            {model.strong_use_cases && (
              <p className={styles.bodyText}>
                <span className={styles.inlineLabel}>Strong use cases:</span> {model.strong_use_cases}
              </p>
            )}
            {model.limitations && (
              <p className={styles.bodyText}>
                <span className={styles.inlineLabel}>Limitations:</span> {model.limitations}
              </p>
            )}
          </section>
        )}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Reproduction{model.reproduction.status ? ` — ${toDisplayLabel(model.reproduction.status)}` : ''}
          </h3>
          {model.reproduction.notes && <p className={styles.bodyText}>{model.reproduction.notes}</p>}
          {model.reproduction.code_url && (
            <p className={styles.smallText}>
              <a href={model.reproduction.code_url} target="_blank" rel="noreferrer">
                {model.reproduction.code_url}
              </a>
            </p>
          )}
          {model.reproduction.commands.length > 0 && (
            <pre className={styles.code}>{model.reproduction.commands.join('\n')}</pre>
          )}
        </section>

        {model.citation && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Citation</h3>
            <p className={styles.bodyText}>{model.citation}</p>
          </section>
        )}

        <p className={styles.smallText}>
          Catalog id <code>{model.id}</code>
          {model.last_checked && <> · last checked against the source {model.last_checked}</>}
        </p>
      </div>
    </div>
  );
}
