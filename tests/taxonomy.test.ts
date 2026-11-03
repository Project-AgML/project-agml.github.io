import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTree,
  normalizeTaxonName,
  resolveDatasets,
  searchTree,
  type CropTaxonomy,
  type INatAgTaxa,
  type TaxonomyDatasetInput,
} from '../src/lib/taxonomy';

const root = join(import.meta.dirname, '..');
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const taxonomy: CropTaxonomy = readJson('static/data/taxonomy/crop_taxonomy.json');
const inatag: INatAgTaxa = readJson('static/data/taxonomy/inatag_taxa.json');

describe('crop_taxonomy.json integrity', () => {
  test('every catalog crop_types label is mapped', () => {
    // New catalog entries regularly introduce new labels. When this fails, add the label(s) to
    // static/data/taxonomy/crop_taxonomy.json -> "labels" (and a taxon under "taxa" if needed).
    const labels = new Set<string>();
    for (const file of ['static/data/datasets.json', 'static/data/hf_datasets.json']) {
      for (const record of readJson(file) as { crop_types?: unknown }[]) {
        if (!Array.isArray(record.crop_types)) continue;
        for (const label of record.crop_types) {
          if (typeof label !== 'string') continue;
          const normalized = label.trim().toLowerCase();
          // Mirrors normalizeDataset in src/lib/datasets.ts, which drops "+N more" placeholders.
          if (normalized && !/^\+.*\b(more|others?)\b/i.test(normalized)) labels.add(normalized);
        }
      }
    }
    const missing = [...labels].filter((label) => !taxonomy.labels[label]).sort();
    assert.deepEqual(missing, [], `Unmapped crop_types labels: ${missing.join(', ')}`);
  });

  test('labels point at known taxa, roles and use groups', () => {
    for (const [label, entry] of Object.entries(taxonomy.labels)) {
      if (entry.taxon) assert.ok(taxonomy.taxa[entry.taxon], `${label} -> unknown taxon ${entry.taxon}`);
      if (entry.role) assert.ok(taxonomy.roles[entry.role], `${label} -> unknown role ${entry.role}`);
      for (const group of entry.groups ?? []) assert.ok(taxonomy.use_groups[group], `${label} -> unknown group ${group}`);
      assert.ok(entry.taxon || entry.role || entry.groups || entry.unresolved, `${label} resolves to nothing`);
    }
    for (const [name, taxon] of Object.entries(taxonomy.taxa)) {
      assert.ok(taxonomy.roles[taxon.role], `${name} has unknown role ${taxon.role}`);
      assert.ok(taxon.family, `${name} has no family`);
      for (const group of taxon.groups ?? []) assert.ok(taxonomy.use_groups[group], `${name} -> unknown group ${group}`);
    }
  });

  test('curated families agree with iNatAg for shared genera', () => {
    const genusFamily = new Map<string, string>();
    for (const [slug, [family]] of Object.entries(inatag)) genusFamily.set(slug.split('_')[0], family);
    for (const [name, taxon] of Object.entries(taxonomy.taxa)) {
      if (taxon.rank !== 'species' && taxon.rank !== 'genus') continue;
      const inatFamily = genusFamily.get(name.split(' ')[0].toLowerCase());
      if (inatFamily) assert.equal(taxon.family, inatFamily, `${name}: ${taxon.family} vs iNatAg ${inatFamily}`);
    }
  });
});

