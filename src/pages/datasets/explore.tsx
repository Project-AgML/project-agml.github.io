import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useIsBrowser from '@docusaurus/useIsBrowser';
import { useHistory, useLocation } from '@docusaurus/router';
import { DatasetCard } from '../../components/DatasetCard';
import cardStyles from '../../components/DatasetCard.module.css';
import { DatasetMetadataModal } from '../../components/DatasetMetadataModal';
import { DatasetMap } from '../../components/DatasetMap';
import { TaxonomyAbout } from '../../components/TaxonomyAbout';
import { TaxonomyTreeDiagram } from '../../components/TaxonomyTreeDiagram';
import { isChildDataset, useDatasets, type Dataset } from '../../lib/datasets';
import { datasetIso3s, decodeCountries, ISO3_NAME, type CountryShapes } from '../../lib/geo';
import {
  ancestorsOf,
  buildTree,
  resolveDatasets,
  searchTree,
  TREE_KINDS,
  type CropTaxonomy,
  type INatAgTaxa,
  type TaxonomyDatasetInput,
  type TaxonomyTree,
  type TreeKind,
  type TreeNode,
} from '../../lib/taxonomy';
import styles from './explore.module.css';

const TREE_PARAM = 'tree';
const NODE_PARAM = 'node';
const SEARCH_PARAM = 'q';
const INAT_PARAM = 'inat';
const VIEW_PARAM = 'view';
const COUNTRY_PARAM = 'country';

type DetailView = 'tree' | 'map';

// A family like Poaceae has hundreds of genera once iNatAg is included; show the biggest first and
// let the user expand the rest.
const CHILD_PAGE = 40;
// Cap on rows rendered for a broad search ("a" matches nearly everything).
const MAX_SEARCH_ROWS = 300;
const CARD_PAGE = 24;

function useTaxonomyData() {
  const taxonomyUrl = useBaseUrl('/data/taxonomy/crop_taxonomy.json');
  const inatUrl = useBaseUrl('/data/taxonomy/inatag_taxa.json');
  const [state, setState] = useState<{ taxonomy: CropTaxonomy | null; inatag: INatAgTaxa | null; error: Error | null }>({
    taxonomy: null,
    inatag: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    const load = (url: string) =>
      fetch(url).then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${url}`);
        return response.json();
      });
    Promise.all([load(taxonomyUrl), load(inatUrl)])
      .then(([taxonomy, inatag]) => active && setState({ taxonomy, inatag, error: null }))
      .catch((error) => active && setState({ taxonomy: null, inatag: null, error }));
    return () => {
      active = false;
    };
  }, [taxonomyUrl, inatUrl]);

  return state;
}

// Country boundaries for the map: decoded once for the coordinate checks, and handed to Plotly via
// its PlotlyGeoAssets global so it doesn't fetch the same file a second time.
function useCountryShapes(): { shapes: CountryShapes | null; error: Error | null } {
  const url = useBaseUrl('/data/geo/world_110m.json');
  const [state, setState] = useState<{ shapes: CountryShapes | null; error: Error | null }>({ shapes: null, error: null });
  useEffect(() => {
    let active = true;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${url}`);
        return response.json();
      })
      .then((topology) => {
        const assets = ((window as unknown as { PlotlyGeoAssets?: { topojson: Record<string, unknown> } }).PlotlyGeoAssets ??= {
          topojson: {},
        });
        assets.topojson.world_110m ??= topology;
        if (active) setState({ shapes: decodeCountries(topology), error: null });
      })
      .catch((error) => active && setState({ shapes: null, error }));
    return () => {
      active = false;
    };
  }, [url]);
  return state;
}

type Row = { node: TreeNode; depth: number } | { more: TreeNode; hidden: number; depth: number };

