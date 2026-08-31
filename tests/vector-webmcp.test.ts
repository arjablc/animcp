import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	registerVectorTools,
	type VectorModelContext,
	type VectorSession,
	type VectorTool,
	type VectorToolDependencies
} from '../src/lib/features/webmcp/vector-tools';
import {
	ANIMATION_LIMITS,
	createAnimationProject,
	defaultStyle,
	identityTransform,
	type AnimationProject,
	type PathData
} from '../src/lib/features/animation/model';
import { createAnimationCommands } from '../src/lib/features/animation/commands';

// Contract mocks exercise our adapter, not actual browser/agent WebMCP compatibility.
const line: PathData = [
	{ type: 'M', x: 0, y: 0 },
	{ type: 'L', x: 100, y: 100 }
];
const core = [
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
	'clear_generated_inbetweens'
];

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function fixture() {
	let project: AnimationProject = createAnimationProject({
		id: 'project_1',
		name: 'Test animation'
	});
	project.layers.push({
		id: 'layer_1',
		name: 'Stroke',
		visible: true,
		locked: false,
		zIndex: 0,
		style: defaultStyle(),
		keyframes: {
			0: {
				paths: structuredClone([line]),
				transform: identityTransform(),
				easing: { type: 'linear' }
			}
		}
	});
	const session: VectorSession = { currentFrame: 0, selectedLayerId: 'layer_1', playing: false };
	const execute = vi.fn(
		(name: string, input: Record<string, unknown>, expectedRevision?: number): unknown => {
			if (expectedRevision !== project.revision) throw new Error('Revision conflict.');
			project = { ...project, revision: project.revision + 1 };
			if (name === 'rename_project') project.name = input.name as string;
			return { ok: true, revision: project.revision, changed: ['layer_1'] };
		}
	);
	const deps: VectorToolDependencies = {
		getProject: () => project,
		getSession: () => session,
		execute,
		seek: vi.fn((frame: number) => {
			session.currentFrame = frame;
		}),
		select: vi.fn((id: string | null) => {
			session.selectedLayerId = id;
		}),
		play: vi.fn((action) => {
			session.playing = action !== 'pause';
			if (action === 'restart') session.currentFrame = 0;
		}),
		undo: vi.fn(() => {
			project = { ...project, revision: project.revision + 1 };
			return { changed: ['layer_1'] };
		}),
		redo: vi.fn(() => {
			project = { ...project, revision: project.revision + 1 };
			return { changed: ['layer_1'] };
		})
	};
	const tools = new Map<string, VectorTool>();
	const registerTool = vi.fn<VectorModelContext['registerTool']>(async (tool) => {
		tools.set(tool.name, tool);
	});
	const context: VectorModelContext = { registerTool };
	async function call(name: string, input: unknown = {}, options?: { signal?: AbortSignal }) {
		return (await tools.get(name)!.execute(input, options)) as Record<string, unknown>;
	}
	return {
		deps,
		tools,
		context,
		registerTool,
		execute,
		session,
		call,
		project: () => project,
		setProject: (next: AnimationProject) => {
			project = next;
		}
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('vector WebMCP registration contract', () => {
	it('does not fabricate a document or modelContext when WebMCP is unavailable', async () => {
		vi.stubGlobal('document', undefined);
		const { deps } = fixture();
		const result = await registerVectorTools(deps);
		expect(result.supported).toBe(false);
		expect(result.message).toContain('unavailable');
		expect(globalThis.document).toBeUndefined();
		expect(() => result.dispose()).not.toThrow();
		vi.stubGlobal('document', {});
		expect((await registerVectorTools(deps)).supported).toBe(false);
		expect(document).not.toHaveProperty('modelContext');
	});

	it('feature-detects document.modelContext and registers the stable snake_case core', async () => {
		const f = fixture();
		vi.stubGlobal('document', { modelContext: f.context });
		const result = await registerVectorTools(f.deps);
		expect(result).toMatchObject({ supported: true, message: '27 vector tools ready.' });
		expect([...f.tools.keys()]).toEqual([
			'get_project',
			'get_scene',
			'get_selection',
			'get_timeline',
			...core,
			'set_current_frame',
			'select_layer',
			'play',
			'pause',
			'restart',
			'undo',
			'redo'
		]);
		for (const [tool, options] of f.registerTool.mock.calls) {
			expect(tool.name).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
			expect(tool.title.length).toBeGreaterThan(3);
			expect(tool.description.length).toBeGreaterThan(10);
			expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
			expect(tool.annotations?.readOnlyHint).toBe(tool.name.startsWith('get_'));
			expect(options?.signal).toBeInstanceOf(AbortSignal);
			expect(tool).not.toHaveProperty('signal');
		}
		const read = await f.call('get_project');
		expect(read).toMatchObject({ ok: true, revision: 0 });
		expect(read).not.toHaveProperty('content');
		expect(read).not.toHaveProperty('structuredContent');
		result.dispose();
	});

	it('supports injection without reading or replacing global browser properties', async () => {
		const f = fixture();
		const getter = vi.fn(() => {
			throw new Error('Must not touch native getter');
		});
		vi.stubGlobal('document', Object.defineProperty({}, 'modelContext', { get: getter }));
		expect((await registerVectorTools(f.deps, undefined, f.context)).supported).toBe(true);
		expect(getter).not.toHaveBeenCalled();
		expect((await registerVectorTools(f.deps, undefined, null)).supported).toBe(false);
		expect(getter).not.toHaveBeenCalled();
		expect((await registerVectorTools(f.deps)).supported).toBe(false);
	});

	it('awaits asynchronous registration before advertising readiness', async () => {
		const f = fixture();
		const gate = deferred<void>();
		f.registerTool.mockImplementationOnce(async (tool) => {
			f.tools.set(tool.name, tool);
			await gate.promise;
		});
		let ready = false;
		const registration = registerVectorTools(f.deps, undefined, f.context).then((value) => {
			ready = true;
			return value;
		});
		await Promise.resolve();
		expect(ready).toBe(false);
		expect(f.registerTool).toHaveBeenCalledTimes(1);
		gate.resolve();
		expect((await registration).message).toContain('ready');
	});

	it.each(['dispose', 'abort'] as const)(
		'%s invalidates captured callbacks without unregisterTool',
		async (action) => {
			const f = fixture();
			const controller = new AbortController();
			const result = await registerVectorTools(f.deps, controller.signal, f.context);
			const captured = f.tools.get('rename_project')!;
			const input = { name: 'First', expectedRevision: 0, requestId: 'request_1' };
			expect(await captured.execute(input)).toMatchObject({ ok: true });
			if (action === 'dispose') result.dispose();
			else controller.abort();
			result.dispose();
			expect(f.registerTool.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
			expect(await captured.execute(input)).toMatchObject({ ok: false, category: 'aborted' });
			expect(await f.call('get_project')).toMatchObject({ ok: false, category: 'aborted' });
			expect(f.execute).toHaveBeenCalledTimes(1);
		}
	);

	it('does not register anything with an already-aborted signal', async () => {
		const f = fixture();
		const controller = new AbortController();
		controller.abort();
		expect((await registerVectorTools(f.deps, controller.signal, f.context)).message).toContain(
			'aborted'
		);
		expect(f.registerTool).not.toHaveBeenCalled();
	});

	it('cleans only its successful prefix after partial registration rejection', async () => {
		const f = fixture();
		const unregisterTool = vi.fn();
		let captured: VectorTool | undefined;
		f.registerTool.mockImplementation(async (tool) => {
			if (tool.name === 'get_selection') {
				captured = tool;
				throw new Error('Duplicate name owned by another app');
			}
			f.tools.set(tool.name, tool);
		});
		const result = await registerVectorTools(f.deps, undefined, { ...f.context, unregisterTool });
		expect(result.message).toContain('partial registrations invalidated');
		expect(unregisterTool.mock.calls).toEqual([['get_project'], ['get_scene']]);
		expect(await captured!.execute({})).toMatchObject({ ok: false, category: 'aborted' });
		expect(await f.call('get_scene')).toMatchObject({ ok: false, category: 'aborted' });
		result.dispose();
		expect(unregisterTool).toHaveBeenCalledTimes(2);
	});

	it('invalidates partially registered tools even without legacy cleanup', async () => {
		const f = fixture();
		f.registerTool.mockImplementation(async (tool) => {
			f.tools.set(tool.name, tool);
			if (tool.name === 'rename_project') throw new Error('Registration failed');
		});
		await registerVectorTools(f.deps, undefined, f.context);
		expect(await f.call('rename_project', { name: 'Late', expectedRevision: 0 })).toMatchObject({
			category: 'aborted'
		});
		expect(f.execute).not.toHaveBeenCalled();
	});

	it('cleans a late registration resolution after abort and stops registering tools', async () => {
		const f = fixture();
		const gate = deferred<void>();
		const unregisterTool = vi.fn();
		const controller = new AbortController();
		f.registerTool.mockImplementationOnce(async (tool) => {
			f.tools.set(tool.name, tool);
			await gate.promise;
		});
		const registration = registerVectorTools(f.deps, controller.signal, {
			...f.context,
			unregisterTool
		});
		controller.abort();
		expect(await f.call('get_project')).toMatchObject({ category: 'aborted' });
		gate.resolve();
		expect((await registration).message).toContain('aborted');
		expect(f.registerTool).toHaveBeenCalledTimes(1);
		expect(unregisterTool).toHaveBeenCalledWith('get_project');
	});

	it('contains both synchronous and asynchronous legacy cleanup failures', async () => {
		const f = fixture();
		const unregisterTool = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('Unavailable');
			})
			.mockRejectedValue('Unavailable');
		const result = await registerVectorTools(f.deps, undefined, { ...f.context, unregisterTool });
		expect(() => result.dispose()).not.toThrow();
		await Promise.resolve();
		expect(await f.call('undo', { expectedRevision: 0 })).toMatchObject({ category: 'aborted' });
	});

	it('honors an already canceled native execution callback signal', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		const controller = new AbortController();
		controller.abort();
		expect(
			await f.call(
				'rename_project',
				{ name: 'No', expectedRevision: 0 },
				{ signal: controller.signal }
			)
		).toMatchObject({ category: 'aborted' });
		expect(f.execute).not.toHaveBeenCalled();
	});
});

