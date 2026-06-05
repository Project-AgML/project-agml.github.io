import { useEffect } from 'react';
import type { Dataset } from '../lib/datasets';
import { formatDisplayLocation } from '../lib/datasets';
import styles from './DatasetMetadataModal.module.css';

function formatImageCount(count: number | null) {
	if (count == null) return 'Unknown';
	if (count >= 1000) {
		const scaled = (count / 1000).toFixed(1);
		const trimmed = scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled;
		return `${trimmed}k`;
	}
	return count.toLocaleString();
}

function formatValue(value: string | string[] | null | undefined) {
	if (value == null) return 'Unknown';
	if (Array.isArray(value)) return value.length ? value.join(', ') : 'Unknown';
	return value;
}

function formatArray(value: number[] | null) {
	if (value == null || value.length === 0) return 'Unknown';
	return `[${value.map((entry) => entry.toFixed(3)).join(', ')}]`;
}

function formatBytesDecimal(bytes: number | null | undefined) {
	if (bytes == null) return 'Unknown';
	if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';

	const units = ['B', 'kB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unitIndex = 0;

	while (value >= 1000 && unitIndex < units.length - 1) {
		value /= 1000;
		unitIndex += 1;
	}

	const formatted = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
	const trimmed = formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
	return `${trimmed} ${units[unitIndex]}`;
}

function hasExampleImage(url: string | null): url is string {
	return Boolean(url);
}

function formatLoaderInstructions(dataset: Dataset) {
	if (dataset.source === 'huggingface') {
		return {
			title: 'Load from Hugging Face',
			body: `Use agml.data.hf_loader.HuggingFaceDataLoader("Project-AgML/${dataset.name}") to load this dataset from Hugging Face.`,
			code: `from agml.data.hf_loader import HuggingFaceDataLoader\n\nloader = HuggingFaceDataLoader("Project-AgML/${dataset.name}")`,
		};
	}

	return {
		title: 'Load with AgML',
		body: `Use agml.data.AgMLDataLoader("${dataset.name}") to load this dataset locally through AgML.`,
		code: `import agml\n\nloader = agml.data.AgMLDataLoader("${dataset.name}")`,
	};
}

export function DatasetMetadataModal({
	dataset,
	open,
	onClose,
}: {
	dataset: Dataset | null;
	open: boolean;
	onClose: () => void;
}) {
	useEffect(() => {
		if (!open) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [open, onClose]);

	if (!open || dataset == null) return null;

	const detailRows = [
		['Machine learning task', formatValue(dataset.machine_learning_task)],
		['Agricultural task', formatValue(dataset.agricultural_task)],
		['Location', formatDisplayLocation(dataset.location)],
		['Sensor modality', formatValue(dataset.sensor_modality)],
		['Real or synthetic', formatValue(dataset.real_or_synthetic)],
		['Platform', formatValue(dataset.platform)],
		['Input format', formatValue(dataset.input_data_format)],
		['Annotation format', formatValue(dataset.annotation_format)],
		['Number of images', formatImageCount(dataset.num_images)],
		['Size', formatBytesDecimal(dataset.zip_size_bytes)],
		...(dataset.augmented_num_images != null
			? ([['Augmented images', formatImageCount(dataset.augmented_num_images)]] as const)
			: []),
		...(dataset.augmented_zip_size_bytes != null
			? ([['Augmented size', formatBytesDecimal(dataset.augmented_zip_size_bytes)]] as const)
			: []),
	] as [string, string][];
	const loader = formatLoaderInstructions(dataset);

	return (
		<div className={styles.backdrop} role="presentation" onClick={onClose}>
			<div
				className={styles.modal}
				role="dialog"
				aria-modal="true"
				aria-labelledby="dataset-metadata-title"
				onClick={(event) => event.stopPropagation()}
			>
				<div className={styles.header}>
					<div>
						<p className={styles.kicker}>Dataset metadata</p>
						<h2 id="dataset-metadata-title" className={styles.title}>
							{dataset.name}
						</h2>
					</div>
					<button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close dataset details">
						Close
					</button>
				</div>

				<dl className={styles.detailGrid}>
					{detailRows.map(([label, value]) => (
						<div key={label} className={styles.detailItem}>
							<dt className={styles.detailLabel}>{label}</dt>
							<dd className={styles.detailValue}>{value}</dd>
						</div>
					))}
				</dl>

				{(dataset.classes || dataset.stats_mean || dataset.stats_std) && (
					<div className={styles.secondaryGrid}>
						{dataset.classes && (
							<section className={styles.secondarySection}>
								<h3 className={styles.sectionTitle}>Classes</h3>
								<p className={styles.bodyText}>{dataset.classes}</p>

							</section>
						)}
						{(dataset.stats_mean || dataset.stats_std) && (
							<section className={styles.secondarySection}>
								<h3 className={styles.sectionTitle}>Stats</h3>
								<p className={styles.bodyText}>
									<span className={styles.inlineLabel}>Mean:</span> {formatArray(dataset.stats_mean)}
								</p>
								<p className={styles.bodyText}>
									<span className={styles.inlineLabel}>Std:</span> {formatArray(dataset.stats_std)}
								</p>
							</section>
						)}
					</div>
				)}

				<div className={styles.footer}>
					{hasExampleImage(dataset.examples_image_url) ? (
						<figure className={styles.figure}>
							<img className={styles.exampleImage} src={dataset.examples_image_url} alt={`Example for ${dataset.name}`} />
						</figure>
					) : (
						<p className={styles.bodyText}>No example image is available for this dataset.</p>
					)}

					<section className={styles.secondarySection}>
						<h3 className={styles.sectionTitle}>{loader.title}</h3>
						<p className={styles.bodyText}>{loader.body}</p>
						<pre className={styles.codeBlock}>{loader.code}</pre>
					</section>

					{(dataset.documentation || dataset.hf_link) && (
						<div className={styles.linkRow}>
							{dataset.documentation && (
								<a className={styles.externalLink} href={dataset.documentation} target="_blank" rel="noreferrer">
									Open source documentation
								</a>
							)}
							{dataset.hf_link && (
								<a className={styles.hfLink} href={dataset.hf_link} target="_blank" rel="noreferrer">
									View on Hugging Face
								</a>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
