import type {ReactNode} from 'react';
import { useMemo } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';
import { computeDatasetStats, useDatasets } from '../lib/datasets';

// First 4 real datasets (by name) that ship a static sample image — hardcoded rather than
// picked live from useDatasets() so the homepage doesn't depend on the full dataset fetch.
const SAMPLE_IMAGES = [
  { name: 'almond_bloom_2023', path: '/img/agml/sample_images/almond_bloom_2023_examples.webp' },
  { name: 'almond_harvest_2021', path: '/img/agml/sample_images/almond_harvest_2021_examples.webp' },
  { name: 'apple_detection_drone_brazil', path: '/img/agml/sample_images/apple_detection_drone_brazil_examples.webp' },
  { name: 'apple_detection_spain', path: '/img/agml/sample_images/apple_detection_spain_examples.webp' },
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
  return (
    <section className={styles.samplesSection}>
      <p className={styles.sectionLabel}>Sample imagery</p>
      <div className={styles.samplesGrid}>
        {SAMPLE_IMAGES.map((sample) => (
          <div key={sample.name} className={styles.sampleTile}>
            <img
              src={useBaseUrl(sample.path)}
              alt={`${sample.name} sample`}
              className={styles.sampleImage}
            />
            <span className={styles.sampleCaption}>{sample.name}</span>
          </div>
        ))}
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
              <p className={styles.calloutCode}>
                loader = agml.data.AgMLDataLoader(&apos;apple_flower_segmentation&apos;)
              </p>
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
