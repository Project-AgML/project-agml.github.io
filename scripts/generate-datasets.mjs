import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const staticDataDir = path.join(projectRoot, 'static', 'data');
const datasetsPath = path.join(staticDataDir, 'datasets.json');
const hfDatasetsPath = path.join(staticDataDir, 'hf_datasets.json');
const performanceDir = path.join(staticDataDir, 'performance');
const performanceIndexPath = path.join(performanceDir, 'index.json');
const performanceGlobalPath = path.join(performanceDir, 'global.json');
const PERFORMANCE_MANIFEST_FILES = new Set(['index.json', 'global.json']);

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeDataset(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  return {
    ...entry,
    source: typeof entry.source === 'string' && entry.source.trim() ? entry.source : 'agml',
  };
}

function normalizeManifest(json) {
  const records = Array.isArray(json) ? json : json && typeof json === 'object' ? Object.values(json) : [];
  return records.map(normalizeDataset).filter((entry) => entry != null);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function buildDatasetMetadataLookup(...manifests) {
  const lookup = new Map();
  for (const manifest of manifests) {
    for (const entry of manifest ?? []) {
      const name = typeof entry?.name === 'string' ? entry.name : null;
      if (!name || lookup.has(name)) continue;
      const cropTypes = Array.isArray(entry.crop_types)
        ? entry.crop_types.filter((c) => typeof c === 'string' && c.trim()).map((c) => c.toLowerCase())
        : null;
      const mlTask = typeof entry.machine_learning_task === 'string' && entry.machine_learning_task.trim()
        ? entry.machine_learning_task
        : null;
      lookup.set(name, { crop_types: cropTypes?.length ? cropTypes : null, machine_learning_task: mlTask });
    }
  }
  return lookup;
}

// Raw benchmark run records (see static/data/performance/<dataset>.json) are converted into
// leaderboard rows here. This logic is mirrored in src/lib/performance.ts for client-side
// rendering of the same files — keep the two in sync if the run schema changes.
const TASK_METRIC_KEYS = {
  classification: ['f1', 'accuracy', 'top1_accuracy'],
  detection: ['map', 'map_50', 'map50', 'mAP', 'mAP@0.5'],
  segmentation: ['miou', 'iou', 'mean_iou'],
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveMetricKey(task, metrics) {
  const candidates = TASK_METRIC_KEYS[task] ?? [];
  for (const key of candidates) {
    if (isFiniteNumber(metrics[key])) return key;
  }
  return Object.keys(metrics).find((key) => isFiniteNumber(metrics[key])) ?? null;
}

function buildRunNote(entry) {
  const parts = [];
  if (isFiniteNumber(entry.num_samples)) parts.push(`${entry.num_samples} samples`);
  if (typeof entry.device === 'string' && entry.device.trim()) parts.push(entry.device.trim());
  return parts.length ? parts.join(' · ') : null;
}

function buildFinetuneNote(finetune) {
  if (!finetune || typeof finetune !== 'object') return null;
  const parts = [];
  if (isFiniteNumber(finetune.epochs)) parts.push(`${finetune.epochs} epochs`);
  if (isFiniteNumber(finetune.train_samples)) parts.push(`${finetune.train_samples} train samples`);
  return parts.length ? parts.join(' · ') : null;
}

function makeLeaderboardRow(entry, metricKey, variant) {
  return {
    model: entry.model.trim(),
    score: entry.metrics[metricKey],
    variant,
    date: typeof entry.timestamp === 'string' ? entry.timestamp.slice(0, 10) : null,
    submitted_by: null,
    link: null,
    notes: variant === 'fine-tuned' ? buildFinetuneNote(entry.finetune) : buildRunNote(entry),
  };
}

// A model can appear multiple times per dataset (repeated runs, or a fine-tuned run alongside
// a zero-shot one). The leaderboard shows the best zero-shot result and the best fine-tuned
// result per model, side by side, rather than collapsing to a single row.
function buildLeaderboardFromRawResults(rawResults) {
  const scored = [];
  for (const entry of rawResults) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.model !== 'string' || !entry.model.trim()) continue;
    if (!entry.metrics || typeof entry.metrics !== 'object') continue;
    const metricKey = resolveMetricKey(entry.task, entry.metrics);
    if (!metricKey || !isFiniteNumber(entry.metrics[metricKey])) continue;
    scored.push({
      entry,
      metricKey,
      score: entry.metrics[metricKey],
      isFinetune: entry.finetune != null && typeof entry.finetune === 'object',
    });
  }

  const byModel = new Map();
  for (const item of scored) {
    const model = item.entry.model.trim();
    const group = byModel.get(model) ?? { zeroShot: null, fineTuned: null };
    const slot = item.isFinetune ? 'fineTuned' : 'zeroShot';
    if (!group[slot] || item.score > group[slot].score) group[slot] = item;
    byModel.set(model, group);
  }

  const rows = [];
  for (const group of byModel.values()) {
    if (group.zeroShot) rows.push(makeLeaderboardRow(group.zeroShot.entry, group.zeroShot.metricKey, 'zero-shot'));
    if (group.fineTuned) rows.push(makeLeaderboardRow(group.fineTuned.entry, group.fineTuned.metricKey, 'fine-tuned'));
  }

  rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return { metric: scored.length ? scored[0].metricKey : null, leaderboard: rows };
}