function TreeRows({
  tree,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  search,
  showAll,
  onShowAll,
}: {
  tree: TaxonomyTree;
  selectedId: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  search: { visible: Set<string>; matches: Set<string> } | null;
  showAll: Set<string>;
  onShowAll: (id: string) => void;
}) {
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (node: TreeNode, depth: number) => {
      let children = search ? node.children.filter((child) => search.visible.has(child.id)) : node.children;
      const limit = showAll.has(node.id) || search ? children.length : CHILD_PAGE;
      const hidden = children.length - limit;
      children = children.slice(0, limit);
      for (const child of children) {
        if (search && out.length >= MAX_SEARCH_ROWS) return;
        out.push({ node: child, depth });
        const open = search ? child.children.some((c) => search.visible.has(c.id)) : expanded.has(child.id);
        if (open) walk(child, depth + 1);
      }
      if (hidden > 0) out.push({ more: node, hidden, depth });
    };
    walk(tree.root, 0);
    return out;
  }, [tree, expanded, search, showAll]);

  if (search && rows.length === 0) {
    return <p className={styles.treeEmpty}>No plants match this search in the current tree.</p>;
  }

  return (
    <ul className={styles.tree} role="tree" aria-label="Taxonomy">
      {rows.map((row) => {
        if ('more' in row) {
          return (
            <li key={`${row.more.id}#more`} className={styles.treeRow} style={{ paddingLeft: `${row.depth * 1.1 + 1.6}rem` }}>
              <button type="button" className={styles.moreButton} onClick={() => onShowAll(row.more.id)}>
                Show {row.hidden} more…
              </button>
            </li>
          );
        }
        const { node, depth } = row;
        const hasChildren = node.children.length > 0;
        const isOpen = search ? hasChildren && node.children.some((c) => search.visible.has(c.id)) : expanded.has(node.id);
        const selected = node.id === selectedId;
        const isMatch = search?.matches.has(node.id);
        return (
          <li
            key={node.id}
            role="treeitem"
            aria-selected={selected}
            aria-expanded={hasChildren ? isOpen : undefined}
            className={`${styles.treeRow} ${selected ? styles.treeRowSelected : ''}`}
            style={{ paddingLeft: `${depth * 1.1}rem` }}
          >
            {hasChildren ? (
              <button
                type="button"
                className={styles.chevron}
                aria-label={isOpen ? `Collapse ${node.label}` : `Expand ${node.label}`}
                onClick={() => onToggle(node.id)}
                disabled={Boolean(search)}
              >
                <span className={isOpen ? styles.chevronOpen : undefined}>›</span>
              </button>
            ) : (
              <span className={styles.chevronSpacer} />
            )}
            <button type="button" className={styles.nodeButton} onClick={() => onSelect(node.id)}>
              <span className={`${styles.nodeLabel} ${isMatch ? styles.nodeMatch : ''}`}>
                {node.label}
                {node.scientific && <em className={styles.nodeScientific}> {node.scientific}</em>}
              </span>
              <span className={styles.nodeCount}>{node.datasets.size}</span>
            </button>
          </li>
        );
      })}
      {search && rows.length >= MAX_SEARCH_ROWS && (
        <li className={styles.treeEmpty}>Showing the first {MAX_SEARCH_ROWS} rows — refine the search to see more.</li>
      )}
    </ul>
  );
}

