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
  detection: ['map', 'map_50', 'map50', 'mAP', 'mAP@0.5', 'f1_at_iou50'],
  segmentation: ['miou', 'iou', 'mean_iou'],
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Mirrors isRecord in src/lib/performance.ts — keep in sync. `typeof x === 'object'` alone is
// true for arrays too, which previously let a stray `"finetune": []` be misclassified as a
// fine-tuned run here while the browser-side isRecord() correctly rejected it.
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Mirrors toText in src/lib/performance.ts — keep in sync.
function toText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveMetricKey(task, metrics) {
  const candidates = TASK_METRIC_KEYS[task] ?? [];
  for (const key of candidates) {
    if (isFiniteNumber(metrics[key])) return key;
  }
  return Object.keys(metrics).find((key) => isFiniteNumber(metrics[key])) ?? null;
}

// Every run can report several metric families at once (F1, mAP, precision, recall),
// independent of the single metric resolveMetricKey picks for the legacy per-dataset rank.
// These four category scores back the leaderboard's four sortable global columns — precision
// and recall are ranked/percentiled independently, not averaged into one blended score.
function isMapMetricKey(key) {
  return /^m?ap([_@-]|$)/i.test(key);
}

// Detection runs that can't produce a confidence-ranked mAP instead report f1/precision/recall
// "at IoU" (e.g. f1_at_iou50) — same metric families as classification, just suffixed. Matches
// the bare key too (e.g. "f1") so this subsumes the plain-key case.
function baseMetricKind(key) {
  const normalized = key.toLowerCase();
  if (/^f1([_@-]|$)/.test(normalized)) return 'f1';
  if (/^(precision|prec)([_@-]|$)/.test(normalized)) return 'precision';
  if (/^(recall|rec)([_@-]|$)/.test(normalized)) return 'recall';
  return null;
}

function computeCategoryScores(metrics) {
  let f1 = null;
  let map = null;
  let precision = null;
  let recall = null;
  for (const [key, value] of Object.entries(metrics)) {
    if (!isFiniteNumber(value)) continue;
    if (isMapMetricKey(key)) {
      map = map == null ? value : Math.max(map, value);
      continue;
    }
    switch (baseMetricKind(key)) {
      case 'f1':
        f1 = f1 == null ? value : Math.max(f1, value);
        break;
      case 'precision':
        precision = precision == null ? value : Math.max(precision, value);
        break;
      case 'recall':
        recall = recall == null ? value : Math.max(recall, value);
        break;
    }
  }
  return { f1, map, precision, recall };
}

// Mirrors buildRunNote in src/lib/performance.ts — keep in sync. entry.notes carries the run's
// full methodology text (prompt used, parsing rules, metric definitions, etc.) straight from the
// benchmark script, appended after the generated summary line rather than discarded.
function buildRunNote(entry) {
  const parts = ['Zero-shot'];
  if (isFiniteNumber(entry.num_samples)) parts.push(`evaluated on ${entry.num_samples} images`);
  const summary = parts.join(' · ');
  const detail = toText(entry.notes);
  return detail ? `${summary}\n\n${detail}` : summary;
}

// Mirrors buildFinetuneNote in src/lib/performance.ts — keep in sync.
function buildFinetuneNote(finetune, entryNotes) {
  if (!isRecord(finetune)) return null;
  const parts = ['Fine-tuned'];
  if (isFiniteNumber(finetune.train_samples)) parts.push(`trained on ${finetune.train_samples} images from this dataset`);
  if (isFiniteNumber(finetune.val_samples)) parts.push(`validated on ${finetune.val_samples} images`);
  if (isFiniteNumber(finetune.epochs)) parts.push(`${finetune.epochs} epochs`);
  if (isFiniteNumber(finetune.lr)) parts.push(`lr=${finetune.lr}`);
  if (isFiniteNumber(finetune.weight_decay)) parts.push(`weight decay=${finetune.weight_decay}`);
  if (isFiniteNumber(finetune.split_seed)) parts.push(`seed=${finetune.split_seed}`);
  if (isFiniteNumber(finetune.train_ratio)) parts.push(`train ratio=${finetune.train_ratio}`);
  const summary = parts.join(' · ');
  const detail = toText(entryNotes);
  return detail ? `${summary}\n\n${detail}` : summary;
}

