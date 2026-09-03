import type { Runtime } from './webmcp-runtime';
import { actionGroups, toolDeclarations, type ModelContext } from './webmcp-schema';

export async function registerAnimationTools(
	runtime: Runtime,
	context: ModelContext,
	signal: AbortSignal
) {
	await context.registerTool(
		runtime.write(toolDeclarations.edit_animation, actionGroups.animation),
		{ signal }
	);
	return ['edit_animation'];
}
