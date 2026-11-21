import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import { useHistory, useLocation } from '@docusaurus/router';
import { MultiSelectDropdown } from '../../components/MultiSelectDropdown';
import { ModelDetailModal } from '../../components/ModelDetailModal';
import { toDisplayLabel } from '../../lib/labelOverrides';
import {
  dataAvailability,
  headlineResult,
  isUnverified,
  modelMatchesQuery,
  PUBLISHER_LABELS,
  resultSettings,
  useModelCatalog,
} from '../../lib/models';
import type { ExternalModel, PublisherType } from '../../lib/models';
// Shares the dataset browser's layout (toolbar / sidebar / card grid) so both pages look the same.
import shared from '../datasets/index.module.css';
import styles from './index.module.css';

type ModelFilter = {
  key: string;
  label: string;
  kind: 'checkbox' | 'dropdown';
  values: (model: ExternalModel) => string[];
  formatOption?: (value: string) => string;
};

const AVAILABILITY_LABELS: Record<string, string> = {
  in_agml: 'Uses an AgML dataset',
  related_in_agml: 'Related AgML dataset',
  not_in_agml: 'Data not in AgML',
};

const VERIFICATION_FILTER_LABELS: Record<string, string> = {
  unverified: 'Not benchmarked by AgML',
  verified: 'Benchmarked by AgML',
};

const MODEL_FILTERS: ModelFilter[] = [
  {
    key: 'ml_task',
    label: 'CV Task',
    kind: 'checkbox',
    values: (model) => (model.machine_learning_task ? [model.machine_learning_task] : []),
    formatOption: toDisplayLabel,
  },
  { key: 'ag_task', label: 'Agricultural Task', kind: 'dropdown', values: (model) => model.agricultural_tasks, formatOption: toDisplayLabel },
  { key: 'crop', label: 'Crop', kind: 'dropdown', values: (model) => model.crop_types, formatOption: toDisplayLabel },
  {
    key: 'platform',
    label: 'Platform',
    kind: 'dropdown',
    values: (model) => (model.platform ? [model.platform] : []),
    formatOption: toDisplayLabel,
  },
  {
    key: 'publisher',
    label: 'Source',
    kind: 'checkbox',
    values: (model) => [model.publisher_type],
    formatOption: (value) => PUBLISHER_LABELS[value as PublisherType] ?? value,
  },
  { key: 'setting', label: 'Reported setting', kind: 'dropdown', values: resultSettings, formatOption: toDisplayLabel },
  {
    key: 'data',
    label: 'Training / eval data',
    kind: 'checkbox',
    values: (model) => [dataAvailability(model)],
    formatOption: (value) => AVAILABILITY_LABELS[value] ?? value,
  },
  {
    key: 'verification',
    label: 'Verification',
    kind: 'checkbox',
    values: (model) => [isUnverified(model) ? 'unverified' : 'verified'],
    formatOption: (value) => VERIFICATION_FILTER_LABELS[value] ?? value,
  },
];

function taskBadgeClass(task: string | null): string {
  if (!task) return shared.badgeOther;
  if (task.includes('classif')) return shared.badgeClassification;
  if (task.includes('detect')) return shared.badgeDetection;
  if (task.includes('segment')) return shared.badgeSegmentation;
  return shared.badgeOther;
}

