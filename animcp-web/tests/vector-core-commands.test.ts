import { describe, expect, it, vi } from 'vitest';
import {
	ANIMATION_LIMITS,
	createAnimationProject,
	identityTransform,
	type AnimationProject,
	type PathData
} from '../src/lib/features/animation/model';
import {
	createAnimationCommands,
	type CommandResult
} from '../src/lib/features/animation/commands';
import { evaluateLayer } from '../src/lib/features/animation/interpolation';
import { parseProject } from '../src/lib/features/animation/validation';

function path(x = 0): PathData {
	return [
		{ type: 'M', x, y: 0 },
		{ type: 'L', x: x + 30, y: 30 }
	];
}
function setup() {
	let project = createAnimationProject({ id: 'project', name: 'Test' });
	let busy = false;
	const setProject = vi.fn((next: AnimationProject) => {
		project = next;
	});
	const commands = createAnimationCommands({
		getProject: () => project,
		setProject,
		isBusy: () => busy
	});
	function addLayer(name = 'Stroke') {
		const result = commands.execute('add_layer', { name, paths: [path()] });
		if (!result.ok) throw new Error(result.message);
		return result.changed[0];
	}
	return {
		commands,
		addLayer,
		setProject,
		project: () => project,
		replace: (next: AnimationProject) => {
			project = next;
		},
		setBusy: (value: boolean) => {
			busy = value;
		}
	};
}
function expectSuccess(
	result: CommandResult
): asserts result is Extract<CommandResult, { ok: true }> {
	expect(result.ok, JSON.stringify(result)).toBe(true);
}

