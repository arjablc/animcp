import type { Input } from './commands';
import { check, number, string } from './model';

export type Schema = {
	type?: string;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: boolean;
	items?: Schema;
	enum?: unknown[];
	minimum?: number;
	maximum?: number;
	maxLength?: number;
	maxItems?: number;
	anyOf?: Schema[];
};
export type Tool = {
	name: string;
	description: string;
	inputSchema: Schema;
	annotations?: {
		readOnlyHint?: boolean;
	};
	execute: (input: Input) => Promise<unknown>;
};
export type ModelContext = {
	registerTool: (tool: Tool, options?: { signal: AbortSignal }) => void | Promise<void>;
	unregisterTool?: (name: string) => void | Promise<void>;
};

const str: Schema = { type: 'string', maxLength: 10000 },
	num: Schema = { type: 'number' },
	integer: Schema = { type: 'integer' },
	bool: Schema = { type: 'boolean' },
	ids: Schema = { type: 'array', items: str, maxItems: 200 };
export const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
	type: 'object',
	properties,
	required,
	additionalProperties: false
});
const en = (...values: string[]): Schema => ({ type: 'string', enum: values });
const range = obj({ startFrame: integer, endFrame: integer }, ['startFrame', 'endFrame']);
const pathCommand: Schema = obj({
	type: en('M', 'L', 'C', 'Z'),
	x: num,
	y: num,
	x1: num,
	y1: num,
	x2: num,
	y2: num
});
const paths: Schema = {
	type: 'array',
	items: { type: 'array', items: pathCommand, maxItems: 10000 },
	maxItems: 200
};
const pathBounds = obj({ positionX: num, positionY: num, width: num, height: num }, [
	'positionX',
	'positionY',
	'width',
	'height'
]);
const lock = obj(
	Object.fromEntries(
		['startFrame', 'endFrame', 'duration', 'startValue', 'endValue', 'easing'].map((name) => [
			name,
			bool
		])
	)
);
const ease: Schema = {
	anyOf: [
		obj({ type: en('linear', 'hold') }, ['type']),
		obj({ type: en('bezier'), x1: num, y1: num, x2: num, y2: num }, [
			'type',
			'x1',
			'y1',
			'x2',
			'y2'
		]),
		obj({ type: en('spring'), mass: num, stiffness: num, damping: num, velocity: num }, [
			'type',
			'mass',
			'stiffness',
			'damping',
			'velocity'
		])
	]
};
const val: Schema = { anyOf: [num, str] };
const scope = { layerIds: ids, properties: ids, keyframeIds: ids, range, preserve: lock };

