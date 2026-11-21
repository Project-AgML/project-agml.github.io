import { useEffect, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { normalizeCatalog } from './modelCatalog';
import type { ModelCatalog } from './modelCatalog';

export * from './modelCatalog';

const EMPTY_CATALOG: ModelCatalog = { schema_version: 1, last_updated: null, policy: null, models: [] };

export function useModelCatalog(): { data: ModelCatalog; loading: boolean; error: Error | null } {
  const url = useBaseUrl('/data/models.json');
  const [data, setData] = useState<ModelCatalog>(EMPTY_CATALOG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load the model catalog');
        return response.json();
      })
      .then((json) => {
        if (active) setData(normalizeCatalog(json));
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err : new Error('Failed to load the model catalog'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url]);

  return { data, loading, error };
}
