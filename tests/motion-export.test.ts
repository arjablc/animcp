import { it, expect } from 'vitest';
import {
	createProject,
	createLayer,
	setGradient,
	uid,
	presets,
	validateProject
} from '../src/lib/features/motion/model';
import { exportLottie } from '../src/lib/features/motion/lottie';
import { exportSvg } from '../src/lib/features/motion/render';
import { templates, fromTemplate } from '../src/lib/features/motion/templates';
it('all starter compositions satisfy the canonical model', () => {
	for (const t of templates) expect(validateProject(fromTemplate(t.id)).name).toBe(t.name);
});
it('exports shape motion, gradient animation and a composition background without dropping layers', async () => {
	const p = createProject();
	p.composition.durationFrames = 12;
	const l = createLayer('rectangle');
	setGradient(l, 'linear');
	const property = `gradient.stop.${l.paint.stops[0]}.opacity`;
	l.tracks[property].keys = [
		{ id: uid(), frame: 0, value: 0, easing: presets.linear },
		{ id: uid(), frame: 10, value: 1, easing: presets.linear }
	];
	p.layers.push(l);
	const doc = await exportLottie(p);
	expect(doc.layers).toHaveLength(2);
	expect(doc.layers[1]).toMatchObject({ ty: 1, sc: p.composition.background });
	expect(doc.layers[0]).toMatchObject({
		ty: 4,
		shapes: [{ ty: 'rc' }, { ty: 'gf', g: { p: 2 } }, { ty: 'st' }]
	});
	expect(exportSvg(p, 5)).toContain('stop-opacity="0.5"');
});
it('blocks unsupported radial focal-point export instead of changing it', async () => {
	const p = createProject();
	const l = createLayer('ellipse');
	setGradient(l, 'radial');
	l.tracks['gradient.focalX'].defaultValue = 0.7;
	p.layers.push(l);
	await expect(exportLottie(p)).rejects.toThrow(/off-center/);
});
