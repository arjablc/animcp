import type { Runtime } from './webmcp-runtime';
import { actionGroups, toolDeclarations, type ModelContext } from './webmcp-schema';

export async function registerLayerTools(
	runtime: Runtime,
	context: ModelContext,
	signal: AbortSignal
) {
	await context.registerTool(runtime.write(toolDeclarations.edit_layers, actionGroups.layers), {
		signal
	});
	return ['edit_layers'];
}
