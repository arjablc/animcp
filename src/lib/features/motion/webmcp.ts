import type { MotionSession } from './session.svelte';
import { check, string } from './model';
import { findElements, layerById, type Input, type Operation } from './commands';
import {
	createToolDeclarations,
	motionSchemas,
	validate,
	type ModelContext,
	type Tool
} from './webmcp-schema';

export type { ModelContext, Tool } from './webmcp-schema';
export function createMotionTools(session: MotionSession): Tool[] {
	const requests = new Map<string, { fingerprint: string; result: unknown }>();
	return createToolDeclarations().map(({ name, description, inputSchema }) => ({
		name,
		description,
		inputSchema,
		execute: async (raw: Input) => {
			try {
				validate(inputSchema, raw);
				const i = structuredClone(raw);
				delete i.expectedRevision;
				delete i.expectedContextRevision;
				delete i.requestId;
				const fingerprint = JSON.stringify([name, raw]);
				if (raw.requestId) {
					const old = requests.get(String(raw.requestId));
					if (old) {
						check(old.fingerprint === fingerprint, 'Request ID reused with different input');
						return structuredClone(old.result);
					}
				}
				if (raw.expectedRevision !== undefined)
					check(
						raw.expectedRevision === session.project.revision,
						'Revision conflict: read current state'
					);
				if (raw.expectedContextRevision !== undefined)
					check(
						raw.expectedContextRevision === session.context.revision,
						'Selection/context changed: read context again'
					);
				const p = session.project;
				let data: unknown;
				if (name === 'get_editor_context')
					data = {
						context: session.context,
						composition: p.composition,
						layers: p.layers.map((l) => ({
							id: l.id,
							name: l.name,
							type: l.type,
							text: l.type === 'text' ? l.text : undefined,
							visible: l.visible,
							locked: l.locked,
							locks: Object.fromEntries(
								Object.entries(l.tracks)
									.filter(([, t]) => t.locks)
									.map(([k, t]) => [k, t.locks])
							)
						})),
						assets: p.assets.map(({ id, name, mime, width, height }) => ({
							id,
							name,
							mime,
							width,
							height
						}))
					};
				else if (name === 'find_elements') {
					const candidates = findElements(p, i);
					data = {
						status:
							candidates.length === 0
								? 'not_found'
								: candidates.length === 1
									? 'unique'
									: 'ambiguous',
						candidates
					};
				} else if (name === 'get_layer') data = layerById(p, i.layerId);
				else if (name === 'get_motion') {
					const ids = (i.layerIds ?? session.context.selectedLayerIds) as string[];
					check(ids.length, 'Select layers or supply layerIds');
					data = ids.map((id) => {
						const l = layerById(p, id);
						return {
							layerId: id,
							text: l.type === 'text' ? l.text : undefined,
							tracks: Object.fromEntries(
								Object.entries(l.tracks)
									.filter(([prop]) => !i.properties || (i.properties as string[]).includes(prop))
									.map(([prop, t]) => [
										prop,
										{
											...t,
											keys: t.keys.filter(
												(k) =>
													!i.range ||
													(k.frame >= (i.range as { startFrame: number }).startFrame &&
														k.frame <= (i.range as { endFrame: number }).endFrame)
											)
										}
									])
							)
						};
					});
				} else {
					const operations: Operation[] =
						name === 'batch_edit' ? (i.operations as Operation[]) : [{ name, input: i }];
					for (const op of operations) {
						validate(motionSchemas[op.name], op.input);
						if (motionSchemas[op.name].properties?.layerIds && op.input.layerIds === undefined) {
							check(
								raw.expectedContextRevision !== undefined,
								'Selection-based edits require expectedContextRevision'
							);
							check(session.context.selectedLayerIds.length, 'Select target layers');
							op.input.layerIds = [...session.context.selectedLayerIds];
							if (op.input.properties === undefined && session.context.selectedProperties.length)
								op.input.properties = [...session.context.selectedProperties];
							if (op.input.range === undefined && session.context.selectedRange)
								op.input.range = { ...session.context.selectedRange };
						}
					}
					data = session.commit(
						operations,
						name === 'batch_edit' ? string(i.label, 200) : name.replaceAll('_', ' '),
						'agent',
						raw.expectedRevision as number
					);
				}
				const result = JSON.parse(
					JSON.stringify({ ok: true, revision: session.project.revision, data })
				);
				if (raw.requestId) {
					requests.set(String(raw.requestId), { fingerprint, result });
					if (requests.size > 100) requests.delete(requests.keys().next().value!);
				}
				return result;
			} catch (error) {
				return {
					ok: false,
					revision: session.project.revision,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}
	}));
}
export async function registerMotionTools(
	session: MotionSession,
	document: Document & { modelContext?: ModelContext } = globalThis.document
) {
	if (!document.modelContext?.registerTool) {
		session.webmcp = 'WebMCP unavailable · manual editor ready';
		return () => {};
	}
	const controller = new AbortController(),
		registered: string[] = [];
	const context = document.modelContext;
	const dispose = () => {
		controller.abort();
		for (const name of registered) void context.unregisterTool?.(name);
	};
	try {
		for (const tool of createMotionTools(session)) {
			// The browser document owns registration. No server-side substitute or mock on the app path.
			await document.modelContext.registerTool(
				{
					...tool,
					execute: async (input) => {
						if (controller.signal.aborted) return { ok: false, error: 'Editor closed' };
						return tool.execute(input);
					}
				},
				{ signal: controller.signal }
			);
			registered.push(tool.name);
		}
		session.webmcp = `${registered.length} WebMCP tools ready`;
		return dispose;
	} catch (error) {
		dispose();
		session.webmcp = `WebMCP registration failed: ${String(error)}`;
		return () => {};
	}
}
