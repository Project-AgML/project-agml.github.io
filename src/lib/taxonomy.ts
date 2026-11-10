// Plant taxonomy trees for the dataset explorer (/datasets/explore).
//
// The catalog's `crop_types` labels are free text — synonyms ("pigeonpea" / "arhar" / "red gram"),
// cultivars ("fuji apple"), local names, group tags ("fruits") and noise. The curated table in
// static/data/taxonomy/crop_taxonomy.json maps every label to a taxon (plus optional cultivar,
// role/use-group overrides, review flag). This module resolves each dataset's labels against that
// table and builds three browsable trees over the result:
//
//   role       Plant role → family → species → cultivar
//   group      Crop use group → species → cultivar   (crops only; a species can sit in several groups)
//   botanical  Family → genus → species → cultivar   (includes iNatAg's 2,958 species)
//
// Every node stores the *set* of datasets beneath it, so counts are distinct datasets — a node's
// count is generally not the sum of its children's (a multi-crop dataset appears under several
// children, and soybean sits under both Oilseeds and Legumes).
//
// Kept free of React/Docusaurus imports so it can be unit-tested directly (tests/taxonomy.test.ts).

export type TreeKind = 'role' | 'group' | 'botanical';

export interface TaxonEntry {
  common: string;
  rank: 'species' | 'genus' | 'subfamily' | 'family';
  family: string;
  role: string;
  groups?: string[];
}

export interface LabelEntry {
  taxon?: string;
  cultivar?: string;
  role?: string;
  groups?: string[];
  review?: boolean;
  unresolved?: boolean;
  note?: string;
}

export interface CropTaxonomy {
  roles: Record<string, string>;
  use_groups: Record<string, string>;
  taxa: Record<string, TaxonEntry>;
  labels: Record<string, LabelEntry>;
}

// slug ("zea_mays") -> [family, common-name search terms]
export type INatAgTaxa = Record<string, [string, string]>;

// The minimal slice of a Dataset the trees need. `childSpecies` holds the species slugs of the
// dataset's child variants (iNatAg/<slug>), which the caller collects.
export interface TaxonomyDatasetInput {
  name: string;
  crop_types: string[] | null;
  childSpecies?: string[];
}

export interface TreeNode {
  id: string;
  label: string;
  // Scientific name shown beside a common-name label (species/genus nodes).
  scientific?: string;
  // What this level of the tree is ("Family", "Genus", ...), for chart titles and breadcrumbs.
  level: string;
  // What this node's children are, e.g. "Genus" for a family node.
  childLevel?: string;
  children: TreeNode[];
  datasets: Set<string>;
  // Raw catalog labels that resolved onto this node (for transparency in the detail panel).
  labels: Set<string>;
  // Notes on uncertain identifications among those labels.
  reviewNotes: Map<string, string>;
  // Lowercased text matched by the explorer's search box.
  searchText: string;
  parent?: TreeNode;
}

export const TREE_KINDS: { kind: TreeKind; label: string; description: string }[] = [
  {
    kind: 'role',
    label: 'Plant role',
    description: 'Crops, weeds, trees, medicinal plants and more, then by family and species.',
  },
  {
    kind: 'group',
    label: 'Crop group',
    description: 'Crops by use (cereals, legumes, fruit & nuts…). A crop can belong to more than one group.',
  },
  {
    kind: 'botanical',
    label: 'Botanical',
    description: 'Family → genus → species for every plant, including iNatAg’s 2,958 species.',
  },
];

const UNRESOLVED_ID = 'unresolved';
const UNLABELED_ID = 'unlabeled';

// Taxon names are matched across sources by lowercasing and dropping the hybrid sign, so
// "Fragaria × ananassa" (curated) meets "fragaria_ananassa" (iNatAg slug).
export function normalizeTaxonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/×/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

// One resolved plant reference within a dataset.
interface Hit {
  label: string | null; // raw catalog label; null for iNatAg child species
  taxonKey: string | null; // key into taxonomy.taxa, when known
  scientific: string | null; // scientific name (curated key or iNatAg species)
  common: string | null;
  rank: TaxonEntry['rank'] | null;
  family: string | null;
  cultivar: string | null;
  role: string | null;
  groups: string[];
  review: boolean;
  note: string | null;
  unresolved: boolean;
  extraSearch: string;
}

export interface ResolvedDataset {
  name: string;
  hits: Hit[];
}

