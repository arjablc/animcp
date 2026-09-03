import type { Runtime } from './webmcp-runtime';
import { toolDeclarations, type ModelContext } from './webmcp-schema';

export async function registerApplyEditsTool(
	runtime: Runtime,
	context: ModelContext,
	signal: AbortSignal
) {
	await context.registerTool(runtime.batch(toolDeclarations.apply_edits), { signal });
	return ['apply_edits'];
}
