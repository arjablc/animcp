import {
	ANIMATION_LIMITS,
	defaultStyle,
	identityTransform,
	orderedLayers,
	type AnimationProject,
	type ShapeKeyframe,
	type VectorLayer
} from './model';
import { assertCompatibleKeyframes, evaluateLayer, interpolateKeyframes } from './interpolation';
import {
	AnimationValidationError,
	assertJsonSafe,
	parseProject,
	validateAsset,
	validateBoolean,
	validateCanvas,
	validateId,
	validateInteger,
	validateKeyframe,
	validateName,
	validateObject,
	validateStyle,
	validateTimeline
} from './validation';

export type CommandErrorCategory =
	'validation' | 'conflict' | 'busy' | 'not_found' | 'locked' | 'unsupported' | 'internal';
export type CommandResult<T = unknown> =
	| { ok: true; revision: number; changed: string[]; data?: T }
	| {
			ok: false;
			category: CommandErrorCategory;
			message: string;
			revision: number;
			currentRevision?: number;
	  };

export const ANIMATION_MUTATION_COMMANDS = [
	'rename_project',
	'update_canvas',
	'update_timeline',
	'add_layer',
	'remove_layer',
	'rename_layer',
	'set_layer_visibility',
	'set_layer_lock',
	'set_layer_style',
	'reorder_layer',
	'add_keyframe',
	'update_keyframe',
	'delete_keyframe',
	'update_path',
	'generate_inbetweens',
	'clear_generated_inbetweens',
	'add_asset'
] as const;
export type AnimationMutationCommand = (typeof ANIMATION_MUTATION_COMMANDS)[number];
export const ANIMATION_READ_COMMANDS = [
	'get_project',
	'get_scene',
	'get_timeline',
	'export_project'
] as const;
export type AnimationCommandName =
	AnimationMutationCommand | (typeof ANIMATION_READ_COMMANDS)[number];

export type AnimationCommandDependencies = {
	getProject: () => AnimationProject;
	/** Publish atomically and schedule persistence here. Must not throw after publishing. */
	setProject: (project: AnimationProject) => void;
	/** Optional adapter lock while an incompatible long-running operation is active. */
	isBusy?: () => boolean;
};

class CommandError extends Error {
	constructor(
		readonly category: CommandErrorCategory,
		message: string
	) {
		super(message);
	}
}

type HistoryEntry = { before: AnimationProject; after: AnimationProject; changed: string[] };
const metaKeys = ['expectedRevision', 'requestId'];

/**
 * Shared synchronous, renderer-independent command boundary.
 *
 * execute(name, input, expectedRevision?) accepts these durable inputs:
 * - rename_project {name}; update_canvas {width?,height?,background?}; update_timeline {fps?,frameCount?}
 * - add_layer {name,style?,paths?,frame?,transform?,easing?,opacity?}: optional initial key in one commit
 * - remove_layer {layerId}; rename_layer {layerId,name}; reorder_layer {layerId,zIndex} (target index)
 * - set_layer_visibility {layerId,visible}; set_layer_lock {layerId,locked}; set_layer_style {layerId,style}
 * - add_keyframe {layerId,frame,paths?,transform?,easing?,opacity?,style?,overwrite?}
 * - update_keyframe {layerId,frame,paths?,transform?,easing?,opacity?,style?} (requires an exact key)
 * - update_path {layerId,frame,paths}: creates a key at the frame when necessary
 * - delete_keyframe {layerId,frame}
 * - generate_inbetweens {layerId,startFrame,endFrame,overwrite?}
 * - clear_generated_inbetweens {layerId,startFrame?,endFrame?}
 * - add_asset {asset}: metadata only, after the asset adapter has validated/stored the Blob
 *
 * Read inputs: get_project {includePaths?}; get_scene {frame?}; get_timeline {}; export_project {}.
 * All inputs may include expectedRevision and requestId. Session commands (playback,
 * selection, set_current_frame) and Blob/export work belong to adapters, outside durable history.
 * Results are detached. Successful durable commands publish once and increment revision once.
 * Undo/redo increment the current revision instead of restoring historical revisions.
 */
