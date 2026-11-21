import { useMemo } from 'react';
import Link from '@docusaurus/Link';
import { headlineResult, modelsByAgmlDataset, useModelCatalog } from '../lib/models';
import modalStyles from './DatasetMetadataModal.module.css';
import styles from './ModelDetailModal.module.css';

// "External models" section of the dataset modal: open-weight models from the /models catalog that
// were trained or evaluated on this dataset (or a related one). Deliberately separate from the
// Leaderboard section below it — these numbers are source-reported, not AgML-run.
export function DatasetModelsSection({ datasetName }: { datasetName: string }) {
  const { data } = useModelCatalog();
  const links = useMemo(() => modelsByAgmlDataset(data.models).get(datasetName) ?? [], [data.models, datasetName]);
  if (links.length === 0) return null;

  return (
    <section className={modalStyles.section}>
      <h3 className={modalStyles.sectionTitle}>External models using this dataset ({links.length})</h3>
      <p className={styles.smallText} style={{ marginBottom: '0.6rem' }}>
        Open-weight models hosted by their authors. <strong>Not benchmarked by AgML</strong> — metrics are
        source-reported and not part of the leaderboard below.
      </p>
      <ul className={styles.datasetList}>
        {links.map(({ model, roles, status }) => {
          const headline = headlineResult(model);
          return (
            <li key={model.id} className={styles.datasetRow}>
              <div className={styles.datasetHeader}>
                <Link className={styles.datasetName} to={`/models?model=${encodeURIComponent(model.id)}`}>
                  {model.name}
                </Link>
                {roles.map((role) => (
                  <span key={role} className={styles.tag}>
                    {role === 'eval' ? 'evaluated on' : role === 'train' ? 'trained on' : role}
                  </span>
                ))}
                {status === 'related_in_agml' && <span className={`${styles.statusPill} ${styles.statusRelated}`}>related / subset</span>}
                <span className={styles.unverifiedBadge}>Unverified metrics</span>
              </div>
              {headline && (
                <p className={styles.smallText}>
                  Best source-reported: {headline.label} {headline.value}
                  {headline.dataset ? ` on ${headline.dataset}` : ''}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
