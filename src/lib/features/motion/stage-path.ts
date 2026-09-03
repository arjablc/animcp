import { copyPaths, type PathData } from './model';

type Point = { x: number; y: number };
type PenAnchor = Point & { inX: number; inY: number; outX: number; outY: number };
export type DraftSubpath = { anchors: PenAnchor[]; closed: boolean };
export type PathControl = 'anchor' | 'x1' | 'x2';

export function penAnchor(point: Point, handle: Point = point): PenAnchor {
	const dx = handle.x - point.x,
		dy = handle.y - point.y;
	return {
		...point,
		inX: point.x - dx,
		inY: point.y - dy,
		outX: point.x + dx,
		outY: point.y + dy
	};
}

export function subpathData(subpath: DraftSubpath, preview?: PenAnchor): PathData {
	const anchors = preview ? [...subpath.anchors, preview] : subpath.anchors;
	if (!anchors.length) return [];
	const commands: PathData = [{ type: 'M', x: anchors[0].x, y: anchors[0].y }];
	for (let index = 1; index < anchors.length; index++) {
		const previous = anchors[index - 1],
			anchor = anchors[index];
		commands.push({
			type: 'C',
			x1: previous.outX,
			y1: previous.outY,
			x2: anchor.inX,
			y2: anchor.inY,
			x: anchor.x,
			y: anchor.y
		});
	}
	if (subpath.closed && anchors.length > 2) {
		const last = anchors.at(-1)!,
			first = anchors[0];
		commands.push({
			type: 'C',
			x1: last.outX,
			y1: last.outY,
			x2: first.inX,
			y2: first.inY,
			x: first.x,
			y: first.y
		});
		commands.push({ type: 'Z' });
	}
	return commands;
}

export function pathDataString(path: PathData) {
	return path
		.map((command) =>
			command.type === 'Z'
				? 'Z'
				: command.type === 'C'
					? `C ${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`
					: `${command.type} ${command.x} ${command.y}`
		)
		.join(' ');
}

export function normalizeDraft(paths: PathData[]) {
	// Control points count toward bounds so normalization never clips a Bezier handle.
	const points = paths.flatMap((path) =>
		path.flatMap((command) =>
			command.type === 'Z'
				? []
				: command.type === 'C'
					? [
							{ x: command.x, y: command.y },
							{ x: command.x1, y: command.y1 },
							{ x: command.x2, y: command.y2 }
						]
					: [{ x: command.x, y: command.y }]
		)
	);
	const left = Math.min(...points.map((point) => point.x)),
		top = Math.min(...points.map((point) => point.y)),
		right = Math.max(...points.map((point) => point.x)),
		bottom = Math.max(...points.map((point) => point.y));
	return {
		paths: paths.map((path) =>
			path.map((command) => {
				if (command.type === 'Z') return command;
				if (command.type === 'C')
					return {
						...command,
						x: command.x - left,
						y: command.y - top,
						x1: command.x1 - left,
						y1: command.y1 - top,
						x2: command.x2 - left,
						y2: command.y2 - top
					};
				return { ...command, x: command.x - left, y: command.y - top };
			})
		),
		bounds: {
			positionX: left,
			positionY: top,
			width: Math.max(1, right - left),
			height: Math.max(1, bottom - top)
		}
	};
}

export function previousPoint(path: PathData, index: number) {
	for (let current = index - 1; current >= 0; current--) {
		const command = path[current];
		if (command.type !== 'Z') return { x: command.x, y: command.y };
	}
	return null;
}

export function editPathControl(
	paths: PathData[],
	pathIndex: number,
	commandIndex: number,
	control: PathControl,
	dx: number,
	dy: number
) {
	const nextPaths = copyPaths(paths);
	const path = nextPaths[pathIndex];
	const command = path?.[commandIndex];
	if (!command || command.type === 'Z') return nextPaths;
	if (control === 'anchor') {
		command.x += dx;
		command.y += dy;
		if (command.type === 'C') {
			command.x2 += dx;
			command.y2 += dy;
		}
		const next = path[commandIndex + 1];
		if (next?.type === 'C') {
			next.x1 += dx;
			next.y1 += dy;
		}
		if (commandIndex === 0 && path.at(-1)?.type === 'Z') {
			const closing = path.at(-2);
			if (closing?.type === 'C') {
				closing.x += dx;
				closing.y += dy;
				closing.x2 += dx;
				closing.y2 += dy;
			}
		}
	} else if (command.type === 'C') {
		if (control === 'x1') {
			command.x1 += dx;
			command.y1 += dy;
			const anchor = previousPoint(path, commandIndex);
			const previous = path[commandIndex - 1];
			const closing = path.at(-1)?.type === 'Z' ? path.at(-2) : undefined;
			const opposite =
				previous?.type === 'C' ? previous : closing?.type === 'C' ? closing : undefined;
			// Joined handles stay mirrored through their shared anchor.
			if (anchor && opposite) {
				opposite.x2 = anchor.x * 2 - command.x1;
				opposite.y2 = anchor.y * 2 - command.y1;
			}
		} else {
			command.x2 += dx;
			command.y2 += dy;
			const next =
				path[commandIndex + 1]?.type === 'C'
					? path[commandIndex + 1]
					: path.at(-1)?.type === 'Z' && path[1]?.type === 'C'
						? path[1]
						: undefined;
			if (next?.type === 'C') {
				next.x1 = command.x * 2 - command.x2;
				next.y1 = command.y * 2 - command.y2;
			}
		}
	}
	return nextPaths;
}
