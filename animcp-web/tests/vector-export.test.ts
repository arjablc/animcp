import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
	AnimationProject,
	PathData,
	ShapeKeyframe,
	VectorLayer
} from '../src/lib/features/animation/model';
import { ANIMATION_LIMITS } from '../src/lib/features/animation/model';
import {
	downloadBlob,
	exportLottie,
	exportSvg,
	importProject,
	MAX_PROJECT_BYTES,
	projectBlob
} from '../src/lib/features/export/vector';

const line: PathData = [
	{ type: 'M', x: 10, y: 20 },
	{ type: 'L', x: 30, y: 40 }
];

function keyframe(path: PathData = line): ShapeKeyframe {
	return {
		paths: [structuredClone(path)],
		transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
		easing: { type: 'linear' }
	};
}

function layer(id = 'stroke', zIndex = 0): VectorLayer {
	return {
		id,
		name: id,
		visible: true,
		locked: false,
		zIndex,
		style: {
			stroke: '#00c3ff',
			strokeWidth: 4,
			strokeLineCap: 'round',
			strokeLineJoin: 'round',
			fill: null,
			opacity: 1
		},
		keyframes: { 0: keyframe() }
	};
}

function project(): AnimationProject {
	return {
		version: 1,
		kind: 'vector-animation',
		id: 'project_test',
		name: 'Vector test',
		canvas: { width: 640, height: 480, background: '#111827' },
		timeline: { fps: 30, frameCount: 60 },
		layers: [layer()],
		assets: [],
		revision: 4,
		createdAt: '2026-08-31T00:00:00.000Z',
		updatedAt: '2026-08-31T00:00:00.000Z'
	};
}

function exportedGroup(document = exportLottie(project()), layerIndex = 0) {
	const group = document.layers[layerIndex].shapes[0];
	if (group.ty !== 'gr') throw new Error('Expected a shape group.');
	return group;
}

function exportedPath(document = exportLottie(project()), index = 0) {
	const shape = exportedGroup(document).it[index];
	if (shape.ty !== 'sh') throw new Error('Expected a path.');
	return shape;
}

