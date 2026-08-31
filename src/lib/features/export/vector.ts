import type {
	AnimationProject,
	Easing,
	PathData,
	ShapeKeyframe,
	VectorLayer
} from '../animation/model';
import { evaluateLayer, normalizePath } from '../animation/interpolation';
import { parseProject } from '../animation/validation';
import { ANIMATION_LIMITS } from '../animation/model';

/** Limits apply to UTF-8 bytes, including metadata and whitespace on import. */
export const MAX_PROJECT_BYTES = ANIMATION_LIMITS.maxProjectBytes;
export const MAX_VECTOR_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_EXPORT_LAYERS = 500;
const MAX_JSON_VALUES = 1_000_000;

type Point = [number, number];
type Bezier = { v: Point[]; i: Point[]; o: Point[]; c: boolean };
type Timed<T> = { frame: number; value: T; easing: Easing };
type Keyframe<T> = {
	t: number;
	s: T;
	e?: T;
	h?: 1;
	i?: { x: number[]; y: number[] };
	o?: { x: number[]; y: number[] };
};
type Property<T> = { a: 0; k: T } | { a: 1; k: Keyframe<T extends number ? number[] : T>[] };
type ShapeProperty = { a: 0; k: Bezier } | { a: 1; k: Keyframe<Bezier[]>[] };
type LottieTransform = {
	a: Property<number[]>;
	p: Property<number[]>;
	s: Property<number[]>;
	r: Property<number>;
	o: Property<number>;
};
type LottieShape =
	| { ty: 'sh'; nm: string; ks: ShapeProperty }
	| { ty: 'fl'; c: Property<number[]>; o: Property<number>; r: 1 }
	| {
			ty: 'st';
			c: Property<number[]>;
			o: Property<number>;
			w: Property<number>;
			lc: number;
			lj: number;
			ml: number;
	  }
	| ({ ty: 'tr' } & LottieTransform)
	| { ty: 'gr'; nm: string; it: LottieShape[] };
type LottieLayer = {
	ddd: 0;
	ind: number;
	ty: 4;
	nm: string;
	sr: 1;
	ks: LottieTransform;
	ao: 0;
	ip: number;
	op: number;
	st: 0;
	bm: 0;
	shapes: LottieShape[];
};

export type VectorLottieDocument = {
	v: string;
	nm: string;
	fr: number;
	ip: 0;
	op: number;
	w: number;
	h: number;
	ddd: 0;
	assets: [];
	layers: LottieLayer[];
};

/** Export metadata and canonical geometry; asset Blob bytes remain in local storage. */
export function projectBlob(project: AnimationProject): Blob {
	const validated = validatedProject(project);
	return new Blob([boundedJson(validated, MAX_PROJECT_BYTES, 'Project')], {
		type: 'application/json'
	});
}

/** Pure: the caller replaces editor state only after this function succeeds. */
export function importProject(text: string): AnimationProject {
	assertTextSize(text, MAX_PROJECT_BYTES, 'Project');
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error('Project import requires valid JSON.');
	}
	return parseProject(value);
}

export function exportSvg(project: AnimationProject, frame: number): string {
	project = validatedProject(project);
	if (!Number.isInteger(frame) || frame < 0 || frame >= project.timeline.frameCount)
		throw new Error('SVG frame must be an integer within the project timeline.');
	const { width, height, background } = project.canvas;
	const bg = color(background);
	const parts = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`<title>${xml(project.name)}</title>`,
		`<rect width="${width}" height="${height}" fill="${bg.hex}" fill-opacity="${bg.alpha}"/>`
	];
	for (const layer of orderedLayers(project)) {
		if (!layer.visible) continue;
		const state = evaluateLayer(layer, frame);
		if (!state) continue;
		const { x, y, rotation, scaleX, scaleY } = state.transform;
		const stroke = color(layer.style.stroke);
		const fill = layer.style.fill === null ? null : color(layer.style.fill);
		parts.push(
			`<g data-layer-id="${xml(layer.id)}" transform="translate(${x} ${y}) rotate(${rotation}) scale(${scaleX} ${scaleY})" opacity="${layerOpacity(layer, state)}">`,
			`<title>${xml(layer.name)}</title>`
		);
		for (const path of state.paths) {
			parts.push(
				`<path d="${svgPath(path)}" stroke="${stroke.hex}" stroke-opacity="${stroke.alpha}" stroke-width="${layer.style.strokeWidth}" stroke-linecap="${layer.style.strokeLineCap}" stroke-linejoin="${layer.style.strokeLineJoin}" stroke-miterlimit="4" fill="${fill?.hex ?? 'none'}" fill-opacity="${fill?.alpha ?? 1}" fill-rule="nonzero"/>`
			);
		}
		parts.push('</g>');
	}
	parts.push('</svg>');
	const svg = parts.join('\n');
	assertTextSize(svg, MAX_VECTOR_EXPORT_BYTES, 'SVG');
	return svg;
}

