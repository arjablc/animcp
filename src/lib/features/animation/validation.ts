import { ANIMATION_LIMITS } from './model';
import type {
	AnimationProject,
	AssetRecord,
	CanvasSettings,
	Easing,
	LayerStyle,
	PathCommand,
	PathData,
	ShapeKeyframe,
	TimelineSettings,
	Transform,
	VectorLayer
} from './model';

export class AnimationValidationError extends Error {
	readonly category = 'validation' as const;
	constructor(
		message: string,
		readonly path = ''
	) {
		super(path ? `${path}: ${message}` : message);
		this.name = 'AnimationValidationError';
	}
}

function fail(message: string, path = ''): never {
	throw new AnimationValidationError(message, path);
}

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

/** Check descriptors before reading values: accessors must never run during validation. */
export function assertJsonSafe(value: unknown): void {
	const seen = new Set<object>();
	let nodes = 0;
	let bytes = 0;
	function walk(item: unknown, depth: number): void {
		if (++nodes > 2_000_000 || depth > 32) fail('Document exceeds structural limits.');
		if (typeof item === 'string') {
			// Conservative UTF-8 upper bound without allocating an encoded copy.
			bytes += item.length * 3;
			if (bytes > ANIMATION_LIMITS.maxProjectBytes) fail('Document exceeds the size limit.');
			return;
		}
		if (item === null || typeof item === 'boolean') return;
		if (typeof item === 'number') {
			if (!Number.isFinite(item)) fail('Numbers must be finite.');
			return;
		}
		if (typeof item !== 'object') fail('Only JSON-safe data is accepted.');
		if (seen.has(item)) fail('Circular data is not accepted.');
		const array = Array.isArray(item);
		const prototype = Object.getPrototypeOf(item);
		if (
			prototype !== (array ? Array.prototype : Object.prototype) &&
			!(prototype === null && !array)
		)
			fail('Only plain JSON objects and arrays are accepted.');
		seen.add(item);
		const keys = Reflect.ownKeys(item);
		if (keys.length > 200_001) fail('Object exceeds structural limits.');
		if (array && (item.length > 200_000 || keys.length !== item.length + 1))
			fail('Sparse or oversized arrays are not accepted.');
		for (const key of keys) {
			if (array && key === 'length') continue;
			if (typeof key !== 'string' || forbiddenKeys.has(key)) fail('Unsafe object property.');
			if (array && !/^(0|[1-9]\d*)$/.test(key)) fail('Array properties are not accepted.');
			const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
			if (!descriptor.enumerable || !('value' in descriptor)) fail('Accessors are not accepted.');
			walk(key, depth + 1);
			walk(descriptor.value, depth + 1);
		}
		seen.delete(item);
	}
	walk(value, 0);
}

export function validateObject(
	value: unknown,
	allowed: readonly string[],
	path = 'input'
): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		fail('Expected an object.', path);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) fail('Expected a plain object.', path);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || forbiddenKeys.has(key) || !allowed.includes(key))
			fail('Unexpected or unsafe property.', path);
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
		if (!descriptor.enumerable || !('value' in descriptor))
			fail('Accessors are not accepted.', path);
	}
	return value as Record<string, unknown>;
}

export function validateNumber(
	value: unknown,
	path: string,
	min = -Infinity,
	max = Infinity
): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
		fail(`Expected a finite number between ${min} and ${max}.`, path);
	return value;
}

export function validateInteger(
	value: unknown,
	path: string,
	min = 0,
	max = Number.MAX_SAFE_INTEGER
): number {
	const result = validateNumber(value, path, min, max);
	if (!Number.isSafeInteger(result)) fail('Expected a safe integer.', path);
	return result;
}

export function validateName(value: unknown, path = 'name'): string {
	if (typeof value !== 'string' || !value.trim() || value.length > ANIMATION_LIMITS.maxNameLength)
		fail(`Expected 1-${ANIMATION_LIMITS.maxNameLength} nonblank characters.`, path);
	return value;
}

export function validateId(value: unknown, path = 'id'): string {
	if (
		typeof value !== 'string' ||
		!/^[a-zA-Z0-9_-]{1,128}$/.test(value) ||
		forbiddenKeys.has(value)
	)
		fail('Expected a safe identifier of 1-128 characters.', path);
	return value;
}

export function validateBoolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') fail('Expected a boolean.', path);
	return value;
}