export const operationSchemas: Record<string, Schema> = {
	create_layer: obj(
		{
			type: en('rectangle', 'ellipse', 'text', 'svg', 'png', 'group'),
			name: str,
			text: str,
			fontFamily: str,
			assetId: str
		},
		['type']
	),
	duplicate_layer: obj({ layerId: str }, ['layerId']),
	group_layers: obj({ layerIds: ids, name: str }, ['layerIds']),
	delete_layer: obj({ layerId: str }, ['layerId']),
	set_layer: obj(
		{
			layerId: str,
			changes: obj({
				name: str,
				visible: bool,
				locked: bool,
				text: str,
				fontFamily: str,
				fontWeight: num,
				fontStyle: en('normal', 'italic'),
				fontSize: num
			})
		},
		['layerId', 'changes']
	),
	reorder_layer: obj({ layerId: str, index: integer }, ['layerId', 'index']),
	create_path: obj({ name: str, paths, bounds: pathBounds }, ['paths', 'bounds']),
	set_path: obj({ layerId: str, paths }, ['layerId', 'paths']),
	set_property: obj({ layerId: str, property: str, value: val, frame: integer }, [
		'layerId',
		'property',
		'value'
	]),
	add_keyframe: obj({ layerId: str, property: str, value: val, frame: integer, easing: ease }, [
		'layerId',
		'property',
		'frame'
	]),
	delete_keyframes: obj({ keyframeIds: ids }, ['keyframeIds']),
	move_keyframes: obj({ keyframeIds: ids, frames: integer }, ['keyframeIds', 'frames']),
	set_easing: obj({ ...scope, preset: str, easing: ease }),
	set_motion_locks: obj({ layerId: str, property: str, locks: lock }, [
		'layerId',
		'property',
		'locks'
	]),
	set_paint: obj({ layerId: str, type: en('solid', 'linear', 'radial') }, ['layerId', 'type']),
	add_gradient_stop: obj({ layerId: str, offset: num, color: str }, ['layerId', 'offset', 'color']),
	delete_gradient_stop: obj({ layerId: str, stopId: str }, ['layerId', 'stopId']),
	shift_motion: obj({ ...scope, frames: integer }, ['frames']),
	stagger_motion: obj({ ...scope, offsetFrames: integer, direction: en('forward', 'reverse') }, [
		'offsetFrames'
	]),
	align_keyframes: obj({ ...scope, mode: en('start', 'end', 'center'), frame: integer }, [
		'mode',
		'frame'
	]),
	retime_motion: obj(
		{ ...scope, scale: num, anchor: en('start', 'end', 'center', 'playhead'), playhead: integer },
		['scale', 'anchor']
	),
	reverse_motion: obj(scope),
	add_overshoot: obj({ ...scope, amount: num, settleFrames: integer }),
	add_anticipation: obj({ ...scope, amount: num, settleFrames: integer }),
	distribute_timing: obj({ ...scope, startFrame: integer, endFrame: integer }, [
		'startFrame',
		'endFrame'
	]),
	normalize_motion: obj({ ...scope, sourceLayerId: str }, ['sourceLayerId']),
	copy_motion: obj(
		{
			sourceLayerId: str,
			targetLayerIds: ids,
			properties: ids,
			mode: en('absolute', 'relative'),
			sourceFrame: integer,
			targetFrame: integer,
			includeTiming: bool,
			includeEasing: bool,
			preserve: lock
		},
		['sourceLayerId', 'targetLayerIds', 'properties', 'mode']
	),
	sequence_motion: obj(
		{
			...scope,
			referenceLayerId: str,
			referenceProperties: ids,
			referenceRange: range,
			anchor: en('start', 'end'),
			gapFrames: integer
		},
		['referenceLayerId']
	)
};

export const actionGroups = {
	layers: [
		'create_layer',
		'duplicate_layer',
		'group_layers',
		'delete_layer',
		'set_layer',
		'reorder_layer'
	],
	path: ['create_path', 'set_path'],
	animation: [
		'set_property',
		'add_keyframe',
		'delete_keyframes',
		'move_keyframes',
		'set_easing',
		'set_motion_locks',
		'set_paint',
		'add_gradient_stop',
		'delete_gradient_stop'
	],
	timeline: [
		'shift_motion',
		'stagger_motion',
		'align_keyframes',
		'retime_motion',
		'reverse_motion',
		'add_overshoot',
		'add_anticipation',
		'distribute_timing',
		'normalize_motion',
		'copy_motion',
		'sequence_motion'
	]
} as const;

export const publicActions = Object.values(actionGroups).flat();
export const actionSchema = (actions: readonly string[]) =>
	obj(
		{
			action: en(...actions),
			input: { type: 'object' },
			expectedRevision: integer,
			expectedContextRevision: integer,
			requestId: str
		},
		['action', 'input', 'expectedRevision']
	);
export const batchSchema = obj(
	{
		label: str,
		operations: {
			type: 'array',
			maxItems: 100,
			items: obj({ action: en(...publicActions), input: { type: 'object' } }, ['action', 'input'])
		},
		expectedRevision: integer,
		expectedContextRevision: integer,
		requestId: str
	},
	['label', 'operations', 'expectedRevision']
);

export const readSchemas = {
	get_editor_context: obj({ requestId: str }),
	find_elements: obj(
		{
			text: str,
			match: en('exact', 'contains'),
			caseSensitive: bool,
			visibleOnly: bool,
			layerIds: ids,
			requestId: str
		},
		['text']
	),
	get_layer: obj({ layerId: str, requestId: str }, ['layerId']),
	get_motion: obj({ layerIds: ids, properties: ids, range, requestId: str }),
	get_operation_schema: obj({ action: en(...publicActions), requestId: str }, ['action'])
};

