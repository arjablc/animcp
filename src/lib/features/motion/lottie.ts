import { check, evaluate, type Layer, type Project } from './model';
import { clamp } from './render';
import { rasterizeContent } from './rasterize';
import { loadProjectFonts } from './fonts';
// Frame-sampled export is explicit: integer-frame playback matches the editor evaluator.
export async function exportLottie(p: Project) {
	await loadProjectFonts(p.layers);
	const duration = p.composition.durationFrames;
	const sampled = (fn: (f: number) => unknown) => ({
		a: 1,
		k: Array.from({ length: duration }, (_, f) => ({ t: f, s: fn(f), h: 1 }))
	});
	const scalar = (l: Layer, prop: string, multiplier = 1) =>
		sampled((f) => [
			(prop === 'opacity' || prop === 'paintOpacity'
				? clamp(Number(evaluate(l.tracks[prop], f)))
				: Number(evaluate(l.tracks[prop], f))) * multiplier
		]);
	const rgb = (v: unknown) => [1, 3, 5].map((i) => parseInt(String(v).slice(i, i + 2), 16) / 255);
	const assets: Record<string, unknown>[] = [];
	const layers: Record<string, unknown>[] = [];
	for (const [index, l] of p.layers.entries()) {
		if (!l.visible) continue;
		const n = (prop: string, f = 0) => Number(evaluate(l.tracks[prop], f));
		const transform = {
			o: scalar(l, 'opacity', 100),
			r: scalar(l, 'rotation'),
			p: sampled((f) => [
				n('positionX', f) + n('width', f) / 2,
				n('positionY', f) + n('height', f) / 2,
				0
			]),
			a: sampled((f) => [n('width', f) / 2, n('height', f) / 2, 0]),
			s: sampled((f) => [n('scaleX', f) * 100, n('scaleY', f) * 100, 100])
		};
		const base = {
			ddd: 0,
			ind: index + 1,
			nm: l.name,
			sr: 1,
			ks: transform,
			ao: 0,
			ip: 0,
			op: duration,
			st: 0,
			bm: 0
		};
		if (l.type === 'rectangle' || l.type === 'ellipse') {
			const shape = {
				ty: l.type === 'rectangle' ? 'rc' : 'el',
				d: 1,
				p: sampled((f) => [n('width', f) / 2, n('height', f) / 2]),
				s: sampled((f) => [n('width', f), n('height', f)]),
				...(l.type === 'rectangle' ? { r: scalar(l, 'cornerRadius') } : {})
			};
			let fill: Record<string, unknown>;
			if (l.paint.type === 'solid')
				fill = {
					ty: 'fl',
					c: sampled((f) => rgb(evaluate(l.tracks.fill, f))),
					o: scalar(l, 'paintOpacity', 100),
					r: 1
				};
			else {
				check(
					l.paint.type !== 'radial' ||
						['focalX', 'focalY'].every((a, j) => {
							const b = j ? 'centerY' : 'centerX';
							return Array.from(
								{ length: duration },
								(_, f) => n(`gradient.${a}`, f) === n(`gradient.${b}`, f)
							).every(Boolean);
						}),
					`Lottie: ${l.name} has an off-center radial focal point. Use centered radial gradients or SVG/native export.`
				);
				fill = {
					ty: 'gf',
					t: l.paint.type === 'linear' ? 1 : 2,
					o: scalar(l, 'paintOpacity', 100),
					r: 1,
					s: sampled((f) =>
						l.paint.type === 'linear'
							? [n('gradient.startX', f) * n('width', f), n('gradient.startY', f) * n('height', f)]
							: [
									n('gradient.centerX', f) * n('width', f),
									n('gradient.centerY', f) * n('height', f)
								]
					),
					e: sampled((f) =>
						l.paint.type === 'linear'
							? [n('gradient.endX', f) * n('width', f), n('gradient.endY', f) * n('height', f)]
							: [
									n('gradient.centerX', f) * n('width', f) +
										n('gradient.radius', f) * Math.min(n('width', f), n('height', f)),
									n('gradient.centerY', f) * n('height', f)
								]
					),
					g: {
						p: l.paint.stops.length,
						k: sampled((f) => {
							const stops = l.paint.stops
								.map((id) => ({ id, offset: n(`gradient.stop.${id}.offset`, f) }))
								.sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
							return [
								...stops.flatMap((s) => [
									s.offset,
									...rgb(evaluate(l.tracks[`gradient.stop.${s.id}.color`], f))
								]),
								...stops.flatMap((s) => [s.offset, n(`gradient.stop.${s.id}.opacity`, f)])
							];
						})
					},
					h: { a: 0, k: 0 },
					a: { a: 0, k: 0 }
				};
			}
			const stroke = {
				ty: 'st',
				c: sampled((f) => rgb(evaluate(l.tracks.stroke, f))),
				o: { a: 0, k: 100 },
				w: scalar(l, 'strokeWidth'),
				lc: 1,
				lj: 1
			};
			layers.push({ ...base, ty: 4, shapes: [shape, fill, stroke] });
		} else {
			check(
				!l.tracks.width.keys.length && !l.tracks.height.keys.length,
				`Lottie: animate scale instead of width/height on ${l.name}`
			);
			check(
				Object.entries(l.tracks).every(
					([prop, t]) =>
						!t.keys.length ||
						['positionX', 'positionY', 'scaleX', 'scaleY', 'rotation', 'opacity'].includes(prop)
				),
				`Lottie: ${l.name} has animated paint/geometry; use native or SVG export`
			);
			const data = await rasterizeContent(p, l);
			const assetId = `asset_${l.id}`;
			assets.push({ id: assetId, w: n('width'), h: n('height'), u: '', p: data, e: 1 });
			layers.push({ ...base, ty: 2, refId: assetId });
		}
	}
	const doc = {
		v: '5.12.2',
		fr: p.composition.fps,
		ip: 0,
		op: duration,
		w: p.composition.width,
		h: p.composition.height,
		nm: p.name,
		ddd: 0,
		assets,
		layers: [
			...layers.reverse(),
			{
				ddd: 0,
				ind: p.layers.length + 1,
				ty: 1,
				nm: 'Composition background',
				sw: p.composition.width,
				sh: p.composition.height,
				sc: p.composition.background,
				ks: {
					o: { a: 0, k: 100 },
					r: { a: 0, k: 0 },
					p: { a: 0, k: [0, 0, 0] },
					a: { a: 0, k: [0, 0, 0] },
					s: { a: 0, k: [100, 100, 100] }
				},
				ip: 0,
				op: duration,
				st: 0,
				sr: 1
			}
		],
		meta: { generator: 'AniMCP frame-sampled motion exporter' }
	};
	check(JSON.stringify(doc).length < 50 * 1024 * 1024, 'Lottie output exceeds 50 MiB');
	return doc;
}
