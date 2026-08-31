import { ANIMATION_LIMITS } from './model';
import type { Easing, PathCommand, PathData, ShapeKeyframe, Transform, VectorLayer } from './model';
import {
	AnimationValidationError,
	validateEasing,
	validateInteger,
	validateKeyframe,
	validateLayer,
	validateNumber,
	validatePath
} from './validation';

export class AnimationInterpolationError extends AnimationValidationError {
	readonly code = 'incompatible_paths' as const;
	constructor() {
		super('Path topology is incompatible. Use matching subpaths and segment counts.');
		this.name = 'AnimationInterpolationError';
	}
}

function mix(a: number, b: number, t: number): number {
	if (t === 0) return a;
	if (t === 1) return b;
	const value = validateNumber(a * (1 - t) + b * t, 'interpolated value');
	return Math.max(-ANIMATION_LIMITS.maxCoordinate, Math.min(ANIMATION_LIMITS.maxCoordinate, value));
}

/** Normalize straight segments to cubics; never changes subpath topology or closes an open path. */
export function normalizePath(path: PathData): PathData {
	const commands = validatePath(path);
	let x = 0;
	let y = 0;
	return commands.map((command): PathCommand => {
		if (command.type === 'Z') return command;
		const result: PathCommand =
			command.type === 'L'
				? {
						type: 'C',
						x1: mix(x, command.x, 1 / 3),
						y1: mix(y, command.y, 1 / 3),
						x2: mix(x, command.x, 2 / 3),
						y2: mix(y, command.y, 2 / 3),
						x: command.x,
						y: command.y
					}
				: command;
		x = command.x;
		y = command.y;
		return result;
	});
}

function compatiblePaths(a: PathData, b: PathData): [PathData, PathData] {
	const left = normalizePath(a);
	const right = normalizePath(b);
	if (
		left.length !== right.length ||
		left.some((command, index) => command.type !== right[index].type)
	)
		throw new AnimationInterpolationError();
	return [left, right];
}

export function assertCompatibleKeyframes(a: ShapeKeyframe, b: ShapeKeyframe): void {
	const left = validateKeyframe(a);
	const right = validateKeyframe(b);
	if (left.paths.length !== right.paths.length) throw new AnimationInterpolationError();
	left.paths.forEach((path, index) => compatiblePaths(path, right.paths[index]));
}

/** Invert the cubic's x component with a fixed iteration count, then evaluate its y. */
export function evaluateEasing(easing: Easing, progress: number): number {
	const curve = validateEasing(easing);
	const t = validateNumber(progress, 'progress', 0, 1);
	if (t === 0 || t === 1 || curve.type === 'linear') return t;
	if (curve.type === 'hold') return 0;
	const cubic = (u: number, p1: number, p2: number) =>
		3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u;
	let low = 0;
	let high = 1;
	for (let iteration = 0; iteration < 52; iteration++) {
		const middle = (low + high) / 2;
		if (cubic(middle, curve.x1, curve.x2) < t) low = middle;
		else high = middle;
	}
	return validateNumber(cubic((low + high) / 2, curve.y1, curve.y2), 'eased progress');
}

export function interpolatePath(start: PathData, end: PathData, progress: number): PathData {
	validateNumber(progress, 'progress');
	const [a, b] = compatiblePaths(start, end);
	return a.map((left, index): PathCommand => {
		const right = b[index];
		if (left.type === 'Z') return { type: 'Z' };
		if (left.type === 'C' && right.type === 'C')
			return {
				type: 'C',
				x: mix(left.x, right.x, progress),
				y: mix(left.y, right.y, progress),
				x1: mix(left.x1, right.x1, progress),
				y1: mix(left.y1, right.y1, progress),
				x2: mix(left.x2, right.x2, progress),
				y2: mix(left.y2, right.y2, progress)
			};
		if (left.type === 'M' && right.type === 'M')
			return { type: 'M', x: mix(left.x, right.x, progress), y: mix(left.y, right.y, progress) };
		throw new AnimationInterpolationError();
	});
}

export function interpolateKeyframes(
	start: ShapeKeyframe,
	end: ShapeKeyframe,
	progress: number
): ShapeKeyframe {
	const a = validateKeyframe(start);
	const b = validateKeyframe(end);
	validateNumber(progress, 'progress', 0, 1);
	assertCompatibleKeyframes(a, b);
	if (progress === 0) return a;
	if (progress === 1) return b;
	const t = evaluateEasing(a.easing, progress);
	const transform = {} as Transform;
	for (const key of ['x', 'y', 'scaleX', 'scaleY', 'rotation'] as const)
		transform[key] = mix(a.transform[key], b.transform[key], t);
	for (const key of ['scaleX', 'scaleY'] as const)
		transform[key] = Math.max(
			ANIMATION_LIMITS.minScale,
			Math.min(ANIMATION_LIMITS.maxScale, transform[key])
		);
	return {
		paths: a.paths.map((path, index) => interpolatePath(path, b.paths[index], t)),
		transform,
		opacity: Math.max(0, Math.min(1, mix(a.opacity ?? 1, b.opacity ?? 1, t))),
		easing: { type: 'linear' },
		generated: true
	};
}

/**
 * Exact keys render as stored. Before the first authored key the layer is invisible;
 * after the last it holds. Compatible authored endpoints interpolate deterministically.
 * Incompatible geometry holds the earlier key, allowing unrelated endpoint edits.
 * Generated keys render at their exact frames but never reapply easing between samples.
 * Opacity here is the keyframe multiplier, not layer.style.opacity.
 */
export function evaluateLayer(layer: VectorLayer, frame: number): ShapeKeyframe | null {
	validateInteger(frame, 'frame', 0, ANIMATION_LIMITS.maxFrames - 1);
	const value = validateLayer(layer);
	if (!value.visible) return null;
	if (Object.hasOwn(value.keyframes, frame)) return validateKeyframe(value.keyframes[frame]);
	const frames = Object.keys(value.keyframes)
		.map(Number)
		.filter((key) => !value.keyframes[key].generated)
		.sort((a, b) => a - b);
	let earlier: number | undefined;
	let later: number | undefined;
	for (const key of frames) {
		if (key < frame) earlier = key;
		else {
			later = key;
			break;
		}
	}
	if (earlier === undefined) return null;
	const start = value.keyframes[earlier];
	if (later === undefined) return validateKeyframe(start);
	try {
		return interpolateKeyframes(
			start,
			value.keyframes[later],
			(frame - earlier) / (later - earlier)
		);
	} catch (error) {
		if (error instanceof AnimationInterpolationError) return validateKeyframe(start);
		throw error;
	}
}
