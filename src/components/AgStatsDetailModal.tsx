import { useEffect, useState } from 'react';
import Link from '@docusaurus/Link';
import type { AgStatsEntry, AgStatsSource } from '../lib/agStats';
import { formatYears, fullSnippet, SOURCE_DOC_PATH } from '../lib/agStats';
import styles from './AgStatsDetailModal.module.css';

export function AgStatsDetailModal({
  entry,
  source,
  onClose,
}: {
  entry: AgStatsEntry | null;
  source: AgStatsSource | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setCopied(false);
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
  }, [entry, onClose]);

  if (!entry || !source) return null;
  const code = fullSnippet(entry);

  const facts: [string, string][] = [
    ['Source', source.name],
    ['Type', entry.format],
    ['Spatial', entry.resolution ? `${entry.spatial_levels.join(', ')} (${entry.resolution})` : entry.spatial_levels.join(', ')],
    ['Time step', entry.time_step],
    ['Years', formatYears(entry) + (entry.missing_years.length ? ` (no ${entry.missing_years.join(', ')})` : '')],
  ];
  if (entry.rows != null) facts.push(['Rows', entry.rows.toLocaleString()]);
  if (entry.files != null) facts.push(['Files', `${entry.files.toLocaleString()} (all counties and years)`]);
  if (entry.crops != null) facts.push([entry.name === 'cdl' ? 'Crop classes' : 'Crops', entry.crops.toLocaleString()]);
  facts.push(['Method', entry.method]);

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ag-stats-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h2 id="ag-stats-detail-title" className={styles.title}>
              {entry.title}
            </h2>
            <p className={styles.summaryLine}>
              {source.module} · {entry.name}
            </p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close details">
            ✕
          </button>
        </div>

        <p className={styles.description}>{entry.description}</p>

        <dl className={styles.facts}>
          {facts.map(([label, value]) => (
            <div key={label} className={styles.fact}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Load it</h3>
          <div className={styles.snippet}>
            <pre>{code}</pre>
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => {
                navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className={styles.note}>
            Install with <code>{source.install}</code>.
          </p>
        </section>

        {entry.columns.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Columns ({entry.columns.length})</h3>
            <div className={styles.columns}>
              {entry.columns.map((column) => (
                <span key={column.name} className={styles.column}>
                  {column.name}
                  <span className={styles.columnType}>{column.type}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        <div className={styles.linkRow}>
          <Link className={styles.link} to={SOURCE_DOC_PATH[entry.source]} onClick={onClose}>
            Read the {source.loader} guide
          </Link>
          <a className={styles.link} href={`https://huggingface.co/datasets/${source.hf_repo}`} target="_blank" rel="noreferrer">
            Open on Hugging Face
          </a>
        </div>
      </div>
    </div>
  );
}
