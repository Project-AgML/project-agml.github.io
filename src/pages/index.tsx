import type {ReactNode} from 'react';
import { useMemo } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';
import { computeDatasetStats, useDatasets } from '../lib/datasets';

// The ~30 most recently added sample images (by commit date) — hardcoded rather than
// picked live from useDatasets() so the homepage doesn't depend on the full dataset fetch.
// SampleImagery scrolls this pool left-to-right as a continuous marquee.
const SAMPLE_IMAGES = [
  { name: 'ACHENY_variety_classification', path: '/img/agml/sample_images/ACHENY_variety_classification_sample.webp' },
  { name: 'CocoaMFDB_detection', path: '/img/agml/sample_images/CocoaMFDB_detection_sample.webp' },
  { name: 'Medjool_date_ripeness_classification', path: '/img/agml/sample_images/Medjool_date_ripeness_classification_sample.webp' },
  { name: 'QuinceSet_detection', path: '/img/agml/sample_images/QuinceSet_detection_sample.webp' },
  { name: 'citrus_fruit_leaf_disease_classification', path: '/img/agml/sample_images/citrus_fruit_leaf_disease_classification_sample.webp' },
  { name: 'crop_weed_detection_latvia', path: '/img/agml/sample_images/crop_weed_detection_latvia_sample.webp' },
  { name: 'fortunella_margarita_growth_detection', path: '/img/agml/sample_images/fortunella_margarita_growth_detection_sample.webp' },
  { name: 'maize_weed_detection', path: '/img/agml/sample_images/maize_weed_detection_sample.webp' },
  { name: 'merlot_mildew_segmentation', path: '/img/agml/sample_images/merlot_mildew_segmentation_sample.webp' },
  { name: 'pomegranate_quality_classification', path: '/img/agml/sample_images/pomegranate_quality_classification_sample.webp' },
  { name: 'ERWIAM_blight_detection', path: '/img/agml/sample_images/ERWIAM_blight_detection_sample.webp' },
  { name: 'LSID_bean_segmentation', path: '/img/agml/sample_images/LSID_bean_segmentation_sample.webp' },
  { name: 'TealeafAgeQuality_detection', path: '/img/agml/sample_images/TealeafAgeQuality_detection_sample.webp' },
  { name: 'bean_disease_classification_tanzania', path: '/img/agml/sample_images/bean_disease_classification_tanzania_sample.webp' },
  { name: 'fruitseg30_segmentation', path: '/img/agml/sample_images/fruitseg30_segmentation_sample.webp' },
  { name: 'grapevine_esca_classification', path: '/img/agml/sample_images/grapevine_esca_classification_sample.webp' },
  { name: 'maize_tomato_weed_classification', path: '/img/agml/sample_images/maize_tomato_weed_classification_sample.webp' },
  { name: 'oil_palm_fruit_ripeness_classification', path: '/img/agml/sample_images/oil_palm_fruit_ripeness_classification_sample.webp' },
  { name: 'onionfoliageset_detection', path: '/img/agml/sample_images/onionfoliageset_detection_sample.webp' },
  { name: 'seasveg_classification_bd', path: '/img/agml/sample_images/seasveg_classification_bd_sample.webp' },
  { name: 'sunflower_detection', path: '/img/agml/sample_images/sunflower_detection_sample.webp' },
  { name: 'fresh_rotten_fruit_classification', path: '/img/agml/sample_images/fresh_rotten_fruit_classification_sample.webp' },
  { name: 'grapevine_disease_classification', path: '/img/agml/sample_images/grapevine_disease_classification_sample.webp' },
  { name: 'soybean_damage_classification', path: '/img/agml/sample_images/soybean_damage_classification_sample.webp' },
  { name: 'tomato_factory_detection', path: '/img/agml/sample_images/tomato_factory_detection_sample.webp' },
  { name: 'BDMediLeaves_variety_classification', path: '/img/agml/sample_images/BDMediLeaves_variety_classification_sample.webp' },
  { name: 'MangoClassify-12_variety_classification', path: '/img/agml/sample_images/MangoClassify-12_variety_classification_sample.webp' },
  { name: 'PaddyVarietyBD_variety_classification', path: '/img/agml/sample_images/PaddyVarietyBD_variety_classification_sample.webp' },
  { name: 'date_cluster_detection', path: '/img/agml/sample_images/date_cluster_detection_sample.webp' },
  { name: 'grape_variety_classification', path: '/img/agml/sample_images/grape_variety_classification_sample.webp' },
];

