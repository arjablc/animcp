import { check, uid, validateProject, type Asset, type Project } from './model';
const MAX = 10 * 1024 * 1024;
const tags = new Set([
	'svg',
	'g',
	'defs',
	'path',
	'rect',
	'circle',
	'ellipse',
	'line',
	'polyline',
	'polygon',
	'linearGradient',
	'radialGradient',
	'stop',
	'clipPath',
	'title',
	'desc'
]);
const attrs = new Set([
	'xmlns',
	'viewBox',
	'width',
	'height',
	'x',
	'y',
	'x1',
	'y1',
	'x2',
	'y2',
	'cx',
	'cy',
	'r',
	'rx',
	'ry',
	'fx',
	'fy',
	'd',
	'points',
	'fill',
	'fill-opacity',
	'fill-rule',
	'stroke',
	'stroke-width',
	'stroke-miterlimit',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-opacity',
	'stroke-dasharray',
	'stroke-dashoffset',
	'opacity',
	'transform',
	'id',
	'gradientUnits',
	'gradientTransform',
	'offset',
	'stop-color',
	'stop-opacity',
	'spreadMethod',
	'clip-path',
	'clipPathUnits',
	'preserveAspectRatio'
]);
export function sanitizeSvg(source: string): { source: string; width: number; height: number } {
	check(source.length <= MAX, 'SVG exceeds 10 MiB');
	check(!/<!DOCTYPE|<!ENTITY/i.test(source), 'SVG declarations/entities are unsupported');
	const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
	check(!doc.querySelector('parsererror'), 'Invalid SVG XML');
	const root = doc.documentElement;
	check(root.localName === 'svg', 'Expected an SVG document');
	let count = 0;
	const ids = new Set<string>();
	function walk(el: Element, depth: number) {
		check(++count <= 10000 && depth <= 40, 'SVG is too complex');
		check(
			tags.has(el.localName) && el.namespaceURI === 'http://www.w3.org/2000/svg',
			`Unsupported SVG element: ${el.localName}`
		);
		// Expand only a small allowlist of presentation declarations; never retain CSS.
		if (el.hasAttribute('style')) {
			for (const declaration of el.getAttribute('style')!.split(';')) {
				if (!declaration.trim()) continue;
				const [name, ...rest] = declaration.split(':');
				check(
					attrs.has(name.trim()) && !['id', 'xmlns'].includes(name.trim()),
					`Unsupported SVG style: ${name}`
				);
				el.setAttribute(name.trim(), rest.join(':').trim());
			}
			el.removeAttribute('style');
		}
		for (const attr of [...el.attributes]) {
			check(attrs.has(attr.name), `Unsupported SVG attribute: ${attr.name}`);
			check(
				!/javascript:|data:|https?:|\/\/|[\\<>]/i.test(attr.value) || attr.name === 'xmlns',
				'External SVG references are not allowed'
			);
			if (/url\s*\(/i.test(attr.value))
				check(
					/^url\(#[A-Za-z_][\w.-]*\)$/.test(attr.value),
					'Only local SVG paint references are allowed'
				);
			if (attr.name === 'id') {
				check(
					/^[A-Za-z_][\w.-]*$/.test(attr.value) && !ids.has(attr.value),
					'Invalid or duplicate SVG ID'
				);
				ids.add(attr.value);
			}
		}
		for (const child of [...el.children]) walk(child, depth + 1);
	}
	walk(root, 0);
	const view = root
		.getAttribute('viewBox')
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	const dimension = (v: string | null) =>
		v && /^\d+(\.\d+)?(px)?$/.test(v) ? parseFloat(v) : undefined;
	const width = dimension(root.getAttribute('width')) ?? view?.[2] ?? 300,
		height = dimension(root.getAttribute('height')) ?? view?.[3] ?? 150;
	check(
		Number.isFinite(width) &&
			Number.isFinite(height) &&
			width > 0 &&
			height > 0 &&
			width <= 8192 &&
			height <= 8192 &&
			width * height <= 16e6,
		'SVG dimensions exceed limits'
	);
	if (view)
		check(
			view.length === 4 && view.every(Number.isFinite) && view[2] > 0 && view[3] > 0,
			'Invalid SVG viewBox'
		);
	root.setAttribute('width', String(width));
	root.setAttribute('height', String(height));
	return { source: new XMLSerializer().serializeToString(root), width, height };
}
export function dataUrl(bytes: Uint8Array, mime: string) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 8192)
		binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
	return `data:${mime};base64,${btoa(binary)}`;
}
export function decodeData(data: string) {
	const b = atob(data.slice(data.indexOf(',') + 1));
	return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
async function validatePng(bytes: Uint8Array) {
	check(
		bytes.length > 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v),
		'Invalid PNG signature'
	);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getUint32(16),
		height = view.getUint32(20);
	check(
		width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16e6,
		'PNG exceeds 16 megapixels or dimension limits'
	);
	let offset = 8;
	while (offset + 12 <= bytes.length) {
		const length = view.getUint32(offset),
			tag = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		check(tag !== 'acTL', 'Animated PNG is not supported');
		check(offset + 12 + length <= bytes.length, 'Truncated PNG');
		offset += 12 + length;
	}
	const image = await createImageBitmap(
		new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })
	);
	check(image.width === width && image.height === height, 'PNG dimensions mismatch');
	image.close();
	return { width, height };
}
export async function importArtwork(file: File): Promise<Asset> {
	check(file.size <= MAX, 'Artwork exceeds 10 MiB');
	const id = uid(),
		name = file.name.slice(0, 200);
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml') {
		const svg = sanitizeSvg(new TextDecoder().decode(bytes));
		return {
			id,
			name,
			mime: 'image/svg+xml',
			width: svg.width,
			height: svg.height,
			data: dataUrl(new TextEncoder().encode(svg.source), 'image/svg+xml')
		};
	}
	const size = await validatePng(bytes);
	return { id, name, mime: 'image/png', ...size, data: dataUrl(bytes, 'image/png') };
}
export async function importNative(file: File): Promise<Project> {
	check(file.size <= 50 * 1024 * 1024, 'Project exceeds 50 MiB');
	const p = validateProject(JSON.parse(await file.text()));
	for (const a of p.assets) {
		const bytes = decodeData(a.data);
		check(bytes.length <= MAX, 'Asset exceeds 10 MiB');
		if (a.mime === 'image/svg+xml') {
			const svg = sanitizeSvg(new TextDecoder().decode(bytes));
			check(svg.width === a.width && svg.height === a.height, 'SVG metadata mismatch');
			a.data = dataUrl(new TextEncoder().encode(svg.source), a.mime);
		} else {
			const size = await validatePng(bytes);
			check(size.width === a.width && size.height === a.height, 'PNG metadata mismatch');
		}
	}
	return p;
}