describe('vector core commands and shared history', () => {
	it('adds a layer and optional initial key atomically, returning the stable layer ID', () => {
		const test = setup();
		const original = test.project();
		const input = {
			name: 'Stroke',
			style: { stroke: '#ffffff' },
			paths: [path()],
			frame: 5,
			transform: { x: 50 },
			opacity: 0.4
		};
		const result = test.commands.execute('add_layer', input, 0);
		expectSuccess(result);
		expect(result.revision).toBe(1);
		expect(result.changed).toEqual([test.project().layers[0].id]);
		expect(test.setProject).toHaveBeenCalledTimes(1);
		expect(test.project().layers[0]).toMatchObject({
			name: 'Stroke',
			style: { stroke: '#ffffff', opacity: 1 },
			keyframes: { 5: { transform: { x: 50, scaleX: 1 }, opacity: 0.4 } }
		});
		expect(original.layers).toEqual([]);
		input.transform.x = 999;
		input.paths[0].push({ type: 'Z' });
		expect(test.project().layers[0].keyframes[5].transform.x).toBe(50);
		expect(test.project().layers[0].keyframes[5].paths[0]).toHaveLength(2);
		expect(test.commands.canUndo).toBe(true);
		expectSuccess(test.commands.undo(1));
		expect(test.project().layers).toEqual([]);
		expect(test.project().revision).toBe(2);
		expect(test.commands.canUndo).toBe(false);
		expect(test.commands.canRedo).toBe(true);
		expectSuccess(test.commands.redo(2));
		expect(test.project().layers[0].id).toBe(result.changed[0]);
		expect(test.project().revision).toBe(3);
	});

	it('updates project metadata and only replaces validated state', () => {
		const test = setup();
		expectSuccess(test.commands.execute('rename_project', { name: 'New name' }));
		expectSuccess(test.commands.execute('update_canvas', { width: 1200, background: '#fff' }));
		expectSuccess(test.commands.execute('update_timeline', { fps: 24, frameCount: 120 }));
		expect(test.project()).toMatchObject({
			name: 'New name',
			canvas: { width: 1200, height: 540, background: '#fff' },
			timeline: { fps: 24, frameCount: 120 },
			revision: 3
		});
		expect(() => parseProject(test.project())).not.toThrow();
	});

	it('edits, reorders, locks, hides and removes layers through the same revision stream', () => {
		const test = setup();
		const first = test.addLayer('First');
		const second = test.addLayer('Second');
		expectSuccess(test.commands.execute('rename_layer', { layerId: first, name: 'Renamed' }));
		expectSuccess(
			test.commands.execute('set_layer_style', {
				layerId: first,
				style: { opacity: 0.3, strokeWidth: 8, fill: '#abc' }
			})
		);
		expectSuccess(test.commands.execute('reorder_layer', { layerId: second, zIndex: 0 }));
		expect(test.project().layers.map((layer) => [layer.id, layer.zIndex])).toEqual([
			[second, 0],
			[first, 1]
		]);
		expectSuccess(test.commands.execute('set_layer_lock', { layerId: first, locked: true }));
		const before = test.project();
		expect(test.commands.execute('remove_layer', { layerId: first })).toMatchObject({
			ok: false,
			category: 'locked'
		});
		expect(test.project()).toBe(before);
		expectSuccess(
			test.commands.execute('set_layer_visibility', { layerId: first, visible: false })
		);
		expectSuccess(test.commands.execute('set_layer_lock', { layerId: first, locked: false }));
		expectSuccess(test.commands.execute('remove_layer', { layerId: first }));
		expect(test.project().layers.map((layer) => layer.id)).toEqual([second]);
		expectSuccess(test.commands.undo());
		expect(test.project().layers.find((layer) => layer.id === first)).toMatchObject({
			name: 'Renamed',
			visible: false,
			style: { opacity: 0.3, strokeWidth: 8 }
		});
	});

	it('records monotonically increasing revisions and a fresh timestamp on undo/redo', () => {
		const test = setup();
		vi.useFakeTimers();
		try {
			vi.setSystemTime('2026-08-31T01:00:00Z');
			test.addLayer();
			vi.setSystemTime('2026-08-31T02:00:00Z');
			expectSuccess(test.commands.undo(1));
			expect(test.project()).toMatchObject({ revision: 2, updatedAt: '2026-08-31T02:00:00.000Z' });
			vi.setSystemTime('2026-08-31T03:00:00Z');
			expectSuccess(test.commands.redo(2));
			expect(test.project()).toMatchObject({ revision: 3, updatedAt: '2026-08-31T03:00:00.000Z' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('clears redo after a committed divergent edit but preserves it after failed edits', () => {
		const test = setup();
		test.addLayer();
		expectSuccess(test.commands.undo());
		expect(test.commands.execute('rename_project', { name: '' })).toMatchObject({ ok: false });
		expect(test.commands.canRedo).toBe(true);
		expectSuccess(test.commands.execute('rename_project', { name: 'A new branch' }));
		expect(test.commands.canRedo).toBe(false);
		expect(test.commands.redo()).toMatchObject({ ok: false, category: 'validation' });
	});

	it('detaches history from input, command results, and published state', () => {
		const test = setup();
		const id = test.addLayer();
		// A consumer violating the no-direct-mutation rule still cannot corrupt retained history.
		test.project().layers[0].name = 'Mutated externally';
		expectSuccess(test.commands.undo());
		const redo = test.commands.redo();
		expectSuccess(redo);
		redo.changed[0] = 'tampered';
		expect(test.project().layers[0]).toMatchObject({ id, name: 'Stroke' });
		expect(test.commands.undo()).toMatchObject({ changed: [id] });
	});

	it('never overwrites an external project replacement or newer revision through stale history', () => {
		const test = setup();
		test.addLayer();
		test.replace({ ...test.project(), revision: 9, name: 'External' });
		expect(test.commands.canUndo).toBe(false);
		expect(test.commands.undo()).toMatchObject({
			ok: false,
			category: 'conflict',
			currentRevision: 9
		});
		expect(test.project().name).toBe('External');
		expectSuccess(test.commands.execute('rename_project', { name: 'Latest' }, 9));
		expectSuccess(test.commands.undo());
		expect(test.project().name).toBe('External');
		expect(test.commands.canUndo).toBe(false);
		test.replace(createAnimationProject({ id: 'different-project' }));
		expect(test.commands.redo()).toMatchObject({ ok: false, category: 'conflict' });
	});
});

describe('vector core keyframe commands', () => {
	it('adds and updates keyframes, supports static style overrides, and authors path edits at new frames', () => {
		const test = setup();
		const layerId = test.addLayer();
		expectSuccess(
			test.commands.execute('add_keyframe', {
				layerId,
				frame: 10,
				paths: [path(100)],
				transform: { x: 100 },
				easing: { type: 'linear' },
				opacity: 0.5
			})
		);
		expectSuccess(
			test.commands.execute('update_keyframe', {
				layerId,
				frame: 10,
				transform: { y: 20 },
				style: { stroke: '#123456' }
			})
		);
		expect(test.project().layers[0].keyframes[10]).toMatchObject({
			transform: { x: 100, y: 20 },
			opacity: 0.5,
			generated: false
		});
		expect(test.project().layers[0].style.stroke).toBe('#123456');
		expectSuccess(test.commands.execute('update_path', { layerId, frame: 5, paths: [path(50)] }));
		expect(test.project().layers[0].keyframes[5]).toMatchObject({
			transform: { x: 50, y: 10 },
			generated: false
		});
		expectSuccess(test.commands.execute('delete_keyframe', { layerId, frame: 5 }));
		expect(test.project().layers[0].keyframes[5]).toBeUndefined();
	});

	it('copies visible frame data when adding a keyframe without paths and requires paths for empty layers', () => {
		const test = setup();
		const layerId = test.addLayer();
		expectSuccess(test.commands.execute('add_keyframe', { layerId, frame: 5 }));
		expect(test.project().layers[0].keyframes[5].paths).toEqual([path()]);
		expectSuccess(test.commands.execute('add_layer', { name: 'Empty' }));
		const empty = test.project().layers[1].id;
		expect(test.commands.execute('add_keyframe', { layerId: empty, frame: 0 })).toMatchObject({
			ok: false,
			category: 'validation'
		});
	});

	it('requires explicit overwrite for authored keys and promotes generated keys on editing', () => {
		const test = setup();
		const layerId = test.addLayer();
		expect(
			test.commands.execute('add_keyframe', { layerId, frame: 0, paths: [path(50)] })
		).toMatchObject({ ok: false });
		expectSuccess(
			test.commands.execute('add_keyframe', {
				layerId,
				frame: 0,
				paths: [path(50)],
				overwrite: true
			})
		);
		expectSuccess(test.commands.execute('add_keyframe', { layerId, frame: 4, paths: [path(100)] }));
		expectSuccess(
			test.commands.execute('generate_inbetweens', { layerId, startFrame: 0, endFrame: 4 })
		);
		expect(test.project().layers[0].keyframes[2].generated).toBe(true);
		expectSuccess(test.commands.execute('update_keyframe', { layerId, frame: 2, opacity: 0.25 }));
		expect(test.project().layers[0].keyframes[2]).toMatchObject({
			generated: false,
			opacity: 0.25
		});
		expectSuccess(test.commands.execute('clear_generated_inbetweens', { layerId }));
		expect(Object.keys(test.project().layers[0].keyframes)).toEqual(['0', '2', '4']);
	});

	it('generates one undoable batch matching evaluation and preserves authored middle keys', () => {
		const test = setup();
		const layerId = test.addLayer();
		expectSuccess(
			test.commands.execute('add_keyframe', {
				layerId,
				frame: 10,
				paths: [path(100)],
				transform: { x: 100 }
			})
		);
		expectSuccess(
			test.commands.execute('add_keyframe', {
				layerId,
				frame: 5,
				paths: [path(80)],
				transform: { x: 80 }
			})
		);
		const original = structuredClone(test.project().layers[0]);
		const beforeRevision = test.project().revision;
		expectSuccess(
			test.commands.execute('generate_inbetweens', { layerId, startFrame: 0, endFrame: 10 })
		);
		expect(test.project().revision).toBe(beforeRevision + 1);
		expect(test.project().layers[0].keyframes[5]).toEqual(original.keyframes[5]);
		for (const frame of [1, 3, 6, 9])
			expect(test.project().layers[0].keyframes[frame]).toEqual(evaluateLayer(original, frame));
		expectSuccess(test.commands.undo());
		expect(test.project().layers[0]).toEqual(original);
		expectSuccess(test.commands.redo());
		expect(Object.keys(test.project().layers[0].keyframes)).toHaveLength(11);
		expectSuccess(
			test.commands.execute('generate_inbetweens', {
				layerId,
				startFrame: 0,
				endFrame: 10,
				overwrite: true
			})
		);
		expect(test.project().layers[0].keyframes[5]).toMatchObject({
			transform: { x: 50 },
			generated: true
		});
	});

	it('rejects incompatible endpoints and intermediate anchors without partial generated state', () => {
		const test = setup();
		const layerId = test.addLayer();
		expectSuccess(
			test.commands.execute('add_keyframe', { layerId, frame: 10, paths: [path(100)] })
		);
		expectSuccess(
			test.commands.execute('add_keyframe', {
				layerId,
				frame: 5,
				paths: [[...path(50), { type: 'Z' }]]
			})
		);
		const before = test.project();
		const calls = test.setProject.mock.calls.length;
		expect(
			test.commands.execute('generate_inbetweens', { layerId, startFrame: 0, endFrame: 10 })
		).toMatchObject({ ok: false, category: 'validation' });
		expect(test.project()).toBe(before);
		expect(test.setProject).toHaveBeenCalledTimes(calls);
		expect(
			test.commands.execute('generate_inbetweens', { layerId, startFrame: 0, endFrame: 5 })
		).toMatchObject({ ok: false, category: 'validation' });
		expect(() => evaluateLayer(test.project().layers[0], 2)).not.toThrow();
	});

	it('rejects oversized generated output before allocating the batch', () => {
		const test = setup();
		const large: PathData = [
			{ type: 'M', x: 0, y: 0 },
			...Array.from({ length: 500 }, (_, i) => ({ type: 'L' as const, x: i, y: 0 }))
		];
		expectSuccess(test.commands.execute('update_timeline', { frameCount: 1800 }));
		const added = test.commands.execute('add_layer', { name: 'Complex', paths: [large] });
		expectSuccess(added);
		const layerId = added.changed[0];
		expectSuccess(test.commands.execute('add_keyframe', { layerId, frame: 1799, paths: [large] }));
		const before = test.project();
		expect(
			test.commands.execute('generate_inbetweens', { layerId, startFrame: 0, endFrame: 1799 })
		).toMatchObject({
			ok: false,
			category: 'validation',
			message: expect.stringContaining('complexity limit')
		});
		expect(test.project()).toBe(before);
	});
});

describe('vector core failed command isolation', () => {
	it('checks optional revisions in positional and tool metadata form, including undo/redo', () => {
		const test = setup();
		test.addLayer();
		const before = test.project();
		for (const result of [
			test.commands.execute('rename_project', { name: 'Stale' }, 0),
			test.commands.execute('rename_project', { name: 'Stale', expectedRevision: 0 }),
			test.commands.undo(0)
		])
			expect(result).toEqual({
				ok: false,
				category: 'conflict',
				message: 'Revision conflict.',
				revision: 1,
				currentRevision: 1
			});
		expect(test.project()).toBe(before);
		expect(
			test.commands.execute('rename_project', { name: 'Confused', expectedRevision: 0 }, 1)
		).toMatchObject({ ok: false, category: 'validation' });
		expectSuccess(
			test.commands.execute('rename_project', {
				name: 'Fresh',
				expectedRevision: 1,
				requestId: 'request-1'
			})
		);
		expectSuccess(test.commands.undo(2));
		expect(test.commands.redo(2)).toMatchObject({
			ok: false,
			category: 'conflict',
			currentRevision: 3
		});
	});

	it('preserves object identity, revisions, history and setter calls on malformed inputs', () => {
		const test = setup();
		const layerId = test.addLayer();
		const before = test.project();
		const cases: [string, unknown][] = [
			['rename_project', null],
			['rename_project', []],
			['rename_project', { name: 'ok', extra: true }],
			['update_canvas', { width: NaN }],
			['update_canvas', { width: null }],
			['update_canvas', { width: 500, height: 100 }],
			['update_timeline', { fps: null }],
			['update_timeline', { frameCount: 1 }],
			['set_layer_style', { layerId, style: { opacity: 2 } }],
			['reorder_layer', { layerId, zIndex: 5 }],
			['set_layer_visibility', { layerId, visible: 'false' }],
			['add_layer', { name: 'Bad', paths: [[{ type: 'L', x: 0, y: 0 }]] }],
			['add_layer', { name: 'Bad', paths: [path()], frame: null }],
			['add_layer', { name: 'Bad', transform: identityTransform() }],
			['add_keyframe', { layerId, frame: -1, paths: [path()] }],
			['add_keyframe', { layerId, frame: 150, paths: [path()] }],
			['update_keyframe', { layerId, frame: 0, opacity: null }],
			['update_keyframe', { layerId, frame: 0, easing: null }],
			['update_keyframe', { layerId, frame: 0, paths: null }],
			['update_keyframe', { layerId, frame: 0, transform: { scaleX: 0 } }],
			['generate_inbetweens', { layerId, startFrame: 0, endFrame: 0 }],
			['clear_generated_inbetweens', { layerId, startFrame: 10, endFrame: 5 }]
		];
		for (const [name, input] of cases) {
			expect(test.commands.execute(name, input), `${name}: ${JSON.stringify(input)}`).toMatchObject(
				{ ok: false, category: 'validation' }
			);
			expect(test.project()).toBe(before);
		}
		expect(test.setProject).toHaveBeenCalledTimes(1);
		expect(test.commands.canUndo).toBe(true);
		expectSuccess(test.commands.undo());
		expect(test.project().layers).toEqual([]);
	});

	it('rejects prototype pollution, executable getters and unknown command names without executing input', () => {
		const test = setup();
		const layerId = test.addLayer();
		for (const name of ['__proto__', 'constructor', 'prototype']) {
			const payload = JSON.parse(`{"layerId":"${layerId}","style":{"${name}":{"polluted":true}}}`);
			expect(test.commands.execute('set_layer_style', payload)).toMatchObject({
				ok: false,
				category: 'validation'
			});
			expect(test.commands.execute(name, {})).toMatchObject({ ok: false, category: 'unsupported' });
		}
		const getter = vi.fn(() => 'Changed');
		const input = Object.defineProperty({}, 'name', { enumerable: true, get: getter });
		expect(test.commands.execute('rename_project', input)).toMatchObject({
			ok: false,
			category: 'validation'
		});
		expect(getter).not.toHaveBeenCalled();
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(test.project().revision).toBe(1);
	});

	it('rejects missing layers/keys, timeline truncation and busy mutations without damaging state', () => {
		const test = setup();
		const layerId = test.addLayer();
		expectSuccess(
			test.commands.execute('add_keyframe', { layerId, frame: 100, paths: [path(100)] })
		);
		const before = test.project();
		expect(test.commands.execute('update_timeline', { frameCount: 60 })).toMatchObject({
			ok: false,
			category: 'validation'
		});
		expect(test.commands.execute('remove_layer', { layerId: 'missing' })).toMatchObject({
			ok: false,
			category: 'not_found'
		});
		expect(test.commands.execute('delete_keyframe', { layerId, frame: 50 })).toMatchObject({
			ok: false,
			category: 'not_found'
		});
		expect(
			test.commands.execute('update_keyframe', { layerId, frame: 50, opacity: 0.5 })
		).toMatchObject({ ok: false, category: 'not_found' });
		test.setBusy(true);
		expect(test.commands.execute('rename_project', { name: 'Busy' })).toMatchObject({
			ok: false,
			category: 'busy'
		});
		expect(test.commands.undo()).toMatchObject({ ok: false, category: 'busy' });
		expectSuccess(test.commands.execute('get_project', {}));
		expect(test.project()).toBe(before);
	});

	it('preserves undo/redo history when the atomic setter fails before publishing', () => {
		const test = setup();
		test.addLayer();
		test.setProject.mockImplementationOnce(() => {
			throw new Error('private database details');
		});
		expect(test.commands.undo()).toEqual({
			ok: false,
			category: 'internal',
			message: 'The command could not be completed.',
			revision: 1
		});
		expect(test.commands.canUndo).toBe(true);
		expect(test.commands.canRedo).toBe(false);
		expectSuccess(test.commands.undo());
		test.setProject.mockImplementationOnce(() => {
			throw new Error('private database details');
		});
		expect(test.commands.redo()).toMatchObject({ ok: false, category: 'internal' });
		expect(test.commands.canRedo).toBe(true);
	});

	it('prevents reentrant durable mutations while publishing', () => {
		const test = setup();
		let nested: CommandResult | undefined;
		test.setProject.mockImplementationOnce((next) => {
			nested = test.commands.execute('rename_project', { name: 'Nested' });
			test.replace(next);
		});
		expectSuccess(test.commands.execute('rename_project', { name: 'Outer' }));
		expect(nested).toMatchObject({ ok: false, category: 'busy' });
		expect(test.project()).toMatchObject({ name: 'Outer', revision: 1 });
	});
});

describe('vector core reads and asset metadata', () => {
	it('returns isolated reads without revision, timestamp, history or setter changes', () => {
		const test = setup();
		test.addLayer();
		const before = test.project();
		for (const name of ['get_project', 'get_scene', 'get_timeline', 'export_project'])
			expectSuccess(test.commands.execute(name, {}));
		const read = test.commands.execute('get_project', { includePaths: true });
		expectSuccess(read);
		(read.data as AnimationProject).layers[0].name = 'Read mutation';
		expect(test.project()).toBe(before);
		expect(test.project().layers[0].name).toBe('Stroke');
		expect(test.setProject).toHaveBeenCalledTimes(1);
		const summary = test.commands.execute('get_project', {});
		expectSuccess(summary);
		expect(JSON.stringify(summary.data)).not.toContain('paths');
		expectSuccess(test.commands.execute('get_scene', { frame: 1 }));
	});

	it('keeps current frame, selection, playback and external IO out of durable commands', () => {
		const test = setup();
		const before = test.project();
		for (const name of [
			'set_current_frame',
			'play',
			'pause',
			'restart',
			'get_selection',
			'import_asset',
			'vectorize_asset',
			'export_svg',
			'export_lottie'
		])
			expect(test.commands.execute(name, {})).toMatchObject({ ok: false, category: 'unsupported' });
		expect(test.project()).toBe(before);
		expect(test.commands.canUndo).toBe(false);
	});

	it('adds asset metadata with the same undo/revision semantics and rejects duplicate or oversized records', () => {
		const test = setup();
		const asset = {
			id: 'asset',
			name: 'Photo',
			kind: 'raster',
			mimeType: 'image/png',
			width: 512,
			height: 512,
			byteLength: 10_000,
			source: 'file',
			blobKey: 'blob-key',
			createdAt: '2026-08-31T00:00:00.000Z'
		};
		expect(test.commands.execute('add_asset', { asset })).toEqual({
			ok: true,
			revision: 1,
			changed: ['asset']
		});
		const before = test.project();
		expect(test.commands.execute('add_asset', { asset })).toMatchObject({
			ok: false,
			category: 'validation'
		});
		expect(
			test.commands.execute('add_asset', {
				asset: { ...asset, id: 'other', byteLength: ANIMATION_LIMITS.maxAssetBytes + 1 }
			})
		).toMatchObject({ ok: false, category: 'validation' });
		expect(test.project()).toBe(before);
		expectSuccess(test.commands.undo());
		expect(test.project().assets).toEqual([]);
		expectSuccess(test.commands.redo());
		expect(test.project().assets).toEqual([asset]);
	});
});
