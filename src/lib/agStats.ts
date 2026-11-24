import { useEffect, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

// Types and loaders for the Ag Stats page. The JSON files under static/data/ag_stats/ are
// written by scripts/generate_ag_stats.py from the `agml.ag_stats` loaders.

export type AgStatsSourceId = 'nass' | 'calicropyield';

export interface AgStatsSource {
  id: AgStatsSourceId;
  name: string;
  module: string;
  loader: string;
  install: string;
  hf_repo: string;
  region: string;
  license: string;
  paper: string | null;
  viewer: string | null;
  description: string;
  years: [number, number];
  rows: number;
  crops: number;
  places: { states?: number; counties?: number };
  items: number;
}

export interface AgStatsColumn {
  name: string;
  type: string;
}

export interface AgStatsEntry {
  id: string;
  source: AgStatsSourceId;
  name: string;
  title: string;
  kind: 'Table' | 'Raster' | 'Zarr';
  format: string;
  description: string;
  spatial_levels: string[];
  resolution: string | null;
  time_step: string;
  years: [number, number];
  missing_years: number[];
  rows: number | null;
  files: number | null;
  crops: number | null;
  columns: AgStatsColumn[];
  method: string;
  snippet: string;
}

export interface AgStatsCatalog {
  generated: string;
  sources: AgStatsSource[];
  entries: AgStatsEntry[];
}

// One point is [year, value in the native NASS unit, value in t/ha or null].
export type NassPoint = [number, number, number | null];

export interface NassYieldCrop {
  id: string;
  label: string;
  // Loader arguments that select exactly this series, e.g. `crop="corn", utilization="grain"`.
  query: string;
  unit: string;
  // Keyed by "US" for the national series, otherwise by state postal code.
  series: Record<string, NassPoint[]>;
}

export interface NassYieldData {
  generated: string;
  states: Record<string, string>;
  crops: NassYieldCrop[];
}

export interface CaliYieldData {
  generated: string;
  counties: string[];
  crops: string[];
  // One row is [county index, crop index, year, yield in t/ha].
  rows: [number, number, number, number][];
}

// Python import line and loader construction for each source, shared by every snippet.
export const SOURCE_SETUP: Record<AgStatsSourceId, string> = {
  nass: 'from agml.ag_stats.nass import NASSDataLoader\n\nnass = NASSDataLoader()',
  calicropyield: 'from agml.ag_stats.calicropyield import CaliCropYieldLoader\n\ncali = CaliCropYieldLoader()',
};

export const SOURCE_SHORT_LABEL: Record<AgStatsSourceId, string> = {
  nass: 'USDA NASS',
  calicropyield: 'California',
};

export const SOURCE_DOC_PATH: Record<AgStatsSourceId, string> = {
  nass: '/docs/ag-stats/nass',
  calicropyield: '/docs/ag-stats/calicropyield',
};

export function fullSnippet(entry: AgStatsEntry): string {
  return `${SOURCE_SETUP[entry.source]}\n${entry.snippet}`;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString();
}

export function formatYears(entry: Pick<AgStatsEntry, 'years'>): string {
  const [start, end] = entry.years;
  return start === end ? String(start) : `${start}–${end}`;
}

function useJson<T>(path: string): { data: T | null; loading: boolean; error: Error | null } {
  const url = useBaseUrl(path);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${path}`);
        return response.json();
      })
      .then((json: T) => {
        if (active) setData(json);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err : new Error(`Failed to load ${path}`));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, path]);

  return { data, loading, error };
}

export function useAgStatsCatalog() {
  return useJson<AgStatsCatalog>('/data/ag_stats/catalog.json');
}

export function useNassYield() {
  return useJson<NassYieldData>('/data/ag_stats/nass_yield.json');
}

export function useCaliYield() {
  return useJson<CaliYieldData>('/data/ag_stats/cali_yield.json');
}
