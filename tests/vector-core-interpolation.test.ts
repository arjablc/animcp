import { describe, expect, it } from 'vitest';
import {
	ANIMATION_LIMITS,
	defaultStyle,
	identityTransform,
	type PathData,
	type ShapeKeyframe,
	type VectorLayer
} from '../src/lib/features/animation/model';
import {
	AnimationInterpolationError,
	evaluateEasing,
	evaluateLayer,
	interpolateKeyframes,
	interpolatePath,
	normalizePath
} from '../src/lib/features/animation/interpolation';
import { validateKeyframe } from '../src/lib/features/animation/validation';

function key(x: number, opacity?: number): ShapeKeyframe {
	return {
		paths: [
			[
				{ type: 'M', x, y: 0 },
				{ type: 'L', x: x + 30, y: 30 }
			]
		],
		transform: { ...identityTransform(), x },
		easing: { type: 'linear' },
		...(opacity === undefined ? {} : { opacity })
	};
}
function layer(
	keyframes: Record<number, ShapeKeyframe> = { 0: key(0), 10: key(100) }
): VectorLayer {
	return {
		id: 'layer',
		name: 'Stroke',
		visible: true,
		locked: false,
		zIndex: 0,
		style: defaultStyle(),
		keyframes
	};
}

describe('vector core canonical interpolation', () => {
	it('normalizes lines to geometrically equivalent cubics and preserves closures/subpaths', () => {
		const path: PathData = [
			...key(0).paths[0],
			{ type: 'Z' },
			{ type: 'M', x: 30, y: 0 },
			{ type: 'L', x: 60, y: 30 }
		];
		const normalized = normalizePath(path);
		expect(normalized).toEqual([
			{ type: 'M', x: 0, y: 0 },
			{ type: 'C', x1: 10, y1: 10, x2: 20, y2: 20, x: 30, y: 30 },
			{ type: 'Z' },
			{ type: 'M', x: 30, y: 0 },
			{ type: 'C', x1: 40, y1: 10, x2: 50, y2: 20, x: 60, y: 30 }
		]);
		expect(path[1].type).toBe('L');
	});

	it('interpolates matching L/C topology, cubic controls and numeric transforms', () => {
		const a = key(0, 0.2);
		const b = key(100, 0.8);
		b.paths = [normalizePath(b.paths[0])];
		b.transform = { x: 100, y: 40, scaleX: 3, scaleY: 2, rotation: 720 };
		const midpoint = interpolateKeyframes(a, b, 0.5);
		expect(midpoint.transform).toEqual({ x: 50, y: 20, scaleX: 2, scaleY: 1.5, rotation: 360 });
		expect(midpoint.opacity).toBeCloseTo(0.5);
		expect(midpoint.paths[0][1]).toMatchObject({ type: 'C', x: 80, y: 30, x1: 60, x2: 70 });
		expect(midpoint.generated).toBe(true);
	});

	it('rejects explicit interpolation between incompatible topology', () => {
		const a = key(0);
		const b = key(100);
		b.paths[0].push({ type: 'Z' });
		expect(() => interpolateKeyframes(a, b, 0.5)).toThrow(AnimationInterpolationError);
		try {
			interpolatePath(a.paths[0], b.paths[0], 0.5);
		} catch (error) {
			expect(error).toMatchObject({ category: 'validation', code: 'incompatible_paths' });
		}
	});

	it('does not alias endpoints or mutate source geometry', () => {
		const a = key(0);
		const b = key(100);
		const before = JSON.stringify([a, b]);
		expect(interpolateKeyframes(a, b, 0)).toEqual(a);
		expect(interpolateKeyframes(a, b, 1)).toEqual(b);
		const result = interpolateKeyframes(a, b, 0.5);
		result.transform.x = -30;
		expect(JSON.stringify([a, b])).toBe(before);
	});
});

