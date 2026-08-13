import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import type { Dataset } from './datasets';
import { MODEL_ID, DIM, ORAMA_SCHEMA, ORAMA_BOOST, buildIndexRow } from './semanticSearchIndex';
import { DTYPE as EMBEDDING_DTYPE } from './embeddingModel.mjs';

const EMBEDDINGS_META_URL = '/data/embeddings/meta.json';
const EMBEDDINGS_VECTORS_URL = '/data/embeddings/vectors.bin';

// Loaded via a runtime CDN URL rather than the npm package. @huggingface/transformers's Node
// build (picked up for Docusaurus's SSR compile) statically requires the native
// onnxruntime-node/sharp packages, which Rspack can't bundle (compiled binaries, not JS). Its
// browser build also references onnxruntime-web's WASM/worker files via
// `new URL(x, import.meta.url)`, which Rspack can't resolve either (they live in a sibling
// package's dist folder) — and Rspack's client output here doesn't fully support import.meta
// (see its own "Critical dependency" warning on this module), so even suppressing that build
// error wouldn't make WASM loading work at runtime. A literal https:// URL passed to import()
// is left untouched by bundlers and resolved by the browser at runtime instead, where
// import.meta.url is accurate — this is transformers.js's own documented "vanilla JS" loading
// pattern.
//
// Fetched via jsDelivr's `+esm` transform rather than the raw dist file: transformers.web.js
// contains a bare (non-relative) specifier — `import ... from "onnxruntime-web/webgpu"` — for
// its optional WebGPU backend. Bundlers resolve bare specifiers via node_modules, but a browser
// loading a module directly from a URL (no import map) cannot — it throws "Failed to resolve
// module specifier". `+esm` rewrites every bare import in the module graph into a
// fully-qualified jsDelivr URL (verified: `onnxruntime-web/webgpu` -> an absolute
// /npm/onnxruntime-web@.../webgpu/+esm URL), producing a self-contained, browser-loadable graph.
// Pinned to the exact version used by scripts/generate-embeddings.mjs so corpus and query
// embeddings share the same model weights (see that script's `embedAll()` comment).
const TRANSFORMERS_CDN_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

type EmbeddingsMeta = {
  model: string;
  dtype: string;
  dim: number;
  count: number;
  names: string[];
};

type SemanticEngine = {
  embedQuery: (text: string) => Promise<Float32Array>;
  search: (query: string, limit: number) => Promise<string[]>;
};

// The expensive, dataset-independent half of engine construction: loading the
// transformers/orama modules, fetching vectors.bin/meta.json, and initializing the WASM
// feature-extraction pipeline. Cached as a module-scoped singleton — it builds once per browser
// session no matter how many components call useSemanticDatasetSearch, and — because Docusaurus
// is a client-side-routed SPA — persists across route navigations. A page reload rebuilds it,
// which is fine since the underlying data is static per deploy.
type SemanticResources = {
  meta: EmbeddingsMeta;
  vectors: Float32Array;
  create: typeof import('@orama/orama').create;
  insertMultiple: typeof import('@orama/orama').insertMultiple;
  oramaSearch: typeof import('@orama/orama').search;
  embedQuery: (text: string) => Promise<Float32Array>;
};

let resourcesPromise: Promise<SemanticResources> | null = null;

async function loadResources(vectorsUrl: string, metaUrl: string): Promise<SemanticResources> {
  const [{ pipeline, env }, { create, insertMultiple, search: oramaSearch }, meta, vectorsBuffer] = await Promise.all([
    import(/* webpackIgnore: true */ TRANSFORMERS_CDN_URL) as Promise<typeof import('@huggingface/transformers')>,
    import('@orama/orama'),
    fetch(metaUrl).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${metaUrl}`);
      return r.json() as Promise<EmbeddingsMeta>;
    }),
    fetch(vectorsUrl).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${vectorsUrl}`);
      return r.arrayBuffer();
    }),
  ]);

  if (meta.model !== MODEL_ID) throw new Error(`semanticSearch: unexpected embedding model ${meta.model}`);
  if (meta.dtype !== EMBEDDING_DTYPE) throw new Error(`semanticSearch: unexpected embedding dtype ${meta.dtype}`);
  if (meta.dim !== DIM) throw new Error(`semanticSearch: unexpected embedding dimension ${meta.dim}`);
  // meta.json and vectors.bin are two independently-fetched files with no shared cache-busting —
  // this and the check below catch them drifting apart (e.g. a partially-deployed build) instead
  // of silently truncating rows/vectors in buildEngine's meta.names.map().
  if (meta.names.length !== meta.count) {
    throw new Error('semanticSearch: meta.json names.length does not match meta.json count');
  }
  const vectors = new Float32Array(vectorsBuffer);
  if (vectors.length !== meta.count * meta.dim) {
    throw new Error('semanticSearch: vectors.bin size does not match meta.json count/dim');
  }

  env.allowLocalModels = false;
  // dtype MUST match scripts/generate-embeddings.mjs's build-time dtype so query and corpus
  // vectors live in the same embedding space (Node's pipeline() default is unquantized fp32;
  // the browser WASM default is already q8, but we pass it explicitly on both sides to avoid
  // depending on that default matching by coincidence).
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: EMBEDDING_DTYPE });
  const embedQuery = async (text: string) => {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return output.data as Float32Array;
  };

  return { meta, vectors, create, insertMultiple, oramaSearch, embedQuery };
}

