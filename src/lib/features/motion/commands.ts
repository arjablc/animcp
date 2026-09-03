import { check, type Project, validateProject } from './model';
import { type Input, type Operation, unhandled, validateLocks } from './command-core';
import { applyLayerCommand } from './layer-commands';
import { applyTimingCommand } from './timing-commands';

export type { Context, History, Input, Operation } from './command-core';
export { layerById, refs, span } from './command-core';
export { findElements } from './layer-commands';

function apply(project: Project, operation: Operation): unknown {
	const layerResult = applyLayerCommand(project, operation);
	if (layerResult !== unhandled) return layerResult;
	const timingResult = applyTimingCommand(project, operation);
	if (timingResult !== unhandled) return timingResult;
	throw new Error(`Unknown motion command: ${operation.name}`);
}

export function transact(
	project: Project,
	operations: Operation[]
): { project: Project; data: unknown[] } {
	check(operations.length > 0 && operations.length <= 100, 'A batch needs 1–100 operations');
	// Work on one clone so a thrown operation leaves the caller's project and the whole batch unchanged.
	let next = structuredClone(project);
	const data: unknown[] = [];
	for (const operation of operations) {
		const before = structuredClone(next);
		data.push(apply(next, operation));
		for (const layer of next.layers)
			for (const track of Object.values(layer.tracks)) track.keys.sort((a, b) => a.frame - b.frame);
		validateLocks(before, next, operation.input.preserve as Input | undefined);
		next = validateProject(next);
	}
	next.revision = project.revision + 1;
	next.updatedAt = new Date().toISOString();
	return { project: next, data };
}
