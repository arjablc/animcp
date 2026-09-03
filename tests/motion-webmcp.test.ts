import { describe, it, expect, vi } from 'vitest';
import { createProject, createLayer, uid, presets } from '../src/lib/features/motion/model';
import {
	createMotionTools,
	registerMotionTools,
	type Tool
} from '../src/lib/features/motion/webmcp';
import { transact } from '../src/lib/features/motion/commands';
import type { MotionSession } from '../src/lib/features/motion/session.svelte';
function fixture() {
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
	const tools = createMotionTools(s);
	return {
		s,
		tools,
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
		const { s } = fixture();
		const registered: Tool[] = [];
		const unreg = vi.fn();
		const dispose = await registerMotionTools(s, {
			modelContext: {
				registerTool: async (t: Tool) => {
					registered.push(t);
				},
				unregisterTool: unreg
			}
		} as never);
		expect(registered.some((t) => t.name === 'find_elements')).toBe(true);
		expect(registered).toHaveLength(34);
		expect(registered.map((t) => t.name)).not.toEqual(
			expect.arrayContaining([
				'undo',
				'redo',
				'playback',
				'set_editor_context',
				'copy_easing',
				'duplicate_keyframes'
			])
		);
		expect(registered.every((t) => t.inputSchema && t.description && t.execute)).toBe(true);
		dispose();
		expect(unreg).toHaveBeenCalledTimes(registered.length);
		expect(await registered[0].execute({})).toMatchObject({ ok: false });
	});
	it('reads text, sequences a unique result, and rejects stale edits', async () => {
		const { s, call } = fixture();
		expect(await call('find_elements', { text: 'hello' })).toMatchObject({
			ok: true,
			data: { status: 'unique', candidates: [{ text: 'hello' }] }
		});
		expect(
			await call('sequence_motion', {
				expectedRevision: 0,
				layerIds: [s.project.layers[1].id],
				referenceLayerId: s.project.layers[0].id
			})
		).toMatchObject({ ok: true, revision: 1 });
		expect(s.project.layers[1].tracks.opacity.keys.map((k) => k.frame)).toEqual([21, 41]);
		expect(
			await call('shift_motion', {
				expectedRevision: 0,
				layerIds: [s.project.layers[1].id],
				frames: 1
			})
		).toMatchObject({ ok: false });
	});
	it('requires checked context before mutating implicit selections', async () => {
		const { s, call } = fixture();
		s.context.selectedLayerIds = [s.project.layers[0].id];
		expect(await call('shift_motion', { expectedRevision: 0, frames: 1 })).toMatchObject({
			ok: false
		});
		expect(
			await call('shift_motion', { expectedRevision: 0, expectedContextRevision: 0, frames: 1 })
		).toMatchObject({ ok: true });
	});
	it('deduplicates retries and rejects request-id reuse', async () => {
		const { s, call } = fixture();
		const input = {
			expectedRevision: 0,
			requestId: 'retry',
			layerIds: [s.project.layers[0].id],
			frames: 1
		};
		const first = await call('shift_motion', input);
		expect(await call('shift_motion', input)).toEqual(first);
		expect(s.commit).toHaveBeenCalledTimes(1);
		expect(await call('shift_motion', { ...input, frames: 2 })).toMatchObject({ ok: false });
	});
	it('rejects invalid nested batch arguments before committing', async () => {
		const { s, call } = fixture();
		expect(
			await call('batch_edit', {
				expectedRevision: 0,
				label: 'Bad batch',
				operations: [
					{
						name: 'set_layer',
						input: { layerId: s.project.layers[0].id, changes: { text: 'changed' } }
					},
					{ name: 'shift_motion', input: { frames: 'not a frame' } }
				]
			})
		).toMatchObject({ ok: false });
		expect(s.project.layers[0].text).toBe('Title');
		expect(s.commit).not.toHaveBeenCalled();
	});
});
