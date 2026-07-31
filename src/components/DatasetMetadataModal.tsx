import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../lib/datasets';
import { formatDisplayLocation, toTitleCase } from '../lib/datasets';
import { toDisplayLabel } from '../lib/labelOverrides';
import { METRIC_CATEGORY_LABELS, useDatasetPerformance } from '../lib/performance';
import type { MetricCategory, PerformanceEntry } from '../lib/performance';
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
	if (Array.isArray(value)) return value.length ? value.map(toTitleCase).join(', ') : 'Unknown';
	return toTitleCase(value);
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

const EMPTY_ENTRIES: PerformanceEntry[] = [];

function hasExampleImage(url: string | null): url is string {
	return Boolean(url);
}

function formatResultType(entry: { variant: 'zero-shot' | 'fine-tuned' | null; optimized: boolean }) {
	const base = entry.variant === 'fine-tuned' ? 'Fine-tuned' : entry.variant === 'zero-shot' ? 'Zero-shot' : '—';
	if (base === '—') return base;
	return entry.optimized ? `${base} (optimized)` : base;
}

function taskBadgeClass(task: string | null): string {
	if (!task) return styles.badgeOther;
	if (task.includes('classif')) return styles.badgeClassification;
	if (task.includes('detect')) return styles.badgeDetection;
	if (task.includes('segment')) return styles.badgeSegmentation;
	return styles.badgeOther;
}

function formatTunedKey(key: string) {
	return key === 'fine-tuned' ? 'Fine-tuned' : 'Zero-shot';
}

