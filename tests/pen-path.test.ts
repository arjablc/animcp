import { describe, expect, it } from 'vitest';
import { addPenPoint, dragPenPoint } from '../src/lib/features/canvas/pen-path';

describe('pen path construction', () => {
	it('makes a clicked point a straight line', () => {
		const first = addPenPoint({ paths: [] }, { x: 10, y: 20 });
		const next = addPenPoint(first, { x: 50, y: 20 });
		expect(next.paths).toEqual([
			{ type: 'M', x: 10, y: 20 },
			{ type: 'L', x: 50, y: 20 }
		]);
	});

	it('makes a shift-dragged new point a cubic with mirrored handles', () => {
		const start = addPenPoint({ paths: [] }, { x: 10, y: 20 });
		const placed = addPenPoint(start, { x: 50, y: 40 });
		const curved = dragPenPoint(placed, 1, { x: 50, y: 40 }, { x: 70, y: 55 });
		expect(curved.paths[1]).toEqual({
			type: 'C',
			x1: 10,
			y1: 20,
			x2: 30,
			y2: 25,
			x: 50,
			y: 40
		});
		expect(curved.nextHandle).toEqual({ x: 70, y: 55 });
	});

	it('uses the prior dragged anchor handle for the following segment', () => {
		const first = dragPenPoint(
			addPenPoint({ paths: [] }, { x: 10, y: 20 }),
			0,
			{ x: 10, y: 20 },
			{ x: 25, y: 20 }
		);
		const next = addPenPoint(first, { x: 50, y: 20 });
		expect(next.paths[1]).toMatchObject({ type: 'C', x1: 25, y1: 20, x2: 50, y2: 20 });
	});
});
