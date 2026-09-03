import { describe, expect, it, vi } from 'vitest';
import {
	ANIMATION_LIMITS,
	createAnimationProject,
	defaultStyle,
	identityTransform,
	type AnimationProject,
	type PathData,
	type VectorLayer
} from '../src/lib/features/animation/model';
import {
	AnimationValidationError,
	parseProject,
	validateAsset,
	validateEasing,
	validateKeyframe,
	validatePath,
	validateTransform
} from '../src/lib/features/animation/validation';

const path: PathData = [
	{ type: 'M', x: 0, y: 0 },
	{ type: 'L', x: 100, y: 40 }
];
function projectWithLayer(): AnimationProject {
	const project = createAnimationProject({ id: 'project', name: 'Test' });
	project.layers.push({
		id: 'layer',
		name: 'Stroke',
		visible: true,
		locked: false,
		zIndex: 0,
		style: defaultStyle(),
		keyframes: {
			0: {
				paths: [structuredClone(path)],
				transform: identityTransform(),
				easing: { type: 'linear' }
			}
		}
	});
	return project;
}

describe('vector core model and project validation', () => {
	it('creates valid, isolated v1 defaults and accepts a name or bounded settings', () => {
		const project = createAnimationProject('Sketch');
		expect(parseProject(project)).toEqual(project);
		expect(project).toMatchObject({
			version: 1,
			kind: 'vector-animation',
			name: 'Sketch',
			revision: 0,
			layers: [],
			assets: []
		});
		expect(createAnimationProject({ timeline: { fps: 12 } }).timeline).toEqual({
			fps: 12,
			frameCount: 60
		});
		const style = defaultStyle();
		style.opacity = 0;
		const transform = identityTransform();
		transform.x = 9;
		expect(defaultStyle().opacity).toBe(1);
		expect(identityTransform().x).toBe(0);
		expect(createAnimationProject().id).not.toBe(project.id);
	});

	it('rejects explicit null defaults and malformed factory inputs', () => {
		for (const options of [
			null,
			{ name: null },
			{ id: null },
			{ canvas: null },
			{ timeline: null },
			{ extra: true }
		])
			expect(() => createAnimationProject(options as never)).toThrow(AnimationValidationError);
	});

	it('round-trips documents and returns detached canonical copies', () => {
		const project = projectWithLayer();
		const parsed = parseProject(JSON.stringify(project));
		expect(parsed).toEqual(project);
		parsed.layers[0].keyframes[0].transform.x = 90;
		expect(project.layers[0].keyframes[0].transform.x).toBe(0);
		expect(project.layers[0].keyframes[0].opacity).toBeUndefined();
	});

	it.each([
		['width', 239],
		['width', 1921],
		['height', 239],
		['height', 1081],
		['width', 300.5],
		['background', 'url(https://example.com/a)']
	])('rejects invalid canvas %s = %s', (field, value) => {
		const project = projectWithLayer();
		Object.assign(project.canvas, { [field]: value });
		expect(() => parseProject(project)).toThrow(AnimationValidationError);
	});

	it.each([
		{ fps: 60, frameCount: 60 },
		{ fps: 30, frameCount: 29 },
		{ fps: 12, frameCount: 721 },
		{ fps: 24, frameCount: 24.5 }
	])('enforces frame rate and 1–60 second duration: %j', (timeline) => {
		expect(() => parseProject({ ...projectWithLayer(), timeline })).toThrow(
			AnimationValidationError
		);
	});

	it.each(['-1', '1.5', '01', '1e1', '150', 'NaN'])(
		'rejects invalid or out-of-range keyframe key %s',
		(key) => {
			const project = projectWithLayer();
			project.layers[0].keyframes = { [key]: project.layers[0].keyframes[0] };
			expect(() => parseProject(project)).toThrow(AnimationValidationError);
		}
	);

	it('rejects duplicate layer IDs, duplicate order, asset IDs and excess layers', () => {
		const project = projectWithLayer();
		project.layers.push(structuredClone(project.layers[0]));
		expect(() => parseProject(project)).toThrow(/Duplicate/);
		project.layers[1].id = 'second';
		expect(() => parseProject(project)).toThrow(/Duplicate/);
		project.layers[1].zIndex = 4;
		expect(parseProject(project).layers).toHaveLength(2);
		project.layers = Array.from(
			{ length: ANIMATION_LIMITS.maxLayers + 1 },
			(_, i): VectorLayer => ({ ...project.layers[0], id: `l${i}`, zIndex: i })
		);
		expect(() => parseProject(project)).toThrow(/layer array/);
	});

	it('validates all required project fields and rejects session state', () => {
		const project = projectWithLayer();
		for (const patch of [
			{ version: 2 },
			{ kind: 'p5' },
			{ name: '' },
			{ id: '__proto__' },
			{ revision: -1 },
			{ revision: Number.MAX_SAFE_INTEGER + 1 },
			{ createdAt: 'yesterday' },
			{ currentFrame: 0 }
		])
			expect(() => parseProject({ ...project, ...patch })).toThrow(AnimationValidationError);
		const missing: Partial<AnimationProject> = { ...project };
		delete missing.version;
		expect(() => parseProject(missing)).toThrow(AnimationValidationError);
		expect(() => parseProject('{')).toThrow('Invalid project JSON');
		expect(() => parseProject({ ...project, createdAt: '2026-02-30T00:00:00.000Z' })).toThrow(
			'Invalid calendar date'
		);
	});

	it('strictly checks layer style, opacity, booleans and unknown fields', () => {
		const project = projectWithLayer();
		for (const patch of [
			{ opacity: -1 },
			{ opacity: 2 },
			{ strokeWidth: -1 },
			{ strokeWidth: 1_001 },
			{ stroke: '<svg onload="run()">' },
			{ fill: 'var(--color)' },
			{ strokeLineCap: 'pointed' },
			{ strokeLineJoin: 'sharp' }
		]) {
			const bad = structuredClone(project);
			Object.assign(bad.layers[0].style, patch);
			expect(() => parseProject(bad)).toThrow(AnimationValidationError);
		}
		expect(() =>
			parseProject({ ...project, layers: [{ ...project.layers[0], visible: 1 }] })
		).toThrow();
		expect(() =>
			parseProject({ ...project, layers: [{ ...project.layers[0], script: 'run()' }] })
		).toThrow();
	});

	it('validates optional keyframe opacity and one path per key', () => {
		const keyframe = projectWithLayer().layers[0].keyframes[0];
		expect(validateKeyframe(keyframe).opacity).toBeUndefined();
		expect(validateKeyframe({ ...keyframe, opacity: 0 }).opacity).toBe(0);
		for (const patch of [
			{ opacity: null },
			{ opacity: 1.01 },
			{ generated: 'yes' },
			{ paths: [] },
			{ paths: [path, path] }
		])
			expect(() => validateKeyframe({ ...keyframe, ...patch })).toThrow(AnimationValidationError);
	});
});

