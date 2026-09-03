import type { Layer } from './model';

export type LayerTreeRow = { layer: Layer; depth: number; childCount: number };

export function flattenLayerTree(layers: Layer[], collapsed: string[]): LayerTreeRow[] {
	// Layers are stored back-to-front, but the panels display each sibling set front-to-back.
	const childrenOf = (parentId?: string) =>
		layers.filter((layer) => layer.parentId === parentId).reverse();
	const visit = (parentId: string | undefined, depth: number): LayerTreeRow[] =>
		childrenOf(parentId).flatMap((layer) => {
			const children = childrenOf(layer.id);
			return [
				{ layer, depth, childCount: children.length },
				...(collapsed.includes(layer.id) ? [] : visit(layer.id, depth + 1))
			];
		});
	return visit(undefined, 0);
}
