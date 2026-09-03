import type { Runtime } from './webmcp-runtime';
import { actionGroups, toolDeclarations, type ModelContext } from './webmcp-schema';

export async function registerTimelineTools(
	runtime: Runtime,
	context: ModelContext,
	signal: AbortSignal
) {
	await context.registerTool(runtime.write(toolDeclarations.edit_timeline, actionGroups.timeline), {
		signal
	});
	return ['edit_timeline'];
}