describe('vector WebMCP reads and safe results', () => {
	it('returns compact detached summaries by default and full paths only on explicit reads', async () => {
		const f = fixture();
		f.project().assets.push({
			id: 'asset_1',
			name: 'Image',
			kind: 'raster',
			mimeType: 'image/png',
			width: 1,
			height: 1,
			byteLength: 67,
			source: 'file',
			blobKey: 'private_blob_key',
			createdAt: f.project().createdAt
		});
		await registerVectorTools(f.deps, undefined, f.context);
		const result = await f.call('get_project');
		expect(result).toMatchObject({
			id: 'project_1',
			currentFrame: 0,
			selectedLayerId: 'layer_1',
			playing: false,
			layers: [{ keyframes: [{ frame: 0, generated: false }] }],
			capabilities: { importAsset: false, vectorizeAsset: false }
		});
		expect(JSON.stringify(result)).not.toContain('paths');
		expect(JSON.stringify(result)).not.toContain('blobKey');
		const full = await f.call('get_project', { includePaths: true });
		expect(full).toMatchObject({ layers: [{ keyframes: { 0: { paths: [line] } } }] });
		const detached = full.layers as AnimationProject['layers'];
		detached[0].style.stroke = 'red';
		detached[0].keyframes[0].paths[0][0] = { type: 'M', x: 900, y: 900 };
		expect(f.project().layers[0].style.stroke).toBe('#00c3ff');
		expect(f.project().layers[0].keyframes[0].paths).toEqual([line]);
		expect(f.execute).not.toHaveBeenCalled();
	});

	it('reads scene evaluation, selection and timeline from current shared state', async () => {
		const f = fixture();
		f.project().layers[0].keyframes[10] = {
			paths: structuredClone([line]),
			transform: { ...identityTransform(), x: 100 },
			easing: { type: 'linear' }
		};
		f.session.currentFrame = 5;
		await registerVectorTools(f.deps, undefined, f.context);
		expect(await f.call('get_scene')).toMatchObject({
			currentFrame: 5,
			layers: [{ evaluated: { transform: { x: 50 } } }]
		});
		expect(await f.call('get_selection')).toMatchObject({
			selectedLayerId: 'layer_1',
			layer: { id: 'layer_1' }
		});
		expect(await f.call('get_timeline')).toMatchObject({
			fps: 30,
			frameCount: 150,
			currentFrame: 5,
			tracks: [{ layerId: 'layer_1', keyframes: [{ frame: 0 }, { frame: 10 }] }]
		});
		f.session.selectedLayerId = null;
		expect(await f.call('get_selection')).toMatchObject({ selectedLayerId: null, layer: null });
	});

	it('never returns command project contents, runtime objects, image bytes, or raw errors', async () => {
		const f = fixture();
		f.execute.mockReturnValue({
			ok: true,
			changed: ['layer_1'],
			data: { project: f.project() },
			project: f.project(),
			base64: 'SECRET_PAYLOAD',
			prompt: 'SECRET_PROMPT',
			blob: new Blob(['SECRET_BYTES'])
		});
		await registerVectorTools(f.deps, undefined, f.context);
		const result = await f.call('rename_project', { name: 'Safe', expectedRevision: 0 });
		expect(result).toEqual({ ok: true, revision: 0, changed: ['layer_1'] });
		f.execute.mockImplementation(() => {
			throw new Error('SECRET_PAYLOAD');
		});
		const error = await f.call('rename_project', { name: 'Safe', expectedRevision: 0 });
		expect(error.ok).toBe(false);
		expect(JSON.stringify(error)).not.toContain('SECRET');
	});
});

