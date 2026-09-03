import type { MotionSession } from './session.svelte';
import { check, string } from './model';
import { type Input, type Operation } from './commands';
import { operationSchemas, validate, type Schema, type Tool } from './webmcp-schema';

export type Runtime = ReturnType<typeof createWebMcpRuntime>;

export function createWebMcpRuntime(session: MotionSession, signal: AbortSignal) {
	const requests = new Map<string, { fingerprint: string; result: unknown }>();

	const run = async (
		toolName: string,
		schema: Schema,
		raw: Input,
		execute: (input: Input) => unknown | Promise<unknown>
	) => {
		try {
			check(!signal.aborted, 'Editor closed');
			validate(schema, raw);
			const fingerprint = JSON.stringify([toolName, raw]);
			if (raw.requestId) {
				const old = requests.get(String(raw.requestId));
				if (old) {
					check(old.fingerprint === fingerprint, 'Request ID reused with different input');
					return structuredClone(old.result);
				}
			}
			const data = await execute(structuredClone(raw));
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
	};

	const operations = (items: { action: string; input: Input }[], raw: Input) =>
		items.map(({ action, input }) => {
			const schema = operationSchemas[action];
			check(schema, `Unknown action: ${action}`);
			validate(schema, input, action);
			const operation: Operation = {
				name: action === 'create_path' ? 'create_layer' : action,
				input: structuredClone(input)
			};
			if (action === 'create_path') operation.input.type = 'path';
			if (schema.properties?.layerIds && operation.input.layerIds === undefined) {
				check(
					raw.expectedContextRevision !== undefined,
					'Selection-based edits require expectedContextRevision'
				);
				check(session.context.selectedLayerIds.length, 'Select target layers');
				operation.input.layerIds = [...session.context.selectedLayerIds];
				if (operation.input.properties === undefined && session.context.selectedProperties.length)
					operation.input.properties = [...session.context.selectedProperties];
				if (operation.input.range === undefined && session.context.selectedRange)
					operation.input.range = { ...session.context.selectedRange };
			}
			return operation;
		});

	const checkRevision = (raw: Input) => {
		check(
			raw.expectedRevision === session.project.revision,
			'Revision conflict: read current state'
		);
		if (raw.expectedContextRevision !== undefined)
			check(
				raw.expectedContextRevision === session.context.revision,
				'Selection/context changed: read context again'
			);
	};

	return {
		session,
		read: (tool: Omit<Tool, 'execute'>, execute: (input: Input) => unknown | Promise<unknown>) => ({
			...tool,
			execute: (input: Input) => run(tool.name, tool.inputSchema, input, execute)
		}),
		write: (tool: Omit<Tool, 'execute'>, actions: readonly string[]) => ({
			...tool,
			execute: (raw: Input) =>
				run(tool.name, tool.inputSchema, raw, (input) => {
					checkRevision(input);
					const action = String(input.action);
					check(actions.includes(action), `${action} is not available in ${tool.name}`);
					return session.commit(
						operations([{ action, input: input.input as Input }], input),
						action.replaceAll('_', ' '),
						'agent',
						input.expectedRevision as number
					);
				})
		}),
		batch: (tool: Omit<Tool, 'execute'>) => ({
			...tool,
			execute: (raw: Input) =>
				run(tool.name, tool.inputSchema, raw, (input) => {
					checkRevision(input);
					return session.commit(
						operations(input.operations as { action: string; input: Input }[], input),
						string(input.label, 200),
						'agent',
						input.expectedRevision as number
					);
				})
		})
	};
}
