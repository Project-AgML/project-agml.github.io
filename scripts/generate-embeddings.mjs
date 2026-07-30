import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { pipeline } from '@huggingface/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const staticDataDir = path.join(projectRoot, 'static', 'data');
const datasetsPath = path.join(staticDataDir, 'datasets.json');
const hfDatasetsPath = path.join(staticDataDir, 'hf_datasets.json');
const embeddingsDir = path.join(staticDataDir, 'embeddings');
const vectorsPath = path.join(embeddingsDir, 'vectors.bin');
const metaPath = path.join(embeddingsDir, 'meta.json');

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;
const BATCH_SIZE = 64;

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hasValue(value) {
  return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== '';
}

function pickFirstDefined(a, b, field) {
  return hasValue(a?.[field]) ? a[field] : (b?.[field] ?? null);
}

// Fields the embedding text template reads (see buildEmbeddingText below). Mirrors the subset
// of the `Dataset` interface in src/lib/datasets.ts that carries semantic meaning — keep the
// two in sync if either changes. This is a narrower, name-keyed coalesce merge than
// mergeDataset()/loadDatasets() in that file (which merges the full Dataset shape); it only
// needs to cover the fields below.
const TEMPLATE_FIELDS = [
  'machine_learning_task',
  'agricultural_task',
  'crop_types',
  'location',
  'environment',
  'sensor_modality',
  'platform',
  'real_or_synthetic',
  'classes',
];

function mergeForEmbedding(datasetsRaw, hfDatasetsRaw) {
  const byName = new Map();
  for (const raw of [...datasetsRaw, ...hfDatasetsRaw]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : null;
    if (!name) continue;
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, raw);
      continue;
    }
    const merged = { name };
    for (const field of TEMPLATE_FIELDS) merged[field] = pickFirstDefined(existing, raw, field);
    byName.set(name, merged);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function humanize(value) {
  return String(value).replace(/_/g, ' ').trim();
}

// "iNatAg-mini/abelmoschus_esculentus" -> "abelmoschus esculentus (iNatAg-mini species image dataset)"
// The ~5,900 iNatAg(-mini) child records share near-identical task/location/platform/sensor
// metadata — the species slug in the name is the only real distinguishing signal for them.
function buildNameText(name) {
  const slash = name.indexOf('/');
  if (slash === -1) return humanize(name);
  const parent = name.slice(0, slash);
  const species = humanize(name.slice(slash + 1));
  return `${species} (${parent} species image dataset)`;
}

// Field order matters: the tokenizer truncates from the end, so the most identifying fields
// come first and the noisiest/longest field (classes) comes last.
function buildEmbeddingText(record) {
  const parts = [buildNameText(record.name)];
  if (record.machine_learning_task) parts.push(`Task: ${humanize(record.machine_learning_task)}`);
  if (record.agricultural_task && record.agricultural_task !== record.machine_learning_task) {
    parts.push(`Agricultural task: ${humanize(record.agricultural_task)}`);
  }
  const crops = Array.isArray(record.crop_types) ? record.crop_types : record.crop_types ? [record.crop_types] : [];
  if (crops.length) parts.push(`Crops: ${crops.map(humanize).join(', ')}`);
  const location = Array.isArray(record.location) ? record.location.join(', ') : record.location;
  if (location) parts.push(`Location: ${location}`);
  if (record.environment) parts.push(`Environment: ${humanize(record.environment)}`);
  if (record.sensor_modality) parts.push(`Sensor: ${humanize(record.sensor_modality)}`);
  if (record.platform) parts.push(`Platform: ${humanize(record.platform)}`);
  if (record.real_or_synthetic) parts.push(`Data: ${humanize(record.real_or_synthetic)}`);
  if (record.classes) parts.push(`Classes: ${String(record.classes).slice(0, 300)}`);
  return parts.join('. ');
}

function hashTexts(texts) {
  const hash = crypto.createHash('sha256');
  for (const text of texts) hash.update(text).update('\n');
  return hash.digest('hex');
}

async function embedAll(texts) {
  // dtype MUST match what the browser uses (src/lib/semanticSearch.ts) — both must embed with
  // the same quantized weights so build-time corpus vectors and client-time query vectors live
  // in the same space. device: 'cpu' uses onnxruntime-node here; that's a build-time-only
  // native dependency and never ships to the browser bundle.
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8', device: 'cpu' });
  const vectors = new Float32Array(texts.length * DIM);
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    vectors.set(output.data, i * DIM);
    console.log(`Embedded ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length}`);
  }
  return vectors;
}

async function generateEmbeddings() {
  const datasetsRaw = readJson(datasetsPath) ?? [];
  const hfDatasetsRaw = readJson(hfDatasetsPath) ?? [];
  const merged = mergeForEmbedding(
    Array.isArray(datasetsRaw) ? datasetsRaw : Object.values(datasetsRaw),
    Array.isArray(hfDatasetsRaw) ? hfDatasetsRaw : Object.values(hfDatasetsRaw)
  );
  const texts = merged.map(buildEmbeddingText);
  const contentHash = hashTexts(texts);

  const existingMeta = readJson(metaPath);
  if (existingMeta?.contentHash === contentHash && fs.existsSync(vectorsPath)) {
    console.log('generate-embeddings: content unchanged, skipping regeneration.');
    return;
  }

  const vectors = await embedAll(texts);

  fs.mkdirSync(embeddingsDir, { recursive: true });
  fs.writeFileSync(vectorsPath, Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      model: MODEL_ID,
      dtype: 'q8',
      dim: DIM,
      count: merged.length,
      generatedAt: new Date().toISOString(),
      contentHash,
      names: merged.map((d) => d.name),
    })
  );
  console.log('Wrote', vectorsPath, `(${vectors.byteLength} bytes)`, 'and', metaPath, `(${merged.length} records)`);
}

generateEmbeddings().catch((err) => {
  console.error(err);
  process.exit(1);
});
