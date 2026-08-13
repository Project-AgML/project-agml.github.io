import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { humanize, buildIndexRow, DIM, ORAMA_SCHEMA } from '../src/lib/semanticSearchIndex';
import type { Dataset } from '../src/lib/datasets';

describe('humanize', () => {
  test('replaces slashes and underscores with spaces', () => {
    assert.equal(humanize('iNatAg-mini/abelmoschus_esculentus'), 'iNatAg-mini abelmoschus esculentus');
  });

  test('keeps tokens Orama already indexes as single terms unchanged', () => {
    assert.equal(humanize('rgb'), 'rgb');
  });
});

describe('buildIndexRow', () => {
  const dataset: Dataset = {
    name: 'corn_leaf_disease',
    source: 'agml',
    machine_learning_task: 'image_classification',
    agricultural_task: 'disease_detection',
    location: ['Iowa', 'Illinois'],
    country: 'United States',
    display_location: 'United States',
    lat_lon: null,
    imaging_equipment: null,
    collection_period: null,
    environment: 'field',
    augmented_counterpart: null,
    crop_types: ['corn', 'soybean'],
    sensor_modality: 'rgb',
    real_or_synthetic: 'real',
    platform: ['drone'],
    input_data_format: null,
    annotation_format: null,
    num_images: 100,
    augmented_num_images: null,
    augmented_zip_size_bytes: null,
    documentation: null,
    classes: 'c'.repeat(500),
    stats_mean: null,
    stats_std: null,
    examples_image_url: null,
    license: null,
    citation: null,
    dataset_type: 'vision',
    qa_type: null,
    task_dimensions: null,
    num_task_types: null,
    conversation_format: null,
    num_rows: null,
    source_datasets: null,
  };

  test('keeps `name` exact but humanizes `nameText` for BM25 recall', () => {
    const row = buildIndexRow('corn_leaf_disease', dataset);
    assert.equal(row.name, 'corn_leaf_disease');
    assert.equal(row.nameText, 'corn leaf disease');
  });

  test('humanizes task/crop/sensor/platform fields', () => {
    const row = buildIndexRow('corn_leaf_disease', dataset);
    assert.equal(row.machine_learning_task, 'image classification');
    assert.equal(row.agricultural_task, 'disease detection');
    assert.deepEqual(row.crop_types, ['corn', 'soybean']);
  });

  test('normalizes a scalar location into a string[]', () => {
    const row = buildIndexRow('x', { ...dataset, location: 'Iowa' });
    assert.deepEqual(row.location, ['Iowa']);
  });

  test('truncates classes to 300 characters, matching scripts/generate-embeddings.mjs', () => {
    const row = buildIndexRow('corn_leaf_disease', dataset);
    assert.equal(row.classes.length, 300);
  });

  test('fills absent optional fields with empty strings/arrays rather than throwing', () => {
    const row = buildIndexRow('unknown-dataset', undefined);
    assert.equal(row.name, 'unknown-dataset');
    assert.equal(row.machine_learning_task, '');
    assert.deepEqual(row.crop_types, []);
    assert.deepEqual(row.location, []);
  });
});

describe('ORAMA_SCHEMA', () => {
  test('declares the embedding vector field at the model dimension used at build time', () => {
    assert.equal(ORAMA_SCHEMA.embedding, `vector[${DIM}]`);
    assert.equal(DIM, 384);
  });
});