function ModelCard({ model, onOpen }: { model: ExternalModel; onOpen: (trigger: HTMLButtonElement) => void }) {
  const headline = headlineResult(model);
  const crops = model.crop_types.slice(0, 4);
  return (
    <button
      type="button"
      className={shared.cardButton}
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`Open details for ${model.name}`}
    >
      <div className={shared.card}>
        <h2 className={shared.cardTitle}>{model.name}</h2>
        <div className={shared.cardTags}>
          {model.machine_learning_task && (
            <span className={`${shared.taskBadge} ${taskBadgeClass(model.machine_learning_task)}`}>
              {toDisplayLabel(model.machine_learning_task)}
            </span>
          )}
          {model.agricultural_tasks.slice(0, 2).map((task) => (
            <span key={task} className={shared.tag}>
              {toDisplayLabel(task)}
            </span>
          ))}
          {isUnverified(model) && <span className={styles.unverifiedBadge}>Unverified metrics</span>}
          {model.publisher_type === 'community' && <span className={shared.tag}>Community</span>}
        </div>
        {model.summary && <p className={styles.cardSummary}>{model.summary}</p>}
        <div className={shared.cardFooter}>
          <div className={shared.cardFooterRow}>
            <span>{crops.map(toDisplayLabel).join(', ')}{model.crop_types.length > crops.length ? ', …' : ''}</span>
          </div>
          <div className={shared.cardFooterRow}>
            {headline ? (
              <span title="As reported by the source; not verified by AgML">
                {headline.label} {headline.value}
                {headline.dataset ? ` · ${headline.dataset}` : ''} <span className={styles.sourceMark}>(source)</span>
              </span>
            ) : (
              <span>No transcribed metrics</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function ModelBrowserPage() {
  const location = useLocation();
  const history = useHistory();
  const { data: catalog, loading, error } = useModelCatalog();
  const models = catalog.models;
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [qLocal, setQLocal] = useState(searchParams.get('q') ?? '');
  const qDeferred = useDeferredValue(qLocal);

  const setSearchParams = useCallback(
    (updater: (params: URLSearchParams) => URLSearchParams) => {
      const current = location.search.startsWith('?') ? location.search.slice(1) : location.search;
      const next = updater(new URLSearchParams(current)).toString();
      if (next !== current) history.replace({ ...location, search: next ? `?${next}` : '' });
    },
    [history, location]
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchParams((params) => {
        if (qLocal) params.set('q', qLocal);
        else params.delete('q');
        return params;
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [qLocal, setSearchParams]);

  const selections = useMemo(
    () => Object.fromEntries(MODEL_FILTERS.map((filter) => [filter.key, searchParams.getAll(filter.key)])) as Record<string, string[]>,
    [searchParams]
  );

  const toggle = (key: string, value: string) =>
    setSearchParams((params) => {
      const current = params.getAll(key);
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      params.delete(key);
      next.forEach((v) => params.append(key, v));
      return params;
    });

  const options = useMemo(
    () =>
      Object.fromEntries(
        MODEL_FILTERS.map((filter) => [filter.key, Array.from(new Set(models.flatMap(filter.values))).sort((a, b) => a.localeCompare(b))])
      ) as Record<string, string[]>,
    [models]
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        MODEL_FILTERS.map((filter) => [
          filter.key,
          Object.fromEntries(options[filter.key].map((value) => [value, models.filter((m) => filter.values(m).includes(value)).length])),
        ])
      ) as Record<string, Record<string, number>>,
    [models, options]
  );

  const filtered = useMemo(
    () =>
      models.filter(
        (model) =>
          MODEL_FILTERS.every((filter) => {
            const selected = selections[filter.key];
            return selected.length === 0 || filter.values(model).some((value) => selected.includes(value));
          }) && modelMatchesQuery(model, qDeferred)
      ),
    [models, selections, qDeferred]
  );

  const activeFilterCount = Object.values(selections).reduce((sum, values) => sum + values.length, 0);

  const selectedId = searchParams.get('model');
  const selectedModel = useMemo(() => models.find((model) => model.id === selectedId) ?? null, [models, selectedId]);
  const openModel = (id: string, trigger: HTMLButtonElement) => {
    selectedTriggerRef.current = trigger;
    setSearchParams((params) => {
      params.set('model', id);
      return params;
    });
  };
  const closeModel = useCallback(() => {
    setSearchParams((params) => {
      params.delete('model');
      return params;
    });
    window.requestAnimationFrame(() => selectedTriggerRef.current?.focus({ preventScroll: true }));
  }, [setSearchParams]);

  return (
    <Layout title="Model Search" description="Open-weight agricultural models, categorized by task and crop, with source-reported metrics.">
      <div className={shared.page}>
        <ModelDetailModal model={selectedModel} open={selectedModel != null} onClose={closeModel} />

        <div className={styles.policyBanner} role="note">
          <strong>External models — not benchmarked by AgML.</strong> These open-weight models are hosted by their
          authors, not by AgML or the <code>agml</code> package. Metrics are copied from each source and are
          unverified; they are kept separate from, and are not comparable to, the{' '}
          <Link to="/leaderboard">AgML leaderboard</Link>.
          {catalog.last_updated && <> Catalog updated {catalog.last_updated}.</>}{' '}
          <Link to="/docs/contributing-models">Add a model</Link>.
        </div>

        <div className={shared.toolbar}>
          <input
            type="search"
            placeholder="search models, crops, datasets, architectures..."
            value={qLocal}
            onChange={(event) => setQLocal(event.target.value)}
            className={shared.searchInput}
            aria-label="Search models"
          />
          <div className={shared.toolbarRight}>
            <span className={shared.resultCount}>{filtered.length} of {models.length} models</span>
            {(qDeferred || activeFilterCount > 0) && (
              <button
                type="button"
                className={shared.clearButton}
                onClick={() => {
                  setQLocal('');
                  setSearchParams(() => new URLSearchParams());
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className={shared.body}>
          <aside className={shared.sidebar}>
            {MODEL_FILTERS.map((filter) =>
              filter.kind === 'checkbox' ? (
                <div key={filter.key} className={shared.filterGroup}>
                  <p className={shared.filterGroupLabel}>{filter.label}</p>
                  <div className={shared.filterGroupOptions}>
                    {options[filter.key].map((option) => (
                      <label key={option} className={shared.checkboxRow}>
                        <span className={shared.checkboxRowLeft}>
                          <input
                            type="checkbox"
                            className={shared.checkbox}
                            checked={selections[filter.key].includes(option)}
                            onChange={() => toggle(filter.key, option)}
                          />
                          <span>{filter.formatOption ? filter.formatOption(option) : option}</span>
                        </span>
                        <span className={shared.checkboxCount}>{counts[filter.key][option] ?? 0}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div key={filter.key} className={shared.filterGroup}>
                  <MultiSelectDropdown
                    label={filter.label}
                    options={options[filter.key]}
                    selected={selections[filter.key]}
                    onToggle={(value) => toggle(filter.key, value)}
                    formatOption={filter.formatOption}
                  />
                </div>
              )
            )}
          </aside>

          <section className={shared.results}>
            {loading && <p className={shared.status}>Loading models…</p>}
            {error && <p className={shared.status}>Error: {error.message}</p>}
            {!loading && !error && (
              <>
                {filtered.length === 0 ? (
                  <p className={shared.status}>No models match the current filters.</p>
                ) : (
                  <div className={shared.cardGrid}>
                    {filtered.map((model) => (
                      <ModelCard key={model.id} model={model} onOpen={(trigger) => openModel(model.id, trigger)} />
                    ))}
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
