import { describe, it, expect, vi } from 'vitest';
import { createProject, createLayer, uid, presets } from '../src/lib/features/motion/model';
import {
	refreshMotionTools,
	registerMotionTools,
	type Tool
} from '../src/lib/features/motion/webmcp';
import { transact } from '../src/lib/features/motion/commands';
import type { MotionSession } from '../src/lib/features/motion/session.svelte';
async function fixture() {
	const project = createProject();
	for (const text of ['Title', 'hello']) {
		const l = createLayer('text');
		l.text = text;
		l.tracks.opacity.keys = [
			{ id: uid(), frame: 0, value: 0, easing: presets.linear },
			{ id: uid(), frame: 20, value: 1, easing: presets.linear }
		];
		project.layers.push(l);
	}
	const s = {
		project,
		context: {
			currentFrame: 0,
			revision: 0,
			selectedLayerIds: [] as string[],
			selectedProperties: [] as string[],
			selectedKeyframeIds: [] as string[],
			selectedRange: null
		},
		webmcp: '',
		commit: vi.fn((ops) => {
			const r = transact(s.project, ops);
			s.project = r.project;
			return r;
		}),
		undo: vi.fn(),
		redo: vi.fn(),
		select: vi.fn(),
		seek: vi.fn()
	} as unknown as MotionSession;
	const tools: Tool[] = [];
	const unreg = vi.fn();
	const modelContext = {
		registerTool: (tool: Tool) => tools.push(tool),
		unregisterTool: unreg,
		getTools: () => tools
	};
	const dispose = await registerMotionTools(s, {
		modelContext
	} as never);
	return {
		s,
		tools,
		modelContext,
		unreg,
		dispose,
		call: (name: string, input: Record<string, unknown>) =>
			tools.find((t) => t.name === name)!.execute(input) as Promise<{
				ok: boolean;
				revision: number;
				error?: string;
				data?: unknown;
			}>
	};
}
describe('motion WebMCP contract', () => {
	it('registers executable tools on the document model context and disposes them', async () => {
		const { s, tools, unreg, dispose } = await fixture();
		expect(tools).toHaveLength(10);
		expect(tools.map((tool) => tool.name)).toEqual(
			expect.arrayContaining([
				'get_editor_context',
				'find_elements',
				'get_layer',
				'get_motion',
				'get_operation_schema',
				'edit_layers',
				'edit_path',
				'edit_animation',
				'edit_timeline',
				'apply_edits'
			])
		);
		expect(tools.every((tool) => tool.inputSchema && tool.description && tool.execute)).toBe(true);
		expect(s.webmcpTools).toEqual(tools);
		expect(
			tools
				.filter((tool) => tool.name.startsWith('get_') || tool.name === 'find_elements')
				.every((tool) => tool.annotations?.readOnlyHint === true)
		).toBe(true);
		expect(
			tools
				.filter((tool) => !tool.name.startsWith('get_') && tool.name !== 'find_elements')
				.every((tool) => tool.annotations?.readOnlyHint !== true)
		).toBe(true);
		dispose();
		expect(unreg).toHaveBeenCalledTimes(tools.length);
		expect(await tools[0].execute({})).toMatchObject({ ok: false });
	});
	it('refreshes the catalog from the live model-context tool list', async () => {
		const { s, tools, modelContext } = await fixture();
		tools.pop();
		await refreshMotionTools(s, { modelContext } as never);
		expect(s.webmcpTools).toEqual(tools);
		expect(s.webmcpTools).toHaveLength(9);
	});
	it('reads text, sequences a unique result, and rejects stale edits', async () => {
		const { s, call } = await fixture();
		expect(await call('find_elements', { text: 'hello' })).toMatchObject({
			ok: true,
			data: { status: 'unique', candidates: [{ text: 'hello' }] }
		});
		expect(
			await call('edit_timeline', {
				expectedRevision: 0,
				action: 'sequence_motion',
				input: {
					layerIds: [s.project.layers[1].id],
					referenceLayerId: s.project.layers[0].id
				}
			})
		).toMatchObject({ ok: true, revision: 1 });
		expect(s.project.layers[1].tracks.opacity.keys.map((k) => k.frame)).toEqual([21, 41]);
		expect(
			await call('edit_timeline', {
				expectedRevision: 0,
				action: 'shift_motion',
				input: { layerIds: [s.project.layers[1].id], frames: 1 }
			})
		).toMatchObject({ ok: false });
	});
	it('requires checked context before mutating implicit selections', async () => {
		const { s, call } = await fixture();
		s.context.selectedLayerIds = [s.project.layers[0].id];
		expect(
			await call('edit_timeline', {
				expectedRevision: 0,
				action: 'shift_motion',
				input: { frames: 1 }
			})
		).toMatchObject({ ok: false });
		expect(
			await call('edit_timeline', {
				expectedRevision: 0,
				expectedContextRevision: 0,
				action: 'shift_motion',
				input: { frames: 1 }
			})
		).toMatchObject({ ok: true });
	});
	it('deduplicates retries and rejects request-id reuse', async () => {
		const { s, call } = await fixture();
		const input = {
			expectedRevision: 0,
			requestId: 'retry',
			action: 'shift_motion',
			input: { layerIds: [s.project.layers[0].id], frames: 1 }
		};
		const first = await call('edit_timeline', input);
		expect(await call('edit_timeline', input)).toEqual(first);
		expect(s.commit).toHaveBeenCalledTimes(1);
		expect(
			await call('edit_timeline', {
				...input,
				input: { layerIds: [s.project.layers[0].id], frames: 2 }
			})
		).toMatchObject({ ok: false });
	});
	it('rejects invalid nested batch arguments before committing', async () => {
		const { s, call } = await fixture();
		expect(
			await call('apply_edits', {
				expectedRevision: 0,
				label: 'Bad batch',
				operations: [
					{
						action: 'set_layer',
						input: { layerId: s.project.layers[0].id, changes: { text: 'changed' } }
					},
					{ action: 'shift_motion', input: { frames: 'not a frame' } }
				]
			})
		).toMatchObject({ ok: false });
		expect(s.project.layers[0].text).toBe('Title');
		expect(s.commit).not.toHaveBeenCalled();
	});
	it('creates paths and edits animatable style properties through their domain tools', async () => {
		const { s, call } = await fixture();
		const created = await call('edit_path', {
			expectedRevision: 0,
			action: 'create_path',
			input: {
				name: 'Line',
				paths: [
					[
						{ type: 'M', x: 0, y: 0 },
						{ type: 'L', x: 100, y: 100 }
					]
				],
				bounds: { positionX: 10, positionY: 20, width: 100, height: 100 }
			}
		});
		expect(created).toMatchObject({ ok: true, revision: 1 });
		const path = s.project.layers.at(-1)!;
		expect(path.type).toBe('path');
		expect(
			await call('edit_animation', {
				expectedRevision: 1,
				action: 'add_keyframe',
				input: { layerId: path.id, property: 'stroke', frame: 10, value: '#ffffff' }
			})
		).toMatchObject({ ok: true, revision: 2 });
		expect(path.id).toBe(s.project.layers.at(-1)!.id);
		expect(s.project.layers.at(-1)!.tracks.stroke.keys[0].value).toBe('#ffffff');
	});
	it('does not expose project edits and rejects actions in the wrong domain', async () => {
		const { call } = await fixture();
		expect(await call('get_operation_schema', { action: 'set_composition' })).toMatchObject({
			ok: false
		});
		expect(
			await call('edit_layers', {
				expectedRevision: 0,
				action: 'set_paint',
				input: { layerId: 'missing', type: 'solid' }
			})
		).toMatchObject({ ok: false });
	});
});
