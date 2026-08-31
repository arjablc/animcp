export type Easing =
	| { type: 'linear' }
	| { type: 'hold' }
	| { type: 'bezier'; x1: number; y1: number; x2: number; y2: number };
export type Value = number | string;
export type Key = { id: string; frame: number; value: Value; easing: Easing };
export type Track = {
	defaultValue: Value;
	keys: Key[];
	locks?: Partial<
		Record<'startFrame' | 'endFrame' | 'duration' | 'startValue' | 'endValue' | 'easing', boolean>
	>;
};
export type Paint = { type: 'solid' | 'linear' | 'radial'; stops: string[] };
export type Layer = {
	id: string;
	name: string;
	type: 'rectangle' | 'ellipse' | 'text' | 'svg' | 'png';
	visible: boolean;
	locked: boolean;
	text: string;
	fontFamily: string;
	fontWeight: number;
	fontStyle: 'normal' | 'italic';
	fontSize: number;
	assetId?: string;
	paint: Paint;
	tracks: Record<string, Track>;
};
export type Asset = {
	id: string;
	name: string;
	mime: 'image/svg+xml' | 'image/png';
	width: number;
	height: number;
	data: string;
};
export type Project = {
	version: 2;
	kind: 'motion-graphics';
	id: string;
	name: string;
	revision: number;
	updatedAt: string;
	composition: {
		width: number;
		height: number;
		fps: number;
		durationFrames: number;
		background: string;
	};
	layers: Layer[];
	assets: Asset[];
};
export const uid = () => crypto.randomUUID();
export const track = (defaultValue: Value): Track => ({ defaultValue, keys: [] });
export const presets: Record<string, Easing> = {
	linear: { type: 'linear' },
	hold: { type: 'hold' },
	'ease-in': { type: 'bezier', x1: 0.42, y1: 0, x2: 1, y2: 1 },
	'ease-out': { type: 'bezier', x1: 0, y1: 0, x2: 0.58, y2: 1 },
	'ease-in-out': { type: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
	snappy: { type: 'bezier', x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
	smooth: { type: 'bezier', x1: 0.4, y1: 0, x2: 0.2, y2: 1 },
	'strong-out': { type: 'bezier', x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
	'strong-in': { type: 'bezier', x1: 0.7, y1: 0, x2: 0.84, y2: 0 }
};
export function createLayer(type: Layer['type'], name = type as string): Layer {
	return {
		id: uid(),
		name,
		type,
		visible: true,
		locked: false,
		text: 'Hello',
		fontFamily: 'sans-serif',
		fontWeight: 400,
		fontStyle: 'normal',
		fontSize: 64,
		paint: { type: 'solid', stops: [] },
		tracks: Object.fromEntries(
			Object.entries({
				positionX: 200,
				positionY: 180,
				scaleX: 1,
				scaleY: 1,
				rotation: 0,
				opacity: 1,
				width: type === 'text' ? 500 : 240,
				height: type === 'text' ? 90 : 140,
				cornerRadius: 20,
				fill: '#dfff4f',
				paintOpacity: 1,
				stroke: '#18212c',
				strokeWidth: 0
			}).map(([k, v]) => [k, track(v)])
		)
	};
}
export function createProject(name = 'Untitled motion'): Project {
	return {
		version: 2,
		kind: 'motion-graphics',
		id: uid(),
		name,
		revision: 0,
		updatedAt: new Date().toISOString(),
		composition: { width: 960, height: 540, fps: 30, durationFrames: 150, background: '#101722' },
		layers: [],
		assets: []
	};
}
export function setGradient(layer: Layer, type: Paint['type']) {
	for (const name of Object.keys(layer.tracks))
		if (name.startsWith('gradient.')) delete layer.tracks[name];
	layer.paint = { type, stops: [] };
	if (type === 'solid') return;
	for (const [k, v] of Object.entries({
		startX: 0,
		startY: 0,
		endX: 1,
		endY: 1,
		centerX: 0.5,
		centerY: 0.5,
		focalX: 0.5,
		focalY: 0.5,
		radius: 0.7
	}))
		layer.tracks[`gradient.${k}`] = track(v);
	for (const [i, color] of ['#dfff4f', '#46c5f4'].entries()) addStop(layer, i, color);
}
export function addStop(layer: Layer, offset: number, color: string) {
	const id = uid();
	layer.paint.stops.push(id);
	layer.tracks[`gradient.stop.${id}.offset`] = track(offset);
	layer.tracks[`gradient.stop.${id}.color`] = track(color);
	layer.tracks[`gradient.stop.${id}.opacity`] = track(1);
	return id;
}
export function easingAt(e: Easing, t: number): number {
	if (e.type === 'hold') return 0;
	if (e.type === 'linear') return t;
	const bez = (a: number, b: number, u: number) =>
		3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3;
	let lo = 0,
		hi = 1;
	for (let i = 0; i < 32; i++) {
		const mid = (lo + hi) / 2;
		if (bez(e.x1, e.x2, mid) < t) lo = mid;
		else hi = mid;
	}
	return bez(e.y1, e.y2, (lo + hi) / 2);
}
export function evaluate(t: Track, frame: number): Value {
	const ks = t.keys;
	if (!ks.length) return t.defaultValue;
	if (frame <= ks[0].frame) return ks[0].value;
	const end = ks[ks.length - 1];
	if (frame >= end.frame) return end.value;
	const index = ks.findIndex((k) => k.frame > frame),
		a = ks[index - 1],
		b = ks[index];
	const u = easingAt(a.easing, (frame - a.frame) / (b.frame - a.frame));
	if (typeof a.value === 'number' && typeof b.value === 'number')
		return a.value + (b.value - a.value) * u;
	const ca = String(a.value).slice(1),
		cb = String(b.value).slice(1);
	return (
		'#' +
		[0, 2, 4]
			.map((i) =>
				Math.round(
					Math.max(
						0,
						Math.min(
							255,
							parseInt(ca.slice(i, i + 2), 16) +
								(parseInt(cb.slice(i, i + 2), 16) - parseInt(ca.slice(i, i + 2), 16)) * u
						)
					)
				)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}
export function value(layer: Layer, property: string, frame: number): number {
	return Number(evaluate(layer.tracks[property], frame));
}
export const colorPattern = /^#[0-9a-fA-F]{6}$/;
export function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
export function number(value: unknown, min = -1e6, max = 1e6): number {
	check(
		typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
		`Expected a finite number between ${min} and ${max}`
	);
	return value;
}
export function string(value: unknown, max = 1000): string {
	check(typeof value === 'string' && value.length <= max, 'Invalid text');
	return value;
}
export function validateEasing(e: Easing) {
	check(e && ['linear', 'hold', 'bezier'].includes(e.type), 'Invalid easing');
	if (e.type === 'bezier') {
		number(e.x1, 0, 1);
		number(e.x2, 0, 1);
		number(e.y1, -10, 10);
		number(e.y2, -10, 10);
	}
}
export function validateValue(property: string, v: Value) {
	if (property === 'fill' || property === 'stroke' || property.endsWith('.color'))
		check(typeof v === 'string' && colorPattern.test(v), 'Use a six-digit hex color');
	else if (
		property === 'opacity' ||
		property === 'paintOpacity' ||
		property.endsWith('.opacity') ||
		property.endsWith('.offset')
	)
		number(v, 0, 1);
	else if (['width', 'height', 'gradient.radius'].includes(property)) number(v, 0.001, 10000);
	else if (['cornerRadius', 'strokeWidth'].includes(property)) number(v, 0, 10000);
	else if (property === 'scaleX' || property === 'scaleY') number(v, 0.001, 100);
	else number(v);
}
const bases = [
	'positionX',
	'positionY',
	'scaleX',
	'scaleY',
	'rotation',
	'opacity',
	'width',
	'height',
	'cornerRadius',
	'fill',
	'paintOpacity',
	'stroke',
	'strokeWidth'
];
const gradientProps = [
	'startX',
	'startY',
	'endX',
	'endY',
	'centerX',
	'centerY',
	'focalX',
	'focalY',
	'radius'
];
export function validateProject(input: unknown): Project {
	check(input && typeof input === 'object', 'Invalid project');
	const p = input as Project;
	check(p.version === 2 && p.kind === 'motion-graphics', 'Not a motion v2 project');
	string(p.id, 100);
	string(p.name, 200);
	number(p.revision, 0, Number.MAX_SAFE_INTEGER - 1);
	string(p.updatedAt, 100);
	check(Number.isInteger(p.revision), 'Invalid revision');
	const c = p.composition;
	check(c, 'Missing composition');
	number(c.width, 240, 1920);
	number(c.height, 240, 1080);
	check([12, 15, 24, 30, 60].includes(c.fps), 'Unsupported FPS');
	number(c.durationFrames, 1, c.fps * 60);
	check(Number.isInteger(c.durationFrames), 'Frame count must be an integer');
	check(colorPattern.test(c.background), 'Invalid background');
	check(Array.isArray(p.layers) && p.layers.length <= 200, 'Too many layers');
	check(Array.isArray(p.assets) && p.assets.length <= 200, 'Too many assets');
	check(
		new TextEncoder().encode(JSON.stringify(p)).length <= 50 * 1024 * 1024,
		'Project exceeds 50 MiB'
	);
	const ids = new Set<string>();
	const unique = (id: string) => {
		string(id, 100);
		check(!!id && !ids.has(id), 'Duplicate or empty ID');
		ids.add(id);
	};
	let keys = 0;
	for (const a of p.assets) {
		unique(a.id);
		string(a.name, 200);
		number(a.width, 1, 8192);
		number(a.height, 1, 8192);
		check(a.width * a.height <= 16e6, 'Asset pixel limit exceeded');
		check(['image/png', 'image/svg+xml'].includes(a.mime), 'Unsupported asset');
		string(a.data, 14e6);
		check(
			a.data.startsWith(`data:${a.mime};base64,`) &&
				/^[A-Za-z0-9+/]*={0,2}$/.test(a.data.split(',')[1]),
			'Invalid embedded asset'
		);
	}
	for (const l of p.layers) {
		unique(l.id);
		string(l.name, 200);
		check(['rectangle', 'ellipse', 'text', 'svg', 'png'].includes(l.type), 'Invalid layer type');
		check(typeof l.visible === 'boolean' && typeof l.locked === 'boolean', 'Invalid layer flags');
		string(l.text, 10000);
		string(l.fontFamily, 200);
		check(!/[\u0000-\u001f]/.test(l.fontFamily), 'Invalid font family');
		number(l.fontWeight, 1, 1000);
		number(l.fontSize, 1, 1000);
		check(['normal', 'italic'].includes(l.fontStyle), 'Invalid font style');
		if (l.type === 'png' || l.type === 'svg')
			check(
				p.assets.some(
					(a) => a.id === l.assetId && a.mime === (l.type === 'png' ? 'image/png' : 'image/svg+xml')
				),
				'Missing or incompatible asset'
			);
		check(
			l.paint &&
				['solid', 'linear', 'radial'].includes(l.paint.type) &&
				Array.isArray(l.paint.stops) &&
				l.paint.stops.length <= 16,
			'Invalid paint'
		);
		check(
			l.paint.type === 'solid' ? l.paint.stops.length === 0 : l.paint.stops.length >= 2,
			'Gradients need at least two stops'
		);
		const allowed = new Set(bases);
		if (l.paint.type !== 'solid') {
			for (const name of gradientProps) allowed.add(`gradient.${name}`);
			for (const id of l.paint.stops) {
				unique(id);
				for (const suffix of ['offset', 'color', 'opacity'])
					allowed.add(`gradient.stop.${id}.${suffix}`);
			}
		}
		check(
			l.tracks && Object.keys(l.tracks).length === allowed.size,
			'Missing or extra property tracks'
		);
		for (const [property, t] of Object.entries(l.tracks)) {
			check(allowed.has(property), 'Unknown property');
			validateValue(property, t.defaultValue);
			check(Array.isArray(t.keys), 'Invalid keys');
			let previous = -1;
			if (t.locks)
				for (const [k, v] of Object.entries(t.locks))
					check(
						['startFrame', 'endFrame', 'duration', 'startValue', 'endValue', 'easing'].includes(
							k
						) && typeof v === 'boolean',
						'Invalid lock'
					);
			for (const k of t.keys) {
				unique(k.id);
				number(k.frame, 0, c.durationFrames - 1);
				check(
					Number.isInteger(k.frame) && k.frame > previous,
					'Keyframe collision or invalid order'
				);
				previous = k.frame;
				validateValue(property, k.value);
				validateEasing(k.easing);
				keys++;
			}
		}
	}
	check(keys <= 20000, 'Project exceeds 20,000 keyframes');
	return structuredClone(p);
}
export function demoProject(template = 'Product cards'): Project {
	const p = createProject(template);
	const title = createLayer('text', 'Title');
	title.text = 'Make your next move.';
	title.fontSize = 52;
	title.tracks.positionX.defaultValue = 90;
	title.tracks.positionY.defaultValue = 70;
	title.tracks.fill.defaultValue = '#f4f6f9';
	title.tracks.opacity.keys = [
		{ id: uid(), frame: 0, value: 0, easing: presets.smooth },
		{ id: uid(), frame: 16, value: 1, easing: presets.linear }
	];
	p.layers.push(title);
	for (const [i, text] of ['Design', 'Animate', 'Ship'].entries()) {
		const card = createLayer('rectangle', text + ' card');
		card.tracks.positionX.defaultValue = 90 + i * 265;
		card.tracks.width.defaultValue = 245;
		card.tracks.height.defaultValue = 160;
		setGradient(card, 'linear');
		card.tracks[`gradient.stop.${card.paint.stops[0]}.color`].defaultValue = [
			'#dfff4f',
			'#83b4ff',
			'#c4a1ff'
		][i];
		card.tracks.positionY.keys = [
			{ id: uid(), frame: 8, value: 460, easing: presets.linear },
			{ id: uid(), frame: 36, value: 220, easing: presets.linear }
		];
		p.layers.push(card);
		const label = createLayer('text', text);
		label.text = text;
		label.fontSize = 32;
		label.tracks.positionX.defaultValue = 110 + i * 265;
		label.tracks.positionY.keys = [
			{ id: uid(), frame: 8, value: 510, easing: presets.linear },
			{ id: uid(), frame: 36, value: 270, easing: presets.linear }
		];
		label.tracks.fill.defaultValue = '#102032';
		label.tracks.width.defaultValue = 220;
		p.layers.push(label);
	}
	return p;
}
