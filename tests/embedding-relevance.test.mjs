// Exercises the actual embedding model (same MODEL_ID/dtype/device as scripts/generate-embeddings.mjs)
// to check that semantic search would actually return sensible results, not just that the
// pipeline runs without throwing. This is slow (downloads/loads the real MiniLM weights, same
// as the `prebuild` step already does) and needs network access on a cold cache, so it's kept
// separate from the fast, network-free unit tests in generate-embeddings.test.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { embedAll, buildEmbeddingText, DIM } from '../scripts/generate-embeddings.mjs';

// A small, deliberately distinct corpus so a correct model should trivially separate them.
const CORPUS = [
  {
    name: 'corn-disease-drone',
    machine_learning_task: 'image_classification',
    agricultural_task: 'disease_detection',
    crop_types: ['corn'],
    sensor_modality: 'rgb',
    platform: 'drone',
    classes: 'healthy, northern leaf blight, gray leaf spot, rust',
  },
  {
    name: 'cattle-weight-sensor',
    machine_learning_task: 'regression',
    agricultural_task: 'livestock_weight_estimation',
    crop_types: [],
    sensor_modality: 'load_cell',
    platform: 'ground_station',
    classes: null,
  },
  {
    name: 'apple-orchard-synthetic-render',
    machine_learning_task: 'object_detection',
    agricultural_task: 'fruit_counting',
    crop_types: ['apple'],
    sensor_modality: 'rgb',
    platform: 'synthetic_renderer',
    real_or_synthetic: 'synthetic',
    classes: 'apple, leaf, branch',
  },
];

function cosineSim(a, b, offsetA, offsetB, dim) {
  let dot = 0;
  for (let i = 0; i < dim; i++) dot += a[offsetA + i] * b[offsetB + i];
  return dot; // vectors are already L2-normalized by embedAll's pooling/normalize, so dot == cosine
}

function nearest(queryVec, corpusVecs, dim, count) {
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < count; i++) {
    const score = cosineSim(queryVec, corpusVecs, 0, i * dim, dim);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return { index: bestIdx, score: bestScore };
}

describe('embedAll relevance (real model, network required)', () => {
  test(
    'a query about diseased corn leaves ranks the corn-disease dataset above unrelated ones',
    { timeout: 120_000 },
    async () => {
      const texts = CORPUS.map(buildEmbeddingText);
      const corpusVectors = await embedAll(texts);
      const queryVector = await embedAll(['images of diseased corn leaves for classification']);

      const { index } = nearest(queryVector, corpusVectors, DIM, CORPUS.length);
      assert.equal(CORPUS[index].name, 'corn-disease-drone');
    }
  );

  test(
    'a query about livestock weight sensors ranks the cattle dataset above unrelated ones',
    { timeout: 120_000 },
    async () => {
      const texts = CORPUS.map(buildEmbeddingText);
      const corpusVectors = await embedAll(texts);
      const queryVector = await embedAll(['estimating cattle weight from sensor readings']);

      const { index } = nearest(queryVector, corpusVectors, DIM, CORPUS.length);
      assert.equal(CORPUS[index].name, 'cattle-weight-sensor');
    }
  );

  test('vectors are L2-normalized (unit length), as semanticSearch.ts assumes for cosine-via-dot-product', { timeout: 120_000 }, async () => {
    const vectors = await embedAll(['a short piece of text', 'another, unrelated piece of text']);
    for (let i = 0; i < 2; i++) {
      let normSq = 0;
      for (let d = 0; d < DIM; d++) normSq += vectors[i * DIM + d] ** 2;
      assert.ok(Math.abs(Math.sqrt(normSq) - 1) < 1e-3, `vector ${i} should have unit norm, got ${Math.sqrt(normSq)}`);
    }
  });
});
