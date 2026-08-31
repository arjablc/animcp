import type { AnimationProject, VectorLayer } from '../animation/model';
import { ANIMATION_LIMITS, orderedLayers } from '../animation/model';
import { evaluateLayer } from '../animation/interpolation';
import { validateColor, validatePath } from '../animation/validation';

export type VectorSession = {
	currentFrame: number;
	selectedLayerId: string | null;
	playing: boolean;
};

export type VectorExportFormat = 'project' | 'svg' | 'lottie';

/** These callbacks use the same commands and session state as the human editor. */
export type VectorToolDependencies = {
	getProject(): AnimationProject;
	getSession(): VectorSession;
	execute(name: string, input: Record<string, unknown>, expectedRevision?: number): unknown;
	seek(frame: number): unknown;
	select(layerId: string | null): unknown;
	play(action: 'play' | 'pause' | 'restart'): unknown;
	undo(expectedRevision?: number): unknown;
	redo(expectedRevision?: number): unknown;
	/** Validate/decode/store bytes in the asset pipeline; return metadata, never bytes. */
	importAsset?(input: Record<string, unknown>): unknown;
	vectorizeAsset?(input: Record<string, unknown>): unknown;
	/** Perform the local download and return metadata, never a Blob or file contents. */
	exportFile?(format: VectorExportFormat): unknown;
};

export interface VectorTool {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
	annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}

/** Local structural typing, not a global shim. Draft: 26 August 2026. */
export interface VectorModelContext {
	registerTool(tool: VectorTool, options?: { signal?: AbortSignal }): Promise<void>;
	/** Optional legacy cleanup; current WebMCP unregisters through the signal. */
	unregisterTool?(name: string): void | Promise<void>;
}

export type VectorToolRegistration = {
	supported: boolean;
	message: string;
	dispose(): void;
};

type Schema = {
	type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
	properties?: Record<string, Schema>;
	additionalProperties?: false;
	required?: string[];
	minProperties?: number;
	items?: Schema;
	minItems?: number;
	maxItems?: number;
	minLength?: number;
	maxLength?: number;
	minimum?: number;
	maximum?: number;
	enum?: (string | number | boolean | null)[];
	pattern?: string;
	oneOf?: Schema[];
	default?: unknown;
	description?: string;
};

const object = (properties: Record<string, Schema> = {}, required: string[] = []): Schema => ({
	type: 'object',
	additionalProperties: false,
	properties,
	required
});
const number = (minimum: number, maximum: number, integer = false): Schema => ({
	type: integer ? 'integer' : 'number',
	minimum,
	maximum
});
const string = (maxLength: number, pattern?: string): Schema => ({
	type: 'string',
	minLength: 1,
	maxLength,
	...(pattern ? { pattern } : {})
});
const enumeration = (...values: string[]): Schema => ({
	type: 'string',
	enum: values,
	minLength: 1,
	maxLength: Math.max(...values.map((v) => v.length))
});
const array = (items: Schema, minItems: number, maxItems: number): Schema => ({
	type: 'array',
	items,
	minItems,
	maxItems
});
const boolean: Schema = { type: 'boolean' };
const id = string(128, '^(?!(?:__proto__|prototype|constructor)$)[a-zA-Z0-9_-]+$');
const name = string(ANIMATION_LIMITS.maxNameLength, '\\S');
const revision = number(0, Number.MAX_SAFE_INTEGER, true);
const frame = {
	...number(0, ANIMATION_LIMITS.maxFrames - 1, true),
	description: 'Zero-based frame within the project timeline.'
};
const coordinate = number(-ANIMATION_LIMITS.maxCoordinate, ANIMATION_LIMITS.maxCoordinate);
const color = string(100, '^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\\([0-9., ]+\\))$');
const style: Schema = {
	...object({
		stroke: color,
		strokeWidth: number(0, 1000),
		strokeLineCap: enumeration('butt', 'round', 'square'),
		strokeLineJoin: enumeration('miter', 'round', 'bevel'),
		fill: { oneOf: [color, { type: 'null' }] },
		opacity: number(0, 1)
	}),
	minProperties: 1
};
const transform: Schema = {
	...object({
		x: coordinate,
		y: coordinate,
		scaleX: number(ANIMATION_LIMITS.minScale, ANIMATION_LIMITS.maxScale),
		scaleY: number(ANIMATION_LIMITS.minScale, ANIMATION_LIMITS.maxScale),
		rotation: coordinate
	}),
	minProperties: 1
};
const easing: Schema = {
	oneOf: [
		object({ type: enumeration('linear') }, ['type']),
		object({ type: enumeration('hold') }, ['type']),
		object(
			{
				type: enumeration('bezier'),
				x1: number(0, 1),
				y1: number(-10, 10),
				x2: number(0, 1),
				y2: number(-10, 10)
			},
			['type', 'x1', 'y1', 'x2', 'y2']
		)
	]
};
const pathCommand: Schema = {
	oneOf: [
		object({ type: enumeration('M'), x: coordinate, y: coordinate }, ['type', 'x', 'y']),
		object({ type: enumeration('L'), x: coordinate, y: coordinate }, ['type', 'x', 'y']),
		object(
			{
				type: enumeration('C'),
				x: coordinate,
				y: coordinate,
				x1: coordinate,
				y1: coordinate,
				x2: coordinate,
				y2: coordinate
			},
			['type', 'x', 'y', 'x1', 'y1', 'x2', 'y2']
		),
		object({ type: enumeration('Z') }, ['type'])
	]
};
const paths = array(array(pathCommand, 1, ANIMATION_LIMITS.maxPathCommands), 1, 1);
const meta = { expectedRevision: revision, requestId: string(128) };
const mutation = (properties: Record<string, Schema>, required: string[] = []): Schema =>
	object({ ...properties, ...meta }, [...required, 'expectedRevision']);