// Rendered as train/test/val percentages in that fixed order, e.g. "10/80/10" — mirrors
// buildSplitBreakdown in src/lib/performance.ts, kept in sync for the same reason as above.
function buildSplitBreakdown(entry, finetune) {
  const testSamples = isFiniteNumber(entry.num_samples) ? entry.num_samples : null;
  const trainSamples = isRecord(finetune) && isFiniteNumber(finetune.train_samples) ? finetune.train_samples : null;
  const valSamples = isRecord(finetune) && isFiniteNumber(finetune.val_samples) ? finetune.val_samples : null;
  const total = (trainSamples ?? 0) + (testSamples ?? 0) + (valSamples ?? 0);
  if (!total) return null;
  const toShare = (value) => (value != null ? ((value / total) * 100).toFixed(0) : '-');
  return `${toShare(trainSamples)}/${toShare(testSamples)}/${toShare(valSamples)}`;
}

// The result set encodes optimized as the string "yes" / "no" (not a boolean) — a finetune
// object's own optimized field, if present, may already be boolean, so both forms are accepted.
function isOptimized(value) {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'yes';
  return Boolean(value);
}

function makeLeaderboardRow(entry, metricKey, variant) {
  const finetune = entry.finetune;
  return {
    model: entry.model.trim(),
    score: entry.metrics[metricKey],
    categoryScores: computeCategoryScores(entry.metrics),
    benchmarkId: isFiniteNumber(entry.benchmark_id) ? entry.benchmark_id : null,
    variant,
    date: toText(entry.timestamp)?.slice(0, 10) ?? null,
    submitted_by: null,
    link: null,
    notes: variant === 'fine-tuned' ? buildFinetuneNote(finetune, entry.notes) : buildRunNote(entry),
    optimized: isOptimized(entry.optimized) || (isRecord(finetune) && isOptimized(finetune.optimized)),
    platform: toText(entry.device),
    splitBreakdown: buildSplitBreakdown(entry, finetune),
    // dataset_config is the result set's own config field (raw / augmented) — no fallback to
    // `split`, which is a different concept (the run's data split, e.g. "train"). Absent config
    // means the run used the dataset's raw (unaugmented) form.
    datasetConfig: toText(entry.dataset_config) ?? 'raw',
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
      isFinetune: isRecord(entry.finetune),
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

const CATEGORY_KEYS = ['f1', 'map', 'precision', 'recall'];

// Ranks entries by a single category's score, independently of the other categories and of
// the legacy single-metric rank — an entry that doesn't report this category gets a null
// percentile for it rather than being penalized or excluded from the others.
function computeCategoryPercentiles(entries, categoryKey) {
  const withScore = entries
    .map((entry, index) => ({ index, score: entry.categoryScores?.[categoryKey] }))
    .filter((item) => isFiniteNumber(item.score))
    .sort((a, b) => b.score - a.score);
  const total = withScore.length;
  const percentileByIndex = new Map();
  withScore.forEach((item, rankIndex) => {
    const rank = rankIndex + 1;
    percentileByIndex.set(item.index, total > 1 ? ((total - rank) / (total - 1)) * 100 : 100);
  });
  return percentileByIndex;
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

    const percentilesByCategory = Object.fromEntries(
      CATEGORY_KEYS.map((key) => [key, computeCategoryPercentiles(entries, key)])
    );

    const meta = metadataLookup.get(datasetName) ?? { crop_types: null, machine_learning_task: null };
    entries.forEach((entry, index) => {
      const percentiles = Object.fromEntries(
        CATEGORY_KEYS.map((key) => [key, percentilesByCategory[key].get(index) ?? null])
      );
      records.push({
        model: entry.model.trim(),
        dataset: datasetName,
        percentiles,
        scores: entry.categoryScores,
        crop_types: meta.crop_types,
        machine_learning_task: meta.machine_learning_task,
        benchmarkId: entry.benchmarkId ?? null,
        variant: entry.variant === 'zero-shot' || entry.variant === 'fine-tuned' ? entry.variant : null,
        // isOptimized(), not Boolean() — a pre-built {leaderboard:[...]} entry may still encode
        // this as the raw "yes"/"no" string convention (see isOptimized above), and Boolean("no")
        // is true.
        optimized: isOptimized(entry.optimized),
        platform: toText(entry.platform),
        splitBreakdown: toText(entry.splitBreakdown),
        datasetConfig: toText(entry.datasetConfig),
        notes: toText(entry.notes),
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