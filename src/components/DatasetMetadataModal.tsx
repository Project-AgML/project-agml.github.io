import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../lib/datasets';
import { formatDisplayLocation } from '../lib/datasets';
import { classifyMetricLabel, METRIC_CATEGORY_LABELS, useDatasetPerformance } from '../lib/performance';
import type { MetricCategory, PerformanceEntry } from '../lib/performance';
import { MultiSelectDropdown } from './MultiSelectDropdown';
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

function formatResultType(entry: { variant: 'zero-shot' | 'fine-tuned' | null; optimized: boolean }) {
	const base = entry.variant === 'fine-tuned' ? 'Fine-tuned' : entry.variant === 'zero-shot' ? 'Zero-shot' : '—';
	if (base === '—') return base;
	return entry.optimized ? `${base} (optimized)` : base;
}

function resultTypeKey(entry: { variant: 'zero-shot' | 'fine-tuned' | null; optimized: boolean }): string | null {
	if (!entry.variant) return null;
	return entry.optimized ? `${entry.variant}-optimized` : entry.variant;
}

function formatResultTypeKey(key: string) {
	const optimized = key.endsWith('-optimized');
	const base = optimized ? key.slice(0, -'-optimized'.length) : key;
	const label = base === 'fine-tuned' ? 'Fine-tuned' : 'Zero-shot';
	return optimized ? `${label} (optimized)` : label;
}