type Definition = {
	name: string;
	description: string;
	schema: Schema;
	kind: 'read' | 'command' | 'session' | 'history' | 'asset' | 'export';
};

const coreCommands: [string, string, Record<string, Schema>, string[]][] = [
	['rename_project', 'Rename the current project.', { name }, ['name']],
	[
		'update_canvas',
		'Update canvas settings. Width 240–1920 and height 240–1080.',
		{ width: number(240, 1920, true), height: number(240, 1080, true), background: color },
		[]
	],
	[
		'update_timeline',
		'Update FPS or frame count; duration must remain 1–60 seconds.',
		{
			fps: { ...number(12, 30, true), enum: [12, 15, 24, 30] },
			frameCount: number(12, 1800, true)
		},
		[]
	],
	[
		'add_layer',
		'Create one editable path layer with optional static style and atomic initial keyframe.',
		{ name, style, paths, frame, transform, easing, opacity: number(0, 1) },
		['name']
	],
	['remove_layer', 'Remove a layer and its keyframes.', { layerId: id }, ['layerId']],
	['rename_layer', 'Rename a layer.', { layerId: id, name }, ['layerId', 'name']],
	[
		'set_layer_visibility',
		'Show or hide a layer.',
		{ layerId: id, visible: boolean },
		['layerId', 'visible']
	],
	[
		'set_layer_lock',
		'Lock or unlock a layer.',
		{ layerId: id, locked: boolean },
		['layerId', 'locked']
	],
	[
		'set_layer_style',
		'Update static stroke, fill, or opacity for a layer.',
		{ layerId: id, style },
		['layerId', 'style']
	],
	[
		'reorder_layer',
		'Move a layer to a zero-based position in the layer stack.',
		{ layerId: id, zIndex: number(0, ANIMATION_LIMITS.maxLayers - 1, true) },
		['layerId', 'zIndex']
	],
	[
		'add_keyframe',
		'Create a keyframe with one canonical absolute M/L/C/Z path. Style is static per layer.',
		{
			layerId: id,
			frame,
			paths,
			transform,
			easing,
			style,
			opacity: number(0, 1),
			overwrite: { ...boolean, default: false }
		},
		['layerId', 'frame']
	],
	[
		'update_keyframe',
		'Update an existing keyframe geometry, transform, or easing; optional style is static.',
		{ layerId: id, frame, paths, transform, easing, style, opacity: number(0, 1) },
		['layerId', 'frame']
	],
	['delete_keyframe', 'Delete one keyframe.', { layerId: id, frame }, ['layerId', 'frame']],
	[
		'update_path',
		'Replace a keyframe path with validated absolute M/L/C/Z geometry.',
		{ layerId: id, frame, paths },
		['layerId', 'frame', 'paths']
	],
	[
		'generate_inbetweens',
		'Generate between existing compatible endpoint keyframes. Preserve authored frames unless overwrite is true.',
		{ layerId: id, startFrame: frame, endFrame: frame, overwrite: { ...boolean, default: false } },
		['layerId', 'startFrame', 'endFrame']
	],
	[
		'clear_generated_inbetweens',
		'Remove only generated keyframes, optionally within an inclusive frame range.',
		{ layerId: id, startFrame: frame, endFrame: frame },
		['layerId']
	]
];