describe('vector core untrusted input boundary', () => {
	it.each(['__proto__', 'constructor', 'prototype'])(
		'rejects pollution key %s at every nesting level without mutation',
		(key) => {
			const bad = JSON.parse(`{"${key}":{"polluted":true}}`);
			expect(() => parseProject({ ...projectWithLayer(), ...bad })).toThrow(
				AnimationValidationError
			);
			const project = projectWithLayer();
			Object.assign(project.layers[0].keyframes, bad);
			expect(() => parseProject(project)).toThrow(AnimationValidationError);
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		}
	);

	it('rejects getters without executing them', () => {
		const getter = vi.fn(() => 1);
		const project = projectWithLayer();
		Object.defineProperty(project.layers[0].keyframes[0].transform, 'x', {
			enumerable: true,
			get: getter
		});
		expect(() => parseProject(project)).toThrow(/Accessors/);
		expect(getter).not.toHaveBeenCalled();
	});

	it('rejects inherited state, runtime objects, non-JSON values, cycles and sparse arrays', () => {
		const project = projectWithLayer();
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		for (const value of [
			Object.create(project),
			new Date(),
			() => {},
			1n,
			undefined,
			Symbol('state'),
			NaN,
			Infinity,
			cyclic
		])
			expect(() => parseProject(value)).toThrow(AnimationValidationError);
		const holey = new Array(3);
		holey[2] = project.layers[0];
		expect(() => parseProject({ ...project, layers: holey })).toThrow(/Sparse/);
		expect(() => parseProject({ ...project, [Symbol('hidden')]: 1 })).toThrow(/Unsafe/);
	});

	it('rejects excessive JSON and structural depth before processing the schema', () => {
		expect(() => parseProject(' '.repeat(ANIMATION_LIMITS.maxProjectBytes + 1))).toThrow(
			/size limit/
		);
		let nested: unknown = {};
		for (let depth = 0; depth < 40; depth++) nested = { nested };
		expect(() => parseProject(nested)).toThrow(/structural limits/);
	});
});