export function resolveDatasets(
  datasets: TaxonomyDatasetInput[],
  taxonomy: CropTaxonomy,
  inatag: INatAgTaxa | null,
): { resolved: ResolvedDataset[]; unmappedLabels: string[] } {
  const taxaByNormalized = new Map<string, string>();
  for (const key of Object.keys(taxonomy.taxa)) taxaByNormalized.set(normalizeTaxonName(key), key);
  const unmapped = new Set<string>();

  const fromTaxon = (taxonKey: string): Omit<Hit, 'label' | 'cultivar' | 'review' | 'note' | 'unresolved' | 'extraSearch'> => {
    const taxon = taxonomy.taxa[taxonKey];
    return {
      taxonKey,
      scientific: taxonKey,
      common: taxon.common,
      rank: taxon.rank,
      family: taxon.family,
      role: taxon.role,
      groups: taxon.groups ?? [],
    };
  };

  const resolved = datasets.map((dataset) => {
    const hits: Hit[] = [];
    for (const raw of dataset.crop_types ?? []) {
      const label = raw.trim().toLowerCase();
      if (!label) continue;
      const entry = taxonomy.labels[label];
      if (!entry) {
        unmapped.add(label);
        hits.push({
          label, taxonKey: null, scientific: null, common: null, rank: null, family: null, cultivar: null,
          role: null, groups: [], review: false, note: 'Not yet in the taxonomy table', unresolved: true, extraSearch: '',
        });
        continue;
      }
      const base = entry.taxon && taxonomy.taxa[entry.taxon]
        ? fromTaxon(entry.taxon)
        : { taxonKey: null, scientific: null, common: null, rank: null, family: null, role: null, groups: [] as string[] };
      hits.push({
        ...base,
        label,
        cultivar: entry.cultivar ?? null,
        role: entry.role ?? base.role,
        groups: entry.groups ?? base.groups,
        review: Boolean(entry.review),
        note: entry.note ?? null,
        unresolved: Boolean(entry.unresolved),
        extraSearch: '',
      });
    }

    for (const slug of dataset.childSpecies ?? []) {
      const scientific = capitalize(slug.replace(/_/g, ' '));
      const curatedKey = taxaByNormalized.get(normalizeTaxonName(slug));
      const inat = inatag?.[slug];
      if (curatedKey) {
        hits.push({
          ...fromTaxon(curatedKey),
          label: null, cultivar: null, review: false, note: null, unresolved: false,
          extraSearch: inat?.[1] ?? '',
        });
      } else {
        // iNatAg-only species carry no role or use group — they only appear in the botanical tree.
        hits.push({
          label: null, taxonKey: null, scientific, common: null, rank: 'species',
          family: inat?.[0] ?? null, cultivar: null, role: null, groups: [], review: false, note: null,
          unresolved: false, extraSearch: inat?.[1] ?? '',
        });
      }
    }
    return { name: dataset.name, hits };
  });

  return { resolved, unmappedLabels: Array.from(unmapped).sort() };
}

// ------------------------------------------------------------------------------------------------
// Tree building
// ------------------------------------------------------------------------------------------------

interface PathStep {
  key: string;
  label: string;
  level: string;
  scientific?: string;
  search?: string;
}

function makeNode(id: string, step: Omit<PathStep, 'key'>, parent?: TreeNode): TreeNode {
  return {
    id,
    label: step.label,
    scientific: step.scientific,
    level: step.level,
    children: [],
    datasets: new Set(),
    labels: new Set(),
    reviewNotes: new Map(),
    searchText: [step.label, step.scientific, step.search].filter(Boolean).join(' ').toLowerCase(),
    parent,
  };
}

class TreeBuilder {
  root: TreeNode;
  private byId = new Map<string, TreeNode>();
  private childIndex = new Map<TreeNode, Map<string, TreeNode>>();

  constructor(rootLabel: string) {
    this.root = makeNode('', { label: rootLabel, level: 'All' });
    this.byId.set('', this.root);
  }

  add(path: PathStep[], dataset: string, hit: Hit | null) {
    let node = this.root;
    node.datasets.add(dataset);
    for (const step of path) {
      let index = this.childIndex.get(node);
      if (!index) {
        index = new Map();
        this.childIndex.set(node, index);
      }
      let child = index.get(step.key);
      if (!child) {
        const id = node.id ? `${node.id}/${step.key}` : step.key;
        child = makeNode(id, step, node);
        node.childLevel ??= step.level;
        node.children.push(child);
        index.set(step.key, child);
        this.byId.set(id, child);
      } else if (step.search && !child.searchText.includes(step.search.toLowerCase())) {
        child.searchText += ` ${step.search.toLowerCase()}`;
      }
      child.datasets.add(dataset);
      node = child;
    }
    if (hit?.label) {
      node.labels.add(hit.label);
      if (!node.searchText.includes(hit.label)) node.searchText += ` ${hit.label}`;
      if (hit.review) node.reviewNotes.set(hit.label, hit.note ?? 'Identification flagged for review');
    }
  }

  finish(): TaxonomyTree {
    const sortRec = (node: TreeNode) => {
      node.children.sort((a, b) => {
        // Catch-all buckets always sort last.
        const aLast = a.id.endsWith(UNRESOLVED_ID) || a.id.endsWith(UNLABELED_ID) ? 1 : 0;
        const bLast = b.id.endsWith(UNRESOLVED_ID) || b.id.endsWith(UNLABELED_ID) ? 1 : 0;
        return aLast - bLast || b.datasets.size - a.datasets.size || a.label.localeCompare(b.label);
      });
      node.children.forEach(sortRec);
    };
    sortRec(this.root);
    return { root: this.root, byId: this.byId };
  }
}

export interface TaxonomyTree {
  root: TreeNode;
  byId: Map<string, TreeNode>;
}

