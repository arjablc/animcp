import { findElements, layerById, type Input } from './commands';
import type { Runtime } from './webmcp-runtime';
import {
	actionDescriptions,
	operationSchemas,
	toolDeclarations,
	type ModelContext
} from './webmcp-schema';

export async function registerReadTools(
	runtime: Runtime,
	context: ModelContext,
	signal: AbortSignal
) {
	const { session } = runtime;
	await context.registerTool(
		runtime.read(toolDeclarations.get_editor_context, () => {
			const project = session.project;
			return {
				context: session.context,
				composition: project.composition,
				layers: project.layers.map((layer) => ({
					id: layer.id,
					name: layer.name,
					type: layer.type,
					text: layer.type === 'text' ? layer.text : undefined,
					visible: layer.visible,
					locked: layer.locked,
					locks: Object.fromEntries(
						Object.entries(layer.tracks)
							.filter(([, track]) => track.locks)
							.map(([property, track]) => [property, track.locks])
					)
				})),
				assets: project.assets.map(({ id, name, mime, width, height }) => ({
					id,
					name,
					mime,
					width,
					height
				}))
			};
		}),
		{ signal }
	);
	await context.registerTool(
		runtime.read(toolDeclarations.find_elements, (input) => {
			const candidates = findElements(session.project, input);
			return {
				status:
					candidates.length === 0 ? 'not_found' : candidates.length === 1 ? 'unique' : 'ambiguous',
				candidates
			};
		}),
		{ signal }
	);
	await context.registerTool(
		runtime.read(toolDeclarations.get_layer, (input) => layerById(session.project, input.layerId)),
		{ signal }
	);
	await context.registerTool(
		runtime.read(toolDeclarations.get_motion, (input: Input) => {
			const ids = (input.layerIds ?? session.context.selectedLayerIds) as string[];
			if (!ids.length) throw new Error('Select layers or supply layerIds');
			return ids.map((id) => {
				const layer = layerById(session.project, id);
				return {
					layerId: id,
					text: layer.type === 'text' ? layer.text : undefined,
					tracks: Object.fromEntries(
						Object.entries(layer.tracks)
							.filter(
								([property]) =>
									!input.properties || (input.properties as string[]).includes(property)
							)
							.map(([property, track]) => [
								property,
								{
									...track,
									keys: track.keys.filter(
										(key) =>
											!input.range ||
											(key.frame >= (input.range as { startFrame: number }).startFrame &&
												key.frame <= (input.range as { endFrame: number }).endFrame)
									)
								}
							])
					)
				};
			});
		}),
		{ signal }
	);
	await context.registerTool(
		runtime.read(toolDeclarations.get_operation_schema, (input) => ({
			action: input.action,
			description:
				actionDescriptions[String(input.action)] ?? String(input.action).replaceAll('_', ' '),
			inputSchema: operationSchemas[String(input.action)]
		})),
		{ signal }
	);
	return ['get_editor_context', 'find_elements', 'get_layer', 'get_motion', 'get_operation_schema'];
}