describe('vector core path, transform and easing validation', () => {
	it('accepts and clones M/L/C/Z with independent subpaths', () => {
		const commands: PathData = [
			...path,
			{ type: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
			{ type: 'Z' },
			{ type: 'M', x: 9, y: 8 },
			{ type: 'L', x: 7, y: 6 }
		];
		expect(validatePath(commands)).toEqual(commands);
		expect(validatePath(commands)).not.toBe(commands);
	});

	it.each(
		[
			[],
			[{ type: 'L', x: 0, y: 0 }],
			[{ type: 'm', x: 0, y: 0 }],
			[{ type: 'Z' }],
			[{ type: 'M', x: 0, y: 0 }, { type: 'Z' }, { type: 'Z' }],
			[{ type: 'M', x: 0, y: 0 }, { type: 'Z' }, { type: 'L', x: 1, y: 1 }],
			[{ type: 'M', x: NaN, y: 0 }],
			[{ type: 'M', x: 0, y: Infinity }],
			[{ type: 'M', x: 0, y: 0, onload: 'run()' }],
			[
				{ type: 'M', x: 0, y: 0 },
				{ type: 'Q', x: 1, y: 1 }
			],
			[{ type: 'M', x: 1_000_001, y: 0 }],
			[{ type: 'M', x: 0, y: -1_000_001 }],
			[
				{ type: 'M', x: 0, y: 0 },
				{ type: 'C', x: 1, y: 1, x1: 0, y1: 0 }
			]
		].map((commands) => ({ commands }))
	)('rejects malformed path %#', ({ commands }) =>
		expect(() => validatePath(commands)).toThrow(AnimationValidationError)
	);

	it('rejects paths beyond the exported command limit', () => {
		expect(() =>
			validatePath(
				Array.from({ length: ANIMATION_LIMITS.maxPathCommands + 1 }, () => ({
					type: 'M',
					x: 0,
					y: 0
				}))
			)
		).toThrow(/commands/);
	});

	it.each([
		{ x: Infinity },
		{ y: -1_000_001 },
		{ rotation: 1_000_001 },
		{ scaleX: 0 },
		{ scaleX: -1 },
		{ scaleY: 101 },
		{ scaleY: 0.001 }
	])('rejects unsafe transform %j', (patch) => {
		expect(() => validateTransform({ ...identityTransform(), ...patch })).toThrow(
			AnimationValidationError
		);
	});

	it('bounds easing x and y but permits safe overshoot', () => {
		const easing = { type: 'bezier', x1: 0.2, y1: -1, x2: 0.8, y2: 2 };
		expect(validateEasing(easing)).toEqual(easing);
		for (const patch of [{ x1: -0.1 }, { x2: 1.1 }, { y1: -11 }, { y2: 11 }, { y2: NaN }])
			expect(() => validateEasing({ ...easing, ...patch })).toThrow(AnimationValidationError);
		expect(() => validateEasing({ type: 'hold', x1: 0 })).toThrow();
	});
});

describe('vector core assets', () => {
	const asset = {
		id: 'asset',
		name: 'Image',
		kind: 'raster',
		mimeType: 'image/png',
		width: 512,
		height: 512,
		byteLength: 1000,
		source: 'file',
		blobKey: 'asset/blob',
		createdAt: '2026-08-31T00:00:00.000Z'
	};
	it('validates asset metadata without admitting byte payloads or external objects', () => {
		expect(validateAsset(asset)).toEqual(asset);
		for (const patch of [
			{ byteLength: ANIMATION_LIMITS.maxAssetBytes + 1 },
			{ mimeType: 'text/html' },
			{ kind: 'vector' },
			{ width: 0 },
			{ data: 'base64' },
			{ blob: new Blob() }
		])
			expect(() => validateAsset({ ...asset, ...patch })).toThrow(AnimationValidationError);
		const project = projectWithLayer();
		project.assets = [validateAsset(asset), validateAsset(asset)];
		expect(() => parseProject(project)).toThrow(/Duplicate/);
	});
});
