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

// Module-scoped singleton: the model + WASM runtime + Orama index build once per browser
// session no matter how many components call useSemanticDatasetSearch, and — because
// Docusaurus is a client-side-routed SPA — persist across route navigations. A page reload
// rebuilds it, which is fine since the underlying data is static per deploy.
let enginePromise: Promise<SemanticEngine> | null = null;

async function buildEngine(
  vectorsUrl: string,
  metaUrl: string,
  datasetsByName: Map<string, Dataset>
): Promise<SemanticEngine> {
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

  const db = create({ schema: ORAMA_SCHEMA });
  const rows = meta.names.map((name, i) => {
    const start = i * DIM;
    return {
      ...buildIndexRow(name, datasetsByName.get(name)),
      embedding: Array.from(vectors.subarray(start, start + DIM)),
    };
  });
  await insertMultiple(db, rows, 1000);

  const embedQuery = async (text: string) => {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return output.data as Float32Array;
  };

  const search = async (query: string, limit: number) => {
    const queryVector = await embedQuery(query);
    const results = await oramaSearch(db, {
      mode: 'hybrid',
      term: query,
      vector: { value: queryVector, property: 'embedding' },
      boost: ORAMA_BOOST,
      // Orama's hybrid-search defaults (similarity: 0.8, limit: 10) are tuned for
      // higher-dimensional/fine-tuned embedding spaces than raw MiniLM cosine similarity on
      // short, differently-phrased text — 0.8 filters out most true matches here. 0.3 is a
      // starting point to tune empirically against real queries.
      similarity: 0.3,
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
  // Per-mount guard: whether *this* hook instance has attached its engineRef/status to
  // enginePromise yet. Needed because enginePromise is a module-scoped singleton shared across
  // mounts (see its declaration above) — on a remount (e.g. Docusaurus SPA nav away and back),
  // engineRef/wantsActivationRef/attachedRef all reset to their initial values, but a prior
  // mount may have already resolved enginePromise. Without this, activate() would bail on
  // `enginePromise` already being truthy and never call .then() for the new instance, leaving
  // its engineRef/status stuck at null/'idle' forever.
  const attachedRef = useRef(false);

  const activate = useCallback(() => {
    wantsActivationRef.current = true;
    if (attachedRef.current || datasetsByName.size === 0) return;
    if (!enginePromise) {
      enginePromise = buildEngine(vectorsUrl, metaUrl, datasetsByName);
    }
    attachedRef.current = true;
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
        if (enginePromise === thisPromise) enginePromise = null;
        attachedRef.current = false;
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
      const names = await engine.search(trimmed, datasetsByName.size || 10000);
      if (myRequestId !== requestIdRef.current) return null; // superseded by a newer query
      return names;
    },
    [datasetsByName]
  );

  return { status, activate, search };
}
