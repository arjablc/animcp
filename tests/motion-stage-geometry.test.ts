import { describe, expect, it } from 'vitest';
import { createLayer, createProject, type PathData } from '../src/lib/features/motion/model';
import { selectionBounds } from '../src/lib/features/motion/stage-geometry';
import {
	editPathControl,
	normalizeDraft,
	pathDataString,
	penAnchor,
	subpathData
} from '../src/lib/features/motion/stage-path';

describe('motion stage paths', () => {
	it('builds and normalizes a closed Bezier subpath including its handles', () => {
		const path = subpathData({
			closed: true,
			anchors: [
				penAnchor({ x: 10, y: 20 }, { x: 15, y: 20 }),
				penAnchor({ x: 30, y: 40 }),
				penAnchor({ x: 50, y: 20 })
			]
		});
		expect(pathDataString(path)).toBe(
			'M 10 20 C 15 20 30 40 30 40 C 30 40 50 20 50 20 C 50 20 5 20 10 20 Z'
		);
		expect(normalizeDraft([path]).bounds).toEqual({
			positionX: 5,
			positionY: 20,
			width: 45,
			height: 20
		});
	});

	it('keeps joined handles mirrored while editing a closed path', () => {
		const path: PathData = [
			{ type: 'M', x: 0, y: 0 },
			{ type: 'C', x1: 2, y1: 3, x2: 8, y2: 9, x: 10, y: 10 },
			{ type: 'C', x1: 7, y1: 8, x2: -2, y2: -3, x: 0, y: 0 },
			{ type: 'Z' }
		];
		const edited = editPathControl([path], 0, 1, 'x1', 3, 1);
		expect(edited[0][1]).toMatchObject({ x1: 5, y1: 4 });
		expect(edited[0][2]).toMatchObject({ x2: -5, y2: -4 });
		expect(path[1]).toMatchObject({ x1: 2, y1: 3 });
	});
});

describe('motion stage bounds', () => {
	it('computes rotated visual and group selection bounds', () => {
		const project = createProject();
		const group = createLayer('group');
		const child = createLayer('rectangle');
		child.parentId = group.id;
		child.tracks.positionX.defaultValue = 10;
		child.tracks.positionY.defaultValue = 20;
		child.tracks.width.defaultValue = 100;
		child.tracks.height.defaultValue = 40;
		child.tracks.scaleX.defaultValue = 2;
		child.tracks.scaleY.defaultValue = 0.5;
		child.tracks.rotation.defaultValue = 90;
		project.layers.push(group, child);

		const bounds = selectionBounds(project, group, 0);
		expect(bounds.x).toBeCloseTo(50);
		expect(bounds.y).toBeCloseTo(-60);
		expect(bounds.width).toBeCloseTo(20);
		expect(bounds.height).toBeCloseTo(200);
	});
});
