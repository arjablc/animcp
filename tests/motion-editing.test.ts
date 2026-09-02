import { describe, it, expect } from 'vitest';
import {
	createProject,
	createLayer,
	evaluate,
	setGradient,
	presets
} from '../src/lib/features/motion/model';
import { transact } from '../src/lib/features/motion/commands';
import {
	propertyEdits,
	propertyStep,
	animationSegments,
	keyframeMoveBounds,
	previewLayer
} from '../src/lib/features/motion/editing';
function fixture() {
	const p = createProject();
	p.layers.push(createLayer('rectangle'));
	return p;
}
describe('editor auto-key', () => {
	it('preserves the starting pose and interpolates the first later edit', () => {
		const p = fixture(),
			l = p.layers[0],
			before = Number(l.tracks.positionX.defaultValue);
		const next = transact(p, propertyEdits(l, { positionX: before + 120 }, 30, true)).project
			.layers[0];
		expect(next.tracks.positionX.keys.map((k) => k.frame)).toEqual([0, 30]);
		expect(evaluate(next.tracks.positionX, 0)).toBe(before);
		expect(evaluate(next.tracks.positionX, 15)).toBe(before + 60);
		expect(evaluate(next.tracks.positionX, 30)).toBe(before + 120);
		expect(l.tracks.positionX.keys).toHaveLength(0);
	});
	it('edits static values without keys when auto-key is off', () => {
		const p = fixture();
		const next = transact(p, propertyEdits(p.layers[0], { rotation: 45 }, 30, false)).project
			.layers[0];
		expect(next.tracks.rotation.keys).toHaveLength(0);
		expect(evaluate(next.tracks.rotation, 0)).toBe(45);
	});
	it('adjusts an existing animation without creating a key when auto-key is off', () => {
		let p = fixture();
		p = transact(p, propertyEdits(p.layers[0], { rotation: 20 }, 20, true)).project;
		p = transact(p, propertyEdits(p.layers[0], { rotation: 100 }, 10, false)).project;
		const track = p.layers[0].tracks.rotation;
		expect(track.keys.map((k) => [k.frame, k.value])).toEqual([
			[0, 90],
			[20, 110]
		]);
		expect(track.keys).toHaveLength(2);
		expect(evaluate(track, 10)).toBe(100);
	});
	it.each(['opacity', 'drawStart', 'drawEnd'])('keeps %s edits visible with auto-key off', (property) => {
		let p = fixture();
		const layer = p.layers[0];
		if (property.startsWith('draw')) {
			layer.type = 'path';
			layer.paths = [
				[
					{ type: 'M', x: 0, y: 0 },
					{ type: 'L', x: 100, y: 100 }
				]
			];
			layer.tracks.drawStart = { defaultValue: 0, keys: [] };
			layer.tracks.drawEnd = { defaultValue: 1, keys: [] };
		}
		p = transact(p, propertyEdits(p.layers[0], { [property]: 0 }, 0, true)).project;
		p = transact(p, propertyEdits(p.layers[0], { [property]: 1 }, 20, true)).project;
		p = transact(p, propertyEdits(p.layers[0], { [property]: 0 }, 20, false)).project;
		const track = p.layers[0].tracks[property];
		expect(track.keys).toHaveLength(2);
		expect(evaluate(track, 20)).toBe(0);
		expect(track.keys.every((key) => key.value === 0)).toBe(true);
	});
	it('uses fractional input steps for normalized draw properties', () => {
		expect(propertyStep('drawStart')).toBe(0.01);
		expect(propertyStep('drawEnd')).toBe(0.01);
	});
	it('seeds gradient colors and handles using the same auto-key behavior', () => {
		const p = fixture(),
			l = p.layers[0];
		setGradient(l, 'linear');
		const color = `gradient.stop.${l.paint.stops[0]}.color`;
		const next = transact(
			p,
			propertyEdits(l, { [color]: '#ffffff', 'gradient.startX': 0.5 }, 20, true)
		).project.layers[0];
		expect(next.tracks[color].keys).toHaveLength(2);
		expect(next.tracks['gradient.startX'].keys.map((k) => k.frame)).toEqual([0, 20]);
	});
	it('keeps drag previews separate from the saved project and animation', () => {
		const p = fixture(),
			l = p.layers[0];
		const preview = previewLayer(l, { layerId: l.id, values: { positionX: 900 } });
		expect(evaluate(preview.tracks.positionX, 0)).toBe(900);
		expect(l.tracks.positionX.defaultValue).not.toBe(900);
		expect(previewLayer(l, null)).toBe(l);
	});
});
describe('animation bars', () => {
	it('maps each adjacent pair and changes only the selected outgoing easing', () => {
		let p = fixture(),
			l = p.layers[0];
		p = transact(p, propertyEdits(l, { rotation: 45 }, 20, true)).project;
		l = p.layers[0];
		p = transact(p, propertyEdits(l, { rotation: 90 }, 40, true)).project;
		l = p.layers[0];
		const segments = animationSegments(l, 'rotation');
		expect(segments.map((s) => [s.start.frame, s.end.frame])).toEqual([
			[0, 20],
			[20, 40]
		]);
		const next = transact(p, [
			{
				name: 'set_easing',
				input: { layerIds: [l.id], keyframeIds: [segments[0].start.id], easing: presets['ease-in'] }
			}
		]).project.layers[0];
		expect(next.tracks.rotation.keys[0].easing).toEqual(presets['ease-in']);
		expect(next.tracks.rotation.keys[1].easing).toEqual(presets.linear);
	});
});

describe('animation drag boundaries', () => {
	it('prevents crossing adjacent keys while allowing the selected pair to move together', () => {
		let p = fixture();
		for (const f of [10, 30, 50])
			p = transact(p, propertyEdits(p.layers[0], { rotation: f }, f, true)).project;
		const l = p.layers[0],
			keys = l.tracks.rotation.keys;
		expect(keyframeMoveBounds(l, 'rotation', [keys[1].id], 150)).toEqual([-9, 19]);
		expect(keyframeMoveBounds(l, 'rotation', [keys[1].id, keys[2].id], 150)).toEqual([-9, 19]);
		expect(keyframeMoveBounds(l, 'rotation', [keys[0].id], 150)).toEqual([0, 9]);
	});
});