function parseFilterNumber(value: string): number | null {
	if (!value.trim()) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function formatTimePerImage(value: number | null) {
	if (value == null || !Number.isFinite(value)) return '—';
	return `${value.toFixed(3)} s/img`;
}

function formatMetricScore(entry: { metrics: { key: string; label: string; value: number }[]; score: number | null }) {
	if (entry.metrics.length > 0) {
		return entry.metrics.map((metric) => `${metric.label}: ${metric.value.toFixed(3)}`).join(' · ');
	}
	return entry.score != null ? entry.score.toLocaleString() : '—';
}

function formatTrainInfTime(entry: { trainTimePerImage: number | null; infTimePerImage: number | null }) {
	const train = entry.trainTimePerImage != null ? `train ${formatTimePerImage(entry.trainTimePerImage)}` : null;
	const inf = entry.infTimePerImage != null ? `inf ${formatTimePerImage(entry.infTimePerImage)}` : null;
	const parts = [train, inf].filter((value): value is string => value != null);
	return parts.length ? parts.join(' / ') : '—';
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

	const datasetPerformance = useDatasetPerformance(open ? (dataset?.name ?? null) : null);

	const [metricTypeFilter, setMetricTypeFilter] = useState<string[]>([]);
	const [resultTypeFilter, setResultTypeFilter] = useState<string[]>([]);
	const [platformFilter, setPlatformFilter] = useState<string[]>([]);
	const [trainingTimeMin, setTrainingTimeMin] = useState('');
	const [trainingTimeMax, setTrainingTimeMax] = useState('');
	const [trainingSizeMin, setTrainingSizeMin] = useState('');
	const [trainingSizeMax, setTrainingSizeMax] = useState('');

	const allEntries = datasetPerformance.data?.entries ?? [];

	const { metricTypeOptions, resultTypeOptions, platformOptions } = useMemo(() => {
		const metricTypes = new Set<MetricCategory>();
		const resultTypes = new Set<string>();
		const platforms = new Set<string>();
		for (const entry of allEntries) {
			entry.metricCategories.forEach((category) => metricTypes.add(category));
			const key = resultTypeKey(entry);
			if (key) resultTypes.add(key);
			if (entry.platform) platforms.add(entry.platform);
		}
		return {
			metricTypeOptions: Array.from(metricTypes),
			resultTypeOptions: Array.from(resultTypes).sort(),
			platformOptions: Array.from(platforms).sort(),
		};
	}, [allEntries]);

	const toggleFilter = (setter: (updater: (current: string[]) => string[]) => void, value: string) => {
		setter((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
	};

	const filteredEntries = useMemo(() => {
		const timeMin = parseFilterNumber(trainingTimeMin);
		const timeMax = parseFilterNumber(trainingTimeMax);
		const sizeMin = parseFilterNumber(trainingSizeMin);
		const sizeMax = parseFilterNumber(trainingSizeMax);

		return allEntries.filter((entry: PerformanceEntry) => {
			if (metricTypeFilter.length && !entry.metricCategories.some((category) => metricTypeFilter.includes(category))) {
				return false;
			}
			if (resultTypeFilter.length) {
				const key = resultTypeKey(entry);
				if (!key || !resultTypeFilter.includes(key)) return false;
			}
			if (platformFilter.length && !(entry.platform && platformFilter.includes(entry.platform))) return false;
			if (timeMin != null && (entry.trainTimePerImage == null || entry.trainTimePerImage < timeMin)) return false;
			if (timeMax != null && (entry.trainTimePerImage == null || entry.trainTimePerImage > timeMax)) return false;
			if (sizeMin != null && (entry.trainPercentage == null || entry.trainPercentage < sizeMin)) return false;
			if (sizeMax != null && (entry.trainPercentage == null || entry.trainPercentage > sizeMax)) return false;
			return true;
		});
	}, [allEntries, metricTypeFilter, resultTypeFilter, platformFilter, trainingTimeMin, trainingTimeMax, trainingSizeMin, trainingSizeMax]);

	const hasActiveLeaderboardFilters =
		metricTypeFilter.length > 0 ||
		resultTypeFilter.length > 0 ||
		platformFilter.length > 0 ||
		trainingTimeMin !== '' ||
		trainingTimeMax !== '' ||
		trainingSizeMin !== '' ||
		trainingSizeMax !== '';

	const clearLeaderboardFilters = () => {
		setMetricTypeFilter([]);
		setResultTypeFilter([]);
		setPlatformFilter([]);
		setTrainingTimeMin('');
		setTrainingTimeMax('');
		setTrainingSizeMin('');
		setTrainingSizeMax('');
	};

	const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());
	const toggleExpandedRow = (key: string) => {
		setExpandedRowKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};
	useEffect(() => setExpandedRowKeys(new Set()), [filteredEntries]);

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

					<section className={styles.secondarySection}>
						<h3 className={styles.sectionTitle}>Model performance leaderboard</h3>
						{datasetPerformance.loading ? (
							<p className={styles.bodyText}>Loading leaderboard…</p>
						) : datasetPerformance.data && datasetPerformance.data.entries.length > 0 ? (
							<div className={styles.leaderboardWrap}>
								{datasetPerformance.data.metric && (
									<p className={styles.bodyText}>
										<span className={styles.inlineLabel}>Metric:</span> {datasetPerformance.data.metric}
									</p>
								)}

								<div className={styles.filterBar}>
									<MultiSelectDropdown
										label="Metric type"
										options={metricTypeOptions}
										selected={metricTypeFilter}
										onToggle={(value) => toggleFilter(setMetricTypeFilter, value)}
										formatOption={(value) => METRIC_CATEGORY_LABELS[value as MetricCategory]}
									/>
									<MultiSelectDropdown
										label="Tuned vs not tuned"
										options={resultTypeOptions}
										selected={resultTypeFilter}
										onToggle={(value) => toggleFilter(setResultTypeFilter, value)}
										formatOption={formatResultTypeKey}
									/>
									<MultiSelectDropdown
										label="Platform"
										options={platformOptions}
										selected={platformFilter}
										onToggle={(value) => toggleFilter(setPlatformFilter, value)}
									/>
									<div className={styles.filterRange}>
										<label className={styles.filterRangeLabel}>Training time (s/img)</label>
										<div className={styles.filterRangeInputs}>
											<input
												type="number"
												placeholder="Min"
												value={trainingTimeMin}
												onChange={(event) => setTrainingTimeMin(event.target.value)}
												className={styles.filterRangeInput}
											/>
											<span aria-hidden>–</span>
											<input
												type="number"
												placeholder="Max"
												value={trainingTimeMax}
												onChange={(event) => setTrainingTimeMax(event.target.value)}
												className={styles.filterRangeInput}
											/>
										</div>
									</div>
									<div className={styles.filterRange}>
										<label className={styles.filterRangeLabel}>Training set size (%)</label>
										<div className={styles.filterRangeInputs}>
											<input
												type="number"
												placeholder="Min"
												value={trainingSizeMin}
												onChange={(event) => setTrainingSizeMin(event.target.value)}
												className={styles.filterRangeInput}
											/>
											<span aria-hidden>–</span>
											<input
												type="number"
												placeholder="Max"
												value={trainingSizeMax}
												onChange={(event) => setTrainingSizeMax(event.target.value)}
												className={styles.filterRangeInput}
											/>
										</div>
									</div>
									{hasActiveLeaderboardFilters && (
										<button type="button" className={styles.clearFiltersButton} onClick={clearLeaderboardFilters}>
											Clear filters
										</button>
									)}
								</div>

								{filteredEntries.length === 0 ? (
									<p className={styles.bodyText}>No results match the selected filters.</p>
								) : (
									<table className={styles.leaderboardTable}>
										<colgroup>
											<col className={styles.colModel} />
											<col className={styles.colResultType} />
											<col className={styles.colSplit} />
											<col className={styles.colConfig} />
											<col className={styles.colMetric} />
											<col className={styles.colTime} />
											<col className={styles.colPlatform} />
										</colgroup>
										<thead>
											<tr>
												<th>Model name</th>
												<th>Result type</th>
												<th>Train / test / val images (%)</th>
												<th>Train / test config</th>
												<th>Metric score</th>
												<th>Normalized train / inf time (s/img)</th>
												<th>Platform</th>
											</tr>
										</thead>
										<tbody>
											{filteredEntries.map((entry, index) => {
												const rowKey = `${entry.model}-${entry.variant ?? 'default'}-${index}`;
												const isExpanded = expandedRowKeys.has(rowKey);
												return (
													<Fragment key={rowKey}>
														<tr
															className={styles.clickableRow}
															onClick={() => toggleExpandedRow(rowKey)}
															aria-expanded={isExpanded}
														>
															<td>
																<span className={styles.expandChevron} aria-hidden>
																	{isExpanded ? '▾' : '▸'}
																</span>
																{entry.link ? (
																	<a
																		href={entry.link}
																		target="_blank"
																		rel="noreferrer"
																		onClick={(event) => event.stopPropagation()}
																	>
																		{entry.model}
																	</a>
																) : (
																	entry.model
																)}
															</td>
															<td>{formatResultType(entry)}</td>
															<td>{entry.splitBreakdown ?? '—'}</td>
															<td>{entry.datasetConfig ?? '—'}</td>
															<td>{formatMetricScore(entry)}</td>
															<td>{formatTrainInfTime(entry)}</td>
															<td>{entry.platform ?? '—'}</td>
														</tr>
														{isExpanded && (
															<tr>
																<td colSpan={7} className={styles.notesCell}>
																	<p className={styles.detailLabel}>Necessary notes</p>
																	<p className={styles.notesText}>{entry.notes ?? 'No additional notes for this result.'}</p>
																</td>
															</tr>
														)}
													</Fragment>
												);
											})}
										</tbody>
									</table>
								)}
							</div>
						) : (
							<p className={styles.bodyText}>No leaderboard results have been submitted for this dataset yet.</p>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
