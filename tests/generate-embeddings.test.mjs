import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeForEmbedding, buildEmbeddingText, buildNameText, hashTexts } from '../scripts/generate-embeddings.mjs';

describe('mergeForEmbedding', () => {
  test('coalesces a datasets.json record with a matching hf_datasets.json record by name', () => {
    const merged = mergeForEmbedding(
      [{ name: 'corn-leaf', machine_learning_task: 'classification', crop_types: null }],
      [{ name: 'corn-leaf', crop_types: ['corn'], location: 'Iowa' }]
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].machine_learning_task, 'classification');
    assert.deepEqual(merged[0].crop_types, ['corn']);
    assert.equal(merged[0].location, 'Iowa');
  });

  test('prefers the first source when both define the same field', () => {
    const merged = mergeForEmbedding([{ name: 'a', location: 'from-datasets' }], [{ name: 'a', location: 'from-hf' }]);
    assert.equal(merged[0].location, 'from-datasets');
  });

  test('drops records with no name and sorts the rest by name', () => {
    const merged = mergeForEmbedding([{ name: 'zebra' }, { name: '' }, { name: null }], [{ name: 'apple' }]);
    assert.deepEqual(
      merged.map((d) => d.name),
      ['apple', 'zebra']
    );
  });

  test('falls back to dataset/slug/id/key when name is absent, matching normalizeDataset() in datasets.ts', () => {
    const merged = mergeForEmbedding([{ slug: 'from-slug', machine_learning_task: 'classification' }], []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].name, 'from-slug');
  });
});

describe('buildNameText', () => {
  test('humanizes a plain dataset name', () => {
    assert.equal(buildNameText('corn_leaf_disease'), 'corn leaf disease');
  });

  test('renders iNatAg-style child records as "<species> (<parent> species image dataset)"', () => {
    assert.equal(
      buildNameText('iNatAg-mini/abelmoschus_esculentus'),
      'abelmoschus esculentus (iNatAg-mini species image dataset)'
    );
  });
});

describe('buildEmbeddingText', () => {
  test('includes each populated field in a stable, labeled order', () => {
    const text = buildEmbeddingText({
      name: 'corn_leaf_disease',
      machine_learning_task: 'image_classification',
      agricultural_task: 'disease_detection',
      crop_types: ['corn', 'soybean'],
      location: ['Iowa', 'Illinois'],
      environment: 'field',
      sensor_modality: 'rgb',
      platform: 'drone',
      real_or_synthetic: 'real',
      classes: 'healthy, blight, rust',
    });
    assert.equal(
      text,
      'corn leaf disease. Task: image classification. Agricultural task: disease detection. ' +
        'Crops: corn, soybean. Location: Iowa, Illinois. Environment: field. Sensor: rgb. ' +
        'Platform: drone. Data: real. Classes: healthy, blight, rust'
    );
  });

  test('omits fields that are absent instead of emitting empty labels', () => {
    const text = buildEmbeddingText({ name: 'minimal' });
    assert.equal(text, 'minimal');
  });

  test('drops agricultural_task when it duplicates machine_learning_task', () => {
    const text = buildEmbeddingText({ name: 'x', machine_learning_task: 'segmentation', agricultural_task: 'segmentation' });
    assert.equal(text, 'x. Task: segmentation');
  });

  test('truncates classes to 300 characters, matching the client-side index truncation', () => {
    const text = buildEmbeddingText({ name: 'x', classes: 'c'.repeat(500) });
    const classesPart = text.split('Classes: ')[1];
    assert.equal(classesPart.length, 300);
  });

  test('omits Classes label when classes is an empty array', () => {
    const text = buildEmbeddingText({ name: 'x', classes: [] });
    assert.equal(text, 'x');
  });

  test('joins array-valued classes with ", ", matching datasets.ts toText() rather than Array.prototype.toString', () => {
    const text = buildEmbeddingText({ name: 'x', classes: ['healthy', 'blight', 'rust'] });
    assert.equal(text, 'x. Classes: healthy, blight, rust');
  });
});

describe('hashTexts', () => {
  test('is deterministic for the same input', () => {
    assert.equal(hashTexts(['a', 'b']), hashTexts(['a', 'b']));
  });

  test('changes when any text changes, so a corpus edit forces regeneration', () => {
    assert.notEqual(hashTexts(['a', 'b']), hashTexts(['a', 'c']));
  });

  test('is sensitive to record order', () => {
    assert.notEqual(hashTexts(['a', 'b']), hashTexts(['b', 'a']));
  });
});