export const toolDeclarations: Record<string, Omit<Tool, 'execute'>> = {
	get_editor_context: {
		name: 'get_editor_context',
		description: 'Read the composition, selection, layers, assets, locks, and revisions.',
		inputSchema: readSchemas.get_editor_context
	},
	find_elements: {
		name: 'find_elements',
		description: 'Find text layers by their text content.',
		inputSchema: readSchemas.find_elements
	},
	get_layer: {
		name: 'get_layer',
		description: 'Read one complete layer by ID.',
		inputSchema: readSchemas.get_layer
	},
	get_motion: {
		name: 'get_motion',
		description: 'Read property tracks and keyframes for layers.',
		inputSchema: readSchemas.get_motion
	},
	get_operation_schema: {
		name: 'get_operation_schema',
		description: 'Get the exact input schema for one write action.',
		inputSchema: readSchemas.get_operation_schema
	},
	edit_layers: {
		name: 'edit_layers',
		description: 'Create, update, duplicate, group, delete, or reorder layers.',
		inputSchema: actionSchema(actionGroups.layers)
	},
	edit_path: {
		name: 'edit_path',
		description: 'Create a path layer or replace its path geometry.',
		inputSchema: actionSchema(actionGroups.path)
	},
	edit_animation: {
		name: 'edit_animation',
		description: 'Edit properties, keyframes, easing, locks, fills, strokes, and gradients.',
		inputSchema: actionSchema(actionGroups.animation)
	},
	edit_timeline: {
		name: 'edit_timeline',
		description: 'Shift, stagger, align, retime, reverse, copy, or sequence motion.',
		inputSchema: actionSchema(actionGroups.timeline)
	},
	apply_edits: {
		name: 'apply_edits',
		description: 'Apply write actions atomically as one undo entry.',
		inputSchema: batchSchema
	}
};

export const actionDescriptions: Record<string, string> = {
	create_path: 'Create a path layer from SVG-style path commands and explicit bounds.',
	set_paint: 'Set a layer fill to solid, linear gradient, or radial gradient.',
	add_gradient_stop: 'Add an animatable color stop to a gradient.',
	delete_gradient_stop: 'Remove a gradient color stop.',
	set_property:
		'Set a static or keyed layer property, including fill, stroke, and gradient values.',
	add_keyframe: 'Add a keyframe to any layer property, including animatable style properties.',
	sequence_motion: 'Place target animation before or after a reference animation.',
	retime_motion: 'Scale motion duration around an anchor.',
	copy_motion: 'Copy property tracks between layers.'
};

export function validate(schema: Schema, value: unknown, path = 'input'): void {
	if (schema.anyOf) {
		check(
			schema.anyOf.some((candidate) => {
				try {
					validate(candidate, value, path);
					return true;
				} catch {
					return false;
				}
			}),
			`${path}: invalid value`
		);
		return;
	}
	if (schema.type === 'object') {
		check(value && typeof value === 'object' && !Array.isArray(value), `${path}: expected object`);
		const input = value as Input;
		for (const key of schema.required ?? [])
			check(input[key] !== undefined, `${path}.${key} is required`);
		for (const [key, childValue] of Object.entries(input)) {
			const child = schema.properties?.[key];
			check(child || schema.additionalProperties !== false, `${path}: unknown field ${key}`);
			if (child) validate(child, childValue, `${path}.${key}`);
		}
	}
	if (schema.type === 'array') {
		check(
			Array.isArray(value) && value.length <= (schema.maxItems ?? 20000),
			`${path}: invalid array`
		);
		for (const entry of value) validate(schema.items!, entry, path);
	}
	if (schema.type === 'string') string(value, schema.maxLength);
	if (schema.type === 'number' || schema.type === 'integer') {
		number(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
		if (schema.type === 'integer') check(Number.isInteger(value), `${path}: expected integer`);
	}
	if (schema.type === 'boolean') check(typeof value === 'boolean', `${path}: expected boolean`);
	if (schema.enum) check(schema.enum.includes(value), `${path}: unsupported value`);
}