export function createAnimationCommands(deps: AnimationCommandDependencies) {
	const undoStack: HistoryEntry[] = [];
	const redoStack: HistoryEntry[] = [];
	let head: { id: string; revision: number } | undefined;
	let committing = false;

	function revision() {
		return deps.getProject().revision;
	}
	function historyMatches(project: AnimationProject): boolean {
		return head !== undefined && head.id === project.id && head.revision === project.revision;
	}
	function resultError(error: unknown): CommandResult {
		const current = revision();
		const category =
			error instanceof CommandError
				? error.category
				: error instanceof AnimationValidationError
					? 'validation'
					: 'internal';
		return {
			ok: false,
			category,
			revision: current,
			message:
				error instanceof CommandError || error instanceof AnimationValidationError
					? error.message
					: 'The command could not be completed.',
			...(category === 'conflict' ? { currentRevision: current } : {})
		};
	}
	function checkRevision(expected: unknown, project: AnimationProject): void {
		if (expected === undefined) return;
		validateInteger(expected, 'expectedRevision');
		if (expected !== project.revision) throw new CommandError('conflict', 'Revision conflict.');
	}
	function checkBusy(): void {
		if (committing || deps.isBusy?.())
			throw new CommandError('busy', 'Wait for the current operation to finish.');
	}
	function publish(draft: AnimationProject, previous: AnimationProject): AnimationProject {
		// Validation and all computation finish before setProject is called.
		if (previous.revision === Number.MAX_SAFE_INTEGER)
			throw new AnimationValidationError('Revision limit reached.');
		draft.revision = previous.revision + 1;
		draft.updatedAt = new Date().toISOString();
		const next = parseProject(draft);
		const current = deps.getProject();
		if (current.id !== previous.id || current.revision !== previous.revision)
			throw new CommandError('conflict', 'Revision conflict.');
		// Retain a separate snapshot: renderer/UI code cannot mutate our history through state.
		const snapshot = parseProject(next);
		committing = true;
		try {
			deps.setProject(next);
		} finally {
			committing = false;
		}
		head = { id: snapshot.id, revision: snapshot.revision };
		return snapshot;
	}
	function trimHistory(): void {
		while (undoStack.length > ANIMATION_LIMITS.maxHistoryEntries) undoStack.shift();
		// Bound cumulative snapshot storage too, not just entry count.
		let bytes = 0;
		for (let i = undoStack.length - 1; i >= 0; i--) {
			bytes += JSON.stringify(undoStack[i]).length * 2;
			if (bytes > ANIMATION_LIMITS.maxProjectBytes && i < undoStack.length - 1) {
				undoStack.splice(0, i + 1);
				break;
			}
		}
	}
	function execute(name: string, input: unknown = {}, expectedRevision?: number): CommandResult {
		try {
			assertJsonSafe(input);
			if (input === null || typeof input !== 'object' || Array.isArray(input))
				throw new AnimationValidationError('Command input must be an object.');
			const args = input as Record<string, unknown>;
			const source = deps.getProject();
			if (Object.hasOwn(args, 'expectedRevision')) {
				validateInteger(args.expectedRevision, 'expectedRevision');
				if (expectedRevision !== undefined && args.expectedRevision !== expectedRevision)
					throw new AnimationValidationError('Revision arguments disagree.');
			}
			checkRevision(expectedRevision ?? args.expectedRevision, source);
			if (Object.hasOwn(args, 'requestId')) validateId(args.requestId, 'requestId');
			const fields = (allowed: string[]) => validateObject(args, [...allowed, ...metaKeys]);
			const project = parseProject(source);
			const success = (data: unknown): CommandResult => ({
				ok: true,
				revision: project.revision,
				changed: [],
				data
			});
			if (name === 'get_project') {
				fields(['includePaths']);
				const includePaths =
					args.includePaths === undefined
						? false
						: validateBoolean(args.includePaths, 'includePaths');
				return success(
					includePaths
						? project
						: {
								...project,
								layers: project.layers.map(({ keyframes, ...layer }) => ({
									...layer,
									keyframes: Object.keys(keyframes).map(Number)
								}))
							}
				);
			}
			if (name === 'get_scene') {
				fields(['frame']);
				if (args.frame === undefined)
					return success({ canvas: project.canvas, layers: orderedLayers(project.layers) });
				const frame = validateInteger(args.frame, 'frame', 0, project.timeline.frameCount - 1);
				return success({
					canvas: project.canvas,
					frame,
					layers: orderedLayers(project.layers).map((layer) => ({
						id: layer.id,
						name: layer.name,
						visible: layer.visible,
						locked: layer.locked,
						zIndex: layer.zIndex,
						style: layer.style,
						keyframe: evaluateLayer(layer, frame)
					}))
				});
			}
			if (name === 'get_timeline') {
				fields([]);
				return success({
					...project.timeline,
					layers: project.layers.map((layer) => ({
						layerId: layer.id,
						frames: Object.keys(layer.keyframes).map(Number)
					}))
				});
			}
			if (name === 'export_project') {
				fields([]);
				return success(project);
			}
			if (!(ANIMATION_MUTATION_COMMANDS as readonly string[]).includes(name))
				throw new CommandError('unsupported', 'Unsupported animation core command.');
			checkBusy();
			const before = parseProject(project);
			const changed = new Set<string>();
			const frameAt = (value: unknown) =>
				validateInteger(value, 'frame', 0, project.timeline.frameCount - 1);
			function layerAt(unlocked = true): VectorLayer {
				const id = validateId(args.layerId, 'layerId');
				const layer = project.layers.find((item) => item.id === id);
				if (!layer) throw new CommandError('not_found', 'Layer not found.');
				if (unlocked && layer.locked)
					throw new CommandError('locked', 'Unlock the layer before editing it.');
				changed.add(id);
				return layer;
			}
			function applyStyle(layer: VectorLayer): void {
				const patch = validateObject(
					args.style,
					['stroke', 'strokeWidth', 'strokeLineCap', 'strokeLineJoin', 'fill', 'opacity'],
					'style'
				);
				layer.style = validateStyle({ ...layer.style, ...patch });
			}
			function makeKeyframe(base?: ShapeKeyframe | null): ShapeKeyframe {
				if (args.paths === undefined && !base)
					throw new AnimationValidationError('Paths are required for the first keyframe.');
				const transform =
					args.transform === undefined
						? {}
						: validateObject(
								args.transform,
								['x', 'y', 'scaleX', 'scaleY', 'rotation'],
								'transform'
							);
				return validateKeyframe({
					paths: args.paths === undefined ? base?.paths : args.paths,
					transform: { ...(base?.transform ?? identityTransform()), ...transform },
					easing: args.easing === undefined ? (base?.easing ?? { type: 'linear' }) : args.easing,
					opacity: args.opacity === undefined ? (base?.opacity ?? 1) : args.opacity,
					generated: false
				});
			}
			switch (name as AnimationMutationCommand) {
				case 'rename_project':
					fields(['name']);
					project.name = validateName(args.name);
					changed.add(project.id);
					break;
				case 'update_canvas': {
					fields(['width', 'height', 'background']);
					project.canvas = validateCanvas({
						width: args.width === undefined ? project.canvas.width : args.width,
						height: args.height === undefined ? project.canvas.height : args.height,
						background: args.background === undefined ? project.canvas.background : args.background
					});
					changed.add(project.id);
					break;
				}
				case 'update_timeline':
					fields(['fps', 'frameCount']);
					project.timeline = validateTimeline({
						fps: args.fps === undefined ? project.timeline.fps : args.fps,
						frameCount:
							args.frameCount === undefined ? project.timeline.frameCount : args.frameCount
					});
					// Final document validation rejects truncation that would lose existing keyframes.
					changed.add(project.id);
					break;
				case 'add_layer': {
					fields(['name', 'style', 'paths', 'frame', 'transform', 'easing', 'opacity']);
					const id = `layer_${globalThis.crypto.randomUUID()}`;
					const layer: VectorLayer = {
						id,
						name: validateName(args.name),
						visible: true,
						locked: false,
						zIndex: project.layers.reduce((max, item) => Math.max(max, item.zIndex + 1), 0),
						style: defaultStyle(),
						keyframes: {}
					};
					if (args.style !== undefined) applyStyle(layer);
					if (args.paths !== undefined)
						layer.keyframes[frameAt(args.frame === undefined ? 0 : args.frame)] = makeKeyframe();
					else if (
						['frame', 'transform', 'easing', 'opacity'].some((key) => Object.hasOwn(args, key))
					)
						throw new AnimationValidationError('Initial keyframe properties require paths.');
					project.layers.push(layer);
					changed.add(id);
					break;
				}
				case 'remove_layer': {
					fields(['layerId']);
					const layer = layerAt();
					project.layers = project.layers.filter((item) => item.id !== layer.id);
					break;
				}
				case 'rename_layer':
					fields(['layerId', 'name']);
					layerAt().name = validateName(args.name);
					break;
				case 'set_layer_visibility':
					fields(['layerId', 'visible']);
					layerAt(false).visible = validateBoolean(args.visible, 'visible');
					break;
				case 'set_layer_lock':
					fields(['layerId', 'locked']);
					layerAt(false).locked = validateBoolean(args.locked, 'locked');
					break;
				case 'set_layer_style': {
					fields(['layerId', 'style']);
					applyStyle(layerAt());
					break;
				}
				case 'reorder_layer': {
					fields(['layerId', 'zIndex']);
					const layer = layerAt();
					const zIndex = validateInteger(args.zIndex, 'zIndex', 0, project.layers.length - 1);
					const layers = orderedLayers(project.layers).filter((item) => item.id !== layer.id);
					layers.splice(zIndex, 0, layer);
					layers.forEach((item, index) => {
						if (item.zIndex !== index) changed.add(item.id);
						item.zIndex = index;
					});
					project.layers = layers;
					break;
				}
				case 'add_keyframe':
				case 'update_keyframe':
				case 'update_path': {
					fields(
						name === 'update_path'
							? ['layerId', 'frame', 'paths']
							: [
									'layerId',
									'frame',
									'paths',
									'transform',
									'easing',
									'opacity',
									'style',
									...(name === 'add_keyframe' ? ['overwrite'] : [])
								]
					);
					const layer = layerAt();
					const frame = frameAt(args.frame);
					const existing = layer.keyframes[frame];
					const overwrite =
						args.overwrite === undefined ? false : validateBoolean(args.overwrite, 'overwrite');
					if (name === 'add_keyframe' && existing && !existing.generated && !overwrite)
						throw new CommandError(
							'validation',
							'Keyframe already exists. Set overwrite to replace it.'
						);
					if (name === 'update_keyframe' && !existing)
						throw new CommandError('not_found', 'Keyframe not found.');
					if (name === 'update_path' && args.paths === undefined)
						throw new AnimationValidationError('Paths are required.');
					const base = existing ?? evaluateLayer({ ...layer, visible: true }, frame);
					layer.keyframes[frame] = makeKeyframe(base);
					if (args.style !== undefined) applyStyle(layer);
					break;
				}
				case 'delete_keyframe': {
					fields(['layerId', 'frame']);
					const layer = layerAt();
					const frame = frameAt(args.frame);
					if (!Object.hasOwn(layer.keyframes, frame))
						throw new CommandError('not_found', 'Keyframe not found.');
					delete layer.keyframes[frame];
					break;
				}
				case 'generate_inbetweens': {
					fields(['layerId', 'startFrame', 'endFrame', 'overwrite']);
					const layer = layerAt();
					const startFrame = frameAt(args.startFrame);
					const endFrame = frameAt(args.endFrame);
					if (endFrame <= startFrame)
						throw new AnimationValidationError('endFrame must be greater than startFrame.');
					const start = layer.keyframes[startFrame];
					const end = layer.keyframes[endFrame];
					if (!start || !end)
						throw new CommandError('not_found', 'Start and end keyframes are required.');
					const overwrite =
						args.overwrite === undefined ? false : validateBoolean(args.overwrite, 'overwrite');
					assertCompatibleKeyframes(start, end);
					// Preserve authored middle keys and interpolate each interval through them.
					const anchors = [
						startFrame,
						...(!overwrite
							? Object.keys(layer.keyframes)
									.map(Number)
									.filter(
										(frame) =>
											frame > startFrame && frame < endFrame && !layer.keyframes[frame].generated
									)
							: []),
						endFrame
					].sort((a, b) => a - b);
					let projectedCommands = project.layers.reduce(
						(sum, item) =>
							sum +
							Object.values(item.keyframes).reduce(
								(count, keyframe) =>
									count + keyframe.paths.reduce((total, path) => total + path.length, 0),
								0
							),
						0
					);
					// Reject oversized output before constructing thousands of large keyframe copies.
					for (let index = 1; index < anchors.length; index++) {
						const a = anchors[index - 1];
						const b = anchors[index];
						assertCompatibleKeyframes(layer.keyframes[a], layer.keyframes[b]);
						const size = layer.keyframes[a].paths.reduce((total, path) => total + path.length, 0);
						projectedCommands += size * (b - a - 1);
						for (let frame = a + 1; frame < b; frame++)
							projectedCommands -=
								layer.keyframes[frame]?.paths.reduce((total, path) => total + path.length, 0) ?? 0;
						if (projectedCommands > ANIMATION_LIMITS.maxTotalPathCommands)
							throw new AnimationValidationError(
								'Generated keyframes would exceed the project path complexity limit.'
							);
					}
					for (let index = 1; index < anchors.length; index++) {
						const a = anchors[index - 1];
						const b = anchors[index];
						const left = layer.keyframes[a];
						const right = layer.keyframes[b];
						assertCompatibleKeyframes(left, right);
						for (let frame = a + 1; frame < b; frame++)
							layer.keyframes[frame] = {
								...interpolateKeyframes(left, right, (frame - a) / (b - a)),
								generated: true
							};
					}
					break;
				}
				case 'clear_generated_inbetweens': {
					fields(['layerId', 'startFrame', 'endFrame']);
					const layer = layerAt();
					const startFrame = args.startFrame === undefined ? 0 : frameAt(args.startFrame);
					const endFrame =
						args.endFrame === undefined ? project.timeline.frameCount - 1 : frameAt(args.endFrame);
					if (endFrame < startFrame)
						throw new AnimationValidationError('endFrame must not precede startFrame.');
					for (const frame of Object.keys(layer.keyframes).map(Number))
						if (frame >= startFrame && frame <= endFrame && layer.keyframes[frame].generated)
							delete layer.keyframes[frame];
					break;
				}
				case 'add_asset': {
					fields(['asset']);
					const asset = validateAsset(args.asset);
					project.assets.push(asset);
					changed.add(asset.id);
					break;
				}
			}
			const matches = historyMatches(before);
			const next = publish(project, before);
			if (!matches) undoStack.length = 0;
			redoStack.length = 0;
			const ids = [...changed];
			undoStack.push({ before, after: next, changed: [...ids] });
			trimHistory();
			return { ok: true, revision: next.revision, changed: ids };
		} catch (error) {
			return resultError(error);
		}
	}

	function restore(direction: 'undo' | 'redo', expectedRevision?: number): CommandResult {
		try {
			const current = deps.getProject();
			checkRevision(expectedRevision, current);
			checkBusy();
			const from = direction === 'undo' ? undoStack : redoStack;
			const to = direction === 'undo' ? redoStack : undoStack;
			if (!from.length) throw new CommandError('validation', `Nothing to ${direction}.`);
			if (!historyMatches(current)) throw new CommandError('conflict', 'Revision conflict.');
			const entry = from[from.length - 1];
			const next = publish(
				parseProject(direction === 'undo' ? entry.before : entry.after),
				current
			);
			from.pop();
			to.push(entry);
			return { ok: true, revision: next.revision, changed: [...entry.changed] };
		} catch (error) {
			return resultError(error);
		}
	}
	return {
		execute,
		undo: (expectedRevision?: number) => restore('undo', expectedRevision),
		redo: (expectedRevision?: number) => restore('redo', expectedRevision),
		get canUndo() {
			return undoStack.length > 0 && historyMatches(deps.getProject());
		},
		get canRedo() {
			return redoStack.length > 0 && historyMatches(deps.getProject());
		}
	};
}

export type AnimationCommands = ReturnType<typeof createAnimationCommands>;
