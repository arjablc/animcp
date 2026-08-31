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
	const w = Math.max(0.001, value(l, 'width', frame)),
		h = Math.max(0.001, value(l, 'height', frame));
	return `translate(${value(l, 'positionX', frame)} ${value(l, 'positionY', frame)}) translate(${w / 2} ${h / 2}) rotate(${value(l, 'rotation', frame)}) scale(${value(l, 'scaleX', frame)} ${value(l, 'scaleY', frame)}) translate(${-w / 2} ${-h / 2})`;
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
		content = `<text font-family="${xml(l.fontFamily)}" font-size="${l.fontSize}" font-weight="${l.fontWeight}" font-style="${l.fontStyle}" ${style}>${l.text
			.split('\n')
			.map(
				(line, index) => `<tspan x="0" y="${l.fontSize * (1 + index * 1.2)}">${xml(line)}</tspan>`
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
		.filter((l) => l.visible)
		.map((l) => layerSvg(p, l, frame))
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
