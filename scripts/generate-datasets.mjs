import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const staticDataDir = path.join(projectRoot, 'static', 'data');
const datasetsPath = path.join(staticDataDir, 'datasets.json');
const hfDatasetsPath = path.join(staticDataDir, 'hf_datasets.json');

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
}

generateDatasets().catch((err) => {
  console.error(err);
  process.exit(1);
});