describe('vector core easing and frame evaluation', () => {
	it('evaluates linear, hold and cubic Bézier by x inversion with exact endpoints', () => {
		expect(evaluateEasing({ type: 'linear' }, 0.25)).toBe(0.25);
		expect(evaluateEasing({ type: 'hold' }, 0.99)).toBe(0);
		expect(evaluateEasing({ type: 'hold' }, 1)).toBe(1);
		const curve = { type: 'bezier' as const, x1: 0.42, y1: 0, x2: 1, y2: 1 };
		expect(evaluateEasing(curve, 0.5)).toBeCloseTo(0.3153568, 6);
		expect(evaluateEasing(curve, 0)).toBe(0);
		expect(evaluateEasing(curve, 1)).toBe(1);
		for (const x of [0, 1]) {
			const result = evaluateEasing({ type: 'bezier', x1: x, y1: 0, x2: x, y2: 1 }, 0.3);
			expect(Number.isFinite(result)).toBe(true);
		}
		expect(() => evaluateEasing(curve, NaN)).toThrow();
		expect(() => evaluateEasing(curve, -0.1)).toThrow();
	});

	it('uses the starting easing and holds until the exact next key', () => {
		const value = layer();
		value.keyframes[0].easing = { type: 'hold' };
		expect(evaluateLayer(value, 9)?.transform.x).toBe(0);
		expect(evaluateLayer(value, 10)?.transform.x).toBe(100);
		value.keyframes[0].easing = { type: 'bezier', x1: 0.42, y1: 0, x2: 1, y2: 1 };
		value.keyframes[10].easing = { type: 'hold' };
		expect(evaluateLayer(value, 5)?.transform.x).toBeCloseTo(31.53568, 4);
	});

	it('renders exact keys, interpolates gaps, holds after the end and is invisible before the first key', () => {
		const value = layer({ 4: key(0), 14: key(100) });
		expect(evaluateLayer(value, 0)).toBeNull();
		expect(evaluateLayer(value, 3)).toBeNull();
		expect(evaluateLayer(value, 4)).toEqual(value.keyframes[4]);
		expect(evaluateLayer(value, 9)?.transform.x).toBe(50);
		expect(evaluateLayer(value, 20)).toEqual(value.keyframes[14]);
		expect(evaluateLayer(layer({}), 0)).toBeNull();
		expect(evaluateLayer({ ...value, visible: false }, 4)).toBeNull();
		expect(evaluateLayer({ ...value, locked: true }, 4)).not.toBeNull();
	});

	it('holds incompatible earlier geometry without preventing the later key from rendering', () => {
		const value = layer();
		value.keyframes[10].paths[0].push({ type: 'Z' });
		expect(evaluateLayer(value, 5)).toEqual(value.keyframes[0]);
		expect(evaluateLayer(value, 10)).toEqual(value.keyframes[10]);
	});

	it('defaults animated opacity to one and keeps static style opacity separate', () => {
		const value = layer({ 0: key(0), 10: key(100, 0) });
		value.style.opacity = 0.2;
		expect(evaluateLayer(value, 5)?.opacity).toBeCloseTo(0.5);
	});

	it('clamps overshoot output to safe opacity, scale and coordinate bounds', () => {
		const a = key(0, 0);
		const b = key(100, 1);
		a.easing = { type: 'bezier', x1: 0.1, y1: -10, x2: 0.9, y2: 10 };
		b.transform.x = ANIMATION_LIMITS.maxCoordinate;
		b.transform.scaleX = ANIMATION_LIMITS.maxScale;
		for (let frame = 0; frame <= 20; frame++) {
			const evaluated = evaluateLayer(layer({ 0: a, 20: b }), frame)!;
			expect(() => validateKeyframe(evaluated)).not.toThrow();
			expect(evaluated.opacity).toBeGreaterThanOrEqual(0);
			expect(evaluated.opacity).toBeLessThanOrEqual(1);
		}
	});

	it('is deterministic regardless of call order and does not reapply easing between generated samples', () => {
		const value = layer();
		value.keyframes[0].easing = { type: 'bezier', x1: 0.42, y1: 0, x2: 1, y2: 1 };
		const before = JSON.stringify(value);
		const expected = evaluateLayer(value, 5);
		for (const frame of [9, 1, 5, 3, 0, 5]) evaluateLayer(value, frame);
		expect(evaluateLayer(value, 5)).toEqual(expected);
		expect(JSON.stringify(value)).toBe(before);
		value.keyframes[4] = evaluateLayer(value, 4)!;
		expect(evaluateLayer(value, 5)).toEqual(expected);
	});

	it.each([-1, 1.5, NaN, Infinity, 1800])('rejects invalid frame %s', (frame) =>
		expect(() => evaluateLayer(layer(), frame)).toThrow()
	);
});
