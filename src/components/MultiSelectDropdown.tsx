import { useState } from 'react';
import styles from './MultiSelectDropdown.module.css';

export function MultiSelectDropdown({
	label,
	options,
	selected,
	onToggle,
	formatOption,
}: {
	label: string;
	options: string[];
	selected: string[];
	onToggle: (value: string) => void;
	formatOption?: (value: string) => string;
}) {
	const [open, setOpen] = useState(false);
	const format = formatOption ?? ((value: string) => value);

	return (
		<div className={`${styles.dropdown} ${open ? styles.dropdownOpen : ''}`} data-dropdown={label}>
			<label className={styles.dropdownLabel}>{label}</label>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				onBlur={() => setTimeout(() => setOpen(false), 150)}
				aria-expanded={open}
				className={styles.dropdownTrigger}
			>
				<span>
					{selected.length === 0
						? 'All'
						: selected.length === 1
							? format(selected[0])
							: `${selected.length} selected`}
				</span>
				<span className={styles.dropdownChevron} aria-hidden>
					▾
				</span>
			</button>
			{open && (
				<div className={styles.dropdownMenu} role="listbox" aria-multiselectable="true">
					{options.length === 0 && <div className={styles.dropdownEmpty}>No options</div>}
					{options.map((option) => {
						const isSelected = selected.includes(option);
						return (
							<button
								key={option}
								type="button"
								className={`${styles.dropdownOption} ${isSelected ? styles.dropdownOptionSelected : ''}`}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => onToggle(option)}
							>
								<span className={styles.dropdownCheckbox} aria-hidden>
									{isSelected ? '✓' : ''}
								</span>
								{format(option)}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