function formatOptimizedKey(key: string) {
	return key === 'optimized' ? 'Optimized' : 'Not optimized';
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

function formatLoaderInstructions(dataset: Dataset) {
	if (dataset.source === 'huggingface') {
		if(dataset.dataset_type === 'vlm') {
			return {
				title: 'Load from Hugging Face',
				code: `from datasets import load_dataset\nloader = load_dataset("Project-AgML/${dataset.name}")`,
			};
		}
		return {
			title: 'Load from Hugging Face',
			code: `from agml.data.hf_loader import HuggingFaceDataLoader\nloader = HuggingFaceDataLoader("Project-AgML/${dataset.name}")`,
		};
	}

	return {
		title: 'Load with AgML',
		code: `import agml\nloader = agml.data.AgMLDataLoader("${dataset.name}")`,
	};
}

function InlineFilterGroup({
	label,
	options,
	selected,
	onToggle,
	formatOption = (value: string) => value,
}: {
	label: string;
	options: string[];
	selected: string[];
	onToggle: (value: string) => void;
	formatOption?: (value: string) => string;
}) {
	return (
		<div className={styles.filterGroup}>
			<p className={styles.filterGroupLabel}>{label}</p>
			<div className={styles.filterGroupOptions}>
				{options.map((option) => (
					<label key={option} className={styles.filterCheckboxRow}>
						<input
							type="checkbox"
							className={styles.checkbox}
							checked={selected.includes(option)}
							onChange={() => onToggle(option)}
						/>
						<span>{formatOption(option)}</span>
					</label>
				))}
			</div>
		</div>
	);
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
	const [tunedFilter, setTunedFilter] = useState<string[]>([]);
	const [optimizedFilter, setOptimizedFilter] = useState<string[]>([]);
	const [platformFilter, setPlatformFilter] = useState<string[]>([]);
	const [trainingTimeMax, setTrainingTimeMax] = useState('');
	const [trainingSizeMin, setTrainingSizeMin] = useState('');

	const allEntries = datasetPerformance.data?.entries ?? EMPTY_ENTRIES;

	const { metricTypeOptions, tunedOptions, optimizedOptions, platformOptions } = useMemo(() => {
		const metricTypes = new Set<MetricCategory>();
		const tuned = new Set<string>();
		const optimized = new Set<string>();
		const platforms = new Set<string>();
		for (const entry of allEntries) {
			entry.metricCategories.forEach((category) => metricTypes.add(category));
			if (entry.variant) tuned.add(entry.variant);
			optimized.add(entry.optimized ? 'optimized' : 'not-optimized');
			if (entry.platform) platforms.add(entry.platform);
		}
		return {
			metricTypeOptions: Array.from(metricTypes),
			tunedOptions: Array.from(tuned).sort(),
			optimizedOptions: Array.from(optimized).sort(),
			platformOptions: Array.from(platforms).sort(),
		};
	}, [allEntries]);

	const toggleFilter = (setter: (updater: (current: string[]) => string[]) => void, value: string) => {
		setter((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
	};

	const filteredEntries = useMemo(() => {
		const timeMax = parseFilterNumber(trainingTimeMax);
		const sizeMin = parseFilterNumber(trainingSizeMin);

		return allEntries.filter((entry: PerformanceEntry) => {
			if (metricTypeFilter.length && !entry.metricCategories.some((category) => metricTypeFilter.includes(category))) {
				return false;
			}
			if (tunedFilter.length && !(entry.variant && tunedFilter.includes(entry.variant))) return false;
			if (optimizedFilter.length && !optimizedFilter.includes(entry.optimized ? 'optimized' : 'not-optimized')) return false;
			if (platformFilter.length && !(entry.platform && platformFilter.includes(entry.platform))) return false;
			if (timeMax != null && (entry.trainTimePerImage == null || entry.trainTimePerImage > timeMax)) return false;
			if (sizeMin != null && (entry.trainPercentage == null || entry.trainPercentage < sizeMin)) return false;
			return true;
		});
	}, [allEntries, metricTypeFilter, tunedFilter, optimizedFilter, platformFilter, trainingTimeMax, trainingSizeMin]);

	const hasActiveLeaderboardFilters =
		metricTypeFilter.length > 0 ||
		tunedFilter.length > 0 ||
		optimizedFilter.length > 0 ||
		platformFilter.length > 0 ||
		trainingTimeMax !== '' ||
		trainingSizeMin !== '';

	const clearLeaderboardFilters = () => {
		setMetricTypeFilter([]);
		setTunedFilter([]);
		setOptimizedFilter([]);
		setPlatformFilter([]);
		setTrainingTimeMax('');
		setTrainingSizeMin('');
	};

	const [cropsExpanded, setCropsExpanded] = useState(false);
	const [classesExpanded, setClassesExpanded] = useState(false);
	const [copied, setCopied] = useState(false);

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

	const isVlm = dataset.dataset_type === 'vlm';

	const metadataRows = [
		['Location', formatDisplayLocation(dataset.location)],
		['Sensor modality', dataset.sensor_modality == null || dataset.sensor_modality === '' ? 'Unknown' : toDisplayLabel(dataset.sensor_modality)],
		['Platform', formatValue(dataset.platform)],
		...(isVlm
			? ([
					['Conversation format', formatValue(dataset.conversation_format)],
					['Num of samples', formatImageCount(dataset.num_rows)],
				] as const)
			: ([['Number of images', formatImageCount(dataset.num_images)]] as const)),
		['Size', formatBytesDecimal(dataset.zip_size_bytes)],
		...(dataset.augmented_num_images != null
			? ([['Augmented images', formatImageCount(dataset.augmented_num_images)]] as const)
			: []),
		...(dataset.augmented_zip_size_bytes != null
			? ([['Augmented size', formatBytesDecimal(dataset.augmented_zip_size_bytes)]] as const)
			: []),
	] as [string, string][];
	const loader = formatLoaderInstructions(dataset);
	const cropList = dataset.crop_types ?? [];
	const classList = dataset.classes ? dataset.classes.split(', ').filter(Boolean) : [];

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
						<h2 id="dataset-metadata-title" className={styles.title}>
							{dataset.name}
						</h2>
						<div className={styles.headerBadges}>
							{dataset.machine_learning_task && (
								<span className={`${styles.taskBadge} ${taskBadgeClass(dataset.machine_learning_task)}`}>
									{formatValue(dataset.machine_learning_task)}
								</span>
							)}
							{dataset.agricultural_task && <span className={styles.tag}>{formatValue(dataset.agricultural_task)}</span>}
							{dataset.real_or_synthetic && <span className={styles.tag}>{formatValue(dataset.real_or_synthetic)}</span>}
						</div>
					</div>
					<button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close dataset details">
						×
					</button>
				</div>

				<dl className={styles.detailGrid} style={{ gridTemplateColumns: `repeat(${metadataRows.length}, 1fr)` }}>
					{metadataRows.map(([label, value]) => (
						<div key={label} className={styles.detailItem}>
							<dt className={styles.detailLabel}>{label}</dt>
							<dd className={styles.detailValue}>{value}</dd>
						</div>
					))}
				</dl>

				{isVlm && dataset.qa_type && dataset.qa_type.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>QA Types</h3>
						<div className={styles.badgeWrap}>
							{dataset.qa_type.map((value) => (
								<span key={value} className={styles.tag}>{toTitleCase(value)}</span>
							))}
						</div>
					</section>
				)}

				{isVlm && dataset.task_dimensions && dataset.task_dimensions.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Task Dimensions</h3>
						<div className={styles.badgeWrap}>
							{dataset.task_dimensions.map((value) => (
								<span key={value} className={styles.tag}>{toTitleCase(value)}</span>
							))}
						</div>
					</section>
				)}

				{isVlm && dataset.source_datasets && dataset.source_datasets.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Source Datasets</h3>
						<div className={styles.badgeWrap}>
							{dataset.source_datasets.map((sourceDataset) => (
								<span key={sourceDataset} className={styles.tag}>{sourceDataset}</span>
							))}
						</div>
					</section>
				)}

				{cropList.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Crops</h3>
						<div className={styles.badgeWrap}>
							{(cropsExpanded ? cropList : cropList.slice(0, 10)).map((crop) => (
								<span key={crop} className={styles.tag}>{crop}</span>
							))}
							{!cropsExpanded && cropList.length > 10 && (
								<button type="button" className={styles.expandButton} onClick={() => setCropsExpanded(true)}>
									+{cropList.length - 10} more
								</button>
							)}
						</div>
					</section>
				)}

				{classList.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Classes</h3>
						<div className={styles.badgeWrap}>
							{(classesExpanded ? classList : classList.slice(0, 10)).map((cls) => (
								<span key={cls} className={styles.tag}>{cls}</span>
							))}
							{!classesExpanded && classList.length > 10 && (
								<button type="button" className={styles.expandButton} onClick={() => setClassesExpanded(true)}>
									+{classList.length - 10} more
								</button>
							)}
						</div>
					</section>
				)}

				{(dataset.stats_mean || dataset.stats_std) && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Stats</h3>
						<p className={styles.bodyText}>
							<span className={styles.inlineLabel}>Mean:</span> {formatArray(dataset.stats_mean)}
						</p>
						<p className={styles.bodyText}>
							<span className={styles.inlineLabel}>Std:</span> {formatArray(dataset.stats_std)}
						</p>
					</section>
				)}

				<section className={styles.section}>
					<h3 className={styles.sectionTitle}>Sample image</h3>
					{hasExampleImage(dataset.examples_image_url) ? (
						<figure className={styles.figure}>
							<img className={styles.exampleImage} src={dataset.examples_image_url} alt={`Example for ${dataset.name}`} />
						</figure>
					) : (
						<p className={styles.bodyText}>No example image is available for this dataset.</p>
					)}
				</section>

				<section className={styles.section}>
					<h3 className={styles.sectionTitle}>{loader.title}</h3>
					<div className={styles.snippetRow}>
						<span className={styles.snippetCode}>{loader.code}</span>
						<button
							type="button"
							className={styles.snippetCopyButton}
							onClick={() => {
								navigator.clipboard.writeText(loader.code);
								setCopied(true);
								setTimeout(() => setCopied(false), 1500);
							}}
						>
							{copied ? 'Copied!' : 'Copy'}
						</button>
					</div>
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
						{isVlm && dataset.parent_dataset && (
							<a className={styles.externalLink} href={dataset.parent_dataset} target="_blank" rel="noreferrer">
								View Original Dataset
							</a>
						)}
					</div>
				)}

				<section className={styles.section}>
					<h3 className={styles.sectionTitle}>
						Leaderboard{datasetPerformance.data?.metric ? ` — ${datasetPerformance.data.metric}` : ''}
					</h3>
					{datasetPerformance.loading ? (
						<p className={styles.bodyText}>Loading leaderboard…</p>
					) : datasetPerformance.data && datasetPerformance.data.entries.length > 0 ? (
						<div className={styles.leaderboardWrap}>
							<div className={styles.filterBar}>
								<InlineFilterGroup
									label="Metric type"
									options={metricTypeOptions}
									selected={metricTypeFilter}
									onToggle={(value) => toggleFilter(setMetricTypeFilter, value)}
									formatOption={(value) => METRIC_CATEGORY_LABELS[value as MetricCategory]}
								/>
								<InlineFilterGroup
									label="Tuned"
									options={tunedOptions}
									selected={tunedFilter}
									onToggle={(value) => toggleFilter(setTunedFilter, value)}
									formatOption={formatTunedKey}
								/>
								<InlineFilterGroup
									label="Optimized"
									options={optimizedOptions}
									selected={optimizedFilter}
									onToggle={(value) => toggleFilter(setOptimizedFilter, value)}
									formatOption={formatOptimizedKey}
								/>
								<InlineFilterGroup
									label="Platform"
									options={platformOptions}
									selected={platformFilter}
									onToggle={(value) => toggleFilter(setPlatformFilter, value)}
								/>
								<div className={styles.filterRange}>
									<label className={styles.filterRangeLabel}>Max train time (s/img)</label>
									<input
										type="number"
										placeholder="Max"
										value={trainingTimeMax}
										onChange={(event) => setTrainingTimeMax(event.target.value)}
										className={styles.filterRangeInput}
									/>
								</div>
								<div className={styles.filterRange}>
									<label className={styles.filterRangeLabel}>Min train split (%)</label>
									<input
										type="number"
										placeholder="Min"
										value={trainingSizeMin}
										onChange={(event) => setTrainingSizeMin(event.target.value)}
										className={styles.filterRangeInput}
									/>
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
								<div className={styles.tableWrap}>
									<div className={styles.leaderboardTable} role="table">
										<div className={styles.tableRow} role="row">
											<span role="columnheader">Rank</span>
											<span role="columnheader">Model</span>
											<span role="columnheader">Result</span>
											<span role="columnheader">Split%</span>
											<span role="columnheader">Config</span>
											<span role="columnheader">Scores</span>
											<span role="columnheader">Norm s/img</span>
											<span role="columnheader">Plat.</span>
										</div>
										{filteredEntries.map((entry, index) => {
											const rowKey = `${entry.model}-${entry.variant ?? 'default'}-${index}`;
											const isExpanded = expandedRowKeys.has(rowKey);
											return (
												<Fragment key={rowKey}>
													<div role="row" aria-expanded={isExpanded} className={styles.tableRow}>
														<span role="cell" className={styles.rankCell}>#{entry.rank ?? index + 1}</span>
														<span role="cell">
															<button type="button" className={styles.modelButton} onClick={() => toggleExpandedRow(rowKey)}>
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
																)}{' '}
																{isExpanded ? '▾' : '▸'}
															</button>
														</span>
														<span role="cell" className={styles.simpleCell}>{formatResultType(entry)}</span>
														<span role="cell" className={styles.simpleCell}>{entry.splitBreakdown ?? '—'}</span>
														<span role="cell" className={styles.simpleCell}>{entry.datasetConfig ?? '—'}</span>
														<span role="cell">
															{entry.metrics.length > 0 ? (
																<div className={styles.scoresCell}>
																	{entry.metrics.map((metric) => (
																		<span key={metric.key}>{metric.label}: {metric.value.toFixed(3)}</span>
																	))}
																</div>
															) : (
																<span className={styles.simpleCell}>{formatMetricScore(entry)}</span>
															)}
														</span>
														<span role="cell">
															<div className={styles.stackCell}>
																<span>train {formatTimePerImage(entry.trainTimePerImage)}</span>
																<span>inf {formatTimePerImage(entry.infTimePerImage)}</span>
															</div>
														</span>
														<span role="cell" className={styles.simpleCell}>{entry.platform ?? '—'}</span>
													</div>
													{isExpanded && (
														<div className={styles.notesRow}>
															<p className={styles.notesLabel}>Notes</p>
															<p className={styles.notesText}>{entry.notes ?? 'No additional notes for this result.'}</p>
														</div>
													)}
												</Fragment>
											);
										})}
									</div>
								</div>
							)}
						</div>
					) : (
						<p className={styles.bodyText}>No leaderboard results have been submitted for this dataset yet.</p>
					)}
				</section>
			</div>
		</div>
	);
}