function sortLeaderboardEntries(entries) {
  return [...entries].sort((a, b) => {
    const rankA = typeof a.rank === 'number' ? a.rank : null;
    const rankB = typeof b.rank === 'number' ? b.rank : null;
    if (rankA != null && rankB != null) return rankA - rankB;
    const scoreA = typeof a.score === 'number' ? a.score : null;
    const scoreB = typeof b.score === 'number' ? b.score : null;
    if (scoreA != null && scoreB != null) return scoreB - scoreA;
    return 0;
  });
}

function buildGlobalPerformanceRecords(performanceDatasets, metadataLookup) {
  const records = [];
  for (const datasetName of performanceDatasets) {
    const raw = readJson(path.join(performanceDir, `${datasetName}.json`));
    const leaderboard = Array.isArray(raw)
      ? buildLeaderboardFromRawResults(raw).leaderboard
      : Array.isArray(raw?.leaderboard)
        ? raw.leaderboard
        : [];
    const entries = sortLeaderboardEntries(leaderboard.filter((entry) => typeof entry?.model === 'string' && entry.model.trim()));
    const total = entries.length;
    if (total === 0) continue;

    const meta = metadataLookup.get(datasetName) ?? { crop_types: null, machine_learning_task: null };
    entries.forEach((entry, index) => {
      const rank = index + 1;
      const percentile = total > 1 ? ((total - rank) / (total - 1)) * 100 : 100;
      records.push({
        model: entry.model.trim(),
        dataset: datasetName,
        percentile,
        crop_types: meta.crop_types,
        machine_learning_task: meta.machine_learning_task,
        variant: entry.variant === 'zero-shot' || entry.variant === 'fine-tuned' ? entry.variant : null,
      });
    });
  }
  return records;
}

async function generateDatasets() {
  const datasets = normalizeManifest(readJson(datasetsPath));
  const hfDatasetsRaw = readJson(hfDatasetsPath);
  const hfDatasets = Array.isArray(hfDatasetsRaw)
    ? hfDatasetsRaw.map((entry) => ({ ...entry, source: 'huggingface' }))
    : hfDatasetsRaw;

  writeJson(datasetsPath, datasets);
  console.log('Wrote', datasetsPath, '—', datasets.length, 'datasets');

  if (hfDatasetsRaw != null) {
    writeJson(hfDatasetsPath, hfDatasets);
    console.log('Wrote', hfDatasetsPath);
  }

  const performanceDatasets = fs.existsSync(performanceDir)
    ? fs
        .readdirSync(performanceDir)
        .filter((file) => file.endsWith('.json') && !PERFORMANCE_MANIFEST_FILES.has(file))
        .map((file) => file.slice(0, -'.json'.length))
        .sort()
    : [];
  writeJson(performanceIndexPath, performanceDatasets);
  console.log('Wrote', performanceIndexPath, '—', performanceDatasets.length, 'performance datasets');

  const metadataLookup = buildDatasetMetadataLookup(datasets, hfDatasets);
  const globalPerformance = buildGlobalPerformanceRecords(performanceDatasets, metadataLookup);
  writeJson(performanceGlobalPath, globalPerformance);
  console.log('Wrote', performanceGlobalPath, '—', globalPerformance.length, 'performance records');
}

generateDatasets().catch((err) => {
  console.error(err);
  process.exit(1);
});