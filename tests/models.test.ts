import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatMetricValue,
  headlineResult,
  isUnverified,
  modelMatchesQuery,
  modelsByAgmlDataset,
  normalizeCatalog,
  normalizeModel,
} from '../src/lib/modelCatalog';
// @ts-expect-error — plain .mjs build script, no type declarations
import { loadAgmlDatasetNames, validateModelCatalog } from '../scripts/validate-models.mjs';

const staticData = path.join(import.meta.dirname, '..', 'static', 'data');

function baseModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo-model',
    name: 'Demo Model',
    publisher_type: 'community',
    machine_learning_task: 'image_classification',
    agricultural_tasks: ['disease_classification'],
    crop_types: ['Tomato'],
    license: 'MIT',
    links: { weights: 'https://example.org/weights' },
    agml_benchmarked: false,
    verification: 'source_reported',
    reported_results: [
      {
        setting: 'fine-tuned',
        eval_dataset: 'tomato_set',
        split: 'test',
        metrics: { accuracy: 0.9, f1: 0.85 },
        primary_metric: 'f1',
        source_url: 'https://example.org/card',
      },
    ],
    datasets: [
      {
        id: 'tomato_set',
        name: 'Tomato Set',
        roles: ['train', 'eval'],
        description: 'Tomato leaves.',
        link: 'https://example.org/data',
        agml: { status: 'in_agml', names: ['tomato_leaf_disease'] },
      },
      {
        id: 'extra_set',
        name: 'Extra Set',
        roles: ['eval'],
        description: 'Something public.',
        link: 'https://example.org/extra',
        agml: { status: 'not_in_agml', names: [] },
      },
    ],
    ...overrides,
  };
}

describe('normalizeModel', () => {
  test('lowercases crops and keeps numeric metrics only', () => {
    const model = normalizeModel(baseModel({ reported_results: [{ eval_dataset: 'tomato_set', metrics: { accuracy: 0.5, bad: 'x' } }] }))!;
    assert.deepEqual(model.crop_types, ['tomato']);
    assert.deepEqual(model.reported_results[0].metrics, { accuracy: 0.5 });
  });

  test('never trusts a verification claim without agml_benchmarked', () => {
    const model = normalizeModel(baseModel({ verification: 'agml_verified', agml_benchmarked: false }))!;
    assert.equal(model.verification, 'source_reported');
    assert.equal(isUnverified(model), true);
  });
});

describe('catalog helpers', () => {
  const catalog = normalizeCatalog({ schema_version: 1, models: [baseModel()] });

  test('headline uses the primary metric', () => {
    assert.deepEqual(headlineResult(catalog.models[0]), { label: 'F1', value: '85.0%', dataset: 'Tomato Set' });
  });

  test('formats fractions as percentages', () => {
    assert.equal(formatMetricValue(0.957), '95.7%');
    assert.equal(formatMetricValue(1), '100%');
  });

  test('query search spans every field, including dataset descriptions', () => {
    assert.ok(modelMatchesQuery(catalog.models[0], 'tomato leaves'));
    assert.ok(!modelMatchesQuery(catalog.models[0], 'cassava'));
  });

  test('links AgML datasets back to models', () => {
    const byDataset = modelsByAgmlDataset(catalog.models);
    assert.equal(byDataset.get('tomato_leaf_disease')?.[0].model.id, 'demo-model');
    assert.equal(byDataset.has('extra_set'), false);
  });
});

describe('validateModelCatalog', () => {
  const names = new Set(['tomato_leaf_disease']);

  test('accepts a well-formed entry', () => {
    const { errors } = validateModelCatalog({ models: [baseModel()] }, names);
    assert.deepEqual(errors, []);
  });

  test('rejects unknown AgML dataset names, percentages, and fake verification', () => {
    const bad = baseModel({
      agml_benchmarked: true,
      reported_results: [{ eval_dataset: 'tomato_set', metrics: { accuracy: 95.7 }, source_url: 'x', split: 'test' }],
    });
    (bad.datasets as any[])[0].agml.names = ['does_not_exist'];
    const { errors } = validateModelCatalog({ models: [bad] }, names);
    assert.ok(errors.some((e: string) => e.includes('does_not_exist')));
    assert.ok(errors.some((e: string) => e.includes('fractions')));
    assert.ok(errors.some((e: string) => e.includes('agml_verified')));
  });

  test('the published catalog is valid', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(staticData, 'models.json'), 'utf8'));
    const { errors } = validateModelCatalog(catalog, loadAgmlDatasetNames(staticData));
    assert.deepEqual(errors, []);
    for (const model of normalizeCatalog(catalog).models) assert.equal(isUnverified(model), true, model.id);
    // Ingestion planning stays internal (private/): no candidate framing in the public catalog.
    assert.ok(!/candidate|raw_only|before adding/i.test(JSON.stringify(catalog)));
  });
});