function getResources(vectorsUrl: string, metaUrl: string): Promise<SemanticResources> {
  if (!resourcesPromise) {
    resourcesPromise = loadResources(vectorsUrl, metaUrl).catch((err) => {
      resourcesPromise = null;
      throw err;
    });
  }
  return resourcesPromise;
}

// Rebuilds the (comparatively cheap) Orama index from the cached resources above and the
// dataset metadata available *right now*. Deliberately NOT cached keyed only on first call:
// useDatasets() can resolve with a partial dataset list if one manifest fetch fails while
// another succeeds (see loadDatasets()'s Promise.allSettled — `loadedAny` short-circuits the
// error), so an engine built from that first, incomplete `datasetsByName` must not be frozen for
// the rest of the session once fuller data becomes available (e.g. a later SPA remount whose
// fetch succeeds). Callers decide when a rebuild is warranted (see enginePromiseDatasetCount in
// useSemanticDatasetSearch below).
async function buildEngine(
  vectorsUrl: string,
  metaUrl: string,
  datasetsByName: Map<string, Dataset>
): Promise<SemanticEngine> {
  const { meta, vectors, create, insertMultiple, oramaSearch, embedQuery } = await getResources(vectorsUrl, metaUrl);

  const db = create({ schema: ORAMA_SCHEMA });
  const rows = meta.names.map((name, i) => {
    const start = i * DIM;
    return {
      ...buildIndexRow(name, datasetsByName.get(name)),
      // Must be a plain array, not the Float32Array subarray view: Orama's insert-time
      // validateSchema() (components/defaults.js) requires `Array.isArray(value)` for vector
      // fields and throws INVALID_INPUT_VECTOR otherwise — it runs before VectorIndex.add() ever
      // sees the value, so add()'s own Float32Array support (trees/vector.js) is unreachable here.
      embedding: Array.from(vectors.subarray(start, start + DIM)),
    };
  });
  await insertMultiple(db, rows, 1000);

  const search = async (query: string, limit: number) => {
    const queryVector = await embedQuery(query);
    const results = await oramaSearch(db, {
      mode: 'hybrid',
      term: query,
      vector: { value: queryVector, property: 'embedding' },
      boost: ORAMA_BOOST,
      // Orama's hybrid-search defaults (similarity: 0.8, limit: 10) are tuned for
      // higher-dimensional/fine-tuned embedding spaces than raw MiniLM cosine similarity on
      // short, differently-phrased text — 0.8 filters out most true matches here. But
      // all-MiniLM-L6-v2 cosine similarities between *unrelated* short texts commonly land in the
      // 0.2-0.3 range, so 0.3 let vector search treat most of the corpus as a "match" for any
      // query (Orama's `find()` returns everything above this threshold, uncapped) — for a query
      // with no keyword overlap, that surfaced almost the entire corpus, just reordered, instead
      // of narrowing results. 0.5 is a starting point to tune empirically against real queries.
      similarity: 0.5,
      // Must exceed the corpus size: callers intersect this ranking with arbitrary structured
      // field filters, so a low-ranked-but-filter-matching result must not be silently dropped
      // by the default limit of 10.
      limit,
    });
    return results.hits.map((hit) => (hit.document as { name: string }).name);
  };

  return { embedQuery, search };
}

export type SemanticSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