class ToolFailure extends Error {
	constructor(
		public category: string,
		message: string
	) {
		super(message);
	}
}

function validate(schema: Schema, value: unknown, at = 'input'): void {
	const fail = () => {
		throw new ToolFailure('validation', `${at} does not match the tool schema.`);
	};
	if (schema.oneOf) {
		let matches = 0;
		for (const variant of schema.oneOf) {
			try {
				validate(variant, value, at);
				matches++;
			} catch {
				/* Try the other schema alternatives. */
			}
		}
		if (matches !== 1) fail();
		return;
	}
	if (schema.enum && !schema.enum.includes(value as never)) fail();
	switch (schema.type) {
		case 'object': {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
			const prototype = Object.getPrototypeOf(value);
			if (prototype !== Object.prototype && prototype !== null) return fail();
			const properties = schema.properties ?? {};
			const input = value as Record<string, unknown>;
			const keys = Reflect.ownKeys(input);
			if (keys.length < (schema.minProperties ?? 0)) fail();
			if (schema.required?.some((key) => !Object.hasOwn(input, key))) fail();
			for (const key of keys) {
				if (typeof key !== 'string' || !Object.hasOwn(properties, key)) return fail();
				const descriptor = Object.getOwnPropertyDescriptor(input, key);
				if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail();
				validate(properties[key], descriptor.value, `${at}.${key}`);
			}
			return;
		}
		case 'array':
			if (
				!Array.isArray(value) ||
				value.length < schema.minItems! ||
				value.length > schema.maxItems!
			)
				return fail();
			if (
				Object.getPrototypeOf(value) !== Array.prototype ||
				Reflect.ownKeys(value).length !== value.length + 1
			)
				return fail();
			for (let i = 0; i < value.length; i++) {
				const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
				if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail();
				validate(schema.items!, descriptor.value, `${at}[]`);
			}
			return;
		case 'string':
			if (
				typeof value !== 'string' ||
				value.length < (schema.minLength ?? 0) ||
				value.length > schema.maxLength! ||
				(schema.pattern && !new RegExp(schema.pattern).test(value))
			)
				fail();
			return;
		case 'integer':
		case 'number':
			if (
				typeof value !== 'number' ||
				!Number.isFinite(value) ||
				value < schema.minimum! ||
				value > schema.maximum! ||
				(schema.type === 'integer' && !Number.isSafeInteger(value))
			)
				fail();
			return;
		case 'boolean':
			if (typeof value !== 'boolean') fail();
			return;
		case 'null':
			if (value !== null) fail();
			return;
		default:
			fail();
	}
}

