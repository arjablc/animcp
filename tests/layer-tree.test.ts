import { describe, expect, it } from 'vitest';
import { flattenLayerTree } from '../src/lib/features/motion/layer-tree';
import { createLayer } from '../src/lib/features/motion/model';

describe('flattenLayerTree', () => {
	it('reverses stored sibling order and omits descendants of collapsed layers', () => {
		const back = createLayer('rectangle', 'Back');
		const group = createLayer('group', 'Group');
		const childBack = createLayer('rectangle', 'Child back');
		const childFront = createLayer('ellipse', 'Child front');
		childBack.parentId = group.id;
		childFront.parentId = group.id;

		const layers = [back, group, childBack, childFront];
		expect(
			flattenLayerTree(layers, []).map(({ layer, depth, childCount }) => [
				layer.name,
				depth,
				childCount
			])
		).toEqual([
			['Group', 0, 2],
			['Child front', 1, 0],
			['Child back', 1, 0],
			['Back', 0, 0]
		]);
		expect(flattenLayerTree(layers, [group.id]).map(({ layer }) => layer.name)).toEqual([
			'Group',
			'Back'
		]);
	});
});