function speciesStep(hit: Hit): PathStep | null {
  if (!hit.scientific) return null;
  const label = hit.common ? capitalize(hit.common) : hit.scientific;
  return {
    key: `t:${normalizeTaxonName(hit.scientific)}`,
    label,
    scientific: hit.common ? hit.scientific : undefined,
    level: hit.rank === 'genus' ? 'Genus' : hit.rank === 'species' ? 'Species' : 'Taxon',
    search: hit.extraSearch,
  };
}

function cultivarStep(hit: Hit): PathStep | null {
  if (!hit.cultivar) return null;
  return { key: `cv:${hit.cultivar.toLowerCase()}`, label: capitalize(hit.cultivar), level: 'Cultivar / variety' };
}

function unresolvedPath(hit: Hit): PathStep[] {
  return [
    { key: UNRESOLVED_ID, label: 'Unresolved labels', level: 'Bucket' },
    { key: `l:${hit.label}`, label: capitalize(hit.label ?? ''), level: 'Label', search: hit.note ?? '' },
  ];
}

function familyStep(family: string): PathStep {
  return { key: `f:${family.toLowerCase()}`, label: family, level: 'Family' };
}

function rankIsAboveGenus(hit: Hit) {
  return hit.rank === 'family' || hit.rank === 'subfamily';
}

export function buildTree(
  kind: TreeKind,
  resolved: ResolvedDataset[],
  taxonomy: CropTaxonomy,
  { includeINatAg = true }: { includeINatAg?: boolean } = {},
): TaxonomyTree {
  const builder = new TreeBuilder(TREE_KINDS.find((t) => t.kind === kind)!.label);

  for (const dataset of resolved) {
    const hits = includeINatAg ? dataset.hits : dataset.hits.filter((hit) => hit.label != null);
    if (hits.length === 0 && dataset.hits.length > 0) continue; // only had (excluded) iNatAg species
    if (kind === 'role' && hits.length === 0) {
      builder.add([{ key: UNLABELED_ID, label: 'No plant labels', level: 'Bucket' }], dataset.name, null);
      continue;
    }

    for (const hit of hits) {
      const steps = (...parts: (PathStep | null)[]) => parts.filter((p): p is PathStep => p != null);

      if (hit.unresolved) {
        if (kind === 'role') builder.add(unresolvedPath(hit), dataset.name, hit);
        continue;
      }

      if (kind === 'role') {
        if (!hit.role) continue; // iNatAg-only species: no curated role
        const roleStep: PathStep = { key: `r:${hit.role}`, label: taxonomy.roles[hit.role] ?? hit.role, level: 'Role' };
        if (!hit.scientific) {
          builder.add([roleStep], dataset.name, hit); // group-level tag, e.g. "medicinal plants"
        } else if (rankIsAboveGenus(hit)) {
          builder.add(steps(roleStep, familyStep(hit.family!)), dataset.name, hit);
        } else {
          builder.add(steps(roleStep, familyStep(hit.family!), speciesStep(hit), cultivarStep(hit)), dataset.name, hit);
        }
      } else if (kind === 'group') {
        for (const group of hit.groups) {
          const groupStep: PathStep = { key: `g:${group}`, label: taxonomy.use_groups[group] ?? group, level: 'Crop group' };
          const leaf = hit.scientific && !rankIsAboveGenus(hit) ? speciesStep(hit) : null;
          builder.add(steps(groupStep, leaf, leaf ? cultivarStep(hit) : null), dataset.name, hit);
        }
      } else {
        if (!hit.family || !hit.scientific) continue;
        if (rankIsAboveGenus(hit)) {
          builder.add([familyStep(hit.family)], dataset.name, hit);
          continue;
        }
        const genus = hit.scientific.split(' ')[0];
        const genusStep: PathStep = { key: `g:${genus.toLowerCase()}`, label: genus, level: 'Genus' };
        if (hit.rank === 'genus') {
          // A genus-level label ("pine", "citrus") attaches to the genus node itself.
          const common = hit.common ? capitalize(hit.common) : undefined;
          builder.add(steps(familyStep(hit.family), { ...genusStep, search: common }, cultivarStep(hit)), dataset.name, hit);
        } else {
          builder.add(steps(familyStep(hit.family), genusStep, speciesStep(hit), cultivarStep(hit)), dataset.name, hit);
        }
      }
    }
  }

  return builder.finish();
}

// ------------------------------------------------------------------------------------------------
// Search helpers
// ------------------------------------------------------------------------------------------------

// Ids of every node whose own text matches the query, plus all their ancestors (so the tree can
// show matches in context). Returns null for an empty query (= no filtering).
export function searchTree(tree: TaxonomyTree, query: string): { visible: Set<string>; matches: Set<string> } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set<string>();
  const matches = new Set<string>();
  for (const [id, node] of tree.byId) {
    if (!id || !node.searchText.includes(q)) continue;
    matches.add(id);
    for (let cursor: TreeNode | undefined = node; cursor && cursor.id; cursor = cursor.parent) visible.add(cursor.id);
  }
  return { visible, matches };
}

export function ancestorsOf(node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  for (let cursor = node.parent; cursor; cursor = cursor.parent) out.unshift(cursor);
  return out;
}