// Module-scoped cache for the Orama index engine (see buildEngine's comment for why it's keyed
// on dataset count rather than built exactly once): shared across mounts/route navigations like
// resourcesPromise above, but invalidated whenever a hook instance shows up with more dataset
// data than whatever built the cached engine.
let enginePromise: Promise<SemanticEngine> | null = null;
let enginePromiseDatasetCount = 0;

export function useSemanticDatasetSearch(datasets: Dataset[]) {
  const vectorsUrl = useBaseUrl(EMBEDDINGS_VECTORS_URL);
  const metaUrl = useBaseUrl(EMBEDDINGS_META_URL);
  const [status, setStatus] = useState<SemanticSearchStatus>('idle');
  const engineRef = useRef<SemanticEngine | null>(null);
  const requestIdRef = useRef(0);
  const datasetsByName = useMemo(() => new Map(datasets.map((d) => [d.name, d])), [datasets]);
  // Set as soon as the user shows intent (onFocus), even if datasets.json/hf_datasets.json
  // haven't finished loading yet — a text input only fires onFocus once per focus session, so
  // without this, focusing before that fetch resolves would silently drop the request forever
  // (activate() below bails while datasetsByName is still empty, and nothing would ever retry).
  const wantsActivationRef = useRef(false);
  // Per-mount guard: the dataset count *this* hook instance last attached its engineRef/status
  // to (0 = not attached). Needed because enginePromise is a module-scoped singleton shared
  // across mounts (see its declaration above) — on a remount (e.g. Docusaurus SPA nav away and
  // back), this ref resets to 0, but a prior mount may have already resolved enginePromise.
  // Without this, activate() would bail on `enginePromise` already being truthy and never call
  // .then() for the new instance, leaving its engineRef/status stuck at null/'idle' forever.
  // Tracking a count (not just a boolean) additionally lets a later mount whose datasetsByName
  // is larger than enginePromiseDatasetCount force a rebuild instead of silently attaching to a
  // stale, incomplete index (see buildEngine's comment).
  const attachedCountRef = useRef(0);

  const activate = useCallback(() => {
    wantsActivationRef.current = true;
    if (datasetsByName.size === 0 || attachedCountRef.current >= datasetsByName.size) return;
    if (!enginePromise || enginePromiseDatasetCount < datasetsByName.size) {
      enginePromise = buildEngine(vectorsUrl, metaUrl, datasetsByName);
      enginePromiseDatasetCount = datasetsByName.size;
    }
    attachedCountRef.current = datasetsByName.size;
    setStatus('loading');
    const thisPromise = enginePromise;
    thisPromise.then(
      (engine) => {
        engineRef.current = engine;
        setStatus('ready');
      },
      (err) => {
        // Progressive enhancement only — substring search remains fully functional without
        // this engine, so failures (e.g. CDN unreachable) are logged, not surfaced to the user.
        console.warn('[semanticSearch] initialization failed, falling back to substring search', err);
        // Only the mount whose build actually failed clears the singleton (a concurrent mount
        // may have already started a fresh one via retry) — and allow this mount to retry too.
        if (enginePromise === thisPromise) {
          enginePromise = null;
          enginePromiseDatasetCount = 0;
        }
        attachedCountRef.current = 0;
        setStatus('error');
      }
    );
  }, [vectorsUrl, metaUrl, datasetsByName]);

  // Retries activation once real dataset metadata becomes available, in case the user focused
  // the search box before useDatasets()'s fetch resolved.
  useEffect(() => {
    if (wantsActivationRef.current) activate();
  }, [activate]);

  // Returns ranked dataset names for the full corpus (not just top-N) so callers can intersect
  // with structured field filters without losing valid lower-ranked matches.
  const search = useCallback(
    async (query: string): Promise<string[] | null> => {
      const engine = engineRef.current;
      const trimmed = query.trim();
      if (!engine || !trimmed) return null;
      const myRequestId = ++requestIdRef.current;
      let names: string[];
      try {
        names = await engine.search(trimmed, datasetsByName.size || 10000);
      } catch (err) {
        // Progressive enhancement only, same as activate()'s failure path above — callers fall
        // back to substring search rather than seeing an unhandled rejection.
        console.warn('[semanticSearch] search failed, falling back to substring search', err);
        return null;
      }
      if (myRequestId !== requestIdRef.current) return null; // superseded by a newer query
      return names;
    },
    [datasetsByName]
  );

  return { status, activate, search };
}