function enumeration<T extends string>(value: unknown, values: readonly T[], path: string): T {
	if (typeof value !== 'string' || !values.includes(value as T)) fail('Unsupported value.', path);
	return value as T;
}

/** Deliberately excludes URLs, CSS variables and markup; exporters may safely escape these colors. */
export function validateColor(value: unknown, path = 'color'): string {
	if (typeof value !== 'string' || value.length > 100) fail('Expected a safe color.', path);
	if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value;
	if (
		/^(?:transparent|black|white|red|green|blue|yellow|cyan|magenta|gray|grey|orange|purple|pink|brown|navy|teal|lime|silver|maroon|olive|aqua|fuchsia)$/i.test(
			value
		)
	)
		return value;
	const rgb =
		/^(rgb|rgba)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(value);
	if (rgb && (rgb[1].toLowerCase() === 'rgba') === (rgb[5] !== undefined)) {
		for (const channel of rgb.slice(2, 5)) validateNumber(Number(channel), path, 0, 255);
		if (rgb[5] !== undefined) validateNumber(Number(rgb[5]), path, 0, 1);
		return value;
	}
	fail('Expected a hex, supported named, rgb(), or rgba() color.', path);
}

export function validateCanvas(value: unknown): CanvasSettings {
	const obj = validateObject(value, ['width', 'height', 'background'], 'canvas');
	return {
		width: validateInteger(obj.width, 'canvas.width', 240, 1920),
		height: validateInteger(obj.height, 'canvas.height', 240, 1080),
		background: validateColor(obj.background, 'canvas.background')
	};
}

export function validateTimeline(value: unknown): TimelineSettings {
	const obj = validateObject(value, ['fps', 'frameCount'], 'timeline');
	if (![12, 15, 24, 30].includes(obj.fps as number))
		fail('FPS must be 12, 15, 24, or 30.', 'timeline.fps');
	const fps = obj.fps as TimelineSettings['fps'];
	return { fps, frameCount: validateInteger(obj.frameCount, 'timeline.frameCount', fps, fps * 60) };
}

export function validateStyle(value: unknown): LayerStyle {
	const obj = validateObject(
		value,
		['stroke', 'strokeWidth', 'strokeLineCap', 'strokeLineJoin', 'fill', 'opacity'],
		'style'
	);
	return {
		stroke: validateColor(obj.stroke, 'style.stroke'),
		strokeWidth: validateNumber(obj.strokeWidth, 'style.strokeWidth', 0, 1000),
		strokeLineCap: enumeration(
			obj.strokeLineCap,
			['butt', 'round', 'square'],
			'style.strokeLineCap'
		),
		strokeLineJoin: enumeration(
			obj.strokeLineJoin,
			['miter', 'round', 'bevel'],
			'style.strokeLineJoin'
		),
		fill: obj.fill === null ? null : validateColor(obj.fill, 'style.fill'),
		opacity: validateNumber(obj.opacity, 'style.opacity', 0, 1)
	};
}

export function validateTransform(value: unknown): Transform {
	const obj = validateObject(value, ['x', 'y', 'scaleX', 'scaleY', 'rotation'], 'transform');
	return {
		x: coordinate(obj.x, 'transform.x'),
		y: coordinate(obj.y, 'transform.y'),
		scaleX: validateNumber(
			obj.scaleX,
			'transform.scaleX',
			ANIMATION_LIMITS.minScale,
			ANIMATION_LIMITS.maxScale
		),
		scaleY: validateNumber(
			obj.scaleY,
			'transform.scaleY',
			ANIMATION_LIMITS.minScale,
			ANIMATION_LIMITS.maxScale
		),
		rotation: coordinate(obj.rotation, 'transform.rotation')
	};
}

function coordinate(value: unknown, path: string): number {
	return validateNumber(
		value,
		path,
		-ANIMATION_LIMITS.maxCoordinate,
		ANIMATION_LIMITS.maxCoordinate
	);
}

export function validateEasing(value: unknown): Easing {
	const obj = validateObject(value, ['type', 'x1', 'y1', 'x2', 'y2'], 'easing');
	if (obj.type === 'linear' || obj.type === 'hold') {
		validateObject(obj, ['type'], 'easing');
		return { type: obj.type };
	}
	if (obj.type !== 'bezier') fail('Unsupported easing type.', 'easing');
	return {
		type: 'bezier',
		x1: validateNumber(obj.x1, 'easing.x1', 0, 1),
		y1: validateNumber(
			obj.y1,
			'easing.y1',
			-ANIMATION_LIMITS.maxEasingY,
			ANIMATION_LIMITS.maxEasingY
		),
		x2: validateNumber(obj.x2, 'easing.x2', 0, 1),
		y2: validateNumber(
			obj.y2,
			'easing.y2',
			-ANIMATION_LIMITS.maxEasingY,
			ANIMATION_LIMITS.maxEasingY
		)
	};
}