function staticPath(document = exportLottie(project()), index = 0) {
	const { ks } = exportedPath(document, index);
	if (ks.a !== 0) throw new Error('Expected a static path.');
	return ks.k;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('native vector project JSON', () => {
	it('round-trips a detached canonical document, including asset metadata and animated opacity', async () => {
		const original = project();
		original.layers[0].keyframes[20] = { ...keyframe(), generated: true, opacity: 0.3 };
		original.assets.push({
			id: 'asset_1',
			name: 'Reference',
			kind: 'raster',
			mimeType: 'image/png',
			width: 10,
			height: 10,
			byteLength: 120,
			source: 'file',
			blobKey: 'asset_blob',
			createdAt: original.createdAt
		});
		const blob = projectBlob(original);
		expect(blob.type).toBe('application/json');
		const imported = importProject(await blob.text());
		expect(imported).toEqual(original);
		imported.layers[0].keyframes[0].transform.x = 200;
		expect(original.layers[0].keyframes[0].transform.x).toBe(0);
	});

	it.each(['{', 'null', '[]', '{}', '{"version":2}', '{"__proto__":{"polluted":true}}'])(
		'rejects malformed or unsupported JSON: %s',
		(json) => {
			expect(() => importProject(json)).toThrow();
			expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
		}
	);

	it('validates nested geometry and project bounds before import or export', () => {
		const invalid = project();
		invalid.layers[0].keyframes[0].paths[0] = [{ type: 'L', x: 0, y: 0 }];
		expect(() => importProject(JSON.stringify(invalid))).toThrow(/subpath|M/);
		expect(() => projectBlob(invalid)).toThrow();
		invalid.canvas.width = 99999;
		expect(() => exportSvg(invalid, 0)).toThrow();
		expect(() => exportLottie(invalid)).toThrow();
	});

	it('rejects oversized input before JSON parsing and measures UTF-8 bytes', () => {
		expect(() => importProject(' '.repeat(MAX_PROJECT_BYTES + 1))).toThrow(/size limit/);
		expect(() => importProject('界'.repeat(Math.floor(MAX_PROJECT_BYTES / 3) + 1))).toThrow(
			/size limit/
		);
	});

	it('rejects cyclic objects, non-finite numbers, getters, and toJSON hooks without invoking them', () => {
		const cyclic = project();
		Object.assign(cyclic, { extra: cyclic });
		expect(() => projectBlob(cyclic)).toThrow();
		const invalid = project();
		invalid.layers[0].keyframes[0].transform.x = Infinity;
		expect(() => projectBlob(invalid)).toThrow(/finite/);
		const accessor = project();
		const getter = vi.fn(() => 'unsafe');
		Object.defineProperty(accessor, 'name', { enumerable: true, get: getter });
		expect(() => projectBlob(accessor)).toThrow();
		expect(getter).not.toHaveBeenCalled();
		const hook = vi.fn(() => project());
		const hooked = Object.assign(project(), { toJSON: hook });
		expect(() => exportLottie(hooked)).toThrow();
		expect(hook).not.toHaveBeenCalled();
	});
});

describe('current-frame SVG', () => {
	it('includes canvas, background, geometry, style, transforms, and compounded opacity', () => {
		const input = project();
		const stroke = input.layers[0];
		stroke.style = {
			...stroke.style,
			stroke: '#abc8',
			fill: '#ff0000',
			opacity: 0.8,
			strokeLineCap: 'square',
			strokeLineJoin: 'bevel'
		};
		stroke.keyframes[0].opacity = 0.5;
		stroke.keyframes[0].transform = { x: 12, y: -4, rotation: 30, scaleX: 2, scaleY: 0.5 };
		const svg = exportSvg(input, 0);
		expect(svg).toContain('width="640" height="480" viewBox="0 0 640 480"');
		expect(svg).toContain('<rect width="640" height="480" fill="#111827"');
		expect(svg).toContain('d="M 10 20 L 30 40"');
		expect(svg).toContain('transform="translate(12 -4) rotate(30) scale(2 0.5)" opacity="0.4"');
		expect(svg).toContain('stroke="#aabbcc"');
		expect(svg).toContain(`stroke-opacity="${136 / 255}"`);
		expect(svg).toContain('stroke-linecap="square" stroke-linejoin="bevel"');
		expect(svg).toContain('fill="#ff0000"');
	});

	it('evaluates an in-between frame without mutating the input', () => {
		const input = project();
		input.layers[0].keyframes[10] = keyframe([
			{ type: 'M', x: 20, y: 30 },
			{ type: 'L', x: 40, y: 50 }
		]);
		input.layers[0].keyframes[10].transform.x = 100;
		input.layers[0].keyframes[10].opacity = 0;
		const before = structuredClone(input);
		const svg = exportSvg(input, 5);
		expect(svg).toContain('d="M 15 25 C ');
		expect(svg).toContain('35 45"');
		expect(svg).toContain('translate(50 0)');
		expect(svg).toContain('opacity="0.5"');
		expect(input).toEqual(before);
	});

	it('escapes names and refuses executable markup and external paint references', () => {
		const input = project();
		input.name = '<script>alert("x")</script>&';
		input.layers[0].name = '<image href="https://invalid.example"/>';
		const svg = exportSvg(input, 0);
		expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;');
		expect(svg).not.toContain('<script');
		expect(svg).not.toContain('<image');
		input.layers[0].style.stroke = 'url(https://invalid.example/paint)';
		expect(() => exportSvg(input, 0)).toThrow();
		input.layers[0].style.stroke = '#fff" onload="alert(1)';
		expect(() => exportSvg(input, 0)).toThrow();
	});

	it('uses z-order, excludes invisible and empty layers, and includes locked layers', () => {
		const input = project();
		input.layers = [layer('front', 3), layer('back', 0), layer('hidden', 1), layer('empty', 2)];
		input.layers[1].locked = true;
		input.layers[2].visible = false;
		input.layers[3].keyframes = {};
		const svg = exportSvg(input, 0);
		expect(svg.indexOf('data-layer-id="back"')).toBeLessThan(svg.indexOf('data-layer-id="front"'));
		expect(svg).not.toContain('data-layer-id="hidden"');
		expect(svg).not.toContain('data-layer-id="empty"');
	});

	it.each([-1, 60, 0.5, NaN, Infinity])('rejects out-of-range/noninteger frame %s', (frame) => {
		expect(() => exportSvg(project(), frame)).toThrow(/frame/);
	});
});

describe('supported vector Lottie', () => {
	it('exports deterministic document timing, line vertices, and zero tangents', () => {
		const input = project();
		const before = structuredClone(input);
		const result = exportLottie(input);
		expect(result).toMatchObject({
			v: '5.12.2',
			w: 640,
			h: 480,
			fr: 30,
			ip: 0,
			op: 60,
			assets: []
		});
		expect(result.layers[0]).toMatchObject({ ty: 4, ind: 1, ip: 0, op: 60, st: 0, sr: 1 });
		expect(staticPath(result)).toEqual({
			v: [
				[10, 20],
				[30, 40]
			],
			i: [
				[0, 0],
				[0, 0]
			],
			o: [
				[0, 0],
				[0, 0]
			],
			c: false
		});
		expect(JSON.stringify(exportLottie(input))).toBe(JSON.stringify(result));
		expect(input).toEqual(before);
	});

	it('converts absolute cubic controls to vertex-relative incoming and outgoing handles', () => {
		const input = project();
		input.layers[0].keyframes[0] = keyframe([
			{ type: 'M', x: 10, y: 20 },
			{ type: 'C', x1: 15, y1: 7, x2: 37, y2: 45, x: 30, y: 40 }
		]);
		expect(staticPath(exportLottie(input))).toEqual({
			v: [
				[10, 20],
				[30, 40]
			],
			i: [
				[0, 0],
				[7, 5]
			],
			o: [
				[5, -13],
				[0, 0]
			],
			c: false
		});
	});

	it('preserves closed cubic handles when the last endpoint duplicates the first vertex', () => {
		const input = project();
		input.layers[0].keyframes[0] = keyframe([
			{ type: 'M', x: 10, y: 20 },
			{ type: 'C', x1: 15, y1: 7, x2: 37, y2: 45, x: 30, y: 40 },
			{ type: 'C', x1: 25, y1: 50, x2: 4, y2: 30, x: 10, y: 20 },
			{ type: 'Z' }
		]);
		expect(staticPath(exportLottie(input))).toEqual({
			v: [
				[10, 20],
				[30, 40]
			],
			i: [
				[-6, 10],
				[7, 5]
			],
			o: [
				[5, -13],
				[-5, 10]
			],
			c: true
		});
	});

	it('preserves implicit straight closing edges and does not close an unclosed loop', () => {
		const input = project();
		input.layers[0].keyframes[0] = keyframe([...line, { type: 'Z' }]);
		expect(staticPath(exportLottie(input))).toMatchObject({
			c: true,
			i: [
				[0, 0],
				[0, 0]
			],
			o: [
				[0, 0],
				[0, 0]
			]
		});
		input.layers[0].keyframes[0] = keyframe([...line, { type: 'L', x: 10, y: 20 }]);
		expect(staticPath(exportLottie(input))).toMatchObject({
			c: false,
			v: [
				[10, 20],
				[30, 40],
				[10, 20]
			]
		});
	});

	it('keeps multiple subpaths separate under one fill so compound holes remain intact', () => {
		const input = project();
		input.layers[0].style.fill = '#ff0000';
		input.layers[0].keyframes[0] = keyframe([
			...line,
			{ type: 'Z' },
			{ type: 'M', x: 50, y: 50 },
			{ type: 'C', x1: 60, y1: 50, x2: 60, y2: 60, x: 50, y: 60 }
		]);
		const result = exportLottie(input);
		expect(staticPath(result, 0).c).toBe(true);
		expect(staticPath(result, 1)).toMatchObject({
			c: false,
			v: [
				[50, 50],
				[50, 60]
			],
			o: [
				[10, 0],
				[0, 0]
			],
			i: [
				[0, 0],
				[10, 0]
			]
		});
		expect(exportedGroup(result).it.map(({ ty }) => ty)).toEqual(['sh', 'sh', 'st', 'fl', 'tr']);
		expect(exportedGroup(result).it.find(({ ty }) => ty === 'fl')).toMatchObject({ r: 1 });
	});

	it('reverses layer paint order and puts a real background layer at the bottom', () => {
		const input = project();
		input.layers = [layer('back', 0), layer('front', 2), layer('hidden', 1), layer('empty', 3)];
		input.layers[2].visible = false;
		input.layers[3].keyframes = {};
		const result = exportLottie(input);
		expect(result.layers.map(({ nm }) => nm)).toEqual(['front', 'back', 'Background']);
		expect(result.layers.map(({ ind }) => ind)).toEqual([1, 2, 3]);
		const background = result.layers[2];
		expect(background.shapes[0]).toMatchObject({
			ks: {
				a: 0,
				k: {
					v: [
						[0, 0],
						[640, 0],
						[640, 480],
						[0, 480]
					],
					c: true
				}
			}
		});
		input.canvas.background = 'transparent';
		expect(exportLottie(input).layers.map(({ nm }) => nm)).toEqual(['front', 'back']);
	});

	it('maps animated position, scale, rotation, and opacity with outgoing easing', () => {
		const input = project();
		const stroke = input.layers[0];
		stroke.style.opacity = 0.8;
		stroke.keyframes[0].easing = { type: 'bezier', x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.9 };
		stroke.keyframes[30] = keyframe();
		stroke.keyframes[30].transform = { x: 100, y: -20, scaleX: 2, scaleY: 0.5, rotation: 90 };
		stroke.keyframes[30].opacity = 0.25;
		const { ks } = exportLottie(input).layers[0];
		expect(ks.p).toEqual({
			a: 1,
			k: [
				{
					t: 0,
					s: [0, 0, 0],
					e: [100, -20, 0],
					o: { x: [0.2], y: [0.1] },
					i: { x: [0.7], y: [0.9] }
				},
				{ t: 30, s: [100, -20, 0], h: 1 }
			]
		});
		expect(ks.s).toMatchObject({
			a: 1,
			k: [{ s: [100, 100, 100], e: [200, 50, 100] }, { s: [200, 50, 100] }]
		});
		expect(ks.r).toMatchObject({ a: 1, k: [{ s: [0], e: [90] }, { s: [90] }] });
		expect(ks.o).toMatchObject({ a: 1, k: [{ s: [80], e: [20] }, { s: [20] }] });
		expect(ks.a).toEqual({ a: 0, k: [0, 0, 0] });
	});

	it('exports shape keyframes, hold easing, and first/last frame timing', () => {
		const input = project();
		input.layers[0].keyframes = {
			5: keyframe(),
			59: keyframe([
				{ type: 'M', x: 20, y: 30 },
				{ type: 'L', x: 40, y: 50 }
			])
		};
		input.layers[0].keyframes[5].easing = { type: 'hold' };
		const result = exportLottie(input);
		const { ks } = exportedPath(result);
		expect(ks.a).toBe(1);
		if (ks.a !== 1) throw new Error('Expected animated geometry.');
		expect(ks.k[0]).toMatchObject({
			t: 5,
			h: 1,
			s: [
				{
					v: [
						[10, 20],
						[30, 40]
					]
				}
			],
			e: [
				{
					v: [
						[20, 30],
						[40, 50]
					]
				}
			]
		});
		expect(ks.k[0]).not.toHaveProperty('i');
		expect(ks.k[1]).toMatchObject({ t: 59, h: 1 });
		expect(result.layers[0]).toMatchObject({ ip: 5, op: 60 });
		expect(exportSvg(input, 0)).not.toContain('<path');
		expect(exportSvg(input, 5)).toContain('d="M 10 20 L 30 40"');
	});

	it.each(['vertices', 'closure', 'subpaths'])(
		'clearly rejects incompatible %s across keyframes',
		(change) => {
			const input = project();
			let path = structuredClone(line);
			if (change === 'vertices') path.push({ type: 'L', x: 50, y: 50 });
			if (change === 'closure') path.push({ type: 'Z' });
			if (change === 'subpaths') path = [...path, ...line];
			input.layers[0].keyframes[30] = keyframe(path);
			expect(() => exportLottie(input)).toThrow(/matching.*subpaths.*vertices.*closure/);
		}
	);

	it('maps all cap/join enums, fractional RGB channels, and paint alpha separately from layer opacity', () => {
		const input = project();
		input.layers[0].style.stroke = 'rgba(12.5, 100, 255, 0.25)';
		input.layers[0].style.fill = '#abcd';
		input.layers[0].style.opacity = 0.4;
		for (const [cap, join, value] of [
			['butt', 'miter', 1],
			['round', 'round', 2],
			['square', 'bevel', 3]
		] as const) {
			input.layers[0].style.strokeLineCap = cap;
			input.layers[0].style.strokeLineJoin = join;
			const result = exportLottie(input);
			expect(exportedGroup(result).it.find(({ ty }) => ty === 'st')).toMatchObject({
				lc: value,
				lj: value,
				c: { a: 0, k: [12.5 / 255, 100 / 255, 1] },
				o: { a: 0, k: 25 }
			});
			expect(exportedGroup(result).it.find(({ ty }) => ty === 'fl')).toMatchObject({
				o: { a: 0, k: (221 / 255) * 100 }
			});
			expect(result.layers[0].ks.o).toEqual({ a: 0, k: 40 });
		}
		expect(exportSvg(input, 0)).toContain('stroke="rgb(12.5,100,255)" stroke-opacity="0.25"');
	});

	it("uses the evaluator's linear cubic handles when a line morphs into a cubic", () => {
		const input = project();
		input.layers[0].keyframes[30] = keyframe([
			{ type: 'M', x: 10, y: 20 },
			{ type: 'C', x1: 10, y1: 50, x2: 30, y2: 60, x: 30, y: 40 }
		]);
		const { ks } = exportedPath(exportLottie(input));
		if (ks.a !== 1) throw new Error('Expected animated geometry.');
		expect(ks.k[0].s[0].o[0][0]).toBeCloseTo(20 / 3);
		expect(ks.k[0].s[0].o[0][1]).toBeCloseTo(20 / 3);
		expect(ks.k[0].s[0].i[1][0]).toBeCloseTo(-20 / 3);
		expect(ks.k[1].s[0].o[0]).toEqual([0, 30]);
	});

	it('samples generated overrides without letting them change neighboring authored interpolation', () => {
		const input = project();
		input.layers[0].keyframes[10] = keyframe();
		input.layers[0].keyframes[10].transform.x = 100;
		input.layers[0].keyframes[5] = { ...keyframe(), generated: true };
		input.layers[0].keyframes[5].transform.x = 500;
		const { p } = exportLottie(input).layers[0].ks;
		if (p.a !== 1) throw new Error('Expected animated position.');
		expect(p.k.find(({ t }) => t === 4)).toMatchObject({ s: [40, 0, 0], h: 1 });
		expect(p.k.find(({ t }) => t === 5)).toMatchObject({ s: [500, 0, 0], h: 1 });
		expect(p.k.find(({ t }) => t === 6)).toMatchObject({ s: [60, 0, 0], h: 1 });
	});

	it('keeps a generated-only key visible for exactly its own frame', () => {
		const input = project();
		input.layers[0].keyframes = { 5: { ...keyframe(), generated: true } };
		const result = exportLottie(input);
		expect(result.layers[0].ip).toBe(5);
		const { o } = result.layers[0].ks;
		if (o.a !== 1) throw new Error('Expected animated opacity.');
		expect(o.k[0]).toMatchObject({ t: 5, s: [100], h: 1 });
		expect(o.k[1]).toMatchObject({ t: 6, s: [0], h: 1 });
		expect(o.k.at(-1)).toMatchObject({ t: 59, s: [0] });
	});

	it("samples overshooting easing so opacity remains within the evaluator's clamped range", () => {
		const input = project();
		input.layers[0].keyframes[0].easing = { type: 'bezier', x1: 0.1, y1: 2, x2: 0.9, y2: 2 };
		input.layers[0].keyframes[0].opacity = 0;
		input.layers[0].keyframes[10] = keyframe();
		const { o } = exportLottie(input).layers[0].ks;
		if (o.a !== 1) throw new Error('Expected animated opacity.');
		expect(o.k.find(({ t }) => t === 5)).toMatchObject({ s: [100], h: 1 });
		expect(o.k.every(({ s }) => s[0] >= 0 && s[0] <= 100)).toBe(true);
	});

	it('rejects excessive sampled output before expanding a long timeline', () => {
		const input = project();
		input.timeline.frameCount = 1800;
		input.layers[0].keyframes[0] = {
			...keyframe(
				Array.from({ length: 200 }, (_, index) => ({
					type: index === 0 ? 'M' : 'L',
					x: index,
					y: 0
				}))
			),
			generated: true
		};
		expect(() => exportLottie(input)).toThrow(/sampling.*complexity limit/);
	});

	it.each([
		'transparent',
		'black',
		'white',
		'red',
		'green',
		'blue',
		'yellow',
		'cyan',
		'magenta',
		'gray',
		'grey',
		'orange',
		'purple',
		'pink',
		'brown',
		'navy',
		'teal',
		'lime',
		'silver',
		'maroon',
		'olive',
		'aqua',
		'fuchsia',
		'rgb(0, 128, 255)',
		'#abc',
		'#abcd',
		'#aabbcc',
		'#aabbccdd'
	])('supports validated paint %s', (paint) => {
		const input = project();
		input.canvas.background = paint;
		input.layers[0].style.stroke = paint;
		input.layers[0].style.fill = paint;
		expect(() => exportLottie(input)).not.toThrow();
		expect(() => exportSvg(input, 0)).not.toThrow();
	});

	it('rejects oversized layers and path arrays, and arithmetic overflow in derived values', () => {
		const input = project();
		input.layers = Array.from({ length: ANIMATION_LIMITS.maxLayers + 1 }, (_, index) =>
			layer(`layer_${index}`, index)
		);
		expect(() => exportLottie(input)).toThrow(/layer|size|limit/i);
		input.layers = [layer()];
		input.layers[0].keyframes[0].paths[0] = Array.from(
			{ length: ANIMATION_LIMITS.maxPathCommands + 1 },
			() => ({ type: 'M', x: 0, y: 0 })
		);
		expect(() => exportLottie(input)).toThrow(/path|limit/i);
		input.layers[0] = layer();
		input.layers[0].keyframes[0].transform.scaleX = Number.MAX_VALUE;
		expect(() => exportLottie(input)).toThrow(/finite/);
	});
});

describe('download helper', () => {
	it('requires a browser without affecting pure export APIs', () => {
		vi.stubGlobal('document', undefined);
		expect(() => downloadBlob(new Blob(['{}']), 'project.json')).toThrow(/browser/);
		expect(() => exportLottie(project())).not.toThrow();
	});

	it('sanitizes the filename, clicks once, removes the anchor, and revokes the URL after consumption', () => {
		vi.useFakeTimers();
		const anchor = {
			href: '',
			download: '',
			style: { display: '' },
			click: vi.fn(),
			remove: vi.fn()
		};
		const appendChild = vi.fn();
		vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const blob = new Blob(['{}']);
		downloadBlob(blob, '../name\n.json');
		expect(create).toHaveBeenCalledWith(blob);
		expect(anchor.href).toBe('blob:test');
		expect(anchor.download).toBe('.._name_.json');
		expect(appendChild).toHaveBeenCalledWith(anchor);
		expect(anchor.click).toHaveBeenCalledOnce();
		expect(anchor.remove).toHaveBeenCalledOnce();
		expect(revoke).not.toHaveBeenCalled();
		vi.runAllTimers();
		expect(revoke).toHaveBeenCalledWith('blob:test');
	});

	it('cleans up even when clicking the download fails', () => {
		vi.useFakeTimers();
		const anchor = {
			href: '',
			download: '',
			style: {},
			click: () => {
				throw new Error('blocked');
			},
			remove: vi.fn()
		};
		vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		expect(() => downloadBlob(new Blob(), '')).toThrow('blocked');
		expect(anchor.remove).toHaveBeenCalledOnce();
		vi.runAllTimers();
		expect(revoke).toHaveBeenCalledWith('blob:failed');
	});
});
