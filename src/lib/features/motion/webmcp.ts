import type { MotionSession } from './session.svelte';
import { registerAnimationTools } from './webmcp-animation';
import { registerApplyEditsTool } from './webmcp-apply-edits';
import { registerLayerTools } from './webmcp-layers';
import { registerPathTools } from './webmcp-path';
import { registerReadTools } from './webmcp-read';
import { createWebMcpRuntime } from './webmcp-runtime';
import { registerTimelineTools } from './webmcp-timeline';
import type { ModelContext } from './webmcp-schema';

export type { ModelContext, Tool } from './webmcp-schema';
export { toolDeclarations } from './webmcp-schema';

type WebMcpDocument = Document & { modelContext?: ModelContext };

export async function refreshMotionTools(
	session: MotionSession,
	document: WebMcpDocument = globalThis.document
) {
	if (!document.modelContext?.getTools) {
		session.webmcpTools = [];
		return;
	}
	session.webmcpTools = [...(await document.modelContext.getTools())];
}

export async function registerMotionTools(
	session: MotionSession,
	document: WebMcpDocument = globalThis.document
) {
	if (!document.modelContext?.registerTool || !document.modelContext.getTools) {
		session.webmcp = 'WebMCP unavailable · manual editor ready';
		session.webmcpTools = [];
		return () => {};
	}
	const controller = new AbortController();
	const context = document.modelContext;
	const runtime = createWebMcpRuntime(session, controller.signal);
	const registered: string[] = [];
	const dispose = () => {
		controller.abort();
		for (const name of registered) void context.unregisterTool?.(name);
		session.webmcpTools = [];
	};
	try {
		for (const register of [
			registerReadTools,
			registerLayerTools,
			registerPathTools,
			registerAnimationTools,
			registerTimelineTools,
			registerApplyEditsTool
		])
			registered.push(...(await register(runtime, context, controller.signal)));
		await refreshMotionTools(session, document);
		session.webmcp = `${session.webmcpTools.length} WebMCP tools ready`;
		return dispose;
	} catch (error) {
		dispose();
		session.webmcp = `WebMCP registration failed: ${String(error)}`;
		return () => {};
	}
}