describe('vector WebMCP schema and runtime validation', () => {
	it('bounds every input string/array/number and closes every object schema', async () => {
		const f = fixture();
		await registerVectorTools(
			{ ...f.deps, importAsset: vi.fn(), vectorizeAsset: vi.fn(), exportFile: vi.fn() },
			undefined,
			f.context
		);
		function check(schema: Record<string, unknown>) {
			if (schema.type === 'object') {
				expect(schema.additionalProperties).toBe(false);
				Object.values(schema.properties as Record<string, Record<string, unknown>>).forEach(check);
			}
			if (schema.type === 'array') {
				expect(schema.maxItems).toBeGreaterThan(0);
				check(schema.items as Record<string, unknown>);
			}
			if (schema.type === 'string') expect(schema.maxLength).toBeGreaterThan(0);
			if (schema.type === 'number' || schema.type === 'integer') {
				expect(Number.isFinite(schema.minimum)).toBe(true);
				expect(Number.isFinite(schema.maximum)).toBe(true);
			}
			if (schema.oneOf) (schema.oneOf as Record<string, unknown>[]).forEach(check);
		}
		for (const tool of f.tools.values()) check(tool.inputSchema);
		for (const tool of [...core, 'undo', 'redo', 'import_asset', 'vectorize_asset'])
			expect(f.tools.get(tool)!.inputSchema.required).toContain('expectedRevision');
	});

	it.each([
		null,
		undefined,
		[],
		1,
		'input',
		{ name: 'A' },
		{ name: 'A', expectedRevision: -1 },
		{ name: 'A', expectedRevision: 0.5 },
		{ name: 'A', expectedRevision: NaN },
		{ name: 'A', expectedRevision: Infinity },
		{ name: 'A', expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
		{ name: '', expectedRevision: 0 },
		{ name: '   ', expectedRevision: 0 },
		{ name: 'a'.repeat(ANIMATION_LIMITS.maxNameLength + 1), expectedRevision: 0 },
		{ name: 'A', expectedRevision: 0, requestId: '' },
		{ name: 'A', expectedRevision: 0, requestId: 'a'.repeat(129) },
		{ name: 'A', expectedRevision: 0, unknown: true },
		JSON.parse('{"name":"A","expectedRevision":0,"__proto__":{}}')
	])('rejects malformed mutation input %# before executing', async (input) => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		expect(await f.call('rename_project', input)).toMatchObject({
			ok: false,
			category: 'validation'
		});
		expect(f.execute).not.toHaveBeenCalled();
	});

	it.each([
		['update_canvas', { width: 239 }],
		['update_canvas', { height: 1081 }],
		['update_canvas', {}],
		['update_canvas', { background: 'url(javascript:alert(1))' }],
		['update_canvas', { background: '#12345' }],
		['update_canvas', { background: 'rgba(999, 0, 0, 1)' }],
		['update_timeline', { fps: 60 }],
		['update_timeline', { frameCount: 29 }],
		['update_timeline', { fps: 12, frameCount: 721 }],
		['update_timeline', {}],
		['set_layer_style', { layerId: 'layer_1', style: {} }],
		['set_layer_style', { layerId: 'layer_1', style: { opacity: 1.1 } }],
		['set_layer_style', { layerId: 'layer_1', style: { fill: 'url(https://example.com/image)' } }],
		['set_layer_style', { layerId: 'layer_1', style: { strokeWidth: -1 } }],
		['set_layer_style', { layerId: 'layer_1', style: { strokeLineCap: 'triangle' } }],
		['set_layer_style', { layerId: 'layer_1', style: { arbitrary: true } }],
		['set_layer_visibility', { layerId: 'layer_1', visible: 'true' }],
		['remove_layer', { layerId: 'missing' }],
		['remove_layer', { layerId: 'constructor' }],
		['reorder_layer', { layerId: 'layer_1', zIndex: 1 }],
		['update_keyframe', { layerId: 'layer_1', frame: 0 }],
		['add_keyframe', { layerId: 'layer_1', frame: 150, paths: [line] }],
		['add_keyframe', { layerId: 'layer_1', frame: -1, paths: [line] }],
		['add_keyframe', { layerId: 'layer_1', frame: 0.1, paths: [line] }],
		['add_keyframe', { layerId: 'layer_1', frame: 0, paths: [line], transform: { scaleX: 0 } }],
		[
			'add_keyframe',
			{ layerId: 'layer_1', frame: 0, paths: [line], transform: { rotation: Infinity } }
		],
		[
			'add_keyframe',
			{
				layerId: 'layer_1',
				frame: 0,
				paths: [line],
				easing: { type: 'bezier', x1: -1, x2: 1, y1: 0, y2: 1 }
			}
		],
		['generate_inbetweens', { layerId: 'layer_1', startFrame: 10, endFrame: 10 }],
		['generate_inbetweens', { layerId: 'layer_1', startFrame: 10, endFrame: 9 }],
		['clear_generated_inbetweens', { layerId: 'layer_1', startFrame: 10, endFrame: 9 }]
	])('rejects invalid %s input %#', async (tool, input) => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		expect(
			await f.call(tool as string, { ...(input as object), expectedRevision: 0 })
		).toMatchObject({ ok: false, category: 'validation' });
		expect(f.execute).not.toHaveBeenCalled();
	});

	it.each(
		[
			[],
			[[]],
			[line, line],
			[[{ type: 'L', x: 0, y: 0 }]],
			[[{ type: 'Z' }]],
			[[{ type: 'M', x: 0, y: 0 }, { type: 'Z' }, { type: 'L', x: 10, y: 10 }]],
			[[{ type: 'M', x: 0, y: 0 }, { type: 'Z' }, { type: 'Z' }]],
			[[{ type: 'M', x: NaN, y: 0 }]],
			[[{ type: 'M', x: ANIMATION_LIMITS.maxCoordinate + 1, y: 0 }]],
			[[{ type: 'm', x: 0, y: 0 }]],
			[
				[
					{ type: 'M', x: 0, y: 0 },
					{ type: 'C', x: 10, y: 10 }
				]
			],
			[[{ type: 'M', x: 0, y: 0, script: 'alert(1)' }]],
			[
				Array.from({ length: ANIMATION_LIMITS.maxPathCommands + 1 }, () => ({
					type: 'M',
					x: 0,
					y: 0
				}))
			]
		].map((paths) => ({ paths }))
	)('rejects malformed, unsafe, or oversized paths %#', async ({ paths }) => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		expect(
			await f.call('update_path', { layerId: 'layer_1', frame: 0, paths, expectedRevision: 0 })
		).toMatchObject({ category: 'validation' });
		expect(f.execute).not.toHaveBeenCalled();
	});

	it('accepts complete canonical cubic subpaths at the path command limit', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		const path: PathData = [
			{ type: 'M', x: 0, y: 0 },
			{ type: 'C', x1: 10, y1: 20, x2: 30, y2: 40, x: 50, y: 60 },
			{ type: 'Z' },
			{ type: 'M', x: 100, y: 100 }
		];
		while (path.length < ANIMATION_LIMITS.maxPathCommands)
			path.push({ type: 'L', x: path.length, y: 0 });
		const input = { layerId: 'layer_1', frame: 0, paths: [path] };
		expect(await f.call('update_path', { ...input, expectedRevision: 0 })).toMatchObject({
			ok: true,
			revision: 1
		});
		expect(f.execute).toHaveBeenCalledWith('update_path', input, 0);
	});

	it('rejects accessors, custom prototypes and array toJSON without executing them', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		const getter = vi.fn(() => 'A');
		const accessor = Object.defineProperty({ expectedRevision: 0 }, 'name', {
			enumerable: true,
			get: getter
		});
		expect(await f.call('rename_project', accessor)).toMatchObject({ category: 'validation' });
		const proto = Object.assign(Object.create({ toJSON: getter }), {
			name: 'A',
			expectedRevision: 0
		});
		expect(await f.call('rename_project', proto)).toMatchObject({ category: 'validation' });
		const badArray = Object.assign(structuredClone(line), { toJSON: getter });
		expect(
			await f.call('update_path', {
				layerId: 'layer_1',
				frame: 0,
				paths: [badArray],
				expectedRevision: 0
			})
		).toMatchObject({ category: 'validation' });
		const getterArray = structuredClone(line);
		Object.defineProperty(getterArray, '0', { enumerable: true, get: getter });
		expect(
			await f.call('update_path', {
				layerId: 'layer_1',
				frame: 0,
				paths: [getterArray],
				expectedRevision: 0
			})
		).toMatchObject({ category: 'validation' });
		expect(getter).not.toHaveBeenCalled();
		expect(f.execute).not.toHaveBeenCalled();
	});

	it('does not allow malformed read/session inputs through the native callback', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		for (const [tool, input] of [
			['get_project', { includePaths: 'true' }],
			['get_scene', { script: 'no' }],
			['set_current_frame', { frame: 150 }],
			['select_layer', { layerId: 'missing' }],
			['play', { action: 'execute' }]
		] as const)
			expect(await f.call(tool, input)).toMatchObject({ category: 'validation' });
		expect(f.deps.seek).not.toHaveBeenCalled();
		expect(f.deps.select).not.toHaveBeenCalled();
		expect(f.deps.play).not.toHaveBeenCalled();
	});
});