export function validatePath(value: unknown): PathData {
	assertJsonSafe(value);
	return parsePath(value);
}

function parsePath(value: unknown): PathData {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > ANIMATION_LIMITS.maxPathCommands
	)
		fail(`A path must contain 1-${ANIMATION_LIMITS.maxPathCommands} commands.`, 'path');
	let open = false;
	return value.map((item, index): PathCommand => {
		const path = `path[${index}]`;
		const obj = validateObject(item, ['type', 'x', 'y', 'x1', 'y1', 'x2', 'y2'], path);
		if (obj.type === 'Z') {
			validateObject(obj, ['type'], path);
			if (!open) fail('Z must close an open subpath.', path);
			open = false;
			return { type: 'Z' };
		}
		if (obj.type !== 'M' && obj.type !== 'L' && obj.type !== 'C')
			fail('Unsupported path command.', path);
		if (obj.type !== 'M' && !open) fail('Every subpath must begin with M.', path);
		open = true;
		const x = coordinate(obj.x, `${path}.x`);
		const y = coordinate(obj.y, `${path}.y`);
		if (obj.type === 'C')
			return {
				type: 'C',
				x,
				y,
				x1: coordinate(obj.x1, `${path}.x1`),
				y1: coordinate(obj.y1, `${path}.y1`),
				x2: coordinate(obj.x2, `${path}.x2`),
				y2: coordinate(obj.y2, `${path}.y2`)
			};
		validateObject(obj, ['type', 'x', 'y'], path);
		return { type: obj.type, x, y };
	});
}

export function validateKeyframe(value: unknown): ShapeKeyframe {
	assertJsonSafe(value);
	return parseKeyframe(value);
}

function parseKeyframe(value: unknown): ShapeKeyframe {
	const obj = validateObject(
		value,
		['paths', 'transform', 'easing', 'opacity', 'generated'],
		'keyframe'
	);
	if (!Array.isArray(obj.paths) || obj.paths.length !== 1)
		fail('MVP keyframes require exactly one path.', 'keyframe.paths');
	const result: ShapeKeyframe = {
		paths: obj.paths.map(parsePath),
		transform: validateTransform(obj.transform),
		easing: validateEasing(obj.easing)
	};
	if (Object.hasOwn(obj, 'opacity'))
		result.opacity = validateNumber(obj.opacity, 'keyframe.opacity', 0, 1);
	if (Object.hasOwn(obj, 'generated'))
		result.generated = validateBoolean(obj.generated, 'keyframe.generated');
	return result;
}

export function validateLayer(
	value: unknown,
	frameCount = ANIMATION_LIMITS.maxFrames
): VectorLayer {
	assertJsonSafe(value);
	return parseLayer(value, frameCount);
}

function parseLayer(value: unknown, frameCount: number): VectorLayer {
	const obj = validateObject(
		value,
		['id', 'name', 'visible', 'locked', 'zIndex', 'style', 'keyframes'],
		'layer'
	);
	if (obj.keyframes === null || typeof obj.keyframes !== 'object' || Array.isArray(obj.keyframes))
		fail('Expected a keyframe map.', 'layer.keyframes');
	const entries = Object.entries(obj.keyframes);
	if (entries.length > frameCount) fail('Too many keyframes.', 'layer.keyframes');
	const keyframes: Record<number, ShapeKeyframe> = {};
	for (const [key, keyframe] of entries) {
		if (!/^(0|[1-9]\d*)$/.test(key))
			fail('Keyframe keys must be canonical frame integers.', 'layer.keyframes');
		const frame = validateInteger(Number(key), 'frame', 0, frameCount - 1);
		keyframes[frame] = parseKeyframe(keyframe);
	}
	return {
		id: validateId(obj.id, 'layer.id'),
		name: validateName(obj.name, 'layer.name'),
		visible: validateBoolean(obj.visible, 'layer.visible'),
		locked: validateBoolean(obj.locked, 'layer.locked'),
		zIndex: validateInteger(obj.zIndex, 'layer.zIndex'),
		style: validateStyle(obj.style),
		keyframes
	};
}