/** Supported subset: stable subpath topology, static paints, and keyframed 2D transforms. */
export function exportLottie(project: AnimationProject): VectorLottieDocument {
	project = validatedProject(project);
	const { width, height, background } = project.canvas;
	const { fps, frameCount } = project.timeline;
	const layers: LottieLayer[] = [];
	const budget = { commands: 0, evaluations: 0 };
	// SVG/Fabric paint back-to-front; Lottie stores the topmost layer first.
	for (const layer of orderedLayers(project).reverse()) {
		if (!layer.visible) continue;
		const frames = Object.keys(layer.keyframes)
			.map(Number)
			.sort((a, b) => a - b);
		if (!frames.length) continue;
		const states = exportStates(layer, frames, frameCount, budget);
		const geometryChanges = !sameValues(
			states.map((state) => ({ ...state, value: state.value.paths }))
		);
		// L-to-C morphs must use the evaluator's linear cubic handles. Zero
		// handles describe a straight line too, but interpolate to a different curve.
		const shapes = states.map(({ value }) =>
			value.paths.map((path) => toBeziers(geometryChanges ? normalizePath(path) : path))
		);
		assertTopology(shapes);
		const property = <T extends number | number[]>(get: (value: ShapeKeyframe) => T) =>
			animated(states.map(({ frame, value, easing }) => ({ frame, easing, value: get(value) })));
		const groups: LottieShape[] = shapes[0]
			.map((subpaths, pathIndex): LottieShape => ({
				ty: 'gr',
				nm: `Path ${pathIndex + 1}`,
				it: [
					...subpaths.map((_, subpathIndex): LottieShape => ({
						ty: 'sh',
						nm: `Subpath ${subpathIndex + 1}`,
						ks: animatedShape(
							states.map(({ frame, easing }, index) => ({
								frame,
								easing,
								value: shapes[index][pathIndex][subpathIndex]
							}))
						)
					})),
					...paints(layer),
					{ ty: 'tr', ...identity() }
				]
			}))
			.reverse();
		layers.push(
			lottieLayer(
				layer.name,
				frameCount,
				layers.length + 1,
				{
					a: fixed([0, 0, 0]),
					p: property(({ transform }) => [transform.x, transform.y, 0]),
					s: property(({ transform }) => [transform.scaleX * 100, transform.scaleY * 100, 100]),
					r: property(({ transform }) => transform.rotation),
					o: property((value) => layerOpacity(layer, value) * 100)
				},
				groups,
				frames[0]
			)
		);
	}
	const bg = color(background);
	if (bg.alpha > 0) {
		const rectangle = toBeziers([
			{ type: 'M', x: 0, y: 0 },
			{ type: 'L', x: width, y: 0 },
			{ type: 'L', x: width, y: height },
			{ type: 'L', x: 0, y: height },
			{ type: 'Z' }
		])[0];
		layers.push(
			lottieLayer('Background', frameCount, layers.length + 1, identity(), [
				{ ty: 'sh', nm: 'Canvas', ks: fixed(rectangle) },
				{ ty: 'fl', c: fixed(bg.rgb), o: fixed(bg.alpha * 100), r: 1 }
			])
		);
	}
	if (layers.length > MAX_EXPORT_LAYERS)
		throw new Error(
			`Lottie export supports at most ${MAX_EXPORT_LAYERS} layers including background.`
		);
	const document: VectorLottieDocument = {
		v: '5.12.2',
		nm: project.name,
		fr: fps,
		ip: 0,
		op: frameCount,
		w: width,
		h: height,
		ddd: 0,
		assets: [],
		layers
	};
	boundedJson(document, MAX_VECTOR_EXPORT_BYTES, 'Lottie');
	return document;
}