describe('vector command dispatch, revision protection and replay', () => {
	it('forwards all semantic core operations to the shared snake_case command interface', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		const cases: Record<string, Record<string, unknown>> = {
			rename_project: { name: 'Renamed' },
			update_canvas: { width: 1000 },
			update_timeline: { fps: 24, frameCount: 120 },
			add_layer: {
				name: 'New',
				style: { stroke: '#00c3ff', strokeWidth: 4, fill: null },
				paths: [line],
				frame: 0
			},
			remove_layer: { layerId: 'layer_1' },
			rename_layer: { layerId: 'layer_1', name: 'Renamed' },
			set_layer_visibility: { layerId: 'layer_1', visible: false },
			set_layer_lock: { layerId: 'layer_1', locked: true },
			set_layer_style: { layerId: 'layer_1', style: { opacity: 0.5 } },
			reorder_layer: { layerId: 'layer_1', zIndex: 0 },
			add_keyframe: {
				layerId: 'layer_1',
				frame: 10,
				paths: [line],
				transform: { x: 20 },
				opacity: 0.5,
				overwrite: true
			},
			update_keyframe: {
				layerId: 'layer_1',
				frame: 0,
				transform: { rotation: 20 },
				easing: { type: 'hold' }
			},
			delete_keyframe: { layerId: 'layer_1', frame: 0 },
			update_path: { layerId: 'layer_1', frame: 0, paths: [line] },
			generate_inbetweens: { layerId: 'layer_1', startFrame: 0, endFrame: 30, overwrite: false },
			clear_generated_inbetweens: { layerId: 'layer_1', startFrame: 0, endFrame: 30 }
		};
		for (const tool of core) {
			const expectedRevision = f.project().revision;
			expect(
				await f.call(tool, { ...cases[tool], expectedRevision, requestId: tool })
			).toMatchObject({ ok: true, revision: expectedRevision + 1 });
			expect(f.execute).toHaveBeenLastCalledWith(tool, cases[tool], expectedRevision);
		}
	});

	it('prevents stale edits and includes the recoverable current revision', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		await f.call('rename_project', { name: 'New', expectedRevision: 0 });
		expect(await f.call('remove_layer', { layerId: 'layer_1', expectedRevision: 0 })).toMatchObject(
			{
				ok: false,
				category: 'conflict',
				revision: 1,
				currentRevision: 1
			}
		);
		expect(f.execute).toHaveBeenCalledTimes(1);
	});

	it('preserves structured domain failures and catches thrown conflicts without echoing payloads', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		f.execute.mockReturnValue({ ok: false, category: 'busy', message: 'SECRET', revision: 0 });
		expect(await f.call('rename_project', { name: 'New', expectedRevision: 0 })).toMatchObject({
			ok: false,
			category: 'busy'
		});
		f.execute.mockImplementation(() => {
			throw new Error('Revision conflict: SECRET');
		});
		const conflict = await f.call('rename_project', { name: 'New', expectedRevision: 0 });
		expect(conflict).toMatchObject({ ok: false, category: 'conflict', currentRevision: 0 });
		expect(JSON.stringify(conflict)).not.toContain('SECRET');
	});

	it('protects undo/redo revisions and passes expectedRevision to history commands', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		expect(await f.call('undo', {})).toMatchObject({ category: 'validation' });
		expect(await f.call('undo', { expectedRevision: 1 })).toMatchObject({ category: 'conflict' });
		expect(f.deps.undo).not.toHaveBeenCalled();
		expect(await f.call('undo', { expectedRevision: 0 })).toMatchObject({ ok: true, revision: 1 });
		expect(f.deps.undo).toHaveBeenCalledWith(0);
		expect(await f.call('redo', { expectedRevision: 0 })).toMatchObject({ category: 'conflict' });
		expect(f.deps.redo).not.toHaveBeenCalled();
		expect(await f.call('redo', { expectedRevision: 1 })).toMatchObject({ ok: true, revision: 2 });
		expect(f.deps.redo).toHaveBeenCalledWith(1);
	});

	it('keeps seek, selection and playback outside durable command history', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		expect(await f.call('set_current_frame', { frame: 20 })).toMatchObject({
			ok: true,
			currentFrame: 20,
			revision: 0
		});
		expect(await f.call('select_layer', { layerId: null })).toMatchObject({
			selectedLayerId: null,
			revision: 0
		});
		expect(await f.call('play')).toMatchObject({ playing: true, revision: 0 });
		expect(await f.call('pause')).toMatchObject({ playing: false, revision: 0 });
		expect(await f.call('restart')).toMatchObject({ currentFrame: 0, playing: true, revision: 0 });
		expect(await f.call('play', { expectedRevision: 100 })).toMatchObject({ category: 'conflict' });
		expect(f.execute).not.toHaveBeenCalled();
	});

	it('deduplicates canonical input across retries and later human edits, returning detached results', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		const first = await f.call('rename_project', {
			name: 'New',
			expectedRevision: 0,
			requestId: 'same'
		});
		(first.changed as string[]).push('tampered');
		f.setProject({ ...f.project(), revision: 10, name: 'Human edit' });
		const replay = await f.call('rename_project', {
			requestId: 'same',
			expectedRevision: 0,
			name: 'New'
		});
		expect(replay).toEqual({ ok: true, revision: 1, changed: ['layer_1'] });
		expect(f.project().name).toBe('Human edit');
		expect(f.execute).toHaveBeenCalledTimes(1);
		for (const input of [
			{ name: 'Different', expectedRevision: 0, requestId: 'same' },
			{ name: 'New', expectedRevision: 10, requestId: 'same' }
		])
			expect(await f.call('rename_project', input)).toMatchObject({ category: 'conflict' });
		expect(await f.call('undo', { expectedRevision: 0, requestId: 'same' })).toMatchObject({
			category: 'conflict'
		});
		expect(f.deps.undo).not.toHaveBeenCalled();
	});

	it('deduplicates concurrent requests while rejecting unrelated concurrent side effects', async () => {
		const f = fixture();
		const gate = deferred<unknown>();
		f.execute.mockReturnValue(gate.promise);
		await registerVectorTools(f.deps, undefined, f.context);
		const input = { name: 'Once', expectedRevision: 0, requestId: 'concurrent' };
		const first = f.call('rename_project', input);
		const second = f.call('rename_project', { ...input });
		await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
		expect(await f.call('undo', { expectedRevision: 0 })).toMatchObject({ category: 'busy' });
		expect(await f.call('get_project')).toMatchObject({ ok: true });
		gate.resolve({ changed: ['layer_1'] });
		expect(await first).toEqual(await second);
		expect(f.execute).toHaveBeenCalledTimes(1);
	});

	it('rechecks revision and lifecycle after asynchronous fingerprinting', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		const gate = deferred<ArrayBuffer>();
		vi.spyOn(crypto.subtle, 'digest').mockReturnValue(gate.promise);
		const pending = f.call('rename_project', {
			name: 'Old',
			expectedRevision: 0,
			requestId: 'hashing'
		});
		f.setProject({ ...f.project(), revision: 1, name: 'Human edit' });
		gate.resolve(new ArrayBuffer(32));
		expect(await pending).toMatchObject({ category: 'conflict', currentRevision: 1 });
		expect(f.execute).not.toHaveBeenCalled();
	});

	it('does not apply a pending request to a switched project with the same revision', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		const gate = deferred<ArrayBuffer>();
		vi.spyOn(crypto.subtle, 'digest').mockReturnValue(gate.promise);
		const pending = f.call('rename_project', {
			name: 'Old',
			expectedRevision: 0,
			requestId: 'hashing'
		});
		f.setProject({ ...f.project(), id: 'project_2' });
		gate.resolve(new ArrayBuffer(32));
		expect(await pending).toMatchObject({ category: 'conflict' });
		expect(f.execute).not.toHaveBeenCalled();
	});

	it('bounds the replay cache; evicted durable requests still fail revision checks', async () => {
		const f = fixture();
		await registerVectorTools(f.deps, undefined, f.context);
		for (let i = 0; i < 130; i++)
			expect(
				await f.call('rename_project', {
					name: `Name ${i}`,
					expectedRevision: i,
					requestId: `request_${i}`
				})
			).toMatchObject({ ok: true });
		expect(
			await f.call('rename_project', {
				name: 'Name 0',
				expectedRevision: 0,
				requestId: 'request_0'
			})
		).toMatchObject({ category: 'conflict' });
		expect(
			await f.call('rename_project', {
				name: 'Name 129',
				expectedRevision: 129,
				requestId: 'request_129'
			})
		).toMatchObject({ ok: true, revision: 130 });
		expect(f.execute).toHaveBeenCalledTimes(130);
	});
});

