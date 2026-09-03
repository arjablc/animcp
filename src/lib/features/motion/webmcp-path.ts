import type { Runtime } from './webmcp-runtime';
import { actionGroups, toolDeclarations, type ModelContext } from './webmcp-schema';

export async function registerPathTools(
	runtime: Runtime,
	context: ModelContext,
	signal: AbortSignal
) {
	await context.registerTool(runtime.write(toolDeclarations.edit_path, actionGroups.path), {
		signal
	});
	return ['edit_path'];
}