/** Browser-only side effect; downloads are never started by the pure exporters. */
export function downloadBlob(blob: Blob, name: string): void {
	if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function')
		throw new Error('File downloads require a browser.');
	const anchor = document.createElement('a');
	const url = URL.createObjectURL(blob);
	try {
		anchor.href = url;
		anchor.download =
			[...name]
				.map((character) => {
					const code = character.codePointAt(0)!;
					return code < 32 || code === 127 || /[<>:"/\\|?*]/.test(character) ? '_' : character;
				})
				.join('')
				.slice(0, 200) || 'animation';
		anchor.style.display = 'none';
		document.body.appendChild(anchor);
		anchor.click();
	} finally {
		anchor.remove();
		// Let the browser consume the URL before releasing its backing Blob.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}

function validatedProject(project: AnimationProject): AnimationProject {
	// Validation checks descriptors before reading values, rejecting accessors and
	// toJSON hooks without executing them. Never stringify unvalidated objects.
	const validated = parseProject(project);
	boundedJson(validated, MAX_PROJECT_BYTES, 'Project');
	if (validated.layers.length > MAX_EXPORT_LAYERS)
		throw new Error(`Vector export supports at most ${MAX_EXPORT_LAYERS} layers.`);
	return validated;
}

function orderedLayers(project: AnimationProject): VectorLayer[] {
	// Stable sorting preserves document order for equal z-indices.
	return [...project.layers].sort((a, b) => a.zIndex - b.zIndex);
}

function exportStates(
	layer: VectorLayer,
	frames: number[],
	frameCount: number,
	budget: { commands: number; evaluations: number }
): Timed<ShapeKeyframe>[] {
	const authored = frames.map((frame) => ({
		frame,
		value: layer.keyframes[frame],
		easing: layer.keyframes[frame].easing
	}));
	const needsSampling = authored.some(
		({ value, easing }) =>
			value.generated ||
			(easing.type === 'bezier' &&
				(easing.y1 < 0 || easing.y1 > 1 || easing.y2 < 0 || easing.y2 > 1))
	);
	const countCommands = (value: ShapeKeyframe) =>
		value.paths.reduce((sum, path) => sum + path.length, 0);
	if (!needsSampling) {
		budget.commands += authored.reduce((sum, { value }) => sum + countCommands(value), 0);
		if (budget.commands > ANIMATION_LIMITS.maxTotalPathCommands)
			throw new Error('Lottie exceeds the export complexity limit.');
		return authored;
	}
	// The evaluator validates its layer per call. Bound both that work and the
	// expanded output before sampling potentially large generated animations.
	const samples = frameCount - frames[0];
	const totalCommands = authored.reduce((sum, { value }) => sum + countCommands(value), 0);
	budget.evaluations += samples * totalCommands;
	budget.commands += samples * Math.max(...authored.map(({ value }) => countCommands(value)));
	if (budget.evaluations > 2_000_000 || budget.commands > ANIMATION_LIMITS.maxTotalPathCommands)
		throw new Error('Lottie frame sampling exceeds the export complexity limit.');
	const states: Timed<ShapeKeyframe>[] = [];
	for (let frame = frames[0]; frame < frameCount; frame++) {
		const state = evaluateLayer(layer, frame);
		// An isolated generated key can be surrounded by invisible frames. Keep
		// geometry for those frames but explicitly zero the animated opacity.
		const value = state ?? { ...layer.keyframes[frames[0]], opacity: 0 };
		states.push({ frame, value, easing: { type: 'hold' } });
	}
	return states;
}

function layerOpacity(layer: VectorLayer, state: ShapeKeyframe): number {
	return layer.style.opacity * (state.opacity ?? 1);
}

function svgPath(path: PathData): string {
	return path
		.map((command) => {
			switch (command.type) {
				case 'M':
				case 'L':
					return `${command.type} ${command.x} ${command.y}`;
				case 'C':
					return `C ${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
				case 'Z':
					return 'Z';
				default:
					throw new Error('SVG export encountered an unsupported path command.');
			}
		})
		.join(' ');
}

function xml(value: string): string {
	return [...value]
		.map((character) => {
			const code = character.codePointAt(0)!;
			const valid =
				code === 9 ||
				code === 10 ||
				code === 13 ||
				(code >= 32 && code <= 0xd7ff) ||
				(code >= 0xe000 && code <= 0xfffd) ||
				code >= 0x10000;
			return valid ? character : '\ufffd';
		})
		.join('')
		.replace(
			/[&<>"']/g,
			(character) =>
				({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!
		);
}

/** Never pass arbitrary CSS (notably url(...)) through to an SVG attribute. */
function color(value: string): { rgb: number[]; hex: string; alpha: number } {
	const paint = value.trim().toLowerCase();
	const named: Record<string, string> = {
		transparent: '#00000000',
		none: '#00000000',
		black: '#000000',
		white: '#ffffff',
		red: '#ff0000',
		green: '#008000',
		blue: '#0000ff',
		yellow: '#ffff00',
		cyan: '#00ffff',
		aqua: '#00ffff',
		magenta: '#ff00ff',
		fuchsia: '#ff00ff',
		gray: '#808080',
		grey: '#808080',
		orange: '#ffa500',
		purple: '#800080',
		pink: '#ffc0cb',
		brown: '#a52a2a',
		navy: '#000080',
		teal: '#008080',
		lime: '#00ff00',
		silver: '#c0c0c0',
		maroon: '#800000',
		olive: '#808000'
	};
	const functional =
		/^(rgb|rgba)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(paint);
	if (functional && (functional[1] === 'rgba') === (functional[5] !== undefined)) {
		const channels = functional.slice(2, 5).map(Number);
		const alpha = functional[5] === undefined ? 1 : Number(functional[5]);
		if (
			channels.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255) &&
			Number.isFinite(alpha) &&
			alpha >= 0 &&
			alpha <= 1
		)
			return {
				rgb: channels.map((channel) => channel / 255),
				hex: `rgb(${channels.join(',')})`,
				alpha
			};
	}
	let hex = Object.hasOwn(named, paint) ? named[paint] : paint;
	if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(hex))
		throw new Error('Vector export requires a safe hex, rgb(), rgba(), or supported named color.');
	if (hex.length === 4 || hex.length === 5)
		hex = '#' + [...hex.slice(1)].map((digit) => digit + digit).join('');
	const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
	return {
		rgb,
		hex: hex.slice(0, 7),
		alpha: hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1
	};
}

function toBeziers(path: PathData): Bezier[] {
	const result: Bezier[] = [];
	let current: Bezier | undefined;
	for (const command of path) {
		if (command.type === 'M') {
			current = { v: [[command.x, command.y]], i: [[0, 0]], o: [[0, 0]], c: false };
			result.push(current);
			continue;
		}
		if (!current || current.c)
			throw new Error('Lottie subpaths must start with M; commands after Z require a new M.');
		const last = current.v.length - 1;
		if (command.type === 'Z') {
			current.c = true;
			// An explicit closing cubic ends at the first vertex. Transfer its incoming
			// handle before removing that duplicate, retaining the curved closing edge.
			if (
				last > 0 &&
				current.v[last][0] === current.v[0][0] &&
				current.v[last][1] === current.v[0][1]
			) {
				current.i[0] = current.i[last];
				current.v.pop();
				current.i.pop();
				current.o.pop();
			}
		} else if (command.type === 'L' || command.type === 'C') {
			if (command.type === 'C')
				current.o[last] = [command.x1 - current.v[last][0], command.y1 - current.v[last][1]];
			current.v.push([command.x, command.y]);
			current.i.push(
				command.type === 'C' ? [command.x2 - command.x, command.y2 - command.y] : [0, 0]
			);
			current.o.push([0, 0]);
		} else {
			throw new Error('Lottie supports only absolute M, L, C, and Z path commands.');
		}
	}
	if (!result.length) throw new Error('Lottie cannot export an empty path.');
	return result;
}

function assertTopology(frames: Bezier[][][]): void {
	const topology = (paths: Bezier[][]) =>
		paths.map((subpaths) => subpaths.map(({ v, c }) => [v.length, c]));
	const first = JSON.stringify(topology(frames[0]));
	if (frames.some((paths) => JSON.stringify(topology(paths)) !== first))
		throw new Error(
			'Lottie export requires matching path counts, subpaths, vertices, and closure across keyframes.'
		);
}

function fixed<T>(k: T): { a: 0; k: T } {
	return { a: 0, k };
}

function easingFields(easing: Easing) {
	if (easing.type === 'hold') return { h: 1 as const };
	const curve = easing.type === 'bezier' ? easing : { x1: 0, y1: 0, x2: 1, y2: 1 };
	return { o: { x: [curve.x1], y: [curve.y1] }, i: { x: [curve.x2], y: [curve.y2] } };
}

function sameValues<T>(values: Timed<T>[]): boolean {
	const first = JSON.stringify(values[0].value);
	return values.every(({ value }) => JSON.stringify(value) === first);
}

function animated<T extends number | number[]>(values: Timed<T>[]): Property<T> {
	if (sameValues(values)) return fixed(values[0].value);
	const array = (value: T) =>
		(typeof value === 'number' ? [value] : value) as T extends number ? number[] : T;
	return {
		a: 1,
		k: values.map(({ frame, value, easing }, index) => ({
			t: frame,
			s: array(value),
			...(index < values.length - 1
				? { e: array(values[index + 1].value), ...easingFields(easing) }
				: { h: 1 as const })
		}))
	};
}

function animatedShape(values: Timed<Bezier>[]): ShapeProperty {
	if (sameValues(values)) return fixed(values[0].value);
	return {
		a: 1,
		k: values.map(({ frame, value, easing }, index) => ({
			t: frame,
			s: [value],
			...(index < values.length - 1
				? { e: [values[index + 1].value], ...easingFields(easing) }
				: { h: 1 as const })
		}))
	};
}

function paints(layer: VectorLayer): LottieShape[] {
	const stroke = color(layer.style.stroke);
	const fill = layer.style.fill === null ? null : color(layer.style.fill);
	const shapes: LottieShape[] = [];
	// Lottie paints styles in reverse array order, so stroke precedes fill here.
	if (layer.style.strokeWidth > 0 && stroke.alpha > 0)
		shapes.push({
			ty: 'st',
			c: fixed(stroke.rgb),
			o: fixed(stroke.alpha * 100),
			w: fixed(layer.style.strokeWidth),
			lc: { butt: 1, round: 2, square: 3 }[layer.style.strokeLineCap],
			lj: { miter: 1, round: 2, bevel: 3 }[layer.style.strokeLineJoin],
			ml: 4
		});
	if (fill && fill.alpha > 0)
		shapes.push({ ty: 'fl', c: fixed(fill.rgb), o: fixed(fill.alpha * 100), r: 1 });
	return shapes;
}

function identity(): LottieTransform {
	return {
		a: fixed([0, 0, 0]),
		p: fixed([0, 0, 0]),
		s: fixed([100, 100, 100]),
		r: fixed(0),
		o: fixed(100)
	};
}

function lottieLayer(
	nm: string,
	op: number,
	ind: number,
	ks: LottieTransform,
	shapes: LottieShape[],
	ip = 0
): LottieLayer {
	return { ddd: 0, ind, ty: 4, nm, sr: 1, ks, ao: 0, ip, op, st: 0, bm: 0, shapes };
}

function assertTextSize(text: string, limit: number, label: string): void {
	if (typeof text !== 'string') throw new Error(`${label} must be a JSON string.`);
	if (text.length > limit || new Blob([text]).size > limit)
		throw new Error(`${label} exceeds the ${limit / 1024 / 1024} MiB size limit.`);
}

/** Abort overlarge object graphs during serialization, before allocating full JSON. */
function boundedJson(value: unknown, limit: number, label: string): string {
	let characters = 0;
	let values = 0;
	try {
		const json = JSON.stringify(value, (key, item: unknown) => {
			characters += key.length + (typeof item === 'string' ? item.length : 1);
			if (characters > limit || ++values > MAX_JSON_VALUES)
				throw new Error(`${label} exceeds the export size or complexity limit.`);
			if (typeof item === 'number' && !Number.isFinite(item))
				throw new Error(`${label} contains a non-finite number.`);
			return item;
		});
		assertTextSize(json, limit, label);
		return json;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(label)) throw error;
		throw new Error(`${label} must be a finite, JSON-serializable document.`, { cause: error });
	}
}
