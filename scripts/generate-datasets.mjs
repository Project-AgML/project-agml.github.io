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
    const leaderboard = Array.isArray(raw) ? raw : Array.isArray(raw?.leaderboard) ? raw.leaderboard : [];
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