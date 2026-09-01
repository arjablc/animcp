import { evaluate, value, type Layer, type Project } from './model';
export function xml(v: unknown): string {
	return String(v)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function transform(l: Layer, frame: number) {
	return transformWithValues(l, frame);
}
function transformWithValues(l: Layer, frame: number, values: Partial<Record<string, number>> = {}) {
	const n = (property: string) => values[property] ?? value(l, property, frame);
	const w = Math.max(0.001, n('width')),
		h = Math.max(0.001, n('height'));
	return `translate(${n('positionX')} ${n('positionY')}) translate(${w / 2} ${h / 2}) rotate(${n('rotation')}) scale(${n('scaleX')} ${n('scaleY')}) translate(${-w / 2} ${-h / 2})`;
}
function inheritedValue(parent: Layer, child: Layer, property: string, frame: number) {
	const parentTrack = parent.tracks[property],
		childTrack = child.tracks[property];
	// A child with its own animation wins only for that animated property. The group's
	// default remains as its layout baseline, while the group's animated delta is ignored.
	return parentTrack.keys.length && childTrack?.keys.length
		? Number(parentTrack.defaultValue)
		: value(parent, property, frame);
}
export function ancestorTransform(p: Project, layer: Layer, frame: number) {
	const ancestors: { parent: Layer; child: Layer }[] = [];
	const seen = new Set<string>([layer.id]);
	let parentId = layer.parentId;
	let child = layer;
	while (parentId) {
		if (seen.has(parentId)) throw new Error('Group hierarchy contains a cycle');
		seen.add(parentId);
		const parent = p.layers.find((candidate) => candidate.id === parentId);
		if (!parent) break;
		ancestors.unshift({ parent, child });
		child = parent;
		parentId = parent.parentId;
	}
	return ancestors
		.map(({ parent, child }) =>
			transformWithValues(
				parent,
				frame,
				Object.fromEntries(
					['positionX', 'positionY', 'width', 'height', 'rotation', 'scaleX', 'scaleY'].map(
						(property) => [property, inheritedValue(parent, child, property, frame)]
					)
				)
			)
		)
		.join(' ');
}
export function ancestorOpacity(p: Project, layer: Layer, frame: number) {
	const seen = new Set<string>([layer.id]);
	let parentId = layer.parentId,
		child = layer,
		opacity = 1;
	while (parentId) {
		if (seen.has(parentId)) return 0;
		seen.add(parentId);
		const parent = p.layers.find((candidate) => candidate.id === parentId);
		if (!parent) return 0;
		opacity *= inheritedValue(parent, child, 'opacity', frame);
		child = parent;
		parentId = parent.parentId;
	}
	return clamp(opacity);
}
export function effectivelyVisible(p: Project, layer: Layer) {
	if (!layer.visible) return false;
	const seen = new Set<string>([layer.id]);
	let parentId = layer.parentId;
	while (parentId) {
		if (seen.has(parentId)) return false;
		seen.add(parentId);
		const parent = p.layers.find((candidate) => candidate.id === parentId);
		if (!parent || !parent.visible) return false;
		parentId = parent.parentId;
	}
	return true;
}
export function layerSvg(p: Project, l: Layer, f: number): string {
	const n = (key: string) => value(l, key, f),
		w = Math.max(0.001, n('width')),
		h = Math.max(0.001, n('height'));
	let defs = '',
		fill = xml(evaluate(l.tracks.fill, f));
	if (l.paint.type !== 'solid') {
		const id = `paint-${encodeURIComponent(l.id)}`,
			stops = l.paint.stops
				.map((id) => ({
					id,
					offset: clamp(n(`gradient.stop.${id}.offset`)),
					color: evaluate(l.tracks[`gradient.stop.${id}.color`], f),
					opacity: clamp(n(`gradient.stop.${id}.opacity`))
				}))
				.sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id))
				.map(
					(s) =>
						`<stop offset="${s.offset}" stop-color="${xml(s.color)}" stop-opacity="${s.opacity}"/>`
				)
				.join('');
		const geometry =
			l.paint.type === 'linear'
				? `x1="${n('gradient.startX') * w}" y1="${n('gradient.startY') * h}" x2="${n('gradient.endX') * w}" y2="${n('gradient.endY') * h}"`
				: `cx="${n('gradient.centerX') * w}" cy="${n('gradient.centerY') * h}" fx="${n('gradient.focalX') * w}" fy="${n('gradient.focalY') * h}" r="${Math.max(0.001, n('gradient.radius')) * Math.min(w, h)}"`;
		const tag = l.paint.type === 'linear' ? 'linearGradient' : 'radialGradient';
		defs = `<defs><${tag} id="${id}" gradientUnits="userSpaceOnUse" ${geometry}>${stops}</${tag}></defs>`;
		fill = `url(#${id})`;
	}
	const style = `fill="${fill}" fill-opacity="${clamp(n('paintOpacity'))}" stroke="${xml(evaluate(l.tracks.stroke, f))}" stroke-width="${Math.max(0, n('strokeWidth'))}"`;
	let content = '';
	if (l.type === 'rectangle')
		content = `<rect width="${w}" height="${h}" rx="${Math.max(0, Math.min(n('cornerRadius'), w / 2, h / 2))}" ${style}/>`;
	if (l.type === 'ellipse')
		content = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${style}/>`;
	if (l.type === 'text')
		content = `<text x="${l.textAlign === 'left' ? 0 : l.textAlign === 'center' ? w / 2 : w}" text-anchor="${l.textAlign === 'left' ? 'start' : l.textAlign === 'center' ? 'middle' : 'end'}" font-family="${xml(l.fontFamily)}" font-size="${l.fontSize}" font-weight="${l.fontWeight}" font-style="${l.fontStyle}" letter-spacing="${l.letterSpacing}" ${style}>${l.text
			.split('\n')
			.map(
				(line, index) => `<tspan x="${l.textAlign === 'left' ? 0 : l.textAlign === 'center' ? w / 2 : w}" y="${l.fontSize * (1 + index * l.lineHeight)}">${xml(line)}</tspan>`
			)
			.join('')}</text>`;
	if (l.type === 'svg' || l.type === 'png') {
		const a = p.assets.find((a) => a.id === l.assetId);
		if (a)
			content = `<image href="${xml(a.data)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
	}
	return `${defs}<g transform="${transform(l, f)}" opacity="${clamp(n('opacity'))}">${content}</g>`;
}
export function exportSvg(p: Project, frame: number) {
	const c = p.composition;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}"><rect width="100%" height="100%" fill="${c.background}"/>${p.layers
		.filter((l) => l.type !== 'group' && effectivelyVisible(p, l))
		.map(
			(l) =>
				`<g transform="${ancestorTransform(p, l, frame)}" opacity="${ancestorOpacity(p, l, frame)}">${layerSvg(p, l, frame)}</g>`
		)
		.join('')}</svg>`;
}
export function download(text: string | Blob, name: string, mime = 'application/json') {
	const blob = typeof text === 'string' ? new Blob([text], { type: mime }) : text;
	const url = URL.createObjectURL(blob),
		a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
