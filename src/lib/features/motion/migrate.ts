import { parseProject } from '../animation/validation';
import { evaluateLayer } from '../animation/interpolation';
import { exportSvg as exportVectorSvg } from '../export/vector';
import {
	check,
	createProject,
	createLayer,
	uid,
	presets,
	validateProject,
	type Project
} from './model';
import { dataUrl, sanitizeSvg } from './assets';
/** Copies v1 static geometry into v2; never writes/deletes the original database record. */
export function migrateVector(input: unknown): Project {
	const source = parseProject(input),
		p = createProject(`${source.name.slice(0, 180)} (motion copy)`);
	p.composition = {
		...source.canvas,
		fps: source.timeline.fps,
		durationFrames: source.timeline.frameCount
	};
	check(
		/^#[0-9a-f]{6}$/i.test(p.composition.background),
		'Convert the v1 background to a six-digit hex color before migration'
	);
	for (const old of [...source.layers].sort((a, b) => a.zIndex - b.zIndex)) {
		const snapshots = Object.entries(old.keyframes).sort((a, b) => Number(a[0]) - Number(b[0]));
		if (!snapshots.length) continue;
		const first = snapshots[0][1];
		check(
			snapshots.every(([, k]) => JSON.stringify(k.paths) === JSON.stringify(first.paths)),
			`“${old.name}” morphs paths. Keep editing this project in the previous vector editor; migration would lose motion.`
		);
		const xs: number[] = [],
			ys: number[] = [];
		for (const path of first.paths)
			for (const command of path)
				for (const [key, v] of Object.entries(command)) {
					if (key.startsWith('x')) xs.push(Number(v));
					if (key.startsWith('y')) ys.push(Number(v));
				}
		check(xs.length && ys.length, `“${old.name}” has no drawable geometry`);
		const pad = Math.max(1, old.style.strokeWidth * 2);
		const minX = Math.min(...xs) - pad,
			minY = Math.min(...ys) - pad,
			w = Math.max(...xs) - minX + pad,
			h = Math.max(...ys) - minY + pad;
		check(w <= 8192 && h <= 8192 && w * h <= 16e6, 'Legacy artwork exceeds import bounds');
		const visual = structuredClone(source);
		visual.canvas.background = '#00000000';
		visual.layers = [
			{
				...structuredClone(old),
				visible: true,
				style: { ...old.style, opacity: 1 },
				keyframes: {
					0: {
						...structuredClone(first),
						opacity: 1,
						transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
					}
				}
			}
		];
		const doc = new DOMParser().parseFromString(exportVectorSvg(visual, 0), 'image/svg+xml');
		const root = doc.documentElement;
		root.querySelector('rect')?.remove();
		for (const el of root.querySelectorAll('[data-layer-id]')) el.removeAttribute('data-layer-id');
		root.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
		root.setAttribute('width', String(w));
		root.setAttribute('height', String(h));
		const clean = sanitizeSvg(new XMLSerializer().serializeToString(root)),
			assetId = uid();
		p.assets.push({
			id: assetId,
			name: `${old.name}.svg`,
			mime: 'image/svg+xml',
			width: clean.width,
			height: clean.height,
			data: dataUrl(new TextEncoder().encode(clean.source), 'image/svg+xml')
		});
		const layer = createLayer('svg', old.name);
		layer.assetId = assetId;
		layer.visible = old.visible;
		layer.locked = old.locked;
		layer.tracks.width.defaultValue = w;
		layer.tracks.height.defaultValue = h;
		for (let f = 0; f < p.composition.durationFrames; f++) {
			const state = evaluateLayer(old, f);
			const t = state?.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
			const angle = (t.rotation * Math.PI) / 180,
				a = Math.cos(angle) * t.scaleX,
				b = Math.sin(angle) * t.scaleX,
				c = -Math.sin(angle) * t.scaleY,
				d = Math.cos(angle) * t.scaleY;
			const values = {
				positionX: t.x + a * (minX + w / 2) + c * (minY + h / 2) - w / 2,
				positionY: t.y + b * (minX + w / 2) + d * (minY + h / 2) - h / 2,
				scaleX: t.scaleX,
				scaleY: t.scaleY,
				rotation: t.rotation,
				opacity: state ? old.style.opacity * (state.opacity ?? 1) : 0
			};
			for (const [prop, value] of Object.entries(values))
				layer.tracks[prop].keys.push({ id: uid(), frame: f, value, easing: presets.hold });
		}
		p.layers.push(layer);
	}
	return validateProject(p);
}
