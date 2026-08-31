import type { PathCommand, PathData } from '../animation/model';

type Handle = { x: number; y: number };

export type PenDraft = {
	paths: PathData;
	/** The outgoing handle of the most recently placed anchor. */
	nextHandle?: Handle;
};

function endpoint(command: PathCommand): Handle | undefined {
	return command.type === 'Z' ? undefined : { x: command.x, y: command.y };
}

/** Add a corner, retaining the preceding dragged anchor's outgoing handle. */
export function addPenPoint(draft: PenDraft, point: Handle): PenDraft {
	if (draft.paths.length === 0) return { paths: [{ type: 'M', ...point }] };
	const previous = endpoint(draft.paths.at(-1)!);
	if (!previous) throw new Error('Cannot add a point after a closed path.');
	const command = draft.nextHandle
		? {
				type: 'C' as const,
				x1: draft.nextHandle.x,
				y1: draft.nextHandle.y,
				x2: point.x,
				y2: point.y,
				...point
			}
		: { type: 'L' as const, ...point };
	return { paths: [...draft.paths, command] };
}

/**
 * Turn a newly placed anchor into a smooth point. Its incoming control is
 * opposite the drag vector; its outgoing control is saved for the next edge.
 */
export function dragPenPoint(
	draft: PenDraft,
	index: number,
	point: Handle,
	pointer: Handle
): PenDraft {
	const command = draft.paths[index];
	if (!command || command.type === 'Z') throw new Error('A pen handle needs an anchor.');
	const dx = pointer.x - point.x;
	const dy = pointer.y - point.y;
	if (index === 0) {
		return { paths: draft.paths, nextHandle: { x: point.x + dx, y: point.y + dy } };
	}
	const previous = endpoint(draft.paths[index - 1]);
	if (!previous) throw new Error('A pen handle needs a preceding anchor.');
	// During a drag this function runs for every pointer move. Once the line
	// becomes a cubic, retain its original outgoing control instead of using the
	// new anchor's outgoing handle as the next input.
	const incomingStart =
		command.type === 'C' ? { x: command.x1, y: command.y1 } : (draft.nextHandle ?? previous);
	const curve: PathCommand = {
		type: 'C',
		x1: incomingStart.x,
		y1: incomingStart.y,
		x2: point.x - dx,
		y2: point.y - dy,
		x: point.x,
		y: point.y
	};
	return {
		paths: [...draft.paths.slice(0, index), curve, ...draft.paths.slice(index + 1)],
		nextHandle: { x: point.x + dx, y: point.y + dy }
	};
}