describe('optional asset and export capabilities', () => {
	it('registers only supplied capabilities and returns allowlisted metadata', async () => {
		const f = fixture();
		const importAsset = vi.fn(() => ({
			assetId: 'asset_1',
			width: 1,
			height: 1,
			byteLength: 1,
			base64: 'SECRET',
			blobKey: 'private'
		}));
		const exportFile = vi.fn(() => ({
			filename: 'test.svg',
			byteLength: 123,
			data: '<svg>SECRET</svg>',
			blob: new Blob()
		}));
		await registerVectorTools({ ...f.deps, importAsset, exportFile }, undefined, f.context);
		expect(f.tools.has('import_asset')).toBe(true);
		expect(f.tools.has('vectorize_asset')).toBe(false);
		expect(await f.call('get_project')).toMatchObject({
			capabilities: { importAsset: true, vectorizeAsset: false, exportSvg: true }
		});
		const input = { name: 'Pixel', mimeType: 'image/png', dataBase64: 'AA==', expectedRevision: 0 };
		expect(await f.call('import_asset', input)).toEqual({
			ok: true,
			revision: 0,
			assetId: 'asset_1',
			width: 1,
			height: 1,
			byteLength: 1
		});
		expect(importAsset).toHaveBeenCalledWith(input);
		for (const format of ['project', 'svg', 'lottie']) {
			expect(await f.call(`export_${format}`)).toEqual({
				ok: true,
				revision: 0,
				filename: 'test.svg',
				byteLength: 123
			});
			expect(exportFile).toHaveBeenLastCalledWith(format);
		}
	});

	it('requires a known raster for optional vectorization and checks revisions before callbacks', async () => {
		const f = fixture();
		f.project().assets.push({
			id: 'asset_1',
			name: 'Pixel',
			kind: 'raster',
			mimeType: 'image/png',
			width: 1,
			height: 1,
			byteLength: 1,
			source: 'file',
			blobKey: 'private',
			createdAt: f.project().createdAt
		});
		const vectorizeAsset = vi.fn(() => ({ changed: ['layer_1'] }));
		await registerVectorTools({ ...f.deps, vectorizeAsset }, undefined, f.context);
		expect(
			await f.call('vectorize_asset', { assetId: 'missing', expectedRevision: 0 })
		).toMatchObject({ category: 'validation' });
		expect(
			await f.call('vectorize_asset', { assetId: 'asset_1', expectedRevision: 1 })
		).toMatchObject({ category: 'conflict' });
		expect(vectorizeAsset).not.toHaveBeenCalled();
		expect(
			await f.call('vectorize_asset', { assetId: 'asset_1', expectedRevision: 0 })
		).toMatchObject({ ok: true });
	});

	it('rejects invalid MIME, malformed base64, encoded and decoded overflow without calling import', async () => {
		const f = fixture();
		const importAsset = vi.fn();
		await registerVectorTools({ ...f.deps, importAsset }, undefined, f.context);
		const maxEncoded = Math.ceil(ANIMATION_LIMITS.maxAssetBytes / 3) * 4;
		const base = { name: 'Bad', mimeType: 'image/png', dataBase64: 'AA==', expectedRevision: 0 };
		for (const fields of [
			{ mimeType: 'image/svg+xml' },
			{ mimeType: 'text/html' },
			{ dataBase64: '' },
			{ dataBase64: 'data:image/png;base64,AA==' },
			{ dataBase64: 'A A=' },
			{ dataBase64: 'AAA' },
			{ dataBase64: 'A=AA' },
			{ dataBase64: 'A'.repeat(maxEncoded + 4) },
			{ dataBase64: 'A'.repeat(maxEncoded) }
		]) {
			expect(await f.call('import_asset', { ...base, ...fields })).toMatchObject({
				ok: false,
				category: 'validation'
			});
		}
		expect(importAsset).not.toHaveBeenCalled();
	});
});

