import { useEffect, useMemo, useState, type ReactNode } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import type { CropTaxonomy, TreeKind } from '../lib/taxonomy';
import styles from './TaxonomyAbout.module.css';

// "About this taxonomy" panel on /datasets/explore: what each tree shows, where its labels come
// from, and what to keep in mind. Counts are computed from the live mapping table so the text
// doesn't drift as labels are added.

const STORAGE_KEY = 'agml-explore-about-open';
const ISSUES_URL = 'https://github.com/Project-AgML/project-agml.github.io/issues';

interface Stats {
  labels: number;
  taxa: number;
  review: number;
  unresolved: number;
  cultivars: number;
  groupTags: number;
}

function computeStats(taxonomy: CropTaxonomy): Stats {
  const labels = Object.values(taxonomy.labels);
  return {
    labels: labels.length,
    taxa: Object.keys(taxonomy.taxa).length,
    review: labels.filter((l) => l.review).length,
    unresolved: labels.filter((l) => l.unresolved).length,
    cultivars: labels.filter((l) => l.cultivar).length,
    groupTags: labels.filter((l) => !l.taxon && l.groups?.length).length,
  };
}

const n = (value: number) => value.toLocaleString();

interface AboutContent {
  summary: string;
  shows: ReactNode;
  caveats: ReactNode;
}

function contentFor(kind: TreeKind, stats: Stats, inatagSpecies: number): AboutContent {
  switch (kind) {
    case 'role':
      return {
        summary:
          'Groups every plant by the role it plays in the data — crop, weed, tree, medicinal plant and so on — so that, for example, weed-detection and forestry datasets aren’t mixed in with crop datasets.',
        shows: (
          <>
            <p>
              Nine roles: <em>crops, weeds, trees &amp; forestry, wild &amp; native vegetation, aquatic &amp; wetland, medicinal
              plants, ornamentals, land cover &amp; mixed,</em> and <em>other</em>. Each role breaks down into botanical family →
              species → cultivar.
            </p>
            <p>
              Two catch-all buckets keep everything accounted for: <strong>No plant labels</strong> (datasets whose metadata
              names no plant) and <strong>Unresolved labels</strong> (labels that couldn’t be identified).
            </p>
          </>
        ),
        caveats: (
          <>
            <p>
              Each species has one default role, assigned by hand. A specific label can override it when every dataset
              using that label agrees: <em>eclipta</em> is a medicinal herb, but the label “eclipta” only appears in a
              weed-detection dataset, so it’s filed as a weed there. Overrides apply per label, not per dataset, so a label
              shared by an orchard dataset and a forest dataset gets a single role.
            </p>
            <p>
              iNatAg’s species appear here only when they’re also in the curated table (e.g. maize). Its other wild species
              have no role assigned; use the Botanical tree to browse them.
            </p>
          </>
        ),
      };
    case 'group':
      return {
        summary:
          'Groups crops by what they’re grown for — cereals, legumes, fruit & nuts, oilseeds and so on — adapted from the top level of the FAO’s Indicative Crop Classification (ICC).',
        shows: (
          <>
            <p>
              Eleven groups, each broken down into species → cultivar. The ICC’s catch-all “other crops” group is split into{' '}
              <em>fibre crops, fodder &amp; cover crops,</em> and <em>other crops</em> (rubber, tobacco), because those are
              separate audiences here.
            </p>
            <p>
              A crop can sit in more than one group when it’s grown for more than one thing: soybean and groundnut are under
              both <em>Oilseeds</em> and <em>Legumes</em>, and cotton is under both <em>Fibre</em> and <em>Oilseeds</em>.
            </p>
          </>
        ),
        caveats: (
          <>
            <p>
              Only crops are included; weeds, forest trees and wild plants aren’t grown for a use and don’t appear. As in the
              ICC, <em>Roots &amp; tubers</em> means starchy staples (potato, cassava, yam, taro); carrot, radish and onion are
              under <em>Vegetables</em>.
            </p>
            <p>
              Broad labels such as “fruits”, “vegetables” or “cover crops” ({n(stats.groupTags)} labels in all) attach to the
              group itself rather than a species. Different forms of one species
              can sit in different groups: sugar beet is under <em>Sugar crops</em>, while beetroot and Swiss chard are under{' '}
              <em>Vegetables</em>.
            </p>
          </>
        ),
      };
    case 'botanical':
      return {
        summary:
          'The scientific classification — family → genus → species → cultivar — for every plant in the catalog, including all of iNatAg’s species. It’s the one view where crops, weeds, trees and wild plants share a single tree.',
        shows: (
          <>
            <p>
              Useful for questions that follow plant relationships rather than crop use. For example, all Solanaceae disease
              datasets for transfer learning, or Brassicaceae weeds that might be confused with canola.
            </p>
            <p>
              With <strong>Include iNatAg species</strong> on, iNatAg and iNatAg-mini also appear under each of the{' '}
              {n(inatagSpecies)} species they cover. Turn it off to see only the catalog’s own labels.
            </p>
          </>
        ),
        caveats: (
          <>
            <p>
              Families follow APG IV, as used by iNaturalist. iNatAg’s family names come from the iNaturalist metadata
              shipped with the AgML library. The curated table uses the same family names, and an automated test checks that
              the two sources agree for every genus they share.
            </p>
            <p>
              Labels that only name a genus (“pine”, “citrus”, “oak”) attach to the genus node, not a species. The old family
              Chenopodiaceae is folded into Amaranthaceae, and bamboo is filed under the subfamily Bambusoideae within Poaceae.
            </p>
          </>
        ),
      };
  }
}

