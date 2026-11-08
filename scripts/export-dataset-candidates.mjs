// Builds the INTERNAL ingestion list: public datasets that catalogued external models use but AgML
// does not host (agml.status = "not_in_agml" in static/data/models.json).
// Ingestion planning is private — nothing here is published. Output and notes live in the
// gitignored private/ folder:
//   private/ingestion_notes.json   hand-kept notes (dataset_notes by dataset id, agml_followups)
//   private/datasets_to_ingest.json  generated; your `status` edits are kept across reruns
//
//   npm run export-dataset-candidates [-- output.json]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCatalog } from '../src/lib/modelCatalog.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateDir = path.join(projectRoot, 'private');
const modelsPath = path.join(projectRoot, 'static', 'data', 'models.json');
const notesPath = path.join(privateDir, 'ingestion_notes.json');
const outPath = path.resolve(process.argv[2] ?? path.join(privateDir, 'datasets_to_ingest.json'));

function readJson(filePath, fallback) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
}

const catalog = normalizeCatalog(readJson(modelsPath, {}));
const notes = readJson(notesPath, { dataset_notes: {}, agml_followups: [] });
const previous = new Map((readJson(outPath, { candidates: [] }).candidates ?? []).map((entry) => [entry.id, entry]));

const byId = new Map();
for (const model of catalog.models) {
  for (const ref of model.datasets) {
    if (ref.agml.status !== 'not_in_agml') continue;
    const entry = byId.get(ref.id) ?? {
      id: ref.id,
      name: ref.name,
      link: ref.link,
      license: ref.license,
      description: ref.description,
      public_note: ref.agml.note,
      internal_notes: notes.dataset_notes?.[ref.id] ?? [],
      used_by: [],
      status: previous.get(ref.id)?.status ?? 'todo',
    };
    entry.used_by.push({
      id: model.id,
      name: model.name,
      roles: ref.roles,
      machine_learning_task: model.machine_learning_task,
      publisher_type: model.publisher_type,
    });
    byId.set(ref.id, entry);
  }
}
const candidates = Array.from(byId.values()).sort(
  (a, b) => b.used_by.length - a.used_by.length || a.name.localeCompare(b.name)
);
// Entries you were tracking whose dataset left the catalog (or got into AgML) are kept, flagged.
const dropped = Array.from(previous.values())
  .filter((entry) => !byId.has(entry.id))
  .map((entry) => ({ ...entry, no_longer_in_catalog: true }));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generated: new Date().toISOString().slice(0, 10),
      source: 'static/data/models.json (agml.status = not_in_agml) + private/ingestion_notes.json',
      count: candidates.length,
      candidates: [...candidates, ...dropped],
      agml_followups: notes.agml_followups ?? [],
    },
    null,
    2
  ) + '\n'
);
console.log(`Wrote ${candidates.length} datasets (+${dropped.length} no longer in catalog) to ${outPath}`);
