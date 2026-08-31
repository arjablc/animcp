import { util, type TComplexPathData, type TSimplePathData } from 'fabric';
import type { PathData, Transform } from '../animation/model';
import { validatePath } from '../animation/validation';

/** The only Fabric-to-domain boundary. SVG markup is never accepted as path data. */
export function fromFabricPath(input: TComplexPathData | string): PathData {
	if (typeof input === 'string' && (input.length > 500_000 || /[<>]/.test(input))) {
		throw new Error('Provide bounded SVG path data, not SVG markup.');
	}
	const commands = util.makePathSimpler(typeof input === 'string' ? util.parsePath(input) : input);
	let x = 0,
		y = 0,
		startX = 0,
		startY = 0;
	const result: PathData = commands.map((command) => {
		switch (command[0]) {
			case 'M':
				[x, y] = [command[1], command[2]];
				[startX, startY] = [x, y];
				return { type: 'M', x, y };
			case 'L':
				[x, y] = [command[1], command[2]];
				return { type: 'L', x, y };
			case 'C':
				[x, y] = [command[5], command[6]];
				return { type: 'C', x1: command[1], y1: command[2], x2: command[3], y2: command[4], x, y };
			case 'Q': {
				const next = {
					type: 'C' as const,
					x1: x + (2 / 3) * (command[1] - x),
					y1: y + (2 / 3) * (command[2] - y),
					x2: command[3] + (2 / 3) * (command[1] - command[3]),
					y2: command[4] + (2 / 3) * (command[2] - command[4]),
					x: command[3],
					y: command[4]
				};
				[x, y] = [next.x, next.y];
				return next;
			}
			case 'Z':
				[x, y] = [startX, startY];
				return { type: 'Z' };
		}
	});
	validatePath(result);
	return result;
}

export function toFabricPath(paths: PathData[]): TSimplePathData {
	return paths.flatMap((path) =>
		path.map((c): TSimplePathData[number] => {
			if (c.type === 'Z') return ['Z'];
			if (c.type === 'C') return ['C', c.x1, c.y1, c.x2, c.y2, c.x, c.y];
			return [c.type, c.x, c.y];
		})
	);
}

export function transformMatrix(t: Transform): [number, number, number, number, number, number] {
	const angle = (t.rotation * Math.PI) / 180;
	return [
		Math.cos(angle) * t.scaleX,
		Math.sin(angle) * t.scaleX,
		-Math.sin(angle) * t.scaleY,
		Math.cos(angle) * t.scaleY,
		t.x,
		t.y
	];
}
