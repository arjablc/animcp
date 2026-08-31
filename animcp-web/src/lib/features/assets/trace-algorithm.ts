import type { PathData } from '../animation/model';
import { validateObject } from '../animation/validation';
import { ASSET_LIMITS, AssetError } from './limits';

export type TraceOptions = {
	/** 0..255 inclusive; dark pixels at or below this luma become foreground. Default 128. */
	threshold?: number;
	/** 0..255 inclusive; fully transparent pixels are always excluded. Default 128. */
	alphaThreshold?: number;
	/** Alpha mode traces silhouettes regardless of color. Default 'luminance'. */
	mode?: 'luminance' | 'alpha';
	/** Select light instead of dark pixels in luminance mode. Default false. */
	invert?: boolean;
	/** Longest sampled side, 1..512; larger source images are downsampled. Default 512. */
	maxDimension?: number;
	/** May lower but never raise the 10000 command cap, including M and Z. */
	maxCommands?: number;
};

export type TraceProgress = (fraction: number) => void;

export const TRACE_LIMITATIONS =
	'Monochrome pixel contours only: thresholded alpha/luma, sampled at up to 512px per side, ' +
	'with exact collinear simplification. Not color tracing, curve fitting, or semantic segmentation. ' +
	'Small details may be lost when downsampling; noisy images may exceed the 10000-command limit.';

export function normalizeTraceOptions(options: TraceOptions = {}): Required<TraceOptions> {
	const value = validateObject(
		options,
		['threshold', 'alphaThreshold', 'mode', 'invert', 'maxDimension', 'maxCommands'],
		'trace options'
	);
	const integer = (key: string, fallback: number, min: number, max: number): number => {
		const number = value[key] === undefined ? fallback : value[key];
		if (
			typeof number !== 'number' ||
			!Number.isSafeInteger(number) ||
			number < min ||
			number > max
		) {
			throw new AssetError('invalid-input', `${key} must be an integer from ${min} to ${max}.`);
		}
		return number;
	};
	const mode = value.mode === undefined ? 'luminance' : value.mode;
	const invert = value.invert === undefined ? false : value.invert;
	if (mode !== 'luminance' && mode !== 'alpha')
		throw new AssetError('invalid-input', 'Trace mode must be luminance or alpha.');
	if (typeof invert !== 'boolean')
		throw new AssetError('invalid-input', 'Trace invert must be a boolean.');
	return {
		threshold: integer('threshold', 128, 0, 255),
		alphaThreshold: integer('alphaThreshold', 128, 0, 255),
		mode,
		invert,
		maxDimension: integer(
			'maxDimension',
			ASSET_LIMITS.maxTraceDimension,
			1,
			ASSET_LIMITS.maxTraceDimension
		),
		maxCommands: integer(
			'maxCommands',
			ASSET_LIMITS.maxTraceCommands,
			5,
			ASSET_LIMITS.maxTraceCommands
		)
	};
}

export function reportProgress(callback: TraceProgress | undefined, fraction: number): void {
	try {
		callback?.(fraction);
	} catch {
		// Observers must not turn a successful trace into a failed operation or leak its worker.
	}
}

/**
 * Deterministic 4-connected foreground contours on pixel edges. Outer contours wind clockwise
 * in image coordinates; holes wind oppositely, so the canonical nonzero fill rule works.
 * Only turns are retained: exact simplification preserves holes and never joins diagonal pixels.
 * Work/memory are O(width*height); output is separately bounded after simplification.
 */
export function tracePixels(
	image: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
	options: TraceOptions = {},
	onProgress?: TraceProgress
): PathData {
	const settings = normalizeTraceOptions(options);
	const { data, width, height } = image;
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > settings.maxDimension ||
		height > settings.maxDimension
	) {
		throw new AssetError(
			'size-limit',
			`Trace pixels must be at most ${settings.maxDimension}px per side (hard limit 512).`
		);
	}
	if (
		!(data instanceof Uint8ClampedArray || data instanceof Uint8Array) ||
		data.length !== width * height * 4
	) {
		throw new AssetError('invalid-input', 'Trace requires exactly width × height × 4 RGBA bytes.');
	}
	reportProgress(onProgress, 0);
	const mask = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const pixel = y * width + x;
			const i = pixel * 4;
			if (data[i + 3] === 0 || data[i + 3] < settings.alphaThreshold) continue;
			const luma = (2126 * data[i] + 7152 * data[i + 1] + 722 * data[i + 2]) / 10_000;
			const dark = luma <= settings.threshold;
			if (settings.mode === 'alpha' || (settings.invert ? !dark : dark)) mask[pixel] = 1;
		}
		if ((y & 31) === 0) reportProgress(onProgress, (0.25 * (y + 1)) / height);
	}

	// At each grid vertex one byte holds outgoing E/S/W/N edges as four bits.
	const stride = width + 1;
	const edges = new Uint8Array(stride * (height + 1));
	let edgeCount = 0;
	const add = (x: number, y: number, direction: number) => {
		edges[y * stride + x] |= 1 << direction;
		edgeCount++;
	};
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			if (!mask[i]) continue;
			if (y === 0 || !mask[i - width]) add(x, y, 0);
			if (x === width - 1 || !mask[i + 1]) add(x + 1, y, 1);
			if (y === height - 1 || !mask[i + width]) add(x + 1, y + 1, 2);
			if (x === 0 || !mask[i - 1]) add(x, y + 1, 3);
		}
		if ((y & 31) === 0) reportProgress(onProgress, 0.25 + (0.25 * (y + 1)) / height);
	}
	if (edgeCount === 0)
		throw new AssetError(
			'empty-trace',
			'No foreground pixels matched. Adjust the threshold or use alpha mode.'
		);

	const path: PathData = [];
	const steps = [1, stride, -1, -stride];
	let visited = 0;
	const tooComplex = (): never => {
		throw new AssetError(
			'complexity',
			`Trace exceeds ${settings.maxCommands} commands after simplification. Reduce maxDimension or adjust the threshold.`
		);
	};
	for (let start = 0; start < edges.length; start++) {
		while (edges[start]) {
			let direction = 0;
			while (!(edges[start] & (1 << direction))) direction++;
			const firstDirection = direction;
			let vertex = start;
			const corners = [start];
			while (true) {
				edges[vertex] &= ~(1 << direction);
				visited++;
				vertex += steps[direction];
				if ((visited & 4095) === 0) reportProgress(onProgress, 0.5 + (0.49 * visited) / edgeCount);
				if (vertex === start) break;
				// Prefer a right turn at a diagonal contact; each filled pixel stays on the right.
				const choices = [(direction + 1) % 4, direction, (direction + 3) % 4];
				const next = choices.find((candidate) => edges[vertex] & (1 << candidate));
				if (next === undefined || visited > edgeCount)
					throw new AssetError('invalid-input', 'Unable to close a raster contour.');
				if (next !== direction) {
					corners.push(vertex);
					// Closing may remove the start vertex, and adds Z: reserve that one-vertex slack.
					if (path.length + corners.length > settings.maxCommands) tooComplex();
				}
				direction = next;
			}
			if (direction === firstDirection) corners.shift();
			if (path.length + corners.length + 1 > settings.maxCommands) tooComplex();
			for (let i = 0; i < corners.length; i++) {
				path.push({
					type: i === 0 ? 'M' : 'L',
					x: corners[i] % stride,
					y: Math.floor(corners[i] / stride)
				});
			}
			path.push({ type: 'Z' });
		}
	}
	reportProgress(onProgress, 1);
	return path;
}
