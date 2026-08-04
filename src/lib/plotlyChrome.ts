import { useMemo } from 'react';
import { useColorMode } from '@docusaurus/theme-common';

// Modern browsers serialize getComputedStyle().color back in whatever color space it was
// declared in — the site's --agml-* tokens are oklch(), so a naive resolve returns an
// oklch() string verbatim. Plotly's WebGL/SVG color parsing doesn't understand that syntax,
// so it silently ignores the color and falls back to its own default. Convert explicitly.
// (OKLCH -> OKLab -> linear sRGB -> sRGB, per the CSS Color 4 reference algorithm.)
// Exported for reuse by anything that needs to hand Plotly a procedurally generated OKLCH
// color (e.g. per-class hues) rather than one resolved from a CSS variable.
export function oklchToRgb(l: number, c: number, hDeg: number): string {
	const hRad = (hDeg * Math.PI) / 180;
	const a = c * Math.cos(hRad);
	const b = c * Math.sin(hRad);

	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.291485548 * b;

	const l3 = l_ ** 3;
	const m3 = m_ ** 3;
	const s3 = s_ ** 3;

	const rLin = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
	const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
	const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

	const toSrgb = (channel: number) => {
		const clamped = channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(Math.max(channel, 0), 1 / 2.4) - 0.055;
		return Math.max(0, Math.min(255, Math.round(clamped * 255)));
	};

	return `rgb(${toSrgb(rLin)}, ${toSrgb(gLin)}, ${toSrgb(bLin)})`;
}

function normalizeColor(color: string): string {
	const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(color);
	if (!match) return color;
	const [, l, c, h] = match;
	return oklchToRgb(Number(l), Number(c), Number(h));
}

function resolveCssColor(varName: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	const probe = document.createElement('span');
	probe.style.color = `var(${varName})`;
	probe.style.position = 'absolute';
	probe.style.visibility = 'hidden';
	document.body.appendChild(probe);
	const resolved = getComputedStyle(probe).color;
	document.body.removeChild(probe);
	return resolved ? normalizeColor(resolved) : fallback;
}

function resolveCssFontFamily(varName: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	const probe = document.createElement('span');
	probe.style.fontFamily = `var(${varName})`;
	probe.style.position = 'absolute';
	probe.style.visibility = 'hidden';
	document.body.appendChild(probe);
	const resolved = getComputedStyle(probe).fontFamily;
	document.body.removeChild(probe);
	return resolved || fallback;
}

// Plotly's WebGL/SVG chrome can't consume CSS custom properties directly — resolve the site's
// actual computed colors/fonts so chart chrome (axis lines, grid, tick labels, hover tooltip)
// tracks the design system's --agml-*/--ifm-* tokens (and light/dark mode) instead of guessed
// literals. Recomputed whenever the theme toggles.
export function usePlotlyChrome() {
	const { colorMode } = useColorMode();
	return useMemo(
		() => ({
			grid: resolveCssColor('--agml-border', '#33383a'),
			text: resolveCssColor('--agml-muted', '#8a8f8c'),
			tooltipBg: resolveCssColor('--agml-tag-bg', '#1c211d'),
			tooltipBorder: resolveCssColor('--agml-border-strong', '#3a4038'),
			tooltipText: resolveCssColor('--agml-text', '#e8ece9'),
			// Ring color for marker outlines — matches the panel surface so overlapping points
			// separate via a gap rather than a contrasting stroke.
			markerRing: resolveCssColor('--agml-surface-soft', '#171a17'),
			fontFamily: resolveCssFontFamily('--ifm-code-font-family', 'monospace'),
		}),
		[colorMode],
	);
}