describe('shared command integration and final boundary checks', () => {
	it('produces identical documents and history from direct commands and WebMCP', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-08-31T00:00:00.000Z'));
		vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
		const f = fixture();
		let directProject = structuredClone(f.project());
		const direct = createAnimationCommands({
			getProject: () => directProject,
			setProject: (next) => {
				directProject = next;
			}
		});
		const adapted = createAnimationCommands({ getProject: f.project, setProject: f.setProject });
		await registerVectorTools(
			{ ...f.deps, execute: adapted.execute, undo: adapted.undo, redo: adapted.redo },
			undefined,
			f.context
		);
		const layerId = 'layer_00000000-0000-4000-8000-000000000001';
		const operations: [string, Record<string, unknown>][] = [
			['rename_project', { name: 'Pencil animation' }],
			['update_canvas', { width: 1200, height: 720, background: '#123456' }],
			['update_timeline', { fps: 24, frameCount: 120 }],
			['add_layer', { name: 'Animated stroke', paths: [line], frame: 0, style: { fill: null } }],
			['add_keyframe', { layerId, frame: 30, paths: [line], transform: { x: 100 }, opacity: 0.5 }],
			['update_path', { layerId, frame: 15, paths: [line] }],
			[
				'update_keyframe',
				{
					layerId,
					frame: 15,
					opacity: 0.7,
					easing: { type: 'bezier', x1: 0.4, y1: 0, x2: 0.6, y2: 1 }
				}
			],
			['set_layer_style', { layerId, style: { stroke: 'cyan', strokeWidth: 5 } }],
			['generate_inbetweens', { layerId, startFrame: 0, endFrame: 30 }],
			['clear_generated_inbetweens', { layerId, startFrame: 10, endFrame: 20 }],
			['delete_keyframe', { layerId, frame: 15 }],
			['reorder_layer', { layerId, zIndex: 0 }],
			['rename_layer', { layerId, name: 'Final stroke' }],
			['set_layer_visibility', { layerId, visible: false }],
			['set_layer_visibility', { layerId, visible: true }],
			['set_layer_lock', { layerId, locked: true }],
			['set_layer_lock', { layerId, locked: false }],
			['remove_layer', { layerId }]
		];
		for (const [name, input] of operations) {
			const expectedRevision = directProject.revision;
			const expected = direct.execute(name, input, expectedRevision);
			expect(expected.ok, name).toBe(true);
			expect(await f.call(name, { ...input, expectedRevision }), name).toEqual(expected);
			expect(f.project(), name).toEqual(directProject);
		}
		for (const direction of ['undo', 'undo', 'redo', 'redo'] as const) {
			const expectedRevision = directProject.revision;
			const expected = direct[direction](expectedRevision);
			expect(await f.call(direction, { expectedRevision })).toEqual(expected);
			expect(f.project()).toEqual(directProject);
		}
	});

	it('handles the actual session execute wrapper throwing a locked core result', async () => {
		const f = fixture();
		f.project().layers[0].locked = true;
		const commands = createAnimationCommands({ getProject: f.project, setProject: f.setProject });
		await registerVectorTools(
			{
				...f.deps,
				execute(name, input, expectedRevision) {
					const result = commands.execute(name, input, expectedRevision);
					if (!result.ok) throw Object.assign(new Error(result.message), result);
					return result;
				}
			},
			undefined,
			f.context
		);
		expect(
			await f.call('rename_layer', { layerId: 'layer_1', name: 'Blocked', expectedRevision: 0 })
		).toMatchObject({
			ok: false,
			category: 'locked',
			message: 'Unlock the layer before editing it.',
			revision: 0
		});
		expect(f.project().revision).toBe(0);
	});

	it('keeps summaries and session command results safe when given a whole session object', async () => {
		const f = fixture();
		const session = {
			...f.session,
			project: f.project(),
			runtime: new Blob(['PRIVATE']),
			secret: 'PRIVATE'
		};
		await registerVectorTools({ ...f.deps, getSession: () => session }, undefined, f.context);
		const summary = await f.call('get_project');
		expect(JSON.stringify(summary)).not.toContain('paths');
		expect(summary).not.toHaveProperty('project');
		expect(summary).not.toHaveProperty('runtime');
		const played = await f.call('play');
		expect(played).not.toHaveProperty('project');
		expect(JSON.stringify(played)).not.toContain('PRIVATE');
	});

	it('supports bounded scene frame inspection without seeking the session', async () => {
		const f = fixture();
		f.project().layers[0].keyframes[10] = {
			paths: structuredClone([line]),
			transform: { ...identityTransform(), x: 100 },
			easing: { type: 'linear' }
		};
		await registerVectorTools(f.deps, undefined, f.context);
		expect(await f.call('get_scene', { frame: 5 })).toMatchObject({
			frame: 5,
			currentFrame: 0,
			layers: [{ evaluated: { transform: { x: 50 } } }]
		});
		expect(await f.call('get_scene', { frame: 150 })).toMatchObject({ category: 'validation' });
		expect(f.deps.seek).not.toHaveBeenCalled();
	});

	it('does not reject stale captured callbacks when their route state has been destroyed', async () => {
		const f = fixture();
		let destroyed = false;
		const result = await registerVectorTools(
			{
				...f.deps,
				getProject() {
					if (destroyed) throw new Error('Unmounted');
					return f.project();
				}
			},
			undefined,
			f.context
		);
		result.dispose();
		destroyed = true;
		expect(await f.call('get_project')).toMatchObject({ ok: false, category: 'aborted' });
	});

	it('aborts a request still hashing before command dispatch', async () => {
		const f = fixture();
		const controller = new AbortController();
		await registerVectorTools(f.deps, controller.signal, f.context);
		const gate = deferred<ArrayBuffer>();
		vi.spyOn(crypto.subtle, 'digest').mockReturnValue(gate.promise);
		const pending = f.call('rename_project', {
			name: 'Old',
			expectedRevision: 0,
			requestId: 'pending'
		});
		controller.abort();
		gate.resolve(new ArrayBuffer(32));
		expect(await pending).toMatchObject({ category: 'aborted' });
		expect(f.execute).not.toHaveBeenCalled();
	});

	it('reports the command commit revision even if a later edit occurs before the callback settles', async () => {
		const f = fixture();
		f.execute.mockImplementation(() => {
			f.setProject({ ...f.project(), revision: 2 });
			return { ok: true, revision: 1, changed: ['layer_1'] };
		});
		await registerVectorTools(f.deps, undefined, f.context);
		expect(await f.call('rename_project', { name: 'Once', expectedRevision: 0 })).toMatchObject({
			ok: true,
			revision: 1
		});
	});
});
