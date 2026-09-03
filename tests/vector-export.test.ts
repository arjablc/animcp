import { describe, expect, it, vi } from 'vitest';
import type {
	AnimationProject,
	PathData,
	ShapeKeyframe,
	VectorLayer
} from '../src/lib/features/animation/model';
import { exportSvg } from '../src/lib/features/export/vector';

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

describe('current-frame SVG', () => {
	it('exports canvas, interpolated geometry, transforms, style, opacity, and z-order', () => {
		const input = project();
		input.layers[0].style = {
			...input.layers[0].style,
			stroke: '#abc8',
			fill: '#ff0000',
			opacity: 0.8,
			strokeLineCap: 'square',
			strokeLineJoin: 'bevel'
		};
		input.layers[0].keyframes[0].opacity = 0.5;
		input.layers[0].keyframes[10] = keyframe([
			{ type: 'M', x: 20, y: 30 },
			{ type: 'L', x: 40, y: 50 }
		]);
		input.layers[0].keyframes[10].transform.x = 100;
		input.layers[0].keyframes[10].opacity = 0.5;
		input.layers[0].zIndex = 1;
		input.layers.push(layer('back', 0), layer('hidden', 2));
		input.layers[2].visible = false;
		const before = structuredClone(input);
		const svg = exportSvg(input, 5);
		expect(svg).toContain('width="640" height="480" viewBox="0 0 640 480"');
		expect(svg).toContain('<rect width="640" height="480" fill="#111827"');
		expect(svg).toContain('d="M 15 25 C ');
		expect(svg).toContain('translate(50 0)');
		expect(svg).toContain('opacity="0.4"');
		expect(svg).toContain('stroke="#aabbcc"');
		expect(svg).toContain(`stroke-opacity="${136 / 255}"`);
		expect(svg).toContain('fill="#ff0000"');
		expect(svg.indexOf('data-layer-id="back"')).toBeLessThan(svg.indexOf('data-layer-id="stroke"'));
		expect(svg).not.toContain('data-layer-id="hidden"');
		expect(input).toEqual(before);
	});

	it('escapes names and rejects unsafe paint and invalid frames', () => {
		const input = project();
		input.name = '<script>alert("x")</script>&';
		input.layers[0].name = '<image href="https://invalid.example"/>';
		const svg = exportSvg(input, 0);
		expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;');
		expect(svg).not.toContain('<script');
		expect(svg).not.toContain('<image');
		input.layers[0].style.stroke = 'url(https://invalid.example/paint)';
		expect(() => exportSvg(input, 0)).toThrow(/supported|safe/);
		for (const frame of [-1, 60, 0.5, NaN, Infinity])
			expect(() => exportSvg(project(), frame)).toThrow(/frame/);
	});

	it('validates untrusted projects without invoking accessors or serialization hooks', () => {
		const accessor = project();
		const getter = vi.fn(() => 'unsafe');
		Object.defineProperty(accessor, 'name', { enumerable: true, get: getter });
		expect(() => exportSvg(accessor, 0)).toThrow();
		expect(getter).not.toHaveBeenCalled();
		const hook = vi.fn(() => project());
		expect(() => exportSvg(Object.assign(project(), { toJSON: hook }), 0)).toThrow();
		expect(hook).not.toHaveBeenCalled();
		const invalid = project();
		invalid.canvas.width = 99999;
		expect(() => exportSvg(invalid, 0)).toThrow();
	});
});