describe('trees', () => {
  const datasets: TaxonomyDatasetInput[] = [
    { name: 'pigeonpea_a', crop_types: ['pigeonpea'] },
    { name: 'pigeonpea_b', crop_types: ['arhar', 'red gram'] },
    { name: 'soy_weeds', crop_types: ['soybean', 'waterhemp'] },
    { name: 'apples', crop_types: ['fuji apple', 'apple'] },
    { name: 'mixed', crop_types: ['fruits', 'caricature'] },
    { name: 'nothing', crop_types: null },
    { name: 'iNatAg', crop_types: null, childSpecies: ['zea_mays', 'ailanthus_altissima'] },
  ];
  const { resolved, unmappedLabels } = resolveDatasets(datasets, taxonomy, inatag);

  test('synonyms collapse to one species node with distinct dataset counts', () => {
    const tree = buildTree('botanical', resolved, taxonomy);
    const node = tree.byId.get('f:fabaceae/g:cajanus/t:cajanus cajan');
    assert.ok(node);
    assert.deepEqual([...node.datasets].sort(), ['pigeonpea_a', 'pigeonpea_b']);
    assert.deepEqual([...node.labels].sort(), ['arhar', 'pigeonpea', 'red gram']);
    assert.deepEqual(unmappedLabels, []);
  });

  test('a crop can sit under several use groups', () => {
    const tree = buildTree('group', resolved, taxonomy);
    assert.ok(tree.byId.get('g:oilseeds/t:glycine max')?.datasets.has('soy_weeds'));
    assert.ok(tree.byId.get('g:legumes/t:glycine max')?.datasets.has('soy_weeds'));
    // Weeds carry no use group.
    assert.equal([...tree.byId.values()].some((n) => n.id.includes('amaranthus')), false);
  });

  test('group-level tags attach to the inner node, cultivars nest under species', () => {
    const tree = buildTree('group', resolved, taxonomy);
    const fruit = tree.byId.get('g:fruit_nuts');
    assert.ok(fruit?.datasets.has('mixed'));
    assert.ok(fruit?.labels.has('fruits'));
    assert.ok(tree.byId.get('g:fruit_nuts/t:malus domestica/cv:fuji')?.datasets.has('apples'));
    assert.equal(tree.byId.get('g:fruit_nuts/t:malus domestica')?.datasets.size, 1);
  });

  test('role tree separates weeds and buckets unresolved and unlabeled datasets', () => {
    const tree = buildTree('role', resolved, taxonomy);
    assert.ok(tree.byId.get('r:weed')?.datasets.has('soy_weeds'));
    assert.ok(tree.byId.get('r:crop')?.datasets.has('soy_weeds'));
    assert.ok(tree.byId.get('unresolved/l:caricature')?.datasets.has('mixed'));
    assert.ok(tree.byId.get('unlabeled')?.datasets.has('nothing'));
    // iNatAg's curated species (maize) gets a role; its uncurated ones don't create role nodes.
    assert.ok(tree.byId.get('r:crop')?.datasets.has('iNatAg'));
    assert.equal(tree.byId.get('unlabeled')?.datasets.has('iNatAg'), false);
  });

  test('iNatAg species land in the botanical tree and can be excluded', () => {
    const withINat = buildTree('botanical', resolved, taxonomy);
    assert.ok(withINat.byId.get('f:simaroubaceae/g:ailanthus/t:ailanthus altissima')?.datasets.has('iNatAg'));
    const without = buildTree('botanical', resolved, taxonomy, { includeINatAg: false });
    assert.equal(without.byId.has('f:simaroubaceae'), false);
    assert.equal(without.root.datasets.has('iNatAg'), false);
  });

  test('search matches synonyms, scientific names and families, with ancestors visible', () => {
    const tree = buildTree('botanical', resolved, taxonomy);
    const result = searchTree(tree, 'red gram');
    assert.ok(result?.matches.has('f:fabaceae/g:cajanus/t:cajanus cajan'));
    assert.ok(result?.visible.has('f:fabaceae'));
    assert.ok(searchTree(tree, 'cajanus')?.matches.has('f:fabaceae/g:cajanus'));
    assert.equal(searchTree(tree, '  '), null);
  });

  test('normalizeTaxonName matches hybrids across sources', () => {
    assert.equal(normalizeTaxonName('Fragaria × ananassa'), normalizeTaxonName('fragaria_ananassa'));
  });
});