function NodeDetail({
  node,
  datasets,
  onSelectNode,
  onOpenDataset,
  view,
  onViewChange,
  shapes,
  geoError,
  country,
  onCountryChange,
}: {
  node: TreeNode;
  datasets: Map<string, Dataset>;
  onSelectNode: (id: string) => void;
  onOpenDataset: (name: string, trigger?: HTMLButtonElement) => void;
  view: DetailView;
  onViewChange: (view: DetailView) => void;
  shapes: CountryShapes | null;
  geoError: Error | null;
  country: string | null;
  onCountryChange: (iso3: string | null) => void;
}) {
  const [showCount, setShowCount] = useState(CARD_PAGE);
  useEffect(() => setShowCount(CARD_PAGE), [node.id, country]);

  const nodeDatasets = useMemo(
    () =>
      Array.from(node.datasets)
        .map((name) => datasets.get(name))
        .filter((d): d is Dataset => d != null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [node, datasets]
  );

  const shownDatasets = useMemo(
    () => (country ? nodeDatasets.filter((d) => datasetIso3s(d.country).includes(country)) : nodeDatasets),
    [nodeDatasets, country]
  );

  // A leaf has no structure to draw, so it always shows the map.
  const hasTree = node.children.length > 0;
  const activeView: DetailView = hasTree ? view : 'map';

  const crumbs = ancestorsOf(node);
  const labels = Array.from(node.labels).sort();

  return (
    <div className={styles.detail}>
      <nav className={styles.breadcrumbs} aria-label="Tree position">
        {crumbs.map((crumb) => (
          <span key={crumb.id || 'root'}>
            <button type="button" className={styles.crumb} onClick={() => onSelectNode(crumb.id)}>
              {crumb.label}
            </button>
            <span className={styles.crumbSep}>›</span>
          </span>
        ))}
      </nav>

      <header className={styles.detailHeader}>
        <div>
          <p className={styles.levelChip}>{node.level}</p>
          <h2 className={styles.detailTitle}>
            {node.label}
            {node.scientific && <em className={styles.detailScientific}> {node.scientific}</em>}
          </h2>
        </div>
        <p className={styles.detailCount}>
          <strong>{node.datasets.size.toLocaleString()}</strong> {node.datasets.size === 1 ? 'dataset' : 'datasets'}
        </p>
      </header>

      {labels.length > 0 && (
        <div className={styles.labelBlock}>
          <span className={styles.labelBlockTitle}>Catalog labels mapped here</span>
          <div className={styles.labelList}>
            {labels.map((label) => (
              <Link key={label} className={styles.labelLink} to={`/datasets?crop_types=${encodeURIComponent(label)}`}>
                {label}
              </Link>
            ))}
          </div>
          {Array.from(node.reviewNotes).map(([label, note]) => (
            <p key={label} className={styles.reviewNote}>
              <span aria-hidden="true">⚠</span> Uncertain identification for “{label}”: {note}
            </p>
          ))}
        </div>
      )}

      <section className={styles.chartSection}>
        <div className={styles.viewSwitch} role="tablist" aria-label="Visualization">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'tree'}
            disabled={!hasTree}
            className={`${styles.viewTab} ${activeView === 'tree' ? styles.viewTabActive : ''}`}
            onClick={() => onViewChange('tree')}
          >
            Tree
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'map'}
            className={`${styles.viewTab} ${activeView === 'map' ? styles.viewTabActive : ''}`}
            onClick={() => onViewChange('map')}
          >
            Map
          </button>
        </div>
        {activeView === 'tree' ? (
          <TaxonomyTreeDiagram root={node} onSelect={onSelectNode} />
        ) : geoError ? (
          <p className={styles.sectionHint}>Map unavailable: {geoError.message}</p>
        ) : !shapes ? (
          <p className={styles.sectionHint}>Loading map…</p>
        ) : (
          <DatasetMap
            datasets={nodeDatasets}
            shapes={shapes}
            selectedCountry={country}
            onSelectCountry={onCountryChange}
            onOpenDataset={(name) => onOpenDataset(name)}
          />
        )}
      </section>

      <section>
        <div className={styles.datasetsHeader}>
          <h3 className={styles.sectionTitle}>Datasets</h3>
          {country && (
            <span className={styles.countryChip}>
              In {ISO3_NAME[country] ?? country} · {shownDatasets.length} of {nodeDatasets.length}
              <button type="button" aria-label="Clear country filter" onClick={() => onCountryChange(null)}>
                ×
              </button>
            </span>
          )}
        </div>
        {shownDatasets.length === 0 ? (
          <p className={styles.sectionHint}>
            {country ? `None of these datasets list ${ISO3_NAME[country] ?? country}.` : 'No datasets.'}
          </p>
        ) : (
          <div className={cardStyles.cardGrid}>
            {shownDatasets.slice(0, showCount).map((dataset) => (
              <DatasetCard key={dataset.name} dataset={dataset} onOpen={(trigger) => onOpenDataset(dataset.name, trigger)} />
            ))}
          </div>
        )}
        {shownDatasets.length > showCount && (
          <div className={styles.loadMore}>
            <button type="button" className={styles.loadMoreButton} onClick={() => setShowCount((n) => n + CARD_PAGE)}>
              Show more ({shownDatasets.length - showCount} left)
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function DatasetExplorePage() {
  const location = useLocation();
  const history = useHistory();
  const { data, loading, error } = useDatasets();
  const { taxonomy, inatag, error: taxonomyError } = useTaxonomyData();
  const { shapes, error: geoError } = useCountryShapes();

  // The static HTML is rendered without a query string. Reading the URL only after hydration keeps
  // the first client render identical to it; otherwise React 19 keeps the server's attributes on
  // mismatch (e.g. the default tab stays highlighted while another tree's content shows).
  const isBrowser = useIsBrowser();
  const params = useMemo(() => new URLSearchParams(isBrowser ? location.search : ''), [isBrowser, location.search]);
  const kindParam = params.get(TREE_PARAM);
  const kind: TreeKind = TREE_KINDS.some((t) => t.kind === kindParam) ? (kindParam as TreeKind) : 'role';
  const nodeId = params.get(NODE_PARAM) ?? '';
  const includeINatAg = params.get(INAT_PARAM) !== '0';
  const view: DetailView = params.get(VIEW_PARAM) === 'map' ? 'map' : 'tree';
  const country = params.get(COUNTRY_PARAM);
  const searchParam = params.get(SEARCH_PARAM) ?? '';
  const [searchLocal, setSearchLocal] = useState(searchParam);
  useEffect(() => setSearchLocal(searchParam), [searchParam]);

  const updateParams = useCallback(
    (mutate: (next: URLSearchParams) => void, push = false) => {
      const next = new URLSearchParams(location.search);
      mutate(next);
      const search = next.toString();
      const target = { ...location, search: search ? `?${search}` : '' };
      if (push) history.push(target);
      else history.replace(target);
    },
    [history, location]
  );

  useEffect(() => {
    if (searchLocal === searchParam) return;
    const timeout = setTimeout(
      () => updateParams((next) => (searchLocal ? next.set(SEARCH_PARAM, searchLocal) : next.delete(SEARCH_PARAM))),
      200
    );
    return () => clearTimeout(timeout);
  }, [searchLocal, searchParam, updateParams]);

  const datasetsByName = useMemo(() => new Map(data.map((d) => [d.name, d])), [data]);

  const resolved = useMemo(() => {
    if (!taxonomy || data.length === 0) return null;
    const childSpecies = new Map<string, string[]>();
    for (const dataset of data) {
      if (!isChildDataset(dataset)) continue;
      const slug = dataset.name.split('/').pop();
      if (!slug) continue;
      const list = childSpecies.get(dataset.parent_dataset!) ?? [];
      list.push(slug);
      childSpecies.set(dataset.parent_dataset!, list);
    }
    const inputs: TaxonomyDatasetInput[] = data
      .filter((dataset) => !isChildDataset(dataset))
      .map((dataset) => ({ name: dataset.name, crop_types: dataset.crop_types, childSpecies: childSpecies.get(dataset.name) }));
    return resolveDatasets(inputs, taxonomy, inatag);
  }, [data, taxonomy, inatag]);

  const tree = useMemo(
    () => (resolved && taxonomy ? buildTree(kind, resolved.resolved, taxonomy, { includeINatAg }) : null),
    [resolved, taxonomy, kind, includeINatAg]
  );

  const selected = tree?.byId.get(nodeId) ?? tree?.root ?? null;
  const search = useMemo(() => (tree ? searchTree(tree, searchParam) : null), [tree, searchParam]);

  // Expansion is local UI state, but the path to the selected node is always open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded(new Set());
    setShowAll(new Set());
  }, [kind]);
  useEffect(() => {
    if (!selected) return;
    const ids = ancestorsOf(selected).map((n) => n.id).filter(Boolean);
    if (ids.length === 0) return;
    setExpanded((prev) => (ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, [selected]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectNode = useCallback(
    (id: string) => {
      const node = tree?.byId.get(id);
      if (node && node.children.length > 0) setExpanded((prev) => new Set([...prev, id]));
      updateParams((next) => (id ? next.set(NODE_PARAM, id) : next.delete(NODE_PARAM)), true);
    },
    [tree, updateParams]
  );

  const setKind = (next: TreeKind) =>
    updateParams((p) => {
      p.set(TREE_PARAM, next);
      p.delete(NODE_PARAM);
    }, true);

  // Dataset modal (same behavior as the search page).
  const [openName, setOpenName] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const openDataset = useCallback((name: string, trigger?: HTMLButtonElement) => {
    triggerRef.current = trigger ?? null;
    setOpenName(name);
  }, []);
  const closeDataset = useCallback(() => {
    setOpenName(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, []);
  const openDatasetRecord = openName ? datasetsByName.get(openName) ?? null : null;

  const loadError = error ?? taxonomyError;

  return (
    <Layout title="Explore Datasets" description="Browse AgML datasets by plant role, crop group, and botanical family.">
      <div className={styles.page}>
        <DatasetMetadataModal dataset={openDatasetRecord} open={openDatasetRecord != null} onClose={closeDataset} />

        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label="Taxonomy">
            {TREE_KINDS.map((t) => (
              <button
                key={t.kind}
                type="button"
                role="tab"
                aria-selected={t.kind === kind}
                title={t.description}
                className={`${styles.tab} ${t.kind === kind ? styles.tabActive : ''}`}
                onClick={() => setKind(t.kind)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="find a plant: pigeon pea, Cajanus, Solanaceae…"
            aria-label="Search the taxonomy"
            value={searchLocal}
            onChange={(event) => setSearchLocal(event.target.value)}
          />
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={includeINatAg}
              onChange={(event) => updateParams((p) => (event.target.checked ? p.delete(INAT_PARAM) : p.set(INAT_PARAM, '0')))}
            />
            Include iNatAg species
          </label>
          <Link className={styles.backLink} to="/datasets">
            Dataset search →
          </Link>
        </div>

        <TaxonomyAbout kind={kind} taxonomy={taxonomy} inatagSpecies={inatag ? Object.keys(inatag).length : 0} />

        {loadError && <p className={styles.status}>Error: {loadError.message}</p>}
        {!loadError && (loading || !tree || !selected) && <p className={styles.status}>Loading taxonomy…</p>}

        {!loadError && tree && selected && (
          <div className={styles.body}>
            <aside className={styles.treePanel}>
              {search && (
                <p className={styles.searchSummary}>
                  {search.matches.size.toLocaleString()} {search.matches.size === 1 ? 'match' : 'matches'}
                </p>
              )}
              <button
                type="button"
                className={`${styles.rootRow} ${selected === tree.root ? styles.treeRowSelected : ''}`}
                onClick={() => selectNode('')}
              >
                <span>All datasets</span>
                <span className={styles.nodeCount}>{tree.root.datasets.size}</span>
              </button>
              <TreeRows
                tree={tree}
                selectedId={selected.id}
                expanded={expanded}
                onToggle={toggle}
                onSelect={selectNode}
                search={search}
                showAll={showAll}
                onShowAll={(id) => setShowAll((prev) => new Set([...prev, id]))}
              />
            </aside>
            <section className={styles.detailPanel}>
              <NodeDetail
                node={selected}
                datasets={datasetsByName}
                onSelectNode={selectNode}
                onOpenDataset={openDataset}
                view={view}
                onViewChange={(next) => updateParams((p) => (next === 'map' ? p.set(VIEW_PARAM, 'map') : p.delete(VIEW_PARAM)))}
                shapes={shapes}
                geoError={geoError}
                country={country}
                onCountryChange={(iso) => updateParams((p) => (iso ? p.set(COUNTRY_PARAM, iso) : p.delete(COUNTRY_PARAM)))}
              />
            </section>
          </div>
        )}
      </div>
    </Layout>
  );
}
