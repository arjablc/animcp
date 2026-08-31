import { describe, it, expect } from 'vitest';
import {
	createProject,
	createLayer,
	setGradient,
	track,
	uid,
	evaluate,
	presets,
	validateProject,
	type Key,
	type Project
} from '../src/lib/features/motion/model';
import { transact, findElements } from '../src/lib/features/motion/commands';
import { exportSvg } from '../src/lib/features/motion/render';
const key = (frame: number, value: number, easing = presets.linear): Key => ({
	id: uid(),
	frame,
	value,
	easing
});
function fixture() {
	const p = createProject();
	for (const text of ['Title', 'hello']) {
		const l = createLayer('text', 'unrelated name');
		l.text = text;
		l.tracks.positionY.keys = [key(10, 200), key(30, 100)];
		p.layers.push(l);
	}
	return p;
}
const run = (p: Project, name: string, input: Record<string, unknown>) =>
	transact(p, [{ name, input }]).project;
describe('motion tracks', () => {
	it('evaluates boundaries, hold, and asymmetric easing', () => {
		const t = track(12);
		expect(evaluate(t, 0)).toBe(12);
		t.keys = [key(10, 0, presets['strong-in']), key(30, 100)];
		expect(evaluate(t, 0)).toBe(0);
		expect(Number(evaluate(t, 20))).toBeLessThan(50);
		expect(evaluate(t, 100)).toBe(100);
		t.keys[0].easing = presets.hold;
		expect(evaluate(t, 29)).toBe(0);
		expect(evaluate(t, 30)).toBe(100);
	});
	it('evaluates gradient colors and preserves stop identities', () => {
		const p = createProject(),
			l = createLayer('rectangle');
		setGradient(l, 'linear');
		p.layers.push(l);
		const id = l.paint.stops[0],
			t = l.tracks[`gradient.stop.${id}.color`];
		t.keys = [
			{ id: uid(), frame: 0, value: '#000000', easing: presets.linear },
			{ id: uid(), frame: 10, value: '#ffffff', easing: presets.linear }
		];
		expect(evaluate(t, 5)).toBe('#808080');
		expect(exportSvg(p, 5)).toContain('stop-color="#808080"');
		expect(validateProject(p).layers[0].paint.stops[0]).toBe(id);
	});
	it('rejects collisions and active color values', () => {
		const p = fixture();
		p.layers[0].tracks.positionY.keys[1].frame = 10;
		expect(() => validateProject(p)).toThrow(/collision/);
		p.layers[0].tracks.positionY.keys[1].frame = 30;
		p.layers[0].tracks.fill.defaultValue = 'url(javascript:bad)';
		expect(() => validateProject(p)).toThrow(/hex/);
	});
	it('escapes text in SVG', () => {
		const p = fixture();
		p.layers[0].text = '<script>alert(1)</script>';
		expect(exportSvg(p, 0)).not.toContain('<script>');
		expect(exportSvg(p, 0)).toContain('&lt;script&gt;');
	});
});
describe('surgical transactions', () => {
	it('sequences by actual text without requiring layer names', () => {
		const p = fixture();
		const title = findElements(p, { text: 'Title' })[0],
			hello = findElements(p, { text: 'hello' })[0];
		const n = run(p, 'sequence_motion', { layerIds: [hello.id], referenceLayerId: title.id });
		expect(n.layers[1].tracks.positionY.keys.map((k) => [k.frame, k.value])).toEqual([
			[31, 200],
			[51, 100]
		]);
		expect(n.revision).toBe(1);
		expect(p.layers[1].tracks.positionY.keys[0].frame).toBe(10);
	});
	it('returns duplicate text candidates', () => {
		const p = fixture();
		p.layers[1].text = 'Title';
		expect(findElements(p, { text: 'Title' })).toHaveLength(2);
		expect(findElements(p, { text: 'missing' })).toHaveLength(0);
	});
	it('rejects ambiguous sequencing', () => {
		const p = fixture();
		p.layers[0].tracks.positionY.keys.push(key(50, 200));
		expect(() =>
			run(p, 'sequence_motion', { layerIds: [p.layers[1].id], referenceLayerId: p.layers[0].id })
		).toThrow(/ambiguous/);
	});
	it('rolls back an entire batch and preserves endpoints', () => {
		const p = fixture(),
			id = p.layers[0].id;
		expect(() =>
			transact(p, [
				{ name: 'shift_motion', input: { layerIds: [id], frames: 5 } },
				{ name: 'retime_motion', input: { layerIds: [id], scale: 0.001, anchor: 'end' } }
			])
		).toThrow(/collision/);
		expect(p.revision).toBe(0);
		p.layers[0].tracks.positionY.locks = { endFrame: true };
		expect(() => run(p, 'shift_motion', { layerIds: [id], frames: 1 })).toThrow(/protected/);
		const n = run(p, 'retime_motion', { layerIds: [id], scale: 0.5, anchor: 'end' });
		expect(n.layers[0].tracks.positionY.keys.map((k) => k.frame)).toEqual([20, 30]);
	});
	it('cannot override a human lock with preserve false', () => {
		const p = fixture();
		p.layers[0].tracks.positionY.locks = { endFrame: true };
		expect(() =>
			run(p, 'shift_motion', {
				layerIds: [p.layers[0].id],
				frames: 1,
				preserve: { endFrame: false }
			})
		).toThrow(/protected/);
	});
	it('copies relative motion with explicit end anchors', () => {
		const p = fixture();
		p.layers[1].tracks.positionY.keys = [key(0, 700), key(30, 500)];
		const n = run(p, 'copy_motion', {
			sourceLayerId: p.layers[0].id,
			targetLayerIds: [p.layers[1].id],
			properties: ['positionY'],
			mode: 'relative',
			sourceFrame: 30,
			targetFrame: 30
		});
		expect(n.layers[1].tracks.positionY.keys.map((k) => k.value)).toEqual([600, 500]);
	});
	it('adds overshoot without changing the protected final frame/value', () => {
		const p = fixture();
		p.layers[0].tracks.positionY.locks = { endFrame: true, endValue: true };
		const n = run(p, 'add_overshoot', {
			layerIds: [p.layers[0].id],
			properties: ['positionY'],
			amount: 0.1,
			settleFrames: 5
		});
		expect(n.layers[0].tracks.positionY.keys.map((k) => [k.frame, k.value])).toEqual([
			[10, 200],
			[25, 90],
			[30, 100]
		]);
	});
	it('reverses asymmetric easing as well as timing', () => {
		const p = fixture();
		p.layers[0].tracks.positionY.keys[0].easing = presets['strong-in'];
		const n = run(p, 'reverse_motion', { layerIds: [p.layers[0].id] });
		for (let f = 10; f <= 30; f++)
			expect(Number(evaluate(n.layers[0].tracks.positionY, f))).toBeCloseTo(
				Number(evaluate(p.layers[0].tracks.positionY, 40 - f)),
				5
			);
	});
	it('stagger preserves duration and rejects composition overflow', () => {
		const p = fixture();
		const n = run(p, 'stagger_motion', { layerIds: p.layers.map((l) => l.id), offsetFrames: 4 });
		expect(n.layers[1].tracks.positionY.keys.map((k) => k.frame)).toEqual([14, 34]);
		expect(() => run(p, 'shift_motion', { layerIds: [p.layers[0].id], frames: 150 })).toThrow();
	});
	it('allows a locked reference without modifying it', () => {
		const p = fixture();
		p.layers[0].locked = true;
		const n = run(p, 'sequence_motion', {
			layerIds: [p.layers[1].id],
			referenceLayerId: p.layers[0].id
		});
		expect(n.layers[0]).toEqual(p.layers[0]);
	});
});