const FEATURES = [
  {
    tag: 'Search',
    title: 'Dataset-first workflow',
    body: 'Browse thousands of public datasets, filter by task, and jump directly into training with the AgML data loader.',
  },
  {
    tag: 'Train',
    title: 'TensorFlow + PyTorch ready',
    body: 'Export loaders to native TensorFlow or PyTorch pipelines without rewriting your data preprocessing logic.',
  },
  {
    tag: 'Coverage',
    title: 'Global coverage',
    body: 'From crop disease to detection and segmentation, AgML catalogs datasets spanning continents, crops, and sensor modalities.',
  },
];

function HomepageHero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={styles.heroContent}>
        <p className={styles.kicker}>AgML Library</p>
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.tagline}
        </Heading>
        <p className={styles.heroSubtitle}>
          AgML delivers a unified way to discover, load, and train on agricultural datasets across
          tasks and modalities. Start with a dataset, scale to a full pipeline.
        </p>
        <div className={styles.heroActions}>
          <Link className={styles.primaryButton} to="/datasets">
            Search datasets
          </Link>
          <Link className={styles.secondaryButton} to="/leaderboard">
            Browse leaderboard
          </Link>
        </div>
      </div>
    </header>
  );
}

function SampleImagery() {
  // Rendered twice back-to-back so the track can loop seamlessly: once it has
  // scrolled through the first copy, it's positioned exactly where the second
  // copy begins, and the animation resets without a visible jump.
  const track = useMemo(() => [...SAMPLE_IMAGES, ...SAMPLE_IMAGES], []);

  return (
    <section className={styles.samplesSection}>
      <p className={styles.sectionLabel}>Sample imagery</p>
      <div className={styles.samplesMarquee}>
        <div className={styles.samplesTrack}>
          {track.map((sample, index) => (
            <div key={`${sample.name}-${index}`} className={styles.sampleTile}>
              <img
                src={useBaseUrl(sample.path)}
                alt={`${sample.name} sample`}
                className={styles.sampleImage}
              />
              <span className={styles.sampleCaption}>{sample.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsRow() {
  const { data } = useDatasets();
  const stats = useMemo(() => computeDatasetStats(data), [data]);

  return (
    <section className={styles.statsRow}>
      <div className={styles.statBlock}>
        <span className={styles.statValue}>{stats.datasetCount.toLocaleString()}</span>
        <span className={styles.statLabel}>Datasets indexed</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statValue}>{stats.imageCount.toLocaleString()}</span>
        <span className={styles.statLabel}>Labeled images</span>
      </div>
      <div className={styles.statBlock}>
        <span className={styles.statValue}>{stats.taskTypeCount.toLocaleString()}</span>
        <span className={styles.statLabel}>CV task types</span>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout description="AgML is a comprehensive library for agricultural machine learning.">
      <div className={styles.page}>
        <HomepageHero />
        <SampleImagery />
        <StatsRow />

        <section className={styles.featuresSection}>
          <p className={styles.sectionLabel}>What AgML offers</p>
          <div className={styles.featuresGrid}>
            {FEATURES.map((feature) => (
              <article key={feature.title} className={styles.featureCard}>
                <p className={styles.featureTag}>{feature.tag}</p>
                <h2 className={styles.featureTitle}>{feature.title}</h2>
                <p className={styles.featureBody}>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.calloutSection}>
          <div className={styles.callout}>
            <div>
              <h2 className={styles.calloutTitle}>Load any dataset in one line</h2>
              <pre className={styles.calloutCode}>
                {'from agml.data.hf_loader import HuggingFaceDataLoader\n'}
                {'loader = HuggingFaceDataLoader("Project-AgML/apple_flower_segmentation")'}
              </pre>
            </div>
            <Link className={styles.secondaryButton} to="/docs">
              Read the docs
            </Link>
          </div>
        </section>
      </div>
    </Layout>
  );
}
