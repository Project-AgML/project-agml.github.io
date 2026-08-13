// Single source of truth for the embedding model identity, shared between the build-time
// corpus embedder (scripts/generate-embeddings.mjs) and the client-side query embedder
// (src/lib/semanticSearch.ts via semanticSearchIndex.ts). Corpus and query vectors must be
// produced by the exact same model/dtype to live in the same embedding space — keeping this
// in one file (instead of duplicated literals) means a model change can't update one side
// without the other.
export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const DIM = 384;
export const DTYPE = 'q8';