function validateSemantics(
	tool: string,
	input: Record<string, unknown>,
	project: AnimationProject
) {
	const fail = (message: string) => {
		throw new ToolFailure('validation', message);
	};
	for (const key of ['frame', 'startFrame', 'endFrame']) {
		if (typeof input[key] === 'number' && input[key] >= project.timeline.frameCount)
			fail('Frame must be inside the current timeline.');
	}
	if (input.layerId != null && !project.layers.some((layer) => layer.id === input.layerId))
		fail('Layer does not exist.');
	if (typeof input.zIndex === 'number' && input.zIndex >= project.layers.length)
		fail('Layer position must be inside the current layer stack.');
	if (
		typeof input.startFrame === 'number' &&
		typeof input.endFrame === 'number' &&
		(input.endFrame < input.startFrame ||
			(tool === 'generate_inbetweens' && input.endFrame === input.startFrame))
	)
		fail('The end frame must follow the start frame.');
	if (tool === 'update_canvas' && !['width', 'height', 'background'].some((key) => key in input))
		fail('Provide at least one canvas setting.');
	if (tool === 'update_timeline') {
		if (!('fps' in input) && !('frameCount' in input))
			fail('Provide at least one timeline setting.');
		const fps = (input.fps as number | undefined) ?? project.timeline.fps;
		const count = (input.frameCount as number | undefined) ?? project.timeline.frameCount;
		if (count < fps || count > fps * 60) fail('Timeline duration must be 1–60 seconds.');
	}
	if (
		tool === 'update_keyframe' &&
		!['paths', 'transform', 'easing', 'style', 'opacity'].some((key) => key in input)
	)
		fail('Provide a keyframe change.');
	if (input.paths) {
		for (const path of input.paths as unknown[]) validatePath(path);
	}
	if (input.background !== undefined) validateColor(input.background);
	if (input.style)
		for (const key of ['stroke', 'fill']) {
			const value = (input.style as Record<string, unknown>)[key];
			if (value !== undefined && value !== null) validateColor(value);
		}
	if (
		tool === 'vectorize_asset' &&
		!project.assets.some((asset) => asset.id === input.assetId && asset.kind === 'raster')
	)
		fail('Raster asset does not exist.');
	if (tool === 'import_asset') {
		const data = input.dataBase64 as string;
		if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
			fail('Provide canonical base64 without a data URL prefix.');
		const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
		if ((data.length / 4) * 3 - padding > ANIMATION_LIMITS.maxAssetBytes)
			fail('Raster assets must not exceed 10 MiB decoded.');
	}
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function sessionData(session: VectorSession): VectorSession {
	// A structurally compatible session may also carry the entire project or runtime handles.
	return {
		currentFrame: session.currentFrame,
		selectedLayerId: session.selectedLayerId,
		playing: session.playing
	};
}

function layerData(layer: VectorLayer, includePaths: boolean) {
	return {
		id: layer.id,
		name: layer.name,
		visible: layer.visible,
		locked: layer.locked,
		zIndex: layer.zIndex,
		style: clone(layer.style),
		keyframes: includePaths
			? clone(layer.keyframes)
			: Object.entries(layer.keyframes)
					.map(([frame, keyframe]) => ({
						frame: Number(frame),
						generated: keyframe.generated === true
					}))
					.sort((a, b) => a.frame - b.frame)
	};
}

/** Explicit allowlist prevents command return values from leaking project/binary payloads. */
function metadata(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object') return {};
	const result: Record<string, unknown> = {};
	const source = value as Record<string, unknown>;
	for (const key of ['id', 'layerId', 'assetId', 'name', 'filename', 'mimeType', 'format']) {
		if (typeof source[key] === 'string' && source[key].length <= 256) result[key] = source[key];
	}
	for (const key of ['width', 'height', 'byteLength', 'frame', 'count', 'generatedCount']) {
		if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] >= 0)
			result[key] = source[key];
	}
	if (
		Array.isArray(source.changed) &&
		source.changed.length <= 500 &&
		source.changed.every((item) => typeof item === 'string' && item.length <= 128)
	)
		result.changed = [...source.changed];
	return result;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
			.join(',')}}`;
	return JSON.stringify(value);
}

async function fingerprint(tool: string, input: Record<string, unknown>): Promise<string> {
	// Keep only a SHA-256 digest: large asset payloads must not live in the retry cache.
	const hash = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(canonical({ tool, input }))
	);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Native callbacks return raw serializable results, not MCP text/content envelopes.
 * Request IDs retain the last 128 settled/in-flight calls for this registration.
 * A replay returns the original result even after subsequent edits, without reapplying it.
 * After eviction, expectedRevision still protects durable edits; IDs are not durable history.
 */
export async function registerVectorTools(
	deps: VectorToolDependencies,
	signal?: AbortSignal,
	context?: VectorModelContext | null
): Promise<VectorToolRegistration> {
	if (context === undefined) {
		try {
			context =
				typeof document === 'undefined'
					? null
					: (document as Document & { modelContext?: VectorModelContext }).modelContext;
		} catch {
			context = null;
		}
	}
	if (!context || typeof context.registerTool !== 'function')
		return {
			supported: false,
			message: 'WebMCP unavailable; the editor remains usable.',
			dispose() {}
		};
	const modelContext = context;
	const controller = new AbortController();
	let active = true;
	let busy = false;
	const registered = new Set<string>();
	type Entry = { fingerprint: string; result: Promise<Record<string, unknown>>; settled: boolean };
	const requests = new Map<string, Entry>();
	function unregister(name: string) {
		try {
			void Promise.resolve(modelContext.unregisterTool?.(name)).catch(() => {});
		} catch {
			/* Callback invalidation and the abort signal do not depend on legacy cleanup. */
		}
	}
	function dispose() {
		if (!active) return;
		active = false;
		signal?.removeEventListener('abort', dispose);
		controller.abort();
		for (const name of registered) unregister(name);
		registered.clear();
		requests.clear();
	}
	signal?.addEventListener('abort', dispose, { once: true });
	if (signal?.aborted) dispose();
	function assertActive(callSignal?: AbortSignal) {
		if (!active || callSignal?.aborted)
			throw new ToolFailure('aborted', 'Tool registration or invocation is no longer active.');
	}
	function failure(error: unknown): Record<string, unknown> {
		let category = 'validation';
		let message = 'The operation was rejected. Check the input and current project state.';
		if (error instanceof ToolFailure) {
			category = error.category;
			message = error.message;
		} else if (error instanceof Error && /^Revision conflict\b/i.test(error.message)) {
			category = 'conflict';
			message = 'Revision conflict. Read the project before retrying.';
		} else if (
			error &&
			typeof error === 'object' &&
			'category' in error &&
			['conflict', 'validation', 'busy', 'unsupported', 'not_found', 'locked', 'internal'].includes(
				String(error.category)
			)
		) {
			category = String(error.category);
			const messages: Record<string, string> = {
				conflict: 'Revision conflict. Read the project before retrying.',
				busy: 'Wait for the current operation to finish.',
				unsupported: 'This operation is not supported.',
				not_found: 'The requested layer, keyframe, or asset does not exist.',
				locked: 'Unlock the layer before editing it.',
				internal: 'The operation could not be completed.'
			};
			message = messages[category] ?? message;
		}
		let revision: number | undefined;
		try {
			revision = deps.getProject().revision;
		} catch {
			/* The route may already be destroyed. */
		}
		return {
			ok: false,
			category,
			message,
			...(revision === undefined ? {} : { revision }),
			...(category === 'conflict' && revision !== undefined ? { currentRevision: revision } : {})
		};
	}
	const capabilities = {
		importAsset: typeof deps.importAsset === 'function',
		vectorizeAsset: typeof deps.vectorizeAsset === 'function',
		exportProject: typeof deps.exportFile === 'function',
		exportSvg: typeof deps.exportFile === 'function',
		exportLottie: typeof deps.exportFile === 'function'
	};
	function read(name: string, input: Record<string, unknown>) {
		const project = deps.getProject();
		const session = deps.getSession();
		const base = { ok: true, revision: project.revision };
		if (name === 'get_selection') {
			const layer = project.layers.find((layer) => layer.id === session.selectedLayerId);
			return {
				...base,
				selectedLayerId: session.selectedLayerId,
				currentFrame: session.currentFrame,
				layer: layer ? layerData(layer, false) : null
			};
		}
		if (name === 'get_timeline')
			return {
				...base,
				...clone(project.timeline),
				currentFrame: session.currentFrame,
				playing: session.playing,
				tracks: project.layers.map((layer) => ({
					layerId: layer.id,
					name: layer.name,
					keyframes: layerData(layer, false).keyframes
				}))
			};
		if (name === 'get_scene') {
			const frame = (input.frame as number | undefined) ?? session.currentFrame;
			return {
				...base,
				canvas: clone(project.canvas),
				currentFrame: session.currentFrame,
				frame,
				layers: orderedLayers(project.layers).map((layer) => ({
					...layerData(layer, true),
					evaluated: clone(evaluateLayer(layer, frame))
				}))
			};
		}
		return {
			...base,
			version: project.version,
			kind: project.kind,
			id: project.id,
			name: project.name,
			createdAt: project.createdAt,
			updatedAt: project.updatedAt,
			canvas: clone(project.canvas),
			timeline: clone(project.timeline),
			...sessionData(session),
			capabilities,
			layers: project.layers.map((layer) => layerData(layer, input.includePaths === true)),
			assets: project.assets.map(metadata)
		};
	}
	const definitions: Definition[] = [
		{
			name: 'get_project',
			description:
				'Read metadata, layer/keyframe summaries, session, revision, and capabilities. Set includePaths to request full canonical paths.',
			schema: object({ includePaths: { ...boolean, default: false } }),
			kind: 'read'
		},
		{
			name: 'get_scene',
			description:
				'Read canonical layers and keyframes with evaluated geometry at an optional frame (defaults to the playhead). No renderer objects are exposed.',
			schema: object({ frame }),
			kind: 'read'
		},
		{
			name: 'get_selection',
			description: 'Read the selected layer summary and current frame.',
			schema: object(),
			kind: 'read'
		},
		{
			name: 'get_timeline',
			description:
				'Read timeline settings, playhead, playback state, and layer keyframe positions.',
			schema: object(),
			kind: 'read'
		},
		...coreCommands.map(([name, description, properties, required]): Definition => ({
			name,
			description,
			schema: mutation(properties, required),
			kind: 'command'
		})),
		{
			name: 'set_current_frame',
			description: 'Seek a zero-based frame without changing the project revision.',
			schema: object({ frame, ...meta }, ['frame']),
			kind: 'session'
		},
		{
			name: 'select_layer',
			description: 'Select a layer, or null to clear selection, without changing project revision.',
			schema: object({ layerId: { oneOf: [id, { type: 'null' }] }, ...meta }, ['layerId']),
			kind: 'session'
		},
		...(['play', 'pause', 'restart'] as const).map((name): Definition => ({
			name,
			description: `${name === 'restart' ? 'Restart from frame zero' : name === 'play' ? 'Start playback' : 'Pause playback'} without changing project revision.`,
			schema: object(meta),
			kind: 'session'
		})),
		...(['undo', 'redo'] as const).map((name): Definition => ({
			name,
			description: `${name === 'undo' ? 'Undo' : 'Redo'} one committed human or agent command using revision protection.`,
			schema: mutation({}),
			kind: 'history'
		}))
	];
	if (capabilities.importAsset)
		definitions.push({
			name: 'import_asset',
			kind: 'asset',
			description:
				'Import a PNG, JPEG, or WebP as a stored raster asset (at most 10 MiB decoded). Transport availability does not prove generated-image handoff support.',
			schema: mutation(
				{
					name,
					mimeType: enumeration('image/png', 'image/jpeg', 'image/webp'),
					dataBase64: string(Math.ceil(ANIMATION_LIMITS.maxAssetBytes / 3) * 4)
				},
				['name', 'mimeType', 'dataBase64']
			)
		});
	if (capabilities.vectorizeAsset)
		definitions.push({
			name: 'vectorize_asset',
			kind: 'asset',
			description:
				'Vectorize an existing raster asset through the optional bounded asset pipeline.',
			schema: mutation({ assetId: id }, ['assetId'])
		});
	if (deps.exportFile)
		for (const format of ['project', 'svg', 'lottie'] as const)
			definitions.push({
				name: `export_${format}`,
				kind: 'export',
				schema: object(meta),
				description: `Download ${format === 'project' ? 'the native project JSON' : format === 'svg' ? 'SVG for the current frame' : 'supported vector Lottie'}. Return file metadata only.`
			});

	async function perform(
		def: Definition,
		input: Record<string, unknown>,
		projectId: string,
		callSignal?: AbortSignal
	) {
		assertActive(callSignal);
		const project = deps.getProject();
		if (
			project.id !== projectId ||
			(input.expectedRevision !== undefined && input.expectedRevision !== project.revision)
		)
			throw new ToolFailure('conflict', 'Revision conflict. Read the project before retrying.');
		validateSemantics(def.name, input, project);
		if (def.kind === 'read') return read(def.name, input);
		if (busy) throw new ToolFailure('busy', 'Another tool operation is still in progress.');
		busy = true;
		try {
			const payload = { ...input };
			delete payload.expectedRevision;
			delete payload.requestId;
			let result: unknown;
			if (def.kind === 'command')
				result = await deps.execute(def.name, payload, input.expectedRevision as number);
			else if (def.kind === 'history')
				result = await (def.name === 'undo'
					? deps.undo(input.expectedRevision as number)
					: deps.redo(input.expectedRevision as number));
			else if (def.kind === 'asset')
				result = await (def.name === 'import_asset'
					? deps.importAsset!(input)
					: deps.vectorizeAsset!(input));
			else if (def.kind === 'export')
				result = await deps.exportFile!(def.name.slice(7) as VectorExportFormat);
			else if (def.name === 'set_current_frame') result = await deps.seek(input.frame as number);
			else if (def.name === 'select_layer')
				result = await deps.select(input.layerId as string | null);
			else result = await deps.play(def.name as 'play' | 'pause' | 'restart');
			if (result && typeof result === 'object' && 'ok' in result && result.ok === false)
				return failure(result);
			const resultRevision =
				result && typeof result === 'object' && 'revision' in result ? result.revision : undefined;
			return {
				ok: true,
				revision:
					typeof resultRevision === 'number' &&
					Number.isSafeInteger(resultRevision) &&
					resultRevision >= 0
						? resultRevision
						: deps.getProject().revision,
				...metadata(result),
				...(def.kind === 'session' ? sessionData(deps.getSession()) : {})
			};
		} finally {
			busy = false;
		}
	}

	function makeTool(def: Definition): VectorTool {
		return {
			name: def.name,
			title: def.name
				.split('_')
				.map((part) => part[0].toUpperCase() + part.slice(1))
				.join(' '),
			description: def.description,
			inputSchema: def.schema,
			annotations: { readOnlyHint: def.kind === 'read', untrustedContentHint: true },
			async execute(raw, options) {
				try {
					assertActive(options?.signal);
					validate(def.schema, raw);
					const input = clone(raw as Record<string, unknown>);
					const projectId = deps.getProject().id;
					const requestId = input.requestId as string | undefined;
					if (!requestId) return clone(await perform(def, input, projectId, options?.signal));
					const digest = await fingerprint(def.name, input);
					assertActive(options?.signal);
					if (deps.getProject().id !== projectId)
						throw new ToolFailure('conflict', 'Project changed before the operation started.');
					const key = `${projectId}\u0000${requestId}`;
					const existing = requests.get(key);
					if (existing) {
						if (existing.fingerprint !== digest)
							throw new ToolFailure(
								'conflict',
								'requestId was already used for a different tool input.'
							);
						return clone(await existing.result);
					}
					if (requests.size >= 128) {
						const oldest = [...requests].find(([, entry]) => entry.settled);
						if (!oldest)
							throw new ToolFailure('busy', 'The request cache is full of pending operations.');
						requests.delete(oldest[0]);
					}
					const entry: Entry = {
						fingerprint: digest,
						settled: false,
						result: Promise.resolve()
							.then(() => perform(def, input, projectId, options?.signal))
							.catch(failure)
					};
					requests.set(key, entry);
					const result = await entry.result;
					entry.settled = true;
					return clone(result);
				} catch (error) {
					return failure(error);
				}
			}
		};
	}

	try {
		for (const definition of definitions) {
			assertActive();
			await modelContext.registerTool(makeTool(definition), { signal: controller.signal });
			if (!active) {
				unregister(definition.name);
				assertActive();
			}
			registered.add(definition.name);
		}
		return { supported: true, message: `${registered.size} vector tools ready.`, dispose };
	} catch {
		const aborted = !active;
		dispose();
		return {
			supported: true,
			message: aborted
				? 'WebMCP registration aborted.'
				: 'WebMCP registration rejected; partial registrations invalidated.',
			dispose
		};
	}
}
