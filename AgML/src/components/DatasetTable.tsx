import { useMemo, useState } from 'react';
import styles from './DatasetTable.module.css';
import { filterDatasets, useDatasets } from '../lib/datasets';
import { DatasetMetadataModal } from './DatasetMetadataModal';

const DISPLAY_LIMIT = 250;

export function DatasetTable() {
  const { data, loading, error } = useDatasets();
  const [query, setQuery] = useState('');
  const [selectedDatasetName, setSelectedDatasetName] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      filterDatasets(data, {
        q: query || undefined,
        includeChildren: false,
      }),
    [data, query]
  );

  const displayed = filtered.slice(0, DISPLAY_LIMIT);
  const hasMore = filtered.length > DISPLAY_LIMIT;
  const selectedDataset = data.find((dataset) => dataset.name === selectedDatasetName) ?? null;

  if (loading) {
    return <p className={styles.status}>Loading datasets…</p>;
  }
  if (error) {
    return <p className={styles.status}>Error: {error.message}</p>;
  }

  return (
    <section className={styles.section}>
      <DatasetMetadataModal
        dataset={selectedDataset}
        open={selectedDataset != null}
        onClose={() => setSelectedDatasetName(null)}
      />
      <div className={styles.controls}>
        <div>
          <p className={styles.count}>
            {filtered.length} top-level datasets
            {hasMore ? ` (showing ${DISPLAY_LIMIT})` : ''}
          </p>
          <p className={styles.helper}>Use Dataset Search to explore iNatAg sub-datasets.</p>
        </div>
        <label className={styles.searchLabel}>
          <span>Filter</span>
          <input
            type="search"
            value={query}
            placeholder="Search by name, task, or location"
            onChange={(event) => setQuery(event.target.value)}
            className={styles.searchInput}
          />
        </label>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Dataset</th>
              <th>Task</th>
              <th className={styles.num}>Images</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((dataset) => (
              <tr key={dataset.name}>
                <td>
                  <button
                    type="button"
                    className={styles.datasetButton}
                    onClick={() => setSelectedDatasetName(dataset.name)}
                  >
                    {dataset.name}
                  </button>
                </td>
                <td>{dataset.machine_learning_task ?? '—'}</td>
                <td className={styles.num}>
                  {dataset.num_images != null ? dataset.num_images.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <p className={styles.helper}>
          Showing the first {DISPLAY_LIMIT} matches. Use Dataset Search for the full list.
        </p>
      )}
    </section>
  );
}
