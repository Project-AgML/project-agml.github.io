import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
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
          <Link className={styles.primaryButton} to="/docs">
            Read the docs
          </Link>
          <Link className={styles.secondaryButton} to="/datasets">
            Dataset search
          </Link>
        </div>
      </div>
      <div className={styles.heroVisual}>
        <img src={useBaseUrl('/img/agml/agml-framework.png')} alt="AgML framework diagram" />
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout description="AgML is a comprehensive library for agricultural machine learning.">
      <HomepageHeader />
      <main className={styles.main}>
        <section className={styles.highlightGrid}>
          <article className={styles.highlightCard}>
            <h2>Dataset-first workflow</h2>
            <p>
              Browse thousands of public datasets, filter by task, and jump directly into training
              with the AgML data loader.
            </p>
          </article>
          <article className={styles.highlightCard}>
            <h2>TensorFlow + PyTorch ready</h2>
            <p>
              Export loaders to native TensorFlow or PyTorch pipelines without rewriting your data
              preprocessing logic.
            </p>
          </article>
          <article className={styles.highlightCard}>
            <h2>Global coverage</h2>
            <p>
              From crop disease to detection and segmentation, AgML catalogs datasets spanning
              continents, crops, and sensor modalities.
            </p>
          </article>
        </section>

        <section className={styles.callout}>
          <div>
            <h2>Find the right dataset in minutes</h2>
            <p>
              Use the new dataset search page to filter by task, platform, and modality, then dive
              into detailed dataset docs in one click.
            </p>
          </div>
          <Link className={styles.primaryButton} to="/datasets">
            Explore datasets
          </Link>
        </section>

        <section className={styles.mapSection}>
          <div>
            <h2>See AgML on the map</h2>
            <p>
              AgML datasets span a global network of agricultural research efforts. Track coverage
              and discover new sources from every region.
            </p>
          </div>
          <img
            src={useBaseUrl('/img/agml/agml_dataset_world_map.png')}
            alt="AgML dataset world map"
            className={styles.mapImage}
          />
        </section>
      </main>
    </Layout>
  );
}