function timestamp(value: unknown, path: string): string {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
		!Number.isFinite(Date.parse(value))
	)
		fail('Expected an ISO UTC timestamp.', path);
	const normalized = value.replace(
		/(?:\.(\d{1,3}))?Z$/,
		(_match, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`
	);
	if (new Date(value).toISOString() !== normalized) fail('Invalid calendar date.', path);
	return value;
}

export function validateAsset(value: unknown): AssetRecord {
	assertJsonSafe(value);
	const obj = validateObject(
		value,
		[
			'id',
			'name',
			'kind',
			'mimeType',
			'width',
			'height',
			'byteLength',
			'source',
			'blobKey',
			'createdAt'
		],
		'asset'
	);
	const kind = enumeration(obj.kind, ['raster', 'vector'], 'asset.kind');
	const mimeType = enumeration(
		obj.mimeType,
		['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
		'asset.mimeType'
	);
	if ((kind === 'vector') !== (mimeType === 'image/svg+xml'))
		fail('Asset kind and MIME type disagree.', 'asset');
	if (typeof obj.blobKey !== 'string' || !obj.blobKey.trim() || obj.blobKey.length > 256)
		fail('Invalid Blob storage key.', 'asset.blobKey');
	return {
		id: validateId(obj.id, 'asset.id'),
		name: validateName(obj.name, 'asset.name'),
		kind,
		mimeType,
		width: validateInteger(obj.width, 'asset.width', 1, 16_384),
		height: validateInteger(obj.height, 'asset.height', 1, 16_384),
		byteLength: validateInteger(
			obj.byteLength,
			'asset.byteLength',
			1,
			ANIMATION_LIMITS.maxAssetBytes
		),
		source: enumeration(obj.source, ['file', 'webmcp', 'vectorized'], 'asset.source'),
		blobKey: obj.blobKey,
		createdAt: timestamp(obj.createdAt, 'asset.createdAt')
	};
}

/** Strict, detached document parse; never migrates or partially repairs malformed input. */
export function parseProject(value: unknown): AnimationProject {
	if (typeof value === 'string') {
		if (value.length > ANIMATION_LIMITS.maxProjectBytes) fail('Project exceeds the size limit.');
		try {
			value = JSON.parse(value);
		} catch {
			fail('Invalid project JSON.');
		}
	}
	assertJsonSafe(value);
	const obj = validateObject(
		value,
		[
			'version',
			'kind',
			'id',
			'name',
			'canvas',
			'timeline',
			'layers',
			'assets',
			'revision',
			'createdAt',
			'updatedAt'
		],
		'project'
	);
	if (obj.version !== 1 || obj.kind !== 'vector-animation')
		fail('Unsupported project version or kind.', 'project');
	const timeline = validateTimeline(obj.timeline);
	if (!Array.isArray(obj.layers) || obj.layers.length > ANIMATION_LIMITS.maxLayers)
		fail('Invalid or oversized layer array.', 'layers');
	if (!Array.isArray(obj.assets) || obj.assets.length > ANIMATION_LIMITS.maxAssets)
		fail('Invalid or oversized asset array.', 'assets');
	const layers = obj.layers.map((layer) => parseLayer(layer, timeline.frameCount));
	const assets = obj.assets.map(validateAsset);
	const unique = (items: (string | number)[], path: string) => {
		if (new Set(items).size !== items.length) fail('Duplicate identifier or ordering index.', path);
	};
	unique(
		layers.map((layer) => layer.id),
		'layers'
	);
	unique(
		layers.map((layer) => layer.zIndex),
		'layers'
	);
	unique(
		assets.map((asset) => asset.id),
		'assets'
	);
	let commands = 0;
	for (const layer of layers)
		for (const keyframe of Object.values(layer.keyframes)) {
			commands += keyframe.paths.reduce((sum, path) => sum + path.length, 0);
			if (commands > ANIMATION_LIMITS.maxTotalPathCommands)
				fail('Project exceeds total path complexity limit.');
		}
	return {
		version: 1,
		kind: 'vector-animation',
		id: validateId(obj.id),
		name: validateName(obj.name),
		canvas: validateCanvas(obj.canvas),
		timeline,
		layers,
		assets,
		revision: validateInteger(obj.revision, 'revision'),
		createdAt: timestamp(obj.createdAt, 'createdAt'),
		updatedAt: timestamp(obj.updatedAt, 'updatedAt')
	};
}
