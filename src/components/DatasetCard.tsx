import { formatPrimaryLocation, isVlmTask, type Dataset } from '../lib/datasets';
import { toDisplayLabel, toNameTitleCase } from '../lib/labelOverrides';
import styles from './DatasetCard.module.css';

// Shared by the dataset search page and the taxonomy explorer. Grid layout: wrap cards in an
// element with `styles.cardGrid` (exported from DatasetCard.module.css).

function formatImageCount(count: number | null) {
  if (count == null) return 'Unknown';
  if (count >= 1000) {
    const scaled = (count / 1000).toFixed(1);
    const trimmed = scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled;
    return `${trimmed}k`;
  }
  return count.toLocaleString();
}

function formatBytesDecimal(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const formatted = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  const trimmed = formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
  return `${trimmed} ${units[unitIndex]}`;
}

function taskBadgeClass(task: string | null): string {
  if (!task) return styles.badgeOther;
  if (isVlmTask(task)) return styles.badgeVlm;
  if (task.includes('classif')) return styles.badgeClassification;
  if (task.includes('detect')) return styles.badgeDetection;
  if (task.includes('segment')) return styles.badgeSegmentation;
  return styles.badgeOther;
}

// VLM datasets list many agricultural tasks; the card shows the first few, the modal shows all.
const MAX_CARD_AG_TASKS = 2;

export function DatasetCard({
  dataset,
  onOpen,
}: {
  dataset: Dataset;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const {
    name,
    machine_learning_task,
    agricultural_task,
    num_images,
    num_qa_pairs,
    zip_size_bytes,
    augmented_num_images,
    augmented_zip_size_bytes,
    dataset_type,
  } = dataset;
  const fileSize = formatBytesDecimal(zip_size_bytes);
  const augmentedFileSize = formatBytesDecimal(augmented_zip_size_bytes);
  const hasAugmented = augmented_num_images != null;
  // VLM datasets are sized by QA pairs as well as images.
  const isVlm = dataset_type === 'vlm';
  const agTasks = agricultural_task == null ? [] : [agricultural_task].flat();
  const primaryLocation = formatPrimaryLocation(dataset);

  return (
    <button
      type="button"
      className={styles.cardButton}
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`Open details for ${name}`}
    >
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.cardTitleLink}>{isVlm ? name : toNameTitleCase(name)}</span>
        </h2>
        <div className={styles.cardTags}>
          {machine_learning_task && (
            <span className={`${styles.taskBadge} ${taskBadgeClass(machine_learning_task)}`}>
              {toDisplayLabel(machine_learning_task)}
            </span>
          )}
          {agTasks.slice(0, MAX_CARD_AG_TASKS).map((task) => (
            <span key={task} className={styles.tag}>{toDisplayLabel(task)}</span>
          ))}
          {agTasks.length > MAX_CARD_AG_TASKS && (
            <span className={styles.tag}>+{agTasks.length - MAX_CARD_AG_TASKS} more</span>
          )}
          {primaryLocation && <span className={styles.tag}>{primaryLocation}</span>}
        </div>
        <div className={styles.cardFooter}>
          <div className={styles.cardFooterRow}>
            <span>
              {formatImageCount(num_images)} images
              {isVlm && num_qa_pairs != null && <> · {formatImageCount(num_qa_pairs)} QA pairs</>}
            </span>
            {fileSize && <span>{fileSize}</span>}
          </div>
          {hasAugmented && (
            <div className={`${styles.cardFooterRow} ${styles.cardFooterAugmented}`}>
              <span>augmented: {formatImageCount(augmented_num_images)} images</span>
              {augmentedFileSize && <span>{augmentedFileSize}</span>}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default DatasetCard;