export function TaxonomyAbout({
  kind,
  taxonomy,
  inatagSpecies,
}: {
  kind: TreeKind;
  taxonomy: CropTaxonomy | null;
  inatagSpecies: number;
}) {
  // Open by default; remember if this viewer collapses it. Storage can be unavailable (private
  // windows, blocked site data), so every access is guarded.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === '0') setOpen(false);
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = () =>
    setOpen((prev) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, prev ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !prev;
    });

  const stats = useMemo(() => (taxonomy ? computeStats(taxonomy) : null), [taxonomy]);
  const tableUrl = useBaseUrl('/data/taxonomy/crop_taxonomy.json');
  const content = stats ? contentFor(kind, stats, inatagSpecies) : null;

  return (
    <section className={styles.about} aria-label="About this taxonomy">
      <div className={styles.head}>
        <p className={styles.summary}>{content?.summary ?? 'Loading taxonomy…'}</p>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={toggle}>
          {open ? 'Hide details ▴' : 'How this taxonomy was built ▾'}
        </button>
      </div>

      {open && content && stats && (
        <div className={styles.body}>
          <div className={styles.column}>
            <h3 className={styles.heading}>What it shows</h3>
            {content.shows}
          </div>

          <div className={styles.column}>
            <h3 className={styles.heading}>Where the labels come from</h3>
            <p>
              Each tree is built from each dataset’s <code>crop_types</code> field: the plant names in its metadata. Those come
              from the dataset’s own documentation, or for many newer entries from automated extraction out of the source
              journal article. They’re free text, so the same plant appears under many names (“pigeonpea”, “arhar”, “red
              gram”), along with cultivars, local names and some noise.
            </p>
            <p>
              Every one of the {n(stats.labels)} distinct labels has been mapped to one of {n(stats.taxa)} accepted
              scientific names in a{' '}
              <a href={tableUrl} target="_blank" rel="noopener noreferrer">
                curated mapping table
              </a>
              . Synonyms merge into one species, and{' '}
              {n(stats.cultivars)} cultivar or variety labels (e.g. “fuji apple”, “merlot noir”) nest under their species.
              Select any node to see which original labels were mapped to it.
            </p>
          </div>

          <div className={styles.column}>
            <h3 className={styles.heading}>Things to know</h3>
            {content.caveats}
            <p className={styles.caution}>
              <span aria-hidden="true">⚠</span> The mapping is an AI-assisted first pass, checked against iNatAg’s
              taxonomy but not yet against GBIF or GRIN. {n(stats.review)} uncertain identifications are flagged with ⚠ on
              their node, and {n(stats.unresolved)} labels couldn’t be identified. Spotted a mistake?{' '}
              <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
                Open an issue
              </a>
              .
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default TaxonomyAbout;
